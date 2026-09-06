import { describe, expect, it, vi } from 'vitest';
import {
  PLANNED_END_KIND,
  SimulationActionDispatcher,
  scheduledActionRowsFor,
} from './simulationDispatcher.service.js';
import type { LeasedSimulationAction } from './simulationAction.repository.js';

const NOW = 1_000_000;
const LEASE_END = NOW + 600_000;

function leased(overrides: Partial<LeasedSimulationAction> = {}): LeasedSimulationAction {
  return {
    actionId: 'act-1',
    runKey: 'run-1',
    targetId: 'mn-1',
    kind: 'service-stop',
    payload: {},
    attempts: 1,
    maxAttempts: 3,
    leaseUntilMs: NOW + 30_000,
    expiresAtMs: LEASE_END,
    ...overrides,
  } as LeasedSimulationAction;
}

function harness(overrides: {
  status?: string;
  lease?: number | null;
  claims?: (LeasedSimulationAction | null)[];
  dispatch?: ReturnType<typeof vi.fn>;
  plannedEnd?: ReturnType<typeof vi.fn>;
} = {}) {
  const claims = overrides.claims ?? [leased(), null];
  let claimIndex = 0;
  const settle = vi.fn(async () => true);
  const expireOverdue = vi.fn(async () => 0);
  const dispatch = overrides.dispatch ?? vi.fn(async () => {});
  const errors: string[] = [];
  const run = {
    runKey: 'run-1',
    state: {
      status: overrides.status ?? 'fault_active',
      faultLeaseExpiresAtMs: overrides.lease === undefined ? LEASE_END : overrides.lease,
    },
  };
  const actions = {
    enqueue: vi.fn(async () => 0),
    cancelPending: vi.fn(async () => 0),
    claimDue: vi.fn(async () => claims[claimIndex++] ?? null),
    renewLease: vi.fn(async () => null),
    settle,
    expireOverdue,
  };
  const dispatcher = new SimulationActionDispatcher(actions as never, {
    loadRun: async () => run as never,
    loadPlan: async () => ({ actions: [] }) as never,
    dispatch: dispatch as never,
    ...(overrides.plannedEnd === undefined ? {} : { plannedEnd: overrides.plannedEnd as never }),
    workerId: 'worker-1',
    clock: () => NOW,
    logger: { info: () => {}, error: (m) => errors.push(m) },
  });
  return { dispatcher, actions, settle, dispatch, expireOverdue, errors };
}

