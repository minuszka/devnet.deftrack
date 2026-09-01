import { describe, expect, it } from 'vitest';
import {
  generateLabCompose,
  labNodeName,
  ringPeers,
  toComposeDocument,
  type LabComposeSpec,
} from './labCompose.js';

/** Every node reachable from node 1 by following the addnode edges. */
function connectedComponentSize(spec: LabComposeSpec): number {
  const edges = new Map<string, Set<string>>();
  for (const [name, service] of Object.entries(spec.services)) {
    const peers = new Set<string>();
    for (const arg of service.command) {
      const match = /^-addnode=([^:]+):/.exec(arg);
      if (match) peers.add(match[1]!);
    }
    edges.set(name, peers);
  }
  // Peering is bidirectional once a connection forms, so walk edges both ways.
  const undirected = new Map<string, Set<string>>();
  for (const [name] of edges) undirected.set(name, new Set());
  for (const [name, peers] of edges) {
    for (const peer of peers) {
      undirected.get(name)!.add(peer);
      undirected.get(peer)?.add(name);
    }
  }
  const seen = new Set<string>(['mn01']);
  const stack = ['mn01'];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const peer of undirected.get(node) ?? []) {
      if (!seen.has(peer)) { seen.add(peer); stack.push(peer); }
    }
  }
  return seen.size;
}

describe('ringPeers', () => {
  it('dials the next fanout nodes, wrapping, never itself', () => {
    expect(ringPeers(1, 5, 2)).toEqual([2, 3]);
    expect(ringPeers(5, 5, 2)).toEqual([1, 2]);
    expect(ringPeers(4, 5, 3)).toEqual([5, 1, 2]);
  });

  it('never asks for more peers than there are other nodes', () => {
    expect(ringPeers(1, 3, 10)).toEqual([2, 3]);
    expect(ringPeers(2, 2, 5)).toEqual([1]);
  });
});

describe('generateLabCompose', () => {
  it('gives every node explicit addnode peers -- the peering the prototype lacked', () => {
    const spec = generateLabCompose({ nodes: 20 });
    for (const service of Object.values(spec.services)) {
      const addnodes = service.command.filter((arg) => arg.startsWith('-addnode='));
      expect(addnodes.length).toBeGreaterThanOrEqual(1);
      // Discovery is off, so without addnode the node would be blind.
      expect(service.command).toContain('-discover=0');
      expect(service.command).toContain('-dnsseed=0');
    }
  });

  it('produces a single connected topology, not islands', () => {
    for (const nodes of [2, 5, 20, 40]) {
      const spec = generateLabCompose({ nodes });
      expect(connectedComponentSize(spec)).toBe(nodes);
    }
  });

  it('survives a faulted node without splitting, at the default fanout', () => {
    // Drop mn05's container from the topology and confirm the rest stay connected
    // -- the whole point of a fault lab is that faulting one node is not a partition.
    const spec = generateLabCompose({ nodes: 20 });
    delete spec.services['mn05'];
    for (const service of Object.values(spec.services)) {
      const i = service.command.findIndex((a) => a === '-addnode=mn05:19799');
      if (i >= 0) service.command.splice(i, 1);
    }
    expect(connectedComponentSize(spec)).toBe(19);
  });

  it('mounts each data volume at the datadir the node is told to use', () => {
    const spec = generateLabCompose({ nodes: 3, datadir: '/data/defcon' });
    for (const [name, service] of Object.entries(spec.services)) {
      expect(service.command).toContain('-datadir=/data/defcon');
      expect(service.volumes).toEqual([`${name}_data:/data/defcon`]);
      expect(spec.volumes[`${name}_data`]).toEqual({});
    }
    expect(Object.keys(spec.networks)).toEqual(['lab']);
  });

  it('rejects a node count outside the supported range', () => {
    expect(() => generateLabCompose({ nodes: 1 })).toThrow(/2\.\.40/);
    expect(() => generateLabCompose({ nodes: 41 })).toThrow(/2\.\.40/);
    expect(() => generateLabCompose({ nodes: 3, fanout: 0 })).toThrow(/fanout/);
  });

  it('serialises to a parseable compose document with the right shape', () => {
    const spec = generateLabCompose({ nodes: 2 });
    const document = toComposeDocument(spec);
    const parsed = JSON.parse(document);
    expect(parsed.name).toBe('defcon-finality-lab');
    expect(Object.keys(parsed.services)).toEqual(['mn01', 'mn02']);
    expect(parsed.services.mn01.command).toContain(`-addnode=${labNodeName(2)}:19799`);
  });
});
