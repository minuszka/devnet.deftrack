import type { SimulationRunProjection } from './simulationPersistence.service.js';
import type { DryRunPlan, PlannedSimulationAction } from '../simulator/scenarioTypes.js';
import type {
  LeasedSimulationAction,
  ScheduledActionRow,
  SimulationActionRepository,
} from './simulationAction.repository.js';

/** Just what the sweep needs to say, so a unit test runs without the logger's config. */
export interface DispatcherLogger {
  info(message: string): void;
  error(message: string): void;
}

const SILENT_LOGGER: DispatcherLogger = { info: () => {}, error: () => {} };

const INTERVAL_MS = 2_000;
const LEASE_MS = 30_000;
/** Bounded so one pass cannot hold the sweep while a run's whole schedule fires. */
const MAX_PER_TICK = 20;

/**
 * The statuses in which a run's schedule may still be performed.
 *
 * An action must never land on a run that has moved past its fault: recovery
 * proves the lab clean, and a stop arriving afterwards would make that proof a
 * lie. The queue is cancelled at recovery, and this is the second guard on the
 * same rule -- a race between cancelling and claiming has to lose here.
 */
const DISPATCHABLE_STATUSES = new Set(['fault_active', 'observing']);

export interface ActionDispatcherDeps {
  loadRun(runKey: string): Promise<SimulationRunProjection>;
  loadPlan(run: SimulationRunProjection): Promise<DryRunPlan>;
  dispatch(input: {
    run: SimulationRunProjection;
    plan: DryRunPlan;
    actionId: string;
    faultLeaseExpiresAtMs: number;
  }): Promise<void>;
  workerId: string;
  intervalMs?: number;
  leaseMs?: number;
  clock?: () => number;
  logger?: DispatcherLogger;
}

/**
 * Performs the actions a plan scheduled for after activation.
 *
 * Without it the executor refuses any plan whose actions are not all immediate,
 * because collapsing a flapping cycle into a single stop would report every
 * action applied while measuring none of them. That refusal is what this
 * replaces: a restart storm, a staggered reconnect and a flapping cycle are all
 * the same thing -- stops and starts at offsets -- and none of them can be
 * expressed by a path that only knows "now".
 *
 * The schedule is persisted, not held in a timer. A process that dies mid-cycle
 * must not take the rest of the run with it, and the wrapper's TTL remains the
 * backstop underneath: every command carries the run's own lease, so even an
 * action dispatched late expires with the run rather than outliving it.
 */
export class SimulationActionDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private readonly logger: DispatcherLogger;
  private readonly clock: () => number;

  constructor(
    private readonly actions: SimulationActionRepository,
    private readonly deps: ActionDispatcherDeps
  ) {
    this.logger = deps.logger ?? SILENT_LOGGER;
    this.clock = deps.clock ?? Date.now;
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? INTERVAL_MS);
    this.logger.info(`Action dispatcher started (every ${this.deps.intervalMs ?? INTERVAL_MS} ms)`);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Exposed so a test can drive it without a timer. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Retire what can no longer make progress before claiming: an action whose
      // window has closed must not be handed to a worker that would then apply a
      // fault the run no longer has time to undo.
      await this.actions.expireOverdue(this.clock());
      for (let dispatched = 0; dispatched < MAX_PER_TICK; dispatched++) {
        const claimed = await this.actions.claimDue({
          claimedBy: this.deps.workerId,
          nowMs: this.clock(),
          leaseMs: this.deps.leaseMs ?? LEASE_MS,
        });
        if (claimed === null) return;
        await this.perform(claimed);
      }
    } catch (error) {
      this.logger.error(`action dispatch sweep failed: ${message(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async perform(claimed: LeasedSimulationAction): Promise<void> {
    const nowMs = this.clock();
    try {
      const run = await this.deps.loadRun(claimed.runKey);
      if (!DISPATCHABLE_STATUSES.has(run.state.status)) {
        // The run moved on under us. Settling it as compensated rather than
        // failed says what happened: nothing was applied, and nothing needs to
        // be undone.
        await this.settle(claimed, 'compensated', 'already-clear', nowMs, 'run is no longer in its fault window');
        return;
      }
      const lease = run.state.faultLeaseExpiresAtMs;
      if (lease === null || lease <= nowMs) {
        await this.settle(claimed, 'compensated', 'already-clear', nowMs, 'the run lease has ended');
        return;
      }
      const plan = await this.deps.loadPlan(run);
      await this.deps.dispatch({ run, plan, actionId: claimed.actionId, faultLeaseExpiresAtMs: lease });
      await this.settle(claimed, 'succeeded', 'applied', nowMs, null);
      this.logger.info(`${claimed.runKey} dispatched ${claimed.kind} for ${claimed.targetId}`);
    } catch (error) {
      // Settled as failed so the attempt is recorded and the action can be
      // retried while attempts remain; the queue decides that, not this sweep.
      await this.settle(claimed, 'failed', 'wrapper-failed', nowMs, message(error));
      this.logger.error(`dispatch of ${claimed.actionId} failed: ${message(error)}`);
    }
  }

  private async settle(
    claimed: LeasedSimulationAction,
    status: 'succeeded' | 'failed' | 'compensated',
    code: 'applied' | 'already-clear' | 'wrapper-failed',
    nowMs: number,
    detail: string | null
  ): Promise<void> {
    // The result of settling is evidence, not noise. `settle` returns false
    // when this worker no longer holds the lease -- another worker reclaimed
    // the action after its 30 s expired and is dispatching it too. Discarding
    // that made a double dispatch leave no trace at all: in a flapping cycle a
    // stale `stop` can land after the `start` and re-stop a node until the
    // wrapper TTL clears it, and the only record said the action succeeded.
    const settled = await this.actions.settle({
      actionId: claimed.actionId,
      claimedBy: this.deps.workerId,
      status,
      executedAtMs: nowMs,
      result: {
        code,
        publicMessage:
          status === 'succeeded' ? 'Scheduled action applied.' : 'Scheduled action was not applied.',
        privateDetail: detail,
        wrapperVersion: null,
        finishedAtMs: nowMs,
      },
    });
    if (!settled) {
      this.logger.error(
        `${claimed.runKey}: lease lost on ${claimed.actionId} before it could be settled as ` +
          `${status}; another worker may have dispatched it as well`
      );
    }
  }
}

/**
 * The queue rows a plan implies, given when its fault actually began.
 *
 * `notBeforeMs` is absolute and derived from the activation instant, not from a
 * relative delay held anywhere: a delay would restart on every retry and drift
 * with the queue, which is the same mistake the fault lease already refuses to
 * make. `expiresAtMs` is the run's own lease, so an action that could no longer
 * be undone within the run is never performed at all.
 */
export function scheduledActionRowsFor(input: {
  runKey: string;
  actions: readonly PlannedSimulationAction[];
  activatedAtMs: number;
  faultLeaseExpiresAtMs: number;
}): ScheduledActionRow[] {
  return input.actions
    .filter((action) => action.notBeforeOffsetMs > 0)
    .map((action) => ({
      actionId: action.actionId,
      runKey: input.runKey,
      sequence: action.sequence,
      targetId: action.targetId,
      kind: action.kind,
      payload: action.payload as unknown as Record<string, unknown>,
      payloadDigest: action.payloadDigest,
      notBeforeMs: input.activatedAtMs + action.notBeforeOffsetMs,
      expiresAtMs: input.faultLeaseExpiresAtMs,
      maxAttempts: action.maxAttempts,
    }))
    .filter((row) => row.notBeforeMs < row.expiresAtMs);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
