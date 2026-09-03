import type { LlmqProfile } from '../config/llmq.js';
import {
  anchorForNextWindow,
  blocksForSeconds,
  contributionWindowFor,
  dkgWindowsFromAnchor,
  secondsForBlocks,
} from '../domain/dkgWindows.js';

/**
 * Whether a fault about to be applied can measure anything about DKG.
 *
 * A scenario that asks how a quorum behaves when members disappear during its
 * DKG is measuring one thing: the contribution window. An outage that does not
 * cover one produces a clean run, a real masternode outage, PoSe risk on the
 * network -- and no observation whatsoever. That is worse than a refusal,
 * because it looks like a result.
 *
 * The gate is therefore about MEASUREMENT, not safety, and it says so in what it
 * does: it refuses before the fault is applied, names the height to start at
 * instead, and declines to act at all when it cannot see the chain rather than
 * blocking a run it knows nothing about.
 */

export interface DkgAnchorAssessment {
  /** Contribution windows this outage will fully cover from `tipHeight`. */
  windowsCovered: number;
  /** Where to start instead, to cover the next one. */
  suggestedStartHeight: number;
  blocksToWait: number;
  secondsToWait: number;
}

export function assessDkgAnchor(input: {
  tipHeight: number;
  faultDurationMs: number;
  profile: LlmqProfile;
}): DkgAnchorAssessment {
  const durationBlocks = blocksForSeconds(Math.floor(input.faultDurationMs / 1_000));
  // The fault begins at the next block, not the one already mined.
  const startHeight = input.tipHeight + 1;
  const windowsCovered = dkgWindowsFromAnchor({
    startHeight,
    durationBlocks,
    profile: input.profile,
  });
  const suggested = anchorForNextWindow({ notBeforeHeight: startHeight, profile: input.profile });
  const blocksToWait = Math.max(0, suggested.startHeight - startHeight);
  return {
    windowsCovered,
    suggestedStartHeight: suggested.startHeight,
    blocksToWait,
    secondsToWait: secondsForBlocks(blocksToWait),
  };
}

/**
 * The scenarios whose measurement is the DKG contribution window.
 *
 * Deliberately a short list rather than "anything touching a masternode". A
 * network-degradation or staker run measures something else entirely, and gating
 * it on DKG alignment would refuse runs that were never asking the question.
 */
export function measuresDkgWindows(scenarioId: string, parameters: unknown): boolean {
  if (scenarioId !== 'quorum-member-outage') return false;
  const phase = (parameters as { phase?: unknown } | null)?.phase;
  return phase === 'dkg';
}

/**
 * The reason to refuse, or null to proceed.
 *
 * Fails OPEN when the tip is unknown: this protects the value of a measurement,
 * not the network, and a deployment with no tip source must keep the behaviour
 * it had rather than lose the ability to start a run.
 */
export function dkgAnchorRefusal(input: {
  scenarioId: string;
  parameters: unknown;
  tipHeight: number | null;
  faultDurationMs: number;
  profile: LlmqProfile;
}): string | null {
  if (!measuresDkgWindows(input.scenarioId, input.parameters)) return null;
  if (input.tipHeight === null) return null;
  const assessment = assessDkgAnchor(input as { tipHeight: number } & typeof input);
  if (assessment.windowsCovered > 0) return null;
  const window = contributionWindowFor(assessment.suggestedStartHeight, input.profile);
  return (
    `this outage would cover no ${input.profile.llmqName} contribution window, so it would ` +
    `stop masternodes and measure nothing; start at height ${assessment.suggestedStartHeight} ` +
    `(${assessment.blocksToWait} block(s), about ${Math.round(assessment.secondsToWait / 60)} min) ` +
    `to cover the window at [${window.fromHeight}, ${window.toHeight})`
  );
}
