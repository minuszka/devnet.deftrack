// One-off: fill `commitmentVersion`, `observedCount`, `unobservedIndices` and
// `unobservedProTxHashes` on the epoch rows written before the explorer read
// them.
//
// Why a backfill and not a default. The node reports `observedCount` and
// `unobservedIndices` for BOTH commitment formats, in the same shape
// (`CPoSeServiceCommitment::ToJson`, evo/pose_service.h), so under version 1
// the honest values are "everyone observed, nobody unobserved". It would
// therefore be tempting to write those numbers into the old rows from the
// version alone. This script does not: it re-reads each boundary block and
// stores what the chain says. The difference matters exactly once -- if a row
// were ever filled from an assumption that turned out wrong, nothing in the
// record would show which rows were read and which were guessed.
//
// Rows whose boundary block cannot be re-read are left untouched and reported.
// A null field reads as "not read" in the view, which is true; a zero would
// read as "nobody unobserved", which would be the very claim format version 2
// exists to stop the explorer making for free.
//
// Idempotent: only rows with `commitmentVersion` unset are considered, and only
// `committed` rows have anything to read. Absent rows keep their nulls, which
// is what they mean.
//
// Run from the app root with the server's .env loaded:
//   node ops/backfill-epoch-observed.cjs --dry-run   # prints what would change
//   node ops/backfill-epoch-observed.cjs             # writes

const mongoose = require('mongoose');
require('dotenv').config();

// The same four variables the server reads (server/src/config.ts), not a set
// invented here: a backfill that needs its own credentials is one more thing
// to keep in step with the deployment.
function rpcCall(method, params) {
  const host = process.env.RPC_HOST ?? '127.0.0.1';
  const port = process.env.RPC_PORT;
  const user = process.env.RPC_USER;
  const pass = process.env.RPC_PASS;
  if (!port || !user || !pass) throw new Error('RPC_PORT / RPC_USER / RPC_PASS are not set');
  const url = `http://${host}:${port}/`;
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'backfill', method, params }),
  })
    .then((r) => r.json())
    .then((j) => {
      if (j.error) throw new Error(`${method}: ${j.error.message}`);
      return j.result;
    });
}

/**
 * Mongoose pluralises `ServiceEpoch` to `serviceepoches`, not `serviceepochs`:
 * the -es follows the "ch". The first version of this script guessed the other
 * spelling, found an empty collection and reported "0 rows to fill" as if the
 * work were already done -- caught only because the API was answering null for
 * the same rows in the same minute. A wrong collection name is otherwise
 * indistinguishable from a finished job, which is the more dangerous of the
 * two, so the name is checked against what the database actually has.
 */
const COLLECTION = 'serviceepoches';

async function collectionOrRefuse(db) {
  const names = (await db.listCollections().toArray()).map((c) => c.name);
  if (!names.includes(COLLECTION)) {
    throw new Error(
      `collection "${COLLECTION}" does not exist in this database. Available: ${names.sort().join(', ')}`
    );
  }
  return db.collection(COLLECTION);
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const epochs = await collectionOrRefuse(db);

  const rows = await epochs
    .find({ status: 'committed', commitmentVersion: { $in: [null, undefined] } })
    .sort({ boundaryHeight: 1 })
    .toArray();
  console.log(`${rows.length} committed epoch row(s) without a recorded version`);

  let filled = 0;
  let unreadable = 0;
  for (const row of rows) {
    let commitment;
    try {
      const block = await rpcCall('getblock', [row.boundaryBlockHash, 2]);
      const tx = (block.tx || []).find((t) => t.type === 10);
      commitment = tx && tx.poseServiceTx && tx.poseServiceTx.commitment;
    } catch (error) {
      console.log(`  epoch ${row.epoch} (block ${row.boundaryHeight}): unreadable -- ${error.message}`);
      unreadable++;
      continue;
    }
    if (!commitment) {
      // The row says committed and the block carries no commitment: that is a
      // disagreement worth naming, not a row to patch quietly.
      console.log(`  epoch ${row.epoch} (block ${row.boundaryHeight}): row says committed, block has no type-10 -- LEFT ALONE`);
      unreadable++;
      continue;
    }
    if (commitment.observedCount === undefined) {
      console.log(`  epoch ${row.epoch}: node did not report observedCount (pre-#231 RPC) -- left alone`);
      unreadable++;
      continue;
    }

    const update = {
      commitmentVersion: commitment.version ?? null,
      observedCount: commitment.observedCount,
      unobservedIndices: commitment.unobservedIndices ?? [],
    };
    console.log(
      `  epoch ${row.epoch}: version ${update.commitmentVersion}, observed ${update.observedCount}` +
        `/${row.listSize ?? '?'}, unobserved ${update.unobservedIndices.length}`
    );
    if (!dry) {
      // unobservedProTxHashes is deliberately NOT resolved here: it needs the
      // epoch-base masternode list, and the collector's resolver refuses a
      // partial answer. An empty list beside a non-empty index list means "not
      // resolved", which the view already distinguishes.
      await epochs.updateOne({ _id: row._id }, { $set: update });
    }
    filled++;
  }

  console.log(`${dry ? 'would fill' : 'filled'} ${filled}, left alone ${unreadable}`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
