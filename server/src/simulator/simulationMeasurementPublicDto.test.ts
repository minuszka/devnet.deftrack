import { describe, expect, it } from 'vitest';
import { simulationFingerprint } from '../domain/simulationAudit.js';
import type { SimulationMeasurementRecord } from '../services/simulationMeasurement.service.js';
import { computeSimulationMeasurementReport } from './simulationMeasurement.js';
import { toPublicSimulationMeasurementResult } from './simulationMeasurementPublicDto.js';

function record(): SimulationMeasurementRecord {
  const report = computeSimulationMeasurementReport({
    faultStartHeight: 10,
    faultEndHeight: 20,
    generatedAtMs: 100,
    impact: {
      affectedTargetCount: 0, affectedMasternodeCount: 0, affectedStakerCount: 0,
      affectedHostCount: 0, affectedCurrentQuorumMembers: 0, currentQuorumSize: null,
      survivingCurrentQuorumMembers: null, dkgThreshold: 44, chainLockThreshold: 41,
      dkgMarginAfterFault: null, chainLockMarginAfterFault: null, warnings: [],
    },
    evidence: {
      primaryLlmqName: 'llmq_defcon',
      blocks: [], rounds: [], poseEvents: [], dslEpochs: [], peerObservations: [],
      observationGaps: [], hosts: [], expectedHostIds: [],
    },
  });
  return {
    reportId: 'measure_test',
    runKey: 'sim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    anchor: {
      faultStartHeight: 10, faultStartBlockHash: 'start',
      faultEndHeight: 20, faultEndBlockHash: 'end',
    },
    evidenceFingerprint: report.evidenceFingerprint,
    reportFingerprint: report.reportFingerprint,
    report,
    generatedAtMs: 100,
  };
}

describe('public simulation measurement DTO', () => {
  it('copies only allowlisted aggregate fields', () => {
    const source = record() as SimulationMeasurementRecord & { privateFleet?: string };
    source.privateFleet = 'host-secret';
    (source.report as SimulationMeasurementRecord['report'] & { futurePrivateField?: string }).futurePrivateField = 'unit-secret';
    const { reportFingerprint: _old, ...body } = source.report;
    source.report.reportFingerprint = simulationFingerprint(body);
    source.reportFingerprint = source.report.reportFingerprint;

    const result = toPublicSimulationMeasurementResult(source);
    expect(JSON.stringify(result)).not.toMatch(/host-secret|unit-secret/);
  });

  it('rejects a report whose content no longer matches its fingerprint', () => {
    const source = record();
    source.report.verdict.success = true;
    expect(() => toPublicSimulationMeasurementResult(source)).toThrow(/fingerprint/);
  });
});
