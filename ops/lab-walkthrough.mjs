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
/**
 * How many times to build a run before giving up.
 *
 * `explorer-synced` requires the indexer to hold EVERY block up to the tip, and
 * a lab mines continuously -- so between a new block and the next indexer pass
 * the check is legitimately false, and a preflight is a snapshot of a moving
 * chain. Retrying is honest here; suppressing the check would not be. Each
 * attempt prints why it failed, so a retry can never hide a different cause.
 */
const ATTEMPTS = Number(arg('--attempts', '4'));
/**
 * Seconds to hold the fault before recovering, or 0 to leave the run live.
 *
 * Arming is not the end of the walkthrough. A run that applies a fault and is
 * never recovered leaves a stopped container and a held live slot behind, and
 * proves only half the path -- the half that does not have to undo anything.
 */
const RECOVER_AFTER_S = Number(arg('--recover-after', '0'));
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

async function attemptRun() {
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
      seed: `lab-${TARGET}-${step}`,
      parameters: { count: 1, durationSeconds: 60, targetIds: [TARGET] },
    },
  });
  if (!report('create', created)) return null;
  const runKey = created.data.runKey ?? created.data.run?.runKey;
  console.log(`  runKey ${runKey}`);

  if (!report('validate', await api('POST', `/runs/${runKey}/validate`))) return null;

  const dry = await api('GET', `/runs/${runKey}/dry-run`);
  if (!report('dry-run', dry)) return null;
  console.log(`  ${dry.data.plan?.actions?.length ?? 0} planned action(s)`);

  const armed = await api('POST', `/runs/${runKey}/arm`, { acknowledgedRiskClass: 'medium' });
  if (!armed.ok) {
    console.log(`arm: ${armed.status} ${JSON.stringify(armed.error)}`);
    const state = await api('GET', `/runs/${runKey}`);
    // The status route returns the run itself, not { run }.
    for (const item of (state.data?.preflight ?? state.data?.run?.preflight ?? [])) {
      if (item.passed !== true) console.log(`  ${item.severity} ${item.checkId}: ${item.privateDetail ?? item.publicMessage}`);
    }
    return null;
  }
  console.log('arm: ok');

  if (!report('start', await api('POST', `/runs/${runKey}/start`))) return null;
  return runKey;
}

let runKey = null;
for (let attempt = 1; attempt <= ATTEMPTS && runKey === null; attempt++) {
  if (attempt > 1) {
    console.log(`
-- attempt ${attempt} of ${ATTEMPTS}`);
    // Spaced, not immediate. The gap this retry exists for is the ~1.5 s between
    // a new block and the next indexer pass, and three attempts fired back to
    // back all land inside the SAME gap -- retrying an instant instead of
    // retrying the condition.
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
  runKey = await attemptRun();
}
if (runKey === null) process.exit(1);

const state = await api('GET', `/runs/${runKey}`);
console.log(`status: ${state.data?.state?.status ?? state.data?.run?.state?.status ?? 'unknown'}`);

if (RECOVER_AFTER_S > 0) {
  console.log(`holding the fault for ${RECOVER_AFTER_S}s`);
  await new Promise((resolve) => setTimeout(resolve, RECOVER_AFTER_S * 1000));
  report('recover', await api('POST', `/runs/${runKey}/recover`, {}));
  const after = await api('GET', `/runs/${runKey}`);
  console.log(`status: ${after.data?.state?.status ?? 'unknown'}`);
} else {
  console.log(`
runKey ${runKey} is live -- recover it with the recover route when done.`);
}
