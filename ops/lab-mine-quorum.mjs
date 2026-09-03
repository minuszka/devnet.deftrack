#!/usr/bin/env node
/**
 * Mines one real LLMQ quorum on the regtest lab.
 *
 * Blocks alone do not form a quorum. A DKG runs in six height-driven phases, and
 * mining an interval in one burst passes all six in milliseconds -- the members
 * never get the wall-clock time to exchange contributions, so every session
 * initialises, forms nothing, and the chain mines a NULL commitment. That reads
 * from outside exactly like a lab holding rounds: `numCommitmentsInNewBlock` is
 * non-zero and `quorum list` stays empty.
 *
 * So this advances the chain the way the node expects: align to the interval,
 * then wait for each phase to be reported by every member before moving two
 * blocks on. It mirrors upstream's own regtest quorum helper, which exists for
 * the same reason.
 *
 *   node ops/lab-mine-quorum.mjs [--type llmq_test] [--nodes 4]
 */

import { labNodeName } from '../server/dist/simulator/labCompose.js';
import { rpc, waitUntil } from './lab-rpc.mjs';

const DKG_INTERVAL = 24;
/** The DKG phases, in the order the session walks them. */
const PHASES = [
  { phase: 1, name: 'init', counter: null },
  { phase: 2, name: 'contribute', counter: 'receivedContributions' },
  { phase: 3, name: 'complain', counter: null },
  { phase: 4, name: 'justify', counter: null },
  { phase: 5, name: 'commit', counter: 'receivedPrematureCommitments' },
  { phase: 6, name: 'mining', counter: null },
];

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};
const LLMQ_TYPE_NAME = arg('--type', 'llmq_test');
const NODES = Number(arg('--nodes', '4'));
const WALLET_NODE = labNodeName(1);
const MEMBERS = Array.from({ length: NODES - 1 }, (_, i) => labNodeName(i + 2));

async function mine(count) {
  const address = await rpc(WALLET_NODE, 'getnewaddress');
  await rpc(WALLET_NODE, 'generatetoaddress', [count, address]);
}

/** Every member is at `phase` for this quorum, having received `min` messages. */
async function waitForPhase(quorumHash, { phase, name, counter }, expected) {
  await waitUntil(`phase ${phase} (${name})`, async () => {
    for (const member of MEMBERS) {
      const sessions = (await rpc(member, 'quorum', ['dkgstatus'])).session ?? [];
      const session = sessions.find(
        (entry) => entry.llmqType === LLMQ_TYPE_NAME && entry.status?.quorumHash === quorumHash
      );
      if (session === undefined || session.status.phase !== phase) return false;
      if (counter !== null && (session.status[counter] ?? 0) < expected) return false;
    }
    return true;
  });
}

async function main() {
  const startHeight = await rpc(WALLET_NODE, 'getblockcount');
  const skip = DKG_INTERVAL - (startHeight % DKG_INTERVAL);
  if (skip !== DKG_INTERVAL) await mine(skip);

  // The quorum is keyed on the block that starts the cycle, so it is fixed the
  // moment the chain lands on the interval boundary.
  const quorumHash = await rpc(WALLET_NODE, 'getbestblockhash');
  console.log(`mining ${LLMQ_TYPE_NAME} quorum ${quorumHash.slice(0, 16)}... at height ${await rpc(WALLET_NODE, 'getblockcount')}`);

  for (const step of PHASES) {
    await waitForPhase(quorumHash, step, MEMBERS.length);
    console.log(`  phase ${step.phase} ${step.name}`);
    if (step.phase !== 6) await mine(2);
  }

  // A final commitment every member can mine, before asking for the block that
  // mines it -- otherwise the block is empty and the round is lost.
  await waitUntil('a minable commitment', async () => {
    for (const node of [WALLET_NODE, ...MEMBERS]) {
      const commitments = (await rpc(node, 'quorum', ['dkgstatus'])).minableCommitments ?? [];
      if (!commitments.some((c) => c.quorumHash === quorumHash)) return false;
    }
    return true;
  });
  await mine(1);

  await waitUntil('the quorum to appear in the list', async () =>
    ((await rpc(WALLET_NODE, 'quorum', ['list']))[LLMQ_TYPE_NAME] ?? []).includes(quorumHash)
  );
  const info = await rpc(WALLET_NODE, 'quorum', ['listextended']);
  console.log(`formed: ${JSON.stringify(info[LLMQ_TYPE_NAME])}`);
}

await main();
