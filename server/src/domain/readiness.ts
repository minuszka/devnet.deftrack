/**
 * Readiness, as opposed to liveness.
 *
 * The health endpoint used to answer `status: 'ok'` unconditionally -- it said
 * "ok" with the RPC unreachable and Mongo disconnected, because every failing
 * probe was swallowed by a `.catch(() => -1)` and the literal was hardcoded.
 * That is worse than no endpoint at all: an uptime check watching it would
 * never fire.
 *
 * Pure on purpose, so the decision can be tested without a database or a node.
 */
export type ReadinessStatus = 'ok' | 'degraded' | 'down';

export interface ReadinessInput {
  mongoConnected: boolean;
  /** -1 when the RPC did not answer. */
  chainTip: number;
  /** -1 when nothing has been indexed yet. */
  indexedHeight: number;
  /** Last error the sync loop recorded, if any. */
  syncError: string | null;
  /** When the indexer last advanced; null if it never has. */
  lastSyncedAtMs: number | null;
  nowMs: number;
  syncIntervalMs: number;
}

export interface Readiness {
  status: ReadinessStatus;
  httpStatus: 200 | 503;
  /** Which probes failed, in the order they were checked. */
  failing: string[];
}

/**
 * How many sync intervals may pass with the indexer behind before it counts as
 * stalled rather than busy. Catching up on a fresh chain legitimately takes a
 * long time, so being behind is not by itself a fault -- being behind and not
 * moving is.
 */
const STALL_INTERVALS = 10;
const MIN_STALL_MS = 5 * 60_000;

export function evaluateReadiness(input: ReadinessInput): Readiness {
  const failing: string[] = [];

  if (!input.mongoConnected) failing.push('mongo');
  if (input.chainTip < 0) failing.push('rpc');
  if (input.syncError) failing.push('sync');

  const behind = input.chainTip >= 0 ? Math.max(0, input.chainTip - input.indexedHeight) : 0;
  const stallAfterMs = Math.max(MIN_STALL_MS, input.syncIntervalMs * STALL_INTERVALS);
  const idleMs = input.lastSyncedAtMs === null ? Infinity : input.nowMs - input.lastSyncedAtMs;
  if (behind > 0 && idleMs > stallAfterMs) failing.push('sync-stalled');

  if (failing.length === 0) return { status: 'ok', httpStatus: 200, failing };

  // "down" is reserved for a dependency being unreachable; a lagging indexer
  // still serves correct, merely older, data.
  const down = failing.includes('mongo') || failing.includes('rpc');
  return { status: down ? 'down' : 'degraded', httpStatus: 503, failing };
}
