import type { SimulationTargetCapability, SimulationTargetSnapshot } from '../models/SimulationRun.js';
import { netemJobId, serviceJobId, type FaultClass } from './netemLease.js';
import { MAX_TTL_MS, type WrapperCommand } from './netemRunner.js';
import type { DryRunPlan } from './scenarioTypes.js';

/**
 * The pure translation between a run's plan and the node-local fault wrapper.
 *
 * The lab executor applies two fault classes: `netem` impairment on a node's own
 * P2P interface, and a `service` outage -- the container stopped. Everything here
 * is pure: it decides which wrapper commands a plan implies and which targets a
 * recovery must prove clean; the queue, Docker and the clock live in the executor
 * that calls it.
 *
 * Apply and recovery are ONE translation, deliberately. If they were two, a class
 * could be supported on apply and skipped in recovery -- a run reporting all-clear
 * over a masternode that is still stopped. Here that is not a discipline to
 * remember; it is unwriteable.
 *
 * Anything the wrapper cannot faithfully apply is refused rather than partially
 * applied, so a run never reports a fault it did not fully cause.
 */

/** A plan action this executor cannot apply -- today, a partition. Fail closed. */
export class UnsupportedLiveFaultError extends Error {
  constructor(public readonly faultKind: string) {
    super(`the lab executor applies only netem and service faults; cannot apply "${faultKind}"`);
    this.name = 'UnsupportedLiveFaultError';
  }
}

/**
 * A plan whose faults need a schedule this executor cannot honour. It applies one
 * immediate outage per target; nothing dispatches an action at its offset, so a
 * flapping cycle would collapse into a single stop and report every action applied
 * while measuring none of them.
 */
export class UnscheduledLiveFaultError extends Error {
  constructor(actionId: string) {
    super(`the lab executor applies one immediate outage per target; action ${actionId} needs a schedule it cannot honour`);
    this.name = 'UnscheduledLiveFaultError';
  }
}

/** A referenced target that is missing, off-network, or lacks the needed capability. */
export class InvalidNetemTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNetemTargetError';
  }
}

/** tc takes `5%`, not `5.0%`; Number's own formatting drops the trailing zeros. */
function formatPercent(value: number): string {
  return `${Number(value)}%`;
}

/**
 * The composed tc netem argument vector for one impairment: an optional
 * `delay <lat> [<jitter>]` then an optional `loss <pct> [<correlation>]`. A
 * zero dimension is omitted, never emitted as `delay 0ms`. At least one must be
 * present -- an all-zero impairment is not a fault and the scenario registry
 * already forbids it, so reaching here with nothing to apply is a bug, not input.
 */
export function composeNetemArgs(input: {
  latencyMs: number;
  jitterMs: number;
  lossPercent: number;
  correlationPercent: number;
}): string[] {
  const args: string[] = [];
  if (input.latencyMs > 0) {
    args.push('delay', `${input.latencyMs}ms`);
    if (input.jitterMs > 0) args.push(`${input.jitterMs}ms`);
  }
  if (input.lossPercent > 0) {
    args.push('loss', formatPercent(input.lossPercent));
    if (input.correlationPercent > 0) args.push(formatPercent(input.correlationPercent));
  }
  if (args.length === 0) throw new Error('netem fault composed no latency or loss to apply');
  return args;
}

function requireLabTarget(
  targetsById: ReadonlyMap<string, SimulationTargetSnapshot>,
  targetId: string,
  capability: SimulationTargetCapability
): SimulationTargetSnapshot {
  const target = targetsById.get(targetId);
  if (target === undefined) throw new InvalidNetemTargetError(`plan references unknown target ${targetId}`);
  if (target.network !== 'regtest') {
    // Belt and suspenders behind the control service's network guard: a lab
    // container is a lab host, never a real fleet address.
    throw new InvalidNetemTargetError(`target ${targetId} is on ${target.network}, not the lab`);
  }
  if (!target.capabilities.includes(capability)) {
    throw new InvalidNetemTargetError(`target ${targetId} does not declare the ${capability} capability`);
  }
  return target;
}

export function indexTargetsById(
  targets: readonly SimulationTargetSnapshot[]
): Map<string, SimulationTargetSnapshot> {
  return new Map(targets.map((target) => [target.targetId, target]));
}

/** One fault a plan implies: how to apply it, and everything recovery needs to undo it. */
export interface LabFault {
  targetId: string;
  container: string;
  faultClass: FaultClass;
  jobId: string;
  apply: WrapperCommand;
}

/**
 * The one translation. `strict` is the apply direction: it refuses anything it
 * cannot faithfully cause. Lenient is the recovery direction: it undoes what it
 * understands and COUNTS what it does not, so recovery is never the thing that
 * fails closed and strands a run mid-teardown -- while a skip still denies the
 * run an all-clear it has not earned.
 *
 * A scheduled `fault-clear` and its service twin `service-start` are the paired
 * undo of a fault, not faults themselves: recovery and the wrapper's TTL own
 * them, so they are skipped by design and never counted.
 */
