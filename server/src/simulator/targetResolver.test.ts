import { describe, expect, it } from 'vitest';
import type { SimulationTargetRegistryRecord, TargetHostEvidence, TargetMasternodeEvidence } from './targetResolver.js';
import { resolveSimulationTargetInventory, selectResolvedSimulationTargets } from './targetResolver.js';

const BUILD = 'a'.repeat(64);
const NOW = 1_000_000;
const HEIGHT = 6_240;

function registryTarget(index: number, overrides: Partial<SimulationTargetRegistryRecord> = {}): SimulationTargetRegistryRecord {
  const id = `mn-${index}`;
  return {
    targetId: id,
    displayLabel: `MN ${index}`,
    operatorId: `operator-${index % 2}`,
    proTxHash: String(index).padStart(64, '0'),
    hostRef: `host-${Math.floor(index / 2)}`,
    unitRef: `defcond-${index}`,
    p2pPort: 19_800 + index,
    role: 'masternode',
    network: 'devnet',
    capabilities: ['service-control', 'netem-p2p', 'partition-p2p'],
    expectedBuild: BUILD,
    labels: [],
    enabled: true,
    maintenance: false,
    ...overrides,
  };
}

function evidence(registry: readonly SimulationTargetRegistryRecord[]): {
  masternodes: TargetMasternodeEvidence[];
  hosts: TargetHostEvidence[];
} {
  return {
    masternodes: registry
      .filter((target) => target.role === 'masternode' && target.proTxHash !== null)
      .map((target) => ({ proTxHash: target.proTxHash!, active: true, hostRef: target.hostRef })),
    hosts: [...new Set(registry.map((target) => target.hostRef))].map((hostRef) => ({
      hostRef,
      nodeBuild: BUILD,
      height: HEIGHT,
      reportedAtMs: NOW - 1_000,
    })),
  };
}

function resolve(registry: SimulationTargetRegistryRecord[]) {
  const runtime = evidence(registry);
  return resolveSimulationTargetInventory({
    network: 'devnet', currentHeight: HEIGHT, nowMs: NOW, registry, ...runtime,
  });
}

