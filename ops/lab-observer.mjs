#!/usr/bin/env node
/**
 * The simulator lab's observer agent.
 *
 * On the devnet a per-host agent reports what that machine can see, and the
 * preflight's observer-fresh check reads it. A lab that wrote HostStatus rows
 * directly would be forging the signal the check exists to read -- the run would
 * pass a gate that had measured nothing.
 *
 * The first version of this file made a subtler version of the same mistake: it
 * asked ONE node and stamped that answer onto every container. A stopped node
 * then reported a running node's height, and observer-fresh would have passed
 * over a dead machine. Every container is now asked on its OWN RPC endpoint,
 * with its own credentials.
 *
 * A container the observer cannot reach gets NO report at all. That is the
 * honest outcome: its HostStatus goes stale on its own, and staleness is exactly
 * the signal the preflight is looking for. Inventing a row for an unreachable
 * node is the failure this file exists to avoid.
 *
 *   node ops/lab-observer.mjs
 *
 * Env: LAB_API, INGEST_TOKEN, LAB_CONTAINERS (comma-separated), LAB_RPC_PORT
 * (the node's INTERNAL rpc port), LAB_DATADIR, LAB_CHAIN, and RPC_USER/RPC_PASS
 * as a fallback when a node uses password auth instead of a cookie.
 */

import { spawnSync } from 'node:child_process';

