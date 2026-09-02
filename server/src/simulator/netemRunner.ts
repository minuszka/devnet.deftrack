import {
  emptyWrapperState,
  netemJobId,
  planApply,
  planBootCleanup,
  planClear,
  sweepExpired,
  type FaultAction,
  type NetemSpec,
  type WrapperState,
} from './netemLease.js';

/**
 * Runs one fault action against a container. The real implementation shells out
 * to `docker exec <container> tc <args>`; a test injects a recorder.
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

/**
 * The node-local fault wrapper.
 *
 * It runs on the lab host, beside the containers, and NOT inside the
 * orchestrator. That is the whole point: its watchdog expires a fault's lease
 * and clears the tc rule on its own timer, so the lab recovers even after the
 * orchestrator is killed and nothing is left to read Mongo. The orchestrator's
 * own reconcile only makes the record catch up afterwards; it never restores the
 * network.
 *
 * The invariant that makes boot recovery safe: the stored state is always a
 * superset of what is actually applied. So an apply records the job before it
 * runs the tc command, and a clear runs the tc command before it drops the job.
 * A crash in either gap leaves a job recorded whose rule may already be gone --
 * and clearing an absent qdisc is harmless -- never a rule applied that nothing
 * remembers.
 */
export class NetemFaultRunner {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
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

  /** Apply a fault under a lease. Records intent, then runs tc. Idempotent. */
  async apply(spec: NetemSpec, runTag: string, ttlMs: number): Promise<{ jobId: string }> {
    const jobId = netemJobId(runTag, spec);
    const plan = planApply(await this.store.load(), spec, runTag, this.clock(), ttlMs);
    if (plan.actions.length === 0) return { jobId };
    // Record before acting, so a rule that reaches the node is always known and
    // therefore always clearable.
    await this.store.save(plan.state);
    await this.runActions(plan.actions);
    return { jobId };
  }

  /** Clear one fault. Runs tc, then drops the job. Idempotent. */
  async clear(jobId: string): Promise<void> {
    const current = await this.store.load();
    const plan = planClear(current, jobId);
    if (plan.actions.length === 0) return;
    await this.runActions(plan.actions);
    await this.store.save(plan.state);
  }

  /**
   * The watchdog: clear every lease past its TTL. This is the recovery the
   * acceptance gate turns on -- it depends on nothing outside this process.
   */
  async tick(): Promise<{ cleared: number }> {
    if (this.ticking) return { cleared: 0 };
    this.ticking = true;
    try {
      const plan = sweepExpired(await this.store.load(), this.clock());
      if (plan.actions.length === 0) return { cleared: 0 };
      await this.runActions(plan.actions);
      await this.store.save(plan.state);
      return { cleared: plan.actions.length };
    } catch (error) {
      this.logger.error(`netem watchdog tick failed: ${error instanceof Error ? error.message : String(error)}`);
      return { cleared: 0 };
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Clear everything the stored state claims is applied and start clean. After a
   * crash the real qdisc state is unknown, so clearing each touched container is
   * the only safe baseline; clearing an already-clear one is harmless.
   */
  async bootCleanup(): Promise<{ cleared: number }> {
    const plan = planBootCleanup(await this.store.load());
    await this.runActions(plan.actions);
    await this.store.save(emptyWrapperState());
    return { cleared: plan.actions.length };
  }

  start(): void {
    void this.bootCleanup().then(() => {
      this.timer = setInterval(() => void this.tick(), this.intervalMs);
      this.logger.info('netem fault wrapper started');
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async runActions(actions: readonly FaultAction[]): Promise<void> {
    for (const action of actions) {
      await this.execute(action);
    }
  }
}
