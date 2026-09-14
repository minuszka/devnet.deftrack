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
  /**
   * The sync cursor's `heartbeatAt`: when the indexer last recorded progress --
   * a checkpoint inside a batch, or the end of one -- or last finished a pass
   * that found nothing to index. It says the indexer was working then, not that
   * the rest of that tick succeeded. Null if never written, or for a cursor
   * written before the field existed.
   */
  lastSyncPassAtMs: number | null;
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
  // Idle since the indexer's last recorded activity, not since the last indexed
  // block. A quiet chain moves `lastSyncedAt` only when a block arrives, so
  // measured from it alone every block gap longer than the stall limit read as a
  // stalled indexer for the seconds between the block reaching the node and the
  // next pass: 503 at 10:21Z and 11:31:57Z on the devnet on 2026-09-14. The
  // heartbeat can be fresh in a tick that later fails -- a checkpoint writes it
  // -- but that failure is recorded and fails `sync` above. A pass that hangs,
  // or a tick dropped for overlapping it, writes nothing more, so the last
  // activity ages into `sync-stalled`.
  const lastActiveMs = latest(input.lastSyncedAtMs, input.lastSyncPassAtMs);
  const idleMs = lastActiveMs === null ? Infinity : input.nowMs - lastActiveMs;
  if (behind > 0 && idleMs > stallAfterMs) failing.push('sync-stalled');

  if (failing.length === 0) return { status: 'ok', httpStatus: 200, failing };

  // "down" is reserved for a dependency being unreachable; a lagging indexer
  // still serves correct, merely older, data.
  const down = failing.includes('mongo') || failing.includes('rpc');
  return { status: down ? 'down' : 'degraded', httpStatus: 503, failing };
}

function latest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** The stored sync cursor, as far as readiness reads it. */
export interface SyncCursor {
  lastSyncedHeight: number;
  lastSyncedAt?: Date | null;
  heartbeatAt?: Date | null;
  error?: string | null;
}

/**
 * The readiness input the health endpoint builds from the sync cursor.
 *
 * Kept here, beside the decision, so that which cursor field feeds which input
 * is tested rather than left to the route: the stall above came from reading
 * one timestamp where two were stored.
 */
export function readinessInput(args: {
  mongoConnected: boolean;
  chainTip: number;
  cursor: SyncCursor | null;
  nowMs: number;
  syncIntervalMs: number;
}): ReadinessInput {
  const { cursor } = args;
  return {
    mongoConnected: args.mongoConnected,
    chainTip: args.chainTip,
    indexedHeight: cursor?.lastSyncedHeight ?? -1,
    syncError: cursor?.error ?? null,
    lastSyncedAtMs: cursor?.lastSyncedAt ? new Date(cursor.lastSyncedAt).getTime() : null,
    lastSyncPassAtMs: cursor?.heartbeatAt ? new Date(cursor.heartbeatAt).getTime() : null,
    nowMs: args.nowMs,
    syncIntervalMs: args.syncIntervalMs,
  };
}
