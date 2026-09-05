import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWrapperCycle } from './netemWrapperMain.js';
import {
  MAX_TTL_MS,
  NetemFaultRunner,
  dispatchWrapperCommand,
  parseWrapperCommand,
  type RunnerLogger,
  type WrapperStore,
} from './netemRunner.js';
import { fileCommandQueue } from './netemWrapperHost.js';
import { emptyWrapperState, serviceJobId, type FaultAction, type WrapperState } from './netemLease.js';

class MemoryStore implements WrapperStore {
  state: WrapperState = emptyWrapperState();
  async load(): Promise<WrapperState> { return structuredClone(this.state); }
  async save(state: WrapperState): Promise<void> { this.state = structuredClone(state); }
}

function fakeRunner(now = { ms: 1_000 }) {
  const actions: FaultAction[] = [];
  const runner = new NetemFaultRunner(async (a) => { actions.push(a); }, new MemoryStore(), { clock: () => now.ms });
  return { runner, actions, now };
}

const silent: RunnerLogger = { info: () => {}, error: () => {} };

const NOW = 1_000_000;

describe('parseWrapperCommand', () => {
  it('accepts a well-formed apply and clear', () => {
    expect(parseWrapperCommand({ op: 'apply', container: 'mn01', kind: 'latency', args: ['100ms'], runTag: 'r', expiresAtMs: NOW + 30_000 }, NOW))
      .toMatchObject({ op: 'apply', container: 'mn01', kind: 'latency', expiresAtMs: NOW + 30_000 });
    expect(parseWrapperCommand({ op: 'clear', jobId: 'netem-abc' }, NOW)).toEqual({ op: 'clear', jobId: 'netem-abc', commandId: null });
    // The id the orchestrator uses to ask what happened to this command. Absent
    // is allowed -- a wrapper driven by hand has nobody waiting on an outcome.
    expect(parseWrapperCommand({ op: 'clear', jobId: 'netem-abc', commandId: 'cmd-1' }, NOW))
      .toEqual({ op: 'clear', jobId: 'netem-abc', commandId: 'cmd-1' });
  });

  it('rejects malformed commands loudly', () => {
    expect(() => parseWrapperCommand(null, NOW)).toThrow(/object/);
    expect(() => parseWrapperCommand({ op: 'nope' }, NOW)).toThrow(/unknown/);
    expect(() => parseWrapperCommand({ op: 'apply', container: 'mn01', kind: 'bad', args: [], runTag: 'r', expiresAtMs: NOW + 1 }, NOW)).toThrow(/kind/);
    expect(() => parseWrapperCommand({ op: 'apply', container: 'mn01', kind: 'latency', args: ['100ms'], runTag: 'r' }, NOW)).toThrow(/expiresAtMs/);
    expect(() => parseWrapperCommand({ op: 'clear' }, NOW)).toThrow(/jobId/);
  });

  it('accepts a service-stop and validates its fields', () => {
    expect(parseWrapperCommand({ op: 'service-stop', container: 'mn01', runTag: 'r', expiresAtMs: NOW + 30_000 }, NOW))
      .toEqual({ op: 'service-stop', container: 'mn01', runTag: 'r', expiresAtMs: NOW + 30_000, commandId: null });
    expect(() => parseWrapperCommand({ op: 'service-stop', runTag: 'r', expiresAtMs: NOW + 1 }, NOW)).toThrow(/container/);
    expect(() => parseWrapperCommand({ op: 'service-stop', container: 'mn01', expiresAtMs: NOW + 1 }, NOW)).toThrow(/runTag/);
  });

  it('refuses a lease that has already run out', () => {
    // A duration was measured from whenever the wrapper got round to the command,
    // so queue time silently extended every fault past the instant the run had
    // recorded. An instant is right -- but an instant already in the past used to
    // parse, and then the planner "refused" by producing no actions while the
    // runner still returned a jobId and the cycle acked it as dispatched. The
    // run believed a fault was active that had never been applied.
    //
    // Queue latency alone reaches this: one `docker stop -t 30` ahead of it.
    expect(() => parseWrapperCommand({ op: 'service-stop', container: 'mn01', runTag: 'r', expiresAtMs: NOW - 5 }, NOW))
      .toThrow(/already passed/);
    expect(() => parseWrapperCommand({ op: 'apply', container: 'mn01', kind: 'latency', args: ['100ms'], runTag: 'r', expiresAtMs: NOW }, NOW))
      .toThrow(/already passed/);
    // One millisecond of lease left is still a lease.
    expect(parseWrapperCommand({ op: 'service-stop', container: 'mn01', runTag: 'r', expiresAtMs: NOW + 1 }, NOW).op)
      .toBe('service-stop');
  });

  it('bounds how far ahead the instant may be -- an unbounded lease is no recovery bound', () => {
    const over = NOW + MAX_TTL_MS + 1;
    expect(() => parseWrapperCommand({ op: 'service-stop', container: 'mn01', runTag: 'r', expiresAtMs: over }, NOW)).toThrow(/ceiling/);
    expect(() => parseWrapperCommand({ op: 'apply', container: 'mn01', kind: 'latency', args: ['100ms'], runTag: 'r', expiresAtMs: over }, NOW)).toThrow(/ceiling/);
    // The ceiling itself is accepted; it is a bound, not an exclusion.
    expect(parseWrapperCommand({ op: 'service-stop', container: 'mn01', runTag: 'r', expiresAtMs: NOW + MAX_TTL_MS }, NOW).op).toBe('service-stop');
  });
});

