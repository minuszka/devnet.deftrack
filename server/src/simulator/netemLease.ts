import { createHash } from 'node:crypto';

/**
 * The lab fault wrapper's state machine, as pure functions.
 *
 * A fault applied to a lab node must clear itself even if the orchestrator dies:
 * the wrapper holds a node-local lease with its own TTL, independent of the API
 * or Mongo, and a boot-time sweep undoes whatever a crashed predecessor left
 * behind. The planning here is pure and returns the actions to run; the
 * `tc`/`docker` call lives behind an injected executor, so the whole machine is
 * tested without Docker.
 *
 * Two fault classes share the machine:
 *
 * - `netem` — impairment on a container's own interface. One qdisc exists per
 *   interface (tc replaces, never stacks), so at most one netem job per container.
 * - `service` — the container itself stopped. Its undo is `docker start`, and a
 *   forgotten one is a dead node rather than a slow one, which is why boot
 *   recovery retains what it fails to undo instead of writing a clean slate.
 *
 * The state is therefore keyed by (container, faultClass), not by container: a
 * job of one class must never evict the record of the other, or a live fault
 * would be applied that nothing remembers. A job carries enough to name its own
 * undo (`undoFor`), so no undo site has to know which class it is looking at.
 */

// 'latency' | 'loss' | 'jitter' are the single-dimension primitives; 'netem' is a
// composed spec (delay and/or loss in one qdisc), which is what a real scenario
// applies -- one qdisc per interface means the dimensions cannot be separate jobs.
export type NetemKind = 'latency' | 'loss' | 'jitter' | 'netem';

const NETEM_IFACE = 'eth0';
const DURATION = /^\d+(us|ms|s)$/;
const PERCENT = /^\d+(\.\d+)?%$/;

export interface NetemSpec {
  container: string;
  kind: NetemKind;
  args: readonly string[];
}

/** What kind of fault a job holds, and therefore how it is undone. */
export type FaultClass = 'netem' | 'service';

export interface FaultJob {
  jobId: string;
  /** The run that owns this fault; the wrapper only ever clears its own. */
  runTag: string;
  container: string;
  /**
   * Absent on jobs written before the service class existed, which is exactly
   * what makes it the state file's version marker: an old record reads as netem,
   * which is what it was.
   */
  faultClass?: FaultClass;
  kind: NetemKind | 'service-stop';
  args: string[];
  appliedAtMs: number;
  /** Node-local lease expiry: the fault clears itself at this time, API or not. */
  expiresAtMs: number;
}

/** The pre-service name, kept so existing callers and tests read unchanged. */
export type NetemJob = FaultJob;

export function faultClassOf(job: FaultJob): FaultClass {
  return job.faultClass ?? 'netem';
}

export interface WrapperState {
  jobs: FaultJob[];
}

export type FaultAction =
  | { op: 'apply'; container: string; tcArgs: string[] }
  | { op: 'clear'; container: string; tcArgs: string[] }
  | { op: 'stop'; container: string }
  | { op: 'start'; container: string };

export interface Plan {
  state: WrapperState;
  actions: FaultAction[];
}

/**
 * The action that undoes a job, derived from the job rather than stored on it.
 * Nothing to validate on load and nothing to keep consistent across a state-file
 * version -- and every undo site (explicit clear, TTL sweep, boot recovery) gets
 * the right action for the class without asking.
 */
export function undoFor(job: FaultJob): FaultAction {
  return faultClassOf(job) === 'service'
    ? { op: 'start', container: job.container }
    : { op: 'clear', container: job.container, tcArgs: tcClearArgs() };
}

/**
 * Undo order within one sweep. `docker start` recreates the network namespace
 * and takes its qdisc with it, and tc cannot run inside a stopped container at
 * all -- so a service undo must precede a netem undo on the same container, and
 * the tc clear that follows is then a harmless no-op on a fresh namespace.
 */
const UNDO_RANK: Record<FaultClass, number> = { service: 0, netem: 1 };

function byUndoRank(a: FaultJob, b: FaultJob): number {
  return UNDO_RANK[faultClassOf(a)] - UNDO_RANK[faultClassOf(b)];
}

export function emptyWrapperState(): WrapperState {
  return { jobs: [] };
}

