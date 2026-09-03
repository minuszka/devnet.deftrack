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
  },
});
child.on('exit', (code) => process.exit(code ?? 1));
