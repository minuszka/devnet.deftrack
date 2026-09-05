import { compareByCodeUnit } from '../domain/codeUnitOrder.js';
import { simulationFingerprint } from '../domain/simulationAudit.js';
import { chainlockProfileNameAtHeight, LLMQ_PROFILES } from '../config/llmq.js';
import { Block } from '../models/Block.js';
import { MasternodeEvent } from '../models/MasternodeEvent.js';
import { ObservationGap } from '../models/ObservationGap.js';
import { PeerObservation } from '../models/PeerObservation.js';
import { QuorumRound } from '../models/QuorumRound.js';
import { ServiceEpoch } from '../models/ServiceEpoch.js';
import { SimulationMeasurementReportModel } from '../models/SimulationMeasurementReport.js';
import { SimulationRun } from '../models/SimulationRun.js';
import { SimulationRunArtifact } from '../models/SimulationRunArtifact.js';
import { StakeScriptObservation } from '../models/StakeScriptObservation.js';
import { Transaction } from '../models/Transaction.js';
import { resolveScriptOwners } from '../domain/stakeAttribution.js';
import type { DryRunPlan } from '../simulator/scenarioTypes.js';
import type {
  SimulationMeasurementEvidence,
  MeasurementPoSeEventEvidence,
} from '../simulator/simulationMeasurement.js';
import type {
  SimulationMeasurementContext,
  SimulationMeasurementRecord,
  SimulationMeasurementRepository,
} from './simulationMeasurement.service.js';

const POSE_MEASUREMENT_TYPES: MeasurementPoSeEventEvidence['type'][] = [
  'banned', 'revived', 'penalty_up', 'penalty_down',
  'service_missed', 'service_recovered', 'service_suspended', 'service_banned',
];


function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11_000;
}

function recordFromLean(value: unknown): SimulationMeasurementRecord {
  const row = value as SimulationMeasurementRecord;
  return {
    reportId: row.reportId,
    runKey: row.runKey,
    anchor: row.anchor,
    evidenceFingerprint: row.evidenceFingerprint,
    reportFingerprint: row.reportFingerprint,
    report: row.report,
    generatedAtMs: row.generatedAtMs,
  };
}

function positiveScriptFor(outputs: readonly { valueSat: unknown; scriptHex: string | null }[]): string | null {
  for (const output of outputs) {
    const value = Number(
      typeof output.valueSat === 'object' && output.valueSat !== null && 'toString' in output.valueSat
        ? output.valueSat.toString()
        : output.valueSat
    );
    if (output.scriptHex && Number.isFinite(value) && value > 0) return output.scriptHex.toLowerCase();
  }
  return null;
}

export class MongoSimulationMeasurementRepository implements SimulationMeasurementRepository {
  async loadContext(runKey: string): Promise<SimulationMeasurementContext | null> {
    const [run, artifacts] = await Promise.all([
      SimulationRun.findOne({ runKey })
        .select('runKey metadata.targetSnapshot.hostRef')
        .lean(),
      SimulationRunArtifact.find({ runKey, kind: 'dry-run' })
        .sort({ atMs: 1, artifactId: 1 })
        .select('payload payloadFingerprint')
        .lean(),
    ]);
    if (run === null || artifacts.length === 0) return null;
    if (artifacts.length !== 1) throw new Error('simulation run has multiple immutable DryRun artifacts');
    const artifact = artifacts[0]!;
    if (simulationFingerprint(artifact.payload) !== artifact.payloadFingerprint) {
      throw new Error('stored DryRun artifact fingerprint is invalid');
    }
    const plan = (artifact.payload as { plan?: DryRunPlan }).plan;
    if (
      plan === undefined ||
      plan.runKey !== runKey ||
      simulationFingerprint({
        ...plan,
        planFingerprint: undefined,
      }) !== plan.planFingerprint
    ) {
      throw new Error('stored DryRun plan is invalid');
    }
    return {
      runKey,
      impact: plan.impact,
      expectedHostIds: [...new Set(run.metadata.targetSnapshot.map((target) => target.hostRef))].sort(),
    };
  }

