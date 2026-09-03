#!/usr/bin/env node
/**
 * Starts the lab server against the running regtest lab.
 *
 * The node authenticates with a cookie that is regenerated on every restart, so
 * hand-copied RPC credentials go stale exactly when the lab is rebuilt -- and a
 * stale credential presents as an unreachable node, not as an auth error worth
 * reading. This reads the live cookie from the container and hands it over.
 *
 * It also pins the lab's own database. There is deliberately no default for it
 * in config: a default is how the lab would silently inherit the explorer's
 * connection and write the devnet record.
 *
 *   node ops/lab-serve.mjs
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { LAB_WRAPPER_VERSION, labPaths, labSecret } from './lab-paths.mjs';
import { cookieOf, docker, endpointOf, rpc } from './lab-rpc.mjs';
import { llmqProfileOverridesFor } from '../server/dist/simulator/labCompose.js';
import { readFileSync as readLabFile } from 'node:fs';

/**
 * The topology this lab is actually running, read back from the generated
 * compose rather than re-derived.
 *
 * The compose is the artefact the containers were started from, so it is the one
 * thing that cannot disagree with them. `llmqTestParams` is stripped from the
 * document itself (Compose rejects unknown keys), so it is recovered from the
 * arguments the nodes carry -- which is where it ended up.
 */
function labSpec() {
  const file = process.env.LAB_COMPOSE_FILE ?? 'lab-compose.yml';
  const parsed = JSON.parse(readLabFile(file, 'utf8'));
  const command = Object.values(parsed.services ?? {})[0]?.command ?? [];
  const arg = command.find((entry) => String(entry).startsWith('-llmqtestparams='));
  if (arg === undefined) return { llmqTestParams: null };
  const [size, threshold] = String(arg).split('=')[1].split(':').map(Number);
  return { llmqTestParams: { size, threshold } };
}

const WALLET_NODE = process.env.LAB_RPC_CONTAINER ?? 'mn01';
const LAB_PORT = process.env.LAB_PORT ?? '4210';
const LAB_MONGO = process.env.LAB_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/deftrack_lab';

/**
 * The explorer's own connection string, which this process never opens.
 *
 * It is required because the isolation guard proves the lab's database differs
 * from the explorer's, and a guard given a placeholder to compare against would
 * pass while the lab wrote straight into the devnet record. So there is no
 * default and no invented value: without the real one, the lab does not start.
 */
const EXPLORER_MONGO = process.env.MONGODB_URI;
if (EXPLORER_MONGO === undefined || EXPLORER_MONGO === '') {
  console.error(
    'MONGODB_URI must name the explorer database this lab must stay out of; the isolation guard compares against it, and without it there is nothing to prove.'
  );
  process.exit(1);
}

const [user, pass] = cookieOf(WALLET_NODE).split(':');
const rpcPort = new URL(endpointOf(WALLET_NODE)).port;
const project = docker(['inspect', '-f', '{{index .Config.Labels "com.docker.compose.project"}}', WALLET_NODE]);

mkdirSync(labPaths.commandDir, { recursive: true });

const adminKey = process.env.ADMIN_API_KEY ?? labSecret('admin-key');
const ingestToken = process.env.INGEST_TOKEN ?? labSecret('ingest-token');

/**
 * The chain identity the run records and refuses to act against if it changes.
 *
 * Taken from the running lab rather than configured, and that limit is worth
 * stating: it cannot prove this is the lab you meant, only that the chain has
 * not been swapped underneath a run -- which is the failure that actually
 * happens here, since rebuilding the lab wipes its volumes and mints a new
 * genesis while the server keeps running. The chain NAME is checked separately
 * and for real, by the isolation guard in labServer.
 */
const genesisHash = await rpc(WALLET_NODE, 'getblockhash', [0]);
const chain = (await rpc(WALLET_NODE, 'getblockchaininfo')).chain;

const child = spawn(process.execPath, ['dist/labServer.js'], {
  cwd: 'server',
  stdio: 'inherit',
  env: {
    ...process.env,
    MONGODB_URI: EXPLORER_MONGO,
    ADMIN_API_KEY: adminKey,
    INGEST_TOKEN: ingestToken,
    LAB_MONGODB_URI: LAB_MONGO,
    LAB_PORT,
    RPC_HOST: '127.0.0.1',
    RPC_PORT: rpcPort,
    RPC_USER: user,
    RPC_PASS: pass,
    SIMULATION_LAB_EXECUTOR_ENABLED: 'true',
    // Only containers in the lab's own Compose project may be acted on: without
    // this, anything else sharing the Docker host could be named in a target
    // declaration and then stopped.
    SIMULATION_LAB_CONTAINER_PROJECT: project,
    // Node 1 publishes block and ChainLock notifications; this is what turns them
    // into arrival times. Without it a report can never judge anything, because
    // `firstSeenAt` has no other source.
    ZMQ_ENDPOINT: process.env.ZMQ_ENDPOINT ?? 'tcp://127.0.0.1:28332',
    SIMULATION_EXPECTED_CHAIN: chain,
    SIMULATION_EXPECTED_GENESIS_HASH: genesisHash,
    // Shared with ops/lab-wrapper.mjs, which is what actually applies them.
    SIMULATION_LAB_WRAPPER_COMMANDS: labPaths.commandDir,
    SIMULATION_LAB_WRAPPER_HEARTBEAT: labPaths.heartbeatPath,
    SIMULATION_EXPECTED_WRAPPER_VERSION: LAB_WRAPPER_VERSION,
    // The lab chain forms llmq_test and nothing else. Left at the devnet default
    // the collector reconstructs schedules for profiles this chain never runs.
    // The collectors poll on devnet cadences -- 20 s of sync against 2.5-minute
    // blocks. A lab mines every few seconds, so those defaults leave the indexer
    // permanently a block behind and explorer-synced fails at lag=1 on a lab that
    // is perfectly healthy. Matched to the lab's own clock, not the devnet's.
    SYNC_INTERVAL_MS: process.env.SYNC_INTERVAL_MS ?? '1500',
    MN_POLL_INTERVAL_MS: process.env.MN_POLL_INTERVAL_MS ?? '10000',
    QUORUM_POLL_INTERVAL_MS: process.env.QUORUM_POLL_INTERVAL_MS ?? '15000',
    // What the nodes were actually started with, derived from the same topology
    // the compose was generated from. No RPC returns these numbers, so without
    // this the explorer would record the built-in defaults on every round -- and
    // a campaign comparing two parameter sets would compare neither.
    LLMQ_PROFILE_OVERRIDES: process.env.LLMQ_PROFILE_OVERRIDES ?? llmqProfileOverridesFor(labSpec()),
    TRACKED_LLMQ_NAMES: process.env.TRACKED_LLMQ_NAMES ?? 'llmq_test',
    CHAINLOCK_LLMQ_NAME: process.env.CHAINLOCK_LLMQ_NAME ?? 'llmq_test',
    CHAINLOCK_V2_LLMQ_NAME: process.env.CHAINLOCK_V2_LLMQ_NAME ?? 'llmq_test',
  },
});
child.on('exit', (code) => process.exit(code ?? 1));
