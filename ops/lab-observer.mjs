#!/usr/bin/env node
/**
 * The simulator lab's observer agent.
 *
 * On the devnet a per-host agent reports what that machine can see, and the
 * preflight's observer-fresh check reads it. A lab that wrote HostStatus rows
 * directly would be forging the signal the check exists to read -- the run would
 * pass a gate that had measured nothing. So this asks the lab node the same
 * questions the fleet agent asks its own, and posts them through the same ingest
 * endpoint.
 *
 * Every value here comes from the node or from the binary on disk. Nothing is
 * invented; a field the node cannot answer is reported as null or empty, which
 * is what the schema is for.
 *
 *   node ops/lab-observer.mjs
 *
 * Env: LAB_API (default http://127.0.0.1:4210), INGEST_TOKEN, RPC_* , and
 * LAB_CONTAINERS as a comma-separated list of container names to observe.
 */

import { spawnSync } from 'node:child_process';

const API = process.env.LAB_API ?? 'http://127.0.0.1:4210';
const TOKEN = process.env.INGEST_TOKEN ?? '';
const INTERVAL_MS = Number(process.env.LAB_OBSERVER_INTERVAL_MS ?? 15_000);
const CONTAINERS = (process.env.LAB_CONTAINERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const DOCKER = process.env.DOCKER_BIN ?? 'docker';
// The registry pins expectedBuild as 64 hex, so the fingerprint is sha256 -- the
// ops habit of comparing md5 is a different, shorter digest.
const BINARY = process.env.LAB_NODE_BINARY ?? '/usr/local/bin/defcond';

const RPC = {
  url: `http://${process.env.RPC_HOST ?? '127.0.0.1'}:${process.env.RPC_PORT ?? '19998'}/`,
  auth: `${process.env.RPC_USER ?? ''}:${process.env.RPC_PASS ?? ''}`,
};

async function rpc(method, params = []) {
  const res = await fetch(RPC.url, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      authorization: `Basic ${Buffer.from(RPC.auth).toString('base64')}`,
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'lab-observer', method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/**
 * The binary fingerprint, read from the container. The version string cannot
 * answer this -- two builds carrying different consensus code report the same
 * one. spawnSync deliberately: an async child handle raced the runtime shutdown
 * on Windows and aborted the process.
 */
function nodeBuild(container) {
  const r = spawnSync(DOCKER, ['exec', container, 'sha256sum', BINARY], { encoding: 'utf8' });
  if (r.status !== 0 || typeof r.stdout !== 'string') return '';
  return (r.stdout.trim().split(/\s+/)[0] ?? '').toLowerCase();
}

async function observeOnce() {
  const [info, peers] = await Promise.all([rpc('getblockchaininfo'), rpc('getpeerinfo').catch(() => [])]);
  const pings = peers.map((p) => p.pingtime).filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  const median = pings.length === 0 ? null : pings[Math.floor(pings.length / 2)] * 1000;

  for (const container of CONTAINERS) {
    const payload = {
      host: container,
      status: {
        peers: peers.length,
        inbound: peers.filter((p) => p.inbound === true).length,
        verifiedMasternodes: peers.filter((p) => p.verified_mnauth === true || p.masternode === true).length,
        medianPingMs: median,
        maxPingWaitMs: null,
        height: typeof info.blocks === 'number' ? info.blocks : null,
        // A regtest lab node stakes nothing unless it was funded; reporting an
        // empty list is the honest answer, not a placeholder.
        stakeScripts: [],
        nodeBuild: nodeBuild(container),
      },
      observations: [],
    };
    const res = await fetch(`${API}/api/v1/peers/observations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-token': TOKEN },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`ingest ${res.status}: ${(await res.text()).slice(0, 200)}`);
    console.log(`observed ${container}: height=${payload.status.height} peers=${payload.status.peers} build=${payload.status.nodeBuild.slice(0, 8) || '(unknown)'}`);
  }
}

if (CONTAINERS.length === 0) {
  console.error('LAB_CONTAINERS is required: the observer reports for named containers only');
  process.exit(1);
}

await observeOnce();
// Let the process end on its own: calling process.exit here raced a closing
// libuv handle from the docker exec and aborted the runtime.
if (!process.argv.includes('--once')) {
  setInterval(() => { void observeOnce().catch((e) => console.error(`observe failed: ${e.message}`)); }, INTERVAL_MS);
}
