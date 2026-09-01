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
  }),
  lifecycle: Object.freeze<SimulationLifecyclePolicy>({
    preparationWindowMs: 6 * 60 * 60_000,
    recoveryBudgetMs: 15 * 60_000,
    cooldownBudgetMs: 15 * 60_000,
  }),
  approval: Object.freeze({
    operatorRiskClasses: Object.freeze(['low', 'medium'] as const),
    safetyAdminRiskClasses: Object.freeze(['low', 'medium', 'high'] as const),
  }),
});
