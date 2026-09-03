#!/usr/bin/env node
/**
 * Revives the lab's PoSe-banned masternodes.
 *
 * A fault run does its job: stop a masternode across a DKG contribution window
 * and it is excluded, punished, and -- on a lab of three, where the penalty
 * ceiling is max(100, N) = 100 and one exclusion already costs 66 -- banned by
 * the second one. So a banned node is not a lab fault, it is the measurement
 * landing; but it leaves the lab unable to run the NEXT experiment, because a
 * banned masternode is not a quorum member and `quorum-stable` then resolves
 * fewer members than the registry has targets.
 *
 * A ProUpServTx revives it. The operator key comes from the bring-up's own key
 * file -- the chain records only the public half, so nothing else on this host
 * can produce it.
 *
 * Do not measure in the rounds immediately after this: the revived node rejoins
 * before its DKG mesh has re-formed, and the first rounds after a revive record
 * the intervention rather than the network.
 *
 *   node ops/lab-revive.mjs [--nodes 4]
 */

import { existsSync, readFileSync } from 'node:fs';
import { labNodeAddress, labNodeName } from '../server/dist/simulator/labCompose.js';
import { rpc } from './lab-rpc.mjs';

const KEY_FILE = process.env.LAB_KEY_FILE ?? 'lab-masternode-keys.json';
const at = process.argv.indexOf('--nodes');
const NODES = Number(at === -1 ? 4 : process.argv[at + 1]);
const WALLET_NODE = labNodeName(1);
const COLLATERAL = 1000;

if (!existsSync(KEY_FILE)) {
  console.error(`${KEY_FILE} is missing; without the operator keys nothing here can sign a revival`);
  process.exit(1);
}
const keys = JSON.parse(readFileSync(KEY_FILE, 'utf8'));

/** An address holding mature coin, re-read per call: the fee spends from it. */
async function pickFundAddress(need) {
  const unspent = await rpc(WALLET_NODE, 'listunspent', [26]);
  const byAddress = new Map();
  for (const utxo of unspent) {
    if (utxo.address === undefined || utxo.spendable !== true) continue;
    // Never the collateral itself: spending it destroys the masternode.
    if (utxo.amount === COLLATERAL) continue;
    byAddress.set(utxo.address, (byAddress.get(utxo.address) ?? 0) + utxo.amount);
  }
  for (const [address, amount] of byAddress) if (amount >= need) return address;
  throw new Error(`no single address holds ${need} in mature coin for the revival fee`);
}

const registered = await rpc(WALLET_NODE, 'protx', ['list', 'registered', true]);
const banned = registered.filter((entry) => (entry.state?.PoSeBanHeight ?? -1) !== -1);
if (banned.length === 0) {
  console.log('no banned masternodes');
  process.exit(0);
}

const nameByService = new Map(
  Array.from({ length: NODES - 1 }, (_, i) => i + 2).map((index) => [
    `${labNodeAddress(index)}:19799`,
    labNodeName(index),
  ])
);

for (const entry of banned) {
  const service = entry.state?.service;
  const name = nameByService.get(service);
  if (name === undefined) throw new Error(`banned masternode at ${service} is not a lab node`);
  const operatorKey = keys[name];
  if (operatorKey === undefined) throw new Error(`no operator key for ${name}; wipe and rebuild the lab`);
  const fundAddress = await pickFundAddress(1);
  try {
    const txid = await rpc(WALLET_NODE, 'protx', [
      'update_service', entry.proTxHash, service, operatorKey, '', fundAddress,
    ]);
    console.log(`${name} revival sent for ${service} (${String(txid).slice(0, 16)}...)`);
  } catch (error) {
    // One ProUpServTx per masternode may be in flight, and the previous one sits
    // in the mempool for ten minutes -- so a re-run while a revival is pending is
    // refused as a duplicate. That is the node being right, not a failure: the
    // revival is already on its way, and the wait below is what matters.
    if (!String(error instanceof Error ? error.message : error).includes('protx-dup')) throw error;
    console.log(`${name} revival already pending for ${service}`);
  }
}

/*
 * Waits on the OUTCOME -- the ban clearing -- not on a transaction id.
 *
 * Mining the revival takes ten minutes, and not because it is stuck:
 * BlockAssembler drops any package whose transaction is not InstantSend-locked
 * until `txAge >= WAIT_FOR_ISLOCK_TIMEOUT` (600 s), and a lab with no InstantSend
 * quorum can never produce that lock, so the full timeout is always paid.
 * Raising the fee or mining more blocks changes nothing. An earlier version mined
 * four blocks and printed the still-banned state, which read as a failed
 * revival.
 *
 * Watching the ban rather than the txid also makes a re-run correct while an
 * earlier revival is still in flight, which is exactly when `protx-dup` fires.
 */
const deadlineMs = Date.now() + 20 * 60_000;
process.stdout.write('waiting out the InstantSend timeout before it can be mined');
for (;;) {
  const current = await rpc(WALLET_NODE, 'protx', ['list', 'registered', true]);
  if (!current.some((row) => (row.state?.PoSeBanHeight ?? -1) !== -1)) break;
  if (Date.now() > deadlineMs) throw new Error('still banned after 20 minutes');
  process.stdout.write('.');
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
console.log('');
console.log('revived');

const after = await rpc(WALLET_NODE, 'protx', ['list', 'registered', true]);
for (const entry of after) {
  console.log(
    `  ${entry.proTxHash.slice(0, 12)} ${entry.state?.service}` +
      ` penalty=${entry.state?.PoSePenalty} banHeight=${entry.state?.PoSeBanHeight}`
  );
}
