import { COOLDOWN_BUDGET_MS } from '../domain/simulationRunState.js';
import type { SimulationMeasurementPolicy } from './measurementWindows.js';

export interface SimulationLifecyclePolicy {
  /** Maximum time between draft creation and fault activation. */
  preparationWindowMs: number;
  /** Time reserved after the last possible host TTL for verified cleanup. */
  recoveryBudgetMs: number;
  /** Time reserved for post-recovery observation before run expiry. */
  cooldownBudgetMs: number;
}

/**
 * Code-owned safety policy. HTTP input and CLI flags never merge into it.
 * Relaxing a limit therefore requires an explicit reviewed code change.
 */
export const SIMULATION_CONTROL_POLICY = Object.freeze({
  measurement: Object.freeze<SimulationMeasurementPolicy>({
    dkgIntervalBlocks: 24,
    minimumBaselineDkgRounds: 3,
    minimumChainLockCoveragePercent: 80,
    warmupBlocks: 2,
    cooldownBlocks: 4,
    // A healthy devnet round sits at 1.00 and jitters to about 0.98; the window
    // this rejects sat at 0.16-0.32. The line is drawn to separate those, and
    // deliberately strict: a false rejection costs a run, a false acceptance
    // produces a number that reads as evidence and is not.
    minimumBaselineHealthRatio: 0.9,
    maximumBaselinePoseRevivals: 0,
  }),
  lifecycle: Object.freeze<SimulationLifecyclePolicy>({
    preparationWindowMs: 6 * 60 * 60_000,
    recoveryBudgetMs: 15 * 60_000,
    cooldownBudgetMs: COOLDOWN_BUDGET_MS,
  }),
  approval: Object.freeze({
    operatorRiskClasses: Object.freeze(['low', 'medium'] as const),
    safetyAdminRiskClasses: Object.freeze(['low', 'medium', 'high'] as const),
  }),
});
