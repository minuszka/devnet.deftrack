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

  /*
   * The public field inventory, complete.
   *
   * The small aggregate sub-objects inside the report are spread, so a field the
   * generator adds to one of them would be published with it. This list is what
   * turns that from silent into a failing test. A change here is a change to
   * what the public sees: decide it -- never regenerate the list to make the
   * test pass.
   */
  const PUBLIC_TOP = [
    'reportId', 'runKey', 'anchor', 'anchor.faultStartHeight', 'anchor.faultStartBlockHash',
    'anchor.faultEndHeight', 'anchor.faultEndBlockHash', 'report', 'report.schemaVersion',
    'report.generatedAtMs', 'report.windows', 'report.windows.baseline',
    'report.windows.baseline.fromHeight', 'report.windows.baseline.toHeight',
    'report.windows.warmupExcluded', 'report.windows.warmupExcluded.fromHeight',
    'report.windows.warmupExcluded.toHeight', 'report.windows.observation',
    'report.windows.observation.fromHeight', 'report.windows.observation.toHeight',
    'report.windows.cooldownExcluded', 'report.windows.cooldownExcluded.fromHeight',
    'report.windows.cooldownExcluded.toHeight', 'report.windows.minimumBaselineBlocks',
    'report.windows.minimumBaselineDkgRounds', 'report.windows.minimumBaselineChainLocks',
    'report.windows.minimumBaselineHealthRatio', 'report.windows.maximumBaselinePoseRevivals',
    'report.baseline', 'report.observation',
    'report.delta', 'report.delta.dkgFormationRate', 'report.delta.dkgMedianHealthRatio',
    'report.delta.chainLockCoverage', 'report.delta.observedChainLockP95Ms', 'report.delta.poseBans',
    'report.delta.posePenaltyIncreases', 'report.delta.dslConvergenceRate',
    'report.delta.stakingMedianIntervalSec', 'report.delta.stakingLongestGapSec', 'report.expectedVsActual',
    'report.expectedVsActual.dkg', 'report.expectedVsActual.dkg.expected',
    'report.expectedVsActual.dkg.actual', 'report.expectedVsActual.dkg.matched',
    'report.expectedVsActual.dkg.reason', 'report.expectedVsActual.chainLock',
    'report.expectedVsActual.chainLock.expected', 'report.expectedVsActual.chainLock.actual',
    'report.expectedVsActual.chainLock.matched', 'report.expectedVsActual.chainLock.reason',
    'report.expectedVsActual.dsl', 'report.expectedVsActual.dsl.expected',
    'report.expectedVsActual.dsl.actual', 'report.expectedVsActual.dsl.matched',
    'report.expectedVsActual.dsl.reason', 'report.expectedVsActual.overall', 'report.verdict',
    'report.verdict.measurementValid', 'report.verdict.success', 'report.verdict.reasons',
    'report.verdict.reasons[]', 'report.evidenceFingerprint', 'report.reportFingerprint',
  ];
  /** The same inventory for both measured windows, report.baseline and report.observation. */
  const PUBLIC_WINDOW = [
    'range', 'range.fromHeight', 'range.toHeight', 'dkg', 'dkg.rounds', 'dkg.rounds.formed',
    'dkg.rounds.failed', 'dkg.rounds.pending', 'dkg.rounds.impossible', 'dkg.formationRate',
    'dkg.medianHealthRatio', 'dkg.worstHealthRatio', 'dkg.longestFailureStreak', 'dkg.membersPunished',
    'dkg.byProfile', 'dkg.byProfile[]', 'chainLock', 'chainLock.eligibleBlocks', 'chainLock.lockedBlocks',
    'chainLock.coverage', 'chainLock.sourceCounts', 'chainLock.sourceCounts.zmq',
    'chainLock.sourceCounts.poll', 'chainLock.sourceCounts.unknown', 'chainLock.observedTimeLatency',
    'chainLock.observedTimeLatency.basis', 'chainLock.observedTimeLatency.unit',
    'chainLock.observedTimeLatency.samples', 'chainLock.observedTimeLatency.p50',
    'chainLock.observedTimeLatency.p95', 'chainLock.chainTimestampLatency',
    'chainLock.chainTimestampLatency.basis', 'chainLock.chainTimestampLatency.unit',
    'chainLock.chainTimestampLatency.samples', 'chainLock.chainTimestampLatency.p50',
    'chainLock.chainTimestampLatency.p95', 'pose', 'pose.events', 'pose.events.banned',
    'pose.events.revived', 'pose.events.penalty_up', 'pose.events.penalty_down',
    'pose.events.service_missed', 'pose.events.service_recovered', 'pose.events.service_suspended',
    'pose.events.service_banned', 'pose.distinctSubjectsAffected', 'pose.sourceCounts',
    'pose.sourceCounts.listdiff', 'pose.sourceCounts.poll', 'dsl', 'dsl.epochs', 'dsl.committed',
    'dsl.absent', 'dsl.convergenceRate', 'dsl.totalMissedBits', 'dsl.maximumMissedRatio',
    'dsl.guardedEpochs', 'staking', 'staking.timingBasis', 'staking.blocks', 'staking.medianIntervalSec',
    'staking.meanIntervalSec', 'staking.longestGapSec', 'staking.stallCount', 'staking.distinctStakers',
    'staking.scriptHhi', 'staking.scriptGini', 'staking.topStakerShare', 'staking.hostGrouping',
    'dataQuality', 'dataQuality.sufficient', 'dataQuality.confidence', 'dataQuality.reasons',
    'dataQuality.reasons[]', 'dataQuality.expectedHeights', 'dataQuality.indexedUniqueHeights',
    'dataQuality.missingHeights', 'dataQuality.duplicateHeights', 'dataQuality.firstSeenCoveragePercent',
    'dataQuality.expectedHosts', 'dataQuality.staleHosts', 'dataQuality.peerObservationCoveragePercent',
    'dataQuality.duplicatePeerObservations', 'dataQuality.observedChainLockLatencyCoveragePercent',
    'dataQuality.observationGapCount', 'dataQuality.observationMessagesMissed',
    'dataQuality.pendingDkgRounds',
  ];

  function keyPaths(value: unknown, prefix = ''): string[] {
    if (Array.isArray(value)) return [`${prefix}[]`, ...value.flatMap((v) => keyPaths(v, `${prefix}[]`))];
    if (value !== null && typeof value === 'object') {
      return Object.entries(value).flatMap(([key, child]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return [path, ...keyPaths(child, path)];
      });
    }
    return [];
  }

  function inventory(result: unknown): { top: string[]; baseline: string[]; observation: string[] } {
    const paths = [...new Set(keyPaths(result))];
    const under = (window: string): string[] =>
      paths.filter((p) => p.startsWith(`report.${window}.`)).map((p) => p.slice(`report.${window}.`.length));
    const windowed = (p: string): boolean => p.startsWith('report.baseline.') || p.startsWith('report.observation.');
    return { top: paths.filter((p) => !windowed(p)), baseline: under('baseline'), observation: under('observation') };
  }

  function refingerprint(source: SimulationMeasurementRecord): void {
    const { reportFingerprint: _old, ...body } = source.report;
    source.report.reportFingerprint = simulationFingerprint(body);
    source.reportFingerprint = source.report.reportFingerprint;
  }

  it('publishes exactly the inventoried fields', () => {
    const found = inventory(toPublicSimulationMeasurementResult(record()));
    expect(found.top).toEqual(PUBLIC_TOP);
    expect(found.baseline).toEqual(PUBLIC_WINDOW);
    expect(found.observation).toEqual(PUBLIC_WINDOW);
  });

  // The inventory can fail: a field added inside a spread aggregate, the way a
  // future generator change would add one, is caught by it.
  it('a field added inside a spread aggregate fails the inventory', () => {
    const source = record();
    (source.report.baseline.dsl as unknown as Record<string, unknown>)['addedByAGeneratorChange'] = 1;
    refingerprint(source);
    const found = inventory(toPublicSimulationMeasurementResult(source));
    expect(found.baseline).not.toEqual(PUBLIC_WINDOW);
    expect(found.baseline).toContain('dsl.addedByAGeneratorChange');
  });

  // The two sub-objects the inventory cannot reach in this fixture -- an empty
  // byProfile and a null hostGrouping -- are copied by name instead.
  it('copies a profile row rounds and the host grouping by name', () => {
    const source = record();
    type Report = SimulationMeasurementRecord['report'];
    source.report.baseline.dkg.byProfile = [
      {
        llmqName: 'llmq_defcon',
        dkgInterval: 24,
        rounds: { formed: 1, failed: 0, pending: 0, impossible: 0, privateNote: 'unit-secret' },
        formationRate: 1,
        medianHealthRatio: 1,
        worstHealthRatio: 1,
        longestFailureStreak: 0,
        membersPunished: 0,
      } as unknown as Report['baseline']['dkg']['byProfile'][number],
    ];
    source.report.baseline.staking.hostGrouping = {
      distinctHosts: 2,
      hhi: 0.5,
      topHostShare: 0.5,
      unattributedBlocks: 0,
      hostNames: 'unit-secret',
    } as unknown as NonNullable<Report['baseline']['staking']['hostGrouping']>;
    refingerprint(source);

    const result = toPublicSimulationMeasurementResult(source);
    expect(JSON.stringify(result)).not.toContain('unit-secret');
    expect(result.report.baseline.staking.hostGrouping).toEqual({
      distinctHosts: 2,
      hhi: 0.5,
      topHostShare: 0.5,
      unattributedBlocks: 0,
    });
  });
});
