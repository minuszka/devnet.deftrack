import { describe, expect, it } from 'vitest';
import { roundStats, type RoundLike } from './roundStats.js';

const r = (
  status: RoundLike['status'],
  healthRatio: number | null = null,
  invalidMembers: string[] = []
): RoundLike => ({ status, healthRatio, invalidMembers });

describe('round statistics', () => {
  it('excludes pending rounds from the formation rate', () => {
    // A round still inside its mining window has not failed, and counting it
    // as one reports a failure the network never had.
    const s = roundStats([r('formed', 1), r('failed'), r('pending')]);
    expect(s.rounds).toEqual({ formed: 1, failed: 1, pending: 1 });
    expect(s.formationRate).toBe(0.5);
  });

  it('says nothing rather than zero when no round has decided', () => {
    expect(roundStats([r('pending')]).formationRate).toBeNull();
    expect(roundStats([]).formationRate).toBeNull();
  });

  it('takes the median and worst health from formed rounds only', () => {
    // A failed round has no health ratio to contribute; treating its absence
    // as zero would drag the median down for a round that had no members.
    const s = roundStats([r('formed', 1), r('formed', 0.16), r('formed', 0.32), r('failed')]);
    expect(s.medianHealthRatio).toBeCloseTo(0.32, 6);
    expect(s.worstHealthRatio).toBeCloseTo(0.16, 6);
  });

  it('averages the middle pair when the count is even', () => {
    const s = roundStats([r('formed', 0.2), r('formed', 0.4)]);
    expect(s.medianHealthRatio).toBeCloseTo(0.3, 6);
  });

  it('does not let a pending round break a failure streak', () => {
    // The round has not resolved, so it is evidence of neither outcome.
    const s = roundStats([r('failed'), r('pending'), r('failed'), r('formed', 1)]);
    expect(s.longestFailureStreak).toBe(2);
  });

  it('ends a streak at the first formed round', () => {
    const s = roundStats([r('failed'), r('failed'), r('formed', 1), r('failed')]);
    expect(s.longestFailureStreak).toBe(2);
  });

  it('counts a member punished in two rounds once', () => {
    // The question is how many masternodes were hit, not how many times.
    const s = roundStats([r('formed', 0.5, ['a', 'b']), r('formed', 0.5, ['a', 'c'])]);
    expect(s.membersPunished).toBe(3);
  });
});
