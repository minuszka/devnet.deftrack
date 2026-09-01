import { describe, expect, it } from 'vitest';
import { simulationRunKeyFor } from '../domain/simulationIdentity.js';
import type { SimulationTargetCapability, SimulationTargetSnapshot } from '../models/SimulationRun.js';
import { scenarioRequestFromPreset } from './scenarioRegistry.js';
import { generateDryRunPlan } from './dryRunExecutor.js';

const ALL_CAPABILITIES: SimulationTargetCapability[] = [
  'service-control', 'netem-p2p', 'partition-p2p', 'dsl-test-hook',
];

function target(
  targetId: string,
  role: SimulationTargetSnapshot['role'],
  hostRef: string,
  capabilities = ALL_CAPABILITIES
): SimulationTargetSnapshot {
  return {
    targetId,
    displayLabel: targetId,
    operatorId: role === 'masternode' ? `operator-${targetId}` : null,
    proTxHash: role === 'masternode' ? targetId.padEnd(64, '0') : null,
    hostRef,
    unitRef: `unit-${targetId}`,
    p2pPort: 19_799,
    role,
    network: 'devnet',
    capabilities: [...capabilities],
    expectedBuild: 'test-build',
    capturedAtMs: 1_000,
    capturedAtHeight: 6_240,
  };
}

function context() {
  const masternodes = Array.from({ length: 60 }, (_, index) =>
    target(`mn-${String(index).padStart(2, '0')}`, 'masternode', `host-${Math.floor(index / 10)}`)
  );
  const stakers = Array.from({ length: 5 }, (_, index) => target(`staker-${index}`, 'staker', `staker-host-${index}`));
  const seed = target('seed-0', 'seed', 'seed-host');
  return {
    network: 'devnet' as const,
    currentHeight: 6_240,
    targets: [...masternodes, ...stakers, seed],
    quorumMemberTargetIds: masternodes.map((item) => item.targetId),
  };
}

const runKey = simulationRunKeyFor('day-4-dry-run');

function request(scenario: unknown) {
  return { runKey, network: 'devnet', scenario };
}

function scenario(scenarioId: string, parameters: Record<string, unknown>, seed = 'dry-seed') {
  return { scenarioId, scenarioVersion: 1, seed, parameters };
}

