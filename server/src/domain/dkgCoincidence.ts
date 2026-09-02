import { LLMQ_PROFILES, type LlmqProfile } from '../config/llmq.js';
import { currentRoundHeight, isSchedulable } from './dkgSchedule.js';

/**
 * Where two or more LLMQ profiles can punish the same node in the same block.
 *
 * This is the arithmetic an experiment needs to POSITION a fault: a node that is
 * absent across one DKG window takes one exclusion, which never bans on its own;
 * what bans is a second exclusion landing before the first has decayed. Whether
 * two profiles can punish together is therefore a property of their MINING
 * WINDOWS in absolute height -- not of their cycle starts, which is the tempting
 * and wrong way to compute it.
 *
 * Worked through on this chain's own numbers, that distinction is not academic:
 * llmq_50_60 and llmq_400_60 share a cycle start at every multiple of 72 and yet
 * can NEVER be mined in the same block. 400_60's window is [+20,+28] of a
 * 72-block cycle, whose residues mod 24 are {20,21,22,23,0,1,2,3,4}, and that set
 * never meets 50_60's {10..18}. The intersection is empty, not "about ten blocks
 * apart".
 *
 * Two further rules keep the answer honest:
 *
 * - A profile the node refuses to form below a gate contributes nothing below it
 *   (`formationGateHeight`, the same rule the schedule reconstruction applies).
 * - A profile that cannot reach `minSize` contributes nothing at all. Below
 *   minSize a session sends no commitment (`dkgsession.cpp:967-970`), the miner
 *   emits a NULL commitment instead, and a null commitment never reaches
 *   `HandleQuorumCommitment` -- so it punishes nobody however well its window
 *   lines up. On this devnet that is exactly llmq_400_85: minSize 350 against at
 *   most 152 masternodes, overlapping on paper and inert in fact.
 */

/**
 * The six profiles `chainparams.cpp` enables on this devnet
 * (`:657-662`). llmq_devnet is in the registry but retired here by the
 * mainnet-parity change, so it is deliberately absent.
 */
export const DEVNET_ENABLED_PROFILE_NAMES: readonly string[] = [
  'llmq_50_60',
  'llmq_60_75',
  'llmq_400_60',
  'llmq_400_85',
  'llmq_100_67',
  'llmq_defcon',
];

/**
 * Exact reproduction of `CQuorumBlockProcessor::IsMiningPhase`
 * (`llmq/blockprocessor.cpp:465-478`):
 *
 *   cycleStart = h - (h % dkgInterval)
 *   cycleStart + dkgMiningWindowStart <= h <= cycleStart + dkgMiningWindowEnd
 *
 * Both bounds inclusive, as the node's `>=` / `<=` are.
 */
export function isInMiningWindow(profile: LlmqProfile, height: number): boolean {
  const cycleStart = currentRoundHeight(height, profile.dkgInterval);
  return (
    height >= cycleStart + profile.dkgMiningWindowStart &&
    height <= cycleStart + profile.dkgMiningWindowEnd
  );
}

/**
 * Whether this profile can produce a punishing commitment at this network size.
 * `CalculateQuorum` returns min(size, available), and a session below `minSize`
 * abandons its commitment -- so the profile mines nulls and punishes nobody.
 */
export function canPunishAtSize(profile: LlmqProfile, masternodeCount: number): boolean {
  return Math.min(profile.size, masternodeCount) >= profile.minSize;
}

/** Every profile that could apply a penalty in the block at `height`. */
export function punishingProfilesAtHeight(input: {
  height: number;
  masternodeCount: number;
  profileNames: readonly string[];
}): LlmqProfile[] {
  return input.profileNames
    .map((name) => {
      const profile = LLMQ_PROFILES[name];
      if (profile === undefined) throw new Error(`Unknown LLMQ profile "${name}"`);
      return profile;
    })
    .filter(
      (profile) =>
        canPunishAtSize(profile, input.masternodeCount) &&
        isSchedulable(input.height, profile.formationGateHeight) &&
        isInMiningWindow(profile, input.height)
    );
}

/** A contiguous run of heights over which the same set of profiles can punish together. */
export interface CoincidenceWindow {
  /** Sorted, so two windows of the same group compare equal. */
  profileNames: string[];
  fromHeight: number;
  toHeight: number;
}

/**
 * Every contiguous height range in `[fromHeight, toHeight]` where at least
 * `minProfiles` profiles can punish in the same block.
 *
 * Returned as ranges rather than a start height on purpose: the eligible band for
 * llmq_60_75 + llmq_400_60 is the whole `[144k+20, 144k+28]`, and keying a preset
 * on its first block alone would throw away eight of every nine usable heights.
 */
export function coincidenceWindows(input: {
  masternodeCount: number;
  fromHeight: number;
  toHeight: number;
  minProfiles?: number;
  profileNames?: readonly string[];
}): CoincidenceWindow[] {
  const minProfiles = input.minProfiles ?? 2;
  const profileNames = input.profileNames ?? DEVNET_ENABLED_PROFILE_NAMES;
  const windows: CoincidenceWindow[] = [];
  let open: CoincidenceWindow | null = null;

  for (let height = input.fromHeight; height <= input.toHeight; height++) {
    const names = punishingProfilesAtHeight({ height, masternodeCount: input.masternodeCount, profileNames })
      .map((profile) => profile.llmqName)
      .sort();
    const qualifies = names.length >= minProfiles;
    const key = names.join(',');
    if (qualifies && open !== null && open.profileNames.join(',') === key && open.toHeight === height - 1) {
      open.toHeight = height;
      continue;
    }
    if (open !== null) windows.push(open);
    open = qualifies ? { profileNames: names, fromHeight: height, toHeight: height } : null;
  }
  if (open !== null) windows.push(open);
  return windows;
}

/**
 * The first height at or after `fromHeight` where the named profiles all punish
 * together, or null if none within `searchBlocks`. This is what a run's anchor
 * gate reports back when it refuses: the operator is told the next eligible
 * height rather than a bare rejection.
 */
export function nextCoincidentHeight(input: {
  masternodeCount: number;
  fromHeight: number;
  searchBlocks: number;
  profileNames: readonly string[];
}): number | null {
  const wanted = [...input.profileNames].sort().join(',');
  for (let height = input.fromHeight; height <= input.fromHeight + input.searchBlocks; height++) {
    const names = punishingProfilesAtHeight({
      height,
      masternodeCount: input.masternodeCount,
      profileNames: input.profileNames,
    })
      .map((profile) => profile.llmqName)
      .sort()
      .join(',');
    if (names === wanted) return height;
  }
  return null;
}

