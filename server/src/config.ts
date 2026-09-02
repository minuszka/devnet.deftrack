import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} is not a number: ${raw}`);
  return parsed;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

function optionalInteger(name: string, fallback: number, min: number, max: number): number {
  const value = optionalNumber(name, fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Environment variable ${name} must be an integer between ${min} and ${max}: ${value}`);
  }
  return value;
}

function optionalEnum<const T extends readonly string[]>(
  name: string,
  values: T,
  fallback: T[number]
): T[number] {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!values.includes(raw)) {
    throw new Error(`Environment variable ${name} must be one of: ${values.join(', ')}`);
  }
  return raw as T[number];
}

/**
 * Nothing here has a default that points anywhere real. A missing variable is
 * a startup error, not a silent fallback to a production host.
 */
export const config = {
  env: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '127.0.0.1',
  port: optionalNumber('PORT', 4100),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),

  mongoUri: required('MONGODB_URI'),

  // Empty means the admin routes refuse service; an unset secret must fail
  // closed rather than quietly disable the check.
  adminApiKey: process.env.ADMIN_API_KEY ?? '',

  simulator: {
    // The API key authenticates a machine/CLI. Actor and role are configured
    // server-side so a caller cannot self-assert safety-admin in a header.
    adminActorId: process.env.SIMULATION_ADMIN_ACTOR_ID ?? 'admin-api-key',
    adminRole: optionalEnum(
      'SIMULATION_ADMIN_ROLE',
      ['operator', 'safety-admin'] as const,
      'operator'
    ),
    expectedChain: process.env.SIMULATION_EXPECTED_CHAIN ?? '',
    expectedGenesisHash: process.env.SIMULATION_EXPECTED_GENESIS_HASH ?? '',
    expectedWrapperVersion: process.env.SIMULATION_EXPECTED_WRAPPER_VERSION ?? '',

    // The live lab executor is off unless explicitly enabled AND given a wrapper
    // command directory. Off, the control slots stay fail-closed; there is no
    // default that could reach a host. It acts only on the local Docker lab.
    labExecutorEnabled: optionalBool('SIMULATION_LAB_EXECUTOR_ENABLED', false),
    labWrapperCommandDir: process.env.SIMULATION_LAB_WRAPPER_COMMANDS ?? '',
    // Where the node-local wrapper publishes its heartbeat. Empty means the live
    // preflight has no recovery evidence and a live run fails recovery-ready --
    // fail-closed, and now for the true reason.
    labWrapperHeartbeatPath: process.env.SIMULATION_LAB_WRAPPER_HEARTBEAT ?? '',
    labDockerBin: process.env.SIMULATION_LAB_DOCKER_BIN ?? 'docker',
  },

  // The simulator lab runs as its own process against its own database. There is
  // no default connection string on purpose: a default is how the lab would
  // silently inherit the explorer's. See domain/labIsolation.
  lab: {
    mongoUri: process.env.LAB_MONGODB_URI ?? '',
    host: process.env.LAB_HOST ?? '127.0.0.1',
    port: optionalNumber('LAB_PORT', 4200),
    // ops/lab-observer.mjs defaults its LAB_API to this same port. They disagreed
    // once (4200 here, 4210 there) and the observer silently reached nothing.
  },

  rpc: {
    host: process.env.RPC_HOST ?? '127.0.0.1',
    port: optionalNumber('RPC_PORT', 0),
    user: process.env.RPC_USER ?? '',
    pass: process.env.RPC_PASS ?? '',
    timeoutMs: optionalNumber('RPC_TIMEOUT_MS', 10_000),
  },

  sync: {
    enabled: optionalBool('SYNC_ENABLED', true),
    intervalMs: optionalNumber('SYNC_INTERVAL_MS', 20_000),
    // How many blocks one pass may ingest. Bounded so a cold start cannot hold
    // the event loop for minutes on end.
    batchSize: optionalNumber('SYNC_BATCH_SIZE', 200),
    // Enough parallelism to hide RPC latency without flooding the node. The
    // HTTP agent is capped at 16 sockets, so this can never grow unbounded.
    txConcurrency: optionalInteger('SYNC_TX_CONCURRENCY', 6, 1, 16),
  },

  masternode: {
    // PoSe penalty decays one per block (~150 s here), so a minute of
    // resolution captures every transition without missing a step.
    intervalMs: optionalNumber('MN_POLL_INTERVAL_MS', 60_000),
  },

  stake: {
    // consensus.stakeValueRange on this devnet (chainparams.cpp:572). An output
    // outside it can never stake, whatever its age, so it is not a payout
    // script and not worth a lookup.
    minValue: optionalNumber('STAKE_MIN_VALUE', 10_000),
    maxValue: optionalNumber('STAKE_MAX_VALUE', 12_500_000),
  },

  ingest: {
    // Shared by every host agent, so it is the credential most likely to leak.
    // Empty disables the endpoint outright rather than leaving it open.
    token: process.env.INGEST_TOKEN ?? '',
  },

  zmq: {
    // Empty disables the listener entirely; the poller then carries the
    // measurement on its own, at its own coarser resolution.
    endpoint: process.env.ZMQ_ENDPOINT ?? '',
  },

  chainlock: {
    // Fast fallback when ZMQ is disabled. This is a sighting interval, not the
    // precision of ZMQ event timestamps.
    intervalMs: optionalNumber('CHAINLOCK_POLL_INTERVAL_MS', 10_000),
    // With ZMQ enabled this is only a safety net for subscriber downtime or a
    // sequence gap. Event-time processing itself is triggered immediately.
    reconcileIntervalMs: optionalNumber('CHAINLOCK_RECONCILE_INTERVAL_MS', 5 * 60_000),
  },

  quorum: {
    // A DKG round is 72 blocks (~3 h). Polling every two minutes is far more
    // often than needed, and keeps the observation window from ever lapsing.
    intervalMs: optionalNumber('QUORUM_POLL_INTERVAL_MS', 120_000),
  },

  dsl: {
    // The DSL shadow's consensus parameters on this devnet, kept in config the
    // same way LLMQ profile parameters are: declared, never inferred from the
    // chain. dslactivationheight is a devnet startup argument, so the chain
    // cannot be asked for it. 0 disables the collector entirely (a network
    // without the DSL build would otherwise accrue absent rows that mean
    // nothing). The default mirrors the devnet's current dslactivationheight;
    // DSL_ACTIVATION_HEIGHT overrides it per deployment and is the source of
    // truth. It was brought forward 6240 -> 5472 with defcon#149 (first
    // commitment 5496); a stale default here would make the indexer skip the
    // real early commitments, so it must track the on-chain value.
    activationHeight: optionalNumber('DSL_ACTIVATION_HEIGHT', 5472),
    epochInterval: optionalNumber('DSL_EPOCH_INTERVAL', 24),
  },
} as const;
