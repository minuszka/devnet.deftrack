import { compareByCodeUnit } from '../domain/codeUnitOrder.js';
import { simulationFingerprint } from '../domain/simulationAudit.js';
import { roundStats, type RoundStatus } from '../domain/roundStats.js';
import { stakingHealth } from '../domain/stakingHealth.js';
import type { DryRunImpactEstimate } from './scenarioTypes.js';
import {
  baselineEvidenceSatisfies,
  planMeasurementWindowsForLlmqFault,
  type MeasurementHeightRange,
  type MeasurementWindowPlan,
} from './measurementWindows.js';

export const SIMULATION_TELEMETRY_POLICY = Object.freeze({
  minimumPeerObservationCoveragePercent: 80,
  minimumObservedBlockTimeCoveragePercent: 80,
  minimumObservedChainLockLatencyCoveragePercent: 80,
  maximumStaleHosts: 0,
  maximumObservationMessagesMissed: 0,
  maximumHostAgeMs: 2 * 60_000,
});

export interface MeasurementBlockEvidence {
  height: number;
  hash: string;
  time: number;
  isProofOfStake: boolean;
  hasChainLock: boolean;
  chainLockSource: 'zmq' | 'poll' | null;
  /** Arrival minus local block arrival; observed-time. */
  chainLockLatencyMs: number | null;
  /** Arrival minus block header timestamp; chain-time comparison. */
  chainLockLatencySec: number | null;
  firstSeenAtMs: number | null;
  stakerScript: string | null;
  stakerHostId: string | null;
}

export interface MeasurementRoundEvidence {
  llmqName: string;
  dkgInterval: number;
  expectedHeight: number;
  status: RoundStatus;
  healthRatio: number | null;
  invalidMembers: string[];
}

export interface MeasurementPoSeEventEvidence {
  height: number;
  type:
    | 'banned'
    | 'revived'
    | 'penalty_up'
    | 'penalty_down'
    | 'service_missed'
    | 'service_recovered'
    | 'service_suspended'
    | 'service_banned';
  source: 'listdiff' | 'poll';
  subjectId: string;
}

export interface MeasurementDslEpochEvidence {
  epoch: number;
  boundaryHeight: number;
  status: 'committed' | 'absent';
  missedCount: number | null;
  listSize: number | null;
}

export interface MeasurementPeerObservationEvidence {
  hostId: string;
  topic: 'block' | 'chainlock';
  hash: string;
  height: number | null;
  receivedAtMs: number;
  clockOffsetMs: number | null;
  resolutionMs: number;
}

export interface MeasurementObservationGapEvidence {
  topic: string;
  missed: number;
  detectedAtMs: number;
}

export interface MeasurementHostEvidence {
  hostId: string;
  reportedAtMs: number;
}

/** Private evidence. Identifiers are fingerprinted but never copied to a report. */
export interface SimulationMeasurementEvidence {
  /** ChainLock/DKG profile active at the immutable fault-start height. */
  primaryLlmqName: string;
  blocks: MeasurementBlockEvidence[];
  rounds: MeasurementRoundEvidence[];
  poseEvents: MeasurementPoSeEventEvidence[];
  dslEpochs: MeasurementDslEpochEvidence[];
  peerObservations: MeasurementPeerObservationEvidence[];
  observationGaps: MeasurementObservationGapEvidence[];
  /**
   * False when no block in the range carried an arrival time, so the window to
   * correlate observation gaps against could not be established at all.
   *
   * `observationGaps` is then empty because nothing was looked up -- not because
   * nothing happened -- and an empty list that means "unknown" is exactly the
   * failed call contributing a zero. Absent means known, so measurements taken
   * before this field existed keep their fingerprints.
   */
  observationGapWindowKnown?: boolean;
  hosts: MeasurementHostEvidence[];
  expectedHostIds: string[];
  /**
   * The chain tip when the evidence was loaded. A liveness input for the
   * finalize settledness gate only, so it is set on the loaded top-level
   * evidence and deliberately NOT carried into the per-range slices that get
   * fingerprinted -- it decides whether a round has left the poller's re-read
   * window, and must never enter the report or either fingerprint. Optional for
   * exactly that reason: the normalized/range evidence omits it.
   */
  tipHeight?: number;
}

