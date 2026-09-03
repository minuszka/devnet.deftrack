import type { FilterQuery } from 'mongoose';
import type { LiveRunLock } from '../domain/liveRunLock.js';
import type { SimulationRunState } from '../domain/simulationRunState.js';
import { reconcilableRunFilter } from '../domain/reconcileSweep.js';
import { SimulationAction } from '../models/SimulationAction.js';
import { SimulationAuditEvent } from '../models/SimulationAuditEvent.js';
import { SimulationLiveRunLock } from '../models/SimulationLiveRunLock.js';
import { SimulationRun, type SimulationRunDocument, type SimulationRecoveryResult } from '../models/SimulationRun.js';
import { SimulationTarget } from '../models/SimulationTarget.js';
import { SimulationControlRequest } from '../models/SimulationControlRequest.js';
import { SimulationRunArtifact } from '../models/SimulationRunArtifact.js';
import { SimulationMeasurementReportModel } from '../models/SimulationMeasurementReport.js';
import type { SimulationRunAuditRecord } from '../domain/simulationAudit.js';
import type {
  AppendSimulationAuditResult,
  SimulationPersistenceRepository,
  SimulationRunProjection,
} from './simulationPersistence.service.js';

function projectionFromLean(value: unknown): SimulationRunProjection {
  const doc = value as SimulationRunProjection;
  return {
    runKey: doc.runKey,
    metadataFingerprint: doc.metadataFingerprint,
    metadata: doc.metadata,
    state: doc.state,
  };
}

function auditFromLean(value: unknown): SimulationRunAuditRecord {
  return value as SimulationRunAuditRecord;
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11_000;
}

/** Must complete before any controller accepts a simulation create/start. */
export async function initializeSimulationPersistenceIndexes(): Promise<void> {
  await Promise.all([
    SimulationRun.init(),
    SimulationAction.init(),
    SimulationAuditEvent.init(),
    SimulationTarget.init(),
    SimulationLiveRunLock.init(),
    SimulationControlRequest.init(),
    SimulationRunArtifact.init(),
    SimulationMeasurementReportModel.init(),
  ]);
}

/** Mongo projection/audit adapter; all race decisions remain in the pure service. */
export class MongoSimulationPersistenceRepository implements SimulationPersistenceRepository {
  async findRun(runKey: string): Promise<SimulationRunProjection | null> {
    const found = await SimulationRun.findOne({ runKey })
      .select('runKey metadataFingerprint metadata state')
      .lean();
    return found === null ? null : projectionFromLean(found);
  }

  /**
   * The keys of runs a reconcile sweep should visit this tick. Bounded, oldest
   * first: a backlog is worked steadily rather than all at once, and the cap
   * keeps one tick's load fixed. Not on the shared repository interface -- only
   * the sweeper needs it.
   */
  async findReconcilableRunKeys(nowMs: number, limit = 200): Promise<string[]> {
    const rows = await SimulationRun.find(reconcilableRunFilter(nowMs) as FilterQuery<SimulationRunDocument>)
      .select('runKey')
      .sort({ 'state.updatedAtMs': 1 })
      .limit(limit)
      .lean<{ runKey: string }[]>();
    return rows.map((row) => row.runKey);
  }

  /**
   * Live runs whose fault is applied and whose observation window may have
   * opened. The sweep decides that from the chain; this only narrows the set.
   */
  async findObservationCandidateRunKeys(limit = 50): Promise<string[]> {
    const rows = await SimulationRun.find({ 'state.status': 'fault_active', 'state.live': true })
      .select('runKey')
      .sort({ 'state.updatedAtMs': 1 })
      .limit(limit)
      .lean<{ runKey: string }[]>();
    return rows.map((row) => row.runKey);
  }