describe('dispatching a scheduled action', () => {
  it('performs it and records the outcome', async () => {
    const h = harness();
    await h.dispatcher.tick();
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ actionId: 'act-1', faultLeaseExpiresAtMs: LEASE_END })
    );
    expect(h.settle).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded', claimedBy: 'worker-1' })
    );
  });

  it('retires what can no longer progress before claiming anything', async () => {
    // An action whose window has closed must not be handed to a worker that
    // would then apply a fault the run has no time left to undo.
    const h = harness();
    await h.dispatcher.tick();
    expect(h.expireOverdue).toHaveBeenCalledWith(NOW);
    expect(h.expireOverdue.mock.invocationCallOrder[0]!).toBeLessThan(
      h.actions.claimDue.mock.invocationCallOrder[0]!
    );
  });

  it('applies nothing to a run that has left its fault window', async () => {
    // Recovery proves the lab clean; a stop arriving afterwards would make that
    // proof a lie. The queue is cancelled at recovery, and this is the second
    // guard on the same rule, for the race between cancelling and claiming.
    const h = harness({ status: 'cooldown' });
    await h.dispatcher.tick();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.settle).toHaveBeenCalledWith(expect.objectContaining({ status: 'compensated' }));
  });

  it('applies nothing once the run lease has ended', async () => {
    const h = harness({ lease: NOW - 1 });
    await h.dispatcher.tick();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.settle).toHaveBeenCalledWith(expect.objectContaining({ status: 'compensated' }));
  });

  it('records a failure against the action rather than losing the pass', async () => {
    const h = harness({
      claims: [leased(), leased({ actionId: 'act-2' }), null],
      dispatch: vi.fn().mockRejectedValueOnce(new Error('wrapper down')).mockResolvedValueOnce(undefined),
    });
    await h.dispatcher.tick();
    expect(h.settle).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'failed' }));
    expect(h.settle).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 'succeeded' }));
  });

  it('closes the plan through the planned-end handler, never through the wrapper', async () => {
    // The run has done everything its plan said; what follows is recovery with
    // no abort intent, so the record ends `completed` and not as a timeout.
    const plannedEnd = vi.fn(async () => {});
    const h = harness({
      status: 'observing',
      claims: [leased({ actionId: 'run-1:planned-end', kind: PLANNED_END_KIND, targetId: 'run' }), null],
      plannedEnd,
    });
    await h.dispatcher.tick();
    expect(plannedEnd).toHaveBeenCalledWith(expect.objectContaining({ runKey: 'run-1' }));
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.settle).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
  });

  it('leaves the lease to close a run when no planned-end handler exists', async () => {
    // Fail closed: nothing is applied and nothing is claimed as done; the run
    // still ends, by its lease, the way it did before the planned end existed.
    const h = harness({
      status: 'observing',
      claims: [leased({ actionId: 'run-1:planned-end', kind: PLANNED_END_KIND, targetId: 'run' }), null],
    });
    await h.dispatcher.tick();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.settle).toHaveBeenCalledWith(expect.objectContaining({ status: 'compensated' }));
  });

  it('does not start a second pass while one is running', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness({
      claims: [leased(), null, leased({ actionId: 'act-2' }), null],
      dispatch: vi.fn(async () => {
        await gate;
      }),
    });
    const first = h.dispatcher.tick();
    await h.dispatcher.tick();
    release!();
    await first;
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('scheduledActionRowsFor', () => {
  const action = (actionId: string, offset: number) => ({
    actionId,
    sequence: 0,
    targetId: 'mn-1',
    kind: 'service-stop',
    payload: { kind: 'service-stop' },
    payloadDigest: 'digest',
    notBeforeOffsetMs: offset,
    maxAttempts: 3,
  });

  it('keeps only what is scheduled, at an absolute instant', () => {
    // Absolute, not a delay: a delay would restart on every retry and drift with
    // the queue, which is the mistake the fault lease already refuses to make.
    const rows = scheduledActionRowsFor({
      runKey: 'run-1',
      actions: [action('now', 0), action('later', 30_000)] as never,
      activatedAtMs: NOW,
      faultLeaseExpiresAtMs: LEASE_END,
    });
    expect(rows.map((row) => row.actionId)).toEqual(['later', 'run-1:planned-end']);
    expect(rows[0]!.notBeforeMs).toBe(NOW + 30_000);
    expect(rows[0]!.expiresAtMs).toBe(LEASE_END);
  });

  it('declares the planned end one second after the plan\'s last instant', () => {
    // Over every action, not only the dispatchable ones: a netem fault-clear is
    // recovery's work, but it still says when the plan is over. The second of
    // delay lets the last step settle before the end is declared, and the row
    // sorts after it by sequence as well.
    const rows = scheduledActionRowsFor({
      runKey: 'run-1',
      actions: [
        { ...action('stop-it', 0), sequence: 1 },
        { ...action('clear-it', 45_000), sequence: 2, kind: 'fault-clear', payload: { kind: 'fault-clear', scope: 'run' } },
      ] as never,
      activatedAtMs: NOW,
      faultLeaseExpiresAtMs: LEASE_END,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actionId: 'run-1:planned-end',
      kind: PLANNED_END_KIND,
      targetId: 'run',
      sequence: 3,
      notBeforeMs: NOW + 45_000 + 1_000,
      expiresAtMs: LEASE_END,
    });
  });

  it('has no planned end for a plan made only of immediate steps', () => {
    const rows = scheduledActionRowsFor({
      runKey: 'run-1',
      actions: [action('now', 0)] as never,
      activatedAtMs: NOW,
      faultLeaseExpiresAtMs: LEASE_END,
    });
    expect(rows).toEqual([]);
  });

  it('queues the Sentinel clear, which the wrapper performs by fault id', () => {
    const rows = scheduledActionRowsFor({
      runKey: 'run-1',
      actions: [
        { ...action('clear-dsl', 30_000), kind: 'dsl-fault-clear', payload: { kind: 'dsl-fault-clear', faultKind: 'response-drop' } },
      ] as never,
      activatedAtMs: NOW,
      faultLeaseExpiresAtMs: LEASE_END,
    });
    expect(rows.map((row) => row.actionId)).toEqual(['clear-dsl', 'run-1:planned-end']);
  });

  it('queues nothing for a kind the dispatcher cannot perform', () => {
    // A scheduled fault-clear is recovery's work, and the translation refuses
    // it by design -- so a queued row for one could only ever fail its lookup,
    // retry to its attempt limit, and be recorded as a failed action on every
    // netem run. It described a dispatcher fault where there was none.
    const rows = scheduledActionRowsFor({
      runKey: 'run-1',
      actions: [
        { ...action('clear-it', 30_000), kind: 'fault-clear', payload: { kind: 'fault-clear', scope: 'run' } },
        action('stop-it', 30_000),
      ] as never,
      activatedAtMs: NOW,
      faultLeaseExpiresAtMs: LEASE_END,
    });
    expect(rows.map((row) => row.actionId)).toEqual(['stop-it', 'run-1:planned-end']);
  });

  it('drops an action that would fall due after the run is over', () => {
    // It could not be undone within the run, so it is never queued at all rather
    // than queued and expired later.
    const rows = scheduledActionRowsFor({
      runKey: 'run-1',
      actions: [action('too-late', 900_000)] as never,
      activatedAtMs: NOW,
      faultLeaseExpiresAtMs: LEASE_END,
    });
    expect(rows).toEqual([]);
  });
});