export interface DkgMeasurementSnapshot {
  rounds: { formed: number; failed: number; pending: number; impossible: number };
  formationRate: number | null;
  medianHealthRatio: number | null;
  worstHealthRatio: number | null;
  longestFailureStreak: number;
  membersPunished: number;
  byProfile: Array<{
    llmqName: string;
    dkgInterval: number;
    rounds: { formed: number; failed: number; pending: number; impossible: number };
    formationRate: number | null;
    medianHealthRatio: number | null;
    worstHealthRatio: number | null;
    longestFailureStreak: number;
    membersPunished: number;
  }>;
}

export interface ChainLockMeasurementSnapshot {
  eligibleBlocks: number;
  lockedBlocks: number;
  coverage: number | null;
  sourceCounts: { zmq: number; poll: number; unknown: number };
  observedTimeLatency: {
    basis: 'local block-arrival to local ChainLock-arrival';
    unit: 'milliseconds';
    samples: number;
    p50: number | null;
    p95: number | null;
  };
  chainTimestampLatency: {
    basis: 'block-header timestamp to local ChainLock-arrival';
    unit: 'seconds';
    samples: number;
    p50: number | null;
    p95: number | null;
  };
}

export interface PoSeMeasurementSnapshot {
  events: Record<MeasurementPoSeEventEvidence['type'], number>;
  distinctSubjectsAffected: number;
  sourceCounts: { listdiff: number; poll: number };
}

export interface DslMeasurementSnapshot {
  epochs: number;
  committed: number;
  absent: number;
  convergenceRate: number | null;
  totalMissedBits: number;
  maximumMissedRatio: number | null;
}

export interface StakingMeasurementSnapshot {
  timingBasis: 'chain-time';
  blocks: number;
  medianIntervalSec: number | null;
  meanIntervalSec: number | null;
  longestGapSec: number | null;
  stallCount: number;
  distinctStakers: number;
  scriptHhi: number | null;
  scriptGini: number | null;
  topStakerShare: number | null;
  hostGrouping: {
    distinctHosts: number;
    hhi: number | null;
    topHostShare: number | null;
    unattributedBlocks: number;
  } | null;
}

export interface DataQualityMeasurementSnapshot {
  sufficient: boolean;
  confidence: 'high' | 'insufficient';
  reasons: string[];
  expectedHeights: number;
  indexedUniqueHeights: number;
  missingHeights: number;
  duplicateHeights: number;
  firstSeenCoveragePercent: number;
  expectedHosts: number;
  staleHosts: number;
  peerObservationCoveragePercent: number;
  duplicatePeerObservations: number;
  observedChainLockLatencyCoveragePercent: number;
  observationGapCount: number;
  observationMessagesMissed: number;
  pendingDkgRounds: number;
}

export interface SimulationMeasurementSnapshot {
  range: MeasurementHeightRange;
  dkg: DkgMeasurementSnapshot;
  chainLock: ChainLockMeasurementSnapshot;
  pose: PoSeMeasurementSnapshot;
  dsl: DslMeasurementSnapshot;
  staking: StakingMeasurementSnapshot;
  dataQuality: DataQualityMeasurementSnapshot;
}

export interface SimulationMeasurementDelta {
  dkgFormationRate: number | null;
  dkgMedianHealthRatio: number | null;
  chainLockCoverage: number | null;
  observedChainLockP95Ms: number | null;
  poseBans: number;
  posePenaltyIncreases: number;
  dslConvergenceRate: number | null;
  stakingMedianIntervalSec: number | null;
  stakingLongestGapSec: number | null;
}

export interface ExpectedActualResult {
  expected: 'available' | 'degraded' | 'unknown';
  actual: 'available' | 'degraded' | 'not-evaluable';
  matched: boolean | null;
  reason: string;
}