describe('private simulation target resolution', () => {
  it('creates a complete immutable snapshot only from enabled, non-maintenance devnet targets', () => {
    const registry = [
      registryTarget(0),
      registryTarget(1),
      registryTarget(2, { enabled: false }),
      registryTarget(3, { maintenance: true }),
      registryTarget(4, { network: 'regtest' }),
    ];
    const result = resolve(registry);
    expect(result.complete).toBe(true);
    expect(result.snapshots.map((target) => target.targetId)).toEqual(['mn-0', 'mn-1']);
    expect(result.snapshots[0]).toMatchObject({ capturedAtMs: NOW, capturedAtHeight: HEIGHT, expectedBuild: BUILD });
  });

  it('fails closed on ambiguous identity, unit and port mappings', () => {
    const first = registryTarget(0);
    const second = registryTarget(1, {
      proTxHash: first.proTxHash,
      hostRef: first.hostRef,
      unitRef: first.unitRef,
      p2pPort: first.p2pPort,
    });
    const result = resolve([first, second]);
    expect(result.complete).toBe(false);
    expect(result.snapshots).toEqual([]);
    expect(new Set(result.issues.map((item) => item.code))).toEqual(
      new Set([
        'DUPLICATE_PROTX_MAPPING',
        'DUPLICATE_MASTERNODE_EVIDENCE',
        'DUPLICATE_UNIT_MAPPING',
        'DUPLICATE_PORT_MAPPING',
      ])
    );
  });

  it('does not call a host stale for reporting AFTER the reference instant', () => {
    // The reference instant is the control request's frozen acceptedAtMs, returned
    // unchanged on every replay. A retry therefore sees every host reporting "in
    // the future" -- and reading a negative age as stale is what burned the run
    // into terminal `rejected`, with a private detail blaming the fleet for a
    // clock the server had frozen itself.
    const registry = [registryTarget(0)];
    const runtime = evidence(registry);
    runtime.hosts.find((host) => host.hostRef === 'host-0')!.reportedAtMs = NOW + 90_000;
    const result = resolveSimulationTargetInventory({
      network: 'devnet', currentHeight: HEIGHT, nowMs: NOW, registry, ...runtime,
    });
    expect(result.issues.map((item) => item.code)).not.toContain('STALE_HOST_OBSERVATION');
    expect(result.complete).toBe(true);
  });

  it('still calls a host stale when its telemetry is genuinely too old', () => {
    const registry = [registryTarget(0)];
    const runtime = evidence(registry);
    runtime.hosts.find((host) => host.hostRef === 'host-0')!.reportedAtMs = NOW - 999_999;
    const result = resolveSimulationTargetInventory({
      network: 'devnet', currentHeight: HEIGHT, nowMs: NOW, registry, ...runtime,
    });
    expect(result.issues.map((item) => item.code)).toContain('STALE_HOST_OBSERVATION');
  });

  it('rejects missing/inactive masternodes, stale host telemetry and build drift', () => {
    const registry = [registryTarget(0), registryTarget(1), registryTarget(2)];
    const runtime = evidence(registry);
    runtime.masternodes[0]!.active = false;
    runtime.hosts.find((host) => host.hostRef === 'host-0')!.reportedAtMs = NOW - 999_999;
    runtime.hosts.find((host) => host.hostRef === 'host-1')!.nodeBuild = 'b'.repeat(64);
    const result = resolveSimulationTargetInventory({
      network: 'devnet', currentHeight: HEIGHT, nowMs: NOW, registry, ...runtime,
    });
    expect(result.complete).toBe(false);
    expect(result.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining(['MASTERNODE_NOT_ACTIVE', 'STALE_HOST_OBSERVATION', 'NODE_BUILD_MISMATCH'])
    );
  });

  it('treats an unidentified observed masternode host as an arm-blocking ambiguity', () => {
    const registry = [registryTarget(0)];
    const runtime = evidence(registry);
    runtime.masternodes[0]!.hostRef = null;
    const result = resolveSimulationTargetInventory({
      network: 'devnet', currentHeight: HEIGHT, nowMs: NOW, registry, ...runtime,
    });
    expect(result.complete).toBe(false);
    expect(result.snapshots).toEqual([]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MASTERNODE_HOST_UNRESOLVED', targetId: 'mn-0' }),
    ]));
  });

  it('supports deterministic random, host, operator and current-quorum selectors', () => {
    const inventory = resolve(Array.from({ length: 8 }, (_, index) => registryTarget(index)));
    const random = selectResolvedSimulationTargets(inventory, {
      mode: 'random', role: 'masternode', capability: 'service-control', count: 3, seed: 'same',
    });
    expect(selectResolvedSimulationTargets(inventory, {
      mode: 'random', role: 'masternode', capability: 'service-control', count: 3, seed: 'same',
    }).map((item) => item.targetId)).toEqual(random.map((item) => item.targetId));

    expect(selectResolvedSimulationTargets(inventory, {
      mode: 'host', anchorTargetId: 'mn-0', capability: 'service-control',
    }).map((item) => item.targetId)).toEqual(['mn-0', 'mn-1']);
    expect(selectResolvedSimulationTargets(inventory, {
      mode: 'operator', operatorId: 'operator-0', capability: 'service-control',
    }).map((item) => item.targetId)).toEqual(['mn-0', 'mn-2', 'mn-4', 'mn-6']);
    const quorumHashes = inventory.snapshots.slice(0, 4).map((item) => item.proTxHash!);
    const quorum = selectResolvedSimulationTargets(inventory, {
      mode: 'quorum', quorumMemberProTxHashes: quorumHashes,
      capability: 'service-control', count: 2, seed: 'q',
    });
    expect(quorum).toHaveLength(2);
    expect(quorum.every((item) => quorumHashes.includes(item.proTxHash!))).toBe(true);
  });

  it('will not select from an incomplete inventory', () => {
    const registry = [registryTarget(0, { expectedBuild: null })];
    const inventory = resolve(registry);
    expect(inventory.complete).toBe(false);
    expect(() => selectResolvedSimulationTargets(inventory, {
      mode: 'random', role: 'masternode', capability: 'service-control', count: 1, seed: 'x',
    })).toThrow(/incomplete/);
  });
});
