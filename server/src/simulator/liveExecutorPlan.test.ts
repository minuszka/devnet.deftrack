import { describe, expect, it } from 'vitest';
import {
  InvalidNetemTargetError,
  UnscheduledLiveFaultError,
  UnsupportedLiveFaultError,
  assertSingleFaultClass,
  composeNetemArgs,
  faultApplyCommandsForPlan,
  faultRecoveryTargetsForPlan,
  indexTargetsById,
  scheduledLabActionsForPlan,
} from './liveExecutorPlan.js';
import { netemJobId, serviceJobId, tcApplyArgs } from './netemLease.js';
import { MAX_TTL_MS } from './netemRunner.js';
import type { PlannedActionPayload, PlannedSimulationAction, DryRunPlan } from './scenarioTypes.js';
import type { SimulationTargetSnapshot } from '../models/SimulationRun.js';

function target(overrides: Partial<SimulationTargetSnapshot> = {}): SimulationTargetSnapshot {
  return {
    targetId: 'mn-1',
    displayLabel: 'mn-1',
    operatorId: null,
    proTxHash: null,
    hostRef: 'mn01',
    unitRef: 'defcon-devnet-mn@1',
    p2pPort: 19799,
    role: 'masternode',
    network: 'regtest',
    capabilities: ['netem-p2p', 'service-control', 'partition-p2p'],
    expectedBuild: null,
    capturedAtMs: 0,
    capturedAtHeight: 0,
    ...overrides,
  };
}

function action(
  targetId: string,
  payload: PlannedActionPayload,
  sequence = 0,
  notBeforeOffsetMs = 0
): PlannedSimulationAction {
  return {
    actionId: `${targetId}:${sequence}`,
    runKey: 'run-1',
    sequence,
    targetId,
    kind: payload.kind,
    payload,
    payloadDigest: 'digest',
    notBeforeOffsetMs,
    expiresAfterMs: 60_000,
    maxAttempts: 1,
  };
}

const netemPayload = (overrides: Partial<Extract<PlannedActionPayload, { kind: 'netem-apply' }>> = {}) =>
  ({
    kind: 'netem-apply' as const,
    interfaceRef: 'devnet-p2p' as const,
    latencyMs: 100,
    jitterMs: 20,
    lossPercent: 5,
    correlationPercent: 25,
    faultLeaseSeconds: 200,
    ...overrides,
  });

const stopPayload: PlannedActionPayload = { kind: 'service-stop', faultLeaseSeconds: 200 };
const partitionPayload: PlannedActionPayload = {
  kind: 'partition-apply', p2pPortRef: 'devnet-p2p', peerTargetIds: ['mn-2'], faultLeaseSeconds: 60,
};

const planWith = (actions: PlannedSimulationAction[]): DryRunPlan => ({ actions } as unknown as DryRunPlan);

describe('composeNetemArgs', () => {
  it('composes latency, jitter, loss and correlation into one qdisc vector', () => {
    expect(composeNetemArgs({ latencyMs: 100, jitterMs: 20, lossPercent: 5, correlationPercent: 25 }))
      .toEqual(['delay', '100ms', '20ms', 'loss', '5%', '25%']);
  });

  it('omits a zero dimension rather than emitting delay 0ms or loss 0%', () => {
    expect(composeNetemArgs({ latencyMs: 100, jitterMs: 0, lossPercent: 0, correlationPercent: 0 })).toEqual(['delay', '100ms']);
    expect(composeNetemArgs({ latencyMs: 0, jitterMs: 0, lossPercent: 5, correlationPercent: 0 })).toEqual(['loss', '5%']);
    expect(composeNetemArgs({ latencyMs: 100, jitterMs: 0, lossPercent: 5, correlationPercent: 0 })).toEqual(['delay', '100ms', 'loss', '5%']);
  });

  it('formats a fractional loss without trailing zeros', () => {
    expect(composeNetemArgs({ latencyMs: 0, jitterMs: 0, lossPercent: 5.5, correlationPercent: 0 })).toEqual(['loss', '5.5%']);
  });

  it('throws when there is nothing to apply', () => {
    expect(() => composeNetemArgs({ latencyMs: 0, jitterMs: 0, lossPercent: 0, correlationPercent: 0 })).toThrow(/composed no/);
  });

  it('produces a vector tc accepts as a composed netem spec', () => {
    const args = composeNetemArgs({ latencyMs: 100, jitterMs: 20, lossPercent: 5, correlationPercent: 25 });
    expect(tcApplyArgs({ container: 'mn01', kind: 'netem', args })).toEqual([
      'qdisc', 'replace', 'dev', 'eth0', 'root', 'netem', 'delay', '100ms', '20ms', 'loss', '5%', '25%',
    ]);
  });
});