describe('pure DryRun executor', () => {
  it.each([
    scenario('mn-stop', { count: 2, durationSeconds: 30 }),
    scenario('host-outage', { anchorTargetId: 'mn-00', durationSeconds: 30, expectedMasternodes: 10 }),
    scenario('quorum-member-outage', { count: 2, phase: 'dkg', durationSeconds: 30 }),
    scenario('staker-stop', { count: 2, durationSeconds: 30 }),
    scenario('restart-flapping', { role: 'masternode', count: 2, cycles: 2, downSeconds: 5, upSeconds: 5 }),
    scenario('network-degradation', { role: 'masternode', count: 2, durationSeconds: 30, latencyMs: 100, jitterMs: 20, lossPercent: 2, correlationPercent: 0 }),
    scenario('node-isolation', { count: 2, durationSeconds: 30 }),
    scenario('clear-recover', { targetIds: ['mn-00', 'staker-0'] }),
  ])('generates an allowlisted plan for $scenarioId', (scenarioInput) => {
    const plan = generateDryRunPlan(request(scenarioInput), context());
    expect(plan.mode).toBe('dry-run');
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions.map((item) => item.sequence)).toEqual(
      Array.from({ length: plan.actions.length }, (_, index) => index)
    );
    expect(plan.assurances).toEqual([
      'NO_DATABASE_WRITE', 'NO_RPC_CALL', 'NO_REMOTE_ACTION', 'NO_FAULT_APPLIED',
    ]);
    for (const action of plan.actions) {
      expect(action.actionId).toMatch(/^act_[0-9a-f]{40}$/);
      expect(action.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(action.expiresAfterMs).toBeGreaterThan(action.notBeforeOffsetMs);
    }
  });

  it('is byte-stable for the same inputs and does not mutate them', () => {
    const contextInput = context();
    const requestInput = request(scenario('mn-stop', { count: 3, durationSeconds: 30 }));
    const beforeContext = JSON.stringify(contextInput);
    const beforeRequest = JSON.stringify(requestInput);
    const first = generateDryRunPlan(requestInput, contextInput);
    const second = generateDryRunPlan(requestInput, {
      ...contextInput,
      targets: [...contextInput.targets].reverse(),
    });
    expect(JSON.stringify(generateDryRunPlan(requestInput, contextInput))).toBe(JSON.stringify(first));
    expect(second.selectedTargetIds).toEqual(first.selectedTargetIds);
    expect(second.planFingerprint).toBe(first.planFingerprint);
    expect(JSON.stringify(contextInput)).toBe(beforeContext);
    expect(JSON.stringify(requestInput)).toBe(beforeRequest);
  });

  it('shows the exact Q60 DKG and ChainLock threshold edges', () => {
    const ctx = context();
    const dkg16 = generateDryRunPlan(
      request(scenarioRequestFromPreset('dkg-minus-16', 'threshold')),
      ctx
    );
    const dkg17 = generateDryRunPlan(
      request(scenarioRequestFromPreset('dkg-minus-17', 'threshold')),
      ctx
    );
    const cl19 = generateDryRunPlan(
      request(scenarioRequestFromPreset('chainlock-minus-19', 'threshold')),
      ctx
    );
    const cl20 = generateDryRunPlan(
      request(scenarioRequestFromPreset('chainlock-minus-20', 'threshold')),
      ctx
    );
    expect(dkg16.impact.dkgMarginAfterFault).toBe(0);
    expect(dkg17.impact.dkgMarginAfterFault).toBe(-1);
    expect(cl19.impact.chainLockMarginAfterFault).toBe(0);
    expect(cl20.impact.chainLockMarginAfterFault).toBe(-1);
    expect(dkg17.impact.warnings).toContain('Planned fault falls below the Q60 DKG threshold (44).');
    expect(cl20.impact.warnings).toContain('Planned fault falls below the Q60 ChainLock threshold (41).');
  });

  it('requires the host preset to still resolve to exactly ten masternodes', () => {
    const ctx = context();
    const preset = scenarioRequestFromPreset('host-10-masternodes', 'host', { anchorTargetId: 'mn-00' });
    const plan = generateDryRunPlan(request(preset), ctx);
    expect(plan.selectedTargetIds).toHaveLength(10);
    ctx.targets[9]!.hostRef = 'moved-host';
    expect(() => generateDryRunPlan(request(preset), ctx)).toThrow(/count changed/);
  });

  it('does not leak command, path, host or service-unit values into action payloads', () => {
    const plan = generateDryRunPlan(
      request(scenario('host-outage', { anchorTargetId: 'mn-00', durationSeconds: 30 })),
      context()
    );
    const serializedPayloads = JSON.stringify(plan.actions.map((item) => item.payload));
    expect(serializedPayloads).not.toMatch(/hostRef|unitRef|command|script|\/|\\/i);
    expect(serializedPayloads).not.toContain('host-0');
    expect(serializedPayloads).not.toContain('unit-mn');
  });

  it('rejects mainnet, cross-network, duplicate and capability-ineligible inputs', () => {
    const ctx = context();
    expect(() => generateDryRunPlan({ runKey, network: 'mainnet', scenario: scenario('mn-stop', { count: 1, durationSeconds: 30 }) }, ctx)).toThrow();
    expect(() => generateDryRunPlan(request(scenario('mn-stop', { count: 1, durationSeconds: 30 })), { ...ctx, network: 'regtest' })).toThrow(/network mismatch/);
    expect(() => generateDryRunPlan(request(scenario('mn-stop', { count: 1, durationSeconds: 30 })), { ...ctx, targets: [...ctx.targets, ctx.targets[0]!] })).toThrow(/duplicate targetId/);
    const noControl = { ...ctx.targets[0]!, capabilities: ['netem-p2p' as const] };
    expect(() => generateDryRunPlan(
      request(scenario('mn-stop', { count: 1, durationSeconds: 30, targetIds: [noControl.targetId] })),
      { ...ctx, targets: [noControl, ...ctx.targets.slice(1)] }
    )).toThrow(/not eligible/);
  });

  it('links Core-native evidence without presenting staker recovery as modeled', () => {
    const networkPlan = generateDryRunPlan(
      request(scenario('network-degradation', { role: 'masternode', count: 1, durationSeconds: 30, latencyMs: 100, jitterMs: 10, lossPercent: 0, correlationPercent: 0 })),
      context()
    );
    expect(networkPlan.coreSimulator.scenarioFamilies).toEqual(['delayed_dkg_messages']);
    expect(networkPlan.coreSimulator.repository).toBe('https://github.com/minuszka/defcon-chainlock-pose-simulator');
    const stakerPlan = generateDryRunPlan(
      request(scenario('staker-stop', { count: 1, durationSeconds: 30 })),
      context()
    );
    expect(stakerPlan.coreSimulator.status).toBe('not-modeled');
    expect(stakerPlan.coreSimulator.artifacts).toEqual([]);
  });
});
