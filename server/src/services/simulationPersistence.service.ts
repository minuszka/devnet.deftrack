import {
  createSimulationRunState,
  reconcilePersistedSimulationRun,
  transitionSimulationRun,
  type SimulationRunEvent,
  type SimulationRunState,
} from '../domain/simulationRunState.js';
import { simulationRunKeyFor } from '../domain/simulationIdentity.js';
import {
  SimulationAuditError,
  creationAuditRecord,
  replaySimulationRunAudit,
  sameAuditRequest,
  simulationFingerprint,
  simulationRunEventFingerprint,
  simulationSystemTransitionFingerprint,
  transitionAuditRecord,
  type SimulationRunAuditRecord,
} from '../domain/simulationAudit.js';
import type {
  SimulationAuditActor,
  SimulationRecoveryResult,
  SimulationRunMetadata,
} from '../models/SimulationRun.js';
import type { DryRunPlan } from '../simulator/scenarioTypes.js';
import { deriveSimulationRunTiming } from '../simulator/simulationTiming.js';

export interface SimulationRunProjection {
  runKey: string;
  metadataFingerprint: string;
  metadata: SimulationRunMetadata;
  state: SimulationRunState;
}

export type AppendSimulationAuditResult =
  | { disposition: 'inserted' }
  | {
      disposition: 'duplicate-event' | 'sequence-conflict';
      existing: SimulationRunAuditRecord;
    };

/** Storage port. The Mongo implementation follows this with unique indexes and CAS. */
export interface SimulationPersistenceRepository {
  findRun(runKey: string): Promise<SimulationRunProjection | null>;
  insertRun(projection: SimulationRunProjection): Promise<'inserted' | 'existing'>;
  compareAndSwapRun(
    runKey: string,
    expectedRevision: number,
    nextState: SimulationRunState,
    // Written in the same revision-guarded step as the state, so a recovery
    // result cannot be clobbered by, or lost to, a concurrent transition. An
    // implementation that predates this parameter still satisfies the port; it
    // simply never writes the recovery subfield.
    recovery?: SimulationRecoveryResult
  ): Promise<boolean>;
  findRunAuditByEventId(runKey: string, eventId: string): Promise<SimulationRunAuditRecord | null>;
  listRunAudit(runKey: string): Promise<SimulationRunAuditRecord[]>;
  appendRunAudit(event: SimulationRunAuditRecord): Promise<AppendSimulationAuditResult>;
}

export class SimulationPersistenceError extends Error {
  constructor(
    public readonly code:
      | 'RUN_NOT_FOUND'
      | 'RUN_METADATA_CONFLICT'
      | 'IDEMPOTENCY_CONFLICT'
      | 'PROJECTION_AHEAD_OF_AUDIT'
      | 'PROJECTION_DIVERGED'
      | 'CONCURRENT_TRANSITION',
    message: string
  ) {
    super(message);
    this.name = 'SimulationPersistenceError';
  }
}

const MAX_CAS_ATTEMPTS = 5;

/**
 * Standalone-Mongo-compatible event-source persistence.
 *
 * The immutable event is inserted before its mutable projection is updated.
 * If the process dies between those operations, `loadRun` repairs the
 * projection from the audit stream. A unique `(run, sequence)` index elects
 * one concurrent transition without requiring replica-set transactions.
 */
export class SimulationPersistenceService {
  constructor(private readonly repository: SimulationPersistenceRepository) {}

  async createRun(input: {
    idempotencyKey: string;
    live: boolean;
    createdAtMs: number;
    metadata: SimulationRunMetadata;
    dryRunPlan: DryRunPlan;
  }): Promise<SimulationRunProjection> {
    const runKey = simulationRunKeyFor(input.idempotencyKey);
    if (
      input.dryRunPlan.runKey !== runKey ||
      input.dryRunPlan.network !== input.metadata.network ||
      input.dryRunPlan.scenarioId !== input.metadata.scenarioId ||
      input.dryRunPlan.scenarioVersion !== input.metadata.scenarioVersion ||
      input.dryRunPlan.seed !== input.metadata.seed ||
      simulationFingerprint(input.dryRunPlan.parameters) !== simulationFingerprint(input.metadata.parameters)
    ) {
      throw new SimulationPersistenceError(
        'RUN_METADATA_CONFLICT',
        'DryRun plan does not match immutable run metadata'
      );
    }
    const timing = deriveSimulationRunTiming(input.dryRunPlan, input.createdAtMs);
    const state = createSimulationRunState({
      runKey,
      live: input.live,
      createdAtMs: input.createdAtMs,
      runExpiresAtMs: timing.runExpiresAtMs,
    });
    const audit = creationAuditRecord({
      state,
      metadata: input.metadata,
      actor: input.metadata.requestedBy,
    });
    const append = await this.repository.appendRunAudit(audit);

    if (
      append.disposition !== 'inserted' &&
      (append.disposition !== 'duplicate-event' ||
        append.existing.eventId !== audit.eventId ||
        !sameAuditRequest(append.existing, audit.eventType, audit.requestFingerprint))
    ) {
      throw new SimulationPersistenceError(
        'RUN_METADATA_CONFLICT',
        'idempotency key is already bound to different run metadata'
      );
    }

    const projection: SimulationRunProjection = {
      runKey,
      metadataFingerprint: simulationFingerprint(input.metadata),
      metadata: input.metadata,
      state,
    };
    await this.repository.insertRun(projection);
    const repaired = await this.loadRun(runKey);
    if (repaired.metadataFingerprint !== projection.metadataFingerprint) {
      throw new SimulationPersistenceError(
        'RUN_METADATA_CONFLICT',
        'existing run metadata does not match the idempotent create request'
      );
    }
    return repaired;
  }

