import { describe, expect, it } from 'vitest';
import type { DryRunPlan, PlannedSimulationAction } from './scenarioTypes.js';
import { SIMULATION_CONTROL_POLICY } from './simulationPolicy.js';
import { deriveSimulationRunTiming, faultLeaseExpiresAtForStart } from './simulationTiming.js';

function action(
  sequence: number,
  notBeforeOffsetMs: number,
  payload: PlannedSimulationAction['payload']
): PlannedSimulationAction {
  return {
    actionId: `act-${sequence}`,
    runKey: 'sim-test',
    sequence,
    targetId: 'mn-1',
    kind: payload.kind,
    payload,
    payloadDigest: 'digest',
    notBeforeOffsetMs,
    expiresAfterMs: notBeforeOffsetMs + 120_000,
    maxAttempts: 3,
  };
}

describe('plan-derived simulation timing', () => {
  it('keeps the run alive beyond every host TTL plus recovery and cooldown', () => {
    const actions = [
      action(0, 0, { kind: 'service-stop', faultLeaseSeconds: 300 }),
      action(1, 180_000, { kind: 'service-stop', faultLeaseSeconds: 240 }),
      action(2, 420_000, { kind: 'service-start' }),
    ];
    const createdAtMs = 1_000;
    const timing = deriveSimulationRunTiming({ actions } as Pick<DryRunPlan, 'actions'>, createdAtMs);
    expect(timing.maxHostFaultEndOffsetMs).toBe(420_000);
    expect(timing.latestActionExpiryOffsetMs).toBe(540_000);
    expect(timing.runExpiresAtMs).toBe(
      createdAtMs +
      SIMULATION_CONTROL_POLICY.lifecycle.preparationWindowMs +
      540_000 +
      SIMULATION_CONTROL_POLICY.lifecycle.recoveryBudgetMs +
      SIMULATION_CONTROL_POLICY.lifecycle.cooldownBudgetMs
    );
    const leaseEnd = faultLeaseExpiresAtForStart(timing, timing.activationDeadlineMs);
    expect(leaseEnd + timing.recoveryBudgetMs + timing.cooldownBudgetMs)
      .toBeLessThanOrEqual(timing.runExpiresAtMs);
  });

  it('rejects late activation and plans without a host-side fault lease', () => {
    const leased = deriveSimulationRunTiming({
      actions: [action(0, 0, { kind: 'service-stop', faultLeaseSeconds: 30 })],
    }, 0);
    expect(() => faultLeaseExpiresAtForStart(leased, leased.activationDeadlineMs + 1)).toThrow(/deadline/);
    const clearOnly = deriveSimulationRunTiming({
      actions: [action(0, 0, { kind: 'fault-clear', scope: 'run' })],
    }, 0);
    expect(() => faultLeaseExpiresAtForStart(clearOnly, 1)).toThrow(/no leased fault/);
  });
});
