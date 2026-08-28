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
  /**
   * The height below which the node refuses to form this profile at all
   * (IsQuorumTypeEnabledInternal gates new types until
   * activation - (signingActiveQuorumCount + 1) * dkgInterval). A scheduled
   * height below it is not a failed round -- no session ever ran, by consensus
   * rule -- so the collector leaves those heights out of the record entirely,
   * the same way it treats heights beyond the RPC's observation window.
   */
  formationGateHeight?: number;
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
  llmq_400_85: {
    llmqType: 3,
    llmqName: 'llmq_400_85',
    size: 400,
    minSize: 350,
    threshold: 340,
    dkgInterval: 576, // 24 * 24 -- one DKG per day
    dkgPhaseBlocks: 4,
    dkgMiningWindowStart: 20,
    dkgMiningWindowEnd: 48,
    dkgBadVotesThreshold: 300,
    useRotation: false,
    signingActiveQuorumCount: 4,
  },
  llmq_100_67: {
    llmqType: 4,
    llmqName: 'llmq_100_67',
    size: 100,
    minSize: 80,
    threshold: 67,
    dkgInterval: 24,
    dkgPhaseBlocks: 2,
    dkgMiningWindowStart: 10,
    dkgMiningWindowEnd: 18,
    dkgBadVotesThreshold: 80,
    useRotation: false,
    signingActiveQuorumCount: 24,
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
  llmq_defcon: {
    llmqType: 7,
    llmqName: 'llmq_defcon',
    size: 60,
    minSize: 44,
    threshold: 41,
    dkgInterval: 24, // one DKG per hour -- the Layer-1 dead-MN mitigation
    dkgPhaseBlocks: 2,
    dkgMiningWindowStart: 10,
    dkgMiningWindowEnd: 18,
    dkgBadVotesThreshold: 48, // 80% of size -- supermajority, unlike the inherited 3
    useRotation: false,
    signingActiveQuorumCount: 4,
    // nChainLocksV2ActivationHeight 3240 - (4 + 1) * 24; verified live: the
    // first llmq_defcon commitment on this chain sits at exactly 3120.
    formationGateHeight: 3120,
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

/**
 * The signed-height ChainLock resolver, mirrored from the node
 * (llmq::GetChainLocksLLMQType): below the activation height every CLSIG is
 * and remains signed by the legacy profile; at and above it, by llmq_defcon.
 * Height-only and one-way, so the signing profile of any lock can be derived
 * from its block height. The node confirms it live only for the best lock
 * (getbestchainlock reports the resolved profile name since v22.1.5), which
 * the ChainLock watcher uses as a drift check on this mirror.
 */
export const CHAINLOCK_V2_ACTIVATION_HEIGHT = Number(
  process.env.CHAINLOCK_V2_ACTIVATION_HEIGHT ?? 3240
);
export const CHAINLOCK_V2_PROFILE_NAME = process.env.CHAINLOCK_V2_LLMQ_NAME ?? 'llmq_defcon';

export function chainlockProfileNameAtHeight(height: number): string {
  return height >= CHAINLOCK_V2_ACTIVATION_HEIGHT ? CHAINLOCK_V2_PROFILE_NAME : CHAINLOCK_PROFILE_NAME;
}

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
 * The profile actually signing ChainLocks at the given height. Snapshots taken
 * "now" must use this with the current tip, not chainlockProfile(): the static
 * name is the pre-switchover profile forever, and an experiment declaration or
 * masternode snapshot stamped with it after the activation height records the
 * wrong quorum as the one under test.
 */
export function chainlockProfileAtHeight(height: number): LlmqProfile {
  const name = chainlockProfileNameAtHeight(height);
  const profile = LLMQ_PROFILES[name];
  if (!profile) {
    throw new Error(`Unknown LLMQ profile "${name}"; known: ${Object.keys(LLMQ_PROFILES).join(', ')}`);
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
 * chainparams.cpp enables five types on this devnet -- llmq_50_60, llmq_60_75,
 * llmq_400_60, llmq_400_85 and llmq_100_67 -- and all five are in the registry
 * above so that a commitment of any of them can be named.
 *
 * Four of them are tracked. llmq_100_67 is not: it has produced no commitment
 * of any kind at any height, so the node is not even attempting it, and
 * reconstructing a schedule would invent rounds nobody ran. Add it the moment
 * one of its commitments appears.
 *
 * llmq_400_85 is tracked, but read its rounds with its numbers in view. Every
 * one of its 87 commitments on this chain is a *null* commitment -- the marker
 * the node mines when a round produced nothing -- so it has never once formed
 * here. That is arithmetic rather than misbehaviour: its minSize is 350 against
 * a devnet of at most 80 masternodes. Those rounds are classified `impossible`
 * rather than `failed` for exactly that reason; see classifyRound().
 *
 * llmq_devnet stays in the registry but is not tracked: the mainnet-parity
 * change retired it here.
 */
export const TRACKED_PROFILE_NAMES: readonly string[] = (
  process.env.TRACKED_LLMQ_NAMES ?? 'llmq_50_60,llmq_60_75,llmq_400_60,llmq_400_85,llmq_defcon'
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
