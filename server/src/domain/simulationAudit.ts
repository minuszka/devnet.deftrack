import { compareByCodeUnit } from './codeUnitOrder.js';
import { createHash } from 'node:crypto';
import {
  SIMULATION_RUN_EVENT_TYPES,
  createSimulationRunState,
  reconcilePersistedSimulationRun,
  transitionSimulationRun,
  type SimulationRunEvent,
  type SimulationRunEventType,
  type SimulationRunState,
} from './simulationRunState.js';
import type {
  SimulationAuditEventType,
  SimulationAuditEventDocument,
} from '../models/SimulationAuditEvent.js';
import type {
  SimulationAuditActor,
  SimulationRunMetadata,
} from '../models/SimulationRun.js';

export interface SimulationRunAuditRecord {
  stream: 'run';
  subjectId: string;
  runKey: string;
  eventId: string;
  sequence: number;
  eventType: SimulationAuditEventType;
  requestFingerprint: string;
  actor: SimulationAuditActor;
  atMs: number;
  fromStatus: SimulationRunState['status'] | null;
  toStatus: SimulationRunState['status'];
  stateAfter: SimulationRunState;
  metadataOnCreate: SimulationRunMetadata | null;
  actionAfter: null;
}

type AuditLike = SimulationRunAuditRecord | SimulationAuditEventDocument;

