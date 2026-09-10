// One-off: mark as `impossible` the rounds that were recorded as `failed` before
// the explorer could tell the two apart.
//
// `impossible` is not a softer word for `failed` (domain/dkgSchedule.ts): a
// profile that needs more members than the network has cannot form however
// well every masternode behaves, and counting those as failures reports a
// fault where the arithmetic allowed no result. The status was introduced after
// the chain's first days, so eleven llmq_400_60 rounds at heights 648-1368 --
// scheduled before the first masternode registered at 1419 -- sit on record as
// failures with nobody to fail. Every all-time failure statistic is eleven too
// high, and the rounds-to-runs join (2026-09-10) showed them as the only failed
// rounds not covered by a declared intervention, which they are not: they are
// not failures.
//
// The rule applied is the one the collector applies today, from the data
// already on disk: masternodes available at the round's base block, counted by
// `registeredHeight` from the current list (a lower bound -- a masternode later
// removed still counts for the height it was registered at, which can only make
// a round *less* impossible, never more); effectiveSize = min(size, available);
// impossible iff effectiveSize < minSize. Nothing is hardcoded to 1419.
//
// Idempotent: only `failed` rows can change, and each is judged from its own
// size, minSize and base height. A formed round is never touched, whatever the
// arithmetic says -- observation outranks it.
//
// Run from the app root with the server's .env loaded:
//   node ops/backfill-impossible-rounds.cjs --dry-run   # prints what would change
//   node ops/backfill-impossible-rounds.cjs             # writes

const mongoose = require('mongoose');
require('dotenv').config();

async function main() {
  const dry = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // Registration heights of every masternode ever indexed, active or not.
  const registered = (
    await db
      .collection('masternodestates')
      .find({ registeredHeight: { $gte: 0 } }, { projection: { registeredHeight: 1 } })
      .toArray()
  )
    .map((m) => m.registeredHeight)
    .sort((a, b) => a - b);
  const availableAt = (height) => registered.filter((h) => h <= height).length;
  console.log(`masternodes on record: ${registered.length}, first registered at ${registered[0] ?? 'n/a'}`);

  const rounds = db.collection('quorumrounds');
  const failed = await rounds
    .find({ status: 'failed' }, { projection: { roundKey: 1, llmqName: 1, expectedHeight: 1, size: 1, minSize: 1, effectiveSize: 1, consecutiveFailures: 1 } })
    .sort({ expectedHeight: 1 })
    .toArray();
  console.log(`failed rounds on record: ${failed.length}`);

  const toFlip = [];
  for (const r of failed) {
    if (typeof r.size !== 'number' || typeof r.minSize !== 'number') {
      console.log(`  skip ${r.roundKey}: size/minSize not on the row`);
      continue;
    }
    const available = availableAt(r.expectedHeight);
    const effectiveSize = Math.min(r.size, available);
    if (effectiveSize < r.minSize) toFlip.push({ ...r, available, effectiveSize });
  }

  console.log(`rounds that could not have formed (effectiveSize < minSize): ${toFlip.length}`);
  for (const r of toFlip) {
    console.log(
      `  ${r.llmqName.padEnd(12)} h=${String(r.expectedHeight).padStart(6)}  available=${r.available}  ` +
        `effectiveSize=${r.effectiveSize} < minSize=${r.minSize}  (stored effectiveSize=${r.effectiveSize ?? 'null'}, consecutiveFailures=${r.consecutiveFailures})`
    );
  }
  // The first still-failed round after the flipped ones carries a streak that
  // counted them. Reported, not rewritten: streaks over the schedule are the
  // domain's to recompute, and a number changed by hand here would be one more
  // stored value with no derivation behind it.
  const flipped = new Set(toFlip.map((r) => r.roundKey));
  const firstReal = failed.find((r) => !flipped.has(r.roundKey));
  if (firstReal) {
    console.log(
      `first failed round left standing: ${firstReal.llmqName} h=${firstReal.expectedHeight}, stored consecutiveFailures=${firstReal.consecutiveFailures}`
    );
  }

  if (dry) {
    console.log('dry run: nothing written');
    return;
  }
  if (toFlip.length === 0) {
    console.log('nothing to do');
    return;
  }
  const res = await rounds.bulkWrite(
    toFlip.map((r) => ({
      updateOne: {
        // Re-checked on write so a row that changed since the read is left alone.
        filter: { roundKey: r.roundKey, status: 'failed' },
        update: { $set: { status: 'impossible', effectiveSize: r.effectiveSize, consecutiveFailures: 0 } },
      },
    })),
    { ordered: false }
  );
  console.log(`marked impossible: ${res.modifiedCount} of ${toFlip.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