describe('dispatchWrapperCommand', () => {
  it('applies and clears through the runner', async () => {
    const { runner, actions } = fakeRunner();
    await dispatchWrapperCommand(runner, { op: 'apply', container: 'mn01', kind: 'latency', args: ['100ms'], runTag: 'r', expiresAtMs: 31_000, commandId: null });
    expect(actions.filter((a) => a.op === 'apply')).toHaveLength(1);
    const jobId = (await runner.apply({ container: 'mn01', kind: 'latency', args: ['100ms'] }, 'r', 31_000)).jobId;
    actions.length = 0;
    await dispatchWrapperCommand(runner, { op: 'clear', jobId, commandId: null });
    expect(actions).toEqual([{ op: 'clear', container: 'mn01', tcArgs: ['qdisc', 'del', 'dev', 'eth0', 'root'] }]);
  });

  it('routes a service-stop to the service class, and undoes it through the same clear', async () => {
    const { runner, actions } = fakeRunner();
    await dispatchWrapperCommand(runner, { op: 'service-stop', container: 'mn01', runTag: 'r', expiresAtMs: 31_000, commandId: null });
    expect(actions).toEqual([{ op: 'stop', container: 'mn01' }]);
    // There is no service-start command: a start is the undo of the stop.
    const jobId = serviceJobId('r', 'mn01');
    actions.length = 0;
    await dispatchWrapperCommand(runner, { op: 'clear', jobId, commandId: null });
    expect(actions).toEqual([{ op: 'start', container: 'mn01' }]);
  });
});

describe('runWrapperCycle', () => {
  it('applies queued commands, skips a bad one, and runs the watchdog', async () => {
    const { runner, actions, now } = fakeRunner();
    const drained = [
      { op: 'apply', container: 'mn01', kind: 'latency', args: ['100ms'], runTag: 'r', expiresAtMs: 31_000 },
      { op: 'garbage' },
      { op: 'apply', container: 'mn02', kind: 'loss', args: ['5%'], runTag: 'r', expiresAtMs: 31_000 },
    ];
    const queue = {
      async enqueue() {},
      async claim() {
        return drained.splice(0).map((payload) => ({
          payload, attempts: 1, ack: async () => {}, retry: async () => {}, reject: async () => {},
        }));
      },
      async recoverInflight() { return 0; },
    };
    const result = await runWrapperCycle({ runner, queue, logger: silent, clock: () => now.ms });
    expect(result).toMatchObject({ dispatched: 2, failed: 1, cleared: 0 });
    expect(actions.filter((a) => a.op === 'apply').map((a) => a.container).sort()).toEqual(['mn01', 'mn02']);

    // A later cycle past the TTL: the watchdog clears the expired leases.
    now.ms = 40_000;
    const swept = await runWrapperCycle({ runner, queue, logger: silent, clock: () => now.ms });
    expect(swept.cleared).toBe(2);
  });

  it('never acknowledges a command whose lease has already run out', () => {
    // The whole point of the change. Before it, an expired lease parsed, the
    // planner produced no actions, the runner still answered with a jobId, and
    // the cycle acked the command and counted it as dispatched -- so a run sat
    // in fault_active believing a fault was on that had never been applied.
    // Recovery then cleared nothing and the probes read clean, which is the
    // worst possible shape for a measurement.
    return (async () => {
      const { runner, actions, now } = fakeRunner();
      const acked: string[] = [];
      const rejected: string[] = [];
      const drained = [
        { op: 'apply', container: 'mn01', kind: 'latency', args: ['100ms'], runTag: 'r', expiresAtMs: now.ms - 1 },
      ];
      const queue = {
        async enqueue() {},
        async claim() {
          return drained.splice(0).map((payload) => ({
            payload,
            attempts: 1,
            ack: async () => { acked.push('acked'); },
            retry: async () => {},
            reject: async (reason: string) => { rejected.push(reason); },
          }));
        },
        async recoverInflight() { return 0; },
      };

      const result = await runWrapperCycle({ runner, queue, logger: silent, clock: () => now.ms });

      expect(result).toMatchObject({ dispatched: 0, failed: 1 });
      expect(acked).toEqual([]);
      expect(actions).toEqual([]);
      // Quarantined rather than retried: no number of retries makes a spent
      // lease live again, and the reason names what happened.
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatch(/already passed/);
    })();
  });
});

