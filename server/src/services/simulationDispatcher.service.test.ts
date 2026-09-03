import { describe, expect, it, vi } from 'vitest';
import {
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
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actionId).toBe('later');
    expect(rows[0]!.notBeforeMs).toBe(NOW + 30_000);
    expect(rows[0]!.expiresAtMs).toBe(LEASE_END);
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
