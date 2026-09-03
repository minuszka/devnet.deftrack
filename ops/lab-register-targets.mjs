#!/usr/bin/env node
/**
 * Declares the lab's masternodes to the simulation target registry.
 *
 * Nothing else writes this registry, and without it the control API answers
 * every run with "target inventory is incomplete: no eligible targets" -- the
 * lab could be built, and still not be pointed at.
 *
 * The proTxHash is read from the chain rather than guessed: a target whose hash
 * does not match the running node resolves to MISSING_PROTX_MAPPING at preflight,
 * which is the correct refusal but an opaque one to debug.
 *
 * Enabling is a second call on purpose -- a declaration says a target exists, an
 * enable says it may be faulted -- and needs SIMULATION_ADMIN_ROLE=safety-admin.
 *
 *   node ops/lab-register-targets.mjs [--nodes 4]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { labNodeAddress, labNodeName } from '../server/dist/simulator/labCompose.js';
import { labPaths } from './lab-paths.mjs';
import { docker, rpc } from './lab-rpc.mjs';

const API = process.env.LAB_API ?? 'http://127.0.0.1:4210';
const ADMIN_KEY =
  process.env.ADMIN_API_KEY ?? readFileSync(resolve(labPaths.stateDir, 'admin-key'), 'utf8').trim();
const at = process.argv.indexOf('--nodes');
const NODES = Number(at === -1 ? 4 : process.argv[at + 1]);
const WALLET_NODE = labNodeName(1);

async function api(method, path, body) {
  const response = await fetch(`${API}/api/v1/simulations${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-admin-api-key': ADMIN_KEY,
      // The control API refuses a caller that has not identified itself as a
      // deliberate client, so a stray curl cannot drive a live run.
      'x-simulation-client': 'deftrack-cli-v1',
      'x-idempotency-key': `lab-register-${path.replace(/\W+/g, '-')}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (payload.success !== true) throw new Error(`${method} ${path} -> ${response.status} ${payload.error}`);
  return payload.data;
}

const registered = new Map(
  (await rpc(WALLET_NODE, 'protx', ['list', 'registered', true])).map((entry) => [entry.state?.service, entry])
);

let skipped = 0;
for (let index = 2; index <= NODES; index++) {
  const name = labNodeName(index);
  const service = `${labNodeAddress(index)}:19799`;
  const entry = registered.get(service);
  if (entry === undefined) throw new Error(`${name} is not a registered masternode at ${service}`);
  // A banned masternode cannot be resolved -- MASTERNODE_NOT_ACTIVE -- and the
  // inventory is all-or-nothing, so declaring one here blocks EVERY run, not
  // just the ones that would have used it. It is not a target until it is
  // revived; ops/lab-revive.mjs does that, and re-running this adds it back.
  if ((entry.state?.PoSeBanHeight ?? -1) !== -1) {
    // Disabled, not merely skipped. Skipping only declines to ADD it; an entry
    // declared before the ban would stay enabled and keep poisoning the whole
    // inventory. Disabling needs no privilege -- taking a target out of reach is
    // always safe -- and re-running after a revive enables it again.
    await api('POST', `/targets/${name}/disable`, {}).catch(() => undefined);
    console.log(`${name} DISABLED: PoSe-banned at height ${entry.state.PoSeBanHeight}; revive it first`);
    skipped++;
    continue;
  }

  await api('PUT', `/targets/${name}`, {
    displayLabel: name,
    operatorId: 'lab',
    proTxHash: entry.proTxHash,
    // The container the executor acts on, and separately the address the chain
    // knows this node by. They are the same string on the devnet and cannot be
    // here: `docker` takes a container name, a ProTx records an IP.
    hostRef: name,
    chainHostRef: labNodeAddress(index),
    // The build the run pins. Read from the container rather than configured:
    // the point of the pin is that it matches what is actually running.
    expectedBuild: docker(['exec', name, 'sha256sum', '/usr/local/bin/defcond']).split(/\s+/)[0],
    unitRef: name,
    p2pPort: 19799,
    role: 'masternode',
    network: 'regtest',
    // Everything a lab container can actually take. `partition-p2p` was missing,
    // so node-isolation was refused as CAPABILITY_MISSING on nodes that can
    // plainly be partitioned -- the tc mechanism was proven by hand on one of
    // them. A capability the target does not really have would be worse, so this
    // list is what the compose grants: NET_ADMIN, its own interface, and a
    // container the executor may stop.
    capabilities: ['service-control', 'netem-p2p', 'partition-p2p'],
    labels: ['lab'],
  });
  await api('POST', `/targets/${name}/enable`);
  console.log(`${name} declared and enabled (${entry.proTxHash.slice(0, 16)}...)`);
}

const { total } = await api('GET', '/targets?network=regtest');
console.log(`registry holds ${total} regtest target(s)`);
if (skipped > 0) {
  console.log(`${skipped} banned masternode(s) left out; run ops/lab-revive.mjs, then this again`);
}
