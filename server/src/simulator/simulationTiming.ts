import type { DryRunPlan, PlannedSimulationAction } from './scenarioTypes.js';
import { SIMULATION_CONTROL_POLICY } from './simulationPolicy.js';

export interface SimulationRunTiming {
  createdAtMs: number;
  activationDeadlineMs: number;
  /** Longest host-side TTL end, relative to fault activation. */
  maxHostFaultEndOffsetMs: number;
  latestActionExpiryOffsetMs: number;
  recoveryBudgetMs: number;
  cooldownBudgetMs: number;
  runExpiresAtMs: number;
}

function faultEndOffset(action: PlannedSimulationAction): number {
  const payload = action.payload;
  if (!('faultLeaseSeconds' in payload)) return 0;
  return action.notBeforeOffsetMs + payload.faultLeaseSeconds * 1_000;
}

/** Derives every deadline from a validated plan and code-owned policy. */
export function deriveSimulationRunTiming(
  plan: Pick<DryRunPlan, 'actions'>,
  createdAtMs: number
): SimulationRunTiming {
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) {
    throw new Error('createdAtMs must be a non-negative safe integer');
  }
  if (plan.actions.length === 0) throw new Error('simulation plan must contain actions');
  let maxHostFaultEndOffsetMs = 0;
  let latestActionExpiryOffsetMs = 0;
  for (const action of plan.actions) {
    if (
      !Number.isSafeInteger(action.notBeforeOffsetMs) ||
      !Number.isSafeInteger(action.expiresAfterMs) ||
      action.notBeforeOffsetMs < 0 ||
      action.expiresAfterMs <= action.notBeforeOffsetMs
    ) {
      throw new Error(`action ${action.actionId} has an invalid schedule`);
    }
    maxHostFaultEndOffsetMs = Math.max(maxHostFaultEndOffsetMs, faultEndOffset(action));
    latestActionExpiryOffsetMs = Math.max(latestActionExpiryOffsetMs, action.expiresAfterMs);
  }
  const lifecycle = SIMULATION_CONTROL_POLICY.lifecycle;
  const planEndOffsetMs = Math.max(maxHostFaultEndOffsetMs, latestActionExpiryOffsetMs);
  const activationDeadlineMs = createdAtMs + lifecycle.preparationWindowMs;
  const runExpiresAtMs =
    activationDeadlineMs +
    planEndOffsetMs +
    lifecycle.recoveryBudgetMs +
    lifecycle.cooldownBudgetMs;
  if (!Number.isSafeInteger(runExpiresAtMs)) throw new Error('derived run expiry is not a safe integer');
  return {
    createdAtMs,
    activationDeadlineMs,
    maxHostFaultEndOffsetMs,
    latestActionExpiryOffsetMs,
    recoveryBudgetMs: lifecycle.recoveryBudgetMs,
    cooldownBudgetMs: lifecycle.cooldownBudgetMs,
    runExpiresAtMs,
  };
}

/**
 * The controller may activate only while the plan still fits before run
 * expiry. The returned lease always covers every host-side fault TTL.
 */
export function faultLeaseExpiresAtForStart(timing: SimulationRunTiming, startAtMs: number): number {
  if (!Number.isSafeInteger(startAtMs) || startAtMs < timing.createdAtMs) {
    throw new Error('fault start time is invalid');
  }
  if (timing.maxHostFaultEndOffsetMs <= 0) {
    throw new Error('plan has no leased fault action');
  }
  if (startAtMs > timing.activationDeadlineMs) {
    throw new Error('simulation activation deadline has passed');
  }
  const faultLeaseExpiresAtMs = startAtMs + timing.maxHostFaultEndOffsetMs;
  const requiredRunEnd =
    faultLeaseExpiresAtMs + timing.recoveryBudgetMs + timing.cooldownBudgetMs;
  if (requiredRunEnd > timing.runExpiresAtMs) {
    throw new Error('host fault TTL does not fit inside the run recovery envelope');
  }
  return faultLeaseExpiresAtMs;
}
