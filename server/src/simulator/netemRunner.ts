import {
  faultClassOf,
  netemJobId,
  planApply,
  planBootRecovery,
  planClear,
  planServiceStop,
  planSweep,
  serviceJobId,
  type FaultAction,
  type FaultJob,
  type JobUndo,
  type NetemKind,
  type NetemSpec,
  type WrapperState,
} from './netemLease.js';

// A record keyed by the union, so the union and the accepted list cannot drift:
// adding a kind without adding it here is a type error.
const NETEM_KIND_SET: Record<NetemKind, true> = { latency: true, loss: true, jitter: true, netem: true, partition: true };
const NETEM_KINDS = Object.keys(NETEM_KIND_SET) as NetemKind[];

/**
 * The upper bound on a node-local lease. The lease IS the recovery guarantee, so
 * an unbounded one defeats it -- most of all for a stopped container, which
 * without a bound would simply stay down. Refused rather than clamped: a clamp
 * would silently diverge the host's real lease from the lease the run recorded.
 */
export const MAX_TTL_MS = 3_600_000;

/**
 * The lease arrives as an ABSOLUTE instant, not a duration.
 *
 * A duration was measured from the moment the wrapper got round to the command,
 * not from the moment the orchestrator recorded the fault -- so time spent
 * waiting in the queue, or behind a `docker stop -t 30` on the node before it,
 * pushed the real expiry past the faultLeaseExpiresAtMs written to the run. With
 * several targets the last one drifted furthest.
 *
 * The ceiling still applies, now as a bound on how far ahead the instant may be.
 */
function assertLeaseInstant(value: unknown, nowMs: number): asserts value is number {
  if (!Number.isSafeInteger(value)) throw new Error('command needs an expiresAtMs instant');
  const remaining = (value as number) - nowMs;
  if (remaining > MAX_TTL_MS) {
    throw new Error(`expiresAtMs is more than ${MAX_TTL_MS} ms ahead, beyond the lease ceiling`);
  }
}

/**
 * Runs one fault action against a container. The real implementation shells out
 * to `docker exec <container> tc <args>` or `docker stop|start <container>`; a
 * test injects a recorder.
 */
export type FaultExecutor = (action: FaultAction) => Promise<void>;

/**
 * Persists the wrapper's belief about what is applied. The real implementation
 * is a JSON file on the lab host; a test injects an in-memory store.
 */
export interface WrapperStore {
  load(): Promise<WrapperState>;
  save(state: WrapperState): Promise<void>;
}

export interface RunnerLogger {
  info(message: string): void;
  error(message: string): void;
}

const SILENT: RunnerLogger = { info: () => {}, error: () => {} };
const WATCHDOG_INTERVAL_MS = 5_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The node-local fault wrapper.
 *
 * It runs on the lab host, beside the containers, and NOT inside the
 * orchestrator. That is the whole point: its watchdog expires a fault's lease
 * and undoes it on its own timer, so the lab recovers even after the
 * orchestrator is killed and nothing is left to read Mongo. The orchestrator's
 * own reconcile only makes the record catch up afterwards; it never restores the
 * network.
 *
 * The invariant that makes boot recovery safe: the stored state is always a
 * superset of what is actually applied. So an apply records the job before it
 * acts, and an undo acts before it drops the job. A crash in either gap leaves a
 * job recorded whose effect may already be gone -- and both undos are idempotent
 * (clearing an absent qdisc, starting a running container) -- never an effect
 * applied that nothing remembers.
 */
export class LabFaultRunner {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  /**
   * Every state-mutating operation runs in this chain, one at a time.
   *
   * Without it the class loses faults silently. apply/stopService save BEFORE
   * acting and clear/tick save AFTER, so a clear that loaded the state before a
   * concurrent stopService saved, and saves after it, drops the new job while its
   * `docker stop` has already landed -- a stopped container no record covers, which
   * neither the TTL watchdog nor boot recovery can ever bring back, because both
   * read that same record. `ticking` guarded tick-vs-tick only; the dangerous
   * pairs are tick-vs-stopService and clear-vs-stopService.
   *
   * A `docker stop -t 30` can hold the lock for the full SIGTERM grace, which is
   * exactly the window that made the race reachable at a 5-second cycle.
   */
  private chain: Promise<unknown> = Promise.resolve();
  private readonly clock: () => number;
  private readonly logger: RunnerLogger;
  private readonly intervalMs: number;

