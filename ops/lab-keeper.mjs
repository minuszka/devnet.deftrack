#!/usr/bin/env node
/**
 * Keeps the lab's masternodes able to peer at all.
 *
 * A masternode refuses to hold connections while `IsSynced` is false, and
 * `mnsync` resets on every restart -- so a node the simulator stops and starts
 * comes back, dials its ring peers, drops every one of them, and sits at zero
 * peers for ever. It is not banned, not misconfigured and not behind by any
 * measure the explorer reads: it is simply unable to rejoin, silently, and every
 * measurement taken afterwards is over a network missing a node.
 *
 * The bring-up drives this once, but a fault run restarts nodes long after that,
 * which is exactly when it matters. Upstream's own regtest helper does the same
 * thing for the same stated reason.
 *
 * It is a KEEPER, not an observer: it acts. Kept out of ops/lab-observer.mjs
 * deliberately, because an observer that also intervenes cannot be trusted to
 * report what it found.
 *
 * Measurement caveat, and it is a real one: a lab node rejoins faster than a
 * devnet node would, because this pushes it. Rejoin latency measured here is a
 * property of the lab, not of the network.
 *
 *   node ops/lab-keeper.mjs [--nodes 11]
 */

import { labNodeName } from '../server/dist/simulator/labCompose.js';
import { rpc } from './lab-rpc.mjs';

const at = process.argv.indexOf('--nodes');
const NODES = Number(at === -1 ? 4 : process.argv[at + 1]);
const INTERVAL_MS = Number(process.env.LAB_KEEPER_INTERVAL_MS ?? 10_000);
/** Bounded per pass: a node that will not sync must not spin the keeper. */
const MAX_PUSHES = 40;

const containers = Array.from({ length: NODES }, (_, index) => labNodeName(index + 1));

async function keepOne(container) {
  const status = await rpc(container, 'mnsync', ['status']);
  if (status.IsSynced === true) return false;
  for (let push = 0; push < MAX_PUSHES; push++) {
    await rpc(container, 'mnsync', ['next']);
    if ((await rpc(container, 'mnsync', ['status'])).IsSynced === true) {
      console.log(`${container} driven to IsSynced after ${push + 1} push(es)`);
      return true;
    }
  }
  console.error(`${container} did not reach IsSynced within ${MAX_PUSHES} pushes`);
  return false;
}

async function pass() {
  // Concurrent, like the observer: a sequential pass over eleven nodes takes
  // longer than the interval and leaves the last ones waiting longest -- which
  // is the opposite of what a keeper is for.
  await Promise.all(
    containers.map(async (container) => {
      try {
        await keepOne(container);
      } catch (error) {
        // A stopped container is unreachable BY DESIGN during a fault run. That
        // is not a keeper failure and must not end the keeper; it is picked up
        // on the pass after it comes back.
        if (!/No such container|is not running|ECONNREFUSED|fetch failed/i.test(String(error.message))) {
          console.error(`${container}: ${error.message}`);
        }
      }
    })
  );
}

console.log(`lab keeper: driving mnsync on ${containers.length} node(s) every ${INTERVAL_MS} ms`);
await pass();
setInterval(() => void pass(), INTERVAL_MS);
