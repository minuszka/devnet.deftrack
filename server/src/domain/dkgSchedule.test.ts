import { describe, expect, it } from 'vitest';
import {
  absenceIsEvidence,
  classifyRound,
  currentRoundHeight,
  expectedRoundHeights,
  isSchedulable,
  resolvedByHeight,
  retiredObservationHeight,
  roundKeyFor,
} from './dkgSchedule.js';

/**
 * The reconstructed schedule is what makes an invisible failure visible, so it
 * is pinned here against the node's own formula (rpc/quorums.cpp:320) rather
 * than against whatever the implementation happens to do.
 */
describe('DKG round schedule', () => {
  const dkgInterval = 72; // llmq_400_60
  const dkgMiningWindowEnd = 28;

  it('places the current round on the interval boundary at or below the tip', () => {
    // 1656 is 72 * 23 exactly, so the tip is itself a round boundary.
    expect(currentRoundHeight(1656, dkgInterval)).toBe(1656);
    // A tip partway through an interval rounds down to the round in progress.
    expect(currentRoundHeight(1650, dkgInterval)).toBe(1584);
    expect(currentRoundHeight(1655, dkgInterval)).toBe(1584);
  });

  it('stays on the same round for every tip inside one interval', () => {
    const base = 1584;
    for (let offset = 0; offset < dkgInterval; offset++) {
      expect(currentRoundHeight(base + offset, dkgInterval)).toBe(base);
    }
    expect(currentRoundHeight(base + dkgInterval, dkgInterval)).toBe(base + dkgInterval);
  });

  it('starts at genesis and steps by exactly one interval', () => {
    expect(expectedRoundHeights(300, dkgInterval)).toEqual([0, 72, 144, 216, 288]);
  });

  it('never proposes a round above the tip, and ends on the current one', () => {
    for (const tip of [0, 1, 71, 72, 73, 1656]) {
      const heights = expectedRoundHeights(tip, dkgInterval);
      expect(Math.max(...heights)).toBeLessThanOrEqual(tip);
      expect(heights.at(-1)).toBe(currentRoundHeight(tip, dkgInterval));
    }
  });

  it('produces one round per interval with no gaps', () => {
    const tip = 1656;
    const heights = expectedRoundHeights(tip, dkgInterval);
    expect(heights.length).toBe(Math.floor(tip / dkgInterval) + 1);
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]! - heights[i - 1]!).toBe(dkgInterval);
    }
  });

  it('keys a round without needing a quorumHash', () => {
    expect(roundKeyFor(2, 1584, 0)).toBe('2:1584:0');
    expect(roundKeyFor(2, 1584, 0)).not.toBe(roundKeyFor(2, 1656, 0));
    expect(roundKeyFor(2, 1584, 0)).not.toBe(roundKeyFor(101, 1584, 0));
    expect(roundKeyFor(2, 1584, 0)).not.toBe(roundKeyFor(2, 1584, 1));
  });

  it('waits for the mining window before calling a round failed', () => {
    const expectedHeight = 1584;
    expect(resolvedByHeight(expectedHeight, dkgMiningWindowEnd)).toBe(1612);

    // Still inside the window: absence means "running", not "failed".
    for (const tip of [1584, 1600, 1611]) {
      expect(classifyRound({ tip, expectedHeight, dkgMiningWindowEnd, commitmentSeen: false })).toBe('pending');
    }
    // Window closed with no commitment: the round genuinely did not form.
    expect(classifyRound({ tip: 1612, expectedHeight, dkgMiningWindowEnd, commitmentSeen: false })).toBe('failed');
    expect(classifyRound({ tip: 9999, expectedHeight, dkgMiningWindowEnd, commitmentSeen: false })).toBe('failed');
  });

  it('calls a round formed as soon as a commitment is seen, even mid-window', () => {
    expect(
      classifyRound({ tip: 1590, expectedHeight: 1584, dkgMiningWindowEnd, commitmentSeen: true })
    ).toBe('formed');
  });

  it('handles the stock devnet profile interval too', () => {
    expect(expectedRoundHeights(100, 24)).toEqual([0, 24, 48, 72, 96]);
  });
});