  /**
   * Runs that carry both fault boundaries and have no report yet.
   *
   * Filtered on the report rather than left to finalize's idempotency: a report
   * already written would otherwise be recomputed on every tick for ever, and
   * `compute` re-reads the whole evidence set to do it.
   */
  /** Records, once, that a run's boundaries leave nothing to measure. */
  async markMeasurementUnavailable(input: { runKey: string; reason: string; nowMs: number }): Promise<void> {
    await SimulationRun.updateOne(
      { runKey: input.runKey, 'measurement.unavailable': { $ne: true } },
      { $set: { measurement: { unavailable: true, reason: input.reason, decidedAtMs: input.nowMs } } }
    );
  }

  async findFinalizeCandidateRunKeys(limit = 50): Promise<string[]> {
    const rows = await SimulationRun.find({
      'state.faultActivatedTip.height': { $exists: true },
      'state.recoveredTip.height': { $exists: true },
      // A run already found to have nothing to measure is not a candidate. The
      // decision is permanent -- its anchors cannot change -- so offering it
      // again would only be retrying a refusal.
      'measurement.unavailable': { $ne: true },
    })
      .select('runKey')
      .sort({ 'state.updatedAtMs': 1 })
      .limit(limit)
      .lean<{ runKey: string }[]>();
    if (rows.length === 0) return [];
    const runKeys = rows.map((row) => row.runKey);
    const reported = await SimulationMeasurementReportModel.find({ runKey: { $in: runKeys } })
      .select('runKey')
      .lean<{ runKey: string }[]>();
    const done = new Set(reported.map((row) => row.runKey));
    return runKeys.filter((runKey) => !done.has(runKey));
  }

  async insertRun(projection: SimulationRunProjection): Promise<'inserted' | 'existing'> {
    const result = await SimulationRun.updateOne(
      { runKey: projection.runKey },
      {
        $setOnInsert: {
          runKey: projection.runKey,
          metadataFingerprint: projection.metadataFingerprint,
          metadata: projection.metadata,
          state: projection.state,
          preflight: [],
          recovery: { required: false, targets: [], allClear: false },
          dataQuality: null,
        },
      },
      { upsert: true }
    );
    return result.upsertedCount === 1 ? 'inserted' : 'existing';
  }

  async compareAndSwapRun(
    runKey: string,
    expectedRevision: number,
    nextState: SimulationRunState,
    recovery?: SimulationRecoveryResult
  ): Promise<boolean> {
    const set: Record<string, unknown> = { state: nextState };
    // Only when a recovery outcome is supplied: state-only transitions never
    // touch the recovery subfield, so they cannot blank it.
    if (recovery !== undefined) set.recovery = recovery;
    const result = await SimulationRun.updateOne(
      { runKey, 'state.revision': expectedRevision },
      { $set: set }
    );
    return result.modifiedCount === 1;
  }

  async writeRecoveryForEvent(
    runKey: string,
    eventId: string,
    recovery: SimulationRecoveryResult
  ): Promise<boolean> {
    // Guard on the run being at the state this transition produced, not on a
    // revision: whoever applied the transition -- our CAS or loadRun's repair --
    // set lastTransition to this event, and that is the moment the findings belong
    // to. matchedCount, not modifiedCount, so an idempotent re-write still counts.
    const result = await SimulationRun.updateOne(
      { runKey, 'state.lastTransition.eventId': eventId },
      { $set: { recovery } }
    );
    return result.matchedCount >= 1;
  }

  async findRecovery(runKey: string): Promise<SimulationRecoveryResult | null> {
    const found = await SimulationRun.findOne({ runKey }).select('recovery').lean<{ recovery?: SimulationRecoveryResult } | null>();
    return found?.recovery ?? null;
  }

  async findRunAuditByEventId(
    runKey: string,
    eventId: string
  ): Promise<SimulationRunAuditRecord | null> {
    const found = await SimulationAuditEvent.findOne({ stream: 'run', runKey, eventId }).lean();
    return found === null ? null : auditFromLean(found);
  }

  async listRunAudit(runKey: string): Promise<SimulationRunAuditRecord[]> {
    const events = await SimulationAuditEvent.find({ stream: 'run', runKey })
      .sort({ sequence: 1 })
      .lean();
    return events.map(auditFromLean);
  }

