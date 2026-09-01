import { describe, expect, it } from 'vitest';
import {
  baselineEvidenceSatisfies,
  planMeasurementWindows,
  planMeasurementWindowsForFault,
  planMeasurementWindowsForLlmqFault,
  roundsSettledForFinalize,
  type SettlementRound,
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
      fromHeight: 928, toHeight: 999, indexedBlocks: 72, resolvedDkgRounds: 3, chainLockedBlocks: 58, medianHealthRatio: 1, poseRevivedEvents: 0,
    }, plan)).toEqual({ passed: true, reasons: [] });
    const failed = baselineEvidenceSatisfies({
      fromHeight: 929, toHeight: 999, indexedBlocks: 70, resolvedDkgRounds: 2, chainLockedBlocks: 50, medianHealthRatio: 1, poseRevivedEvents: 0,
    }, plan);
    expect(failed.passed).toBe(false);
    expect(failed.reasons).toHaveLength(4);
  });

  it('rejects a baseline the network was still recovering through', () => {
    const plan = planMeasurementWindows({ baselineEndHeight: 999, faultStartHeight: 1_000, faultEndHeight: 1_010 });

    // The window CLAUDE.md holds up as the canonical example of where not to
    // measure: 46 masternodes revived, and three rounds that all formed while
    // health sat at 0.16, 0.32 and 0.24. Every count is satisfied -- span,
    // range, blocks, rounds, ChainLocks -- which is exactly why counting alone
    // let it through and the report went on to answer "match".
    const recovering = baselineEvidenceSatisfies({
      fromHeight: 928, toHeight: 999, indexedBlocks: 72, resolvedDkgRounds: 3, chainLockedBlocks: 58,
      medianHealthRatio: 0.24, poseRevivedEvents: 46,
    }, plan);
    expect(recovering.passed).toBe(false);
    expect(recovering.reasons.join(' ')).toMatch(/baseline DKG health is 0\.24/);
    expect(recovering.reasons.join(' ')).toMatch(/46 PoSe revival/);

    // Each half stands on its own: a quiet window at poor health is still not a
    // baseline, and a healthy window containing a revival is still not quiet.
    expect(baselineEvidenceSatisfies({
      fromHeight: 928, toHeight: 999, indexedBlocks: 72, resolvedDkgRounds: 3, chainLockedBlocks: 58,
      medianHealthRatio: 0.24, poseRevivedEvents: 0,
    }, plan).passed).toBe(false);
    expect(baselineEvidenceSatisfies({
      fromHeight: 928, toHeight: 999, indexedBlocks: 72, resolvedDkgRounds: 3, chainLockedBlocks: 58,
      medianHealthRatio: 1, poseRevivedEvents: 1,
    }, plan).passed).toBe(false);

    // And ordinary jitter is not a rejection: a devnet round sits at 1.00 and
    // dips to about 0.98, which must still pass or the gate costs runs it
    // should not.
    expect(baselineEvidenceSatisfies({
      fromHeight: 928, toHeight: 999, indexedBlocks: 72, resolvedDkgRounds: 3, chainLockedBlocks: 58,
      medianHealthRatio: 0.98, poseRevivedEvents: 0,
    }, plan)).toEqual({ passed: true, reasons: [] });

    // A baseline in which nothing resolved cannot be judged on health, and is
    // already refused by the round count rather than by a health figure it does
    // not have.
    const nothingResolved = baselineEvidenceSatisfies({
      fromHeight: 928, toHeight: 999, indexedBlocks: 72, resolvedDkgRounds: 0, chainLockedBlocks: 58,
      medianHealthRatio: null, poseRevivedEvents: 0,
    }, plan);
    expect(nothingResolved.passed).toBe(false);
    expect(nothingResolved.reasons.join(' ')).not.toMatch(/DKG health/);
  });

  it('rejects overlapping or too-short fault windows', () => {
    expect(() => planMeasurementWindows({ baselineEndHeight: 100, faultStartHeight: 100, faultEndHeight: 110 })).toThrow(/after the baseline/);
    expect(() => planMeasurementWindows({ baselineEndHeight: 99, faultStartHeight: 100, faultEndHeight: 101 })).toThrow(/too short/);
    const early = planMeasurementWindows({ baselineEndHeight: 10, faultStartHeight: 11, faultEndHeight: 20 });
    expect(baselineEvidenceSatisfies({
      fromHeight: 0, toHeight: 10, indexedBlocks: 72, resolvedDkgRounds: 3, chainLockedBlocks: 58, medianHealthRatio: 1, poseRevivedEvents: 0,
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

describe('roundsSettledForFinalize', () => {
  const baseline = { fromHeight: 928, toHeight: 999 };
  const observation = { fromHeight: 1_002, toHeight: 1_010 };
  // llmq_defcon: dkgInterval 24, signingActiveQuorumCount 2 -> re-read span 48.
  const saqc = { llmq_defcon: 2 };
  const round = (expectedHeight: number, status = 'formed'): SettlementRound => ({
    llmqName: 'llmq_defcon', dkgInterval: 24, expectedHeight, status,
  });

  it('is settled when every in-window round is resolved and past the re-read band', () => {
    const result = roundsSettledForFinalize({
      rounds: [round(936), round(984), round(1_008)],
      baseline, observation, tipHeight: 1_200, signingActiveQuorumCountByProfile: saqc,
    });
    expect(result).toEqual({ settled: true, reasons: [] });
  });

  it('refuses while an in-window round is still pending', () => {
    const result = roundsSettledForFinalize({
      rounds: [round(936), round(984, 'pending')],
      baseline, observation, tipHeight: 1_200, signingActiveQuorumCountByProfile: saqc,
    });
    expect(result.settled).toBe(false);
    expect(result.reasons.join()).toMatch(/984 is still pending/);
  });

  it('refuses while an in-window round is still inside the poller re-read band', () => {
    // tip 1_020 -> currentRoundHeight 1_008; oldestStillReRead = 1_008 - 48 = 960.
    // The round at 984 is >= 960, so it is still being overwritten each poll.
    const result = roundsSettledForFinalize({
      rounds: [round(984)],
      baseline, observation, tipHeight: 1_020, signingActiveQuorumCountByProfile: saqc,
    });
    expect(result.settled).toBe(false);
    expect(result.reasons.join()).toMatch(/re-read window at tip 1020/);
  });

  it('ignores rounds outside the baseline and observation windows', () => {
    // A round at 1_000 falls in the warm-up gap between the windows; it is not measured.
    const result = roundsSettledForFinalize({
      rounds: [round(1_000, 'pending')],
      baseline, observation, tipHeight: 1_020, signingActiveQuorumCountByProfile: saqc,
    });
    expect(result).toEqual({ settled: true, reasons: [] });
  });

  it('refuses a profile whose re-read window the registry does not know', () => {
    const result = roundsSettledForFinalize({
      rounds: [{ llmqName: 'mystery', dkgInterval: 24, expectedHeight: 984, status: 'formed' }],
      baseline, observation, tipHeight: 1_200, signingActiveQuorumCountByProfile: saqc,
    });
    expect(result.settled).toBe(false);
    expect(result.reasons.join()).toMatch(/no known re-read window/);
  });
});
