import { describe, expect, it } from 'vitest';
import { LLMQ_PROFILES, TRACKED_PROFILE_NAMES, maxPossibleBan, trackedProfiles } from './llmq.js';

describe('llmq profile registry', () => {
  it('tracks every quorum type this devnet forms', () => {
    // Observed commitments carry llmqType 1, 2 and 5. Tracking a subset is how
    // failed rounds of the untracked types became invisible: no commitment is
    // mined for them, so the reconstructed schedule is the only witness.
    expect(trackedProfiles().map((p) => p.llmqType).sort()).toEqual([1, 2, 5]);
  });

  it('gives each tracked profile a distinct llmqType', () => {
    // roundKey is `${llmqType}:${expectedHeight}:${quorumIndex}` and is the
    // unique index. Two profiles sharing a type would collide on every height
    // they have in common -- and 72 is a multiple of 24, so they would.
    const types = trackedProfiles().map((p) => p.llmqType);
    expect(new Set(types).size).toBe(types.length);
  });

  it('carries the parameters params.h defines, not rounded ones', () => {
    // Copied from src/llmq/params.h at v22.1.4. A wrong dkgInterval does not
    // fail loudly: it reconstructs a schedule of rounds that never existed and
    // reports every one of them as a failure.
    expect(LLMQ_PROFILES.llmq_50_60).toMatchObject({
      llmqType: 1,
      size: 50,
      minSize: 3,
      threshold: 3,
      dkgInterval: 24,
      dkgMiningWindowEnd: 18,
      useRotation: false,
    });
    expect(LLMQ_PROFILES.llmq_60_75).toMatchObject({
      llmqType: 5,
      size: 60,
      minSize: 3,
      dkgInterval: 48,
      dkgMiningWindowEnd: 36,
      useRotation: false,
    });
    expect(LLMQ_PROFILES.llmq_400_60).toMatchObject({
      llmqType: 2,
      size: 400,
      minSize: 4,
      dkgInterval: 72,
      dkgMiningWindowEnd: 28,
      useRotation: false,
    });
  });

  it('names every tracked profile in the registry', () => {
    for (const name of TRACKED_PROFILE_NAMES) {
      expect(LLMQ_PROFILES[name], `${name} is tracked but not defined`).toBeDefined();
    }
  });

  it('reports the punishment ceiling from the effective size, not the profile size', () => {
    // With 80 masternodes a llmq_400_60 round has 80 members, not 400, so the
    // ceiling is 80 - 4. Using the profile size would claim a round could
    // punish 396 nodes that were never in it.
    expect(maxPossibleBan(80, 4)).toBe(76);
    expect(maxPossibleBan(2, 3)).toBe(0);
  });
});
