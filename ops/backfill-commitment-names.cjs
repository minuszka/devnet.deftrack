// One-off: give a name to commitments that were stored before the registry knew
// their quorum type.
//
// The collector resolves llmqName by looking llmqType up in LLMQ_PROFILES. That
// registry held only llmq_400_60 and llmq_devnet for most of this chain's life,
// so every commitment of any other type was written with llmqName: null. The
// type number was always stored correctly, so the name is derivable from what is
// already on disk -- this fills it in, it does not invent anything.
//
// Idempotent: only rows whose llmqName is null are touched, and each is set from
// its own llmqType. Rows whose type has no profile are left alone and reported,
// because a name this deployment cannot justify is worse than no name.
//
// Run from the app root with the server's .env loaded:
//   node ops/backfill-commitment-names.cjs
//   node ops/backfill-commitment-names.cjs --dry-run

const mongoose = require('mongoose');
require('dotenv').config();

// Consensus::LLMQType -> name, from src/llmq/params.h at DeFCoN Core v22.1.4.
// Kept in step with server/src/config/llmq.ts; if that registry gains a profile,
// add it here too.
const NAMES = {
  1: 'llmq_50_60',
  2: 'llmq_400_60',
  3: 'llmq_400_85',
  4: 'llmq_100_67',
  5: 'llmq_60_75',
  101: 'llmq_devnet',
};

async function main() {
  const dry = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await mongoose.connect(uri);
  const col = mongoose.connection.collection('quorumcommitments');

  const missing = await col
    .aggregate([
      { $match: { $or: [{ llmqName: null }, { llmqName: { $exists: false } }] } },
      { $group: { _id: '$llmqType', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  if (missing.length === 0) {
    console.log('nothing to do: every commitment already carries a name');
    return;
  }

  let filled = 0;
  const unknown = [];
  for (const { _id: llmqType, count } of missing) {
    const name = NAMES[llmqType];
    if (!name) {
      unknown.push({ llmqType, count });
      continue;
    }
    console.log(`llmqType ${llmqType} -> ${name}: ${count} row(s)${dry ? ' (dry run)' : ''}`);
    if (!dry) {
      const res = await col.updateMany(
        { llmqType, $or: [{ llmqName: null }, { llmqName: { $exists: false } }] },
        { $set: { llmqName: name } }
      );
      filled += res.modifiedCount;
    }
  }

  if (unknown.length > 0) {
    // Not an error. The chain may run a type this deployment has no profile for,
    // and the number is still the truth -- inventing a name for it would not be.
    console.log('left unnamed, no profile for these types:', JSON.stringify(unknown));
  }
  if (!dry) console.log(`filled ${filled} row(s)`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
