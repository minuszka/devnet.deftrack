import { describe, expect, it } from 'vitest';
import { LLMQ_PROFILES } from '../config/llmq.js';
import {
  DEVNET_ENABLED_PROFILE_NAMES,
  canPunishAtSize,
  coincidenceWindows,
  isInMiningWindow,
  nextCoincidentHeight,
  punishingProfilesAtHeight,
} from './dkgCoincidence.js';

// The devnet's real size since the fleet grew.
const N = 152;

const windowsFor = (names: string[], fromHeight: number, toHeight: number) =>
  coincidenceWindows({ masternodeCount: N, fromHeight, toHeight, profileNames: names });

describe('isInMiningWindow', () => {
  it('reproduces IsMiningPhase: cycleStart + start <= h <= cycleStart + end, both inclusive', () => {
    const p = LLMQ_PROFILES.llmq_50_60!; // interval 24, window [10,18]
    expect(isInMiningWindow(p, 9)).toBe(false);
    expect(isInMiningWindow(p, 10)).toBe(true);
    expect(isInMiningWindow(p, 18)).toBe(true);
    expect(isInMiningWindow(p, 19)).toBe(false);
    expect(isInMiningWindow(p, 24 + 10)).toBe(true);
    expect(isInMiningWindow(p, 24 + 19)).toBe(false);
  });

  it('is keyed on the cycle the height falls in, not on the cycle start alone', () => {
    const p = LLMQ_PROFILES.llmq_400_60!; // interval 72, window [20,28]
    expect(isInMiningWindow(p, 72)).toBe(false); // a cycle START is not a mining block
    expect(isInMiningWindow(p, 72 + 20)).toBe(true);
    expect(isInMiningWindow(p, 72 + 28)).toBe(true);
    expect(isInMiningWindow(p, 72 + 29)).toBe(false);
  });
});

describe('canPunishAtSize', () => {
  it('excludes a profile that can only ever mine a null commitment', () => {
    // llmq_400_85 needs minSize 350 against at most 152 masternodes: it overlaps
    // on paper and punishes nobody in fact.
    expect(canPunishAtSize(LLMQ_PROFILES.llmq_400_85!, N)).toBe(false);
    expect(canPunishAtSize(LLMQ_PROFILES.llmq_100_67!, N)).toBe(true); // min(100,152) = 100 >= 80
    expect(canPunishAtSize(LLMQ_PROFILES.llmq_defcon!, N)).toBe(true); // min(60,152) = 60 >= 44
    // At the old fleet size 100_67 was exactly marginal and defcon still formed.
    expect(canPunishAtSize(LLMQ_PROFILES.llmq_100_67!, 80)).toBe(true); // min(100,80) = 80 >= 80
    expect(canPunishAtSize(LLMQ_PROFILES.llmq_100_67!, 79)).toBe(false);
  });
});

describe('coincidence is a property of mining windows, not cycle starts', () => {
  it('llmq_50_60 and llmq_400_60 NEVER share a block, though they share a cycle start every 72', () => {
    // 400_60's window residues mod 24 are {20,21,22,23,0,1,2,3,4}, which never
    // meets 50_60's {10..18}. The intersection is empty -- not "ten blocks apart".
    expect(windowsFor(['llmq_50_60', 'llmq_400_60'], 0, 5_000)).toEqual([]);
    // ...while their cycle starts genuinely do coincide, which is the trap.
    expect(720 % 24).toBe(0);
    expect(720 % 72).toBe(0);
  });

  it('llmq_60_75 and llmq_400_60 coincide across the whole [144k+20, 144k+28] band', () => {
    const found = windowsFor(['llmq_60_75', 'llmq_400_60'], 0, 500);
    expect(found.map((w) => [w.fromHeight, w.toHeight])).toEqual([
      [20, 28], [164, 172], [308, 316], [452, 460],
    ]);
    // Keying a preset on the first block alone would discard 8 of every 9 heights.
    expect(found[0]!.toHeight - found[0]!.fromHeight + 1).toBe(9);
    expect(found.every((w) => w.fromHeight % 144 === 20)).toBe(true);
  });

  it('llmq_50_60 and llmq_60_75 coincide at 34, 35 and 36 mod 48', () => {
    const found = windowsFor(['llmq_50_60', 'llmq_60_75'], 0, 200);
    expect(found.map((w) => [w.fromHeight, w.toHeight])).toEqual([
      [34, 36], [82, 84], [130, 132], [178, 180],
    ]);
    expect(found.every((w) => w.fromHeight % 48 === 34)).toBe(true);
  });
});

describe('the three-way coincidence this chain actually has', () => {
  const trio = ['llmq_50_60', 'llmq_defcon', 'llmq_100_67'];

  it('is [24k+10, 24k+18] once llmq_defcon may form', () => {
    const found = coincidenceWindows({
      masternodeCount: N, fromHeight: 3_100, toHeight: 3_200,
      profileNames: trio, minProfiles: 3,
    });
    expect(found.map((w) => [w.fromHeight, w.toHeight])).toEqual([
      [3_130, 3_138], [3_154, 3_162], [3_178, 3_186],
    ]);
  });

  it('is only two-way below the formation gate -- defcon cannot be in it', () => {
    const below = coincidenceWindows({
      masternodeCount: N, fromHeight: 3_000, toHeight: 3_119,
      profileNames: trio, minProfiles: 2,
    });
    expect(below.every((w) => !w.profileNames.includes('llmq_defcon'))).toBe(true);
    expect(below.every((w) => w.profileNames.length === 2)).toBe(true);
  });

  it('never includes llmq_400_85, which cannot reach minSize here', () => {
    const all = coincidenceWindows({
      masternodeCount: N, fromHeight: 3_120, toHeight: 4_000,
      profileNames: DEVNET_ENABLED_PROFILE_NAMES,
    });
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((w) => !w.profileNames.includes('llmq_400_85'))).toBe(true);
  });
});

describe('nextCoincidentHeight', () => {
  it('names the next eligible height, which is what an anchor gate refuses with', () => {
    const trio = ['llmq_50_60', 'llmq_defcon', 'llmq_100_67'];
    expect(nextCoincidentHeight({ masternodeCount: N, fromHeight: 3_120, searchBlocks: 200, profileNames: trio })).toBe(3_130);
    // Already inside a band: the answer is the current height, not the next band.
    expect(nextCoincidentHeight({ masternodeCount: N, fromHeight: 3_135, searchBlocks: 200, profileNames: trio })).toBe(3_135);
    // A pair that never coincides has no next height at all.
    expect(nextCoincidentHeight({
      masternodeCount: N, fromHeight: 0, searchBlocks: 5_000,
      profileNames: ['llmq_50_60', 'llmq_400_60'],
    })).toBeNull();
  });
});

describe('punishingProfilesAtHeight', () => {
  it('applies all three filters: window, formation gate and minSize', () => {
    const at = (height: number) =>
      punishingProfilesAtHeight({ height, masternodeCount: N, profileNames: DEVNET_ENABLED_PROFILE_NAMES })
        .map((p) => p.llmqName)
        .sort();
    expect(at(3_130)).toEqual(['llmq_100_67', 'llmq_50_60', 'llmq_defcon']);
    // Below the defcon gate. 60_75 is here too: 3106 mod 48 = 34, which is exactly
    // the 50_60 x 60_75 residue asserted above -- a reminder that "the trio" is a
    // property of the height, not a fixed cast.
    expect(at(3_106)).toEqual(['llmq_100_67', 'llmq_50_60', 'llmq_60_75']);
    expect(at(3_125)).toEqual([]); // between windows: nobody mines here
  });
});
