import type { LlmqProfile } from '../config/llmq.js';

/**
 * How an outage of a given length relates to the DKG schedule.
 *
 * The experiment this exists for asks how many DKG windows a node was absent
 * across -- not how many times it was restarted. That number is not a property
 * of the outage's LENGTH. A window is missed only if the node is down while its
 * quorum is collecting contributions, and where a fixed-length outage lands
 * against that schedule decides whether it misses one, two, or none at all.
 *
 * So a duration alone answers with a RANGE, and only a known start height
 * collapses it to a number. Everything here is that arithmetic, in blocks,
 * against the profile's own parameters.
 *
 * The contribution phase is the one that matters, and it is the one branch a
 * stopped daemon can reach: `MarkBadMember` has nine call sites in the node's
 * dkgsession.cpp and exactly one is reachable by a daemon that is simply absent
 * -- "did not send any contribution". The other eight all require the member to
 * have transmitted something. A node down for the complain or justify phase has
 * already contributed and is not marked by that branch at all.
 */

/**
 * The chain's target block spacing, in seconds.
 *
 * The node's `nPowTargetSpacing`, which is 150 on every DeFCoN network including
 * devnet, and settable there with `-powtargetspacing`. It was previously an
 * unnamed 150_000 copied into two services; every duration here converts through
 * it, so it is defined once and overridable the same way the node's is.
 */
export const BLOCK_SECONDS = Number(process.env.BLOCK_TARGET_SECONDS ?? 150);
export const BLOCK_INTERVAL_MS = BLOCK_SECONDS * 1_000;

export function blocksForSeconds(seconds: number): number {
  return Math.floor(seconds / BLOCK_SECONDS);
}

export function secondsForBlocks(blocks: number): number {
  return blocks * BLOCK_SECONDS;
}

/** One full DKG cycle of this profile, in seconds. */
export function dkgIntervalSeconds(profile: LlmqProfile): number {
  return secondsForBlocks(profile.dkgInterval);
}

/**
 * The heights of the contribution phase for the cycle a height belongs to.
 *
 * The node computes `quorumStageInt = (height - quorumIndex) % dkgInterval` and
 * `phase = quorumStageInt / dkgPhaseBlocks + 1`, so phase 2 (Contribute) is the
 * stage range [dkgPhaseBlocks, 2 * dkgPhaseBlocks) -- half-open, as the node
 * treats it.
 */
export function contributionWindowFor(
  height: number,
  profile: LlmqProfile,
  quorumIndex = 0
): { fromHeight: number; toHeight: number } {
  const cycleStart = height - ((height - quorumIndex) % profile.dkgInterval);
  return {
    fromHeight: cycleStart + profile.dkgPhaseBlocks,
    toHeight: cycleStart + 2 * profile.dkgPhaseBlocks,
  };
}

export interface DkgWindowRange {
  /**
   * Windows missed no matter where the outage starts: those a run of this length
   * must fully contain at its WORST alignment.
   */
  guaranteed: number;
  /**
   * Windows the outage could touch at its BEST alignment. Touching is not the
   * same as missing -- a node down for part of a contribution phase may still
   * have sent its contribution -- so this is an upper bound on harm, never a
   * prediction.
   */
  possible: number;
}

/**
 * The range of contribution windows an outage of `durationBlocks` covers, over
 * every possible start height.
 *
 * The gap between the two numbers is the whole argument for anchoring. On
 * devnet's 24-block interval, an outage of a FULL interval still guarantees
 * nothing: windows sit at [24k+2, 24k+4), and an outage of blocks
 * [24m+3, 24m+27) contains neither the one before it nor the one after. To
 * guarantee one missed window without positioning, the outage must run
 * `dkgInterval + dkgPhaseBlocks - 1` blocks -- 25 blocks, or 62 minutes on
 * devnet.
 */
export function dkgWindowsCovered(durationBlocks: number, profile: LlmqProfile): DkgWindowRange {
  const interval = profile.dkgInterval;
  const phase = profile.dkgPhaseBlocks;
  if (durationBlocks <= 0) return { guaranteed: 0, possible: 0 };
  // A window [kI+p, kI+2p) is fully inside an outage [a, a+B) exactly when
  // kI lies in [a-p, a+B-2p] -- an integer range of B-p+1 heights -- and a range
  // of length L contains at least floor(L/I) multiples of I at every alignment.
  // Touching it instead needs kI in [a-p-1, a+B-p-1], length B+1, which contains
  // at most ceil(L/I).
  return {
    guaranteed: Math.max(0, Math.floor((durationBlocks - phase + 1) / interval)),
    possible: Math.ceil((durationBlocks + 1) / interval),
  };
}

/** The outage length that guarantees `windows` missed windows, whatever the alignment. */
export function blocksToGuaranteeWindows(windows: number, profile: LlmqProfile): number {
  if (windows <= 0) return 0;
  return windows * profile.dkgInterval + profile.dkgPhaseBlocks - 1;
}

/**
 * The exact number of contribution windows an outage covers, once its start
 * height is known -- what the range above collapses to with an anchor.
 *
 * Counted as fully contained windows: a node absent for a whole contribution
 * phase sends nothing, which is the branch that marks it. A partially covered
 * phase is deliberately not counted, because whether the contribution got out
 * depends on timing inside the phase and this must not overstate.
 */
export function dkgWindowsFromAnchor(input: {
  startHeight: number;
  durationBlocks: number;
  profile: LlmqProfile;
  quorumIndex?: number;
}): number {
  const { dkgInterval: interval, dkgPhaseBlocks: phase } = input.profile;
  const quorumIndex = input.quorumIndex ?? 0;
  const endHeight = input.startHeight + input.durationBlocks;
  let covered = 0;
  // Walk the cycles the outage can touch. Bounded by the outage itself, so the
  // loop is short for any length the scenario registry can express.
  const firstCycle = Math.floor((input.startHeight - quorumIndex) / interval) - 1;
  const lastCycle = Math.floor((endHeight - quorumIndex) / interval) + 1;
  for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
    const from = quorumIndex + cycle * interval + phase;
    const to = from + phase;
    if (from >= input.startHeight && to <= endHeight) covered++;
  }
  return covered;
}

/**
 * The height at which to start an outage so it covers exactly the contribution
 * window of the cycle at or after `notBeforeHeight`.
 *
 * This is the anchor: with it, missing one window costs `dkgPhaseBlocks` blocks
 * of outage -- five minutes on devnet -- instead of the sixty-five an unanchored
 * run needs to guarantee the same thing.
 */
export function anchorForNextWindow(input: {
  notBeforeHeight: number;
  profile: LlmqProfile;
  quorumIndex?: number;
}): { startHeight: number; durationBlocks: number } {
  const { dkgInterval: interval, dkgPhaseBlocks: phase } = input.profile;
  const quorumIndex = input.quorumIndex ?? 0;
  let cycle = Math.floor((input.notBeforeHeight - quorumIndex) / interval);
  for (;;) {
    const startHeight = quorumIndex + cycle * interval + phase;
    if (startHeight >= input.notBeforeHeight) return { startHeight, durationBlocks: phase };
    cycle++;
  }
}
