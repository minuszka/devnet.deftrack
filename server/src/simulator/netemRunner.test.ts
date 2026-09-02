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

    await runner.apply(latency, RUN, 31_000);
    expect(order).toEqual(['save', 'exec']); // record intent, then act
    expect(saved[0]!.jobs[0]).toMatchObject({ container: 'mn01', expiresAtMs: 31_000 });
  });

  it('is idempotent: re-applying the identical live fault runs no tc', async () => {
    const { runner, actions } = harness();
    await runner.apply(latency, RUN, 31_000);
    await runner.apply(latency, RUN, 31_000);
    expect(actions.filter((a) => a.op === 'apply')).toHaveLength(1);
  });

  it('watchdog clears an expired lease with nothing but its own clock', async () => {
    const { runner, store, actions, now } = harness();
    await runner.apply(latency, RUN, 31_000);
    actions.length = 0;
    now.ms = 40_000; // past the 31_000 expiry
    const result = await runner.tick();
    expect(result).toEqual({ cleared: 1, failed: 0 });
    expect(actions).toEqual([{ op: 'clear', container: 'mn01', tcArgs: ['qdisc', 'del', 'dev', 'eth0', 'root'] }]);
    expect(store.state.jobs).toEqual([]);
  });

  it('watchdog leaves a still-live lease alone', async () => {
    const { runner, actions, now } = harness();
    await runner.apply(latency, RUN, 31_000);
    actions.length = 0;
    now.ms = 20_000; // before expiry
    expect(await runner.tick()).toEqual({ cleared: 0, failed: 0 });
    expect(actions).toEqual([]);
  });

  it('clear runs tc before dropping the job', async () => {
    const { runner, store, actions } = harness();
    const { jobId } = await runner.apply(latency, RUN, 31_000);
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
    await runner.apply(latency, RUN, 31_000);
    await runner.apply({ container: 'mn02', kind: 'loss', args: ['5%'] }, RUN, 31_000);
    actions.length = 0;
    const result = await runner.bootCleanup();
    expect(result.cleared).toBe(2);
    expect(actions.every((a) => a.op === 'clear')).toBe(true);
    expect(actions.map((a) => a.container).sort()).toEqual(['mn01', 'mn02']);
    expect(store.state.jobs).toEqual([]);
  });
});

describe('LabFaultRunner: the service fault class', () => {
  it('records the stop before running docker stop, mirroring apply', async () => {
    const store = new MemoryStore();
    const origSave = store.save.bind(store);
    const order: string[] = [];
    store.save = async (s) => { order.push('save'); await origSave(s); };
    const runner = new NetemFaultRunner(async () => { order.push('exec'); }, store, { clock: () => 1_000 });
    await runner.stopService('mn01', RUN, 31_000);
    expect(order).toEqual(['save', 'exec']); // a stop that lands unrecorded never comes back
  });

  it('is idempotent, and its undo is a start that runs before the job is dropped', async () => {
    const { runner, store, actions } = harness();
    const { jobId } = await runner.stopService('mn01', RUN, 31_000);
    await runner.stopService('mn01', RUN, 31_000);
    expect(actions).toEqual([{ op: 'stop', container: 'mn01' }]); // second stop ran nothing
    actions.length = 0;
    await runner.clear(jobId);
    expect(actions).toEqual([{ op: 'start', container: 'mn01' }]);
    expect(store.state.jobs).toEqual([]);
  });

  it('the watchdog starts a stopped container back up on its own clock', async () => {
    const { runner, store, actions, now } = harness();
    await runner.stopService('mn01', RUN, 31_000);
    actions.length = 0;
    now.ms = 40_000;
    expect(await runner.tick()).toEqual({ cleared: 1, failed: 0 });
    expect(actions).toEqual([{ op: 'start', container: 'mn01' }]);
    expect(store.state.jobs).toEqual([]);
  });

  it('boot recovery starts a stopped container rather than deleting a qdisc', async () => {
    const { runner, store, actions } = harness();
    await runner.stopService('mn01', RUN, 31_000);
    actions.length = 0;
    expect((await runner.bootCleanup()).cleared).toBe(1);
    expect(actions).toEqual([{ op: 'start', container: 'mn01' }]);
    expect(store.state.jobs).toEqual([]);
  });
});

