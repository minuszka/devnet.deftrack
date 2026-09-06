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
export type NetemKind = 'latency' | 'loss' | 'jitter' | 'netem' | 'partition';

const NETEM_IFACE = 'eth0';
const DURATION = /^\d+(us|ms|s)$/;
const PERCENT = /^\d+(\.\d+)?%$/;

export interface NetemSpec {
  container: string;
  kind: NetemKind;
  args: readonly string[];
}

/**
 * What kind of fault a job holds, and therefore how it is undone.
 *
 * `dsl` is a fault the node holds against itself: `faultinject set` over the
 * container's own cookie, retired by the node at an expiry height and, as the
 * second clock, by this wrapper's lease through `faultinject clear <id>`.
 * Nothing outside the daemon changes -- no qdisc, no container state -- so a
 * stopped container has no dsl fault to clear and its undo is benign.
 */
export type FaultClass = 'netem' | 'service' | 'dsl';

/** The DSL fault kinds the node's injector accepts, spelled as the RPC spells them. */
export const DSL_FAULT_KIND_NAMES = ['response-drop', 'report-drop', 'response-delay', 'report-delay', 'commitment-skip'] as const;
export type DslFaultKindName = (typeof DSL_FAULT_KIND_NAMES)[number];

export interface DslFaultSpec {
  container: string;
  faultKind: DslFaultKindName;
  /** Whole epochs the fault covers, counted from the next epoch boundary. */
  epochs: number;
  /** Delay in blocks for the *-delay kinds, 0 otherwise. */
  param: number;
  /** Recorded on the node's fault; the run key, so the node's telemetry names the experiment. */
  scenarioId: string;
}

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
  kind: NetemKind | 'service-stop' | 'dsl';
  /** For a dsl job: [faultKind, epochs, param, faultId] -- the id once the node has answered, '' before. */
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
  | { op: 'start'; container: string }
  | { op: 'dsl-set'; container: string; faultKind: DslFaultKindName; epochs: number; param: number; scenarioId: string }
  | { op: 'dsl-clear'; container: string; faultId: string };

/** What an executed action reports back; only `dsl-set` has anything to say. */
export interface FaultActionResult {
  faultId?: string;
  expiryHeight?: number;
}

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
  const faultClass = faultClassOf(job);
  if (faultClass === 'service') return { op: 'start', container: job.container };
  if (faultClass === 'dsl') return { op: 'dsl-clear', container: job.container, faultId: job.args[3] ?? '' };
  return { op: 'clear', container: job.container, tcArgs: tcClearArgs() };
}

/**
 * Undo order within one sweep. `docker start` recreates the network namespace
 * and takes its qdisc with it, and tc cannot run inside a stopped container at
 * all -- so a service undo must precede a netem undo on the same container, and
 * the tc clear that follows is then a harmless no-op on a fresh namespace.
 */
// A dsl fault lives inside the daemon and is cleared first, while the daemon
// that was armed is still the one running: a service undo recreates the
// container and would have lost the fault -- and the qdisc -- with the process.
const UNDO_RANK: Record<FaultClass, number> = { dsl: 0, service: 1, netem: 2 };

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
      faultClass: job.faultClass === 'service' ? 'service' : job.faultClass === 'dsl' ? 'dsl' : 'netem',
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

/** One dsl fault of a kind per (run, container): a second of the same kind is the same job. */
export function dslJobId(runTag: string, container: string, faultKind: DslFaultKindName): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([runTag, container, 'dsl', faultKind]))
    .digest('hex');
  return `dsl-${digest.slice(0, 16)}`;
}

