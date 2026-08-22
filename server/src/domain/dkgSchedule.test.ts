import { describe, expect, it } from 'vitest';
import {
  classifyRound,
  currentRoundHeight,
  expectedRoundHeights,
  resolvedByHeight,
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
