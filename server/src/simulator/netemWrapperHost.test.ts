import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dockerExecArgv, dockerServiceArgv, fileCommandQueue } from './netemWrapperHost.js';
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

describe('fileCommandQueue.drain', () => {
  it('quarantines a corrupt file and still returns every well-formed command beside it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wrapper-drain-'));
    try {
      const queue = fileCommandQueue(dir);
      await queue.enqueue({ op: 'clear', jobId: 'a' });
      // A half-written file lands between two good ones; parsing before deleting
      // is what stops it destroying the batch. A lost service-stop is a node that
      // never goes down -- or, worse, one that never comes back up.
      await writeFile(join(dir, '0000000000000000-000000001-deadbeef.json'), '{ not json', 'utf8');
      await queue.enqueue({ op: 'clear', jobId: 'b' });

      const drained = await queue.drain();
      expect(drained).toEqual([{ op: 'clear', jobId: 'a' }, { op: 'clear', jobId: 'b' }]);
      expect(await readdir(join(dir, 'rejected'))).toHaveLength(1);
      expect(await queue.drain()).toEqual([]); // the quarantined file is not re-read
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
