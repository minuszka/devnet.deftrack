/**
 * LLMQ profile registry.
 *
 * The node exposes no RPC for these numbers: `quorum listextended` gives
 * numValidMembers and healthRatio, `quorum info` gives the member list, but
 * size / minSize / threshold appear nowhere. They therefore live here, keyed by
 * llmqName, and every round document carries a snapshot of the profile it was
 * observed under -- so a later profile change stays legible in the data instead
 * of silently rewriting history.
 *
 * Values below are copied from src/llmq/params.h at DeFCoN Core v22.1.4
 * (v22.1.x @ 7227180053). When the node is upgraded, re-check them there.
 */
export interface LlmqProfile {
  /** Consensus::LLMQType numeric value. */
  llmqType: number;
  llmqName: string;
  size: number;
  minSize: number;
  threshold: number;
  dkgInterval: number;
  dkgPhaseBlocks: number;
  dkgMiningWindowStart: number;
  dkgMiningWindowEnd: number;
  dkgBadVotesThreshold: number;
  useRotation: boolean;
  signingActiveQuorumCount: number;
}

export const LLMQ_PROFILES: Record<string, LlmqProfile> = {
  llmq_50_60: {
    llmqType: 1,
    llmqName: 'llmq_50_60',
    size: 50,
    minSize: 3,
    threshold: 3,
    dkgInterval: 24, // one DKG per hour at 2.5 min blocks
    dkgPhaseBlocks: 2,
    dkgMiningWindowStart: 10,
    dkgMiningWindowEnd: 18,
    dkgBadVotesThreshold: 3,
    useRotation: false,
    signingActiveQuorumCount: 2,
  },
  llmq_60_75: {
    llmqType: 5,
    llmqName: 'llmq_60_75',
    size: 60,
    minSize: 3,
    threshold: 3,
    dkgInterval: 48, // 24 * 2 -- one DKG every 2 hours
    dkgPhaseBlocks: 2,
    dkgMiningWindowStart: 20,
    dkgMiningWindowEnd: 36,
    dkgBadVotesThreshold: 3,
    useRotation: false,
    signingActiveQuorumCount: 2,
  },
  llmq_400_60: {
    llmqType: 2,
    llmqName: 'llmq_400_60',
    size: 400,
    minSize: 4,
    threshold: 3,
    dkgInterval: 72, // 24 * 3 -- one DKG every 3 hours at 2.5 min blocks
    dkgPhaseBlocks: 4,
    dkgMiningWindowStart: 20,
    dkgMiningWindowEnd: 28,
    dkgBadVotesThreshold: 30,
    useRotation: false,
    signingActiveQuorumCount: 4,
  },
  llmq_devnet: {
    llmqType: 101,
    llmqName: 'llmq_devnet',
    size: 12,
    minSize: 7,
    threshold: 6,
    dkgInterval: 24,
    dkgPhaseBlocks: 2,
    dkgMiningWindowStart: 10,
    dkgMiningWindowEnd: 18,
    dkgBadVotesThreshold: 7,
    useRotation: false,
    signingActiveQuorumCount: 4,
  },
};

/**
 * The profile whose DKG rounds this deployment measures: the ChainLock quorum.
 *
 * chainparams.cpp sets llmqTypeChainLocks = LLMQ_400_60 on this devnet (the
 * mainnet-parity branch), so the tracked profile is the same one mainnet runs.
 */
export const CHAINLOCK_PROFILE_NAME = process.env.CHAINLOCK_LLMQ_NAME ?? 'llmq_400_60';

export function chainlockProfile(): LlmqProfile {
  const profile = LLMQ_PROFILES[CHAINLOCK_PROFILE_NAME];
  if (!profile) {
    throw new Error(
      `Unknown LLMQ profile "${CHAINLOCK_PROFILE_NAME}"; known: ${Object.keys(LLMQ_PROFILES).join(', ')}`
    );
  }
  return profile;
}

/**
 * Every profile whose DKG schedule is reconstructed.
 *
 * Not just the ChainLock one. A round that fails mines no commitment, so the
 * only way it is ever visible is that the schedule expected it and nothing
 * arrived -- and that reconstruction has to exist per profile or the failure is
 * simply absent from the record. Tracking only llmq_400_60 hid this: its
 * dkgInterval is 72 blocks, so a 54-block experiment window contained no
 * decided round at all, while llmq_50_60 (interval 24) had run twice in the
 * same window and punished 41 members in one of them.
 *
 * These three are the types this devnet actually forms, confirmed against
 * observed commitments (llmqType 1, 2 and 5). llmq_devnet stays in the registry
 * but is not tracked: the mainnet-parity change retired it here.
 */
export const TRACKED_PROFILE_NAMES: readonly string[] = (
  process.env.TRACKED_LLMQ_NAMES ?? 'llmq_50_60,llmq_60_75,llmq_400_60'
)
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

export function trackedProfiles(): LlmqProfile[] {
  return TRACKED_PROFILE_NAMES.map((name) => {
    const profile = LLMQ_PROFILES[name];
    if (!profile) {
      throw new Error(
        `Unknown LLMQ profile "${name}"; known: ${Object.keys(LLMQ_PROFILES).join(', ')}`
      );
    }
    return profile;
  });
}

/**
 * The structural ceiling on how many masternodes a single round can punish.
 *
 * `size` here is the effective size -- CalculateQuorum returns
 * min(params.size, available masternodes) -- which is why it is passed in
 * rather than read from the profile.
 */
export function maxPossibleBan(effectiveSize: number, minSize: number): number {
  return Math.max(0, effectiveSize - minSize);
}
