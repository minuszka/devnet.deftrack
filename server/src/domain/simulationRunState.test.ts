import { describe, expect, it } from 'vitest';
import {
  COOLDOWN_BUDGET_MS,
  SimulationStateError,
  allowedSimulationEvents,
  createSimulationRunState,
  isTerminalSimulationStatus,
  reconcilePersistedSimulationRun,
  transitionSimulationRun,
  type SimulationRunEvent,
  type SimulationRunEventType,
  type SimulationRunState,
  type SimulationRunStatus,
} from './simulationRunState.js';

const ordinaryEvent = (
  type: Exclude<SimulationRunEventType, 'begin_activation' | 'activate_fault'>,
  eventId: string,
  atMs: number
): SimulationRunEvent => ({ type, eventId, atMs });

const activateEvent = (eventId: string, atMs: number, faultLeaseExpiresAtMs = 900): SimulationRunEvent => ({
  type: 'activate_fault',
  eventId,
  atMs,
  faultLeaseExpiresAtMs,
});

const beginActivationEvent = (eventId: string, atMs: number, faultLeaseExpiresAtMs = 900): SimulationRunEvent => ({
  type: 'begin_activation',
  eventId,
  atMs,
  faultLeaseExpiresAtMs,
});

function freshRun(): SimulationRunState {
  return createSimulationRunState({
    runKey: 'sim-test',
    live: true,
    createdAtMs: 0,
    runExpiresAtMs: 1_000,
  });
}

function transition(
  state: SimulationRunState,
  type: Exclude<SimulationRunEventType, 'begin_activation' | 'activate_fault'>,
  atMs: number
): SimulationRunState {
  return transitionSimulationRun(state, ordinaryEvent(type, `${type}:${atMs}`, atMs));
}

function stateAt(target: SimulationRunStatus): SimulationRunState {
  let state = freshRun();
  if (target === 'draft') return state;
  state = transition(state, 'begin_preflight', 1);
  if (target === 'preflight') return state;
  if (target === 'rejected') return transition(state, 'preflight_rejected', 2);
  state = transition(state, 'preflight_passed', 2);
  if (target === 'scheduled') return state;
  state = transition(state, 'begin_baseline', 3);
  if (target === 'baseline') return state;
  state = transition(state, 'baseline_completed', 4);
  if (target === 'armed') return state;
  state = transitionSimulationRun(state, beginActivationEvent('begin-activation:5', 5));
  if (target === 'activation_pending') return state;
  state = transitionSimulationRun(state, activateEvent('activate:5', 5));
  if (target === 'fault_active') return state;
  state = transition(state, 'begin_observation', 6);
  if (target === 'observing') return state;
  state = transition(state, 'begin_recovery', 7);
  if (target === 'recovery') return state;
  if (target === 'failed') return transition(state, 'recovery_failed', 8);
  state = transition(state, 'recovery_succeeded', 8);
  if (target === 'cooldown') return state;
  if (target === 'completed') return transition(state, 'cooldown_completed', 9);
  throw new Error(`unsupported state fixture: ${target}`);
}

