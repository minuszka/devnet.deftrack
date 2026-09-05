import { describe, expect, it } from 'vitest';
import { BLOCK_SECONDS } from '../domain/dkgWindows.js';
import { SCENARIO_LIMITS } from './scenarioRegistry.js';
import type { DryRunImpactEstimate } from './scenarioTypes.js';
import {
  computeSimulationMeasurementReport,
  type MeasurementBlockEvidence,
  type SimulationMeasurementEvidence,
} from './simulationMeasurement.js';

const GENERATED_AT_MS = 2_000_000;

/**
 * The fault windows below are the longest the registry will accept, taken from
 * the registry rather than typed out.
 *
 * They used to be eleven blocks, and one was seven, against a ceiling of six --
 * so every assertion in this file was made about a fault no scenario can ask
 * for. The pipeline is a pure function and the arithmetic was still right, but
 * nothing here covered the shape the system actually produces, and a reader
 * calibrates on the fixture. Derived, so raising or lowering MAX_OUTAGE_BLOCKS
 * moves the fixture with it instead of leaving it stale and plausible.
 */
const MAX_FAULT_BLOCKS = SCENARIO_LIMITS.maxDurationSeconds / BLOCK_SECONDS;
const FAULT_START = 1_000;
const FAULT_END = FAULT_START + MAX_FAULT_BLOCKS - 1;

function impact(surviving = 44): DryRunImpactEstimate {
  return {
    affectedTargetCount: 16,
    affectedMasternodeCount: 16,
    affectedStakerCount: 0,
    affectedHostCount: 2,
    affectedCurrentQuorumMembers: 16,
    currentQuorumSize: 60,
    survivingCurrentQuorumMembers: surviving,
    dkgThreshold: 44,
    chainLockThreshold: 41,
    dkgMarginAfterFault: surviving - 44,
    chainLockMarginAfterFault: surviving - 41,
    warnings: [],
  };
}

function block(height: number): MeasurementBlockEvidence {
  return {
    height,
    hash: `block-${height}`,
    time: 1_700_000_000 + height * 150,
    isProofOfStake: true,
    hasChainLock: true,
    chainLockSource: 'zmq',
    chainLockLatencyMs: 900 + (height % 5) * 20,
    chainLockLatencySec: 1,
    firstSeenAtMs: 1_000_000 + height * 1_000,
    stakerScript: `private-script-${height % 3}`,
    stakerHostId: `private-staker-${height % 2}`,
  };
}

function completeEvidence(): SimulationMeasurementEvidence {
  const heights = [
    ...Array.from({ length: 72 }, (_, index) => 928 + index),
    ...Array.from({ length: 9 }, (_, index) => 1_002 + index),
  ];
  const blocks = heights.map(block);
  const expectedHostIds = ['private-observer-a', 'private-observer-b'];
  const peerObservations = blocks.flatMap((row) => expectedHostIds.flatMap((hostId) => [
    {
      hostId,
      topic: 'block' as const,
      hash: row.hash,
      height: row.height,
      receivedAtMs: row.firstSeenAtMs!,
      clockOffsetMs: 2,
      resolutionMs: 0,
    },
    {
      hostId,
      topic: 'chainlock' as const,
      hash: row.hash,
      height: row.height,
      receivedAtMs: row.firstSeenAtMs! + row.chainLockLatencyMs!,
      clockOffsetMs: 2,
      resolutionMs: 0,
    },
  ]));
  return {
    primaryLlmqName: 'llmq_defcon',
    blocks,
    // Three rounds in the baseline (the policy's minimum) and one the fault is
    // aimed at. A round is attributed by its CONTRIBUTION phase, [start+2,
    // start+4), not by the height it is named after -- so the round the fault
    // disturbs is the one whose phase falls inside the window, and at a legal
    // six-block fault that is the round named 1000, not 1004. With 1004 here
    // the fixture only had a round in the window because the window was eleven
    // blocks long, which no scenario can ask for.
    rounds: [928, 952, 976, FAULT_START].map((expectedHeight) => ({
      llmqName: 'llmq_defcon',
      dkgInterval: 24,
      dkgPhaseBlocks: 2,
      expectedHeight,
      status: 'formed' as const,
      healthRatio: expectedHeight === FAULT_START ? 0.95 : 1,
      invalidMembers: [],
    })),
    poseEvents: [{
      height: 1_006,
      type: 'penalty_up',
      source: 'listdiff',
      subjectId: 'private-protx-hash',
    }],
    dslEpochs: [
      { epoch: 38, boundaryHeight: 936, status: 'committed', missedCount: 0, listSize: 60 },
      { epoch: 41, boundaryHeight: 1_008, status: 'committed', missedCount: 1, listSize: 60 },
    ],
    peerObservations,
    observationGaps: [],
    hosts: expectedHostIds.map((hostId) => ({ hostId, reportedAtMs: GENERATED_AT_MS - 1_000 })),
    expectedHostIds,
  };
}

