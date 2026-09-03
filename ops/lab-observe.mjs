#!/usr/bin/env node
/**
 * Runs the lab observer against the running lab.
 *
 * The preflight's observer-fresh check reads what this reports, and a target with
 * no observation is refused (MISSING_HOST_OBSERVATION) -- correctly, since a run
 * must not act on a node nobody can see. So the lab needs this running for the
 * same reason the devnet needs its per-host agents.
 *
 *   node ops/lab-observe.mjs [--nodes 4]
 */

import { spawn } from 'node:child_process';
import { labNodeName } from '../server/dist/simulator/labCompose.js';
import { labSecret } from './lab-paths.mjs';

const at = process.argv.indexOf('--nodes');
const nodes = Number(at === -1 ? 4 : process.argv[at + 1]);
const containers = Array.from({ length: nodes }, (_, i) => labNodeName(i + 1)).join(',');

const child = spawn(process.execPath, ['ops/lab-observer.mjs'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    LAB_API: process.env.LAB_API ?? 'http://127.0.0.1:4210',
    INGEST_TOKEN: process.env.INGEST_TOKEN ?? labSecret('ingest-token'),
    LAB_CONTAINERS: containers,
    // The observer's default cadence is sized for devnet blocks 2.5 minutes
    // apart. Against a lab mining every few seconds it leaves every host's
    // reported height two blocks behind the tip, and the target resolver refuses
    // them all as HOST_HEIGHT_STALE -- a healthy lab, reported stale by a clock
    // that belongs to another chain.
    LAB_OBSERVER_INTERVAL_MS: process.env.LAB_OBSERVER_INTERVAL_MS ?? '4000',
  },
});
child.on('exit', (code) => process.exit(code ?? 1));
