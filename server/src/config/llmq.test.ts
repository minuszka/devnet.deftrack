import { describe, expect, it } from 'vitest';
import {
  CHAINLOCK_V2_ACTIVATION_HEIGHT,
  LLMQ_PROFILES,
  TRACKED_PROFILE_NAMES,
  chainlockProfileNameAtHeight,
  maxPossibleBan,
  trackedProfiles,
} from './llmq.js';

describe('llmq profile registry', () => {
  it('tracks every quorum type this devnet is observed to form', () => {
    // Commitments exist for llmqType 1, 2, 3 and 5, and since the Q60 consensus
    // change also for 7 (llmq_defcon, first commitment at height 3120). Tracking
    // a subset is how failed rounds of the untracked types became invisible: no
    // commitment is mined for a failed round, so the reconstructed schedule is
    // the only witness it was ever due.
    expect(trackedProfiles().map((p) => p.llmqType).sort()).toEqual([1, 2, 3, 5, 7]);
  });

  it('resolves the ChainLock signer by signed height, one-way at activation', () => {
    // Mirrors llmq::GetChainLocksLLMQType: the boundary is >= activation, so
    // 3239 is the last legacy lock and 3240 the first Q60 one. Getting this
    // off by one would attribute the first Q60 lock to the wrong profile --
    // the exact moment this instrument exists to record.
    expect(CHAINLOCK_V2_ACTIVATION_HEIGHT).toBe(3240);
    expect(chainlockProfileNameAtHeight(0)).toBe('llmq_400_60');
    expect(chainlockProfileNameAtHeight(3239)).toBe('llmq_400_60');
    expect(chainlockProfileNameAtHeight(3240)).toBe('llmq_defcon');
    expect(chainlockProfileNameAtHeight(1_000_000)).toBe('llmq_defcon');
  });

  it('gates the Q60 profile at its formation height and no other profile', () => {
    // IsQuorumTypeEnabledInternal refuses llmq_defcon below
    // activation 3240 - (signingActiveQuorumCount 4 + 1) * dkgInterval 24; the
    // inherited profiles have formed since genesis and carry no gate.
    expect(LLMQ_PROFILES.llmq_defcon?.formationGateHeight).toBe(3120);
    for (const p of trackedProfiles()) {
      if (p.llmqName !== 'llmq_defcon') expect(p.formationGateHeight).toBeUndefined();
    }
  });

  it('knows every enabled type, including the one it does not track', () => {
    // llmq_100_67 is enabled on this devnet but has produced no commitment at
    // any height. It stays in the registry so such a commitment could be named,
    // and out of the tracked set so no schedule is reconstructed for it:
    // absence of evidence that it runs is not evidence that it failed.
    expect(LLMQ_PROFILES.llmq_100_67?.llmqType).toBe(4);
    expect(TRACKED_PROFILE_NAMES).not.toContain('llmq_100_67');
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
    expect(LLMQ_PROFILES.llmq_400_85).toMatchObject({
      llmqType: 3,
      size: 400,
      minSize: 350,
      threshold: 340,
      dkgInterval: 576,
      dkgMiningWindowEnd: 48,
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
