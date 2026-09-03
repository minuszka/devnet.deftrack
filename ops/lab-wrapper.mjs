#!/usr/bin/env node
/**
 * Runs the node-local fault wrapper against the regtest lab.
 *
 * The lab server enqueues commands; nothing applies them without this. A run
 * armed while it is not running does not fail -- it waits, and the fault it
 * reports as applied never lands.
 *
 *   node ops/lab-wrapper.mjs
 */

import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { LAB_WRAPPER_VERSION, labPaths } from './lab-paths.mjs';

mkdirSync(labPaths.commandDir, { recursive: true });

const child = spawn(process.execPath, ['dist/simulator/netemWrapperMain.js'], {
  cwd: 'server',
  stdio: 'inherit',
  env: {
    ...process.env,
    NETEM_WRAPPER_STATE: labPaths.statePath,
    NETEM_WRAPPER_COMMANDS: labPaths.commandDir,
    NETEM_WRAPPER_HEARTBEAT: labPaths.heartbeatPath,
    NETEM_WRAPPER_VERSION: LAB_WRAPPER_VERSION,
  },
});
child.on('exit', (code) => process.exit(code ?? 1));