function reversedEvidence(evidence: SimulationMeasurementEvidence): SimulationMeasurementEvidence {
  return {
    primaryLlmqName: evidence.primaryLlmqName,
    blocks: [...evidence.blocks].reverse(),
    rounds: [...evidence.rounds].reverse(),
    poseEvents: [...evidence.poseEvents].reverse(),
    dslEpochs: [...evidence.dslEpochs].reverse(),
    peerObservations: [...evidence.peerObservations].reverse(),
    observationGaps: [...evidence.observationGaps].reverse(),
    hosts: [...evidence.hosts].reverse(),
    expectedHostIds: [...evidence.expectedHostIds].reverse(),
  };
}

describe('simulation measurement pipeline', () => {
  // The fixture is only evidence if the system can produce it. Before this,
  // every window here was eleven blocks against a registry ceiling of six.
  it('measures a fault the registry would actually accept', () => {
    expect(FAULT_END - FAULT_START + 1).toBe(MAX_FAULT_BLOCKS);
    expect(MAX_FAULT_BLOCKS).toBeLessThanOrEqual(SCENARIO_LIMITS.maxDurationSeconds / BLOCK_SECONDS);
    expect(Number.isInteger(MAX_FAULT_BLOCKS)).toBe(true);
  });

  it('recomputes a complete synthetic report byte-for-byte from reordered evidence', () => {
    const evidence = completeEvidence();
    const input = {
      faultStartHeight: FAULT_START,
      faultEndHeight: FAULT_END,
      generatedAtMs: GENERATED_AT_MS,
      impact: impact(),
    };
    const first = computeSimulationMeasurementReport({ ...input, evidence });
    const second = computeSimulationMeasurementReport({ ...input, evidence: reversedEvidence(evidence) });

    expect(second).toEqual(first);
    expect(first.verdict).toEqual({ measurementValid: true, success: true, reasons: [] });
    expect(first.expectedVsActual.overall).toBe('matched');
    expect(first.baseline.dataQuality.peerObservationCoveragePercent).toBe(100);
    expect(first.observation.chainLock.observedTimeLatency.basis).toMatch(/local block-arrival/);
    expect(first.observation.chainLock.chainTimestampLatency.basis).toMatch(/block-header/);
    expect(first.observation.staking.timingBasis).toBe('chain-time');
    expect(first.evidenceFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.reportFingerprint).toMatch(/^[0-9a-f]{64}$/);

    const publicShape = JSON.stringify(first);
    expect(publicShape).not.toContain('private-observer');
    expect(publicShape).not.toContain('private-staker');
    expect(publicShape).not.toContain('private-script');
    expect(publicShape).not.toContain('private-protx');
  });

  it('sees the round an anchored fault was aimed at, warm-up notwithstanding', () => {
    // The real geometry. anchorForNextWindow puts the fault at cycleStart + 2,
    // which is where the contribution phase is; the round is NAMED by its cycle
    // start, two blocks earlier; and the observation window then begins two
    // warm-up blocks after the fault, at cycleStart + 4.
    //
    // Holding rounds against the observation window therefore excluded the one
    // round the run was positioned to disturb -- its cycle start is below the
    // fault, its work is inside it -- and every anchored run reported nothing
    // to evaluate. Rounds belong to the FAULT window: a round is the event, not
    // a steady-state metric the warm-up is there to protect.
    // Inside the fixture's own block range [1002, 1010], so the observation
    // window has blocks and the report is evaluable at all.
    const cycleStart = 1_002;
    const evidence = completeEvidence();
    evidence.rounds = [
      {
        llmqName: 'llmq_defcon', dkgInterval: 24, dkgPhaseBlocks: 2,
        expectedHeight: cycleStart, status: 'failed' as const,
        healthRatio: null, invalidMembers: [],
      },
      ...evidence.rounds,
    ];

    const report = computeSimulationMeasurementReport({
      faultStartHeight: cycleStart + 2,
      faultEndHeight: cycleStart + 2 + MAX_FAULT_BLOCKS - 1,
      generatedAtMs: GENERATED_AT_MS,
      impact: impact(),
      evidence,
    });

    // The round's cycle start (1002) is BELOW the observation window, which
    // begins at 1006 after the two warm-up blocks -- so the old rule could not
    // see it. Its work, [1004, 1006), is inside the fault.
    expect(report.observation.dkg.rounds.failed).toBe(1);
    const defcon = report.observation.dkg.byProfile.find((row) => row.llmqName === 'llmq_defcon');
    expect(defcon?.rounds.failed).toBe(1);
  });

  it('never reports success when telemetry is insufficient', () => {
    const evidence = completeEvidence();
    evidence.peerObservations = [];
    evidence.hosts[0]!.reportedAtMs = GENERATED_AT_MS - 10 * 60_000;
    evidence.observationGaps.push({ topic: 'hashchainlock', missed: 2, detectedAtMs: 2_005_000 });
    const report = computeSimulationMeasurementReport({
      faultStartHeight: FAULT_START,
      faultEndHeight: FAULT_END,
      generatedAtMs: GENERATED_AT_MS,
      impact: impact(),
      evidence,
    });

    expect(report.expectedVsActual.overall).toBe('matched');
    expect(report.verdict.measurementValid).toBe(false);
    expect(report.verdict.success).toBe(false);
    expect(report.verdict.reasons.join(' ')).toMatch(/stale|peer observation|messages were reported missing/);
  });

  it('keeps threshold expectations non-evaluable when the dry-run quorum was unknown', () => {
    const report = computeSimulationMeasurementReport({
      faultStartHeight: FAULT_START,
      faultEndHeight: FAULT_END,
      generatedAtMs: GENERATED_AT_MS,
      impact: { ...impact(), survivingCurrentQuorumMembers: null },
      evidence: completeEvidence(),
    });
    expect(report.verdict.measurementValid).toBe(true);
    expect(report.expectedVsActual.overall).toBe('not-evaluable');
    expect(report.verdict.success).toBe(false);
  });

  it('does not let unrelated quorum profiles satisfy the primary DKG baseline gate', () => {
    const evidence = completeEvidence();
    evidence.rounds = [
      ...evidence.rounds.filter((round) => round.expectedHeight === 1_004),
      ...[930, 954, 978].map((expectedHeight) => ({
        llmqName: 'llmq_50_60', dkgInterval: 24, dkgPhaseBlocks: 2, expectedHeight,
        status: 'formed' as const, healthRatio: 1, invalidMembers: [],
      })),
    ];
    const report = computeSimulationMeasurementReport({
      faultStartHeight: FAULT_START,
      faultEndHeight: FAULT_END,
      generatedAtMs: GENERATED_AT_MS,
      impact: impact(),
      evidence,
    });
    expect(report.baseline.dkg.rounds.formed).toBe(3);
    expect(report.verdict.measurementValid).toBe(false);
    expect(report.verdict.reasons.join(' ')).toMatch(/baseline has 0\/3 resolved DKG rounds/);
  });

  it('answers the same for the same evidence however long after the window it is asked', () => {
    const evidence = completeEvidence();
    const at = (generatedAtMs: number) => computeSimulationMeasurementReport({
      faultStartHeight: FAULT_START,
      faultEndHeight: FAULT_END,
      generatedAtMs,
      impact: impact(),
      evidence,
    });

    // The day-7 gate: a report recomputes. It did not, because observer
    // staleness compared a frozen generatedAtMs against a HostStatus row that
    // the next agent heartbeat overwrote -- finalize answered valid, and
    // verify() a day later answered "expected observer hosts are stale".
    const atFinalize = at(GENERATED_AT_MS);
    const aDayLater = at(GENERATED_AT_MS + 24 * 60 * 60_000);
    const aYearLater = at(GENERATED_AT_MS + 365 * 24 * 60 * 60_000);

    expect(aDayLater.verdict).toEqual(atFinalize.verdict);
    expect(aYearLater.verdict).toEqual(atFinalize.verdict);
    expect(aDayLater.baseline.dataQuality.reasons).toEqual(atFinalize.baseline.dataQuality.reasons);
    expect(aYearLater.observation.dataQuality.reasons).toEqual(atFinalize.observation.dataQuality.reasons);

    // generatedAtMs is still carried, because when a report was produced is a
    // fact about the report; it just no longer decides what the report says.
    expect(aDayLater.generatedAtMs).not.toBe(atFinalize.generatedAtMs);
  });

  it('reports health for the run\'s own profile rather than a blend of every schedule', () => {
    const evidence = completeEvidence();
    const primary = evidence.primaryLlmqName;
    // A window as the devnet actually produces one: the run's profile unhealthy,
    // two unrelated schedules perfectly healthy and interleaved with it. The
    // repository loads rounds by height with no llmqName filter, so this is the
    // ordinary case rather than a contrived one.
    evidence.rounds = [
      ...[930, 954, 978].map((expectedHeight) => ({
        llmqName: primary, dkgInterval: 24, dkgPhaseBlocks: 2, expectedHeight,
        status: 'formed' as const, healthRatio: 0.3, invalidMembers: [],
      })),
      ...[936, 960].map((expectedHeight) => ({
        llmqName: 'llmq_60_75', dkgInterval: 48, dkgPhaseBlocks: 2, expectedHeight,
        status: 'formed' as const, healthRatio: 1, invalidMembers: [],
      })),
      { llmqName: 'llmq_400_60', dkgInterval: 72, dkgPhaseBlocks: 2, expectedHeight: 942,
        status: 'formed' as const, healthRatio: 1, invalidMembers: [] },
      ...evidence.rounds.filter((round) => round.expectedHeight === 1_004),
    ];
    const report = computeSimulationMeasurementReport({
      faultStartHeight: FAULT_START,
      faultEndHeight: FAULT_END,
      generatedAtMs: GENERATED_AT_MS,
      impact: impact(),
      evidence,
    });

    // Blended, this window medians to 0.65 -- a health figure none of the three
    // profiles ever had, reported for a profile that sat flat at 0.3 throughout.
    expect(report.baseline.dkg.medianHealthRatio).toBe(0.3);
    expect(report.baseline.dkg.worstHealthRatio).toBe(0.3);

    // The count still spans the window, so "six rounds ran, three were yours"
    // stays visible.
    expect(report.baseline.dkg.rounds.formed).toBe(6);
    expect(report.baseline.dkg.byProfile.find((row) => row.llmqName === primary)?.rounds.formed).toBe(3);
  });
});

describe('observation gap correlation', () => {
  const input = {
    faultStartHeight: FAULT_START,
    faultEndHeight: FAULT_END,
    generatedAtMs: GENERATED_AT_MS,
    impact: impact(),
  };

  it('says so when there was no window to correlate against', () => {
    // An empty gap list means "none happened" only when a window was actually
    // searched. With no block arrival time anywhere in the range there is no
    // window, and reporting zero missed messages would be a failed lookup
    // contributing a zero.
    const report = computeSimulationMeasurementReport({
      ...input,
      evidence: { ...completeEvidence(), observationGaps: [], observationGapWindowKnown: false },
    });
    const reasons = [
      ...report.baseline.dataQuality.reasons,
      ...report.observation.dataQuality.reasons,
    ].join(' ');
    expect(reasons).toMatch(/observation gaps could not be correlated/);
  });

  it('stays silent when the window was known and simply held no gaps', () => {
    const report = computeSimulationMeasurementReport({
      ...input,
      evidence: { ...completeEvidence(), observationGaps: [] },
    });
    const reasons = [
      ...report.baseline.dataQuality.reasons,
      ...report.observation.dataQuality.reasons,
    ].join(' ');
    expect(reasons).not.toMatch(/could not be correlated/);
  });
});
