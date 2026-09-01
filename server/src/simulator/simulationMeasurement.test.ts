import { describe, expect, it } from 'vitest';
import type { DryRunImpactEstimate } from './scenarioTypes.js';
import {
  computeSimulationMeasurementReport,
  type MeasurementBlockEvidence,
  type SimulationMeasurementEvidence,
} from './simulationMeasurement.js';

const GENERATED_AT_MS = 2_000_000;

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
    rounds: [928, 952, 976, 1_004].map((expectedHeight) => ({
      llmqName: 'llmq_defcon',
      dkgInterval: 24,
      expectedHeight,
      status: 'formed' as const,
      healthRatio: expectedHeight === 1_004 ? 0.95 : 1,
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
  it('recomputes a complete synthetic report byte-for-byte from reordered evidence', () => {
    const evidence = completeEvidence();
    const input = {
      faultStartHeight: 1_000,
      faultEndHeight: 1_010,
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

  it('never reports success when telemetry is insufficient', () => {
    const evidence = completeEvidence();
    evidence.peerObservations = [];
    evidence.hosts[0]!.reportedAtMs = GENERATED_AT_MS - 10 * 60_000;
    evidence.observationGaps.push({ topic: 'hashchainlock', missed: 2, detectedAtMs: 2_005_000 });
    const report = computeSimulationMeasurementReport({
      faultStartHeight: 1_000,
      faultEndHeight: 1_010,
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
      faultStartHeight: 1_000,
      faultEndHeight: 1_010,
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
        llmqName: 'llmq_50_60', dkgInterval: 24, expectedHeight,
        status: 'formed' as const, healthRatio: 1, invalidMembers: [],
      })),
    ];
    const report = computeSimulationMeasurementReport({
      faultStartHeight: 1_000,
      faultEndHeight: 1_010,
      generatedAtMs: GENERATED_AT_MS,
      impact: impact(),
      evidence,
    });
    expect(report.baseline.dkg.rounds.formed).toBe(3);
    expect(report.verdict.measurementValid).toBe(false);
    expect(report.verdict.reasons.join(' ')).toMatch(/baseline has 0\/3 resolved DKG rounds/);
  });
});
