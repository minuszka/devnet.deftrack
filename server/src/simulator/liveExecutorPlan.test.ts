import { describe, expect, it } from 'vitest';
import {
  InvalidNetemTargetError,
  UnsupportedLiveFaultError,
  composeNetemArgs,
  indexTargetsById,
  netemApplyCommandsForPlan,
  netemRecoveryTargetsForPlan,
} from './liveExecutorPlan.js';
import { netemJobId, tcApplyArgs } from './netemLease.js';
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
    capabilities: ['netem-p2p'],
    expectedBuild: null,
    capturedAtMs: 0,
    capturedAtHeight: 0,
    ...overrides,
  };
}

function action(targetId: string, payload: PlannedActionPayload, sequence = 0): PlannedSimulationAction {
  return {
    actionId: `${targetId}:${sequence}`,
    runKey: 'run-1',
    sequence,
    targetId,
    kind: payload.kind,
    payload,
    payloadDigest: 'digest',
    notBeforeOffsetMs: 0,
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

describe('netemApplyCommandsForPlan', () => {
  const targets = indexTargetsById([target({ targetId: 'mn-1', hostRef: 'mn01' }), target({ targetId: 'mn-2', hostRef: 'mn02' })]);

  it('turns each netem-apply into a composed apply and skips the scheduled clear', () => {
    const plan = planWith([
      action('mn-1', netemPayload()),
      action('mn-1', { kind: 'fault-clear', scope: 'run' }, 1),
      action('mn-2', netemPayload({ latencyMs: 50, jitterMs: 0, lossPercent: 0, correlationPercent: 0 }), 2),
    ]);
    const commands = netemApplyCommandsForPlan({ plan, targetsById: targets, runTag: 'run-1', ttlMs: 30_000 });
    expect(commands).toEqual([
      { op: 'apply', container: 'mn01', kind: 'netem', args: ['delay', '100ms', '20ms', 'loss', '5%', '25%'], runTag: 'run-1', ttlMs: 30_000 },
      { op: 'apply', container: 'mn02', kind: 'netem', args: ['delay', '50ms'], runTag: 'run-1', ttlMs: 30_000 },
    ]);
  });

  it('returns nothing for a clear-only plan rather than throwing', () => {
    const plan = planWith([action('mn-1', { kind: 'fault-clear', scope: 'run' })]);
    expect(netemApplyCommandsForPlan({ plan, targetsById: targets, runTag: 'run-1', ttlMs: 1_000 })).toEqual([]);
  });

  it('fails closed on a fault kind it cannot apply', () => {
    const plan = planWith([action('mn-1', { kind: 'service-stop', faultLeaseSeconds: 60 })]);
    expect(() => netemApplyCommandsForPlan({ plan, targetsById: targets, runTag: 'run-1', ttlMs: 1_000 }))
      .toThrow(UnsupportedLiveFaultError);
    const partition = planWith([action('mn-1', { kind: 'partition-apply', p2pPortRef: 'devnet-p2p', peerTargetIds: ['mn-2'], faultLeaseSeconds: 60 })]);
    expect(() => netemApplyCommandsForPlan({ plan: partition, targetsById: targets, runTag: 'run-1', ttlMs: 1_000 }))
      .toThrow(/partition-apply/);
  });

  it('rejects a target that is unknown, off-network, or lacks the capability', () => {
    const plan = planWith([action('mn-9', netemPayload())]);
    expect(() => netemApplyCommandsForPlan({ plan, targetsById: targets, runTag: 'run-1', ttlMs: 1_000 })).toThrow(InvalidNetemTargetError);

    const offNet = indexTargetsById([target({ targetId: 'mn-1', network: 'devnet' })]);
    expect(() => netemApplyCommandsForPlan({ plan: planWith([action('mn-1', netemPayload())]), targetsById: offNet, runTag: 'run-1', ttlMs: 1_000 }))
      .toThrow(/not the lab/);

    const noCap = indexTargetsById([target({ targetId: 'mn-1', capabilities: ['service-control'] })]);
    expect(() => netemApplyCommandsForPlan({ plan: planWith([action('mn-1', netemPayload())]), targetsById: noCap, runTag: 'run-1', ttlMs: 1_000 }))
      .toThrow(/netem-p2p/);
  });
});

describe('netemRecoveryTargetsForPlan', () => {
  const targets = indexTargetsById([target({ targetId: 'mn-1', hostRef: 'mn01' }), target({ targetId: 'mn-2', hostRef: 'mn02' })]);

  it('clears each faulted target by the same job id the apply used', () => {
    const payload = netemPayload();
    const plan = planWith([action('mn-1', payload)]);
    const [recovery] = netemRecoveryTargetsForPlan({ plan, targetsById: targets, runTag: 'run-1' });
    const expectedJobId = netemJobId('run-1', { container: 'mn01', kind: 'netem', args: composeNetemArgs(payload) });
    expect(recovery).toEqual({ targetId: 'mn-1', container: 'mn01', clear: { op: 'clear', jobId: expectedJobId } });
  });

  it('deduplicates identical faults and stays lenient on kinds it never applied', () => {
    const plan = planWith([
      action('mn-1', netemPayload()),
      action('mn-1', netemPayload(), 1), // identical -> one clear
      action('mn-2', { kind: 'service-stop', faultLeaseSeconds: 60 }, 2), // never applied -> skipped, not thrown
    ]);
    const recovery = netemRecoveryTargetsForPlan({ plan, targetsById: targets, runTag: 'run-1' });
    expect(recovery).toHaveLength(1);
    expect(recovery[0]!.targetId).toBe('mn-1');
  });
});
