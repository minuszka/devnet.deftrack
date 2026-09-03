#!/usr/bin/env node
/**
 * Produces blocks on the regtest lab at a steady interval.
 *
 * Regtest mints nothing on its own, and a chain that does not advance is not a
 * quiet lab -- it is a stalled one, and every freshness check says so. The
 * explorer-synced preflight reads the age of the newest indexed block, so with
 * no miner a lab that is perfectly healthy fails at lag=0 with an age of
 * minutes; the baseline never accumulates its DKG rounds; and no ChainLock is
 * ever signed.
 *
 * The interval matters as much as the fact of mining. A DKG runs in six
 * height-driven phases and the members need wall-clock time inside each one, so
 * mining a whole interval at once forms nothing (see ops/lab-mine-quorum.mjs).
 * One block every few seconds gives each phase real time and lets rounds form on
 * their own, the way they do on a real chain.
 *
 *   node ops/lab-miner.mjs [--interval 10]
 */

import { labNodeName } from '../server/dist/simulator/labCompose.js';
import { rpc } from './lab-rpc.mjs';

const at = process.argv.indexOf('--interval');
const INTERVAL_MS = Number(at === -1 ? (process.env.LAB_MINER_INTERVAL_MS ?? 10_000) : Number(process.argv[at + 1]) * 1000);
const WALLET_NODE = process.env.LAB_MINER_NODE ?? labNodeName(1);

const address = await rpc(WALLET_NODE, 'getnewaddress');
console.log(`lab miner: one block every ${INTERVAL_MS} ms on ${WALLET_NODE}`);

let failures = 0;
for (;;) {
  try {
    await rpc(WALLET_NODE, 'generatetoaddress', [1, address]);
    failures = 0;
  } catch (error) {
    // Never exit on a single failure: the node is restarted deliberately during
    // a fault run, and a miner that dies with it turns a 60-second outage into a
    // permanently stalled chain.
    failures++;
    if (failures === 1 || failures % 10 === 0) {
      console.error(`mine failed (${failures}): ${(error instanceof Error ? error.message : String(error))}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}