  async loadRun(runKey: string): Promise<SimulationRunProjection> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const events = await this.repository.listRunAudit(runKey);
      if (events.length === 0) {
        throw new SimulationPersistenceError('RUN_NOT_FOUND', `simulation run ${runKey} not found`);
      }
      const replayed = replaySimulationRunAudit(events);
      let projection = await this.repository.findRun(runKey);

      if (projection === null) {
        await this.repository.insertRun({ runKey, ...replayed });
        projection = await this.repository.findRun(runKey);
        if (projection === null) continue;
      }

      if (projection.metadataFingerprint !== replayed.metadataFingerprint) {
        throw new SimulationPersistenceError(
          'RUN_METADATA_CONFLICT',
          `simulation run ${runKey} metadata diverged from its audit creation event`
        );
      }
      if (projection.state.revision > replayed.state.revision) {
        throw new SimulationPersistenceError(
          'PROJECTION_AHEAD_OF_AUDIT',
          `simulation run ${runKey} projection is ahead of its audit stream`
        );
      }
      if (projection.state.revision === replayed.state.revision) {
        if (simulationFingerprint(projection.state) !== simulationFingerprint(replayed.state)) {
          throw new SimulationPersistenceError(
            'PROJECTION_DIVERGED',
            `simulation run ${runKey} projection differs from its audit stream`
          );
        }
        return projection;
      }