describe('LabFaultRunner: one failing undo cannot strand another', () => {
  it('sweeps every expired job, dropping only the ones whose undo landed', async () => {
    const store = new MemoryStore();
    const seen: FaultAction[] = [];
    // mn01 is unrestorable; mn02 and mn03 must still come back in the same sweep.
    const runner = new NetemFaultRunner(async (action) => {
      seen.push(action);
      if (action.container === 'mn01') throw new Error('No such container: mn01');
    }, store, { clock: () => 1_000 });
    await runner.stopService('mn02', RUN, 31_000);
    await runner.stopService('mn03', RUN, 31_000);
    // mn01 is injected directly: its stop is recorded, its undo will fail.
    store.state.jobs.push({ jobId: 'service-dead', runTag: RUN, container: 'mn01', faultClass: 'service', kind: 'service-stop', args: [], appliedAtMs: 1_000, expiresAtMs: 31_000 });
    seen.length = 0;

    const runnerAtExpiry = new NetemFaultRunner(async (action) => {
      seen.push(action);
      if (action.container === 'mn01') throw new Error('No such container: mn01');
    }, store, { clock: () => 40_000 });
    const result = await runnerAtExpiry.tick();

    expect(result).toEqual({ cleared: 2, failed: 1 });
    expect(seen.map((a) => a.container).sort()).toEqual(['mn01', 'mn02', 'mn03']); // no head-of-line block
    expect(store.state.jobs.map((j) => j.container)).toEqual(['mn01']); // only the failure is retained
  });

  it('boot recovery never rejects, retains what it could not undo, and the next tick retries it', async () => {
    const store = new MemoryStore();
    let failing = true;
    const seen: FaultAction[] = [];
    const runner = new NetemFaultRunner(async (action) => {
      seen.push(action);
      if (failing) throw new Error('docker daemon unreachable');
    }, store, { clock: () => 50_000 });
    store.state.jobs.push({ jobId: 'service-x', runTag: RUN, container: 'mn01', faultClass: 'service', kind: 'service-stop', args: [], appliedAtMs: 1_000, expiresAtMs: 31_000 });

    const boot = await runner.bootCleanup(); // must not throw
    expect(boot).toEqual({ cleared: 0, failed: 1 });
    // Retained as already-expired, so the very next tick picks it up.
    expect(store.state.jobs).toHaveLength(1);
    expect(store.state.jobs[0]!.expiresAtMs).toBe(0);

    failing = false;
    seen.length = 0;
    expect(await runner.tick()).toEqual({ cleared: 1, failed: 0 });
    expect(seen).toEqual([{ op: 'start', container: 'mn01' }]);
    expect(store.state.jobs).toEqual([]);
  });

  it('boot recovery survives an unreadable state file instead of taking the daemon down', async () => {
    const store = new MemoryStore();
    store.load = async () => { throw new Error('state.json is truncated'); };
    const runner = new NetemFaultRunner(async () => {}, store, { clock: () => 1_000 });
    await expect(runner.bootCleanup()).resolves.toEqual({ cleared: 0, failed: 0 });
  });

  it('start() arms the watchdog even when boot recovery fails', async () => {
    const store = new MemoryStore();
    store.load = async () => { throw new Error('unreadable'); };
    const runner = new NetemFaultRunner(async () => {}, store, { clock: () => 1_000, intervalMs: 10_000 });
    runner.start();
    try {
      // The timer is armed before anything that can fail; without this the gate
      // fails in exactly the case it exists to cover.
      expect(runner.watchdogArmed).toBe(true);
    } finally {
      runner.stop();
    }
  });
});

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

const serviceJob = (container: string, jobId: string, expiresAtMs: number) => ({
  jobId, runTag: RUN, container, faultClass: 'service' as const, kind: 'service-stop' as const,
  args: [], appliedAtMs: 1_000, expiresAtMs,
});

describe('LabFaultRunner: concurrent operations cannot erase a live lease', () => {
  it('a slow undo does not drop a fault recorded while it was in flight', async () => {
    // The exact shape of the race: clear() loads the state, spends the SIGTERM
    // grace inside docker, and used to save its pre-computed snapshot -- dropping
    // any job recorded meanwhile. A stopped container no record covers is one
    // neither the watchdog nor boot recovery can ever bring back.
    const store = new MemoryStore();
    const gate = deferred();
    const runner = new NetemFaultRunner(async (action) => {
      if (action.op === 'start') await gate.promise; // docker start, seconds long
    }, store, { clock: () => 1_000 });

    const { jobId } = await runner.stopService('mn01', RUN, 31_000);
    const clearing = runner.clear(jobId);          // blocks inside docker
    const stopping = runner.stopService('mn02', RUN, 31_000); // lands meanwhile
    gate.release();
    await Promise.all([clearing, stopping]);

    expect(store.state.jobs.map((j) => j.container)).toEqual(['mn02']);
  });

  it('a slow watchdog sweep does not drop a fault recorded while it was in flight', async () => {
    const store = new MemoryStore();
    const gate = deferred();
    let now = 1_000;
    const runner = new NetemFaultRunner(async (action) => {
      if (action.op === 'start') await gate.promise;
    }, store, { clock: () => now });

    await runner.stopService('mn01', RUN, 31_000);
    now = 40_000; // mn01's lease has expired
    const sweeping = runner.tick();
    // mn02's lease is dated against the clock as it stands now: an instant that
    // has already gone is refused outright, which is the point of the change.
    const stopping = runner.stopService('mn02', RUN, 70_000);
    gate.release();
    const [swept] = await Promise.all([sweeping, stopping]);

    expect(swept).toEqual({ cleared: 1, failed: 0 });
    expect(store.state.jobs.map((j) => j.container)).toEqual(['mn02']);
  });

  it('re-reads the record after the docker call, so an out-of-band write survives', async () => {
    // Belt and braces behind the serialisation: even a writer this runner does not
    // know about must not be erased by a stale snapshot.
    const store = new MemoryStore();
    const runner = new NetemFaultRunner(async (action) => {
      if (action.op === 'start') {
        const outOfBand = await store.load();
        outOfBand.jobs.push(serviceJob('mn09', 'service-elsewhere', 31_000));
        await store.save(outOfBand);
      }
    }, store, { clock: () => 1_000 });

    const { jobId } = await runner.stopService('mn01', RUN, 31_000);
    await runner.clear(jobId);

    expect(store.state.jobs.map((j) => j.container)).toEqual(['mn09']);
  });

  it('serialises apply against a slow stop, so neither loses its record', async () => {
    const store = new MemoryStore();
    const gate = deferred();
    const runner = new NetemFaultRunner(async (action) => {
      if (action.op === 'stop') await gate.promise;
    }, store, { clock: () => 1_000 });

    const stopping = runner.stopService('mn01', RUN, 31_000);
    const applying = runner.apply({ container: 'mn02', kind: 'latency', args: ['100ms'] }, RUN, 31_000);
    gate.release();
    await Promise.all([stopping, applying]);

    expect(store.state.jobs.map((j) => j.container).sort()).toEqual(['mn01', 'mn02']);
  });
});