describe('simulation run state machine', () => {
  it('runs the complete success path with monotonic revisions', () => {
    const states: SimulationRunState[] = [freshRun()];
    states.push(transition(states.at(-1)!, 'begin_preflight', 1));
    states.push(transition(states.at(-1)!, 'preflight_passed', 2));
    states.push(transition(states.at(-1)!, 'begin_baseline', 3));
    states.push(transition(states.at(-1)!, 'baseline_completed', 4));
    states.push(transitionSimulationRun(states.at(-1)!, beginActivationEvent('begin-activation:5', 5)));
    states.push(transitionSimulationRun(states.at(-1)!, activateEvent('activate:5', 5)));
    states.push(transition(states.at(-1)!, 'begin_observation', 6));
    states.push(transition(states.at(-1)!, 'begin_recovery', 7));
    states.push(transition(states.at(-1)!, 'recovery_succeeded', 8));
    states.push(transition(states.at(-1)!, 'cooldown_completed', 9));

    expect(states.map((s) => s.status)).toEqual([
      'draft',
      'preflight',
      'scheduled',
      'baseline',
      'armed',
      'activation_pending',
      'fault_active',
      'observing',
      'recovery',
      'cooldown',
      'completed',
    ]);
    expect(states.map((s) => s.revision)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(states[5]).toMatchObject({ faultMayBeActive: true, faultLeaseExpiresAtMs: 900 });
    expect(states[9]).toMatchObject({ faultMayBeActive: false, faultLeaseExpiresAtMs: null });
    expect(isTerminalSimulationStatus(states.at(-1)!.status)).toBe(true);
  });

  it('supports an explicit preflight rejection', () => {
    const rejected = transition(stateAt('preflight'), 'preflight_rejected', 2);
    expect(rejected.status).toBe('rejected');
    expect(isTerminalSimulationStatus(rejected.status)).toBe(true);
    expect(allowedSimulationEvents(rejected.status)).toEqual([]);
  });

  it('pins the complete event allowlist for every state', () => {
    const expected: Record<SimulationRunStatus, SimulationRunEventType[]> = {
      draft: ['begin_preflight', 'abort_requested'],
      preflight: ['preflight_passed', 'preflight_rejected', 'abort_requested'],
      rejected: [],
      scheduled: ['begin_baseline', 'abort_requested'],
      baseline: ['baseline_completed', 'abort_requested'],
      armed: ['begin_activation', 'activate_fault', 'dry_run_completed', 'begin_recovery', 'abort_requested'],
      activation_pending: ['activate_fault', 'begin_recovery', 'abort_requested'],
      fault_active: ['begin_observation', 'begin_recovery', 'abort_requested'],
      observing: ['begin_recovery', 'abort_requested'],
      aborting: ['begin_recovery'],
      recovery: ['recovery_succeeded', 'recovery_failed', 'abort_requested'],
      cooldown: ['cooldown_completed', 'abort_requested'],
      completed: [],
      aborted: [],
      failed: ['begin_recovery'],
    };

    for (const [status, events] of Object.entries(expected)) {
      expect(allowedSimulationEvents(status as SimulationRunStatus)).toEqual(events);
    }
  });

  it.each(['armed', 'fault_active', 'observing'] as const)(
    'allows safety recovery directly from %s',
    (status) => {
      const recovered = transition(stateAt(status), 'begin_recovery', 20);
      expect(recovered.status).toBe('recovery');
    }
  );

  it('keeps a failed recovery retryable while a fault may still be active', () => {
    const failed = stateAt('failed');
    expect(failed.faultMayBeActive).toBe(true);
    expect(reconcilePersistedSimulationRun(failed, 50)).toMatchObject({
      changed: false,
      directive: 'manual-recovery-required',
    });

    const retry = transition(failed, 'begin_recovery', 50);
    const succeeded = transition(retry, 'recovery_succeeded', 51);
    expect(succeeded.status).toBe('cooldown');
    expect(succeeded.faultMayBeActive).toBe(false);
  });

  it('treats an unproven recovery as possibly active before fault acknowledgement', () => {
    const recovery = transition(stateAt('armed'), 'begin_recovery', 20);
    const failed = transition(recovery, 'recovery_failed', 21);
    expect(failed).toMatchObject({ status: 'failed', faultMayBeActive: true });
    expect(transition(failed, 'begin_recovery', 22).status).toBe('recovery');
  });

  it.each([
    'draft',
    'preflight',
    'scheduled',
    'baseline',
    'armed',
    'fault_active',
    'observing',
    'cooldown',
  ] as const)('aborts safely from %s through recovery', (status) => {
    const initial = stateAt(status);
    const aborting = transition(initial, 'abort_requested', 100);
    expect(aborting).toMatchObject({ status: 'aborting', abortRequested: true });

    const recovery = transition(aborting, 'begin_recovery', 101);
    const aborted = transition(recovery, 'recovery_succeeded', 102);
    expect(aborted).toMatchObject({
      status: 'aborted',
      abortRequested: true,
      faultMayBeActive: false,
    });
  });

  it('turns an abort requested during recovery into an aborted outcome', () => {
    const recovery = stateAt('recovery');
    const requested = transition(recovery, 'abort_requested', 20);
    expect(requested.status).toBe('recovery');
    expect(requested.stateEnteredAtMs).toBe(recovery.stateEnteredAtMs);
    expect(transition(requested, 'recovery_succeeded', 21).status).toBe('aborted');
  });

  it('rejects forbidden transitions instead of skipping phases', () => {
    expect(() => transition(freshRun(), 'begin_baseline', 1)).toThrowError(
      expect.objectContaining<Partial<SimulationStateError>>({ code: 'INVALID_TRANSITION' })
    );
    expect(() => transition(stateAt('completed'), 'begin_preflight', 20)).toThrowError(
      expect.objectContaining<Partial<SimulationStateError>>({ code: 'INVALID_TRANSITION' })
    );
  });

  it('completes a non-live lifecycle without ever marking a fault active', () => {
    let dry = createSimulationRunState({
      runKey: 'sim-dry', live: false, createdAtMs: 0, runExpiresAtMs: 1_000,
    });
    dry = transition(dry, 'begin_preflight', 1);
    dry = transition(dry, 'preflight_passed', 2);
    dry = transition(dry, 'begin_baseline', 3);
    dry = transition(dry, 'baseline_completed', 4);
    dry = transition(dry, 'dry_run_completed', 5);
    expect(dry).toMatchObject({ status: 'completed', faultMayBeActive: false, faultLeaseExpiresAtMs: null });
    expect(() => transitionSimulationRun(stateAt('armed'), ordinaryEvent('dry_run_completed', 'wrong', 5)))
      .toThrowError(expect.objectContaining<Partial<SimulationStateError>>({ code: 'INVALID_TRANSITION' }));
  });

  it('never lets a non-live run activate a fault', () => {
    let dry = createSimulationRunState({ runKey: 'sim-dry', live: false, createdAtMs: 0, runExpiresAtMs: 1_000 });
    for (const [type, atMs] of [
      ['begin_preflight', 1], ['preflight_passed', 2], ['begin_baseline', 3], ['baseline_completed', 4],
    ] as const) dry = transition(dry, type, atMs);
    expect(() => transitionSimulationRun(dry, activateEvent('no-fault', 5)))
      .toThrowError(expect.objectContaining<Partial<SimulationStateError>>({ code: 'INVALID_TRANSITION' }));
  });

  it('makes a retried event a true no-op without incrementing revision', () => {
    const event = ordinaryEvent('begin_preflight', 'request-1', 1);
    const first = transitionSimulationRun(freshRun(), event);
    const duplicate = transitionSimulationRun(first, event);
    expect(duplicate).toBe(first);
    expect(duplicate.revision).toBe(1);
  });

  it('rejects reuse of the latest event id for another event type', () => {
    const first = transitionSimulationRun(
      freshRun(),
      ordinaryEvent('begin_preflight', 'request-1', 1)
    );
    expect(() =>
      transitionSimulationRun(first, ordinaryEvent('preflight_passed', 'request-1', 2))
    ).toThrowError(expect.objectContaining<Partial<SimulationStateError>>({ code: 'EVENT_ID_REUSED' }));
  });

  it('rejects a duplicate event id whose timestamp or payload changed', () => {
    const preflight = transitionSimulationRun(
      freshRun(),
      ordinaryEvent('begin_preflight', 'request-1', 1)
    );
    expect(() =>
      transitionSimulationRun(preflight, ordinaryEvent('begin_preflight', 'request-1', 2))
    ).toThrowError(expect.objectContaining<Partial<SimulationStateError>>({ code: 'EVENT_ID_REUSED' }));

    const active = stateAt('fault_active');
    expect(() =>
      transitionSimulationRun(active, activateEvent('activate:5', 5, 800))
    ).toThrowError(expect.objectContaining<Partial<SimulationStateError>>({ code: 'EVENT_ID_REUSED' }));
  });

  it('rejects stale events and forward progress after run expiry', () => {
    const preflight = stateAt('preflight');
    expect(() => transition(preflight, 'preflight_passed', 0)).toThrowError(
      expect.objectContaining<Partial<SimulationStateError>>({ code: 'STALE_EVENT' })
    );
    expect(() => transition(preflight, 'preflight_passed', 1_000)).toThrowError(
      expect.objectContaining<Partial<SimulationStateError>>({ code: 'RUN_EXPIRED' })
    );
  });

  it('requires a bounded fault lease inside the run deadline', () => {
    const armed = stateAt('armed');
    for (const lease of [4, 1_001]) {
      const pending = transitionSimulationRun(armed, beginActivationEvent(`begin:${lease}`, 5, 900));
      expect(() =>
        transitionSimulationRun(pending, activateEvent(`activate:${lease}`, 6, lease))
      ).toThrowError(
        expect.objectContaining<Partial<SimulationStateError>>({ code: 'INVALID_FAULT_LEASE' })
      );
    }
  });
});

describe('persisted run reconciliation after restart', () => {
  it('resumes an unexpired fault without changing persisted state', () => {
    const active = stateAt('fault_active');
    const result = reconcilePersistedSimulationRun(active, 100);
    expect(result).toEqual({
      state: active,
      changed: false,
      directive: 'resume-observation',
      reason: 'current',
    });
  });

  it('moves an expired fault directly into recovery with abort intent', () => {
    const active = stateAt('fault_active');
    const result = reconcilePersistedSimulationRun(active, 900);
    expect(result).toMatchObject({
      changed: true,
      directive: 'resume-recovery',
      reason: 'fault-lease-expired',
      state: {
        status: 'recovery',
        abortRequested: true,
        faultMayBeActive: true,
        revision: active.revision + 1,
      },
    });
  });

  it('moves an observing run into recovery when the whole run times out first', () => {
    const observing = {
      ...stateAt('observing'),
      runExpiresAtMs: 500,
      faultLeaseExpiresAtMs: 800,
    };
    const result = reconcilePersistedSimulationRun(observing, 500);
    expect(result).toMatchObject({
      changed: true,
      directive: 'resume-recovery',
      reason: 'run-expired',
      state: { status: 'recovery', abortRequested: true },
    });
  });

  it('continues recovery after a process died in aborting', () => {
    const aborting = transition(stateAt('observing'), 'abort_requested', 100);
    const result = reconcilePersistedSimulationRun(aborting, 101);
    expect(result).toMatchObject({
      changed: true,
      directive: 'resume-recovery',
      reason: 'abort-in-progress',
      state: { status: 'recovery', abortRequested: true },
    });
  });

  it('completes a clean cooldown run at its own deadline, and never sends it backwards', () => {
    // This used to assert the dead end: reconcile refused the status, so a live
    // run that recovered cleanly sat in `cooldown` for ever and the only exit was
    // abort(), which relabels a successful experiment `aborted`. What must still
    // hold is the invariant the old test was really protecting -- a clean cooldown
    // run is never dragged BACKWARDS into recovery.
    const cooldown = stateAt('cooldown');
    const due = cooldown.cooldownExpiresAtMs!;
    expect(reconcilePersistedSimulationRun(cooldown, due - 1)).toMatchObject({ changed: false });
    const result = reconcilePersistedSimulationRun(cooldown, due);
    expect(result).toMatchObject({ changed: true, reason: 'cooldown-budget-elapsed' });
    expect(result.state.status).toBe('completed');
    expect(result.state.status).not.toBe('recovery');
  });

  it('rests for the cooldown budget, not for the whole run envelope', () => {
    // The envelope includes a six-hour preparation window. Keying the deadline on
    // it -- which the first version of this fix did -- left a short run started
    // immediately sitting in cooldown for hours instead of the fifteen minutes it
    // was owed.
    const cooldown = stateAt('cooldown');
    expect(cooldown.cooldownExpiresAtMs).toBe(cooldown.stateEnteredAtMs + COOLDOWN_BUDGET_MS);
    // And it does not move with the envelope: a run with a far later expiry rests
    // exactly as long, which is what keying on runExpiresAtMs got wrong.
    const roomier = reconcilePersistedSimulationRun(
      { ...cooldown, runExpiresAtMs: cooldown.runExpiresAtMs + 6 * 60 * 60_000 },
      cooldown.cooldownExpiresAtMs!
    );
    expect(roomier.state.status).toBe('completed');
  });

  it('keys the completion on the deadline the run carries, so audit replay reproduces it', () => {
    // The event id and the deadline both come from the state. Deriving them from
    // a policy constant instead would make every stored cooldown completion
    // unreplayable the day that constant changed -- AUDIT_DIVERGENCE on loadRun,
    // for runs that were correct when written.
    const cooldown = stateAt('cooldown');
    const due = cooldown.cooldownExpiresAtMs!;
    const first = reconcilePersistedSimulationRun(cooldown, due);
    const later = reconcilePersistedSimulationRun(cooldown, due + 9_999);
    expect(first.state.lastTransition?.eventId).toBe(`system:cooldown-complete:${due}`);
    expect(later.state.lastTransition?.eventId).toBe(first.state.lastTransition?.eventId);
  });

  it('still completes a run that entered cooldown before the deadline field existed', () => {
    // Those runs carry only the envelope. Without the fallback this change would
    // have stranded every one of them.
    const legacy = { ...stateAt('cooldown'), cooldownExpiresAtMs: undefined };
    expect(reconcilePersistedSimulationRun(legacy, legacy.runExpiresAtMs - 1)).toMatchObject({ changed: false });
    expect(reconcilePersistedSimulationRun(legacy, legacy.runExpiresAtMs).state.status).toBe('completed');
  });

  it('rejects a scheduler clock older than the persisted state', () => {
    expect(() => reconcilePersistedSimulationRun(stateAt('observing'), 5)).toThrowError(
      expect.objectContaining<Partial<SimulationStateError>>({ code: 'STALE_EVENT' })
    );
  });
});

describe('chain anchors', () => {
  const TIP = { height: 1_000, hash: 'a'.repeat(64) };
  const RECOVERED = { height: 1_012, hash: 'b'.repeat(64) };

  it('records where the fault began and where recovery was proven', () => {
    const armed = stateAt('armed');
    const pending = transitionSimulationRun(armed, {
      type: 'begin_activation',
      eventId: 'begin-act',
      atMs: 499,
      faultLeaseExpiresAtMs: 900,
    });
    const active = transitionSimulationRun(pending, {
      type: 'activate_fault',
      eventId: 'act',
      atMs: 500,
      faultLeaseExpiresAtMs: 900,
      chainTip: TIP,
    });
    expect(active.faultActivatedTip).toEqual(TIP);

    const recovering = transition(active, 'begin_recovery', 600);
    const done = transitionSimulationRun(recovering, {
      type: 'recovery_succeeded',
      eventId: 'rec',
      atMs: 700,
      chainTip: RECOVERED,
    });
    expect(done.recoveredTip).toEqual(RECOVERED);
    // The activation anchor is a fact about the run and survives every later
    // transition; recomputing it from a live tip is exactly what it replaces.
    expect(done.faultActivatedTip).toEqual(TIP);
  });

  it('carries no anchor at all when none was supplied', () => {
    // Absent, not null or zero: a deployment with no tip source records nothing
    // rather than a height it did not read, and canonicalJson drops undefined so
    // runs made before anchors existed keep their fingerprints.
    const pending = transitionSimulationRun(stateAt('armed'), beginActivationEvent('begin-act', 499));
    const active = transitionSimulationRun(pending, activateEvent('act', 500));
    expect('faultActivatedTip' in active).toBe(false);
    expect(Object.keys(active)).not.toContain('recoveredTip');
  });
});