describe('the outcome the wrapper writes back', () => {
  const outcomes = () => {
    const written: Record<string, { status: string; detail: string | null }> = {};
    return {
      written,
      store: {
        async record(o: { commandId: string; status: 'applied' | 'rejected'; detail: string | null }) {
          written[o.commandId] = { status: o.status, detail: o.detail };
        },
        async read() { return null; },
      },
    };
  };

  const queueOf = (payloads: unknown[]) => ({
    async enqueue() {},
    async claim() {
      return payloads.splice(0).map((payload) => ({
        payload, attempts: 1, ack: async () => {}, retry: async () => {}, reject: async () => {},
      }));
    },
    async recoverInflight() { return 0; },
  });

  it('records applied against the command id once the fault is on', async () => {
    const { runner, now } = fakeRunner();
    const { written, store } = outcomes();
    const queue = queueOf([
      { op: 'apply', container: 'mn01', kind: 'latency', args: ['100ms'], runTag: 'r', expiresAtMs: now.ms + 30_000, commandId: 'cmd-1' },
    ]);

    await runWrapperCycle({ runner, queue, logger: silent, clock: () => now.ms, outcomes: store });

    expect(written['cmd-1']).toEqual({ status: 'applied', detail: null });
  });

  it('records a rejection against the id read off the raw payload', async () => {
    // The parse is what failed, so the id cannot come from the parsed command.
    // Without reading it off the payload a malformed command is quarantined
    // silently and the orchestrator waits out its whole timeout for an outcome
    // that was never going to come.
    const { runner, now } = fakeRunner();
    const { written, store } = outcomes();
    const queue = queueOf([{ op: 'apply', container: 'mn01', commandId: 'cmd-2' }]);

    await runWrapperCycle({ runner, queue, logger: silent, clock: () => now.ms, outcomes: store });

    expect(written['cmd-2']!.status).toBe('rejected');
    expect(written['cmd-2']!.detail).toMatch(/kind/);
  });

  it('says nothing while a command is still being retried', async () => {
    // A retry is not an outcome. Recording one would tell the orchestrator a
    // fault had failed while the wrapper was still going to apply it.
    const { now } = fakeRunner();
    const failing = {
      apply: async () => { throw new Error('docker is busy'); },
      stopService: async () => ({ jobId: 'x' }),
      clear: async () => {},
      tick: async () => ({ cleared: 0, failed: 0 }),
    } as unknown as Parameters<typeof runWrapperCycle>[0]['runner'];
    const { written, store } = outcomes();
    const queue = queueOf([
      { op: 'apply', container: 'mn01', kind: 'latency', args: ['100ms'], runTag: 'r', expiresAtMs: now.ms + 30_000, commandId: 'cmd-3' },
    ]);

    const result = await runWrapperCycle({ runner: failing, queue, logger: silent, clock: () => now.ms, outcomes: store });

    expect(result.failed).toBe(1);
    expect(written['cmd-3']).toBeUndefined();
  });
});

describe('fileCommandQueue', () => {
  it('round-trips commands in submission order and consumes the files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wrapper-queue-'));
    try {
      const queue = fileCommandQueue(dir);
      expect(await queue.claim()).toEqual([]); // empty is fine
      await queue.enqueue({ op: 'clear', jobId: 'a' });
      await queue.enqueue({ op: 'clear', jobId: 'b' });
      const claimed = await queue.claim();
      expect(claimed.map((c) => c.payload)).toEqual([{ op: 'clear', jobId: 'a' }, { op: 'clear', jobId: 'b' }]);
      // Claimed, not consumed: still in flight until acked.
      expect(await queue.claim()).toEqual([]);
      for (const c of claimed) await c.ack();
      expect(await queue.recoverInflight()).toBe(0); // nothing stranded
      expect(await queue.claim()).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
