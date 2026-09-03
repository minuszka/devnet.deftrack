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
  /**
   * The lab's own /24, so every node has a FIXED address.
   *
   * Not cosmetic. A masternode's ProTx pins the service address it registered
   * with, and Docker hands out addresses in start order -- so recreating the
   * stack silently permuted them, leaving each node holding an operator key for
   * a ProTx that named a different container. Nothing errors; the masternode
   * simply never recognises itself. Pinning the address is what makes a
   * registration survive a restart, which the whole fault lab is built on.
   */
  subnet: string;
  /**
   * The regtest spork signing key, given to node 1 only.
   *
   * Without it the lab is inert: every spork defaults to 4070908800 -- the
   * far-future "off" timestamp -- and `SPORK_17_QUORUM_DKG_ENABLED` off means no
   * DKG session ever runs. Blocks still carry commitments, but null ones, so the
   * lab looks like it is holding rounds while forming nothing.
   *
   * This is upstream's published regtest test key, valid only against the regtest
   * spork address; it signs nothing on any real network.
   */
  sporkKey: string;
  /**
   * The LLMQ size and threshold every node is started with, or null for the
   * build's own defaults.
   *
   * `-llmqtestparams` is regtest-only and exists so a lab can be run under
   * parameters other than the three-member default -- which is what a comparison
   * across wallet versions or quorum shapes needs.
   *
   * Read the node's own assignment before using it: it sets size, and then
   * minSize, threshold AND dkgBadVotesThreshold all to the threshold. So
   * `10:6` is really 10/6/6/6, not 10/x/6/y. The gap between minSize and size --
   * where "formed but punished" lives -- is therefore always size minus
   * threshold, and cannot be set independently.
   */
  llmqTestParams: { size: number; threshold: number } | null;
  /** First loopback port for the published RPCs; node i takes base + i - 1. */
  hostRpcBasePort: number;
  /** Internal ZMQ publish port on node 1, and the loopback port it is published on. */
  zmqPort: number;
  hostZmqPort: number;
  /**
   * BLS operator keys, by node name. A node listed here starts AS A MASTERNODE.
   *
   * A node cannot be both: the daemon soft-sets `disablewallet=1` whenever a
   * masternode BLS key is present, and refuses to start if that is overridden. So
   * a lab that wants blocks needs at least one node left out of this map to hold
   * the wallet and mine -- which is also why the keys are per node rather than a
   * flag on the topology.
   */
  masternodeKeys: Readonly<Record<string, string>>;
}

export interface LabComposeService {
  image: string;
  /**
   * Pinned, not left to Compose's `<project>-<service>-<n>` naming. A run's target
   * `hostRef` IS the container name the executor hands `docker`, so without this
   * every command would miss -- and "No such container" is a benign result for a
   * clear, so a fault that never landed could read as applied.
   */
  container_name: string;
  cap_add: string[];
  command: string[];
  /** The one lab network, entered at this node's pinned address. */
  networks: Record<string, { ipv4_address: string }>;
  volumes: string[];
  /** Nothing may resurrect a node the simulator deliberately stopped. */
  restart: 'no';
  /** Matches `docker stop -t 30`: the daemon is PID 1 and needs its flush. */
  stop_grace_period: string;
  /**
   * Each node's RPC, published on its own loopback port.
   *
   * Without this the lab is unobservable from the host: the image carries no
   * defcon-cli, so the only way to ask a node anything is HTTP RPC, and an
   * unpublished port means the observer can reach no node at all. It then had
   * nothing to do but ask ONE endpoint and stamp that answer onto every
   * container -- which is how a stopped node came to report a running node's
   * height. Loopback only; the lab is never addressable from off the machine.
   */
  ports: string[];
}

export interface LabComposeNetwork {
  ipam: { config: Array<{ subnet: string }> };
}

export interface LabComposeSpec {
  name: string;
  services: Record<string, LabComposeService>;
  networks: Record<string, LabComposeNetwork>;
  volumes: Record<string, Record<string, never>>;
  /**
   * Carried on the spec so the explorer can be told what the nodes were started
   * with. Not part of the compose document -- `toComposeDocument` drops it,
   * because Compose rejects an unknown top-level key.
   */
  llmqTestParams: { size: number; threshold: number } | null;
}

