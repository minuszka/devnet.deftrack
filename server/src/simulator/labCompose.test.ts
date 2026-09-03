import { describe, expect, it } from 'vitest';
import { generateLabCompose, labNodeAddress, labNodeName, ringPeers, toComposeDocument, type LabComposeSpec } from './labCompose.js';

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

  it('publishes each node RPC on its own loopback port, so the lab is observable', () => {
    // Without this the lab cannot be observed at all: the image carries no
    // defcon-cli, so a node can only be asked over HTTP RPC, and an unpublished
    // port means the observer reaches nobody. It then had nothing to do but ask
    // one node and stamp that answer onto every container.
    const spec = generateLabCompose({ nodes: 3 });
    const ports = Object.values(spec.services).map((s) => s.ports[0]!);
    expect(ports).toEqual([
      '127.0.0.1:19800:19798',
      '127.0.0.1:19801:19798',
      '127.0.0.1:19802:19798',
    ]);
    // Loopback only: the lab is never addressable from off the machine.
    expect(ports.every((p) => p.startsWith('127.0.0.1:'))).toBe(true);
    expect(new Set(ports.map((p) => p.split(':')[1])).size).toBe(3);
  });

  it('pins the container name to the service name, which is what a target hostRef is', () => {
    const spec = generateLabCompose({ nodes: 3 });
    for (const [name, service] of Object.entries(spec.services)) {
      // Without this the real container is <project>-mn01-1 while hostRef is mn01,
      // so every executor command misses -- and a miss reads as benign for a clear,
      // which would let a fault that never landed look applied.
      expect(service.container_name).toBe(name);
      // Nothing may resurrect a node the simulator deliberately stopped, and the
      // grace must match the `docker stop -t 30` the wrapper issues.
      expect(service.restart).toBe('no');
      expect(service.stop_grace_period).toBe('30s');
    }
  });

  it('starts only the named nodes as masternodes, leaving the rest able to hold a wallet', () => {
    // A node cannot be both: the daemon soft-sets disablewallet=1 whenever a
    // masternode BLS key is present, and refuses to start if that is overridden.
    // So a lab that wants blocks needs at least one node without a key.
    const spec = generateLabCompose({ nodes: 3, masternodeKeys: { mn01: 'a'.repeat(32), mn02: 'b'.repeat(32) } });
    expect(spec.services.mn01!.command).toContain(`-masternodeblsprivkey=${'a'.repeat(32)}`);
    expect(spec.services.mn02!.command).toContain(`-masternodeblsprivkey=${'b'.repeat(32)}`);
    expect(spec.services.mn03!.command.some((a) => a.startsWith('-masternodeblsprivkey='))).toBe(false);
  });

  it('starts no masternode at all by default', () => {
    const spec = generateLabCompose({ nodes: 2 });
    for (const service of Object.values(spec.services)) {
      expect(service.command.some((a) => a.startsWith('-masternodeblsprivkey='))).toBe(false);
    }
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

describe('pinned addresses', () => {
  it('gives each node a fixed address on the lab subnet, first node at .2', () => {
    expect(labNodeAddress(1)).toBe('172.28.0.2');
    expect(labNodeAddress(4)).toBe('172.28.0.5');
  });

  it('refuses a subnet it cannot pin addresses inside', () => {
    expect(() => labNodeAddress(1, '172.28.0.0/16')).toThrow(/must be a \/24/);
  });

  it('enters the network at that address and advertises it', () => {
    const spec = generateLabCompose({ nodes: 3 });
    // The compose is the only definition of a node's address: a ProTx pins the
    // service it registered with, so an address that moves on recreate leaves a
    // masternode holding a key for a ProTx naming some other container.
    expect(spec.services.mn02?.networks.lab?.ipv4_address).toBe('172.28.0.3');
    expect(spec.services.mn02?.command).toContain('-externalip=172.28.0.3');
    expect(spec.networks.lab?.ipam.config[0]?.subnet).toBe('172.28.0.0/24');
  });

  it('keeps every pinned address inside the CIDR allowed to reach RPC', () => {
    const spec = generateLabCompose({ nodes: 8 });
    for (const service of Object.values(spec.services)) {
      expect(service.networks.lab?.ipv4_address).toMatch(/^172\.28\.0\.\d+$/);
    }
  });
});
