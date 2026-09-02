import { describe, expect, it } from 'vitest';
import {
  emptyWrapperState,
  faultClassOf,
  netemJobId,
  parseWrapperState,
  planApply,
  planBootRecovery,
  planClear,
  planServiceStop,
  planSweep,
  serviceJobId,
  sweepExpired,
  tcApplyArgs,
  tcClearArgs,
  undoFor,
  type NetemSpec,
} from './netemLease.js';

const RUN = 'run-abc';
const latency: NetemSpec = { container: 'mn01', kind: 'latency', args: ['100ms'] };

describe('tc arguments', () => {
  it('builds replace-based apply args per kind and validates them', () => {
    expect(tcApplyArgs(latency)).toEqual(['qdisc', 'replace', 'dev', 'eth0', 'root', 'netem', 'delay', '100ms']);
    expect(tcApplyArgs({ container: 'mn01', kind: 'jitter', args: ['100ms', '20ms'] }))
      .toEqual(['qdisc', 'replace', 'dev', 'eth0', 'root', 'netem', 'delay', '100ms', '20ms']);
    expect(tcApplyArgs({ container: 'mn01', kind: 'loss', args: ['5%'] }))
      .toEqual(['qdisc', 'replace', 'dev', 'eth0', 'root', 'netem', 'loss', '5%']);
    expect(tcClearArgs()).toEqual(['qdisc', 'del', 'dev', 'eth0', 'root']);
  });

  it('rejects malformed netem arguments before any state changes', () => {
    expect(() => tcApplyArgs({ container: 'mn01', kind: 'latency', args: ['100'] })).toThrow(/latency/);
    expect(() => tcApplyArgs({ container: 'mn01', kind: 'loss', args: ['5'] })).toThrow(/loss/);
    expect(() => tcApplyArgs({ container: 'mn01', kind: 'jitter', args: ['100ms'] })).toThrow(/jitter/);
  });

  it('passes a composed netem vector through and validates its structure', () => {
    expect(tcApplyArgs({ container: 'mn01', kind: 'netem', args: ['delay', '100ms', '20ms', 'loss', '5%', '25%'] }))
      .toEqual(['qdisc', 'replace', 'dev', 'eth0', 'root', 'netem', 'delay', '100ms', '20ms', 'loss', '5%', '25%']);
    expect(tcApplyArgs({ container: 'mn01', kind: 'netem', args: ['loss', '5%'] }))
      .toEqual(['qdisc', 'replace', 'dev', 'eth0', 'root', 'netem', 'loss', '5%']);
    // Nothing but a delay-then-loss clause is accepted, so no arbitrary tc token can ride in.
    expect(() => tcApplyArgs({ container: 'mn01', kind: 'netem', args: [] })).toThrow(/netem args/);
    expect(() => tcApplyArgs({ container: 'mn01', kind: 'netem', args: ['loss', '5%', 'delay', '100ms'] })).toThrow(/netem args/);
    expect(() => tcApplyArgs({ container: 'mn01', kind: 'netem', args: ['rate', '1mbit'] })).toThrow(/netem args/);
    expect(() => tcApplyArgs({ container: 'mn01', kind: 'netem', args: ['delay', '100'] })).toThrow(/delay/);
  });
});

describe('netemJobId', () => {
  it('is deterministic and distinguishes run, container, kind and args', () => {
    expect(netemJobId(RUN, latency)).toBe(netemJobId(RUN, { ...latency, args: ['100ms'] }));
    expect(netemJobId(RUN, latency)).not.toBe(netemJobId('other-run', latency));
    expect(netemJobId(RUN, latency)).not.toBe(netemJobId(RUN, { ...latency, args: ['200ms'] }));
    expect(netemJobId(RUN, latency)).not.toBe(netemJobId(RUN, { ...latency, container: 'mn02' }));
  });
});