describe('faultApplyCommandsForPlan', () => {
  const targets = indexTargetsById([target({ targetId: 'mn-1', hostRef: 'mn01' }), target({ targetId: 'mn-2', hostRef: 'mn02' })]);

  it('turns each netem-apply into a composed apply and skips the scheduled clear', () => {
    const plan = planWith([
      action('mn-1', netemPayload()),
      action('mn-1', { kind: 'fault-clear', scope: 'run' }, 1),
      action('mn-2', netemPayload({ latencyMs: 50, jitterMs: 0, lossPercent: 0, correlationPercent: 0 }), 2),
    ]);
    expect(faultApplyCommandsForPlan({ plan, targetsById: targets, runTag: 'run-1', expiresAtMs: 30_000, nowMs: 0 })).toEqual([
      { op: 'apply', container: 'mn01', kind: 'netem', args: ['delay', '100ms', '20ms', 'loss', '5%', '25%'], runTag: 'run-1', expiresAtMs: 30_000 },
      { op: 'apply', container: 'mn02', kind: 'netem', args: ['delay', '50ms'], runTag: 'run-1', expiresAtMs: 30_000 },
    ]);
  });

  it('turns each service-stop into one stop command and skips its paired start', () => {
    const plan = planWith([
      action('mn-1', stopPayload),
      action('mn-1', { kind: 'service-start' }, 1, 30_000), // the paired undo: recovery and the TTL own it
      action('mn-2', stopPayload, 2),
    ]);
    expect(faultApplyCommandsForPlan({ plan, targetsById: targets, runTag: 'run-1', expiresAtMs: 30_000, nowMs: 0 })).toEqual([
      { op: 'service-stop', container: 'mn01', runTag: 'run-1', expiresAtMs: 30_000 },
      { op: 'service-stop', container: 'mn02', runTag: 'run-1', expiresAtMs: 30_000 },
    ]);
  });

  it('returns nothing for a clear-only plan rather than throwing', () => {
    const plan = planWith([action('mn-1', { kind: 'fault-clear', scope: 'run' })]);
    expect(faultApplyCommandsForPlan({ plan, targetsById: targets, runTag: 'run-1', expiresAtMs: 1_000, nowMs: 0 })).toEqual([]);
  });

  it('cuts a node off from the peers a partition names', () => {
    // The peers reach tc as ADDRESSES, taken from the host the chain sees --
    // hostRef itself on the devnet, the pinned container address in the lab.
    const plan = planWith([action('mn-1', partitionPayload)]);
    const commands = faultApplyCommandsForPlan({
      plan, targetsById: targets, runTag: 'run-1', expiresAtMs: 30_000, nowMs: 0,
    });
    expect(commands).toEqual([
      {
        op: 'apply',
        container: 'mn01',
        kind: 'partition',
        args: ['mn02'],
        runTag: 'run-1',
        expiresAtMs: 30_000,
      },
    ]);
  });

  it('fails closed on a partition naming a peer it cannot resolve', () => {
    // A half-built partition is worse than none: a live root qdisc with a
    // missing filter cuts nothing while looking applied.
    const plan = planWith([
      action('mn-1', { kind: 'partition-apply', p2pPortRef: 'devnet-p2p', peerTargetIds: ['mn-404'], faultLeaseSeconds: 60 }),
    ]);
    expect(() => faultApplyCommandsForPlan({ plan, targetsById: targets, runTag: 'run-1', expiresAtMs: 30_000, nowMs: 0 }))
      .toThrow(InvalidNetemTargetError);
  });

  it('refuses a staged or repeated outage rather than collapsing a schedule into one stop', () => {
    // restart-flapping: a stop at an offset, and a second cycle on the same target.
    const staged = planWith([action('mn-1', stopPayload, 0, 30_000)]);
    expect(() => faultApplyCommandsForPlan({ plan: staged, targetsById: targets, runTag: 'run-1', expiresAtMs: 1_000, nowMs: 0 }))
      .toThrow(UnscheduledLiveFaultError);
    const repeated = planWith([action('mn-1', stopPayload, 0), action('mn-1', stopPayload, 2)]);
    expect(() => faultApplyCommandsForPlan({ plan: repeated, targetsById: targets, runTag: 'run-1', expiresAtMs: 1_000, nowMs: 0 }))
      .toThrow(UnscheduledLiveFaultError);
  });

  it('refuses a lease beyond the wrapper ceiling, so it surfaces before a command is written', () => {
    const plan = planWith([action('mn-1', stopPayload)]);
    expect(() => faultApplyCommandsForPlan({ plan, targetsById: targets, runTag: 'run-1', expiresAtMs: MAX_TTL_MS + 1, nowMs: 0 }))
      .toThrow(/ceiling/);
  });

  it('rejects a target that is unknown, off-network, or lacks the capability', () => {
    const plan = planWith([action('mn-9', netemPayload())]);
    expect(() => faultApplyCommandsForPlan({ plan, targetsById: targets, runTag: 'run-1', expiresAtMs: 1_000, nowMs: 0 })).toThrow(InvalidNetemTargetError);

    const offNet = indexTargetsById([target({ targetId: 'mn-1', network: 'devnet' })]);
    expect(() => faultApplyCommandsForPlan({ plan: planWith([action('mn-1', netemPayload())]), targetsById: offNet, runTag: 'run-1', expiresAtMs: 1_000, nowMs: 0 }))
      .toThrow(/not the lab/);

    const noNetem = indexTargetsById([target({ targetId: 'mn-1', capabilities: ['service-control'] })]);
    expect(() => faultApplyCommandsForPlan({ plan: planWith([action('mn-1', netemPayload())]), targetsById: noNetem, runTag: 'run-1', expiresAtMs: 1_000, nowMs: 0 }))
      .toThrow(/netem-p2p/);

    const noService = indexTargetsById([target({ targetId: 'mn-1', capabilities: ['netem-p2p'] })]);
    expect(() => faultApplyCommandsForPlan({ plan: planWith([action('mn-1', stopPayload)]), targetsById: noService, runTag: 'run-1', expiresAtMs: 1_000, nowMs: 0 }))
      .toThrow(/service-control/);
  });
});

