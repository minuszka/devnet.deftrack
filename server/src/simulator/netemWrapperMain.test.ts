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
    expect(parseWrapperCommand({ op: 'clear', jobId: 'netem-abc' }, NOW)).toEqual({ op: 'clear', jobId: 'netem-abc' });
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
      .toEqual({ op: 'service-stop', container: 'mn01', runTag: 'r', expiresAtMs: NOW + 30_000 });
    expect(() => parseWrapperCommand({ op: 'service-stop', runTag: 'r', expiresAtMs: NOW + 1 }, NOW)).toThrow(/container/);
    expect(() => parseWrapperCommand({ op: 'service-stop', container: 'mn01', expiresAtMs: NOW + 1 }, NOW)).toThrow(/runTag/);
  });

  it('takes a lease as an instant, and a past one is not a parse error', () => {
    // A duration was measured from whenever the wrapper got round to the command,
    // so queue time silently extended every fault past the instant the run had
    // recorded. An instant that has already gone parses fine -- refusing it is the
    // planner's job, and it refuses by applying nothing at all.
    expect(parseWrapperCommand({ op: 'service-stop', container: 'mn01', runTag: 'r', expiresAtMs: NOW - 5 }, NOW).op)
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
    await dispatchWrapperCommand(runner, { op: 'apply', container: 'mn01', kind: 'latency', args: ['100ms'], runTag: 'r', expiresAtMs: 31_000 });
    expect(actions.filter((a) => a.op === 'apply')).toHaveLength(1);
    const jobId = (await runner.apply({ container: 'mn01', kind: 'latency', args: ['100ms'] }, 'r', 31_000)).jobId;
    actions.length = 0;
    await dispatchWrapperCommand(runner, { op: 'clear', jobId });
    expect(actions).toEqual([{ op: 'clear', container: 'mn01', tcArgs: ['qdisc', 'del', 'dev', 'eth0', 'root'] }]);
  });

  it('routes a service-stop to the service class, and undoes it through the same clear', async () => {
    const { runner, actions } = fakeRunner();
    await dispatchWrapperCommand(runner, { op: 'service-stop', container: 'mn01', runTag: 'r', expiresAtMs: 31_000 });
    expect(actions).toEqual([{ op: 'stop', container: 'mn01' }]);
    // There is no service-start command: a start is the undo of the stop.
    const jobId = serviceJobId('r', 'mn01');
    actions.length = 0;
    await dispatchWrapperCommand(runner, { op: 'clear', jobId });
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
    const result = await runWrapperCycle({ runner, queue, logger: silent });
    expect(result).toMatchObject({ dispatched: 2, failed: 1, cleared: 0 });
    expect(actions.filter((a) => a.op === 'apply').map((a) => a.container).sort()).toEqual(['mn01', 'mn02']);

    // A later cycle past the TTL: the watchdog clears the expired leases.
    now.ms = 40_000;
    const swept = await runWrapperCycle({ runner, queue, logger: silent });
    expect(swept.cleared).toBe(2);
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
