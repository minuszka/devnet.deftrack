#!/usr/bin/env node
/**
 * Brings a regtest lab up to the point where a live simulation run can be armed.
 *
 * Until now the lab could be created but never armed: the compose nodes were
 * plain regtest daemons, so a masternode target could not be resolved at all
 * (`MISSING_PROTX_MAPPING`), a quorum scenario found no members, and the
 * baseline could not reach its DKG rounds. This registers real masternodes on
 * the lab chain so those checks have something true to read.
 *
 * Node 1 is deliberately NOT a masternode. The daemon soft-sets
 * `disablewallet=1` whenever a BLS key is present and refuses to start if that is
 * overridden, so the lab needs one node left holding the wallet -- it funds the
 * collaterals and mines the blocks that confirm them.
 *
 *   node ops/lab-bringup.mjs --nodes 4
 *
 * Re-running is safe: nodes already registered are left alone.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  generateLabCompose,
  labNodeAddress,
  labNodeName,
  toComposeDocument,
} from '../server/dist/simulator/labCompose.js';

const DOCKER = process.env.DOCKER_BIN ?? 'docker';
const COMPOSE_FILE = process.env.LAB_COMPOSE_FILE ?? 'lab-compose.yml';
/**
 * Where the generated operator secrets live between runs.
 *
 * They cannot be recovered from the chain -- a ProTx records only the operator
 * PUBLIC key -- so without this a second run would regenerate the compose with no
 * keys, find every node already registered, and leave the whole lab restarted as
 * plain nodes. Nothing would error; the masternodes would simply be gone.
 * Gitignored with the compose it feeds.
 */
const KEY_FILE = process.env.LAB_KEY_FILE ?? 'lab-masternode-keys.json';
const DATADIR = process.env.LAB_DATADIR ?? '/var/lib/defcon';
const CHAIN = 'regtest';
// DIP0003 enforcement is height 500 on regtest; collaterals also need depth.
const MINE_TO_HEIGHT = Number(process.env.LAB_MINE_TO ?? 600);
const COLLATERAL = 1000;

/**
 * The sporks a fault lab needs on, and why each one.
 *
 * Every spork defaults to 4070908800 -- a timestamp in 2099, i.e. off. With
 * SPORK_17 off no DKG session runs at all, so the chain still mines the
 * commitments each block requires, but null ones: a lab that looks like it is
 * holding rounds while forming nothing. Value 0 means "active since the epoch".
 */
const LAB_SPORKS = [
  'SPORK_17_QUORUM_DKG_ENABLED',
  'SPORK_19_CHAINLOCKS_ENABLED',
  // Both PoSe paths: SPORK_23 gates punishment at all, SPORK_21 gates the
  // not-connected branch. A lab measuring exclusions needs both live, or it
  // measures a network that cannot punish.
  'SPORK_21_QUORUM_ALL_CONNECTED',
  'SPORK_23_QUORUM_POSE',
  'SPORK_2_INSTANTSEND_ENABLED',
  'SPORK_3_INSTANTSEND_BLOCK_FILTERING',
];

const nodes = Number(process.argv[process.argv.indexOf('--nodes') + 1] || 4);
if (!Number.isInteger(nodes) || nodes < 2) {
  console.error('--nodes must be at least 2: one wallet node plus at least one masternode');
  process.exit(1);
}
const WALLET_NODE = labNodeName(1);
const MASTERNODES = Array.from({ length: nodes - 1 }, (_, i) => labNodeName(i + 2));

function docker(args, { quiet = false } = {}) {
  const r = spawnSync(DOCKER, args, { encoding: 'utf8' });
  if (r.status !== 0 && !quiet) throw new Error(`docker ${args.join(' ')}: ${(r.stderr ?? '').trim()}`);
  return (r.stdout ?? '').trim();
}

