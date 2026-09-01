import { createHash } from 'node:crypto';

/**
 * The netem fault wrapper's state machine, as pure functions.
 *
 * A fault applied to a lab node must clear itself even if the orchestrator dies:
 * the wrapper holds a node-local lease with its own TTL, independent of the API
 * or Mongo, and a boot-time sweep clears whatever a crashed predecessor left
 * behind. The planning here is pure and returns the tc actions to run; the
 * `tc`/`docker exec` call lives behind an injected executor, so the whole
 * machine is tested without Docker.
 *
 * One netem qdisc exists per container interface (tc replaces, never stacks), so
 * the wrapper holds at most one fault per container. Applying the same fault
 * again is a no-op; applying a different one replaces it.
 */

export type NetemKind = 'latency' | 'loss' | 'jitter';

const NETEM_IFACE = 'eth0';
const DURATION = /^\d+(us|ms|s)$/;
const PERCENT = /^\d+(\.\d+)?%$/;

export interface NetemSpec {
  container: string;
  kind: NetemKind;
  args: readonly string[];
}

export interface NetemJob {
  jobId: string;
  /** The run that owns this fault; the wrapper only ever clears its own. */
  runTag: string;
  container: string;
  kind: NetemKind;
  args: string[];
  appliedAtMs: number;
  /** Node-local lease expiry: the fault clears itself at this time, API or not. */
  expiresAtMs: number;
}

export interface WrapperState {
  jobs: NetemJob[];
}

export type FaultAction =
  | { op: 'apply'; container: string; tcArgs: string[] }
  | { op: 'clear'; container: string; tcArgs: string[] };

export interface Plan {
  state: WrapperState;
  actions: FaultAction[];
}

export function emptyWrapperState(): WrapperState {
  return { jobs: [] };
}

/** Deterministic idempotency key: the same fault, whoever asks, is one job. */
export function netemJobId(runTag: string, spec: NetemSpec): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([runTag, spec.container, spec.kind, [...spec.args]]))
    .digest('hex');
  return `netem-${digest.slice(0, 16)}`;
}

/** Validate the netem arguments for a kind; throws on anything tc would reject. */
function assertNetemArgs(kind: NetemKind, args: readonly string[]): void {
  if (kind === 'latency') {
    if (args.length !== 1 || !DURATION.test(args[0]!)) throw new Error('latency needs one duration, e.g. 100ms');
  } else if (kind === 'jitter') {
    if (args.length !== 2 || !DURATION.test(args[0]!) || !DURATION.test(args[1]!)) {
      throw new Error('jitter needs a duration and a jitter, e.g. 100ms 20ms');
    }
  } else {
    if (args.length !== 1 || !PERCENT.test(args[0]!)) throw new Error('loss needs one percentage, e.g. 5%');
  }
}

/** The tc arguments that apply a fault (replace, so re-apply is safe). Pure. */
export function tcApplyArgs(spec: NetemSpec): string[] {
  assertNetemArgs(spec.kind, spec.args);
  const base = ['qdisc', 'replace', 'dev', NETEM_IFACE, 'root', 'netem'];
  if (spec.kind === 'loss') return [...base, 'loss', spec.args[0]!];
  return [...base, 'delay', ...spec.args];
}

/** The tc arguments that clear all netem on a container. Pure. */
export function tcClearArgs(): string[] {
  return ['qdisc', 'del', 'dev', NETEM_IFACE, 'root'];
}

/**
 * Apply a fault under a lease. Idempotent: re-applying the identical fault while
 * its lease is live changes nothing. A different fault on the same container
 * replaces the old one -- one qdisc per interface.
 */
export function planApply(
  state: WrapperState,
  spec: NetemSpec,
  runTag: string,
  nowMs: number,
  ttlMs: number
): Plan {
  const jobId = netemJobId(runTag, spec);
  const existing = state.jobs.find((job) => job.container === spec.container);
  if (existing !== undefined && existing.jobId === jobId && existing.expiresAtMs > nowMs) {
    return { state, actions: [] };
  }
  const tcArgs = tcApplyArgs(spec); // validates before any state change
  const job: NetemJob = {
    jobId,
    runTag,
    container: spec.container,
    kind: spec.kind,
    args: [...spec.args],
    appliedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  };
  const others = state.jobs.filter((candidate) => candidate.container !== spec.container);
  return {
    state: { jobs: [...others, job] },
    actions: [{ op: 'apply', container: spec.container, tcArgs }],
  };
}

/** Clear one job by id. Idempotent: clearing an unknown job does nothing. */
export function planClear(state: WrapperState, jobId: string): Plan {
  const job = state.jobs.find((candidate) => candidate.jobId === jobId);
  if (job === undefined) return { state, actions: [] };
  return {
    state: { jobs: state.jobs.filter((candidate) => candidate.jobId !== jobId) },
    actions: [{ op: 'clear', container: job.container, tcArgs: tcClearArgs() }],
  };
}

/** The node-local TTL sweep: clear every job whose lease has expired. */
export function sweepExpired(state: WrapperState, nowMs: number): Plan {
  const expired = state.jobs.filter((job) => job.expiresAtMs <= nowMs);
  if (expired.length === 0) return { state, actions: [] };
  return {
    state: { jobs: state.jobs.filter((job) => job.expiresAtMs > nowMs) },
    actions: expired.map((job) => ({ op: 'clear', container: job.container, tcArgs: tcClearArgs() })),
  };
}

/**
 * Boot-time cleanup: clear everything the persisted state claims is applied and
 * start from a known-clean baseline. After a crash the real qdisc state is
 * unknown, so the safe move is to clear each container the wrapper had touched,
 * whatever the lease said.
 */
export function planBootCleanup(state: WrapperState): Plan {
  const containers = [...new Set(state.jobs.map((job) => job.container))];
  return {
    state: emptyWrapperState(),
    actions: containers.map((container) => ({ op: 'clear', container, tcArgs: tcClearArgs() })),
  };
}
