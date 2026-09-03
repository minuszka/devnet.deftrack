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

/**
 * The binary fingerprint, read from the container. The version string cannot
 * answer this -- it has named three different binaries at once on this project.
 *
 * Cached against the container's start time, because hashing a 100 MB binary
 * costs about half a second and the binary cannot change while the container
 * runs. Paid on every container on every pass, it was the single largest cost in
 * the observation loop, and it made reports stale enough that the resolver
 * refused targets as HOST_HEIGHT_STALE on a healthy lab.
 *
 * Keyed on the start time rather than the name alone: a restart is exactly when
 * the binary CAN differ, and that is the one case a cache must not hide.
 */
const buildCache = new Map();

function nodeBuild(container) {
  const inspect = docker(['inspect', '-f', '{{.State.StartedAt}}', container]);
  const started = inspect.status === 0 ? String(inspect.stdout ?? '').trim() : '';
  const cached = buildCache.get(container);
  if (cached !== undefined && cached.startedAt === started && started !== '') return cached.build;
  const r = docker(['exec', container, 'sha256sum', BINARY]);
  if (r.status !== 0 || typeof r.stdout !== 'string') return '';
  const build = (r.stdout.trim().split(/\s+/)[0] ?? '').toLowerCase();
  if (started !== '') buildCache.set(container, { startedAt: started, build });
  return build;
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

/**
 * One pass over every container, asked CONCURRENTLY.
 *
 * Sequential asking did two things wrong at eleven nodes and neither was
 * visible at four. It lagged -- a full pass took longer than the poll interval,
 * so heights went stale and the resolver refused targets as HOST_HEIGHT_STALE on
 * a perfectly healthy lab. And it skewed: the first container was seen seconds
 * before the last, so a "snapshot" spanned a range of chain rather than an
 * instant, in a tool whose whole subject is when things were seen.
 *
 * Each container is still independent: one that cannot be reached is reported by
 * nobody, and one whose post fails is retried on the next pass.
 */
async function observeOnce() {
  const results = await Promise.all(
    CONTAINERS.map(async (container) => {
      let payload;
      try {
        payload = await observeContainer(container);
      } catch (error) {
        // Deliberately no report: an unreachable node's telemetry must go
        // stale, because that staleness is what tells the preflight it is down.
        console.error(`skipped ${container}: ${error.message}`);
        return 'unreachable';
      }
      // A failed post is reported and dropped, never fatal. The moments the
      // ingest is unavailable -- a lab server restarting, a fault run in
      // progress -- are exactly when its telemetry matters most, and an observer
      // that died then left a gap that reads afterwards as a healthy quiet
      // period. The sighting is lost; the next pass reports the same blocks
      // again, because the ingest keys them by (height, host).
      try {
        const res = await fetch(`${API}/api/v1/peers/observations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-ingest-token': TOKEN },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`ingest ${res.status}: ${(await res.text()).slice(0, 200)}`);
      } catch (error) {
        console.error(`could not report ${container}: ${error.message}`);
        lastSeenHeight.delete(container);
        return 'failed';
      }
      console.log(
        `observed ${container}: height=${payload.status.height} peers=${payload.status.peers} ` +
          `build=${payload.status.nodeBuild.slice(0, 8) || '(unknown)'}`
      );
      return 'reported';
    })
  );
  const count = (kind) => results.filter((entry) => entry === kind).length;
  const unreachable = count('unreachable');
  const failed = count('failed');
  if (unreachable > 0) {
    console.error(`${unreachable}/${CONTAINERS.length} container(s) unreachable and deliberately unreported`);
  }
  if (failed > 0) {
    console.error(`${failed}/${CONTAINERS.length} report(s) could not be delivered; they will be resent`);
  }
  return { reported: count('reported'), unreachable, failed };
}

if (CONTAINERS.length === 0) {
  console.error('LAB_CONTAINERS is required: the observer reports for named containers only');
  process.exit(1);
}

await observeOnce();
if (!process.argv.includes('--once')) {
  /*
   * A gap BETWEEN passes, not a fixed tick.
   *
   * `setInterval` fired every interval whether the previous pass had finished or
   * not, so a slow pass was overtaken by the next: eleven containers times
   * several passes in flight, all competing for the same Docker daemon, each
   * making the others slower. The rows then aged past the resolver's tolerance
   * and it refused targets on a healthy lab -- the load was self-inflicted and
   * looked like staleness.
   */
  for (;;) {
    await new Promise((done) => setTimeout(done, INTERVAL_MS));
    try {
      await observeOnce();
    } catch (error) {
      console.error(`observe failed: ${error.message}`);
    }
  }
}
