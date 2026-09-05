import { describe, expect, it } from 'vitest';
import {
  parseFleetInventoryManifest,
  previewFleetInventoryImport,
} from './fleetInventoryManifest.js';
import { simulationTargetRegistrationSchema } from './targetRegistration.js';

const HASH = (value: string) => value.padStart(64, '0');

function target(index: number, overrides: Record<string, unknown> = {}) {
  return simulationTargetRegistrationSchema.parse({
    targetId: `mn-${index}`,
    displayLabel: `MN ${index}`,
    operatorId: `operator-${index}`,
    proTxHash: HASH(String(index)),
    hostRef: `host-${Math.floor(index / 2)}`,
    chainHostRef: null,
    unitRef: `defcon-devnet-mn@${index + 1}.service`,
    p2pPort: 19_799 + index,
    role: 'masternode',
    network: 'devnet',
    capabilities: ['service-control', 'netem-p2p'],
    expectedBuild: 'a'.repeat(64),
    labels: ['mn', `host-${Math.floor(index / 2)}`],
    maintenance: false,
    ...overrides,
  });
}

function manifest(targets = [target(0), target(1), target(2), target(3)]) {
  return {
    schemaVersion: 1,
    inventoryId: 'devnet-fleet-20260905',
    network: 'devnet',
    expectedHostCount: 2,
    limits: { maxEnabledTargetsTotal: 8, maxEnabledTargetsPerHost: 2 },
    targets,
  };
}

describe('explicit fleet inventory manifest', () => {
  it('canonicalises a complete declaration independent of target and list order', () => {
    const first = parseFleetInventoryManifest(manifest());
    const second = parseFleetInventoryManifest(manifest([
      { ...target(3), capabilities: ['netem-p2p', 'service-control'], labels: ['host-1', 'mn'] },
      target(2), target(1), target(0),
    ]));
    expect(first.hostRefs).toEqual(['host-0', 'host-1']);
    expect(first.targets.map((item) => item.targetId)).toEqual(['mn-0', 'mn-1', 'mn-2', 'mn-3']);
    expect(first.manifestFingerprint).toBe(second.manifestFingerprint);
  });

  it('rejects an incomplete or ambiguous declaration before any registry write can be considered', () => {
    expect(() => parseFleetInventoryManifest({ ...manifest(), expectedHostCount: 8 })).toThrow(/declares 2 host/);
    expect(() => parseFleetInventoryManifest(manifest([
      target(0), target(1, { proTxHash: HASH('0') }),
    ]))).toThrow(/proTxHash must be unique/);
    expect(() => parseFleetInventoryManifest({
      ...manifest(), limits: { maxEnabledTargetsTotal: 3, maxEnabledTargetsPerHost: 2 },
    })).toThrow(/aggregate approved limit/);
    expect(() => parseFleetInventoryManifest(manifest([
      target(0, { hostRef: 'host-0' }), target(1, { hostRef: 'host-0' }), target(2, { hostRef: 'host-0' }),
    ]))).toThrow(/above its approved limit/);
  });

  it('reports a no-write import diff, including stale records and risky enabled mapping edits', () => {
    const parsed = parseFleetInventoryManifest(manifest([target(0), target(1), target(2)]));
    const preview = previewFleetInventoryImport({
      manifest: parsed,
      existing: [
        { ...target(0), enabled: true },
        { ...target(1, { unitRef: 'old-unit' }), enabled: true },
        { ...target(9, { hostRef: 'host-9' }), enabled: false },
        { ...target(8, { network: 'regtest' }), enabled: true },
      ],
    });
    expect(preview.createTargetIds).toEqual(['mn-2']);
    expect(preview.updateTargetIds).toEqual(['mn-1']);
    expect(preview.unchangedTargetIds).toEqual(['mn-0']);
    expect(preview.undeclaredExistingTargetIds).toEqual(['mn-9']);
    expect(preview.enabledTargetMappingChangeIds).toEqual(['mn-1']);
  });
});
