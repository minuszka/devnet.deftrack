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
    // Q60's own numbers, declared rather than assumed. Pinned as literals they
    // made every lab preview -- whose profile is 3/2/2 -- report a margin for a
    // network that was not there.
    quorumThresholds: { dkg: 44, chainLock: 41 },
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

  it('never takes the seed down with a host outage', () => {
    // The seed is where the explorer's own RPC and ZMQ evidence comes from.
    // Stopping it stops the measurement rather than the network under test, and
    // a host outage is about the masternodes on the host, not about silencing
    // the observer that would have recorded it.
    const ctx = context();
    const seed = ctx.targets.find((item) => item.role === 'seed')!;
    const shared = ctx.targets.map((item) =>
      item.targetId === seed.targetId ? { ...item, hostRef: 'host-0' } : item
    );
    const plan = generateDryRunPlan(
      request({
        scenarioId: 'host-outage', scenarioVersion: 1, seed: 'blast',
        parameters: { anchorTargetId: 'mn-00', durationSeconds: 300 },
      }),
      { ...ctx, targets: shared }
    );

    expect(plan.actions.map((action) => action.targetId)).not.toContain(seed.targetId);
    expect(plan.actions.length).toBeGreaterThan(0);
  });

  it('refuses to degrade the seed at all', () => {
    expect(() =>
      generateDryRunPlan(
        request({
          scenarioId: 'network-degradation', scenarioVersion: 1, seed: 'blast',
          parameters: {
            role: 'seed', count: 1, durationSeconds: 300,
            latencyMs: 100, jitterMs: 0, lossPercent: 0, correlationPercent: 0,
          },
        }),
        context()
      )
    ).toThrow();
  });

  it('will not flap more stakers than the staker limit allows', () => {
    // Block production rests on those daemons; flapping ten of them is a
    // different experiment from flapping ten masternodes, and the schema said
    // ten while the staker limit said five.
    // Eight stakers registered, so a shortage cannot be what refuses this --
    // only the limit can.
    const ctx = context();
    const extra = Array.from({ length: 3 }, (_, index) =>
      target(`staker-x${index}`, 'staker', `staker-host-x${index}`)
    );
    const roomy = { ...ctx, targets: [...ctx.targets, ...extra] };
    const flap = (count: number) =>
      generateDryRunPlan(
        request({
          scenarioId: 'restart-flapping', scenarioVersion: 1, seed: 'blast',
          parameters: { role: 'staker', count, cycles: 1, downSeconds: 10, upSeconds: 10 },
        }),
        roomy
      );

    expect(() => flap(5)).not.toThrow();
    expect(() => flap(6)).toThrow(/stakers/);
  });

  it('reports unknown margins rather than assuming a profile it was not given', () => {
    // The thresholds used to be literal 44 and 41. On the lab, whose profile is
    // 3/2/2 or whatever -llmqtestparams sets, that measured a devnet that was
    // not there: the margin was always negative and every report came back
    // degraded whatever the fault actually did. Unknown must read as unknown.
    const ctx = { ...context(), quorumThresholds: { dkg: null, chainLock: null } };
    const plan = generateDryRunPlan(request(scenarioRequestFromPreset('dkg-minus-17', 'threshold')), ctx);

    expect(plan.impact.dkgThreshold).toBeNull();
    expect(plan.impact.chainLockThreshold).toBeNull();
    expect(plan.impact.dkgMarginAfterFault).toBeNull();
    expect(plan.impact.chainLockMarginAfterFault).toBeNull();
    expect(plan.impact.warnings).toContain(
      'Quorum thresholds for the active profile are unknown; margins are not computed.'
    );
  });

  it('uses the thresholds of the profile in force, not Q60 by default', () => {
    // A lab profile: threshold 2 of 3. A fault leaving 43 of 60 is far below
    // Q60's 44 and comfortably above this one.
    const ctx = { ...context(), quorumThresholds: { dkg: 2, chainLock: 2 } };
    const plan = generateDryRunPlan(request(scenarioRequestFromPreset('dkg-minus-17', 'threshold')), ctx);

    expect(plan.impact.dkgThreshold).toBe(2);
    expect(plan.impact.dkgMarginAfterFault).toBeGreaterThan(0);
    expect(plan.impact.warnings.join(' ')).not.toContain('falls below the DKG threshold');
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
    expect(dkg17.impact.warnings).toContain('Planned fault falls below the DKG threshold (44).');
    expect(cl20.impact.warnings).toContain('Planned fault falls below the ChainLock threshold (41).');
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
