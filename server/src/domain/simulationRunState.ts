export const SIMULATION_RUN_STATUSES = [
  'draft',
  'preflight',
  'rejected',
  'scheduled',
  'baseline',
  'armed',
  'fault_active',
  'observing',
  'aborting',
  'recovery',
  'cooldown',
  'completed',
  'aborted',
  'failed',
] as const;

export type SimulationRunStatus = (typeof SIMULATION_RUN_STATUSES)[number];

export const SIMULATION_RUN_EVENT_TYPES = [
  'begin_preflight',
  'preflight_passed',
  'preflight_rejected',
  'begin_baseline',
  'baseline_completed',
  'dry_run_completed',
  'activate_fault',
  'begin_observation',
  'begin_recovery',
  'recovery_succeeded',
  'recovery_failed',
  'cooldown_completed',
  'abort_requested',
] as const;

export type SimulationRunEventType = (typeof SIMULATION_RUN_EVENT_TYPES)[number];

interface BaseRunEvent {
  eventId: string;
  atMs: number;
  type: SimulationRunEventType;
}

export interface ActivateFaultEvent extends BaseRunEvent {
  type: 'activate_fault';
  faultLeaseExpiresAtMs: number;
}

export type SimulationRunEvent =
  | ActivateFaultEvent
  | (BaseRunEvent & {
      type: Exclude<SimulationRunEventType, 'activate_fault'>;
    });

export interface SimulationTransitionRecord {
  eventId: string;
  eventType: SimulationRunEventType | 'system_timeout' | 'system_resume_recovery';
  from: SimulationRunStatus;
  to: SimulationRunStatus;
  atMs: number;
  reason: string | null;
}

/**
 * The persistable, infrastructure-free state of one simulation run.
 *
 * No timer or process-local flag is authoritative. Deadlines and the last
 * transition are data, so a new process can decide what to do after restart.
 */
export interface SimulationRunState {
  runKey: string;
  status: SimulationRunStatus;
  revision: number;
  live: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  stateEnteredAtMs: number;
  runExpiresAtMs: number;
  faultLeaseExpiresAtMs: number | null;
  /** True until a successful recovery proves the remote mutation is gone. */
  faultMayBeActive: boolean;
  abortRequested: boolean;
  lastTransition: SimulationTransitionRecord | null;
}

export class SimulationStateError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_INPUT'
      | 'INVALID_TRANSITION'
      | 'EVENT_ID_REUSED'
      | 'STALE_EVENT'
      | 'RUN_EXPIRED'
      | 'INVALID_FAULT_LEASE',
    message: string
  ) {
    super(message);
    this.name = 'SimulationStateError';
  }
}

export function createSimulationRunState(input: {
  runKey: string;
  live: boolean;
  createdAtMs: number;
  runExpiresAtMs: number;
}): SimulationRunState {
  if (input.runKey.trim().length === 0) {
    throw new SimulationStateError('INVALID_INPUT', 'runKey must not be empty');
  }
  if (
    !Number.isSafeInteger(input.createdAtMs) ||
    !Number.isSafeInteger(input.runExpiresAtMs) ||
    input.runExpiresAtMs <= input.createdAtMs
  ) {
    throw new SimulationStateError('INVALID_INPUT', 'run expiry must be after creation');
  }

  return {
    runKey: input.runKey,
    status: 'draft',
    revision: 0,
    live: input.live,
    createdAtMs: input.createdAtMs,
    updatedAtMs: input.createdAtMs,
    stateEnteredAtMs: input.createdAtMs,
    runExpiresAtMs: input.runExpiresAtMs,
    faultLeaseExpiresAtMs: null,
    faultMayBeActive: false,
    abortRequested: false,
    lastTransition: null,
  };
}

type OrdinaryEventType = Exclude<SimulationRunEventType, 'abort_requested'>;

