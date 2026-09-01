/**
 * Generating a regtest Docker Compose topology whose nodes actually peer.
 *
 * The prototype this replaces gave every node `-discover=0 -dnsseed=0` -- correct
 * for a closed lab -- but no `-addnode`/`-connect`, so the nodes had no way left
 * to find each other and the chain never formed. It also put them on separate
 * per-provider networks with no shared one, which would have blocked peering even
 * with addnode. Here every node sits on one shared lab network and is given
 * explicit ring peers, so the topology is connected by construction; netem is
 * applied per container (tc on its own interface), so no per-provider network is
 * needed to target a fault.
 *
 * Pure: it returns a structured spec, and the arithmetic that decides who peers
 * with whom is tested without Docker.
 */

export interface LabTopology {
  /** Number of masternode containers. */
  nodes: number;
  /** How many forward ring neighbours each node dials. >=1 keeps the ring whole;
   *  higher adds redundancy so a single faulted node cannot split it. */
  fanout: number;
  image: string;
  /** The one network every node shares, so they can reach each other to peer. */
  network: string;
  /** Internal P2P port, shared across containers (each is its own host). */
  p2pPort: number;
  /** Internal RPC port, shared across containers. */
  rpcPort: number;
  /** Datadir inside the container; the per-node volume mounts here. */
  datadir: string;
  /** CIDR allowed to reach RPC -- the lab subnet only. */
  rpcAllowIp: string;
}

export interface LabComposeService {
  image: string;
  cap_add: string[];
  command: string[];
  networks: string[];
  volumes: string[];
}

export interface LabComposeSpec {
  name: string;
  services: Record<string, LabComposeService>;
  networks: Record<string, Record<string, never>>;
  volumes: Record<string, Record<string, never>>;
}

export const DEFAULT_LAB_TOPOLOGY: Omit<LabTopology, 'nodes'> = {
  fanout: 3,
  image: '${DEFCON_IMAGE:-defcon-core:test}',
  network: 'lab',
  p2pPort: 19799,
  rpcPort: 19798,
  datadir: '/var/lib/defcon',
  rpcAllowIp: '172.16.0.0/12',
};

const MIN_NODES = 2;
const MAX_NODES = 40;

export function labNodeName(index: number): string {
  return `mn${String(index).padStart(2, '0')}`;
}

/**
 * The forward ring neighbours node `index` (1-based) dials: the next `fanout`
 * nodes, wrapping, never itself and never a duplicate. With `fanout` >= 1 the
 * union of these edges is a single ring that reaches every node.
 */
export function ringPeers(index: number, nodes: number, fanout: number): number[] {
  const peers: number[] = [];
  const reach = Math.min(fanout, nodes - 1);
  for (let step = 1; step <= reach; step++) {
    peers.push(((index - 1 + step) % nodes) + 1);
  }
  return peers;
}

export function generateLabCompose(input: { nodes: number } & Partial<Omit<LabTopology, 'nodes'>>): LabComposeSpec {
  const topology: LabTopology = { ...DEFAULT_LAB_TOPOLOGY, ...input };
  if (!Number.isInteger(topology.nodes) || topology.nodes < MIN_NODES || topology.nodes > MAX_NODES) {
    throw new Error(`lab topology needs ${MIN_NODES}..${MAX_NODES} nodes, got ${topology.nodes}`);
  }
  if (!Number.isInteger(topology.fanout) || topology.fanout < 1) {
    throw new Error(`lab fanout must be >= 1, got ${topology.fanout}`);
  }

  const services: Record<string, LabComposeService> = {};
  const volumes: Record<string, Record<string, never>> = {};

  for (let index = 1; index <= topology.nodes; index++) {
    const name = labNodeName(index);
    const dataVolume = `${name}_data`;
    const command = [
      'defcond',
      '-regtest=1',
      '-server=1',
      '-listen=1',
      // A closed lab: no external peer discovery. Safe only because every node
      // is given explicit peers below -- the two must ship together.
      '-discover=0',
      '-dnsseed=0',
      '-printtoconsole=1',
      `-datadir=${topology.datadir}`,
      `-bind=0.0.0.0:${topology.p2pPort}`,
      `-rpcport=${topology.rpcPort}`,
      '-rpcbind=0.0.0.0',
      `-rpcallowip=${topology.rpcAllowIp}`,
      // The peering the prototype lacked: each ring neighbour by service name,
      // reachable on the shared network.
      ...ringPeers(index, topology.nodes, topology.fanout).map(
        (peer) => `-addnode=${labNodeName(peer)}:${topology.p2pPort}`
      ),
    ];
    services[name] = {
      image: topology.image,
      cap_add: ['NET_ADMIN'],
      command,
      networks: [topology.network],
      volumes: [`${dataVolume}:${topology.datadir}`],
    };
    volumes[dataVolume] = {};
  }

  return {
    name: 'defcon-finality-lab',
    services,
    networks: { [topology.network]: {} },
    volumes,
  };
}

/**
 * A compose document. Emitted as JSON, which every compose parser accepts as a
 * YAML document -- the structure is what matters, and JSON removes any question
 * of hand-rolled YAML quoting around the `=`, `:` and `${}` in the commands.
 */
export function toComposeDocument(spec: LabComposeSpec): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}
