import { SIMULATION_CONTROL_POLICY } from './simulationPolicy.js';
import { LLMQ_PROFILES } from '../config/llmq.js';

export interface SimulationMeasurementPolicy {
  dkgIntervalBlocks: number;
  minimumBaselineDkgRounds: number;
  minimumChainLockCoveragePercent: number;
  warmupBlocks: number;
  cooldownBlocks: number;
  /** A baseline whose own DKG health is below this was not a network at rest. */
  minimumBaselineHealthRatio: number;
  /** PoSe revivals tolerated inside a baseline window. Zero: a revival is recovery. */
  maximumBaselinePoseRevivals: number;
}

export interface BaselineEvidence {
  fromHeight: number;
  toHeight: number;
  indexedBlocks: number;
  resolvedDkgRounds: number;
  chainLockedBlocks: number;
  /**
   * The primary profile's median health across the baseline; null when nothing
   * resolved. A baseline is a claim about the network at rest, so its own
   * health has to be part of whether it counts as one.
   */
  medianHealthRatio: number | null;
  /**
   * PoSe revivals inside the window. A revival is the network recovering, and
   * a window containing one is not quiet.
   */
  poseRevivedEvents: number;
}

export interface MeasurementHeightRange {
  fromHeight: number;
  toHeight: number;
}