const API = process.env.LAB_API ?? 'http://127.0.0.1:4200';
const TOKEN = process.env.INGEST_TOKEN ?? '';
const INTERVAL_MS = Number(process.env.LAB_OBSERVER_INTERVAL_MS ?? 15_000);
const CONTAINERS = (process.env.LAB_CONTAINERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const DOCKER = process.env.DOCKER_BIN ?? 'docker';
const INTERNAL_RPC_PORT = process.env.LAB_RPC_PORT ?? '19798';
const DATADIR = process.env.LAB_DATADIR ?? '/var/lib/defcon';
const CHAIN_DIR = process.env.LAB_CHAIN ?? 'regtest';
// The registry pins expectedBuild as 64 hex, so the fingerprint is sha256 -- the
// ops habit of comparing md5 is a different, shorter digest.
const BINARY = process.env.LAB_NODE_BINARY ?? '/usr/local/bin/defcond';
/**
 * How many blocks one pass may report per container.
 *
 * Bounded because a restarted observer, or a node that was unreachable for a
 * while, would otherwise try to report every block it missed in one request --
 * and the gap is exactly when the lab is under fault, which is the worst moment
 * to send an unbounded payload.
 */
const MAX_SIGHTINGS = Number(process.env.LAB_OBSERVER_MAX_SIGHTINGS ?? 25);

function docker(args) {
  return spawnSync(DOCKER, args, { encoding: 'utf8' });
}

/** Where this container's RPC is published on loopback, or null if it is not. */
function rpcEndpoint(container) {
  const r = docker(['port', container, INTERNAL_RPC_PORT]);
  if (r.status !== 0) return null;
  const first = (r.stdout ?? '').trim().split('\n')[0] ?? '';
  const m = /:(\d+)\s*$/.exec(first.trim());
  return m === null ? null : `http://127.0.0.1:${m[1]}/`;
}

/** The node's own cookie, falling back to configured credentials. */
function rpcAuth(container) {
  const r = docker(['exec', container, 'cat', `${DATADIR}/${CHAIN_DIR}/.cookie`]);
  if (r.status === 0 && typeof r.stdout === 'string' && r.stdout.includes(':')) return r.stdout.trim();
  const user = process.env.RPC_USER ?? '';
  const pass = process.env.RPC_PASS ?? '';
  return user === '' ? null : `${user}:${pass}`;
}

async function rpc(endpoint, auth, method, params = []) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      authorization: `Basic ${Buffer.from(auth).toString('base64')}`,
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'lab-observer', method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** The binary fingerprint, read from the container. The version string cannot answer this. */
function nodeBuild(container) {
  const r = docker(['exec', container, 'sha256sum', BINARY]);
  if (r.status !== 0 || typeof r.stdout !== 'string') return '';
  return (r.stdout.trim().split(/\s+/)[0] ?? '').toLowerCase();
}

/**
 * The blocks this container has seen since we last asked it, newest first.
 *
 * This is what a per-host agent contributes and what the seed's ZMQ feed cannot:
 * the measurement's host coverage is `expectedHosts x blocks`, and the expected
 * hosts are the TARGETS -- so without a sighting from each of them, every report
 * reads 0% peer observation coverage and counts all of them stale, however
 * healthy they are.
 *
 * The timestamp is when this observer asked, not when the node saw the block, so
 * its resolution is the poll interval and it says so in `resolutionMs`. That is
 * the honest claim: a poll cannot know arrival time, and the ZMQ feed on node 1
 * is what measures it properly.
 */
const lastSeenHeight = new Map();

async function recentSightings(container, endpoint, auth, tipHeight, receivedAt) {
  const previous = lastSeenHeight.get(container);
  lastSeenHeight.set(container, tipHeight);
  if (typeof tipHeight !== 'number') return [];
  // First sight of this container: report the tip alone rather than walking back
  // through a chain it was not observed over.
  const from = previous === undefined ? tipHeight : Math.min(previous + 1, tipHeight);
  const sightings = [];
  for (let height = tipHeight; height >= from && sightings.length < MAX_SIGHTINGS; height--) {
    const hash = await rpc(endpoint, auth, 'getblockhash', [height]).catch(() => null);
    if (hash === null) continue;
    sightings.push({ topic: 'block', hash, height, receivedAt });
    // A block this node holds a ChainLock for is a second, separate sighting:
    // the measurement counts blocks and locks apart.
    const block = await rpc(endpoint, auth, 'getblock', [hash]).catch(() => null);
    if (block?.chainlock === true) {
      sightings.push({ topic: 'chainlock', hash, height, receivedAt });
    }
  }
  return sightings;
}

/** Ask ONE container about itself. Throws if it cannot be reached; the caller skips it. */
async function observeContainer(container) {
  const endpoint = rpcEndpoint(container);
  if (endpoint === null) throw new Error(`no published RPC port ${INTERNAL_RPC_PORT}`);
  const auth = rpcAuth(container);
  if (auth === null) throw new Error('no cookie and no RPC_USER configured');

  const info = await rpc(endpoint, auth, 'getblockchaininfo');
  const peers = await rpc(endpoint, auth, 'getpeerinfo').catch(() => []);
  const pings = peers
    .map((p) => p.pingtime)
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);

  return {
    host: container,
    status: {
      peers: peers.length,
      inbound: peers.filter((p) => p.inbound === true).length,
      verifiedMasternodes: peers.filter((p) => p.verified_mnauth === true || p.masternode === true).length,
      medianPingMs: pings.length === 0 ? null : pings[Math.floor(pings.length / 2)] * 1000,
      maxPingWaitMs: null,
      height: typeof info.blocks === 'number' ? info.blocks : null,
      // A lab node stakes nothing unless it was funded; an empty list is the
      // honest answer, not a placeholder.
      stakeScripts: [],
      nodeBuild: nodeBuild(container),
    },
    // The poll interval IS the resolution here, and the ingest records it, so a
    // sighting from this observer is never mistaken for an event-time one.
    resolutionMs: INTERVAL_MS,
    observations: await recentSightings(container, endpoint, auth, info.blocks, new Date().toISOString()),
  };
}

async function observeOnce() {
  let reported = 0;
  let unreachable = 0;
  for (const container of CONTAINERS) {
    let payload;
    try {
      payload = await observeContainer(container);
    } catch (error) {
      // Deliberately no report: an unreachable node's telemetry must go stale,
      // because that staleness is what tells the preflight the node is down.
      unreachable++;
      console.error(`skipped ${container}: ${error.message}`);
      continue;
    }
    const res = await fetch(`${API}/api/v1/peers/observations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-token': TOKEN },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`ingest ${res.status}: ${(await res.text()).slice(0, 200)}`);
    reported++;
    console.log(`observed ${container}: height=${payload.status.height} peers=${payload.status.peers} build=${payload.status.nodeBuild.slice(0, 8) || '(unknown)'}`);
  }
  if (unreachable > 0) console.error(`${unreachable}/${CONTAINERS.length} container(s) unreachable and deliberately unreported`);
  return { reported, unreachable };
}

if (CONTAINERS.length === 0) {
  console.error('LAB_CONTAINERS is required: the observer reports for named containers only');
  process.exit(1);
}

await observeOnce();
if (!process.argv.includes('--once')) {
  setInterval(() => { void observeOnce().catch((e) => console.error(`observe failed: ${e.message}`)); }, INTERVAL_MS);
}
