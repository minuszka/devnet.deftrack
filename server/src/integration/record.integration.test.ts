import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MasternodeEvent } from '../models/MasternodeEvent.js';
import { QuorumRound } from '../models/QuorumRound.js';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, NO_MONGO_REASON, syncIndexes } from './mongo.js';

/**
 * The record's integrity, against a real database.
 *
 * Two of this project's load-bearing claims are claims about MongoDB rather
 * than about our code: a round is written once and never duplicated, and a
 * masternode event is a fact about a moment that a later poll may not rewrite.
 * Both are enforced by a unique index plus `$setOnInsert`, and a fake
 * repository cannot fail either of them -- it has no index. Until now nothing
 * in the suite had ever asked the database.
 */
describe.skipIf(!HAVE_MONGO)('the record, against a real MongoDB', () => {
  beforeAll(async () => {
    await connectTestMongo('record');
    await syncIndexes([QuorumRound, MasternodeEvent]);
  }, 30_000);

  afterAll(async () => {
    await dropTestMongo();
  });

  const roundUpsert = (roundKey: string, patch: Record<string, unknown> = {}) =>
    QuorumRound.updateOne(
      { roundKey },
      {
        $setOnInsert: {
          roundKey,
          llmqType: 7,
          llmqName: 'llmq_defcon',
          quorumIndex: 0,
          expectedHeight: 8_256,
          size: 60,
          minSize: 44,
          threshold: 41,
          dkgInterval: 24,
          firstSeenAt: new Date('2026-09-05T10:00:00Z'),
        },
        $set: {
          status: 'pending',
          formed: false,
          punishedCount: 0,
          detectedAt: new Date(),
          ...patch,
        },
      },
      { upsert: true }
    );

  it('has the unique indexes it says it has', async () => {
    const roundIndexes = await QuorumRound.collection.indexes();
    const eventIndexes = await MasternodeEvent.collection.indexes();
    expect(roundIndexes.some((i) => i.unique === true && i.key.roundKey === 1)).toBe(true);
    expect(eventIndexes.some((i) => i.unique === true && i.key.eventKey === 1)).toBe(true);
  });

  it('writes a round once, however many times the collector sees it', async () => {
    const key = '7:8256:0';
    await roundUpsert(key);
    await roundUpsert(key);
    await roundUpsert(key);

    expect(await QuorumRound.countDocuments({ roundKey: key })).toBe(1);
  });

  // The reason `firstSeenAt` is in `$setOnInsert` and not in `$set`: when the
  // round was first observed is a fact about the observation, and a later poll
  // rewriting it would erase the only evidence of when the record began.
  it('never rewrites what the first observation established', async () => {
    const key = '7:8280:0';
    await roundUpsert(key);
    const first = await QuorumRound.findOne({ roundKey: key }).lean();

    await roundUpsert(key, { status: 'formed', formed: true, punishedCount: 12 });
    const second = await QuorumRound.findOne({ roundKey: key }).lean();

    expect(second!.firstSeenAt).toEqual(first!.firstSeenAt);
    expect(second!.size).toBe(60);
    // The mutable half did move: this is an upsert, not a no-op.
    expect(second!.status).toBe('formed');
    expect(second!.punishedCount).toBe(12);
  });

  /**
   * Two writers, one key.
   *
   * The collector is single-threaded, but a restart overlapping the previous
   * process, or the reconciler running beside the poller, puts two upserts of
   * the same round in flight at once. MongoDB answers one of them with E11000
   * rather than silently merging, and code that does not expect that would
   * crash a poll cycle. Whatever the outcome, the record must hold exactly one
   * document -- that is the property the ban-event collector was audited for
   * and this one inherits.
   */
  it('holds one document when two writers race for the same round', async () => {
    const key = '7:8304:0';
    const outcomes = await Promise.allSettled([
      roundUpsert(key),
      roundUpsert(key),
      roundUpsert(key),
      roundUpsert(key),
    ]);

    expect(await QuorumRound.countDocuments({ roundKey: key })).toBe(1);
    const duplicates = outcomes.filter(
      (o) => o.status === 'rejected' && /E11000|duplicate key/i.test(String(o.reason))
    );
    // Not an assertion that a duplicate error DID happen -- that depends on
    // timing -- but that nothing else did.
    const other = outcomes.filter(
      (o) => o.status === 'rejected' && !/E11000|duplicate key/i.test(String(o.reason))
    );
    expect(other).toEqual([]);
    expect(duplicates.length).toBeLessThanOrEqual(3);
  });

  it('refuses a second document under the same round key outright', async () => {
    const key = '7:8328:0';
    await roundUpsert(key);
    await expect(
      QuorumRound.collection.insertOne({
        roundKey: key,
        llmqType: 7,
        llmqName: 'llmq_defcon',
        expectedHeight: 8_328,
        status: 'formed',
        formed: true,
      })
    ).rejects.toThrow(/E11000|duplicate key/i);
  });

  // The pattern CLAUDE.md points at as the audited one, now actually audited.
  it('records a ban once across a poller restart', async () => {
    const eventKey = 'aa11:banned:9000';
    const write = () =>
      MasternodeEvent.updateOne(
        { eventKey },
        {
          $setOnInsert: {
            eventKey,
            proTxHash: 'aa11',
            type: 'banned',
            height: 9_000,
            source: 'poll',
            detectedAt: new Date('2026-09-05T10:00:00Z'),
          },
        },
        { upsert: true }
      );

    await write();
    const first = await MasternodeEvent.findOne({ eventKey }).lean();
    // A restart re-reads the same diff and writes the same event again.
    await write();
    await write();
    const after = await MasternodeEvent.find({ eventKey }).lean();

    expect(after).toHaveLength(1);
    expect(after[0]!.detectedAt).toEqual(first!.detectedAt);
  });

  it('keeps events of the same node at different heights apart', async () => {
    const base = { proTxHash: 'bb22', type: 'banned', source: 'poll' as const };
    for (const height of [9_100, 9_200]) {
      await MasternodeEvent.updateOne(
        { eventKey: `bb22:banned:${height}` },
        { $setOnInsert: { ...base, eventKey: `bb22:banned:${height}`, height, detectedAt: new Date() } },
        { upsert: true }
      );
    }
    expect(await MasternodeEvent.countDocuments({ proTxHash: 'bb22' })).toBe(2);
  });
});

describe.skipIf(HAVE_MONGO)('the record, against a real MongoDB', () => {
  it('needs a database', () => {
    // Not silent: a skipped gate should say what it would have measured.
    expect(NO_MONGO_REASON).toContain('MONGODB_TEST_URI');
  });
});