/**
 * Read a persisted state defensively. The file is written by this wrapper, but a
 * truncated or half-migrated record must not take the daemon down on boot -- the
 * boot is the moment the recovery guarantee is needed most. Unusable entries are
 * dropped; a wholly unusable file is refused so the caller can start clean.
 */
export function parseWrapperState(raw: unknown): WrapperState {
  if (raw === null || typeof raw !== 'object') throw new Error('wrapper state must be an object');
  const jobs = (raw as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) throw new Error('wrapper state needs a jobs array');
  const parsed: FaultJob[] = [];
  for (const entry of jobs) {
    if (entry === null || typeof entry !== 'object') continue;
    const job = entry as Partial<FaultJob>;
    if (typeof job.jobId !== 'string' || typeof job.container !== 'string') continue;
    if (!Number.isFinite(job.expiresAtMs)) continue;
    parsed.push({
      jobId: job.jobId,
      runTag: typeof job.runTag === 'string' ? job.runTag : '',
      container: job.container,
      faultClass: job.faultClass === 'service' ? 'service' : 'netem',
      kind: job.kind ?? 'netem',
      args: Array.isArray(job.args) ? job.args.filter((a): a is string => typeof a === 'string') : [],
      appliedAtMs: Number.isFinite(job.appliedAtMs) ? (job.appliedAtMs as number) : 0,
      expiresAtMs: job.expiresAtMs as number,
    });
  }
  return { jobs: parsed };
}

/** Deterministic idempotency key: the same fault, whoever asks, is one job. */
export function netemJobId(runTag: string, spec: NetemSpec): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([runTag, spec.container, spec.kind, [...spec.args]]))
    .digest('hex');
  return `netem-${digest.slice(0, 16)}`;
}

/**
 * The same key for a service outage. Derivable from the run tag and the container
 * alone, so recovery re-derives exactly the id the apply minted -- and its prefix
 * keeps the two id spaces disjoint.
 */
export function serviceJobId(runTag: string, container: string): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([runTag, container, 'service-stop']))
    .digest('hex');
  return `service-${digest.slice(0, 16)}`;
}

/**
 * Validate a composed netem argument vector: an optional `delay <dur> [<jitter>]`
 * then an optional `loss <pct> [<correlation>]`, at least one clause, and nothing
 * else. Rejects any token tc would not take here, so a composed spec can never
 * carry an arbitrary tc argument.
 */
function assertComposedNetemArgs(args: readonly string[]): void {
  let i = 0;
  let clauses = 0;
  if (args[i] === 'delay') {
    if (!DURATION.test(args[i + 1] ?? '')) throw new Error('netem delay needs a duration, e.g. delay 100ms');
    i += 2;
    if (args[i] !== undefined && DURATION.test(args[i]!)) i += 1; // optional jitter
    clauses += 1;
  }
  if (args[i] === 'loss') {
    if (!PERCENT.test(args[i + 1] ?? '')) throw new Error('netem loss needs a percentage, e.g. loss 5%');
    i += 2;
    if (args[i] !== undefined && PERCENT.test(args[i]!)) i += 1; // optional correlation
    clauses += 1;
  }
  if (clauses === 0 || i !== args.length) {
    throw new Error('netem args must be [delay <dur> [<jitter>]] [loss <pct> [<correlation>]]');
  }
}

/** Validate the netem arguments for a kind; throws on anything tc would reject. */
function assertNetemArgs(kind: NetemKind, args: readonly string[]): void {
  if (kind === 'latency') {
    if (args.length !== 1 || !DURATION.test(args[0]!)) throw new Error('latency needs one duration, e.g. 100ms');
  } else if (kind === 'jitter') {
    if (args.length !== 2 || !DURATION.test(args[0]!) || !DURATION.test(args[1]!)) {
      throw new Error('jitter needs a duration and a jitter, e.g. 100ms 20ms');
    }
  } else if (kind === 'netem') {
    assertComposedNetemArgs(args);
  } else {
    if (args.length !== 1 || !PERCENT.test(args[0]!)) throw new Error('loss needs one percentage, e.g. 5%');
  }
}

