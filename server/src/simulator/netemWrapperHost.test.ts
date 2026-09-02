import { describe, expect, it } from 'vitest';
import { dockerExecArgv } from './netemWrapperHost.js';
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
