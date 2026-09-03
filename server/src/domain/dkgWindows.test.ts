import { describe, expect, it } from 'vitest';
import { LLMQ_PROFILES } from '../config/llmq.js';
import {
  anchorForNextWindow,
  blocksToGuaranteeWindows,
  contributionWindowFor,
  dkgWindowsCovered,
  dkgWindowsFromAnchor,
} from './dkgWindows.js';

const PROFILE = LLMQ_PROFILES.llmq_50_60!; // interval 24, phase 2

describe('contributionWindowFor', () => {
  it('places the contribution phase at [p, 2p) of the cycle, as the node does', () => {
    // quorumStageInt = height % dkgInterval; phase = stage / dkgPhaseBlocks + 1,
    // so phase 2 (Contribute) is stage 2..3 on a profile with dkgPhaseBlocks 2.
    expect(contributionWindowFor(240, PROFILE)).toEqual({ fromHeight: 242, toHeight: 244 });
    expect(contributionWindowFor(255, PROFILE)).toEqual({ fromHeight: 242, toHeight: 244 });
    expect(contributionWindowFor(264, PROFILE)).toEqual({ fromHeight: 266, toHeight: 268 });
  });
});

describe('dkgWindowsCovered', () => {
  it('guarantees nothing for an outage shorter than a full cycle', () => {
    expect(dkgWindowsCovered(6, PROFILE).guaranteed).toBe(0);
    expect(dkgWindowsCovered(23, PROFILE).guaranteed).toBe(0);
  });

  it('guarantees nothing even for an outage of a FULL interval', () => {
    // The result that decides the design. Windows sit at [24k+2, 24k+4), so an
    // outage of blocks [24m+3, 24m+27) -- a whole interval long -- contains
    // neither the window before it nor the one after. Length alone is not
    // positioning.
    expect(dkgWindowsCovered(24, PROFILE).guaranteed).toBe(0);
    expect(dkgWindowsFromAnchor({ startHeight: 24 * 10 + 3, durationBlocks: 24, profile: PROFILE })).toBe(0);
  });

  it('guarantees one only from interval + phase - 1 blocks', () => {
    expect(dkgWindowsCovered(24, PROFILE).guaranteed).toBe(0);
    expect(dkgWindowsCovered(25, PROFILE).guaranteed).toBe(1);
    expect(blocksToGuaranteeWindows(1, PROFILE)).toBe(25);
    expect(blocksToGuaranteeWindows(2, PROFILE)).toBe(49);
    // The boundary is exact in both directions, which is what makes it a
    // guarantee rather than a rule of thumb.
    for (const windows of [1, 2, 3]) {
      const blocks = blocksToGuaranteeWindows(windows, PROFILE);
      expect(dkgWindowsCovered(blocks, PROFILE).guaranteed).toBe(windows);
      expect(dkgWindowsCovered(blocks - 1, PROFILE).guaranteed).toBe(windows - 1);
    }
  });

  it('reports what an outage could touch at its best alignment', () => {
    // Two blocks placed exactly on a contribution phase touch one window; the
    // same two blocks elsewhere touch none, which is why guaranteed is 0.
    expect(dkgWindowsCovered(2, PROFILE)).toEqual({ guaranteed: 0, possible: 1 });
    expect(dkgWindowsCovered(25, PROFILE).possible).toBe(2);
  });

  it('never reports a negative or fractional count', () => {
    for (const blocks of [0, -5, 1]) {
      const range = dkgWindowsCovered(blocks, PROFILE);
      expect(range.guaranteed).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(range.guaranteed)).toBe(true);
      expect(Number.isInteger(range.possible)).toBe(true);
    }
  });

  it('brackets the anchored count for every alignment', () => {
    // The range must be exactly that: no start height may fall outside it.
    for (const durationBlocks of [2, 5, 24, 26, 49, 50]) {
      const range = dkgWindowsCovered(durationBlocks, PROFILE);
      for (let offset = 0; offset < PROFILE.dkgInterval; offset++) {
        const exact = dkgWindowsFromAnchor({
          startHeight: 1_000 + offset,
          durationBlocks,
          profile: PROFILE,
        });
        expect(exact).toBeGreaterThanOrEqual(range.guaranteed);
        expect(exact).toBeLessThanOrEqual(range.possible);
      }
    }
  });

  it('is reached by SOME alignment, so guaranteed is tight and not merely safe', () => {
    for (const durationBlocks of [2, 24, 26, 49]) {
      const range = dkgWindowsCovered(durationBlocks, PROFILE);
      const counts = Array.from({ length: PROFILE.dkgInterval }, (_, offset) =>
        dkgWindowsFromAnchor({ startHeight: 1_000 + offset, durationBlocks, profile: PROFILE })
      );
      expect(Math.min(...counts)).toBe(range.guaranteed);
    }
  });
});

describe('anchorForNextWindow', () => {
  it('costs one phase of outage to miss one window, not a whole interval', () => {
    const anchor = anchorForNextWindow({ notBeforeHeight: 1_000, profile: PROFILE });
    expect(anchor.durationBlocks).toBe(PROFILE.dkgPhaseBlocks);
    expect(dkgWindowsFromAnchor({ ...anchor, profile: PROFILE })).toBe(1);
    // Two blocks against the twenty-six an unanchored run needs for the same
    // guarantee: the anchor is what makes the experiment expressible.
    expect(anchor.durationBlocks).toBeLessThan(blocksToGuaranteeWindows(1, PROFILE));
    expect(blocksToGuaranteeWindows(1, PROFILE)).toBe(25);
  });

  it('never anchors before the height it was told not to start before', () => {
    for (let height = 990; height < 1_030; height++) {
      const anchor = anchorForNextWindow({ notBeforeHeight: height, profile: PROFILE });
      expect(anchor.startHeight).toBeGreaterThanOrEqual(height);
      expect(dkgWindowsFromAnchor({ ...anchor, profile: PROFILE })).toBe(1);
    }
  });
});