/** The tc arguments that apply a fault (replace, so re-apply is safe). Pure. */
export function tcApplyArgs(spec: NetemSpec): string[] {
  assertNetemArgs(spec.kind, spec.args);
  const base = ['qdisc', 'replace', 'dev', NETEM_IFACE, 'root', 'netem'];
  if (spec.kind === 'netem') return [...base, ...spec.args]; // already composed, e.g. delay 100ms loss 5%
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
  // Class-scoped: replacing the netem job on a container must not silently drop
  // a service job recorded against it, or a live fault would be applied that
  // nothing remembers -- the one way the superset invariant breaks across classes.
  const isSameSlot = (job: FaultJob): boolean =>
    job.container === spec.container && faultClassOf(job) === 'netem';
  const existing = state.jobs.find(isSameSlot);
  if (existing !== undefined && existing.jobId === jobId && existing.expiresAtMs > nowMs) {
    return { state, actions: [] };
  }
  const tcArgs = tcApplyArgs(spec); // validates before any state change
  const job: FaultJob = {
    jobId,
    runTag,
    container: spec.container,
    faultClass: 'netem',
    kind: spec.kind,
    args: [...spec.args],
    appliedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  };
  const others = state.jobs.filter((candidate) => !isSameSlot(candidate));
  return {
    state: { jobs: [...others, job] },
    actions: [{ op: 'apply', container: spec.container, tcArgs }],
  };
}

/**
 * Stop a container under a lease. Mirrors planApply exactly, including returning
 * the same state object by reference when an identical stop is already live, so
 * the two classes obey one rule. The lease is the whole guarantee here: a stopped
 * container comes back on the sweep whether or not anything else survives.
 */
export function planServiceStop(
  state: WrapperState,
  container: string,
  runTag: string,
  nowMs: number,
  ttlMs: number
): Plan {
  const jobId = serviceJobId(runTag, container);
  const isSameSlot = (job: FaultJob): boolean =>
    job.container === container && faultClassOf(job) === 'service';
  const existing = state.jobs.find(isSameSlot);
  if (existing !== undefined && existing.jobId === jobId && existing.expiresAtMs > nowMs) {
    return { state, actions: [] };
  }
  const job: FaultJob = {
    jobId,
    runTag,
    container,
    faultClass: 'service',
    kind: 'service-stop',
    args: [],
    appliedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  };
  const others = state.jobs.filter((candidate) => !isSameSlot(candidate));
  return { state: { jobs: [...others, job] }, actions: [{ op: 'stop', container }] };
}

/** Clear one job by id. Idempotent: clearing an unknown job does nothing. */
export function planClear(state: WrapperState, jobId: string): Plan {
  const job = state.jobs.find((candidate) => candidate.jobId === jobId);
  if (job === undefined) return { state, actions: [] };
  return {
    state: { jobs: state.jobs.filter((candidate) => candidate.jobId !== jobId) },
    actions: [undoFor(job)],
  };
}

/** One expired job and the action that undoes it, so a sweep can drop only what it undid. */
export interface JobUndo {
  job: FaultJob;
  action: FaultAction;
}

/**
 * The node-local TTL sweep: undo every job whose lease has expired, service
 * first. The caller decides what to retain, so a single failing undo cannot take
 * the rest of the sweep -- or another container's node -- down with it.
 */
export function planSweep(state: WrapperState, nowMs: number): JobUndo[] {
  return state.jobs
    .filter((job) => job.expiresAtMs <= nowMs)
    .sort(byUndoRank)
    .map((job) => ({ job, action: undoFor(job) }));
}

/** The pre-service shape, retained for callers that want the plan form. */
export function sweepExpired(state: WrapperState, nowMs: number): Plan {
  const undos = planSweep(state, nowMs);
  if (undos.length === 0) return { state, actions: [] };
  return {
    state: { jobs: state.jobs.filter((job) => job.expiresAtMs > nowMs) },
    actions: undos.map((undo) => undo.action),
  };
}

/**
 * Boot-time recovery: undo everything the persisted state claims is applied and
 * return to a known baseline. After a crash the real state is unknown, so the
 * safe move is to undo each job the wrapper had recorded, whatever the lease
 * said -- service first, since a `docker start` must precede any tc on that
 * container.
 *
 * Attributed, one entry per job rather than one per container, so the caller can
 * persist exactly the jobs whose undo did NOT land. A forgotten qdisc is a slow
 * node; a forgotten stop is a node that never comes back.
 */
export function planBootRecovery(state: WrapperState): JobUndo[] {
  return [...state.jobs].sort(byUndoRank).map((job) => ({ job, action: undoFor(job) }));
}