      const repaired = await this.repository.compareAndSwapRun(
        runKey,
        projection.state.revision,
        replayed.state
      );
      if (repaired) {
        return { ...projection, state: replayed.state };
      }
    }

    throw new SimulationPersistenceError(
      'CONCURRENT_TRANSITION',
      `simulation run ${runKey} changed repeatedly while repairing its projection`
    );
  }

  /** Read-only authoritative history for the private control API. */
  async listRunAudit(runKey: string): Promise<SimulationRunAuditRecord[]> {
    await this.loadRun(runKey);
    return this.repository.listRunAudit(runKey);
  }

  async transitionRun(input: {
    runKey: string;
    event: SimulationRunEvent;
    actor: SimulationAuditActor;
  }): Promise<SimulationRunProjection> {
    const fingerprint = simulationRunEventFingerprint(input.event);

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const current = await this.loadRun(input.runKey);
      const existing = await this.repository.findRunAuditByEventId(
        input.runKey,
        input.event.eventId
      );
      if (existing !== null) {
        if (!sameAuditRequest(existing, input.event.type, fingerprint)) {
          throw new SimulationPersistenceError(
            'IDEMPOTENCY_CONFLICT',
            `event ${input.event.eventId} was already used with different data`
          );
        }
        return current;
      }

      const nextState = transitionSimulationRun(current.state, input.event);
      if (nextState === current.state) return current;
      const audit = transitionAuditRecord({
        before: current.state,
        after: nextState,
        actor: input.actor,
        requestFingerprint: fingerprint,
      });
      const append = await this.repository.appendRunAudit(audit);

      if (append.disposition === 'duplicate-event') {
        if (!sameAuditRequest(append.existing, audit.eventType, fingerprint)) {
          throw new SimulationPersistenceError(
            'IDEMPOTENCY_CONFLICT',
            `event ${input.event.eventId} was already used with different data`
          );
        }
        return this.loadRun(input.runKey);
      }
      if (append.disposition === 'sequence-conflict') continue;

      const updated = await this.repository.compareAndSwapRun(
        input.runKey,
        current.state.revision,
        nextState
      );
      if (updated) return { ...current, state: nextState };
      // The audit event is authoritative. Another process can repair/apply the
      // same winning event, or this call will do so on the next load.
      return this.loadRun(input.runKey);
    }

    throw new SimulationPersistenceError(
      'CONCURRENT_TRANSITION',
      `simulation run ${input.runKey} changed repeatedly during transition`
    );
  }

  async reconcileRun(input: {
    runKey: string;
    nowMs: number;
    actor: SimulationAuditActor;
  }): Promise<SimulationRunProjection> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const current = await this.loadRun(input.runKey);
      const reconciled = reconcilePersistedSimulationRun(current.state, input.nowMs);
      if (!reconciled.changed) return current;

      const transition = reconciled.state.lastTransition;
      if (transition === null) {
        throw new SimulationAuditError('AUDIT_DIVERGENCE', 'reconcile changed state without transition');
      }
      const fingerprint = simulationSystemTransitionFingerprint(reconciled.state);
      const existing = await this.repository.findRunAuditByEventId(input.runKey, transition.eventId);
      if (existing !== null) {
        if (!sameAuditRequest(existing, transition.eventType, fingerprint)) {
          throw new SimulationPersistenceError(
            'IDEMPOTENCY_CONFLICT',
            `system event ${transition.eventId} was already used with different data`
          );
        }
        return this.loadRun(input.runKey);
      }
      const audit = transitionAuditRecord({
        before: current.state,
        after: reconciled.state,
        actor: input.actor,
        requestFingerprint: fingerprint,
      });
      const append = await this.repository.appendRunAudit(audit);
      if (append.disposition === 'duplicate-event') {
        if (!sameAuditRequest(append.existing, audit.eventType, fingerprint)) {
          throw new SimulationPersistenceError(
            'IDEMPOTENCY_CONFLICT',
            `system event ${transition.eventId} was already used with different data`
          );
        }
        return this.loadRun(input.runKey);
      }
      if (append.disposition === 'sequence-conflict') continue;

      const updated = await this.repository.compareAndSwapRun(
        input.runKey,
        current.state.revision,
        reconciled.state
      );
      if (updated) return { ...current, state: reconciled.state };
      return this.loadRun(input.runKey);
    }

    throw new SimulationPersistenceError(
      'CONCURRENT_TRANSITION',
      `simulation run ${input.runKey} changed repeatedly during reconciliation`
    );
  }

  /**
   * Record a recovery outcome: the transition it belongs to and the result data,
   * written together and audited.
   *
   * The recovery subfield had no audit image and no CAS -- insertRun wrote only
   * its empty default, and nothing else touched it -- so a proven cleanup could
   * be lost to a concurrent transition and left no trace. This gives it both: the
   * recovery outcome transition is now an audited event, and the same
   * revision-guarded CAS writes the recovery findings alongside the new state, so
   * they cannot be clobbered by a concurrent write.
   *
   * It follows transitionRun exactly, and deliberately uses the ordinary event
   * fingerprint, not one folded with the findings: the replay verifier recomputes
   * that fingerprint from the event alone, so binding the findings into it would
   * make every later loadRun fail AUDIT_DIVERGENCE. The findings therefore live in
   * the run document (revision-tied), the transition lives in the audit; one
   * eventId records one outcome. (Reconstructing the findings from the audit
   * stream alone would need a dedicated audit field and a replay change -- a
   * larger, separate step.)
   */
  async recordRecoveryResult(input: {
    runKey: string;
    event: SimulationRunEvent;
    recovery: SimulationRecoveryResult;
    actor: SimulationAuditActor;
  }): Promise<SimulationRunProjection> {
    const fingerprint = simulationRunEventFingerprint(input.event);

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const current = await this.loadRun(input.runKey);
      const existing = await this.repository.findRunAuditByEventId(input.runKey, input.event.eventId);
      if (existing !== null) {
        if (!sameAuditRequest(existing, input.event.type, fingerprint)) {
          throw new SimulationPersistenceError(
            'IDEMPOTENCY_CONFLICT',
            `recovery event ${input.event.eventId} was already used with different data`
          );
        }
        return current;
      }

      const nextState = transitionSimulationRun(current.state, input.event);
      if (nextState === current.state) return current;
      const audit = transitionAuditRecord({
        before: current.state,
        after: nextState,
        actor: input.actor,
        requestFingerprint: fingerprint,
      });
      const append = await this.repository.appendRunAudit(audit);
      if (append.disposition === 'duplicate-event') {
        if (!sameAuditRequest(append.existing, audit.eventType, fingerprint)) {
          throw new SimulationPersistenceError(
            'IDEMPOTENCY_CONFLICT',
            `recovery event ${input.event.eventId} was already used with different data`
          );
        }
        return this.loadRun(input.runKey);
      }
      if (append.disposition === 'sequence-conflict') continue;

      const updated = await this.repository.compareAndSwapRun(
        input.runKey,
        current.state.revision,
        nextState,
        input.recovery
      );
      if (updated) return { ...current, state: nextState };
      return this.loadRun(input.runKey);
    }

    throw new SimulationPersistenceError(
      'CONCURRENT_TRANSITION',
      `simulation run ${input.runKey} changed repeatedly while recording recovery`
    );
  }
}
