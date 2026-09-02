import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_COMMAND_ATTEMPTS,
  dockerExecArgv,
  dockerServiceArgv,
  fileCommandQueue,
} from './netemWrapperHost.js';
import { tcApplyArgs, tcClearArgs, type NetemSpec } from './netemLease.js';

describe('dockerExecArgv', () => {
  it('builds a root docker exec tc invocation for an apply action', () => {
    const spec: NetemSpec = { container: 'mn07', kind: 'latency', args: ['100ms'] };
    const argv = dockerExecArgv({ op: 'apply', container: 'mn07', tcArgs: tcApplyArgs(spec) });
    expect(argv).toEqual(['exec', '-u', 'root', 'mn07', 'tc', 'qdisc', 'replace', 'dev', 'eth0', 'root', 'netem', 'delay', '100ms']);
  });

  it('builds a root docker exec tc invocation for a clear action', () => {
    const argv = dockerExecArgv({ op: 'clear', container: 'mn07', tcArgs: tcClearArgs() });
    expect(argv).toEqual(['exec', '-u', 'root', 'mn07', 'tc', 'qdisc', 'del', 'dev', 'eth0', 'root']);
  });

  it('never interpolates the container into a shell string -- it is a discrete argv', () => {
    // A container name can only ever be one argv element, so there is no shell
    // for a crafted name to escape into.
    const argv = dockerExecArgv({ op: 'clear', container: 'mn01; rm -rf /', tcArgs: tcClearArgs() });
    expect(argv[3]).toBe('mn01; rm -rf /');
    expect(argv).toEqual(['exec', '-u', 'root', 'mn01; rm -rf /', 'tc', 'qdisc', 'del', 'dev', 'eth0', 'root']);
  });
});

describe('dockerServiceArgv', () => {
  it('stops with an explicit grace and starts plainly', () => {
    // The explicit -t 30 replaces Docker's 10s default: the node daemon is PID 1,
    // and a hard kill mid-write turns the restart into datadir recovery.
    expect(dockerServiceArgv({ op: 'stop', container: 'mn07' })).toEqual(['stop', '-t', '30', 'mn07']);
    expect(dockerServiceArgv({ op: 'start', container: 'mn07' })).toEqual(['start', 'mn07']);
  });

  it('keeps a crafted container name a single argv element here too', () => {
    expect(dockerServiceArgv({ op: 'stop', container: 'mn01; rm -rf /' })).toEqual(['stop', '-t', '30', 'mn01; rm -rf /']);
  });
});

describe('fileCommandQueue: a command is claimed, not consumed', () => {
  const withDir = async (fn: (dir: string) => Promise<void>) => {
    const dir = await mkdtemp(join(tmpdir(), 'wrapper-queue-'));
    try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
  };

  it('survives a crash between claiming and applying', async () => {
    // The whole point. The old queue deleted the file and only then handed the
    // command on, so a crash in that gap lost it outright -- while the
    // orchestrator had already recorded the fault as active.
    await withDir(async (dir) => {
      const queue = fileCommandQueue(dir);
      await queue.enqueue({ op: 'clear', jobId: 'a' });
      const [claimed] = await queue.claim();
      expect(claimed!.payload).toEqual({ op: 'clear', jobId: 'a' });
      // ...crash here: never acked.
      expect(await queue.claim()).toEqual([]); // in flight, not pending
      expect(await queue.recoverInflight()).toBe(1);
      const [again] = await queue.claim();
      expect(again!.payload).toEqual({ op: 'clear', jobId: 'a' });
      expect(again!.attempts).toBe(2);
    });
  });

  it('removes a command only once it was applied', async () => {
    await withDir(async (dir) => {
      const queue = fileCommandQueue(dir);
      await queue.enqueue({ op: 'clear', jobId: 'a' });
      const [claimed] = await queue.claim();
      await claimed!.ack();
      expect(await queue.recoverInflight()).toBe(0);
      expect(await queue.claim()).toEqual([]);
    });
  });

  it('returns a failed command to pending, counting the attempt', async () => {
    await withDir(async (dir) => {
      const queue = fileCommandQueue(dir);
      await queue.enqueue({ op: 'clear', jobId: 'a' });
      const [first] = await queue.claim();
      expect(first!.attempts).toBe(1);
      await first!.retry();
      const [second] = await queue.claim();
      expect(second!.attempts).toBe(2);
    });
  });

  it('quarantines a command that keeps killing the wrapper, rather than recovering it for ever', async () => {
    // The attempt is persisted when the command is CLAIMED, not only when it is
    // retried, so a command that never returns an ack -- because it takes the
    // process down with it -- is still counted each time.
    await withDir(async (dir) => {
      const queue = fileCommandQueue(dir);
      await queue.enqueue({ op: 'clear', jobId: 'poison' });
      for (let i = 0; i < MAX_COMMAND_ATTEMPTS; i++) {
        const [c] = await queue.claim();
        expect(c, `claim ${i + 1}`).toBeDefined();
        // ...crash: never acked, never retried.
        await queue.recoverInflight();
      }
      expect(await queue.claim()).toEqual([]);
      expect(await readdir(join(dir, 'rejected'))).toHaveLength(1);
    });
  });

  it('quarantines a command that has failed too many times, rather than circling for ever', async () => {
    await withDir(async (dir) => {
      const queue = fileCommandQueue(dir);
      await queue.enqueue({ op: 'clear', jobId: 'a' });
      for (let i = 0; i < MAX_COMMAND_ATTEMPTS; i++) {
        const [c] = await queue.claim();
        expect(c).toBeDefined();
        await c!.retry();
      }
      expect(await queue.claim()).toEqual([]);
      expect(await readdir(join(dir, 'rejected'))).toHaveLength(1);
    });
  });

  it('quarantines a corrupt file and still claims every well-formed command beside it', async () => {
    await withDir(async (dir) => {
      const queue = fileCommandQueue(dir);
      await queue.enqueue({ op: 'clear', jobId: 'a' });
      // A half-written file lands between two good ones; parsing before moving is
      // what stops it destroying the batch.
      await mkdir(join(dir, 'pending'), { recursive: true });
      await writeFile(join(dir, 'pending', '0000000000000000-000000001-deadbeef.json'), '{ not json', 'utf8');
      await queue.enqueue({ op: 'clear', jobId: 'b' });

      const claimed = await queue.claim();
      expect(claimed.map((c) => c.payload)).toEqual([{ op: 'clear', jobId: 'a' }, { op: 'clear', jobId: 'b' }]);
      expect(await readdir(join(dir, 'rejected'))).toHaveLength(1);
    });
  });
});
