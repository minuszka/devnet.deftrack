import { SIMULATION_CONTROL_POLICY } from './simulationPolicy.js';

export interface SimulationMeasurementPolicy {
  dkgIntervalBlocks: number;
  minimumBaselineDkgRounds: number;
  minimumChainLockCoveragePercent: number;
  warmupBlocks: number;
  cooldownBlocks: number;
}

export interface BaselineEvidence {
  fromHeight: number;
  toHeight: number;
  indexedBlocks: number;
  resolvedDkgRounds: number;
  chainLockedBlocks: number;
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

export function planMeasurementWindows(input: {
  baselineEndHeight: number;
  faultStartHeight: number;
  faultEndHeight: number;
}): MeasurementWindowPlan {
  const policy = SIMULATION_CONTROL_POLICY.measurement;
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
  };
}

export function baselineEvidenceSatisfies(
  evidence: BaselineEvidence,
  plan: Pick<MeasurementWindowPlan, 'baseline' | 'minimumBaselineBlocks' | 'minimumBaselineDkgRounds' | 'minimumBaselineChainLocks'>
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
  return { passed: reasons.length === 0, reasons };
}