describe('evidence reach', () => {
  it('treats a missing commitment as failure only within listextended reach', () => {
    // listextended still reports a quorum created at 2424, so a scheduled round
    // at 2448 with nothing mined genuinely produced nothing.
    expect(absenceIsEvidence(2448, 2424)).toBe(true);
    expect(absenceIsEvidence(2424, 2424)).toBe(true);
  });

  it('refuses to judge a round older than the oldest commitment still reported', () => {
    // ScanQuorums returns only signingActiveQuorumCount quorums per type, so
    // below that boundary absence means "aged out of the RPC", not "failed".
    // A profile tracked for the first time starts mid-window and would
    // otherwise record its oldest scheduled height as a failure that never
    // happened.
    expect(absenceIsEvidence(2400, 2424)).toBe(false);
  });

  it('judges normally when nothing has been observed at all', () => {
    // With no commitment of this type anywhere there is no aged-out boundary to
    // have fallen behind, so absence carries its ordinary meaning.
    expect(absenceIsEvidence(2400, null)).toBe(true);
  });
});

describe('formation gate', () => {
  // llmq_defcon on this devnet: activation 3240, gate 3240 - (4 + 1) * 24.
  const gate = 3120;

  it('leaves heights below the gate out of the schedule entirely', () => {
    // The node refuses to form the type there (IsQuorumTypeEnabledInternal),
    // so no session ever ran: not failed, not impossible -- not a round.
    expect(isSchedulable(3096, gate)).toBe(false);
    expect(isSchedulable(0, gate)).toBe(false);
  });

  it('schedules from the gate height itself -- the first real round', () => {
    // Verified live: the first llmq_defcon commitment on this chain is at 3120.
    expect(isSchedulable(3120, gate)).toBe(true);
    expect(isSchedulable(3144, gate)).toBe(true);
  });

  it('treats profiles without a gate as schedulable everywhere', () => {
    expect(isSchedulable(0)).toBe(true);
    expect(isSchedulable(2856)).toBe(true);
  });
});

describe('formation end', () => {
  // llmq_50_60 / llmq_60_75 on this devnet, retired from one height on both grids.
  const end = 13200;

  it('schedules every round below the end and none from it', () => {
    // The node starts no session for a cycle based at or above the end
    // (IsQuorumTypeEnabledInternal, checked first); the last real cycle is below.
    expect(isSchedulable(end - 24, undefined, end)).toBe(true);
    expect(isSchedulable(end - 48, undefined, end)).toBe(true);
    expect(isSchedulable(end, undefined, end)).toBe(false);
    expect(isSchedulable(end + 24, undefined, end)).toBe(false);
  });

  it('applies gate and end together', () => {
    expect(isSchedulable(100, 120, 240)).toBe(false);
    expect(isSchedulable(120, 120, 240)).toBe(true);
    expect(isSchedulable(216, 120, 240)).toBe(true);
    expect(isSchedulable(240, 120, 240)).toBe(false);
  });

  it('reads a retired profile where the node still listed it', () => {
    // At tip end-2 the profile is enabled for the next block; from tip end-1 the
    // node omits it at the tip, so its last rounds must be read at end-2.
    expect(retiredObservationHeight(end - 2, end)).toBeNull();
    expect(retiredObservationHeight(end - 1, end)).toBe(end - 2);
    expect(retiredObservationHeight(end + 5000, end)).toBe(end - 2);
    expect(retiredObservationHeight(end + 5000, undefined)).toBeNull();
  });

  it('keeps the last cycle below the end inside that read', () => {
    // Its commitment is mined by (end - dkgInterval) + dkgMiningWindowEnd, which
    // must not be later than the height the retired profile is read at.
    for (const [interval, windowEnd] of [
      [24, 18],
      [48, 36],
    ] as const) {
      expect(end - interval + windowEnd).toBeLessThanOrEqual(end - 2);
    }
  });
});
