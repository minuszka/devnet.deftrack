#!/usr/bin/env node
/**
 * Proves that the same seed and parameters produce the same experiment.
 *
 * Gate A asks for a repeatability check, and the honest form of it is narrower
 * than it first sounds. Two runs cannot produce identical MEASUREMENTS: they are
 * taken over different blocks, and a report that came out identical twice would
 * mean the second one had not looked. What must be identical is everything the
 * run decides for itself -- which targets it picked and what it planned to do to
 * them -- because that is what makes two campaigns comparable at all.
 *
 * So this compares plans, not outcomes, and it compares them by content rather
 * than by trusting the fingerprint: a fingerprint that matched while the plans
 * differed would be the more dangerous failure of the two.
 *
 * The third run is the control. With a DIFFERENT seed the selection must move,
 * or "deterministic" would just mean "ignores the seed" -- which is also
 * repeatable, and useless.
 *
 *   node ops/lab-repeatability.mjs [--scenario mn-stop] [--count 3]
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
const COUNT = Number(arg('--count', '3'));

let call = 0;
async function api(method, path, body) {
  const response = await fetch(`${API}/api/v1/admin/simulations${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-admin-api-key': ADMIN_KEY,
      'x-simulation-client': 'deftrack-cli-v1',
      'x-idempotency-key': `repeat-${process.pid}-${call++}`,
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

/** A run's plan, reduced to what the seed and parameters are supposed to decide. */
function planShape(plan) {
  return {
    selectedTargetIds: [...(plan.selectedTargetIds ?? [])].sort(),
    actions: (plan.actions ?? [])
      .map((action) => ({
        targetId: action.targetId,
        kind: action.payload?.kind,
        notBeforeOffsetMs: action.notBeforeOffsetMs,
        payload: action.payload,
      }))
      .sort((a, b) =>
        a.notBeforeOffsetMs - b.notBeforeOffsetMs ||
        (a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0) ||
        (a.kind < b.kind ? -1 : 1)
      ),
  };
}

async function planFor(seed) {
  // Dry-run mode: the plan is decided the same way, and nothing is applied. A
  // repeatability check must not cost the network anything.
  const created = await api('POST', '/runs', {
    network: 'regtest',
    mode: 'dry-run',
    scenario: {
      scenarioId: SCENARIO,
      scenarioVersion: 1,
      seed,
      parameters: { count: COUNT, durationSeconds: 60 },
    },
  });
  if (!created.ok) throw new Error(`create for seed "${seed}": ${created.status} ${JSON.stringify(created.error)}`);
  const runKey = created.data.runKey ?? created.data.run?.runKey;
  const dry = await api('GET', `/runs/${runKey}/dry-run`);
  if (!dry.ok) throw new Error(`dry-run for seed "${seed}": ${dry.status} ${JSON.stringify(dry.error)}`);
  return { runKey, plan: dry.data.plan ?? dry.data };
}

const SEED = `repeat-${Date.now()}`;
const first = await planFor(SEED);
const second = await planFor(SEED);
const control = await planFor(`${SEED}-other`);

const a = JSON.stringify(planShape(first.plan));
const b = JSON.stringify(planShape(second.plan));
const c = JSON.stringify(planShape(control.plan));

console.log(`scenario ${SCENARIO}, count ${COUNT}`);
console.log(`  run 1 ${first.runKey} targets=${planShape(first.plan).selectedTargetIds}`);
console.log(`  run 2 ${second.runKey} targets=${planShape(second.plan).selectedTargetIds}`);
console.log(`  ctrl  ${control.runKey} targets=${planShape(control.plan).selectedTargetIds}`);
console.log('');
console.log(`same seed  -> same plan: ${a === b ? 'PASS' : 'FAIL'}`);
// Not a nicety: a selection that ignores the seed is also perfectly repeatable.
console.log(`other seed -> different: ${c === a ? 'FAIL (the seed changes nothing)' : 'PASS'}`);

if (a !== b) {
  console.log('\nfirst:  ' + a.slice(0, 400));
  console.log('second: ' + b.slice(0, 400));
  process.exit(1);
}
if (a === c) process.exit(1);