export interface MeasurementWindowPlan {
  baseline: MeasurementHeightRange;
  warmupExcluded: MeasurementHeightRange;
  observation: MeasurementHeightRange;
  cooldownExcluded: MeasurementHeightRange;
  minimumBaselineBlocks: number;
  minimumBaselineDkgRounds: number;
  minimumBaselineChainLocks: number;
  minimumBaselineHealthRatio: number;
  maximumBaselinePoseRevivals: number;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

function minimumBaselineBlocksFor(policy: SimulationMeasurementPolicy): number {
  assertNonNegativeInteger(policy.dkgIntervalBlocks, 'dkgIntervalBlocks');
  assertNonNegativeInteger(policy.minimumBaselineDkgRounds, 'minimumBaselineDkgRounds');
  if (policy.dkgIntervalBlocks < 1 || policy.minimumBaselineDkgRounds < 1) {
    throw new Error('baseline must include at least one DKG interval and round');
  }
  if (
    !Number.isFinite(policy.minimumChainLockCoveragePercent) ||
    policy.minimumChainLockCoveragePercent < 0 ||
    policy.minimumChainLockCoveragePercent > 100
  ) {
    throw new Error('minimumChainLockCoveragePercent must be between 0 and 100');
  }
  return policy.dkgIntervalBlocks * policy.minimumBaselineDkgRounds;
}

function planMeasurementWindowsWithPolicy(input: {
  baselineEndHeight: number;
  faultStartHeight: number;
  faultEndHeight: number;
}, policy: SimulationMeasurementPolicy): MeasurementWindowPlan {
  for (const [name, value] of Object.entries({
    baselineEndHeight: input.baselineEndHeight,
    faultStartHeight: input.faultStartHeight,
    faultEndHeight: input.faultEndHeight,
    warmupBlocks: policy.warmupBlocks,
    cooldownBlocks: policy.cooldownBlocks,
  })) assertNonNegativeInteger(value, name);
  if (input.faultStartHeight <= input.baselineEndHeight) {
    throw new Error('fault window must start after the baseline');
  }
  if (policy.warmupBlocks < 1 || policy.cooldownBlocks < 1) {
    throw new Error('warm-up and cooldown must contain at least one block');
  }
  if (input.faultEndHeight < input.faultStartHeight + policy.warmupBlocks) {
    throw new Error('fault window is too short after warm-up exclusion');
  }
  const baselineBlocks = minimumBaselineBlocksFor(policy);
  const minimumBaselineChainLocks = Math.ceil(
    (baselineBlocks * policy.minimumChainLockCoveragePercent) / 100
  );
  return {
    baseline: {
      fromHeight: Math.max(0, input.baselineEndHeight - baselineBlocks + 1),
      toHeight: input.baselineEndHeight,
    },
    warmupExcluded: {
      fromHeight: input.faultStartHeight,
      toHeight: input.faultStartHeight + policy.warmupBlocks - 1,
    },
    observation: {
      fromHeight: input.faultStartHeight + policy.warmupBlocks,
      toHeight: input.faultEndHeight,
    },
    cooldownExcluded: {
      fromHeight: input.faultEndHeight + 1,
      toHeight: input.faultEndHeight + policy.cooldownBlocks,
    },
    minimumBaselineBlocks: baselineBlocks,
    minimumBaselineDkgRounds: policy.minimumBaselineDkgRounds,
    minimumBaselineChainLocks,
    minimumBaselineHealthRatio: policy.minimumBaselineHealthRatio,
    maximumBaselinePoseRevivals: policy.maximumBaselinePoseRevivals,
  };
}

export function planMeasurementWindows(input: {
  baselineEndHeight: number;
  faultStartHeight: number;
  faultEndHeight: number;
}): MeasurementWindowPlan {
  return planMeasurementWindowsWithPolicy(input, SIMULATION_CONTROL_POLICY.measurement);
}

/**
 * Plans every measurement range from the immutable fault anchors.  Callers do
 * not get to choose a shorter baseline independently from the fault window.
 */
export function planMeasurementWindowsForFault(input: {
  faultStartHeight: number;
  faultEndHeight: number;
}): MeasurementWindowPlan {
  assertNonNegativeInteger(input.faultStartHeight, 'faultStartHeight');
  if (input.faultStartHeight === 0) {
    throw new Error('fault window must have a preceding baseline height');
  }
  return planMeasurementWindows({
    baselineEndHeight: input.faultStartHeight - 1,
    faultStartHeight: input.faultStartHeight,
    faultEndHeight: input.faultEndHeight,
  });
}

/** Uses the reviewed Core profile registry; profile cadence is never caller-supplied. */
export function planMeasurementWindowsForLlmqFault(input: {
  primaryLlmqName: string;
  faultStartHeight: number;
  faultEndHeight: number;
}): MeasurementWindowPlan {
  assertNonNegativeInteger(input.faultStartHeight, 'faultStartHeight');
  if (input.faultStartHeight === 0) {
    throw new Error('fault window must have a preceding baseline height');
  }
  const profile = LLMQ_PROFILES[input.primaryLlmqName];
  if (profile === undefined) throw new Error(`unknown measurement LLMQ profile: ${input.primaryLlmqName}`);
  return planMeasurementWindowsWithPolicy({
    baselineEndHeight: input.faultStartHeight - 1,
    faultStartHeight: input.faultStartHeight,
    faultEndHeight: input.faultEndHeight,
  }, {
    ...SIMULATION_CONTROL_POLICY.measurement,
    dkgIntervalBlocks: profile.dkgInterval,
  });
}

export function baselineEvidenceSatisfies(
  evidence: BaselineEvidence,
  plan: Pick<MeasurementWindowPlan, 'baseline' | 'minimumBaselineBlocks' | 'minimumBaselineDkgRounds' | 'minimumBaselineChainLocks' | 'minimumBaselineHealthRatio' | 'maximumBaselinePoseRevivals'>
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const plannedSpan = plan.baseline.toHeight - plan.baseline.fromHeight + 1;
  if (plannedSpan < plan.minimumBaselineBlocks) {
    reasons.push(`planned chain history has only ${plannedSpan}/${plan.minimumBaselineBlocks} baseline heights`);
  }
  if (evidence.fromHeight !== plan.baseline.fromHeight || evidence.toHeight !== plan.baseline.toHeight) {
    reasons.push('baseline evidence does not cover the planned height range');
  }
  if (evidence.indexedBlocks < plan.minimumBaselineBlocks) {
    reasons.push(`baseline has ${evidence.indexedBlocks}/${plan.minimumBaselineBlocks} indexed blocks`);
  }
  if (evidence.indexedBlocks > plannedSpan) {
    reasons.push('baseline block count exceeds its height range');
  }
  if (evidence.resolvedDkgRounds < plan.minimumBaselineDkgRounds) {
    reasons.push(`baseline has ${evidence.resolvedDkgRounds}/${plan.minimumBaselineDkgRounds} resolved DKG rounds`);
  }
  if (evidence.chainLockedBlocks < plan.minimumBaselineChainLocks) {
    reasons.push(`baseline has ${evidence.chainLockedBlocks}/${plan.minimumBaselineChainLocks} ChainLocked blocks`);
  }

  // Quiescence, not just quantity.
  //
  // Every check above counts, and counting is not enough: CLAUDE.md's own
  // canonical bad window -- 46 masternodes revived at height 2404, three rounds
  // that all formed at health 0.16, 0.32 and 0.24 with 42 members punished --
  // satisfies all of them. Fed in as a baseline it passed, and the report went
  // on to answer "expected versus actual: match" against a delta of +0.74.
  //
  // The rule the project already knows is "do not measure in the first rounds
  // after a revive or a restart". These two checks are that rule, enforced. A
  // baseline is a claim that the network was at rest; a window in which it was
  // visibly recovering cannot support that claim however many blocks it has.
  if (evidence.medianHealthRatio !== null && evidence.medianHealthRatio < plan.minimumBaselineHealthRatio) {
    reasons.push(
      `baseline DKG health is ${evidence.medianHealthRatio.toFixed(2)}, below the ${plan.minimumBaselineHealthRatio.toFixed(2)} a baseline must itself hold`
    );
  }
  if (evidence.poseRevivedEvents > plan.maximumBaselinePoseRevivals) {
    reasons.push(
      `baseline contains ${evidence.poseRevivedEvents} PoSe revival(s), so the network was recovering rather than at rest`
    );
  }

  return { passed: reasons.length === 0, reasons };
}
