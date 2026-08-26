/**
 * What a set of DKG rounds says, as arithmetic.
 *
 * Pulled out of the experiment service so the same computation serves both the
 * run-wide totals and each quorum type's share of them, and so it can be
 * tested without a database.
 */

export type RoundStatus = 'formed' | 'failed' | 'pending' | 'impossible';

export interface RoundLike {
  status: RoundStatus;
  healthRatio: number | null;
  invalidMembers: readonly string[];
}

export interface RoundStats {
  rounds: { formed: number; failed: number; pending: number; impossible: number };
  /**
   * Excludes pending, which has not resolved, and impossible, which could not
   * resolve: a profile needing more members than the network has cannot form
   * however well every masternode behaves. Counting those as failures reports a
   * fault where the arithmetic did not allow a result.
   */
  formationRate: number | null;
  medianHealthRatio: number | null;
  worstHealthRatio: number | null;
  longestFailureStreak: number;
  /** Members marked invalid, distinct across the rounds given. */
  membersPunished: number;
}

/**
 * `rounds` must be ordered by height and belong to a single profile for
 * `longestFailureStreak` to mean anything: a streak is consecutive failures of
 * the same quorum type, and interleaving two schedules would report a run of
 * failures that neither type ever had.
 */
export function roundStats(rounds: readonly RoundLike[]): RoundStats {
  const formed = rounds.filter((r) => r.status === 'formed');
  const failed = rounds.filter((r) => r.status === 'failed');
  const pending = rounds.filter((r) => r.status === 'pending');
  const impossible = rounds.filter((r) => r.status === 'impossible');

  const ratios = formed
    .map((r) => r.healthRatio)
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b);
  const median = ratios.length
    ? ratios.length % 2 === 1
      ? ratios[(ratios.length - 1) / 2]!
      : (ratios[ratios.length / 2 - 1]! + ratios[ratios.length / 2]!) / 2
    : null;

  let streak = 0;
  let longest = 0;
  for (const r of rounds) {
    if (r.status === 'failed') longest = Math.max(longest, ++streak);
    // Neither a pending round nor an impossible one breaks or extends the
    // streak: one has not resolved, the other was never a chance to.
    else if (r.status === 'formed') streak = 0;
  }

  const punished = new Set<string>();
  for (const r of rounds) for (const m of r.invalidMembers) punished.add(m);

  const decided = formed.length + failed.length;

  return {
    rounds: {
      formed: formed.length,
      failed: failed.length,
      pending: pending.length,
      impossible: impossible.length,
    },
    formationRate: decided > 0 ? formed.length / decided : null,
    medianHealthRatio: median,
    worstHealthRatio: ratios.length ? ratios[0]! : null,
    longestFailureStreak: longest,
    membersPunished: punished.size,
  };
}
