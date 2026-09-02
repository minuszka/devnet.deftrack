import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SimulationRecoveryResult, SimulationRecoveryTargetResult } from '../models/SimulationRun.js';
import type { SimulationLiveExecutor } from '../services/simulationControl.service.js';
import type { SimulationRunProjection } from '../services/simulationPersistence.service.js';
import {
  assertSingleFaultClass,
  labFaultsForPlan,
  faultRecoveryTargetsForPlan,
  indexTargetsById,
  type LabRecoveryTarget,
} from './liveExecutorPlan.js';
import type { CommandQueue } from './netemWrapperHost.js';
import type { DryRunPlan } from './scenarioTypes.js';

/**
 * The live executor that drives the node-local fault wrapper.
 *
 * It never touches Docker or the clock directly: it enqueues wrapper commands and
 * reads the lab through injected probes, so the whole apply/recover decision is
 * tested with fakes. `activateFault` translates the plan into wrapper commands and
 * enqueues them under the run's own lease; `proveRecovery` enqueues the matching
 * clears, waits for each target to actually come back, and records what it found.
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
  /**
   * The Compose project a container belongs to, or null when it belongs to none.
   * A target's hostRef becomes a container name verbatim, so without this any
   * container on the lab host could be named in a declaration and then faulted.
   */
  containerProject(container: string): Promise<string | null>;
}

export interface LabExecutorClock {
  now(): number;
  delay(ms: number): Promise<void>;
}

/** A container that is not part of the lab's own Compose project. Fail closed. */
export class ContainerNotInLabProjectError extends Error {
  constructor(container: string, project: string | null, expected: string) {
    super(
      `container "${container}" belongs to project "${project ?? 'none'}", not the lab project "${expected}"`
    );
    this.name = 'ContainerNotInLabProjectError';
  }
}

export interface LabExecutorOptions {
  /** How many times to re-probe for a recovered target before giving up. */
  recoveryPollAttempts: number;
  /** Wait between probes; at least the wrapper's cycle interval. */
  recoveryPollIntervalMs: number;
  /**
   * The only Compose project whose containers may be faulted. Empty refuses
   * everything: a lab that has not said which containers are its own must not be
   * allowed to guess, and the executor is opt-in already.
   */
  allowedContainerProject: string;
}