const ORDINARY_TRANSITIONS: Readonly<
  Partial<Record<SimulationRunStatus, Partial<Record<OrdinaryEventType, SimulationRunStatus>>>>
> = {
  draft: { begin_preflight: 'preflight' },
  preflight: {
    preflight_passed: 'scheduled',
    preflight_rejected: 'rejected',
  },
  scheduled: { begin_baseline: 'baseline' },
  baseline: { baseline_completed: 'armed' },
  armed: {
    activate_fault: 'fault_active',
    dry_run_completed: 'completed',
    begin_recovery: 'recovery',
  },
  fault_active: { begin_observation: 'observing', begin_recovery: 'recovery' },
  observing: { begin_recovery: 'recovery' },
  aborting: { begin_recovery: 'recovery' },
  recovery: {
    recovery_succeeded: 'cooldown',
    recovery_failed: 'failed',
  },
  cooldown: { cooldown_completed: 'completed' },
  failed: { begin_recovery: 'recovery' },
};

const ABORTABLE_STATUSES = new Set<SimulationRunStatus>([
  'draft',
  'preflight',
  'scheduled',
  'baseline',
  'armed',
  'fault_active',
  'observing',
  'cooldown',
]);

const TERMINAL_STATUSES = new Set<SimulationRunStatus>([
  'rejected',
  'completed',
  'aborted',
]);

const TIMEOUT_RECOVERY_STATUSES = new Set<SimulationRunStatus>([
  'preflight',
  'scheduled',
  'baseline',
  'armed',
  'fault_active',
  'observing',
]);

/**
 * Every status a periodic reconcile can move on its own: the timeout-recoverable
 * ones, plus `aborting`, which reconcile resumes into recovery regardless of any
 * deadline. A run in any other status is either terminal or waiting on an
 * operator, and the sweeper leaves it alone.
 */
export const RECONCILABLE_SIMULATION_STATUSES: readonly SimulationRunStatus[] = [
  ...TIMEOUT_RECOVERY_STATUSES,
  'aborting',
];

