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

/**
 * Nothing here has a default that points anywhere real. A missing variable is
 * a startup error, not a silent fallback to a production host.
 */
export const config = {
  env: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '127.0.0.1',
  port: optionalNumber('PORT', 4100),
  mongoUri: required('MONGODB_URI'),
  rpc: {
    host: process.env.RPC_HOST ?? '127.0.0.1',
    port: optionalNumber('RPC_PORT', 0),
    user: process.env.RPC_USER ?? '',
    pass: process.env.RPC_PASS ?? '',
    timeoutMs: optionalNumber('RPC_TIMEOUT_MS', 10_000),
  },
} as const;