  constructor(
    private readonly execute: FaultExecutor,
    private readonly store: WrapperStore,
    options: { intervalMs?: number; clock?: () => number; logger?: RunnerLogger } = {}
  ) {
    this.clock = options.clock ?? Date.now;
    this.logger = options.logger ?? SILENT;
    this.intervalMs = options.intervalMs ?? WATCHDOG_INTERVAL_MS;
  }

  /** Run `operation` after every operation already queued on this runner. */
  private serialise<T>(operation: () => Promise<T>): Promise<T> {
    // Chain off the previous outcome whatever it was: one failed operation must
    // not wedge the queue, and the watchdog above all must keep running.
    const result = this.chain.then(operation, operation);
    this.chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /** Apply a netem fault under a lease. Records intent, then runs tc. Idempotent. */
  async apply(spec: NetemSpec, runTag: string, expiresAtMs: number): Promise<{ jobId: string }> {
    return this.serialise(() => this.applyLocked(spec, runTag, expiresAtMs));
  }

  private async applyLocked(spec: NetemSpec, runTag: string, expiresAtMs: number): Promise<{ jobId: string }> {
    const jobId = netemJobId(runTag, spec);
    const plan = planApply(await this.store.load(), spec, runTag, this.clock(), expiresAtMs);
    if (plan.actions.length === 0) return { jobId };
    // Record before acting, so an effect that reaches the node is always known and
    // therefore always undoable.
    await this.store.save(plan.state);
    await this.runActions(plan.actions);
    return { jobId };
  }

  /**
   * Stop a container under a lease. Same ordering as apply, for the same reason:
   * a stop that lands without a record is a node nothing will ever start again.
   */
  async stopService(container: string, runTag: string, expiresAtMs: number): Promise<{ jobId: string }> {
    return this.serialise(() => this.stopServiceLocked(container, runTag, expiresAtMs));
  }

  private async stopServiceLocked(container: string, runTag: string, expiresAtMs: number): Promise<{ jobId: string }> {
    const jobId = serviceJobId(runTag, container);
    const plan = planServiceStop(await this.store.load(), container, runTag, this.clock(), expiresAtMs);
    if (plan.actions.length === 0) return { jobId };
    await this.store.save(plan.state);
    await this.runActions(plan.actions);
    return { jobId };
  }

  /** Undo one fault. Acts, then drops the job. Idempotent. */
  async clear(jobId: string): Promise<void> {
    return this.serialise(() => this.clearLocked(jobId));
  }

  private async clearLocked(jobId: string): Promise<void> {
    const plan = planClear(await this.store.load(), jobId);
    if (plan.actions.length === 0) return;
    await this.runActions(plan.actions);
    // Re-read rather than saving the pre-undo snapshot: drop only our own job from
    // whatever the record says now, so nothing recorded meanwhile is erased.
    const fresh = await this.store.load();
    await this.store.save({ jobs: fresh.jobs.filter((job) => job.jobId !== jobId) });
  }

  /**
   * The watchdog: undo every lease past its TTL. This is the recovery the
   * acceptance gate turns on -- it depends on nothing outside this process.
   *
   * Best-effort per job: one container's failing undo must not stop another's,
   * or a single unreachable node would hold a whole restart storm down. A job is
   * dropped from the record only when its own undo actually landed; a retained
   * job is already expired, so the next tick retries it, forever if need be.
   */
  async tick(): Promise<{ cleared: number; failed: number }> {
    if (this.ticking) return { cleared: 0, failed: 0 };
    this.ticking = true;
    try {
      return await this.serialise(() => this.tickLocked());
    } catch (error) {
      this.logger.error(`lab fault watchdog tick failed: ${describe(error)}`);
      return { cleared: 0, failed: 0 };
    } finally {
      this.ticking = false;
    }
  }

  private async tickLocked(): Promise<{ cleared: number; failed: number }> {
    const state = await this.store.load();
    const undos = planSweep(state, this.clock());
    if (undos.length === 0) return { cleared: 0, failed: 0 };
    const { succeeded, failed } = await this.runUndos(undos);
    // Re-read for the same reason clear() does: the pre-undo snapshot is stale by
    // the length of a docker call, and saving it would erase a live lease.
    const fresh = await this.store.load();
    await this.store.save({ jobs: fresh.jobs.filter((job) => !succeeded.has(job.jobId)) });
    return { cleared: succeeded.size, failed };
  }

  /**
   * Undo everything the stored state claims is applied and start from a known
   * baseline. After a crash the real state is unknown, so undoing each recorded
   * job is the only safe move; undoing an already-undone one is harmless.
   *
   * Never rejects. Boot is exactly when the recovery guarantee is needed, and an
   * unreadable record or one failing `docker start` must not be able to take the
   * daemon -- and with it the watchdog -- down. A job whose undo failed is
   * retained with an already-past expiry, so the next tick picks it up rather
   * than the record forgetting a container that is still stopped.
   */
  async bootCleanup(): Promise<{ cleared: number; failed: number }> {
    return this.serialise(() => this.bootCleanupLocked());
  }

  private async bootCleanupLocked(): Promise<{ cleared: number; failed: number }> {
    let state: WrapperState = { jobs: [] };
    try {
      state = await this.store.load();
    } catch (error) {
      this.logger.error(`unreadable wrapper state at boot, starting clean: ${describe(error)}`);
    }
    const retained: FaultJob[] = [];
    let cleared = 0;
    for (const undo of planBootRecovery(state)) {
      try {
        await this.execute(undo.action);
        cleared++;
      } catch (error) {
        this.logger.error(`boot recovery failed for ${undo.job.container}, retained: ${describe(error)}`);
        retained.push({ ...undo.job, expiresAtMs: 0 });
      }
    }
    try {
      await this.store.save({ jobs: retained });
    } catch (error) {
      this.logger.error(`could not persist boot recovery state: ${describe(error)}`);
    }
    return { cleared, failed: retained.length };
  }

  /**
   * Arm the watchdog FIRST, then recover. A boot cleanup that throws must never
   * leave the timer unset -- that is the guarantee failing in exactly the case it
   * exists for. Anything boot recovery could not undo is retained as expired, so
   * the first tick retries it seconds later.
   */
  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.logger.info('lab fault wrapper started');
    void this.bootCleanup();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * The record as it stands, read inside the same queue as every write -- so it
   * never observes a half-applied change, and the heartbeat it feeds cannot claim
   * a container is clean while a stop is mid-flight.
   */
  async snapshot(): Promise<WrapperState> {
    return this.serialise(() => this.store.load());
  }

  /** Whether the TTL sweep is running. The recovery guarantee is exactly this being true. */
  get watchdogArmed(): boolean {
    return this.timer !== null;
  }

  /** Strict: the first failure propagates. Apply is the direction that fails closed. */
  private async runActions(actions: readonly FaultAction[]): Promise<void> {
    for (const action of actions) {
      await this.execute(action);
    }
  }

  /** Best-effort: every undo is attempted, and only the ones that landed are reported. */
  private async runUndos(undos: readonly JobUndo[]): Promise<{ succeeded: Set<string>; failed: number }> {
    const succeeded = new Set<string>();
    let failed = 0;
    for (const undo of undos) {
      try {
        await this.execute(undo.action);
        succeeded.add(undo.job.jobId);
      } catch (error) {
        failed++;
        this.logger.error(
          `undo failed for ${faultClassOf(undo.job)} fault on ${undo.job.container}, retained: ${describe(error)}`
        );
      }
    }
    return { succeeded, failed };
  }
}

/** The pre-service name, so existing imports and tests read unchanged. */
export { LabFaultRunner as NetemFaultRunner };

/**
 * A command the orchestrator hands the wrapper. The wrapper is the single owner
 * of the fault state, so applying and undoing come in as commands rather than as
 * concurrent writes to the state file -- there is no second writer to race.
 *
 * There is no `service-start` command: starting a container is the UNDO of a
 * stop, reached through `clear` like every other undo, so the orchestrator's
 * recovery path stays the same for both fault classes.
 */
export type WrapperCommand =
  | { op: 'apply'; container: string; kind: NetemKind; args: string[]; runTag: string; expiresAtMs: number }
  | { op: 'service-stop'; container: string; runTag: string; expiresAtMs: number }
  | { op: 'clear'; jobId: string };

/**
 * Validate a decoded command. The channel is the orchestrator's, but a malformed
 * or truncated file must be rejected loudly, never acted on half-read. This is
 * also the trust boundary that bounds the lease.
 */
export function parseWrapperCommand(raw: unknown, nowMs: number = Date.now()): WrapperCommand {
  if (raw === null || typeof raw !== 'object') throw new Error('wrapper command must be an object');
  const value = raw as Record<string, unknown>;
  if (value.op === 'clear') {
    if (typeof value.jobId !== 'string' || value.jobId.length === 0) throw new Error('clear command needs a jobId');
    return { op: 'clear', jobId: value.jobId };
  }
  if (value.op === 'service-stop') {
    if (typeof value.container !== 'string' || value.container.length === 0) {
      throw new Error('service-stop command needs a container');
    }
    if (typeof value.runTag !== 'string' || value.runTag.length === 0) throw new Error('service-stop command needs a runTag');
    assertLeaseInstant(value.expiresAtMs, nowMs);
    return { op: 'service-stop', container: value.container, runTag: value.runTag, expiresAtMs: value.expiresAtMs };
  }
  if (value.op === 'apply') {
    if (typeof value.container !== 'string' || value.container.length === 0) throw new Error('apply command needs a container');
    if (!NETEM_KINDS.includes(value.kind as NetemKind)) throw new Error('apply command needs a valid kind');
    if (!Array.isArray(value.args) || !value.args.every((a) => typeof a === 'string')) throw new Error('apply command needs string args');
    if (typeof value.runTag !== 'string' || value.runTag.length === 0) throw new Error('apply command needs a runTag');
    assertLeaseInstant(value.expiresAtMs, nowMs);
    return {
      op: 'apply',
      container: value.container,
      kind: value.kind as NetemKind,
      args: value.args as string[],
      runTag: value.runTag,
      expiresAtMs: value.expiresAtMs,
    };
  }
  throw new Error(`unknown wrapper command op: ${String(value.op)}`);
}

/** The runner surface a command needs; keeps dispatch testable without the class. */
export interface FaultRunnerPort {
  apply(spec: NetemSpec, runTag: string, expiresAtMs: number): Promise<{ jobId: string }>;
  stopService(container: string, runTag: string, expiresAtMs: number): Promise<{ jobId: string }>;
  clear(jobId: string): Promise<void>;
}

/** Apply one validated command through the runner. Exhaustive by construction. */
export async function dispatchWrapperCommand(runner: FaultRunnerPort, command: WrapperCommand): Promise<void> {
  switch (command.op) {
    case 'apply':
      await runner.apply({ container: command.container, kind: command.kind, args: command.args }, command.runTag, command.expiresAtMs);
      return;
    case 'service-stop':
      await runner.stopService(command.container, command.runTag, command.expiresAtMs);
      return;
    case 'clear':
      await runner.clear(command.jobId);
      return;
    default: {
      const never: never = command;
      throw new Error(`unhandled wrapper command: ${JSON.stringify(never)}`);
    }
  }
}
