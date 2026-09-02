import type { SimulationTargetSnapshot } from '../models/SimulationRun.js';
import { netemJobId, type NetemSpec } from './netemLease.js';
import type { WrapperCommand } from './netemRunner.js';
import type { DryRunPlan } from './scenarioTypes.js';

/**
 * The pure translation between a run's plan and the node-local netem wrapper.
 *
 * The lab executor applies only netem faults: latency, jitter and packet loss on
 * a node's own P2P interface, as one composed qdisc. Everything here is pure --
 * it decides which wrapper commands a plan implies and which targets a recovery
 * must prove clean; the queue, Docker and the clock live in the executor that
 * calls it. Anything the wrapper cannot faithfully apply is refused rather than
 * partially applied, so a run never reports a fault it did not fully cause.
 */

/** A plan action this executor cannot apply -- service control or partition. Fail closed. */
export class UnsupportedLiveFaultError extends Error {
  constructor(public readonly faultKind: string) {
    super(`the lab executor applies only netem faults; cannot apply "${faultKind}"`);
    this.name = 'UnsupportedLiveFaultError';
  }
}

/** A referenced target that is missing, off-network, or lacks the netem capability. */
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

function requireNetemTarget(
  targetsById: ReadonlyMap<string, SimulationTargetSnapshot>,
  targetId: string
): SimulationTargetSnapshot {
  const target = targetsById.get(targetId);
  if (target === undefined) throw new InvalidNetemTargetError(`plan references unknown target ${targetId}`);
  if (target.network !== 'regtest') {
    // Belt and suspenders behind the control service's network guard: a netem
    // container is a lab host, never a real fleet address.
    throw new InvalidNetemTargetError(`target ${targetId} is on ${target.network}, not the lab`);
  }
  if (!target.capabilities.includes('netem-p2p')) {
    throw new InvalidNetemTargetError(`target ${targetId} does not declare the netem-p2p capability`);
  }
  return target;
}

function netemSpecForAction(target: SimulationTargetSnapshot, payload: {
  latencyMs: number; jitterMs: number; lossPercent: number; correlationPercent: number;
}): NetemSpec {
  return { container: target.hostRef, kind: 'netem', args: composeNetemArgs(payload) };
}

export function indexTargetsById(
  targets: readonly SimulationTargetSnapshot[]
): Map<string, SimulationTargetSnapshot> {
  return new Map(targets.map((target) => [target.targetId, target]));
}

/**
 * The apply commands a plan implies. netem-apply actions become one composed
 * `apply` each; the scheduled fault-clear is skipped (recovery and the wrapper's
 * own TTL own the clearing); any other kind is refused. Returns [] for a plan
 * that carries no netem fault -- clear-recover, which activates nothing.
 */
export function netemApplyCommandsForPlan(input: {
  plan: DryRunPlan;
  targetsById: ReadonlyMap<string, SimulationTargetSnapshot>;
  runTag: string;
  ttlMs: number;
}): WrapperCommand[] {
  const commands: WrapperCommand[] = [];
  for (const action of input.plan.actions) {
    const { payload } = action;
    if (payload.kind === 'fault-clear') continue;
    if (payload.kind !== 'netem-apply') throw new UnsupportedLiveFaultError(payload.kind);
    const target = requireNetemTarget(input.targetsById, action.targetId);
    commands.push({
      op: 'apply',
      container: target.hostRef,
      kind: 'netem',
      args: composeNetemArgs(payload),
      runTag: input.runTag,
      ttlMs: input.ttlMs,
    });
  }
  return commands;
}

/** One recovery target: the clear command that ends its fault and how to probe it. */
export interface NetemRecoveryTarget {
  targetId: string;
  container: string;
  clear: WrapperCommand;
}

/**
 * The recovery plan: a clear command per netem-faulted target, keyed by the same
 * job id the apply used, plus the container to probe clean. Lenient by design --
 * a plan whose fault this executor never applied (service control, partition, or
 * nothing) yields no recovery work rather than throwing, so recovery is never the
 * thing that fails closed and strands a run mid-teardown.
 */
export function netemRecoveryTargetsForPlan(input: {
  plan: DryRunPlan;
  targetsById: ReadonlyMap<string, SimulationTargetSnapshot>;
  runTag: string;
}): NetemRecoveryTarget[] {
  const targets: NetemRecoveryTarget[] = [];
  const seen = new Set<string>();
  for (const action of input.plan.actions) {
    if (action.payload.kind !== 'netem-apply') continue;
    const target = input.targetsById.get(action.targetId);
    if (target === undefined || !target.capabilities.includes('netem-p2p')) continue;
    const spec = netemSpecForAction(target, action.payload);
    const jobId = netemJobId(input.runTag, spec);
    if (seen.has(jobId)) continue;
    seen.add(jobId);
    targets.push({ targetId: target.targetId, container: target.hostRef, clear: { op: 'clear', jobId } });
  }
  return targets;
}
