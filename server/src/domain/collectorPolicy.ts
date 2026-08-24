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
  round: { status: 'pending' | 'formed' | 'failed'; detailsComplete?: boolean } | undefined
): boolean {
  if (!round) return true;
  if (round.status === 'pending') return true;
  return round.status === 'formed' && round.detailsComplete !== true;
}

export function payeeRetryDelayMs(attempt: number): number {
  return Math.min(24 * 60 * 60_000, 5 * 60_000 * 2 ** Math.min(8, Math.max(0, attempt - 1)));
}