function compose(args) {
  const r = spawnSync(DOCKER, ['compose', '-f', COMPOSE_FILE, ...args], { encoding: 'utf8', stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`docker compose ${args.join(' ')} failed`);
}

/** Each node answers on its own published port, with its own cookie. */
function endpointOf(container) {
  const published = docker(['port', container, '19798']).split('\n')[0] ?? '';
  const port = /:(\d+)\s*$/.exec(published.trim())?.[1];
  if (port === undefined) throw new Error(`${container} publishes no RPC port`);
  return `http://127.0.0.1:${port}/`;
}

function cookieOf(container) {
  return docker(['exec', container, 'cat', `${DATADIR}/${CHAIN}/.cookie`]);
}

async function rpc(container, method, params = []) {
  const res = await fetch(endpointOf(container), {
    method: 'POST',
    headers: {
      'content-type': 'text/plain',
      authorization: `Basic ${Buffer.from(cookieOf(container)).toString('base64')}`,
    },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'lab-bringup', method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${container} ${method}: ${body.error.message}`);
  return body.result;
}

/**
 * The address this node will register at -- computed from the topology, not read
 * back from the running container.
 *
 * Reading it back was wrong and looked right: Docker assigns addresses in start
 * order, so recreating the stack to hand out the operator keys permuted them, and
 * every masternode ended up holding a key for a ProTx naming a different
 * container. The compose now pins the address, so this is the same value the node
 * will actually have.
 */
function labAddressOf(container) {
  const index = Number(container.replace(/^mn/, ''));
  return `${labNodeAddress(index)}:19799`;
}

/** Guards the claim above: the pinned address is the one Docker really gave. */
function assertAddressPinned(container) {
  const actual = docker(['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', container]);
  const expected = labAddressOf(container).split(':')[0];
  if (actual !== expected) {
    throw new Error(`${container} is at ${actual}, but its topology pins ${expected}`);
  }
}

/**
 * An address holding enough mature coin to fund one collateral.
 *
 * `register_fund` funds from `fundAddress`, and when that argument is omitted it
 * falls back to the COLLATERAL address -- which is freshly created and empty, so
 * omitting it always fails. It must also be re-read per registration: a single
 * coinbase output here is millions, so the first registration spends it whole and
 * sends the change to some other address in the wallet.
 */
async function pickFundAddress(container, need) {
  const unspent = await rpc(container, 'listunspent', [26]);
  const byAddress = new Map();
  for (const utxo of unspent) {
    if (utxo.address === undefined || utxo.spendable !== true) continue;
    byAddress.set(utxo.address, (byAddress.get(utxo.address) ?? 0) + utxo.amount);
  }
  for (const [address, amount] of byAddress) if (amount >= need) return address;
  throw new Error(`no single address holds ${need} in mature coin`);
}

/**
 * Drives a node to `IsSynced`, which on a lab chain it will not reach alone.
 *
 * This is not cosmetic either: a masternode REFUSES INCOMING CONNECTIONS while
 * IsSynced is false, so every quorum connection stays `connected: false` and no
 * DKG session can gather a single contribution. The lab still mines its
 * commitments -- null ones -- so the failure presents as rounds that hold and
 * form nothing. Upstream's own regtest helper does exactly this.
 *
 * Sync also resets on restart, so it has to be re-driven after every recreate.
 */
async function forceFinishSync(container, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    if ((await rpc(container, 'mnsync', ['status'])).IsSynced === true) return;
    await rpc(container, 'mnsync', ['next']);
  }
  throw new Error(`${container} never reached IsSynced`);
}

async function waitForRpc(container, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      await rpc(container, 'getblockcount');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw new Error(`${container} never answered RPC`);
}

function readStoredKeys() {
  if (!existsSync(KEY_FILE)) return {};
  return JSON.parse(readFileSync(KEY_FILE, 'utf8'));
}

function writeStoredKeys(keys) {
  writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

function writeCompose(masternodeKeys) {
  const spec = generateLabCompose({ nodes, masternodeKeys });
  writeFileSync(COMPOSE_FILE, toComposeDocument(spec));
  return spec;
}

async function main() {
  console.log(`lab bring-up: ${nodes} nodes -- ${WALLET_NODE} holds the wallet, ${MASTERNODES.join(', ')} become masternodes`);

  console.log('1. starting the lab');
  // Seeded with whatever this lab already has, so a re-run cannot demote a
  // masternode it merely failed to re-register.
  const keys = readStoredKeys();
  writeCompose(keys);
  compose(['up', '-d']);
  for (const name of [WALLET_NODE, ...MASTERNODES]) {
    await waitForRpc(name);
    assertAddressPinned(name);
    await forceFinishSync(name);
  }

  console.log('2. funding the wallet node');
  // The image may or may not have created a default wallet at first start, and a
  // second loaded wallet would make every unqualified wallet RPC ambiguous. So
  // create one only if the node has none, and never assume which it is.
  const wallets = await rpc(WALLET_NODE, 'listwallets');
  if (wallets.length === 0) {
    // descriptors=true: the lab image is built --without-bdb and cannot create a
    // legacy wallet at all.
    await rpc(WALLET_NODE, 'createwallet', ['lab', false, false, '', false, true, true]);
  }
  const miningAddress = await rpc(WALLET_NODE, 'getnewaddress');
  let height = await rpc(WALLET_NODE, 'getblockcount');
  if (height < MINE_TO_HEIGHT) {
    // DIP0003 enforcement is height 500 here; below it a ProTx is not accepted.
    await rpc(WALLET_NODE, 'generatetoaddress', [MINE_TO_HEIGHT - height, miningAddress]);
    height = await rpc(WALLET_NODE, 'getblockcount');
  }
  const balance = await rpc(WALLET_NODE, 'getbalance');
  console.log(`   height ${height}, spendable ${balance}`);
  if (balance < COLLATERAL * MASTERNODES.length) {
    throw new Error(`balance ${balance} cannot fund ${MASTERNODES.length} collaterals of ${COLLATERAL}`);
  }

  console.log('3. enabling the sporks the lab measures through');
  const sporks = await rpc(WALLET_NODE, 'spork', ['show']);
  for (const name of LAB_SPORKS) {
    if (sporks[name] === 0) continue;
    await rpc(WALLET_NODE, 'sporkupdate', [name, 0]);
  }
  // Read back rather than trust the calls: an unsigned spork is accepted by the
  // RPC and simply never propagates.
  const active = await rpc(WALLET_NODE, 'spork', ['show']);
  const inert = LAB_SPORKS.filter((name) => active[name] !== 0);
  if (inert.length > 0) throw new Error(`sporks did not take effect: ${inert.join(', ')}`);
  console.log(`   ${LAB_SPORKS.length} sporks active`);

  console.log('4. registering a masternode per node');
  const registered = new Map(
    (await rpc(WALLET_NODE, 'protx', ['list', 'registered', true])).map((entry) => [entry.state?.service, entry])
  );
  let added = 0;
  for (const name of MASTERNODES) {
    const service = labAddressOf(name);
    if (registered.has(service)) {
      if (keys[name] === undefined) {
        // Registered on-chain with an operator key this host no longer holds: the
        // node can never sign for it again, and no amount of restarting helps.
        throw new Error(`${name} is registered at ${service} but its operator key is missing; wipe the lab`);
      }
      console.log(`   ${name} already registered at ${service}`);
      continue;
    }
    // Generated on the wallet node, not on the node that will hold it: `bls
    // generate` is wallet-gated on this build, and the nodes that become
    // masternodes are exactly the ones with no wallet.
    const bls = await rpc(WALLET_NODE, 'bls', ['generate']);
    const collateralAddress = await rpc(WALLET_NODE, 'getnewaddress');
    const ownerAddress = await rpc(WALLET_NODE, 'getnewaddress');
    const votingAddress = await rpc(WALLET_NODE, 'getnewaddress');
    const payoutAddress = await rpc(WALLET_NODE, 'getnewaddress');
    const fundAddress = await pickFundAddress(WALLET_NODE, COLLATERAL + 1);
    const txid = await rpc(WALLET_NODE, 'protx', [
      'register_fund', collateralAddress, service, ownerAddress, bls.public, votingAddress, 0, payoutAddress,
      fundAddress,
    ]);
    keys[name] = bls.secret;
    added++;
    // Persisted before the node is ever started with it: a crash between the
    // registration and the restart must not orphan a live ProTx.
    writeStoredKeys(keys);
    console.log(`   ${name} -> ${service} (${String(txid).slice(0, 16)}...)`);
  }

  if (added > 0) {
    console.log('5. confirming the registrations');
    await rpc(WALLET_NODE, 'generatetoaddress', [8, miningAddress]);

    console.log('6. restarting the registered nodes AS masternodes');
    writeCompose(keys);
    compose(['up', '-d']);
    for (const name of MASTERNODES) {
      await waitForRpc(name);
      // The recreate must not have moved anyone: a masternode at an address its
      // ProTx does not name never recognises itself, and says nothing about it.
      assertAddressPinned(name);
      await forceFinishSync(name);
    }
    await rpc(WALLET_NODE, 'generatetoaddress', [4, miningAddress]);
  }

  /*
   * Waits for the registrations to be MINED, not merely sent.
   *
   * They sit in the mempool for ten minutes and there is nothing wrong with
   * them: BlockAssembler drops any package that is not InstantSend-locked until
   * the transaction is 600 s old, and a lab with no InstantSend quorum can never
   * produce that lock. Mining more blocks changes nothing.
   *
   * An earlier version printed the list immediately and reported 3 where 10 were
   * on their way, which reads as a failed bring-up. The revive script had the
   * same flaw and was fixed the same way: wait on the outcome.
   */
  const expected = MASTERNODES.length;
  const deadlineMs = Date.now() + 20 * 60_000;
  let list = await rpc(WALLET_NODE, 'protx', ['list', 'registered', true]);
  if (list.length < expected) {
    process.stdout.write(
      `waiting for ${expected - list.length} registration(s) to be mined; ` +
        'the InstantSend timeout is ten minutes and cannot be hurried'
    );
    while (list.length < expected) {
      if (Date.now() > deadlineMs) {
        throw new Error(`only ${list.length} of ${expected} registrations were mined within 20 minutes`);
      }
      process.stdout.write('.');
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      list = await rpc(WALLET_NODE, 'protx', ['list', 'registered', true]);
    }
    console.log('');
  }

  console.log(`\nregistered masternodes: ${list.length}`);
  for (const entry of list) {
    console.log(`  ${entry.proTxHash?.slice(0, 16)}... ${entry.state?.service} PoSePenalty=${entry.state?.PoSePenalty ?? '?'}`);
  }
}

await main();