describe('planApply', () => {
  it('applies a fault under a lease and records its expiry', () => {
    const { state, actions } = planApply(emptyWrapperState(), latency, RUN, 1_000, 30_000);
    expect(actions).toEqual([{ op: 'apply', container: 'mn01', tcArgs: tcApplyArgs(latency) }]);
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0]).toMatchObject({ container: 'mn01', runTag: RUN, appliedAtMs: 1_000, expiresAtMs: 31_000 });
  });

  it('is idempotent: re-applying the identical live fault does nothing', () => {
    const first = planApply(emptyWrapperState(), latency, RUN, 1_000, 30_000);
    const again = planApply(first.state, latency, RUN, 2_000, 30_000);
    expect(again.actions).toEqual([]);
    expect(again.state).toBe(first.state);
  });

  it('replaces a different fault on the same container -- one qdisc per interface', () => {
    const first = planApply(emptyWrapperState(), latency, RUN, 1_000, 30_000);
    const loss: NetemSpec = { container: 'mn01', kind: 'loss', args: ['5%'] };
    const second = planApply(first.state, loss, RUN, 2_000, 30_000);
    expect(second.actions).toEqual([{ op: 'apply', container: 'mn01', tcArgs: tcApplyArgs(loss) }]);
    expect(second.state.jobs).toHaveLength(1);
    expect(second.state.jobs[0]!.kind).toBe('loss');
  });

  it('re-applies an expired lease rather than treating it as live', () => {
    const first = planApply(emptyWrapperState(), latency, RUN, 1_000, 30_000);
    const afterExpiry = planApply(first.state, latency, RUN, 40_000, 30_000);
    expect(afterExpiry.actions).toHaveLength(1);
    expect(afterExpiry.state.jobs[0]!.expiresAtMs).toBe(70_000);
  });
});

describe('planClear', () => {
  it('clears a known job and is idempotent for an unknown one', () => {
    const applied = planApply(emptyWrapperState(), latency, RUN, 1_000, 30_000);
    const jobId = applied.state.jobs[0]!.jobId;
    const cleared = planClear(applied.state, jobId);
    expect(cleared.actions).toEqual([{ op: 'clear', container: 'mn01', tcArgs: tcClearArgs() }]);
    expect(cleared.state.jobs).toEqual([]);
    const again = planClear(cleared.state, jobId);
    expect(again.actions).toEqual([]);
  });
});

describe('sweepExpired', () => {
  it('clears only the leases past their TTL, leaving live ones', () => {
    let state = planApply(emptyWrapperState(), latency, RUN, 1_000, 30_000).state;
    state = planApply(state, { container: 'mn02', kind: 'loss', args: ['5%'] }, RUN, 1_000, 90_000).state;
    const swept = sweepExpired(state, 40_000);
    expect(swept.actions).toEqual([{ op: 'clear', container: 'mn01', tcArgs: tcClearArgs() }]);
    expect(swept.state.jobs.map((j) => j.container)).toEqual(['mn02']);
  });
});

describe('planBootRecovery', () => {
  it('undoes every container the persisted state touched, attributed per job', () => {
    let state = planApply(emptyWrapperState(), latency, RUN, 1_000, 30_000).state;
    state = planApply(state, { container: 'mn02', kind: 'loss', args: ['5%'] }, RUN, 1_000, 30_000).state;
    const boot = planBootRecovery(state);
    expect(boot.map((u) => u.action.container).sort()).toEqual(['mn01', 'mn02']);
    expect(boot.every((u) => u.action.op === 'clear')).toBe(true);
    // Attributed: the caller can persist exactly the jobs whose undo did not land.
    expect(boot.map((u) => u.job.jobId).sort()).toEqual(state.jobs.map((j) => j.jobId).sort());
  });

  it('undoes a service job with a start, not a tc delete, and does it first', () => {
    let state = planApply(emptyWrapperState(), latency, RUN, 1_000, 30_000).state;
    state = planServiceStop(state, 'mn01', RUN, 1_000, 30_000).state;
    const boot = planBootRecovery(state);
    // docker start recreates the netns and takes the qdisc with it, and tc cannot
    // run in a stopped container -- so the start must come first.
    expect(boot.map((u) => u.action.op)).toEqual(['start', 'clear']);
  });
});

