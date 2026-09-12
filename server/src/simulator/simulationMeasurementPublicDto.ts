import { simulationFingerprint } from '../domain/simulationAudit.js';
import type { SimulationMeasurementRecord } from '../services/simulationMeasurement.service.js';
import type {
  DataQualityMeasurementSnapshot,
  DkgMeasurementSnapshot,
  SimulationMeasurementReport,
  SimulationMeasurementSnapshot,
} from './simulationMeasurement.js';

export interface PublicSimulationMeasurementResult {
  reportId: string;
  runKey: string;
  anchor: SimulationMeasurementRecord['anchor'];
  report: SimulationMeasurementReport;
}

function dkg(value: DkgMeasurementSnapshot): DkgMeasurementSnapshot {
  const copyStats = (row: DkgMeasurementSnapshot['byProfile'][number]) => ({
    llmqName: row.llmqName,
    dkgInterval: row.dkgInterval,
    rounds: { ...row.rounds },
    formationRate: row.formationRate,
    medianHealthRatio: row.medianHealthRatio,
    worstHealthRatio: row.worstHealthRatio,
    longestFailureStreak: row.longestFailureStreak,
    membersPunished: row.membersPunished,
  });
  return {
    rounds: { ...value.rounds },
    formationRate: value.formationRate,
    medianHealthRatio: value.medianHealthRatio,
    worstHealthRatio: value.worstHealthRatio,
    longestFailureStreak: value.longestFailureStreak,
    membersPunished: value.membersPunished,
    byProfile: value.byProfile.map(copyStats),
  };
}
function quality(value: DataQualityMeasurementSnapshot): DataQualityMeasurementSnapshot {
  return {
    sufficient: value.sufficient,
    confidence: value.confidence,
    reasons: [...value.reasons],
    expectedHeights: value.expectedHeights,
    indexedUniqueHeights: value.indexedUniqueHeights,
    missingHeights: value.missingHeights,
    duplicateHeights: value.duplicateHeights,
    firstSeenCoveragePercent: value.firstSeenCoveragePercent,
    expectedHosts: value.expectedHosts,
    staleHosts: value.staleHosts,
    peerObservationCoveragePercent: value.peerObservationCoveragePercent,
    duplicatePeerObservations: value.duplicatePeerObservations,
    observedChainLockLatencyCoveragePercent: value.observedChainLockLatencyCoveragePercent,
    observationGapCount: value.observationGapCount,
    observationMessagesMissed: value.observationMessagesMissed,
    pendingDkgRounds: value.pendingDkgRounds,
  };
}

function snapshot(value: SimulationMeasurementSnapshot): SimulationMeasurementSnapshot {
  return {
    range: { ...value.range },
    dkg: dkg(value.dkg),
    chainLock: {
      eligibleBlocks: value.chainLock.eligibleBlocks,
      lockedBlocks: value.chainLock.lockedBlocks,
      coverage: value.chainLock.coverage,
      sourceCounts: { ...value.chainLock.sourceCounts },
      observedTimeLatency: { ...value.chainLock.observedTimeLatency },
      chainTimestampLatency: { ...value.chainLock.chainTimestampLatency },
    },
    pose: {
      events: { ...value.pose.events },
      distinctSubjectsAffected: value.pose.distinctSubjectsAffected,
      sourceCounts: { ...value.pose.sourceCounts },
    },
    dsl: { ...value.dsl },
    staking: {
      timingBasis: value.staking.timingBasis,
      blocks: value.staking.blocks,
      medianIntervalSec: value.staking.medianIntervalSec,
      meanIntervalSec: value.staking.meanIntervalSec,
      longestGapSec: value.staking.longestGapSec,
      stallCount: value.staking.stallCount,
      distinctStakers: value.staking.distinctStakers,
      scriptHhi: value.staking.scriptHhi,
      scriptGini: value.staking.scriptGini,
      topStakerShare: value.staking.topStakerShare,
      hostGrouping: value.staking.hostGrouping === null ? null : { ...value.staking.hostGrouping },
    },
    dataQuality: quality(value.dataQuality),
  };
}

/**
 * Explicit allowlist projection.
 *
 * What it guarantees, stated precisely because the previous one-line claim here
 * ("future unknown fields cannot escape") was not true: fields outside the
 * report -- the record's own and the anchor's -- are copied by name. Fields
 * INSIDE the report are verified against its fingerprint first, so a field
 * planted in storage makes the report fail closed rather than publish; the
 * small aggregate sub-objects in there are still spread, which means a field
 * the GENERATOR adds to one of them in future is published with it. That is a
 * code change somebody makes, not data somebody plants, and it is a residual.
 */
export function toPublicSimulationMeasurementResult(
  source: SimulationMeasurementRecord
): PublicSimulationMeasurementResult {
  const { reportFingerprint: _ignored, ...fingerprintedReport } = source.report;
  if (
    simulationFingerprint(fingerprintedReport) !== source.report.reportFingerprint ||
    source.report.reportFingerprint !== source.reportFingerprint ||
    source.report.evidenceFingerprint !== source.evidenceFingerprint
  ) {
    throw new Error('stored simulation measurement fingerprint is invalid');
  }
  const report: SimulationMeasurementReport = {
    schemaVersion: source.report.schemaVersion,
    generatedAtMs: source.report.generatedAtMs,
    windows: {
      baseline: { ...source.report.windows.baseline },
      warmupExcluded: { ...source.report.windows.warmupExcluded },
      observation: { ...source.report.windows.observation },
      cooldownExcluded: { ...source.report.windows.cooldownExcluded },
      minimumBaselineBlocks: source.report.windows.minimumBaselineBlocks,
      minimumBaselineDkgRounds: source.report.windows.minimumBaselineDkgRounds,
      minimumBaselineChainLocks: source.report.windows.minimumBaselineChainLocks,
      minimumBaselineHealthRatio: source.report.windows.minimumBaselineHealthRatio,
      maximumBaselinePoseRevivals: source.report.windows.maximumBaselinePoseRevivals,
    },
    baseline: snapshot(source.report.baseline),
    observation: snapshot(source.report.observation),
    delta: { ...source.report.delta },
    expectedVsActual: {
      dkg: { ...source.report.expectedVsActual.dkg },
      chainLock: { ...source.report.expectedVsActual.chainLock },
      dsl: { ...source.report.expectedVsActual.dsl },
      overall: source.report.expectedVsActual.overall,
    },
    verdict: {
      measurementValid: source.report.verdict.measurementValid,
      success: source.report.verdict.success,
      reasons: [...source.report.verdict.reasons],
    },
    evidenceFingerprint: source.report.evidenceFingerprint,
    reportFingerprint: source.report.reportFingerprint,
  };
  return {
    reportId: source.reportId,
    runKey: source.runKey,
    // By name. The anchor sits OUTSIDE the fingerprinted report, so nothing
    // verifies it, and the spread that was here published a field planted in the
    // stored document -- found by the planted-sentinel integration test, not by
    // reading this function.
    anchor: {
      faultStartHeight: source.anchor.faultStartHeight,
      faultStartBlockHash: source.anchor.faultStartBlockHash,
      faultEndHeight: source.anchor.faultEndHeight,
      faultEndBlockHash: source.anchor.faultEndBlockHash,
    },
    report,
  };
}