describe('assertSingleFaultClass', () => {
  it('refuses a plan mixing the two classes -- docker start would wipe the qdisc', () => {
    expect(() => assertSingleFaultClass(planWith([action('mn-1', netemPayload()), action('mn-1', stopPayload, 1)])))
      .toThrow(UnsupportedLiveFaultError);
    expect(() => assertSingleFaultClass(planWith([action('mn-1', netemPayload())]))).not.toThrow();
    expect(() => assertSingleFaultClass(planWith([action('mn-1', stopPayload)]))).not.toThrow();
  });
});

describe('faultRecoveryTargetsForPlan', () => {
  const targets = indexTargetsById([target({ targetId: 'mn-1', hostRef: 'mn01' }), target({ targetId: 'mn-2', hostRef: 'mn02' })]);

  it('clears a netem fault by the same job id the apply used', () => {
    const payload = netemPayload();
    const { targets: recovery } = faultRecoveryTargetsForPlan({ plan: planWith([action('mn-1', payload)]), targetsById: targets, runTag: 'run-1' });
    const expectedJobId = netemJobId('run-1', { container: 'mn01', kind: 'netem', args: composeNetemArgs(payload) });
    expect(recovery).toEqual([{ targetId: 'mn-1', container: 'mn01', faultClass: 'netem', clear: { op: 'clear', jobId: expectedJobId } }]);
  });

  it('clears a service fault by the same job id the stop used', () => {
    const { targets: recovery } = faultRecoveryTargetsForPlan({ plan: planWith([action('mn-1', stopPayload)]), targetsById: targets, runTag: 'run-1' });
    expect(recovery).toEqual([
      { targetId: 'mn-1', container: 'mn01', faultClass: 'service', clear: { op: 'clear', jobId: serviceJobId('run-1', 'mn01') } },
    ]);
  });

  it('deduplicates identical faults and counts what it cannot speak for', () => {
    const plan = planWith([
      action('mn-1', netemPayload()),
      action('mn-1', netemPayload(), 1), // identical -> one clear
      action('mn-404', netemPayload(), 2), // unknown target -> counted, not thrown
    ]);
    const { targets: recovery, skipped } = faultRecoveryTargetsForPlan({ plan, targetsById: targets, runTag: 'run-1' });
    expect(recovery).toHaveLength(1);
    expect(recovery[0]!.targetId).toBe('mn-1');
    expect(skipped).toBe(1);
  });

  it('clears a partition, which it previously could only count', () => {
    // A partition owns the same root qdisc a netem does, so the same clear
    // undoes it -- and until it could be applied at all, recovery had nothing to
    // undo and said so.
    const plan = planWith([action('mn-2', partitionPayload)]);
    const { targets: recovery, skipped } = faultRecoveryTargetsForPlan({ plan, targetsById: targets, runTag: 'run-1' });
    expect(recovery).toHaveLength(1);
    expect(recovery[0]!.targetId).toBe('mn-2');
    expect(recovery[0]!.faultClass).toBe('netem');
    expect(skipped).toBe(0);
  });

  it('never throws where apply would, so recovery cannot strand a run mid-teardown', () => {
    const plan = planWith([action('mn-9', netemPayload()), action('mn-9', stopPayload, 1, 30_000)]);
    const { targets: recovery, skipped } = faultRecoveryTargetsForPlan({ plan, targetsById: targets, runTag: 'run-1' });
    expect(recovery).toEqual([]);
    expect(skipped).toBe(2); // an unknown target twice: immediate and scheduled
  });

  it('clears a target whose only outage is a scheduled one', () => {
    // It would otherwise be missing here, and recovery would report all-clear
    // over a node the dispatcher had stopped. Its clear is the same job id, so
    // adding it is exact rather than approximate.
    const plan = planWith([action('mn-1', stopPayload, 0, 30_000)]);
    const { targets: recovery, skipped } = faultRecoveryTargetsForPlan({ plan, targetsById: targets, runTag: 'run-1' });
    expect(recovery).toEqual([
      {
        targetId: 'mn-1',
        container: 'mn01',
        faultClass: 'service',
        clear: { op: 'clear', jobId: serviceJobId('run-1', 'mn01') },
      },
    ]);
    expect(skipped).toBe(0);
  });
});