describe('two fault classes on one container', () => {
  it('keys state by (container, class) so neither evicts the other', () => {
    const applied = planApply(emptyWrapperState(), latency, RUN, 1_000, 30_000).state;
    const stopped = planServiceStop(applied, 'mn01', RUN, 1_000, 30_000).state;
    expect(stopped.jobs).toHaveLength(2);
    expect(stopped.jobs.map((j) => faultClassOf(j)).sort()).toEqual(['netem', 'service']);
    // And applying netem again does not forget the service job.
    const reapplied = planApply(stopped, { container: 'mn01', kind: 'loss', args: ['5%'] }, RUN, 2_000, 30_000).state;
    expect(reapplied.jobs.filter((j) => faultClassOf(j) === 'service')).toHaveLength(1);
    expect(reapplied.jobs.filter((j) => faultClassOf(j) === 'netem')).toHaveLength(1);
  });

  it('sweeps an expired pair service-first', () => {
    let state = planApply(emptyWrapperState(), latency, RUN, 1_000, 30_000).state;
    state = planServiceStop(state, 'mn01', RUN, 1_000, 30_000).state;
    expect(planSweep(state, 40_000).map((u) => u.action.op)).toEqual(['start', 'clear']);
  });
});

describe('planServiceStop', () => {
  it('is idempotent for an identical live stop and re-applies an expired one', () => {
    const first = planServiceStop(emptyWrapperState(), 'mn01', RUN, 1_000, 30_000);
    expect(first.actions).toEqual([{ op: 'stop', container: 'mn01' }]);
    const again = planServiceStop(first.state, 'mn01', RUN, 2_000, 30_000);
    expect(again.actions).toEqual([]);
    expect(again.state).toBe(first.state); // same object, as planApply does
    const expired = planServiceStop(first.state, 'mn01', RUN, 40_000, 30_000);
    expect(expired.actions).toEqual([{ op: 'stop', container: 'mn01' }]);
  });

  it('mints a stable id that recovery can re-derive, disjoint from netem ids', () => {
    expect(serviceJobId(RUN, 'mn01')).toBe(serviceJobId(RUN, 'mn01'));
    expect(serviceJobId(RUN, 'mn01')).not.toBe(serviceJobId(RUN, 'mn02'));
    expect(serviceJobId(RUN, 'mn01').startsWith('service-')).toBe(true);
    expect(netemJobId(RUN, latency).startsWith('netem-')).toBe(true);
  });
});

describe('undoFor', () => {
  it('derives the undo from the job class', () => {
    const netemJob = planApply(emptyWrapperState(), latency, RUN, 1_000, 30_000).state.jobs[0]!;
    expect(undoFor(netemJob)).toEqual({ op: 'clear', container: 'mn01', tcArgs: tcClearArgs() });
    const serviceJob = planServiceStop(emptyWrapperState(), 'mn01', RUN, 1_000, 30_000).state.jobs[0]!;
    expect(undoFor(serviceJob)).toEqual({ op: 'start', container: 'mn01' });
  });

  it('reads a record written before the service class as netem', () => {
    const legacy = { jobId: 'netem-x', runTag: RUN, container: 'mn01', kind: 'netem' as const, args: [], appliedAtMs: 0, expiresAtMs: 1 };
    expect(faultClassOf(legacy)).toBe('netem');
    expect(undoFor(legacy).op).toBe('clear');
  });
});

describe('parseWrapperState', () => {
  it('defaults a missing class to netem and drops unusable entries', () => {
    const parsed = parseWrapperState({
      jobs: [
        { jobId: 'a', runTag: RUN, container: 'mn01', kind: 'netem', args: [], appliedAtMs: 0, expiresAtMs: 10 },
        { jobId: 'b', container: 'mn02', faultClass: 'service', kind: 'service-stop', expiresAtMs: 20 },
        { jobId: 'no-container', expiresAtMs: 30 },
        { container: 'no-id', expiresAtMs: 30 },
        null,
      ],
    });
    expect(parsed.jobs.map((j) => j.jobId)).toEqual(['a', 'b']);
    expect(parsed.jobs.map((j) => faultClassOf(j))).toEqual(['netem', 'service']);
  });

  it('refuses a state that is not a jobs array', () => {
    expect(() => parseWrapperState(null)).toThrow(/object/);
    expect(() => parseWrapperState({ jobs: 'nope' })).toThrow(/jobs array/);
  });
});
