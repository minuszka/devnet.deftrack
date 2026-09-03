/**
 * The paths and version the lab server and the fault wrapper must agree on.
 *
 * They are here rather than in either launcher because a disagreement between
 * them is silent: a server watching one command directory and a wrapper reading
 * another produces a run whose faults are simply never applied, and a wrapper
 * version the server does not expect fails the preflight with nothing to point
 * at. One definition, imported by both.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STATE_DIR = resolve(process.env.LAB_STATE_DIR ?? '.lab-state');

export const labPaths = {
  stateDir: STATE_DIR,
  commandDir: resolve(STATE_DIR, 'commands'),
  statePath: resolve(STATE_DIR, 'state.json'),
  heartbeatPath: resolve(STATE_DIR, 'heartbeat.json'),
};

/** Bumped whenever the wrapper's behaviour changes in a way a run must not mix. */
export const LAB_WRAPPER_VERSION = process.env.LAB_WRAPPER_VERSION ?? 'lab-1';

/**
 * A credential the lab generates for itself and keeps in its own gitignored
 * state.
 *
 * Generated rather than configured because an empty one does not fail loudly:
 * an empty ADMIN_API_KEY disables the control API and an empty INGEST_TOKEN
 * disables the observation endpoint, so the lab comes up looking healthy and
 * refuses every call. Generated rather than hardcoded because this repository is
 * public. It never leaves this machine.
 */
export function labSecret(name) {
  mkdirSync(labPaths.stateDir, { recursive: true });
  const path = resolve(labPaths.stateDir, name);
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const secret = randomBytes(24).toString('hex');
  writeFileSync(path, secret, { mode: 0o600 });
  return secret;
}