export class SimulationAuditError extends Error {
  constructor(
    public readonly code:
      | 'EMPTY_AUDIT'
      | 'INVALID_CREATION'
      | 'AUDIT_GAP'
      | 'AUDIT_DIVERGENCE'
      | 'IDEMPOTENCY_CONFLICT',
    message: string
  ) {
    super(message);
    this.name = 'SimulationAuditError';
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new SimulationAuditError('AUDIT_DIVERGENCE', 'non-finite audit value');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => compareByCodeUnit(a, b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new SimulationAuditError('AUDIT_DIVERGENCE', `unsupported audit value: ${typeof value}`);
}

export function simulationFingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function simulationRunEventFingerprint(event: SimulationRunEvent): string {
  return simulationFingerprint(
    event.type === 'begin_activation' || event.type === 'activate_fault'
      ? {
          type: event.type,
          atMs: event.atMs,
          faultLeaseExpiresAtMs: event.faultLeaseExpiresAtMs,
        }
      : { type: event.type, atMs: event.atMs }
  );
}

export function simulationRunCreationFingerprint(
  state: Pick<SimulationRunState, 'live' | 'createdAtMs' | 'runExpiresAtMs'>,
  metadata: SimulationRunMetadata
): string {
  return simulationFingerprint({
    metadata,
    live: state.live,
    createdAtMs: state.createdAtMs,
    runExpiresAtMs: state.runExpiresAtMs,
  });
}

export function simulationSystemTransitionFingerprint(state: SimulationRunState): string {
  const transition = state.lastTransition;
  if (transition === null) {
    throw new SimulationAuditError('AUDIT_DIVERGENCE', 'system transition has no transition record');
  }
  return simulationFingerprint({
    eventId: transition.eventId,
    eventType: transition.eventType,
    from: transition.from,
    to: transition.to,
    reason: transition.reason,
  });
}

function assertCreation(first: AuditLike): asserts first is AuditLike & {
  stateAfter: SimulationRunState;
  metadataOnCreate: SimulationRunMetadata;
} {
  if (
    first.stream !== 'run' ||
    first.sequence !== 0 ||
    first.eventType !== 'run_created' ||
    first.fromStatus !== null ||
    first.toStatus !== 'draft' ||
    first.stateAfter === null ||
    first.metadataOnCreate === null ||
    first.stateAfter.revision !== 0 ||
    first.stateAfter.status !== 'draft'
  ) {
    throw new SimulationAuditError('INVALID_CREATION', 'audit stream does not start with run creation');
  }
}

/** Rebuild and verify the current run projection from its append-only stream. */
export function replaySimulationRunAudit(events: readonly AuditLike[]): {
  state: SimulationRunState;
  metadata: SimulationRunMetadata;
  metadataFingerprint: string;
} {
  if (events.length === 0) throw new SimulationAuditError('EMPTY_AUDIT', 'run has no audit events');
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const first = ordered[0]!;
  assertCreation(first);

  const runKey = first.runKey;
  const expectedInitialState = createSimulationRunState({
    runKey,
    live: first.stateAfter.live,
    createdAtMs: first.stateAfter.createdAtMs,
    runExpiresAtMs: first.stateAfter.runExpiresAtMs,
  });
  if (
    first.subjectId !== runKey ||
    first.stateAfter.runKey !== runKey ||
    simulationFingerprint(first.stateAfter) !== simulationFingerprint(expectedInitialState) ||
    first.requestFingerprint !==
      simulationRunCreationFingerprint(first.stateAfter, first.metadataOnCreate)
  ) {
    throw new SimulationAuditError('INVALID_CREATION', 'creation metadata or run identity diverged');
  }

  const seenEventIds = new Set<string>([first.eventId]);
  let state = first.stateAfter;
  for (let index = 1; index < ordered.length; index++) {
    const event = ordered[index]!;
    const expectedSequence = index;
    if (event.sequence !== expectedSequence) {
      throw new SimulationAuditError(
        'AUDIT_GAP',
        `expected audit sequence ${expectedSequence}, got ${event.sequence}`
      );
    }
    if (
      event.stream !== 'run' ||
      event.runKey !== runKey ||
      event.subjectId !== runKey ||
      event.stateAfter === null ||
      event.metadataOnCreate !== null ||
      event.fromStatus !== state.status ||
      event.toStatus !== event.stateAfter.status ||
      event.stateAfter.runKey !== runKey ||
      event.stateAfter.revision !== state.revision + 1 ||
      event.stateAfter.revision !== event.sequence
    ) {
      throw new SimulationAuditError('AUDIT_DIVERGENCE', `audit event ${event.eventId} breaks the run chain`);
    }
    if (seenEventIds.has(event.eventId)) {
      throw new SimulationAuditError('AUDIT_DIVERGENCE', `duplicate event id ${event.eventId}`);
    }
    seenEventIds.add(event.eventId);

    const transition = event.stateAfter.lastTransition;
    if (
      transition === null ||
      transition.eventId !== event.eventId ||
      transition.eventType !== event.eventType ||
      transition.from !== event.fromStatus ||
      transition.to !== event.toStatus ||
      transition.atMs !== event.atMs
    ) {
      throw new SimulationAuditError(
        'AUDIT_DIVERGENCE',
        `audit event ${event.eventId} does not match its state snapshot`
      );
    }

    let expectedState: SimulationRunState;
    let expectedRequestFingerprint: string;
    if (SIMULATION_RUN_EVENT_TYPES.includes(event.eventType as SimulationRunEventType)) {
      // The audit stores no event payload; it recovers one from the state the
      // event produced. So every field an event carries must have a mirror in
      // the state AND be read back here -- a field with a mirror but no read-back
      // replays as absent, the replayed state differs from the recorded one, and
      // the run becomes unloadable with AUDIT_DIVERGENCE. That is how the chain
      // anchors first landed: mirrored, and not reconstructed.
      const domainEvent: SimulationRunEvent =
        event.eventType === 'begin_activation'
          ? {
              type: 'begin_activation',
              eventId: event.eventId,
              atMs: event.atMs,
              faultLeaseExpiresAtMs: event.stateAfter.faultLeaseExpiresAtMs ?? -1,
            }
          : event.eventType === 'activate_fault'
          ? {
              type: 'activate_fault',
              eventId: event.eventId,
              atMs: event.atMs,
              faultLeaseExpiresAtMs: event.stateAfter.faultLeaseExpiresAtMs ?? -1,
              chainTip: event.stateAfter.faultActivatedTip,
            }
          : event.eventType === 'recovery_succeeded'
            ? {
                type: 'recovery_succeeded',
                eventId: event.eventId,
                atMs: event.atMs,
                chainTip: event.stateAfter.recoveredTip,
              }
            : {
                type: event.eventType as Exclude<
                  SimulationRunEventType,
                  'begin_activation' | 'activate_fault' | 'recovery_succeeded'
                >,
                eventId: event.eventId,
                atMs: event.atMs,
              };
      expectedState = transitionSimulationRun(state, domainEvent);
      expectedRequestFingerprint = simulationRunEventFingerprint(domainEvent);
    } else if (
      event.eventType === 'system_timeout' ||
      event.eventType === 'system_resume_recovery' ||
      event.eventType === 'system_cooldown_complete'
    ) {
      const reconciled = reconcilePersistedSimulationRun(state, event.atMs);
      if (!reconciled.changed || reconciled.state.lastTransition?.eventId !== event.eventId) {
        throw new SimulationAuditError(
          'AUDIT_DIVERGENCE',
          `system audit event ${event.eventId} cannot be reproduced`
        );
      }
      expectedState = reconciled.state;
      expectedRequestFingerprint = simulationSystemTransitionFingerprint(expectedState);
    } else {
      throw new SimulationAuditError(
        'AUDIT_DIVERGENCE',
        `action event ${event.eventType} appeared in a run stream`
      );
    }

    if (
      simulationFingerprint(event.stateAfter) !== simulationFingerprint(expectedState) ||
      event.requestFingerprint !== expectedRequestFingerprint
    ) {
      throw new SimulationAuditError(
        'AUDIT_DIVERGENCE',
        `audit event ${event.eventId} cannot reproduce its recorded state`
      );
    }
    state = event.stateAfter;
  }

  return {
    state,
    metadata: first.metadataOnCreate,
    metadataFingerprint: simulationFingerprint(first.metadataOnCreate),
  };
}

export function sameAuditRequest(
  existing: Pick<AuditLike, 'eventType' | 'requestFingerprint'>,
  eventType: SimulationAuditEventType,
  requestFingerprint: string
): boolean {
  return existing.eventType === eventType && existing.requestFingerprint === requestFingerprint;
}

export function creationAuditRecord(input: {
  state: SimulationRunState;
  metadata: SimulationRunMetadata;
  actor: SimulationAuditActor;
}): SimulationRunAuditRecord {
  const fingerprint = simulationRunCreationFingerprint(input.state, input.metadata);
  return {
    stream: 'run',
    subjectId: input.state.runKey,
    runKey: input.state.runKey,
    eventId: `create:${input.state.runKey}`,
    sequence: 0,
    eventType: 'run_created',
    requestFingerprint: fingerprint,
    actor: input.actor,
    atMs: input.state.createdAtMs,
    fromStatus: null,
    toStatus: 'draft',
    stateAfter: input.state,
    metadataOnCreate: input.metadata,
    actionAfter: null,
  };
}

export function transitionAuditRecord(input: {
  before: SimulationRunState;
  after: SimulationRunState;
  actor: SimulationAuditActor;
  requestFingerprint: string;
}): SimulationRunAuditRecord {
  const transition = input.after.lastTransition;
  if (
    transition === null ||
    input.after.revision !== input.before.revision + 1 ||
    transition.from !== input.before.status ||
    transition.to !== input.after.status
  ) {
    throw new SimulationAuditError('AUDIT_DIVERGENCE', 'invalid transition snapshot for audit');
  }

  return {
    stream: 'run',
    subjectId: input.after.runKey,
    runKey: input.after.runKey,
    eventId: transition.eventId,
    sequence: input.after.revision,
    eventType: transition.eventType,
    requestFingerprint: input.requestFingerprint,
    actor: input.actor,
    atMs: transition.atMs,
    fromStatus: transition.from,
    toStatus: transition.to,
    stateAfter: input.after,
    metadataOnCreate: null,
    actionAfter: null,
  };
}
