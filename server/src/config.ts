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
  },

  quorum: {
    // A DKG round is 72 blocks (~3 h). Polling every two minutes is far more
    // often than needed, and keeps the observation window from ever lapsing.
    intervalMs: optionalNumber('QUORUM_POLL_INTERVAL_MS', 120_000),
  },
} as const;
