import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SimulationRecoveryResult, SimulationRecoveryTargetResult } from '../models/SimulationRun.js';
import type { SimulationLiveExecutor } from '../services/simulationControl.service.js';
import type { SimulationRunProjection } from '../services/simulationPersistence.service.js';
import {
  indexTargetsById,
  netemApplyCommandsForPlan,
  netemRecoveryTargetsForPlan,
} from './liveExecutorPlan.js';
import type { CommandQueue } from './netemWrapperHost.js';
import type { DryRunPlan } from './scenarioTypes.js';

/**
 * The live executor that drives the node-local netem wrapper.
 *
 * It never touches Docker or the clock directly: it enqueues wrapper commands and
 * reads the lab through injected probes, so the whole apply/recover decision is
 * tested with fakes. `activateFault` translates the plan into composed netem
 * `apply` commands and enqueues them under the run's own lease; `proveRecovery`
 * enqueues the matching clears, waits for the wrapper to consume them, and probes
 * each faulted container back to a clean, running, observed state.
 *
 * The fault's real recovery is the wrapper's own TTL watchdog -- this executor's
 * clears are the fast path, and the lease is the guarantee that survives even if
 * this process dies before it can enqueue them.
 */

/** How the executor reads the lab. Each probe is a single, side-effect-free question. */
export interface LabProbes {
  /** True when the container's P2P interface carries no netem qdisc. */
  qdiscClean(container: string): Promise<boolean>;
  /** True when the container is running (Docker's own view). */
  serviceRunning(container: string): Promise<boolean>;
  /** True when the node is being observed -- for the lab, its daemon process is alive. */
  observerFresh(input: { targetId: string; container: string }): Promise<boolean>;
}

export interface LabExecutorClock {
  now(): number;
  delay(ms: number): Promise<void>;
}

export interface LabExecutorOptions {
  /** How many times to re-probe for a clean link before giving up. */
  recoveryPollAttempts: number;
  /** Wait between clean-probes; at least the wrapper's cycle interval. */
  recoveryPollIntervalMs: number;
  /** Lease floor, so a lease that is already near-past still applies briefly. */
  minLeaseMs: number;
}

const DEFAULT_OPTIONS: LabExecutorOptions = {
  recoveryPollAttempts: 12,
  recoveryPollIntervalMs: 1_000,
  minLeaseMs: 1_000,
};

export const systemLabClock: LabExecutorClock = {
  now: () => Date.now(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class DockerLiveExecutor implements SimulationLiveExecutor {
  private readonly options: LabExecutorOptions;

  constructor(
    private readonly queue: CommandQueue,
    private readonly probes: LabProbes,
    private readonly clock: LabExecutorClock = systemLabClock,
    options: Partial<LabExecutorOptions> = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async activateFault(input: {
    run: SimulationRunProjection;
    plan: DryRunPlan;
    faultLeaseExpiresAtMs: number;
  }): Promise<void> {
    const ttlMs = Math.max(this.options.minLeaseMs, input.faultLeaseExpiresAtMs - this.clock.now());
    const targetsById = indexTargetsById(input.run.metadata.targetSnapshot);
    const commands = netemApplyCommandsForPlan({
      plan: input.plan,
      targetsById,
      runTag: input.run.runKey,
      ttlMs,
    });
    // netemApplyCommandsForPlan throws for any fault this executor cannot apply,
    // so the run never reaches fault_active on a partially-applied fault.
    for (const command of commands) await this.queue.enqueue(command);
  }

  async proveRecovery(input: {
    run: SimulationRunProjection;
    plan: DryRunPlan;
  }): Promise<SimulationRecoveryResult> {
    const startedAtMs = this.clock.now();
    const targetsById = indexTargetsById(input.run.metadata.targetSnapshot);
    const recoveryTargets = netemRecoveryTargetsForPlan({
      plan: input.plan,
      targetsById,
      runTag: input.run.runKey,
    });
    for (const target of recoveryTargets) await this.queue.enqueue(target.clear);
    await this.waitForClean(recoveryTargets.map((target) => target.container));

    const targets: SimulationRecoveryTargetResult[] = [];
    for (const target of recoveryTargets) {
      const [faultStateClear, expectedServiceRunning, observerFresh] = await Promise.all([
        this.probes.qdiscClean(target.container),
        this.probes.serviceRunning(target.container),
        this.probes.observerFresh({ targetId: target.targetId, container: target.container }),
      ]);
      targets.push({
        targetId: target.targetId,
        faultStateClear,
        expectedServiceRunning,
        observerFresh,
        checkedAtMs: this.clock.now(),
        privateDetail: null,
      });
    }
    const allClear = targets.every(
      (target) => target.faultStateClear && target.expectedServiceRunning && target.observerFresh
    );
    return { required: true, startedAtMs, finishedAtMs: this.clock.now(), targets, allClear };
  }

  /** Poll the faulted containers until every link is clean or the attempts run out. */
  private async waitForClean(containers: readonly string[]): Promise<void> {
    const unique = [...new Set(containers)];
    if (unique.length === 0) return;
    for (let attempt = 0; attempt < this.options.recoveryPollAttempts; attempt++) {
      const states = await Promise.all(unique.map((container) => this.probes.qdiscClean(container)));
      if (states.every(Boolean)) return;
      if (attempt < this.options.recoveryPollAttempts - 1) {
        await this.clock.delay(this.options.recoveryPollIntervalMs);
      }
    }
  }
}

// --- Real Docker probe adapters. Thin, exercised against a live lab, not in units. ---

const exec = promisify(execFile);

async function dockerStdout(dockerBin: string, args: string[]): Promise<string> {
  const { stdout } = await exec(dockerBin, args);
  return stdout;
}

/**
 * The real lab probes, over `docker`. qdiscClean reads the interface's qdisc;
 * serviceRunning reads Docker's own container state; observerFresh asks whether
 * the node daemon is actually running inside the container (a container can be up
 * with a dead daemon), which is the lab's honest stand-in for "still observed" --
 * chain-level observation freshness is the poller's job, not the executor's.
 */
export function dockerLabProbes(dockerBin = 'docker'): LabProbes {
  return {
    async qdiscClean(container: string): Promise<boolean> {
      const out = await dockerStdout(dockerBin, ['exec', '-u', 'root', container, 'tc', 'qdisc', 'show', 'dev', 'eth0']);
      return !out.includes('netem');
    },
    async serviceRunning(container: string): Promise<boolean> {
      const out = await dockerStdout(dockerBin, ['inspect', '-f', '{{.State.Running}}', container]);
      return out.trim() === 'true';
    },
    async observerFresh(input: { container: string }): Promise<boolean> {
      // `docker top` needs no in-container tooling and lists the container's
      // processes; the daemon being present is the node still being a node.
      const out = await dockerStdout(dockerBin, ['top', input.container]);
      return /\bdefcond\b/.test(out);
    },
  };
}