export function isTerminalSimulationStatus(status: SimulationRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function allowedSimulationEvents(status: SimulationRunStatus): SimulationRunEventType[] {
  const ordinary = Object.keys(ORDINARY_TRANSITIONS[status] ?? {}) as SimulationRunEventType[];
  if (ABORTABLE_STATUSES.has(status) || status === 'recovery') ordinary.push('abort_requested');
  return ordinary;
}

function assertEvent(state: SimulationRunState, event: SimulationRunEvent): void {
  if (event.eventId.trim().length === 0 || !Number.isSafeInteger(event.atMs)) {
    throw new SimulationStateError('INVALID_INPUT', 'eventId and atMs must be valid');
  }

  if (state.lastTransition?.eventId === event.eventId) {
    const changedEvent =
      state.lastTransition.eventType !== event.type ||
      state.lastTransition.atMs !== event.atMs ||
      (event.type === 'activate_fault' &&
        state.faultLeaseExpiresAtMs !== event.faultLeaseExpiresAtMs);
    if (changedEvent) {
      throw new SimulationStateError('EVENT_ID_REUSED', 'eventId was already used with other data');
    }
    return;
  }

  if (event.atMs < state.updatedAtMs) {
    throw new SimulationStateError('STALE_EVENT', 'event predates the persisted run state');
  }

  const recoverySafeEvent =
    event.type === 'abort_requested' ||
    event.type === 'begin_recovery' ||
    event.type === 'recovery_succeeded' ||
    event.type === 'recovery_failed' ||
    event.type === 'cooldown_completed';
  if (event.atMs >= state.runExpiresAtMs && !recoverySafeEvent) {
    throw new SimulationStateError('RUN_EXPIRED', 'expired run must be reconciled into recovery');
  }
}

function applyTransition(
  state: SimulationRunState,
  input: {
    eventId: string;
    eventType: SimulationTransitionRecord['eventType'];
    atMs: number;
    to: SimulationRunStatus;
    reason?: string;
    abortRequested?: boolean;
    faultLeaseExpiresAtMs?: number | null;
    faultMayBeActive?: boolean;
  }
): SimulationRunState {
  return {
    ...state,
    status: input.to,
    revision: state.revision + 1,
    updatedAtMs: input.atMs,
    stateEnteredAtMs: input.to === state.status ? state.stateEnteredAtMs : input.atMs,
    abortRequested: input.abortRequested ?? state.abortRequested,
    faultLeaseExpiresAtMs:
      input.faultLeaseExpiresAtMs !== undefined
        ? input.faultLeaseExpiresAtMs
        : state.faultLeaseExpiresAtMs,
    faultMayBeActive: input.faultMayBeActive ?? state.faultMayBeActive,
    lastTransition: {
      eventId: input.eventId,
      eventType: input.eventType,
      from: state.status,
      to: input.to,
      atMs: input.atMs,
      reason: input.reason ?? null,
    },
  };
}

/**
 * Apply one domain event. An immediate delivery retry is idempotent; the
 * persistent audit log added on day 3 supplies global event-id uniqueness.
 */
export function transitionSimulationRun(
  state: SimulationRunState,
  event: SimulationRunEvent
): SimulationRunState {
  assertEvent(state, event);

  // Retrying the latest event is a no-op, including its revision.
  if (state.lastTransition?.eventId === event.eventId) return state;

  if (event.type === 'abort_requested') {
    if (state.status === 'recovery') {
      return applyTransition(state, {
        eventId: event.eventId,
        eventType: event.type,
        atMs: event.atMs,
        to: 'recovery',
        abortRequested: true,
        reason: 'abort requested while recovery was already running',
      });
    }
    if (!ABORTABLE_STATUSES.has(state.status)) {
      throw new SimulationStateError(
        'INVALID_TRANSITION',
        `cannot abort a run in ${state.status}`
      );
    }
    return applyTransition(state, {
      eventId: event.eventId,
      eventType: event.type,
      atMs: event.atMs,
      to: 'aborting',
      abortRequested: true,
    });
  }

  const to = ORDINARY_TRANSITIONS[state.status]?.[event.type];
  if (to === undefined) {
    throw new SimulationStateError(
      'INVALID_TRANSITION',
      `event ${event.type} is not allowed in ${state.status}`
    );
  }

  if (event.type === 'activate_fault') {
    if (!state.live) {
      throw new SimulationStateError(
        'INVALID_TRANSITION',
        'a dry-run cannot activate a remote fault'
      );
    }
    if (
      !Number.isSafeInteger(event.faultLeaseExpiresAtMs) ||
      event.faultLeaseExpiresAtMs <= event.atMs ||
      event.faultLeaseExpiresAtMs > state.runExpiresAtMs
    ) {
      throw new SimulationStateError(
        'INVALID_FAULT_LEASE',
        'fault lease must end after activation and no later than the run expiry'
      );
    }
    return applyTransition(state, {
      eventId: event.eventId,
      eventType: event.type,
      atMs: event.atMs,
      to,
      faultLeaseExpiresAtMs: event.faultLeaseExpiresAtMs,
      faultMayBeActive: true,
    });
  }

  if (event.type === 'dry_run_completed' && state.live) {
    throw new SimulationStateError(
      'INVALID_TRANSITION',
      'a live run cannot use the dry-run completion path'
    );
  }

  if (event.type === 'recovery_succeeded') {
    const finalStatus = state.abortRequested ? 'aborted' : 'cooldown';
    return applyTransition(state, {
      eventId: event.eventId,
      eventType: event.type,
      atMs: event.atMs,
      to: finalStatus,
      faultLeaseExpiresAtMs: null,
      faultMayBeActive: false,
    });
  }

  if (event.type === 'recovery_failed') {
    return applyTransition(state, {
      eventId: event.eventId,
      eventType: event.type,
      atMs: event.atMs,
      to,
      // A failed cleanup means that a clean remote state was not proven.
      faultMayBeActive: true,
    });
  }

  if (state.status === 'failed' && event.type === 'begin_recovery' && !state.faultMayBeActive) {
    throw new SimulationStateError(
      'INVALID_TRANSITION',
      'failed run has no possibly active fault to recover'
    );
  }

  return applyTransition(state, {
    eventId: event.eventId,
    eventType: event.type,
    atMs: event.atMs,
    to,
  });
}

export type SimulationResumeDirective =
  | 'none'
  | 'resume-preflight'
  | 'wait-scheduled'
  | 'resume-baseline'
  | 'resume-armed'
  | 'resume-observation'
  | 'resume-recovery'
  | 'resume-cooldown'
  | 'manual-recovery-required';

export interface SimulationReconcileResult {
  state: SimulationRunState;
  changed: boolean;
  directive: SimulationResumeDirective;
  reason: 'current' | 'run-expired' | 'fault-lease-expired' | 'abort-in-progress';
}

function resumeDirective(status: SimulationRunStatus): SimulationResumeDirective {
  switch (status) {
    case 'preflight':
      return 'resume-preflight';
    case 'scheduled':
      return 'wait-scheduled';
    case 'baseline':
      return 'resume-baseline';
    case 'armed':
      return 'resume-armed';
    case 'fault_active':
    case 'observing':
      return 'resume-observation';
    case 'aborting':
    case 'recovery':
      return 'resume-recovery';
    case 'cooldown':
      return 'resume-cooldown';
    case 'failed':
      return 'manual-recovery-required';
    case 'draft':
    case 'rejected':
    case 'completed':
    case 'aborted':
      return 'none';
  }
}

/**
 * Decide how a persisted run resumes after process restart or a scheduler tick.
 *
 * An expired run/fault never resumes forward execution. It is moved directly
 * to recovery with abort intent. An `aborting` snapshot is likewise advanced
 * without relying on a process-local callback that was lost during restart.
 */
export function reconcilePersistedSimulationRun(
  state: SimulationRunState,
  nowMs: number
): SimulationReconcileResult {
  if (!Number.isSafeInteger(nowMs) || nowMs < state.updatedAtMs) {
    throw new SimulationStateError('STALE_EVENT', 'reconcile time predates the persisted run');
  }

  if (state.status === 'aborting') {
    const next = applyTransition(state, {
      eventId: `system:resume-recovery:${state.revision}`,
      eventType: 'system_resume_recovery',
      atMs: nowMs,
      to: 'recovery',
      abortRequested: true,
      reason: 'process resumed an abort in progress',
    });
    return { state: next, changed: true, directive: 'resume-recovery', reason: 'abort-in-progress' };
  }

  const leaseExpired =
    state.faultMayBeActive &&
    state.faultLeaseExpiresAtMs !== null &&
    nowMs >= state.faultLeaseExpiresAtMs;
  const runExpired = nowMs >= state.runExpiresAtMs;
  const canAutoRecover = TIMEOUT_RECOVERY_STATUSES.has(state.status);

  if (canAutoRecover && (leaseExpired || runExpired)) {
    const reason = leaseExpired ? 'fault-lease-expired' : 'run-expired';
    const deadline = leaseExpired ? state.faultLeaseExpiresAtMs : state.runExpiresAtMs;
    const next = applyTransition(state, {
      eventId: `system:timeout:${reason}:${deadline}`,
      eventType: 'system_timeout',
      atMs: nowMs,
      to: 'recovery',
      abortRequested: true,
      reason,
    });
    return { state: next, changed: true, directive: 'resume-recovery', reason };
  }

  return {
    state,
    changed: false,
    directive: resumeDirective(state.status),
    reason: 'current',
  };
}
