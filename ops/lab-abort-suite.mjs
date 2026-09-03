#!/usr/bin/env node
/**
 * Aborts every scenario the lab can run, mid-fault, and proves the lab came back.
 *
 * Gate A asks for abort DURING each scenario, and it is the check that matters
 * most: a fault the operator cannot call off is worse than one they cannot
 * start. It is also the first live exercise of the netem and partition classes,
 * which have only ever been proven in a unit test and by hand.
 *
 * Each scenario is armed, started, held long enough for the fault to actually
 * land, then aborted -- and afterwards the containers, the queue and the run are
 * all checked. A run that reports `aborted` while a node is still stopped would
 * be the worst possible outcome, so the container state is read from Docker
 * rather than from the run.
 *
 *   node ops/lab-abort-suite.mjs [--nodes 11]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { labNodeName } from '../server/dist/simulator/labCompose.js';
import { labPaths } from './lab-paths.mjs';
import { docker } from './lab-rpc.mjs';

const API = process.env.LAB_API ?? 'http://127.0.0.1:4210';
const ADMIN_KEY =
  process.env.ADMIN_API_KEY ?? readFileSync(resolve(labPaths.stateDir, 'admin-key'), 'utf8').trim();
const at = process.argv.indexOf('--nodes');
const NODES = Number(at === -1 ? 11 : process.argv[at + 1]);

let call = 0;
async function api(method, path, body) {
  const response = await fetch(`${API}/api/v1/simulations${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-admin-api-key': ADMIN_KEY,
      'x-simulation-client': 'deftrack-cli-v1',
      'x-idempotency-key': `abort-suite-${process.pid}-${call++}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    return { status: response.status, ok: payload.success === true, data: payload.data, error: payload.error };
  } catch {
    return { status: response.status, ok: false, data: undefined, error: text.slice(0, 160) };
  }
}

/**
 * Every scenario this lab can express, with parameters small enough that the
 * fault lands quickly and its damage is bounded.
 *
 * `staker-stop` is absent: mn01 holds the wallet and mines, and it is not a
 * registered target -- stopping it would stop the chain, not a staker.
 */
const SCENARIOS = [
  {
    id: 'mn-stop',
    risk: 'medium',
    parameters: { count: 2, durationSeconds: 120 },
  },
  {
    id: 'restart-flapping',
    risk: 'high',
    parameters: { role: 'masternode', count: 1, cycles: 2, downSeconds: 30, upSeconds: 30 },
  },
  {
    id: 'network-degradation',
    risk: 'high',
    parameters: {
      role: 'masternode', count: 2, durationSeconds: 120,
      latencyMs: 250, jitterMs: 50, lossPercent: 5, correlationPercent: 25,
    },
  },
  {
    id: 'node-isolation',
    risk: 'high',
    parameters: { count: 1, durationSeconds: 120 },
  },
];

const containerNames = Array.from({ length: NODES }, (_, index) => labNodeName(index + 1));

function stoppedContainers() {
  return containerNames.filter((name) => {
    const status = docker(['inspect', '-f', '{{.State.Status}}', name], { quiet: true });
    return status !== '' && status !== 'running';
  });
}

/** What tc still holds on each node. A partition or netem left behind shows here. */
function containersWithQdisc() {
  return containerNames.filter((name) => {
    const out = docker(['exec', '-u', 'root', name, 'tc', 'qdisc', 'show', 'dev', 'eth0'], { quiet: true });
    // `noqueue` is the clean default; anything else is a fault still in place.
    return out !== '' && !out.includes('noqueue');
  });
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function abortDuring(scenario) {
  console.log(`\n=== ${scenario.id}`);
  for (const run of (await api('GET', '/runs?live=true')).data?.items ?? []) {
    await api('POST', `/runs/${run.runKey}/abort`, {});
  }

  const created = await api('POST', '/runs', {
    network: 'regtest',
    mode: 'live',
    scenario: {
      scenarioId: scenario.id,
      scenarioVersion: 1,
      seed: `abort-${scenario.id}`,
      parameters: scenario.parameters,
    },
  });
  if (!created.ok) return { scenario: scenario.id, outcome: `create ${created.status}`, detail: created.error };
  const runKey = created.data.runKey ?? created.data.run?.runKey;

  const validated = await api('POST', `/runs/${runKey}/validate`);
  if (!validated.ok) return { scenario: scenario.id, outcome: `validate ${validated.status}`, detail: validated.error };
  const armed = await api('POST', `/runs/${runKey}/arm`, { acknowledgedRiskClass: scenario.risk });
  if (!armed.ok) return { scenario: scenario.id, outcome: `arm ${armed.status}`, detail: armed.error };
  const started = await api('POST', `/runs/${runKey}/start`);
  if (!started.ok) return { scenario: scenario.id, outcome: `start ${started.status}`, detail: started.error };

  // Long enough for the fault to be applied, and well short of its duration, so
  // the abort really does interrupt something that is in force.
  await wait(25_000);
  const during = { stopped: stoppedContainers(), qdisc: containersWithQdisc() };
  console.log(`  during: stopped=[${during.stopped}] qdisc=[${during.qdisc}]`);

  const aborted = await api('POST', `/runs/${runKey}/abort`, {});
  if (!aborted.ok) return { scenario: scenario.id, outcome: `abort ${aborted.status}`, detail: aborted.error };

  // Recovery is not instant: a stopped container has to come back, and the
  // wrapper works one command at a time.
  await wait(30_000);
  const after = { stopped: stoppedContainers(), qdisc: containersWithQdisc() };
  const run = await api('GET', `/runs/${runKey}`);
  const state = run.data?.state ?? run.data?.run?.state ?? {};
  const pending = await api('GET', `/runs/${runKey}`);

  return {
    scenario: scenario.id,
    runKey,
    faultLanded: during.stopped.length > 0 || during.qdisc.length > 0,
    outcome: state.status,
    faultMayBeActive: state.faultMayBeActive,
    leftStopped: after.stopped,
    leftWithQdisc: after.qdisc,
    ok:
      (during.stopped.length > 0 || during.qdisc.length > 0) &&
      after.stopped.length === 0 &&
      after.qdisc.length === 0 &&
      state.faultMayBeActive === false,
    _unused: pending,
  };
}

const results = [];
for (const scenario of SCENARIOS) results.push(await abortDuring(scenario));

console.log('\n=== summary');
for (const result of results) {
  const mark = result.ok === true ? 'PASS' : result.ok === false ? 'FAIL' : '----';
  console.log(
    `${mark} ${result.scenario.padEnd(22)} ` +
      (result.ok === undefined
        ? `${result.outcome}: ${JSON.stringify(result.detail)}`
        : `landed=${result.faultLanded} status=${result.outcome} ` +
          `active=${result.faultMayBeActive} leftStopped=[${result.leftStopped}] leftQdisc=[${result.leftWithQdisc}]`)
  );
}
