export function chainLockRpcIntervalMs(
  zmqEnabled: boolean,
  pollIntervalMs: number,
  reconcileIntervalMs: number
): number {
  return zmqEnabled ? reconcileIntervalMs : pollIntervalMs;
}

export function shouldCollectMasternodes(input: {
  height: number;
  lastHeight: number | null;
  nowMs: number;
  lastCollectedAtMs: number;
  heartbeatMs: number;
}): boolean {
  return input.height !== input.lastHeight || input.nowMs - input.lastCollectedAtMs >= input.heartbeatMs;
}

export function shouldRefreshRound(
  round: { status: 'pending' | 'formed' | 'failed' | 'impossible'; detailsComplete?: boolean } | undefined
): boolean {
  if (!round) return true;
  if (round.status === 'pending') return true;
  return round.status === 'formed' && round.detailsComplete !== true;
}

/**
 * When a backfill asks again after a refusal: five minutes, doubling, capped
 * at a day. Shared by the payee and the member-count backfills, so a row the
 * node cannot answer costs one question a day, not one a pass.
 */
export function backfillRetryDelayMs(attempt: number): number {
  return Math.min(24 * 60 * 60_000, 5 * 60_000 * 2 ** Math.min(8, Math.max(0, attempt - 1)));
}
/** The payee backfill was the first user of the schedule and still calls it by this name. */
export const payeeRetryDelayMs = backfillRetryDelayMs;
