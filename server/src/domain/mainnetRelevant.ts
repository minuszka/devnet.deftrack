/**
 * A run's DKG rounds counted as the v23 mainnet would count them.
 *
 * The devnet forms four profiles and punishes on all of them; mainnet will
 * form two of those. So every "this roll punished N members" figure taken
 * here is pessimistic for mainnet by whatever the devnet-only profiles
 * contributed -- and on 2026-09-10 that was all of it: three members punished,
 * every one in a llmq_50_60 round. This is the same window with the profiles
 * mainnet never runs held out, so a result can be quoted both ways and the
 * reader is told which.
 *
 * Pure, and fed a predicate rather than the registry, so a test can say which
 * profiles count without importing the deployment's table.
 */
import { roundStats, type RoundLike } from './roundStats.js';

export interface MainnetRelevantRound extends RoundLike {
  llmqName: string;
}

export interface MainnetRelevantStats {
  /** The profiles that contributed a round, sorted; empty when none did. */
  profiles: string[];
  rounds: { formed: number; failed: number; pending: number; impossible: number };
  formationRate: number | null;
  medianHealthRatio: number | null;
  worstHealthRatio: number | null;
  /** The worst streak any single counted profile reached, never a blended one. */
  longestFailureStreak: number;
  /**
   * Members marked invalid in the counted profiles' rounds, distinct. Ban and
   * penalty EVENTS are not here: they are network-wide, not per profile, and a
   * ban earned by two llmq_50_60 exclusions cannot be attributed away after the
   * fact.
   */
  membersPunished: number;
}

/**
 * `rounds` must be ordered by height, as computeOutcome reads them, because the
 * streak is taken per profile over that order.
 */
export function mainnetRelevantStats(
  rounds: readonly MainnetRelevantRound[],
  formsOnMainnet: (llmqName: string) => boolean
): MainnetRelevantStats {
  const kept = rounds.filter((r) => formsOnMainnet(r.llmqName));

  const byName = new Map<string, MainnetRelevantRound[]>();
  for (const r of kept) {
    const list = byName.get(r.llmqName) ?? [];
    list.push(r);
    byName.set(r.llmqName, list);
  }

  const overall = roundStats(kept);
  let longest = 0;
  for (const list of byName.values()) {
    longest = Math.max(longest, roundStats(list).longestFailureStreak);
  }

  return {
    profiles: [...byName.keys()].sort(),
    rounds: overall.rounds,
    formationRate: overall.formationRate,
    medianHealthRatio: overall.medianHealthRatio,
    worstHealthRatio: overall.worstHealthRatio,
    longestFailureStreak: longest,
    membersPunished: overall.membersPunished,
  };
}