export interface SimulationMeasurementReport {
  schemaVersion: 1;
  generatedAtMs: number;
  windows: MeasurementWindowPlan;
  baseline: SimulationMeasurementSnapshot;
  observation: SimulationMeasurementSnapshot;
  delta: SimulationMeasurementDelta;
  expectedVsActual: {
    dkg: ExpectedActualResult;
    chainLock: ExpectedActualResult;
    overall: 'matched' | 'mismatched' | 'not-evaluable';
  };
  verdict: {
    measurementValid: boolean;
    success: boolean;
    reasons: string[];
  };
  evidenceFingerprint: string;
  reportFingerprint: string;
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function inRange(height: number | null, range: MeasurementHeightRange): height is number {
  return height !== null && height >= range.fromHeight && height <= range.toHeight;
}

function rangeSpan(range: MeasurementHeightRange): number {
  return range.toHeight - range.fromHeight + 1;
}

function normalizeEvidence(evidence: SimulationMeasurementEvidence): SimulationMeasurementEvidence {
  return {
    primaryLlmqName: evidence.primaryLlmqName,
    blocks: [...evidence.blocks]
      .map((row) => ({ ...row }))
      .sort((a, b) => a.height - b.height || compareByCodeUnit(a.hash, b.hash)),
    rounds: [...evidence.rounds]
      .map((row) => ({ ...row, invalidMembers: [...row.invalidMembers].sort() }))
      .sort((a, b) => a.expectedHeight - b.expectedHeight || compareByCodeUnit(a.llmqName, b.llmqName)),
    poseEvents: [...evidence.poseEvents]
      .map((row) => ({ ...row }))
      .sort((a, b) => a.height - b.height || compareByCodeUnit(a.type, b.type) || compareByCodeUnit(a.subjectId, b.subjectId)),
    dslEpochs: [...evidence.dslEpochs]
      .map((row) => ({ ...row }))
      .sort((a, b) => a.boundaryHeight - b.boundaryHeight || a.epoch - b.epoch),
    peerObservations: [...evidence.peerObservations]
      .map((row) => ({ ...row }))
      .sort((a, b) =>
        (a.height ?? -1) - (b.height ?? -1) ||
        compareByCodeUnit(a.topic, b.topic) ||
        compareByCodeUnit(a.hostId, b.hostId) ||
        compareByCodeUnit(a.hash, b.hash) ||
        a.receivedAtMs - b.receivedAtMs
      ),
    observationGaps: [...evidence.observationGaps]
      .map((row) => ({ ...row }))
      .sort((a, b) => a.detectedAtMs - b.detectedAtMs || compareByCodeUnit(a.topic, b.topic)),
    // Carried only when false. This function rebuilds the evidence from a fixed
    // field list -- that is what makes the report order-independent -- so a flag
    // not named here is dropped, and the report goes back to reading "no gaps"
    // where it means "no window to look in".
    ...(evidence.observationGapWindowKnown === false ? { observationGapWindowKnown: false } : {}),
    hosts: [...evidence.hosts]
      .map((row) => ({ ...row }))
      .sort((a, b) => compareByCodeUnit(a.hostId, b.hostId) || a.reportedAtMs - b.reportedAtMs),
    expectedHostIds: [...new Set(evidence.expectedHostIds)].sort(),
  };
}

function evidenceForRange(
  evidence: SimulationMeasurementEvidence,
  range: MeasurementHeightRange
): SimulationMeasurementEvidence {
  const blocks = evidence.blocks.filter((row) => inRange(row.height, range));
  const observedTimes = blocks
    .map((row) => row.firstSeenAtMs)
    .filter((value): value is number => value !== null);
  const fromTime = observedTimes.length > 0 ? Math.min(...observedTimes) : null;
  const toTime = observedTimes.length > 0 ? Math.max(...observedTimes) : null;
  return normalizeEvidence({
    primaryLlmqName: evidence.primaryLlmqName,
    blocks,
    rounds: evidence.rounds.filter((row) => inRange(row.expectedHeight, range)),
    poseEvents: evidence.poseEvents.filter((row) => inRange(row.height, range)),
    dslEpochs: evidence.dslEpochs.filter((row) => inRange(row.boundaryHeight, range)),
    peerObservations: evidence.peerObservations.filter((row) => inRange(row.height, range)),
    observationGaps:
      fromTime === null || toTime === null
        ? evidence.observationGaps
        : evidence.observationGaps.filter((row) => row.detectedAtMs >= fromTime && row.detectedAtMs <= toTime),
    ...(evidence.observationGapWindowKnown === false ? { observationGapWindowKnown: false } : {}),
    hosts: evidence.hosts,
    expectedHostIds: evidence.expectedHostIds,
  });
}

/**
 * Round statistics for a window, headline figures scoped to one profile.
 *
 * roundStats states that its input "must belong to a single profile", and the
 * repository loads rounds by height with no llmqName filter, so evidence.rounds
 * always carries every schedule the devnet runs. Reading a rate or a median
 * across that mix produces a number no profile ever had: a window holding
 * llmq_defcon at 0.30 three times beside llmq_60_75 and llmq_400_60 at 1.00
 * reports a median of 0.65, and a delta of -0.35 for a profile whose health did
 * not move at all.
 *
 * The expected-versus-actual comparison further down already scopes itself to
 * primaryLlmqName; this makes the headline agree with it.
 *
 * longestFailureStreak and membersPunished stay as they are on purpose. The
 * streak is a maximum over per-profile streaks, so it is a value some profile
 * genuinely had, and the punished set is a union of real members -- a fact about
 * the network rather than about one schedule.
 */
function dkgSnapshot(
  rounds: readonly MeasurementRoundEvidence[],
  primaryLlmqName: string
): DkgMeasurementSnapshot {
  const byName = new Map<string, MeasurementRoundEvidence[]>();
  for (const round of rounds) {
    const list = byName.get(round.llmqName) ?? [];
    list.push(round);
    byName.set(round.llmqName, list);
  }
  const byProfile = [...byName.entries()]
    .map(([llmqName, list]) => ({
      llmqName,
      dkgInterval: list[0]?.dkgInterval ?? 0,
      ...roundStats(list),
    }))
    .sort((a, b) => a.dkgInterval - b.dkgInterval || compareByCodeUnit(a.llmqName, b.llmqName));
  const primary = byProfile.find((row) => row.llmqName === primaryLlmqName) ?? null;
  const aggregate = roundStats(rounds);
  const punished = new Set(rounds.flatMap((row) => row.invalidMembers));
  return {
    // The count stays across profiles on purpose: "three rounds ran here, none
    // of them yours" is worth seeing, and a test pins it. Only the rates and
    // medians below are scoped, because those are the figures that invent a
    // value no profile had when they are blended.
    rounds: aggregate.rounds,
    formationRate: primary?.formationRate ?? null,
    medianHealthRatio: primary?.medianHealthRatio ?? null,
    worstHealthRatio: primary?.worstHealthRatio ?? null,
    longestFailureStreak: byProfile.reduce((maximum, row) => Math.max(maximum, row.longestFailureStreak), 0),
    membersPunished: punished.size,
    byProfile,
  };
}

function chainLockSnapshot(blocks: readonly MeasurementBlockEvidence[]): ChainLockMeasurementSnapshot {
  const eligible = blocks;
  const locked = eligible.filter((row) => row.hasChainLock);
  const observedLatency = locked
    .filter((row) => row.chainLockSource === 'zmq')
    .map((row) => row.chainLockLatencyMs)
    .filter((value): value is number => value !== null && value >= 0);
  const chainTimestampLatency = locked
    .map((row) => row.chainLockLatencySec)
    .filter((value): value is number => value !== null);
  return {
    eligibleBlocks: eligible.length,
    lockedBlocks: locked.length,
    coverage: eligible.length > 0 ? locked.length / eligible.length : null,
    sourceCounts: {
      zmq: locked.filter((row) => row.chainLockSource === 'zmq').length,
      poll: locked.filter((row) => row.chainLockSource === 'poll').length,
      unknown: locked.filter((row) => row.chainLockSource === null).length,
    },
    observedTimeLatency: {
      basis: 'local block-arrival to local ChainLock-arrival',
      unit: 'milliseconds',
      samples: observedLatency.length,
      p50: percentile(observedLatency, 0.5),
      p95: percentile(observedLatency, 0.95),
    },
    chainTimestampLatency: {
      basis: 'block-header timestamp to local ChainLock-arrival',
      unit: 'seconds',
      samples: chainTimestampLatency.length,
      p50: percentile(chainTimestampLatency, 0.5),
      p95: percentile(chainTimestampLatency, 0.95),
    },
  };
}

const POSE_TYPES: MeasurementPoSeEventEvidence['type'][] = [
  'banned', 'revived', 'penalty_up', 'penalty_down',
  'service_missed', 'service_recovered', 'service_suspended', 'service_banned',
];

function poseSnapshot(events: readonly MeasurementPoSeEventEvidence[]): PoSeMeasurementSnapshot {
  const counts = Object.fromEntries(POSE_TYPES.map((type) => [type, 0])) as PoSeMeasurementSnapshot['events'];
  for (const event of events) counts[event.type] += 1;
  return {
    events: counts,
    distinctSubjectsAffected: new Set(events.map((row) => row.subjectId)).size,
    sourceCounts: {
      listdiff: events.filter((row) => row.source === 'listdiff').length,
      poll: events.filter((row) => row.source === 'poll').length,
    },
  };
}

function dslSnapshot(epochs: readonly MeasurementDslEpochEvidence[]): DslMeasurementSnapshot {
  const committed = epochs.filter((row) => row.status === 'committed');
  const missedRatios = committed
    .filter((row) => row.missedCount !== null && row.listSize !== null && row.listSize > 0)
    .map((row) => row.missedCount! / row.listSize!);
  return {
    epochs: epochs.length,
    committed: committed.length,
    absent: epochs.filter((row) => row.status === 'absent').length,
    convergenceRate: epochs.length > 0 ? committed.length / epochs.length : null,
    totalMissedBits: committed.reduce((total, row) => total + (row.missedCount ?? 0), 0),
    maximumMissedRatio: missedRatios.length > 0 ? Math.max(...missedRatios) : null,
  };
}

function stakingSnapshot(blocks: readonly MeasurementBlockEvidence[]): StakingMeasurementSnapshot {
  const owners = new Map<string, string>();
  for (const block of blocks) {
    if (block.stakerScript !== null && block.stakerHostId !== null) {
      owners.set(block.stakerScript, block.stakerHostId);
    }
  }
  const result = stakingHealth(
    blocks.filter((row) => row.isProofOfStake).map((row) => ({
      height: row.height,
      time: row.time,
      payee: row.stakerScript,
    })),
    owners
  );
  return {
    timingBasis: 'chain-time',
    blocks: result.blocks,
    medianIntervalSec: result.medianIntervalSec,
    meanIntervalSec: result.meanIntervalSec,
    longestGapSec: result.longestGapSec,
    stallCount: result.stallCount,
    distinctStakers: result.distinctStakers,
    scriptHhi: result.hhi,
    scriptGini: result.gini,
    topStakerShare: result.topStakerShare,
    hostGrouping: result.byHost === null ? null : {
      distinctHosts: result.byHost.distinctHosts,
      hhi: result.byHost.hhi,
      topHostShare: result.byHost.topHostShare,
      unattributedBlocks: result.byHost.unattributedBlocks,
    },
  };
}

function dataQualitySnapshot(
  evidence: SimulationMeasurementEvidence,
  range: MeasurementHeightRange,
  generatedAtMs: number
): DataQualityMeasurementSnapshot {
  const policy = SIMULATION_TELEMETRY_POLICY;
  const uniqueHeights = new Set(evidence.blocks.map((row) => row.height));
  const expectedHeights = rangeSpan(range);
  const missingHeights = Math.max(0, expectedHeights - uniqueHeights.size);
  const duplicateHeights = evidence.blocks.length - uniqueHeights.size;
  const firstSeen = evidence.blocks.filter((row) => row.firstSeenAtMs !== null).length;
  const firstSeenCoveragePercent = percent(firstSeen, evidence.blocks.length);

  const expectedHosts = [...new Set(evidence.expectedHostIds)];
  const latestHostReport = new Map<string, number>();
  for (const host of evidence.hosts) {
    latestHostReport.set(host.hostId, Math.max(latestHostReport.get(host.hostId) ?? 0, host.reportedAtMs));
  }
  // Measured against the observing fleet, not against a wall clock.
  //
  // evidence.hosts now carries each host's last report from inside the window,
  // so the question is whether a host kept up with its peers while the window
  // ran -- which the same range always answers the same way. Comparing to
  // generatedAtMs instead made the answer depend on when the report was asked
  // for: a heartbeat after finalize, verify() called every host stale.
  const windowLastReportMs = Math.max(0, ...latestHostReport.values());
  const staleHosts = expectedHosts.filter((hostId) => {
    const reportedAtMs = latestHostReport.get(hostId);
    return reportedAtMs === undefined || windowLastReportMs - reportedAtMs > policy.maximumHostAgeMs;
  }).length;

  const expectedHostSet = new Set(expectedHosts);
  const blockKeys = new Set(evidence.blocks.map((row) => row.hash));
  const lockedKeys = new Set(evidence.blocks.filter((row) => row.hasChainLock).map((row) => row.hash));
  const observationKeys = evidence.peerObservations
    .filter((row) =>
      expectedHostSet.has(row.hostId) &&
      ((row.topic === 'block' && blockKeys.has(row.hash)) ||
        (row.topic === 'chainlock' && lockedKeys.has(row.hash)))
    )
    .map((row) => `${row.hostId}:${row.topic}:${row.hash}`);
  const uniqueObservationKeys = new Set(observationKeys);
  const expectedPeerObservations = expectedHosts.length * (blockKeys.size + lockedKeys.size);
  const peerObservationCoveragePercent = percent(uniqueObservationKeys.size, expectedPeerObservations);
  const duplicatePeerObservations = observationKeys.length - uniqueObservationKeys.size;

  const locked = evidence.blocks.filter((row) => row.hasChainLock);
  const observedLatency = locked.filter((row) =>
    row.chainLockSource === 'zmq' && row.chainLockLatencyMs !== null && row.chainLockLatencyMs >= 0
  ).length;
  const observedChainLockLatencyCoveragePercent = percent(observedLatency, locked.length);
  const observationMessagesMissed = evidence.observationGaps.reduce((total, row) => total + row.missed, 0);

  const reasons: string[] = [];
  if (missingHeights > 0) reasons.push(`${missingHeights} indexed block heights are missing`);
  if (duplicateHeights > 0) reasons.push(`${duplicateHeights} duplicate block heights were returned`);
  if (duplicatePeerObservations > 0) reasons.push(`${duplicatePeerObservations} duplicate peer observations were returned`);
  if (expectedHosts.length === 0) reasons.push('no expected observer hosts were pinned');
  if (evidence.observationGapWindowKnown === false) {
    // Said out loud rather than left as a zero: with no arrival time anywhere in
    // the range there is no window to correlate gaps against, so
    // observationMessagesMissed below is "not measured", not "none".
    reasons.push('observation gaps could not be correlated: no block arrival time in range');
  }
  if (staleHosts > policy.maximumStaleHosts) reasons.push(`${staleHosts} expected observer hosts are stale or missing`);
  if (firstSeenCoveragePercent < policy.minimumObservedBlockTimeCoveragePercent) {
    reasons.push(`observed block-arrival coverage is ${firstSeenCoveragePercent.toFixed(1)}%`);
  }
  if (peerObservationCoveragePercent < policy.minimumPeerObservationCoveragePercent) {
    reasons.push(`peer observation coverage is ${peerObservationCoveragePercent.toFixed(1)}%`);
  }
  if (
    locked.length > 0 &&
    observedChainLockLatencyCoveragePercent < policy.minimumObservedChainLockLatencyCoveragePercent
  ) {
    reasons.push(`observed-time ChainLock latency coverage is ${observedChainLockLatencyCoveragePercent.toFixed(1)}%`);
  }
  if (observationMessagesMissed > policy.maximumObservationMessagesMissed) {
    reasons.push(`${observationMessagesMissed} observer messages were reported missing`);
  }
  return {
    sufficient: reasons.length === 0,
    confidence: reasons.length === 0 ? 'high' : 'insufficient',
    reasons,
    expectedHeights,
    indexedUniqueHeights: uniqueHeights.size,
    missingHeights,
    duplicateHeights,
    firstSeenCoveragePercent,
    expectedHosts: expectedHosts.length,
    staleHosts,
    peerObservationCoveragePercent,
    duplicatePeerObservations,
    observedChainLockLatencyCoveragePercent,
    observationGapCount: evidence.observationGaps.length,
    observationMessagesMissed,
    pendingDkgRounds: evidence.rounds.filter((row) => row.status === 'pending').length,
  };
}

export function createSimulationMeasurementSnapshot(input: {
  evidence: SimulationMeasurementEvidence;
  range: MeasurementHeightRange;
  generatedAtMs: number;
}): SimulationMeasurementSnapshot {
  const evidence = evidenceForRange(input.evidence, input.range);
  return {
    range: input.range,
    dkg: dkgSnapshot(evidence.rounds, input.evidence.primaryLlmqName),
    chainLock: chainLockSnapshot(evidence.blocks),
    pose: poseSnapshot(evidence.poseEvents),
    dsl: dslSnapshot(evidence.dslEpochs),
    staking: stakingSnapshot(evidence.blocks),
    dataQuality: dataQualitySnapshot(evidence, input.range, input.generatedAtMs),
  };
}

function difference(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

function compareSnapshots(
  observation: SimulationMeasurementSnapshot,
  baseline: SimulationMeasurementSnapshot
): SimulationMeasurementDelta {
  return {
    dkgFormationRate: difference(observation.dkg.formationRate, baseline.dkg.formationRate),
    dkgMedianHealthRatio: difference(observation.dkg.medianHealthRatio, baseline.dkg.medianHealthRatio),
    chainLockCoverage: difference(observation.chainLock.coverage, baseline.chainLock.coverage),
    observedChainLockP95Ms: difference(
      observation.chainLock.observedTimeLatency.p95,
      baseline.chainLock.observedTimeLatency.p95
    ),
    poseBans: observation.pose.events.banned - baseline.pose.events.banned,
    posePenaltyIncreases: observation.pose.events.penalty_up - baseline.pose.events.penalty_up,
    dslConvergenceRate: difference(observation.dsl.convergenceRate, baseline.dsl.convergenceRate),
    stakingMedianIntervalSec: difference(observation.staking.medianIntervalSec, baseline.staking.medianIntervalSec),
    stakingLongestGapSec: difference(observation.staking.longestGapSec, baseline.staking.longestGapSec),
  };
}

function expectedAvailability(surviving: number | null, threshold: number): 'available' | 'degraded' | 'unknown' {
  if (surviving === null) return 'unknown';
  return surviving >= threshold ? 'available' : 'degraded';
}

function compareAvailability(input: {
  expected: 'available' | 'degraded' | 'unknown';
  baseline: number | null;
  actual: number | null;
  label: string;
}): ExpectedActualResult {
  if (input.expected === 'unknown') {
    return { expected: 'unknown', actual: 'not-evaluable', matched: null, reason: `${input.label} threshold margin was unknown at dry-run time` };
  }
  if (input.baseline === null || input.actual === null) {
    return { expected: input.expected, actual: 'not-evaluable', matched: null, reason: `${input.label} has no decided samples in both windows` };
  }
  const degraded = input.actual < 0.8 || input.actual < input.baseline - 0.1;
  const actual = degraded ? 'degraded' : 'available';
  return {
    expected: input.expected,
    actual,
    matched: actual === input.expected,
    reason: `${input.label} changed from ${(input.baseline * 100).toFixed(1)}% to ${(input.actual * 100).toFixed(1)}%`,
  };
}

export function computeSimulationMeasurementReport(input: {
  faultStartHeight: number;
  faultEndHeight: number;
  generatedAtMs: number;
  impact: DryRunImpactEstimate;
  evidence: SimulationMeasurementEvidence;
}): SimulationMeasurementReport {
  const windows = planMeasurementWindowsForLlmqFault({
    primaryLlmqName: input.evidence.primaryLlmqName,
    faultStartHeight: input.faultStartHeight,
    faultEndHeight: input.faultEndHeight,
  });
  const baselineEvidence = evidenceForRange(input.evidence, windows.baseline);
  const observationEvidence = evidenceForRange(input.evidence, windows.observation);
  const baseline = createSimulationMeasurementSnapshot({
    evidence: baselineEvidence,
    range: windows.baseline,
    generatedAtMs: input.generatedAtMs,
  });
  const observation = createSimulationMeasurementSnapshot({
    evidence: observationEvidence,
    range: windows.observation,
    generatedAtMs: input.generatedAtMs,
  });
  const delta = compareSnapshots(observation, baseline);
  const dkg = compareAvailability({
    expected: expectedAvailability(input.impact.survivingCurrentQuorumMembers, input.impact.dkgThreshold),
    baseline: baseline.dkg.byProfile.find((row) => row.llmqName === input.evidence.primaryLlmqName)?.formationRate ?? null,
    actual: observation.dkg.byProfile.find((row) => row.llmqName === input.evidence.primaryLlmqName)?.formationRate ?? null,
    label: 'DKG formation',
  });
  const chainLock = compareAvailability({
    expected: expectedAvailability(input.impact.survivingCurrentQuorumMembers, input.impact.chainLockThreshold),
    baseline: baseline.chainLock.coverage,
    actual: observation.chainLock.coverage,
    label: 'ChainLock coverage',
  });
  const comparisons = [dkg, chainLock];
  const overall: SimulationMeasurementReport['expectedVsActual']['overall'] = comparisons.some((row) => row.matched === null)
    ? 'not-evaluable'
    : comparisons.every((row) => row.matched)
      ? 'matched'
      : 'mismatched';

  const baselineGate = baselineEvidenceSatisfies({
    fromHeight: windows.baseline.fromHeight,
    toHeight: windows.baseline.toHeight,
    indexedBlocks: baseline.dataQuality.indexedUniqueHeights,
    resolvedDkgRounds: (() => {
      const primary = baseline.dkg.byProfile.find((row) => row.llmqName === input.evidence.primaryLlmqName);
      return primary === undefined
        ? 0
        : primary.rounds.formed + primary.rounds.failed + primary.rounds.impossible;
    })(),
    chainLockedBlocks: baseline.chainLock.lockedBlocks,
    // Already scoped to the primary profile by dkgSnapshot, so this is the
    // health of the schedule the run is about rather than a blend.
    medianHealthRatio: baseline.dkg.medianHealthRatio,
    poseRevivedEvents: baseline.pose.events.revived,
  }, windows);
  const verdictReasons = [
    ...baselineGate.reasons.map((reason) => `baseline: ${reason}`),
    ...baseline.dataQuality.reasons.map((reason) => `baseline telemetry: ${reason}`),
    ...observation.dataQuality.reasons.map((reason) => `observation telemetry: ${reason}`),
  ];
  if (overall === 'not-evaluable') verdictReasons.push('expected-versus-actual result is not evaluable');
  if (overall === 'mismatched') verdictReasons.push('actual result did not match the dry-run expectation');
  const measurementValid = baselineGate.passed && baseline.dataQuality.sufficient && observation.dataQuality.sufficient;
  const evidenceFingerprint = simulationFingerprint({ baseline: baselineEvidence, observation: observationEvidence });
  const reportWithoutFingerprint = {
    schemaVersion: 1 as const,
    generatedAtMs: input.generatedAtMs,
    windows,
    baseline,
    observation,
    delta,
    expectedVsActual: { dkg, chainLock, overall },
    verdict: {
      measurementValid,
      success: measurementValid && overall === 'matched',
      reasons: verdictReasons,
    },
    evidenceFingerprint,
  };
  return {
    ...reportWithoutFingerprint,
    reportFingerprint: simulationFingerprint(reportWithoutFingerprint),
  };
}
