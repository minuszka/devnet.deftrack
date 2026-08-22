/**
 * The reconstructed DKG schedule.
 *
 * This is the load-bearing idea of the whole project. A round that fails to
 * form mines no commitment, so `quorum listextended` never lists it and there
 * is no quorumHash to key a record on -- yet those rounds are precisely what
 * has to be measured. Rather than recording what the node reports, the
 * collector reconstructs when a round was *due* and matches observations
 * against it.
 *
 * Pure arithmetic, deliberately free of config, RPC and database imports so it
 * can be tested on its own.
 */

/**
 * The base height of the round in progress at `tip`.
 *
 * Taken from the node itself (src/rpc/quorums.cpp:320):
 *
 *   quorumHeight = tipHeight - (tipHeight % dkgInterval) + quorumIndex
 */
export function currentRoundHeight(tip: number, dkgInterval: number, quorumIndex = 0): number {
  return tip - (tip % dkgInterval) + quorumIndex;
}

/** Every round height due at or below `tip`, oldest first. */
export function expectedRoundHeights(tip: number, dkgInterval: number): number[] {
  const heights: number[] = [];
  for (let h = 0; h <= tip; h += dkgInterval) heights.push(h);
  return heights;
}

/**
 * Synthetic idempotency key. `quorumHash` cannot serve as one because a round
 * that never formed does not have it.
 */
export function roundKeyFor(llmqType: number, expectedHeight: number, quorumIndex: number): string {
  return `${llmqType}:${expectedHeight}:${quorumIndex}`;
}

/**
 * The height by which a round must have produced a commitment.
 *
 * Before this, absence means "still running", not "failed" -- judging a round
 * early would manufacture failures that never happened.
 */
export function resolvedByHeight(expectedHeight: number, dkgMiningWindowEnd: number): number {
  return expectedHeight + dkgMiningWindowEnd;
}

export type RoundOutcome = 'pending' | 'formed' | 'failed';

export function classifyRound(args: {
  tip: number;
  expectedHeight: number;
  dkgMiningWindowEnd: number;
  commitmentSeen: boolean;
}): RoundOutcome {
  if (args.commitmentSeen) return 'formed';
  return args.tip < resolvedByHeight(args.expectedHeight, args.dkgMiningWindowEnd) ? 'pending' : 'failed';
}