export function labFaultsForPlan(input: {
  plan: DryRunPlan;
  targetsById: ReadonlyMap<string, SimulationTargetSnapshot>;
  runTag: string;
  /** The absolute instant the lease ends -- the same one the run records. */
  expiresAtMs: number;
  nowMs: number;
  strict: boolean;
}): { faults: LabFault[]; skipped: number } {
  if (input.strict && input.expiresAtMs - input.nowMs > MAX_TTL_MS) {
    throw new UnsupportedLiveFaultError(
      `lease of ${input.expiresAtMs - input.nowMs} ms beyond the ${MAX_TTL_MS} ms ceiling`
    );
  }
  const faults: LabFault[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const stoppedTargets = new Set<string>();

  const refuse = (error: Error): void => {
    if (input.strict) throw error;
    skipped++;
  };

  for (const action of input.plan.actions) {
    const { payload } = action;
    // The paired undo of a fault, never a fault: owned by recovery and the TTL.
    if (payload.kind === 'fault-clear' || payload.kind === 'service-start') continue;

    if (payload.kind === 'netem-apply') {
      try {
        const target = requireLabTarget(input.targetsById, action.targetId, 'netem-p2p');
        const args = composeNetemArgs(payload);
        const jobId = netemJobId(input.runTag, { container: target.hostRef, kind: 'netem', args });
        if (seen.has(jobId)) continue;
        seen.add(jobId);
        faults.push({
          targetId: target.targetId,
          container: target.hostRef,
          faultClass: 'netem',
          jobId,
          apply: { op: 'apply', container: target.hostRef, kind: 'netem', args, runTag: input.runTag, expiresAtMs: input.expiresAtMs },
        });
      } catch (error) {
        refuse(error as Error);
      }
      continue;
    }

    if (payload.kind === 'service-stop') {
      try {
        // One immediate outage per target. A staged or repeated stop belongs to a
        // dispatcher that does not exist, and silently collapsing a flapping
        // schedule into one stop would measure nothing it claims to.
        if (action.notBeforeOffsetMs !== 0 || stoppedTargets.has(action.targetId)) {
          throw new UnscheduledLiveFaultError(action.actionId);
        }
        const target = requireLabTarget(input.targetsById, action.targetId, 'service-control');
        stoppedTargets.add(action.targetId);
        const jobId = serviceJobId(input.runTag, target.hostRef);
        if (seen.has(jobId)) continue;
        seen.add(jobId);
        faults.push({
          targetId: target.targetId,
          container: target.hostRef,
          faultClass: 'service',
          jobId,
          apply: { op: 'service-stop', container: target.hostRef, runTag: input.runTag, expiresAtMs: input.expiresAtMs },
        });
      } catch (error) {
        refuse(error as Error);
      }
      continue;
    }

    refuse(new UnsupportedLiveFaultError(payload.kind));
  }
  return { faults, skipped };
}

/**
 * A tripwire, true today by construction: no scenario mixes families. The wrapper
 * tolerates both classes on one container (composite key, service-first undo), but
 * the pair is physically hostile -- `docker start` recreates the namespace and
 * takes the qdisc with it -- so a plan that wants both needs a real design, not a
 * relaxed assertion.
 */
export function assertSingleFaultClass(plan: DryRunPlan): void {
  const classes = new Set<string>();
  for (const action of plan.actions) {
    if (action.payload.kind === 'netem-apply') classes.add('netem');
    if (action.payload.kind === 'service-stop') classes.add('service');
  }
  if (classes.size > 1) {
    throw new UnsupportedLiveFaultError('a plan mixing netem and service faults on one run');
  }
}

/** The apply commands a plan implies. Refuses anything it cannot faithfully cause. */
export function faultApplyCommandsForPlan(input: {
  plan: DryRunPlan;
  targetsById: ReadonlyMap<string, SimulationTargetSnapshot>;
  runTag: string;
  expiresAtMs: number;
  nowMs: number;
}): WrapperCommand[] {
  return labFaultsForPlan({ ...input, strict: true }).faults.map((fault) => fault.apply);
}

/** One recovery target: the clear that ends its fault and how to probe it. */
export interface LabRecoveryTarget {
  targetId: string;
  container: string;
  faultClass: FaultClass;
  clear: WrapperCommand;
}

/**
 * The recovery plan: a clear per faulted target, keyed by the same job id the
 * apply minted, plus what to probe. `skipped` is what recovery could not speak
 * for -- the caller must not report all-clear over it.
 */
export function faultRecoveryTargetsForPlan(input: {
  plan: DryRunPlan;
  targetsById: ReadonlyMap<string, SimulationTargetSnapshot>;
  runTag: string;
}): { targets: LabRecoveryTarget[]; skipped: number } {
  // The lease is irrelevant here: recovery only needs the job ids, which are
  // minted from the run tag and the spec, never from the expiry.
  const { faults, skipped } = labFaultsForPlan({ ...input, expiresAtMs: 1, nowMs: 0, strict: false });
  return {
    targets: faults.map((fault) => ({
      targetId: fault.targetId,
      container: fault.container,
      faultClass: fault.faultClass,
      clear: { op: 'clear', jobId: fault.jobId },
    })),
    skipped,
  };
}