  async appendRunAudit(event: SimulationRunAuditRecord): Promise<AppendSimulationAuditResult> {
    try {
      await SimulationAuditEvent.create(event);
      return { disposition: 'inserted' };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;

      const byEvent = await SimulationAuditEvent.findOne({
        stream: 'run',
        runKey: event.runKey,
        eventId: event.eventId,
      }).lean();
      if (byEvent !== null) {
        return { disposition: 'duplicate-event', existing: auditFromLean(byEvent) };
      }

      const bySequence = await SimulationAuditEvent.findOne({
        stream: 'run',
        subjectId: event.runKey,
        sequence: event.sequence,
      }).lean();
      if (bySequence !== null) {
        return { disposition: 'sequence-conflict', existing: auditFromLean(bySequence) };
      }
      // A duplicate on neither declared idempotency index indicates a schema
      // or deployment mismatch and must not be guessed away.
      throw error;
    }
  }
}

export interface SimulationLiveRunLockRepository {
  find(): Promise<LiveRunLock | null>;
  compareAndSwap(expectedRevision: number | null, next: LiveRunLock): Promise<boolean>;
}

function lockFromLean(value: unknown): LiveRunLock {
  const lock = value as {
    status: 'held' | 'released';
    scope: 'devnet-live';
    runKey: string | null;
    ownerId: string | null;
    acquiredAtMs: number | null;
    leaseUntilMs: number | null;
    releasedAtMs?: number | null;
    revision: number;
  };
  if (lock.status === 'held') {
    if (
      lock.runKey === null ||
      lock.ownerId === null ||
      lock.acquiredAtMs === null ||
      lock.leaseUntilMs === null
    ) {
      throw new Error('persisted held simulation lock is incomplete');
    }
    return {
      scope: lock.scope,
      status: 'held',
      runKey: lock.runKey,
      ownerId: lock.ownerId,
      acquiredAtMs: lock.acquiredAtMs,
      leaseUntilMs: lock.leaseUntilMs,
      revision: lock.revision,
    };
  }
  if (lock.releasedAtMs === null || lock.releasedAtMs === undefined) {
    throw new Error('persisted released simulation lock has no release time');
  }
  return {
    scope: lock.scope,
    status: 'released',
    runKey: null,
    ownerId: null,
    acquiredAtMs: null,
    leaseUntilMs: null,
    releasedAtMs: lock.releasedAtMs,
    revision: lock.revision,
  };
}

function lockFields(lock: LiveRunLock): Record<string, unknown> {
  return lock.status === 'held'
    ? {
        scope: lock.scope,
        status: lock.status,
        runKey: lock.runKey,
        ownerId: lock.ownerId,
        acquiredAtMs: lock.acquiredAtMs,
        leaseUntilMs: lock.leaseUntilMs,
        releasedAtMs: null,
        revision: lock.revision,
      }
    : {
        scope: lock.scope,
        status: lock.status,
        runKey: null,
        ownerId: null,
        acquiredAtMs: null,
        leaseUntilMs: null,
        releasedAtMs: lock.releasedAtMs,
        revision: lock.revision,
      };
}

export class MongoSimulationLiveRunLockRepository
  implements SimulationLiveRunLockRepository
{
  async find(): Promise<LiveRunLock | null> {
    const found = await SimulationLiveRunLock.findOne({ scope: 'devnet-live' }).lean();
    return found === null ? null : lockFromLean(found);
  }

  async compareAndSwap(expectedRevision: number | null, next: LiveRunLock): Promise<boolean> {
    if (expectedRevision === null) {
      try {
        const result = await SimulationLiveRunLock.updateOne(
          { scope: 'devnet-live' },
          { $setOnInsert: lockFields(next) },
          { upsert: true }
        );
        return result.upsertedCount === 1;
      } catch (error) {
        if (isDuplicateKey(error)) return false;
        throw error;
      }
    }

    const result = await SimulationLiveRunLock.updateOne(
      { scope: 'devnet-live', revision: expectedRevision },
      { $set: lockFields(next) }
    );
    return result.modifiedCount === 1;
  }
}