describe('scheduledLabActionsForPlan', () => {
  const targets = indexTargetsById([target(), target({ targetId: 'mn-2', hostRef: 'mn02' })]);
  const startPayload: PlannedActionPayload = { kind: 'service-start' };

  it('returns nothing for a plan whose actions are all immediate', () => {
    const plan = { actions: [action('mn-1', stopPayload, 0, 0)] } as DryRunPlan;
    expect(scheduledLabActionsForPlan({ plan, targetsById: targets, runTag: 'run-1', expiresAtMs: 30_000 }).actions).toEqual([]);
  });

  it('turns a flapping cycle into stops and the clears that restart them', () => {
    // A restart mid-run IS clearing the stop: the wrapper's undo for a service
    // job is `docker start`, so a cycle and the recovery teardown travel the
    // same path and cannot diverge.
    const plan = {
      actions: [
        action('mn-1', stopPayload, 0, 0),
        action('mn-1', startPayload, 1, 10_000),
        action('mn-1', stopPayload, 2, 20_000),
        action('mn-1', startPayload, 3, 30_000),
      ],
    } as DryRunPlan;
    const { actions: scheduled } = scheduledLabActionsForPlan({
      plan, targetsById: targets, runTag: 'run-1', expiresAtMs: 60_000,
    });
    expect(scheduled.map((entry) => [entry.notBeforeOffsetMs, entry.command.op])).toEqual([
      [10_000, 'clear'],
      [20_000, 'service-stop'],
      [30_000, 'clear'],
    ]);
    expect(scheduled[0]!.command).toEqual({ op: 'clear', jobId: serviceJobId('run-1', 'mn01') });
    expect(scheduled[1]!.command).toEqual({
      op: 'service-stop', container: 'mn01', runTag: 'run-1', expiresAtMs: 60_000,
    });
  });

  it('orders by offset so a dispatcher can walk them forwards', () => {
    const plan = {
      actions: [
        action('mn-2', stopPayload, 1, 30_000),
        action('mn-1', stopPayload, 0, 10_000),
      ],
    } as DryRunPlan;
    const { actions: scheduled } = scheduledLabActionsForPlan({
      plan, targetsById: targets, runTag: 'run-1', expiresAtMs: 60_000,
    });
    expect(scheduled.map((entry) => entry.notBeforeOffsetMs)).toEqual([10_000, 30_000]);
  });

  it('refuses a scheduled fault it cannot express, rather than dropping it', () => {
    // A fault-clear carries no impairment, so its job id can only come from the
    // matching apply. Pairing those across a schedule is a design, not a lookup.
    const plan = {
      actions: [action('mn-1', { kind: 'fault-clear', scope: 'run' }, 0, 10_000)],
    } as DryRunPlan;
    expect(() =>
      scheduledLabActionsForPlan({ plan, targetsById: targets, runTag: 'run-1', expiresAtMs: 60_000 })
    ).toThrow(UnsupportedLiveFaultError);
  });

  it('holds a scheduled action to the same target rules as an immediate one', () => {
    // Otherwise a schedule would be a way around the checks the immediate path
    // makes: a fault landing later must not reach a host it could not reach now.
    const plan = { actions: [action('mn-9', stopPayload, 0, 10_000)] } as DryRunPlan;
    expect(() =>
      scheduledLabActionsForPlan({ plan, targetsById: targets, runTag: 'run-1', expiresAtMs: 60_000 })
    ).toThrow(InvalidNetemTargetError);
  });
});
