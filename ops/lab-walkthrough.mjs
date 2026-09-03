#!/usr/bin/env node
/**
 * Drives one live run end to end through the control API.
 *
 * Deliberately through the API rather than the executor: the manual Docker
 * acceptance script calls the executor directly, stepping over the routes, the
 * control service and Mongo, so it can pass on a path nobody can actually walk.
 * Every closed door this lab has hit -- the identity pins, the empty registry,
 * the unlogged 500 -- was found here and nowhere else.
 *
 *   node ops/lab-walkthrough.mjs [--scenario mn-stop] [--target mn02]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { labPaths } from './lab-paths.mjs';

const API = process.env.LAB_API ?? 'http://127.0.0.1:4210';
const ADMIN_KEY =
  process.env.ADMIN_API_KEY ?? readFileSync(resolve(labPaths.stateDir, 'admin-key'), 'utf8').trim();
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};
const SCENARIO = arg('--scenario', 'mn-stop');
/**
 * Abort whatever live run currently holds the slot before creating a new one.
 *
 * Off by default and deliberately so: only one live run may exist at a time, and
 * a walkthrough that silently aborted the incumbent would be a script that ends
 * other people's experiments to make its own room. Opt in when the incumbent is
 * a leftover of your own.
 */
const ABORT_ACTIVE = process.argv.includes('--abort-active');
const TARGET = arg('--target', 'mn02');

let step = 0;
async function api(method, path, body) {
  const response = await fetch(`${API}/api/v1/simulations${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-admin-api-key': ADMIN_KEY,
      'x-simulation-client': 'deftrack-cli-v1',
      'x-idempotency-key': `lab-walkthrough-${process.pid}-${step++}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { status: response.status, ok: payload.success === true, data: payload.data, error: payload.error };
}

function report(label, result) {
  if (!result.ok) {
    console.log(`${label}: ${result.status} ${JSON.stringify(result.error)}`);
    return false;
  }
  console.log(`${label}: ok`);
  return true;
}

if (ABORT_ACTIVE) {
  const active = await api('GET', '/runs?live=true');
  for (const run of active.data?.items ?? []) {
    if (run.runKey === undefined) continue;
    console.log(`aborting incumbent ${run.runKey}`);
    await api('POST', `/runs/${run.runKey}/abort`, {});
  }
}

const created = await api('POST', '/runs', {
  network: 'regtest',
  mode: 'live',
  scenario: {
    scenarioId: SCENARIO,
    scenarioVersion: 1,
    seed: `lab-${TARGET}`,
    parameters: { count: 1, durationSeconds: 60, targetIds: [TARGET] },
  },
});
if (!report('create', created)) process.exit(1);
const runKey = created.data.runKey ?? created.data.run?.runKey;
console.log(`  runKey ${runKey}`);

if (!report('validate', await api('POST', `/runs/${runKey}/validate`))) process.exit(1);

const dry = await api('GET', `/runs/${runKey}/dry-run`);
if (!report('dry-run', dry)) process.exit(1);
console.log(`  ${dry.data.plan?.actions?.length ?? 0} planned action(s)`);

const armed = await api('POST', `/runs/${runKey}/arm`, { acknowledgedRiskClass: 'medium' });
if (!report('arm', armed)) process.exit(1);

const started = await api('POST', `/runs/${runKey}/start`);
if (!report('start', started)) process.exit(1);

const state = await api('GET', `/runs/${runKey}`);
console.log(`status: ${state.data?.run?.status ?? JSON.stringify(state.data).slice(0, 200)}`);
console.log(`\nrunKey ${runKey} -- recover with:`);
console.log(`  node ops/lab-walkthrough-recover.mjs ${runKey}`);