export function assertDslFaultSpec(spec: DslFaultSpec): void {
  if (!(DSL_FAULT_KIND_NAMES as readonly string[]).includes(spec.faultKind)) {
    throw new Error(`unknown DSL fault kind "${spec.faultKind}"`);
  }
  if (!Number.isInteger(spec.epochs) || spec.epochs < 1 || spec.epochs > 3) {
    throw new Error('a DSL fault covers 1..3 epochs');
  }
  if (!Number.isInteger(spec.param) || spec.param < 0 || spec.param > 1_000) {
    throw new Error('DSL fault param must be a non-negative block count');
  }
  const isDelay = spec.faultKind === 'response-delay' || spec.faultKind === 'report-delay';
  if (isDelay && spec.param === 0) throw new Error(`${spec.faultKind} needs a non-zero delay`);
  if (!isDelay && spec.param !== 0) throw new Error(`${spec.faultKind} takes no param`);
  if (spec.scenarioId.trim().length === 0) throw new Error('a DSL fault must name its scenario');
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

/**
 * The one place a fault's arguments are judged, for both callers.
 *
 * The wrapper validated them and the executor did not, so a plan the wrapper
 * was always going to refuse still went through arming and activation: the
 * command was written, the wrapper threw, the queue retried it five times and
 * quarantined it -- while the run sat in `fault_active` believing a fault was
 * on. Recovery then cleared nothing, the probes read clean, and the measurement
 * described a fault that never existed.
 *
 * Both sides call this now, so a refusal happens where it can still stop the
 * run rather than after it has started.
 */
export function assertFaultArgs(kind: NetemKind, args: readonly string[]): void {
  if (kind === 'partition') {
    assertPartitionPeers(args);
    return;
  }
  assertNetemArgs(kind, args);
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

/**
 * The tc invocations that cut a node off from named peers, in order.
 *
 * Not iptables and not nft: the lab image carries neither, only `tc` and `ip`.
 * So the partition is built from what a qdisc can do -- a `prio` root, a child
 * band whose netem drops everything, and one `u32` filter per peer steering that
 * peer's traffic into it. Verified by hand on a lab container before this
 * existed: `bytesrecv` froze and `pingwait` began to climb.
 *
 * Egress-only by construction, and that is enough. The node cannot ACK, so the
 * peer's window fills and its traffic stops too -- the link goes quiet in both
 * directions without needing a rule on the other side, which is also what makes
 * this undoable from one container alone.
 *
 * Each peer gets its own filter priority. At one shared priority the second
 * would be ambiguous with the first, and `add` after the root `replace` is safe
 * because replacing the root qdisc destroys the filter list with it.
 *
 * The dropping band must be unreachable except through those filters, which is
 * what the explicit all-zero priomap buys. A plain `prio` root uses the DEFAULT
 * priomap, which routes "bulk" TOS traffic into band 3 on its own -- so a netem
 * hung there drops packets to peers the partition never named, and the measured
 * partition is silently wider than the declared one. The same construction on
 * the fleet wrapper took the operator's own SSH down with it.
 */
export function tcPartitionArgs(spec: NetemSpec): string[][] {
  assertPartitionPeers(spec.args);
  return [
    [
      'qdisc', 'replace', 'dev', NETEM_IFACE, 'root', 'handle', '1:',
      'prio', 'bands', '4', 'priomap', ...Array<string>(16).fill('0'),
    ],
    ['qdisc', 'replace', 'dev', NETEM_IFACE, 'parent', '1:4', 'handle', '40:', 'netem', 'loss', '100%'],
    ...spec.args.map((peer, index) => [
      'filter', 'add', 'dev', NETEM_IFACE, 'protocol', 'ip', 'parent', '1:',
      'prio', String(index + 1), 'u32', 'match', 'ip', 'dst', `${peer}/32`, 'flowid', '1:4',
    ]),
  ];
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * Peers are plain IPv4 addresses and nothing else.
 *
 * They become part of a tc argument vector, so anything else is either rejected
 * by tc -- leaving a half-built partition with a live root qdisc and no filters,
 * which cuts nothing while looking applied -- or, worse, accepted as something
 * other than an address.
 */
function assertPartitionPeers(peers: readonly string[]): void {
  if (peers.length === 0) throw new Error('a partition must name at least one peer');
  if (peers.length > 32) throw new Error('a partition may name at most 32 peers');
  if (new Set(peers).size !== peers.length) throw new Error('partition peers must be unique');
  for (const peer of peers) {
    if (!IPV4.test(peer)) throw new Error(`partition peer must be an IPv4 address, got "${peer}"`);
  }
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
  expiresAtMs: number
): Plan {
  const jobId = netemJobId(runTag, spec);
  // An expiry already in the past is refused rather than applied for a moment.
  // The lease is the recovery bound, so a fault whose bound has gone must not
  // start; the old relative TTL plus a floor could still activate one.
  //
  // It throws rather than returning no actions. Returning none made a refusal
  // indistinguishable from the idempotent case below, and the runner answered
  // both with a jobId -- so a caller could not tell "already in this state"
  // from "declined to act", and the wrapper acked a fault it never applied.
  // An empty action list now means one thing only: nothing needed doing.
  if (expiresAtMs <= nowMs) {
    throw new Error(`lease for ${jobId} expired at ${expiresAtMs}, before it could be applied`);
  }
  // Class-scoped: replacing the netem job on a container must not silently drop
  // a service job recorded against it, or a live fault would be applied that
  // nothing remembers -- the one way the superset invariant breaks across classes.
  const isSameSlot = (job: FaultJob): boolean =>
    job.container === spec.container && faultClassOf(job) === 'netem';
  const existing = state.jobs.find(isSameSlot);
  if (existing !== undefined && existing.jobId === jobId && existing.expiresAtMs > nowMs) {
    return { state, actions: [] };
  }
  // Validated before any state change. A partition is several invocations where
  // a netem is one -- the root qdisc, the band that drops, and a filter per
  // peer -- so the plan carries a list either way.
  const tcArgvs = spec.kind === 'partition' ? tcPartitionArgs(spec) : [tcApplyArgs(spec)];
  const job: FaultJob = {
    jobId,
    runTag,
    container: spec.container,
    faultClass: 'netem',
    kind: spec.kind,
    args: [...spec.args],
    appliedAtMs: nowMs,
    expiresAtMs,
  };
  const others = state.jobs.filter((candidate) => !isSameSlot(candidate));
  return {
    state: { jobs: [...others, job] },
    // One action per invocation, run in order. A partition needs its root qdisc
    // and its dropping band in place before any filter can point at them.
    actions: tcArgvs.map((tcArgs) => ({ op: 'apply' as const, container: spec.container, tcArgs })),
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
  expiresAtMs: number
): Plan {
  const jobId = serviceJobId(runTag, container);
  // Same rule, same reason as planApply: a spent lease is refused loudly, not
  // by quietly doing nothing that a caller then reports as done.
  if (expiresAtMs <= nowMs) {
    throw new Error(`lease for ${jobId} expired at ${expiresAtMs}, before it could be applied`);
  }
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
    expiresAtMs,
  };
  const others = state.jobs.filter((candidate) => !isSameSlot(candidate));
  return { state: { jobs: [...others, job] }, actions: [{ op: 'stop', container }] };
}

/** Clear one job by id. Idempotent: clearing an unknown job does nothing. */
/**
 * Arm a DSL fault: one job per (run, container, kind). The node answers with
 * the fault id only once the action has run, so the job is written first with
 * an empty id (it still clears on TTL: an empty id clears nothing, and the
 * node's own height expiry is the other clock) and completed by
 * `withDslFaultId` afterwards.
 */
export function planDslSet(
  state: WrapperState,
  spec: DslFaultSpec,
  runTag: string,
  nowMs: number,
  expiresAtMs: number
): Plan {
  assertDslFaultSpec(spec);
  const jobId = dslJobId(runTag, spec.container, spec.faultKind);
  if (expiresAtMs <= nowMs) {
    throw new Error(`lease for ${jobId} expired at ${expiresAtMs}, before it could be applied`);
  }
  const existing = state.jobs.find((job) => job.jobId === jobId);
  // Idempotent only once the node has answered. The job is written before the
  // arm runs, so a first attempt the node refused leaves a live job with no
  // id; a retry must arm again, not read that job as "already applied" -- which
  // is exactly what happened on the lab when the cli refused a string argument.
  if (existing !== undefined && existing.expiresAtMs > nowMs && (existing.args[3] ?? '') !== '') {
    return { state, actions: [] };
  }
  const job: FaultJob = {
    jobId,
    runTag,
    container: spec.container,
    faultClass: 'dsl',
    kind: 'dsl',
    args: [spec.faultKind, String(spec.epochs), String(spec.param), ''],
    appliedAtMs: nowMs,
    expiresAtMs,
  };
  const others = state.jobs.filter((candidate) => candidate.jobId !== jobId);
  return {
    state: { jobs: [...others, job] },
    actions: [{
      op: 'dsl-set',
      container: spec.container,
      faultKind: spec.faultKind,
      epochs: spec.epochs,
      param: spec.param,
      scenarioId: spec.scenarioId,
    }],
  };
}

/** Record the node's fault id on the dsl job it belongs to, so the undo can name it. */
export function withDslFaultId(state: WrapperState, jobId: string, faultId: string): WrapperState {
  return {
    jobs: state.jobs.map((job) =>
      job.jobId === jobId && faultClassOf(job) === 'dsl'
        ? { ...job, args: [job.args[0] ?? '', job.args[1] ?? '', job.args[2] ?? '', faultId] }
        : job
    ),
  };
}

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
