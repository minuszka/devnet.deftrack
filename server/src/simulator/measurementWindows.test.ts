import { describe, expect, it } from 'vitest';
import {
  baselineEvidenceSatisfies,
  planMeasurementWindows,
  planMeasurementWindowsForFault,
  planMeasurementWindowsForLlmqFault,
} from './measurementWindows.js';
import { SIMULATION_CONTROL_POLICY } from './simulationPolicy.js';

describe('simulation measurement windows', () => {
  it('plans three DKG intervals and excludes warm-up/cooldown heights', () => {
    const plan = planMeasurementWindows({ baselineEndHeight: 999, faultStartHeight: 1_000, faultEndHeight: 1_010 });
    expect(plan.baseline).toEqual({ fromHeight: 928, toHeight: 999 });
    expect(plan.minimumBaselineBlocks).toBe(72);
    expect(plan.minimumBaselineDkgRounds).toBe(3);
    expect(plan.minimumBaselineChainLocks).toBe(58);
    expect(plan.warmupExcluded).toEqual({ fromHeight: 1_000, toHeight: 1_001 });
    expect(plan.observation).toEqual({ fromHeight: 1_002, toHeight: 1_010 });
    expect(plan.cooldownExcluded).toEqual({ fromHeight: 1_011, toHeight: 1_014 });
  });

  it('accepts exact minimum evidence and explains every shortage', () => {
    const plan = planMeasurementWindows({ baselineEndHeight: 999, faultStartHeight: 1_000, faultEndHeight: 1_010 });
    expect(baselineEvidenceSatisfies({
      fromHeight: 928, toHeight: 999, indexedBlocks: 72, resolvedDkgRounds: 3, chainLockedBlocks: 58,
    }, plan)).toEqual({ passed: true, reasons: [] });
    const failed = baselineEvidenceSatisfies({
      fromHeight: 929, toHeight: 999, indexedBlocks: 70, resolvedDkgRounds: 2, chainLockedBlocks: 50,
    }, plan);
    expect(failed.passed).toBe(false);
    expect(failed.reasons).toHaveLength(4);
  });

  it('rejects overlapping or too-short fault windows', () => {
    expect(() => planMeasurementWindows({ baselineEndHeight: 100, faultStartHeight: 100, faultEndHeight: 110 })).toThrow(/after the baseline/);
    expect(() => planMeasurementWindows({ baselineEndHeight: 99, faultStartHeight: 100, faultEndHeight: 101 })).toThrow(/too short/);
    const early = planMeasurementWindows({ baselineEndHeight: 10, faultStartHeight: 11, faultEndHeight: 20 });
    expect(baselineEvidenceSatisfies({
      fromHeight: 0, toHeight: 10, indexedBlocks: 72, resolvedDkgRounds: 3, chainLockedBlocks: 58,
    }, early).passed).toBe(false);
  });

  it('uses a frozen code-owned policy which request input cannot weaken', () => {
    expect(Object.isFrozen(SIMULATION_CONTROL_POLICY.measurement)).toBe(true);
    expect(SIMULATION_CONTROL_POLICY.measurement.minimumBaselineDkgRounds).toBe(3);
    const plan = planMeasurementWindows({ baselineEndHeight: 999, faultStartHeight: 1_000, faultEndHeight: 1_010 });
    expect(plan.minimumBaselineDkgRounds).toBe(3);
  });

  it('derives the baseline boundary exclusively from trusted fault anchors', () => {
    expect(planMeasurementWindowsForFault({ faultStartHeight: 1_000, faultEndHeight: 1_010 }))
      .toEqual(planMeasurementWindows({
        baselineEndHeight: 999,
        faultStartHeight: 1_000,
        faultEndHeight: 1_010,
      }));
    expect(() => planMeasurementWindowsForFault({ faultStartHeight: 0, faultEndHeight: 10 }))
      .toThrow(/preceding baseline/);
  });

  it('uses the code-owned active profile cadence for the baseline span', () => {
    const legacy = planMeasurementWindowsForLlmqFault({
      primaryLlmqName: 'llmq_400_60', faultStartHeight: 1_000, faultEndHeight: 1_010,
    });
    expect(legacy.minimumBaselineBlocks).toBe(216);
    expect(legacy.baseline).toEqual({ fromHeight: 784, toHeight: 999 });
    expect(() => planMeasurementWindowsForLlmqFault({
      primaryLlmqName: 'caller-invented', faultStartHeight: 1_000, faultEndHeight: 1_010,
    })).toThrow(/unknown measurement LLMQ profile/);
  });
});
