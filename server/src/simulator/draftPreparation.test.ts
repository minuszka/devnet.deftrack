import { describe, expect, it } from 'vitest';
import type { SimulationTargetRegistryRecord } from './targetResolver.js';
import { prepareSimulationDraft } from './draftPreparation.js';

const NOW = 1_000_000;
const HEIGHT = 6_240;
const BUILD = 'a'.repeat(64);

function registry(): SimulationTargetRegistryRecord[] {
  return Array.from({ length: 20 }, (_, index) => ({
    targetId: `mn-${index}`,
    displayLabel: `MN ${index}`,
    operatorId: `operator-${index}`,
    proTxHash: String(index).padStart(64, '0'),
    hostRef: `host-${Math.floor(index / 10)}`,
    unitRef: `unit-${index}`,
    p2pPort: 19_800 + index,
    role: 'masternode' as const,
    network: 'devnet' as const,
    capabilities: ['service-control' as const, 'partition-p2p' as const],
    expectedBuild: BUILD,
    labels: [],
    enabled: true,
    maintenance: false,
  }));
}

function validInput() {
  const targets = registry();
  return {
    idempotencyKey: 'prepare-1',
    network: 'devnet' as const,
    scenario: {
      scenarioId: 'mn-stop', scenarioVersion: 1, seed: 'seed',
      parameters: { count: 2, durationSeconds: 30 },
    },
    currentHeight: HEIGHT,
    nowMs: NOW,
    registry: targets,
    masternodes: targets.map((target) => ({ proTxHash: target.proTxHash!, active: true, hostRef: target.hostRef })),
    hosts: ['host-0', 'host-1'].map((hostRef) => ({
      hostRef, nodeBuild: BUILD, height: HEIGHT, reportedAtMs: NOW - 1_000,
    })),
    currentQuorumMemberProTxHashes: targets.map((target) => target.proTxHash!),
    requestedBy: { actorId: 'admin-1', actorType: 'admin-session' as const, displayName: 'Admin' },
  };
}

describe('simulation draft preparation', () => {
  it('freezes the complete deterministic population and produces a DryRun without writes', () => {
    const input = validInput();
    const before = JSON.stringify(input);
    const prepared = prepareSimulationDraft(input);
    expect(prepared.metadata.targetSnapshot).toHaveLength(20);
    expect(prepared.dryRunPlan.selectedTargetIds).toHaveLength(2);
    expect(prepared.metadata.scenarioId).toBe('mn-stop');
    expect(prepared.metadata.parameters).toEqual(prepared.dryRunPlan.parameters);
    expect(JSON.stringify(input)).toBe(before);
    expect(prepareSimulationDraft(input).dryRunPlan.planFingerprint).toBe(prepared.dryRunPlan.planFingerprint);
  });

  it('refuses to prepare a draft from incomplete build evidence', () => {
    const input = validInput();
    input.hosts[0]!.nodeBuild = 'b'.repeat(64);
    expect(() => prepareSimulationDraft(input)).toThrow(/NODE_BUILD_MISMATCH/);
  });

  it('refuses an unmapped or duplicated current quorum member', () => {
    const input = validInput();
    input.currentQuorumMemberProTxHashes[0] = 'f'.repeat(64);
    expect(() => prepareSimulationDraft(input)).toThrow(/no unambiguous target mapping/);
    const duplicate = validInput();
    duplicate.currentQuorumMemberProTxHashes[1] = duplicate.currentQuorumMemberProTxHashes[0]!;
    expect(() => prepareSimulationDraft(duplicate)).toThrow(/duplicates/);
  });

  it('preserves all partition peers in the immutable snapshot', () => {
    const input = validInput();
    input.scenario = {
      scenarioId: 'node-isolation', scenarioVersion: 1, seed: 'seed',
      parameters: { count: 2, durationSeconds: 30 },
    };
    const prepared = prepareSimulationDraft(input);
    const partition = prepared.dryRunPlan.actions.find((action) => action.kind === 'partition-apply');
    expect(partition?.payload).toMatchObject({ kind: 'partition-apply' });
    const peers = (partition?.payload as { peerTargetIds: string[] }).peerTargetIds;
    const snapshotted = new Set(prepared.metadata.targetSnapshot.map((target) => target.targetId));
    expect(peers.every((targetId) => snapshotted.has(targetId))).toBe(true);
  });

  it('freezes an identified quorum mapping independently of observer member order', () => {
    const input = validInput();
    const members = input.currentQuorumMemberProTxHashes.slice(0, 3);
    const currentQuorum = {
      llmqType: 100, llmqName: 'llmq_test', quorumHash: 'f'.repeat(64),
      expectedHeight: HEIGHT - 24, quorumIndex: 0, capturedAtHeight: HEIGHT,
      memberProTxHashes: members,
    };
    const first = { ...input, currentQuorum, nextQuorumUnavailableReason: 'The next quorum has not formed.' };
    const second = { ...first, currentQuorum: { ...currentQuorum, memberProTxHashes: [...members].reverse() } };

    const prepared = prepareSimulationDraft(first);
    const independentlyPrepared = prepareSimulationDraft(second);
    expect(prepared.metadata.quorumTargetSnapshot?.current?.memberTargetIds).toEqual(['mn-0', 'mn-1', 'mn-2']);
    expect(prepared.metadata.quorumTargetSnapshot?.current?.resolutionFingerprint)
      .toBe(independentlyPrepared.metadata.quorumTargetSnapshot?.current?.resolutionFingerprint);
    expect(prepared.metadata.quorumTargetSnapshot?.nextUnavailableReason).toMatch(/not formed/);
  });
});

describe('inventory failure reporting', () => {
  it('names the targets behind each code, so one retired entry is not read as a fault in the others', () => {
    // A single unusable target blocks every run, including runs that never
    // reference it. Without the names the operator sees only a code and inspects
    // the targets they did ask for.
    const targets = registry();
    const retired = { ...targets[0]!, targetId: 'retired', hostRef: 'gone' };
    expect(() =>
      prepareSimulationDraft({ ...validInput(), registry: [...targets.slice(1), retired] })
    ).toThrow(/MISSING_HOST_OBSERVATION\(retired\)/);
  });
});
