import { describe, expect, it } from 'vitest';
import { NetemFaultRunner, type FaultExecutor, type WrapperStore } from './netemRunner.js';
import { emptyWrapperState, type FaultAction, type NetemSpec, type WrapperState } from './netemLease.js';

const RUN = 'run-x';
const latency: NetemSpec = { container: 'mn01', kind: 'latency', args: ['100ms'] };

class MemoryStore implements WrapperStore {
  state: WrapperState = emptyWrapperState();
  async load(): Promise<WrapperState> { return structuredClone(this.state); }
  async save(state: WrapperState): Promise<void> { this.state = structuredClone(state); }
}

function harness(now = { ms: 1_000 }) {
  const actions: FaultAction[] = [];
  const store = new MemoryStore();
  const execute: FaultExecutor = async (action) => { actions.push(action); };
  const runner = new NetemFaultRunner(execute, store, { clock: () => now.ms });
  return { runner, store, actions, now };
}

describe('NetemFaultRunner', () => {
  it('records the job before running tc, so an applied rule is always clearable', async () => {
    const saved: WrapperState[] = [];
    const store = new MemoryStore();
    const origSave = store.save.bind(store);
    const order: string[] = [];
    store.save = async (s) => { order.push('save'); saved.push(structuredClone(s)); await origSave(s); };
    const execute: FaultExecutor = async () => { order.push('exec'); };
    const runner = new NetemFaultRunner(execute, store, { clock: () => 1_000 });

    await runner.apply(latency, RUN, 30_000);
    expect(order).toEqual(['save', 'exec']); // record intent, then act
    expect(saved[0]!.jobs[0]).toMatchObject({ container: 'mn01', expiresAtMs: 31_000 });
  });

  it('is idempotent: re-applying the identical live fault runs no tc', async () => {
    const { runner, actions } = harness();
    await runner.apply(latency, RUN, 30_000);
    await runner.apply(latency, RUN, 30_000);
    expect(actions.filter((a) => a.op === 'apply')).toHaveLength(1);
  });

  it('watchdog clears an expired lease with nothing but its own clock', async () => {
    const { runner, store, actions, now } = harness();
    await runner.apply(latency, RUN, 30_000);
    actions.length = 0;
    now.ms = 40_000; // past the 31_000 expiry
    const result = await runner.tick();
    expect(result).toEqual({ cleared: 1 });
    expect(actions).toEqual([{ op: 'clear', container: 'mn01', tcArgs: ['qdisc', 'del', 'dev', 'eth0', 'root'] }]);
    expect(store.state.jobs).toEqual([]);
  });

  it('watchdog leaves a still-live lease alone', async () => {
    const { runner, actions, now } = harness();
    await runner.apply(latency, RUN, 30_000);
    actions.length = 0;
    now.ms = 20_000; // before expiry
    expect(await runner.tick()).toEqual({ cleared: 0 });
    expect(actions).toEqual([]);
  });

  it('clear runs tc before dropping the job', async () => {
    const { runner, store, actions } = harness();
    const { jobId } = await runner.apply(latency, RUN, 30_000);
    actions.length = 0;
    await runner.clear(jobId);
    expect(actions).toEqual([{ op: 'clear', container: 'mn01', tcArgs: ['qdisc', 'del', 'dev', 'eth0', 'root'] }]);
    expect(store.state.jobs).toEqual([]);
    // Clearing again is a no-op.
    actions.length = 0;
    await runner.clear(jobId);
    expect(actions).toEqual([]);
  });

  it('boot cleanup clears every recorded container and starts clean', async () => {
    const { runner, store, actions } = harness();
    await runner.apply(latency, RUN, 30_000);
    await runner.apply({ container: 'mn02', kind: 'loss', args: ['5%'] }, RUN, 30_000);
    actions.length = 0;
    const result = await runner.bootCleanup();
    expect(result.cleared).toBe(2);
    expect(actions.every((a) => a.op === 'clear')).toBe(true);
    expect(actions.map((a) => a.container).sort()).toEqual(['mn01', 'mn02']);
    expect(store.state.jobs).toEqual([]);
  });
});
