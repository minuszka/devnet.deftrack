import { describe, expect, it } from 'vitest';
import { churnPredecessorKey, membershipChurn, type ChurnRoundLike } from './membershipChurn.js';

const mn = (n: number) => ({ proTxHash: `protx-${n}` });
const ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => mn(from + i));

function round(over: Partial<ChurnRoundLike> = {}): ChurnRoundLike {
  return {
    expectedHeight: 5_904,
    dkgInterval: 72,
    effectiveSize: 152,
    members: ids(1, 152),
    invalidMembers: [],
    ...over,
  };
}

describe('quorum round membership churn', () => {
  it('names the predecessor by schedule, not by scanning for one', () => {
    const churn = membershipChurn(round(), null);
    expect(churn.previousExpectedHeight).toBe(5_832);
    expect(churn.previousEffectiveSize).toBeNull();
    expect(churn.punishmentExplainedByJoiners).toBe(false);
  });

  it('explains the devnet round that read as a catastrophe and was not', () => {
    // llmq_400_60 sat at 80 members for days at health 1.00, then the roland
    // fleet became eligible again after a firewall fix and a revive: 80 -> 152
    // in one step, 59 marked bad, and the next round of the same profile closed
    // at 1.00 with 58 of those same 59 valid.
    const previous = round({
      expectedHeight: 5_832,
      effectiveSize: 80,
      members: ids(1, 80),
    });
    const current = round({
      effectiveSize: 152,
      members: ids(1, 152),
      invalidMembers: ids(81, 59).map((m) => m.proTxHash),
    });

    const churn = membershipChurn(current, previous);
    expect(churn.previousEffectiveSize).toBe(80);
    expect(churn.membershipDelta).toBe(72);
    expect(churn.joined).toBe(72);
    expect(churn.left).toBe(0);
    expect(churn.punishedJoiners).toBe(59);
    expect(churn.punishmentExplainedByJoiners).toBe(true);
  });

  it('will not blame the newcomers when an incumbent was punished too', () => {
    const previous = round({ expectedHeight: 5_832, effectiveSize: 80, members: ids(1, 80) });
    const current = round({
      invalidMembers: [...ids(81, 58), mn(7)].map((m) => m.proTxHash),
    });

    const churn = membershipChurn(current, previous);
    expect(churn.punishedJoiners).toBe(58);
    // 59 punished, 58 of them new: one incumbent failed, so the round is saying
    // something about the network and must not be waved away.
    expect(churn.punishmentExplainedByJoiners).toBe(false);
  });

  it('treats a failed predecessor as no evidence rather than as a full turnover', () => {
    // A failed round mines no commitment, so it carries no member list. Reading
    // that emptiness as "every member is new" would mark the next round --
    // whatever it punished -- as explained, which is the exact false clearance
    // this module exists to prevent.
    const failed = round({
      expectedHeight: 5_832,
      effectiveSize: null,
      members: [],
      invalidMembers: [],
    });
    const current = round({ invalidMembers: ids(1, 59).map((m) => m.proTxHash) });

    const churn = membershipChurn(current, failed);
    expect(churn.previousEffectiveSize).toBeNull();
    expect(churn.membershipDelta).toBeNull();
    expect(churn.joined).toBeNull();
    expect(churn.punishedJoiners).toBeNull();
    expect(churn.punishmentExplainedByJoiners).toBe(false);
  });

  it('catches a rotation that a size threshold would miss', () => {
    // Same size before and after, so membershipDelta is 0 -- and yet 20 members
    // are in their first session and every punished member is one of them.
    const previous = round({ expectedHeight: 5_832, effectiveSize: 60, members: ids(1, 60) });
    const current = round({
      effectiveSize: 60,
      members: [...ids(1, 40), ...ids(101, 20)],
      invalidMembers: ids(101, 12).map((m) => m.proTxHash),
    });

    const churn = membershipChurn(current, previous);
    expect(churn.membershipDelta).toBe(0);
    expect(churn.joined).toBe(20);
    expect(churn.left).toBe(20);
    expect(churn.punishmentExplainedByJoiners).toBe(true);
  });

  it('stays quiet about a healthy round however much the membership moved', () => {
    const previous = round({ expectedHeight: 5_832, effectiveSize: 80, members: ids(1, 80) });
    const churn = membershipChurn(round({ invalidMembers: [] }), previous);
    expect(churn.joined).toBe(72);
    // Nothing was punished, so there is nothing to explain and no warning to give.
    expect(churn.punishmentExplainedByJoiners).toBe(false);
  });

  it('keys a predecessor the same way the batch query and its map do', () => {
    expect(churnPredecessorKey('llmq_400_60', 5_832)).toBe('llmq_400_60:5832');
  });
});