const DEFAULT_OPTIONS: LabExecutorOptions = {
  // A stopped node has to be stopped, started and rejoin before it reads healthy,
  // which is a great deal slower than deleting a qdisc.
  recoveryPollAttempts: 30,
  recoveryPollIntervalMs: 1_000,
  allowedContainerProject: '',
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
    assertSingleFaultClass(input.plan);
    const targetsById = indexTargetsById(input.run.metadata.targetSnapshot);
    // Translates the WHOLE plan first: it throws for any fault this executor
    // cannot apply, so the run never reaches fault_active on a partial fault.
    const faults = labFaultsForPlan({
      plan: input.plan,
      targetsById,
      runTag: input.run.runKey,
      // The run's own lease instant, passed through untouched. It used to be
      // converted to a duration here and back to an instant in the wrapper,
      // against a later clock -- so queue time silently extended every fault, and
      // a floor could even start one whose lease had already gone.
      expiresAtMs: input.faultLeaseExpiresAtMs,
      nowMs: this.clock.now(),
      strict: true,
    }).faults;
    const commands = faults.map((fault) => fault.apply);
    // Every container is checked BEFORE the first enqueue: a refusal must leave
    // no half-applied fault behind.
    for (const fault of faults) await this.assertContainerIsOurs(fault.container);
    for (const command of commands) await this.queue.enqueue(command);
  }

  /**
   * A declared hostRef becomes a container name verbatim, so without this any
   * container sharing the lab host -- another project's database, the developer's
   * own service -- could be declared as a target and then stopped.
   */
  private async assertContainerIsOurs(container: string): Promise<void> {
    const expected = this.options.allowedContainerProject;
    if (expected === '') throw new ContainerNotInLabProjectError(container, null, '(unset)');
    let project: string | null = null;
    try {
      project = await this.probes.containerProject(container);
    } catch {
      project = null;
    }
    if (project !== expected) throw new ContainerNotInLabProjectError(container, project, expected);
  }

  async proveRecovery(input: {
    run: SimulationRunProjection;
    plan: DryRunPlan;
  }): Promise<SimulationRecoveryResult> {
    const startedAtMs = this.clock.now();
    const targetsById = indexTargetsById(input.run.metadata.targetSnapshot);
    const { targets: recoveryTargets, skipped } = faultRecoveryTargetsForPlan({
      plan: input.plan,
      targetsById,
      runTag: input.run.runKey,
    });
    for (const target of recoveryTargets) await this.queue.enqueue(target.clear);
    await this.waitForRecovered(recoveryTargets);

    const targets: SimulationRecoveryTargetResult[] = [];
    for (const target of recoveryTargets) {
      targets.push(await this.probeTarget(target));
    }
    const allClear =
      // A skip is something recovery could not speak for; leniency must never
      // become a claim. An empty target list is not evidence of a clean lab.
      skipped === 0 &&
      targets.length > 0 &&
      targets.every((target) => target.faultStateClear && target.expectedServiceRunning && target.observerFresh);
    return {
      required: recoveryTargets.length > 0,
      startedAtMs,
      finishedAtMs: this.clock.now(),
      targets,
      allClear,
    };
  }

  /**
   * Read one target back. Ordered, not concurrent: `serviceRunning` is a
   * `docker inspect` and answers for a stopped container, while the other two
   * reach INTO it and cannot. Asking them of a container that is down would be a
   * guaranteed failure reported as a finding.
   *
   * `faultStateClear` carries one meaning across both classes -- "the fault this
   * run applied is no longer in force" -- which for a service outage is the
   * container running again, and for an impairment is the qdisc gone.
   */
  private async probeTarget(target: LabRecoveryTarget): Promise<SimulationRecoveryTargetResult> {
    const running = await safeProbe(() => this.probes.serviceRunning(target.container));
    const observerFresh = running
      ? await safeProbe(() => this.probes.observerFresh({ targetId: target.targetId, container: target.container }))
      : false;
    const qdiscClean = running ? await safeProbe(() => this.probes.qdiscClean(target.container)) : false;
    return {
      targetId: target.targetId,
      faultStateClear: target.faultClass === 'service' ? running : qdiscClean,
      expectedServiceRunning: running,
      observerFresh,
      checkedAtMs: this.clock.now(),
      privateDetail: null,
    };
  }

  /**
   * Poll until every target has come back, on a per-class predicate. A service
   * target waits for its daemon to reappear, not merely for the container to be
   * up: a container is running the instant Docker starts it, seconds before the
   * node inside it is a node again.
   */
  private async waitForRecovered(targets: readonly LabRecoveryTarget[]): Promise<void> {
    if (targets.length === 0) return;
    for (let attempt = 0; attempt < this.options.recoveryPollAttempts; attempt++) {
      const states = await Promise.all(targets.map((target) => this.isRecovered(target)));
      if (states.every(Boolean)) return;
      if (attempt < this.options.recoveryPollAttempts - 1) {
        await this.clock.delay(this.options.recoveryPollIntervalMs);
      }
    }
  }

  private async isRecovered(target: LabRecoveryTarget): Promise<boolean> {
    if (target.faultClass === 'service') {
      if (!(await safeProbe(() => this.probes.serviceRunning(target.container)))) return false;
      return safeProbe(() => this.probes.observerFresh({ targetId: target.targetId, container: target.container }));
    }
    return safeProbe(() => this.probes.qdiscClean(target.container));
  }
}

/**
 * A probe that throws answers "no", never propagates. A `docker exec` into a
 * stopped container rejects, and letting that escape would abandon proveRecovery
 * mid-flight -- parking the run in `recovery` with no findings recorded at all,
 * which is strictly worse than a recorded failure.
 */
async function safeProbe(read: () => Promise<boolean>): Promise<boolean> {
  try {
    return await read();
  } catch {
    return false;
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
    async containerProject(container: string): Promise<string | null> {
      const out = await dockerStdout(dockerBin, [
        'inspect', '-f', '{{index .Config.Labels "com.docker.compose.project"}}', container,
      ]);
      const value = out.trim();
      return value === '' || value === '<no value>' ? null : value;
    },
    async observerFresh(input: { container: string }): Promise<boolean> {
      // `docker top` needs no in-container tooling and lists the container's
      // processes; the daemon being present is the node still being a node.
      const out = await dockerStdout(dockerBin, ['top', input.container]);
      return /\bdefcond\b/.test(out);
    },
  };
}