  async loadEvidence(input: {
    fromHeight: number;
    toHeight: number;
    faultStartHeight: number;
    expectedHostIds: readonly string[];
    generatedAtMs: number;
  }): Promise<SimulationMeasurementEvidence> {
    const height = { $gte: input.fromHeight, $lte: input.toHeight };
    const [blocks, coinstakes, rounds, poseEvents, dslEpochs, peerObservations, stakeSightings, tip] = await Promise.all([
      Block.find({ height }).sort({ height: 1 }).select(
        'height hash time isProofOfStake hasChainLock chainLockSource chainLockLatencyMs chainLockLatencySec firstSeenAt'
      ).lean(),
      Transaction.find({ height, isCoinstake: true }).sort({ height: 1, txid: 1 }).select('height txid vout.valueSat vout.scriptHex').lean(),
      QuorumRound.find({ expectedHeight: height }).sort({ expectedHeight: 1, llmqName: 1 }).select(
        'llmqName dkgInterval expectedHeight status healthRatio invalidMembers'
      ).lean(),
      MasternodeEvent.find({ height, type: { $in: POSE_MEASUREMENT_TYPES } }).sort({ height: 1, eventKey: 1 }).select(
        'height type source proTxHash'
      ).lean(),
      ServiceEpoch.find({ boundaryHeight: height }).sort({ boundaryHeight: 1, epoch: 1 }).select(
        'epoch boundaryHeight status missedCount listSize'
      ).lean(),
      PeerObservation.find({ height, host: { $in: input.expectedHostIds } }).sort({ height: 1, topic: 1, host: 1 }).select(
        'host topic hash height receivedAt clockOffsetMs resolutionMs'
      ).lean(),
      // Host attribution from the same immutable, window-scoped source as
      // presence above, not from the live HostStatus view. HostStatus.stakeScripts
      // is overwritten on every agent post, so a report built from it did not
      // recompute: the same coinstake resolved to a different host -- and a
      // different fingerprint -- depending on when finalize/verify ran, and a
      // re-finalize on the same anchor could throw an unrecoverable REPORT_CONFLICT.
      // StakeScriptObservation is append-only and keyed by (height, host); the
      // same window always reads the same rows.
      StakeScriptObservation.find({
        host: { $in: input.expectedHostIds },
        height: { $gte: input.fromHeight, $lte: input.toHeight },
      }).sort({ height: 1, script: 1, host: 1 }).select('host script height').lean(),
      // The live tip, for the finalize settledness gate only. Never fingerprinted.
      Block.findOne().sort({ height: -1 }).select('height').lean(),
    ]);

    // Ambiguity (a script two hosts both claim) resolves to null exactly as the
    // old cross-host collision did; a script no host reported in the window is
    // left unattributed rather than credited to whoever posted last.
    const ownerByScript = resolveScriptOwners(stakeSightings, {
      fromHeight: input.fromHeight,
      toHeight: input.toHeight,
    });
    const scriptByHeight = new Map<number, string>();
    for (const transaction of coinstakes) {
      if (scriptByHeight.has(transaction.height)) continue;
      const script = positiveScriptFor(transaction.vout);
      if (script !== null) scriptByHeight.set(transaction.height, script);
    }

    const observedTimes = blocks
      .map((block) => block.firstSeenAt?.getTime() ?? null)
      .filter((value): value is number => value !== null);
    // Observation gaps are correlated against the window the measured blocks
    // were actually SEEN in, so with no arrival time anywhere in the range there
    // is no window -- and none is invented.
    //
    // It used to guess one: `generatedAtMs` back by an estimated block interval
    // per height. That window has no relation to the heights being measured, so
    // it could pull in gaps from an unrelated period and hand them to the report
    // as this run's, and it did so silently -- the sum below is a real-looking
    // number either way. The honest answer to "when were these blocks seen?" when
    // nothing recorded it is that it is not known.
    const observationGapWindowKnown = observedTimes.length > 0;
    const observationGaps = !observationGapWindowKnown
      ? []
      : await ObservationGap.find({
        detectedAt: {
          $gte: new Date(Math.min(...observedTimes)),
          $lte: new Date(Math.max(...observedTimes)),
        },
      }).sort({ detectedAt: 1 }).select('topic missed detectedAt').lean();

    return {
      primaryLlmqName: chainlockProfileNameAtHeight(input.faultStartHeight),
      // Only when false: absent means known, so a measurement taken before this
      // field existed keeps the fingerprint it had.
      ...(observationGapWindowKnown ? {} : { observationGapWindowKnown: false }),
      blocks: blocks.map((block) => {
        const stakerScript = scriptByHeight.get(block.height) ?? null;
        return {
          height: block.height,
          hash: block.hash,
          time: block.time,
          isProofOfStake: block.isProofOfStake,
          hasChainLock: block.hasChainLock,
          chainLockSource: block.chainLockSource,
          chainLockLatencyMs: block.chainLockLatencyMs,
          chainLockLatencySec: block.chainLockLatencySec,
          firstSeenAtMs: block.firstSeenAt?.getTime() ?? null,
          stakerScript,
          stakerHostId: stakerScript === null ? null : ownerByScript.get(stakerScript) ?? null,
        };
      }),
      rounds: rounds.map((round) => ({
        llmqName: round.llmqName,
        dkgInterval: round.dkgInterval,
        // From the profile registry: the round document records the schedule it
        // ran under, not the phase layout, and the window needs both.
        dkgPhaseBlocks: LLMQ_PROFILES[round.llmqName]?.dkgPhaseBlocks ?? 0,
        expectedHeight: round.expectedHeight,
        status: round.status,
        healthRatio: round.healthRatio,
        invalidMembers: [...round.invalidMembers],
      })),
      poseEvents: poseEvents.map((event) => ({
        height: event.height,
        type: event.type as MeasurementPoSeEventEvidence['type'],
        source: event.source,
        subjectId: event.proTxHash,
      })),
      dslEpochs: dslEpochs.map((epoch) => ({
        epoch: epoch.epoch,
        boundaryHeight: epoch.boundaryHeight,
        status: epoch.status,
        missedCount: epoch.missedCount,
        listSize: epoch.listSize,
      })),
      peerObservations: peerObservations.map((observation) => ({
        hostId: observation.host,
        topic: observation.topic,
        hash: observation.hash,
        height: observation.height,
        receivedAtMs: observation.receivedAt.getTime(),
        clockOffsetMs: observation.clockOffsetMs,
        resolutionMs: observation.resolutionMs,
      })),
      observationGaps: observationGaps.map((gap) => ({
        topic: gap.topic,
        missed: gap.missed,
        detectedAtMs: gap.detectedAt.getTime(),
      })),
      // Observer presence, derived from the measured range rather than read
      // from the current view.
      //
      // HostStatus is overwritten per host on every agent post -- its own model
      // comment says so -- and a report built from it does not recompute: one
      // heartbeat after finalize, verify() paired a frozen generatedAtMs with a
      // live reportedAt and answered measurementValid:false for a report that
      // had just answered true. PeerObservation is the immutable half the same
      // comment points at, it is keyed by (height, host), and it is already
      // loaded above for coverage.
      //
      // So a host's presence is now the last moment it was seen reporting
      // INSIDE the window, which is the question the staleness check was always
      // trying to ask, and which the same range always answers the same way.
      hosts: [...peerObservations.reduce((byHost, observation) => {
        const previous = byHost.get(observation.host);
        const receivedAtMs = observation.receivedAt.getTime();
        if (previous === undefined || receivedAtMs > previous) byHost.set(observation.host, receivedAtMs);
        return byHost;
      }, new Map<string, number>())]
        .map(([hostId, reportedAtMs]) => ({ hostId, reportedAtMs }))
        .sort((a, b) => compareByCodeUnit(a.hostId, b.hostId)),
      expectedHostIds: [...input.expectedHostIds],
      // Fall back to the window end when the tip cannot be read: that places
      // every in-window round inside the re-read band, so the settledness gate
      // fails closed rather than finalizing on a tip it could not confirm.
      tipHeight: tip?.height ?? input.toHeight,
    };
  }

  async insertReport(record: SimulationMeasurementRecord): Promise<'inserted' | 'existing'> {
    try {
      await SimulationMeasurementReportModel.create(record);
      return 'inserted';
    } catch (error) {
      if (isDuplicateKey(error)) return 'existing';
      throw error;
    }
  }

  async findReport(reportId: string): Promise<SimulationMeasurementRecord | null> {
    const found = await SimulationMeasurementReportModel.findOne({ reportId })
      .select('-_id -createdAt')
      .lean();
    return found === null ? null : recordFromLean(found);
  }

  async findLatestReport(runKey: string): Promise<SimulationMeasurementRecord | null> {
    const found = await SimulationMeasurementReportModel.findOne({ runKey })
      .sort({ generatedAtMs: -1, reportId: 1 })
      .select('-_id -createdAt')
      .lean();
    return found === null ? null : recordFromLean(found);
  }
}