export const DEFAULT_LAB_TOPOLOGY: Omit<LabTopology, 'nodes'> = {
  fanout: 3,
  image: '${DEFCON_IMAGE:-defcon-core:test}',
  network: 'lab',
  p2pPort: 19799,
  rpcPort: 19798,
  datadir: '/var/lib/defcon',
  rpcAllowIp: '172.16.0.0/12',
  subnet: '172.28.0.0/24',
  sporkKey: 'cP4EKFyJsHT39LDqgdcB43Y3YXjNyjb5Fuas1GQSeAtjnZWmZEQK',
  llmqTestParams: null,
  hostRpcBasePort: 19800,
  zmqPort: 28332,
  hostZmqPort: 28332,
  masternodeKeys: {},
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
/**
 * The pinned address of node `index` on the lab subnet: host `index + 1`, so the
 * first node takes .2 and .1 is left to the gateway.
 *
 * This is the single definition of a node's address. The bring-up registers a
 * masternode at exactly the address Compose will give it, rather than reading one
 * back from a running container and hoping the next recreate agrees.
 */
export function labNodeAddress(index: number, subnet: string = DEFAULT_LAB_TOPOLOGY.subnet): string {
  const match = /^(\d+)\.(\d+)\.(\d+)\.\d+\/24$/.exec(subnet);
  if (match === null) throw new Error(`lab subnet must be a /24, got ${subnet}`);
  const host = index + 1;
  if (host > 254) throw new Error(`node index ${index} does not fit the lab /24`);
  return `${match[1]}.${match[2]}.${match[3]}.${host}`;
}

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
      // Discovery is off, so the node would otherwise not know its own address.
      // A masternode must advertise the one its ProTx names.
      `-externalip=${labNodeAddress(index, topology.subnet)}`,
      // The peering the prototype lacked: each ring neighbour by service name,
      // reachable on the shared network.
      ...ringPeers(index, topology.nodes, topology.fanout).map(
        (peer) => `-addnode=${labNodeName(peer)}:${topology.p2pPort}`
      ),
      // Every node, not just node 1: these are consensus parameters, and a node
      // started without them would form quorums by different rules and fork off.
      ...(topology.llmqTestParams === null
        ? []
        : [`-llmqtestparams=${topology.llmqTestParams.size}:${topology.llmqTestParams.threshold}`]),
      // Only node 1 signs sporks -- it is the one node guaranteed to keep a
      // wallet, and a second signer would add nothing on a single-key chain.
      ...(index === 1 ? [`-sporkkey=${topology.sporkKey}`] : []),
      /*
       * Event-time observation, on node 1 only, exactly as the devnet runs it on
       * its seed.
       *
       * Without it a block has no arrival time at all: `firstSeenAt` is derived
       * from these notifications and nothing else, so every measurement reports
       * 0% block-arrival coverage and no ChainLock latency -- a structurally
       * valid report that can say nothing about the network. `sequence` is not
       * optional: the socket drops silently at its high-water mark, and the
       * per-topic sequence numbers are what make a lost message detectable
       * rather than merely suspected.
       */
      ...(index === 1
        ? [
            `-zmqpubhashblock=tcp://0.0.0.0:${topology.zmqPort}`,
            `-zmqpubhashchainlock=tcp://0.0.0.0:${topology.zmqPort}`,
            `-zmqpubhashtx=tcp://0.0.0.0:${topology.zmqPort}`,
            `-zmqpubsequence=tcp://0.0.0.0:${topology.zmqPort}`,
          ]
        : []),
      ...(topology.masternodeKeys[name] === undefined
        ? []
        : [`-masternodeblsprivkey=${topology.masternodeKeys[name]}`]),
    ];
    services[name] = {
      image: topology.image,
      container_name: name,
      ports: [
        `127.0.0.1:${topology.hostRpcBasePort + index - 1}:${topology.rpcPort}`,
        ...(index === 1 ? [`127.0.0.1:${topology.hostZmqPort}:${topology.zmqPort}`] : []),
      ],
      cap_add: ['NET_ADMIN'],
      command,
      networks: { [topology.network]: { ipv4_address: labNodeAddress(index, topology.subnet) } },
      volumes: [`${dataVolume}:${topology.datadir}`],
      restart: 'no',
      stop_grace_period: '30s',
    };
    volumes[dataVolume] = {};
  }

  return {
    name: 'defcon-finality-lab',
    services,
    networks: { [topology.network]: { ipam: { config: [{ subnet: topology.subnet }] } } },
    volumes,
    llmqTestParams: topology.llmqTestParams,
  };
}

/**
 * What the explorer must be told about the profile this lab actually runs.
 *
 * Derived from the same topology the compose is generated from, so the reader's
 * numbers and the nodes' arguments cannot drift apart -- which is the whole
 * failure this exists to prevent. No RPC returns these numbers, so nothing
 * downstream could catch a disagreement except the member-count check, and that
 * only fires in one direction.
 *
 * Mirrors the node's own assignment exactly: `-llmqtestparams=<size>:<threshold>`
 * sets minSize, threshold AND dkgBadVotesThreshold all to the threshold.
 */
export function llmqProfileOverridesFor(spec: Pick<LabComposeSpec, 'llmqTestParams'>): string {
  const params = spec.llmqTestParams;
  if (params === null) return '';
  return JSON.stringify({
    llmq_test: {
      size: params.size,
      minSize: params.threshold,
      threshold: params.threshold,
      dkgBadVotesThreshold: params.threshold,
    },
  });
}

/**
 * A compose document. Emitted as JSON, which every compose parser accepts as a
 * YAML document -- the structure is what matters, and JSON removes any question
 * of hand-rolled YAML quoting around the `=`, `:` and `${}` in the commands.
 */
export function toComposeDocument(spec: LabComposeSpec): string {
  // llmqTestParams rides on the spec for the explorer's benefit, not for
  // Compose, which rejects an unknown top-level key.
  const { llmqTestParams: _explorerOnly, ...document } = spec;
  return `${JSON.stringify(document, null, 2)}\n`;
}
