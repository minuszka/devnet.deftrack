import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, NO_MONGO_REASON, syncIndexes } from './mongo.js';

/**
 * The round collector, end to end, over a real database.
 *
 * Its unit tests replace the models with `vi.fn()`s and assert the update
 * document it builds. That is the right way to test the decisions -- and it
 * cannot catch the failure that costs the most here, because **Mongoose drops
 * unknown paths in strict mode without a word**. Rename a schema field and the
 * collector keeps building an update the driver keeps accepting; the value
 * simply never lands, no error is raised, and the API answers null for ever.
 *
 * So this one lets the real models write to a real MongoDB and then reads the
 * documents back, which is the only place that class of fault is visible.
 *
 * The RPC is the one thing still faked: the point is the write path, and a
 * devnet node is not something a test may require.
 */
const rpcState = vi.hoisted(() => ({
  getBlockCount: vi.fn<() => Promise<number>>(),
  call: vi.fn<(method: string, params?: unknown[]) => Promise<unknown>>(),
}));

vi.mock('../services/rpc.service.js', () => ({
  rpc: {
    getBlockCount: rpcState.getBlockCount,
    call: (method: string, params?: unknown[]) => rpcState.call(method, params),
  },
}));

const TIP = 8_300;
/** A round of llmq_defcon: interval 24, so its cycle starts are multiples of 24. */
const FORMED_HEIGHT = 8_256;
const MEMBERS = [
  { proTxHash: 'a'.repeat(64), service: '198.51.100.11:19799', valid: true },
  { proTxHash: 'b'.repeat(64), service: '198.51.100.12:19799', valid: true },
  { proTxHash: 'c'.repeat(64), service: '198.51.100.13:19799', valid: false },
];

describe.skipIf(!HAVE_MONGO)('the round collector, against a real MongoDB', () => {
  let QuorumRound: typeof import('../models/QuorumRound.js').QuorumRound;
  let service: typeof import('../services/quorumRound.service.js').quorumRoundService;

  beforeAll(async () => {
    const dbName = await connectTestMongo('quorumround');
    process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${dbName}`;

    ({ QuorumRound } = await import('../models/QuorumRound.js'));
    const { Block } = await import('../models/Block.js');
    await syncIndexes([QuorumRound, Block]);

    // The block the commitment was mined in, so `minedHeight` can resolve --
    // the field the reorg reset cuts on, and null until the indexer catches up.
    await Block.create({
      height: FORMED_HEIGHT + 12,
      hash: 'f'.repeat(64),
      time: 1_757_000_000,
      nTx: 2,
      size: 1_000,
      isProofOfStake: true,
      hasChainLock: true,
      previousblockhash: 'e'.repeat(64),
      merkleroot: 'd'.repeat(64),
      version: 4,
      bits: '1e0ffff0',
      nonce: 0,
      difficulty: 1,
      chainwork: '00',
      totalOutSat: '0',
      masternodePaidSat: '0',
      burnedSat: '0',
    });

    rpcState.getBlockCount.mockResolvedValue(TIP);
    rpcState.call.mockImplementation(async (method: string, params?: unknown[]) => {
      const args = (params ?? []) as unknown[];
      if (method === 'quorum' && args[0] === 'listextended') {
        return {
          llmq_defcon: [
            {
              [`${'9'.repeat(64)}`]: {
                creationHeight: FORMED_HEIGHT,
                quorumIndex: 0,
                minedBlockHash: 'f'.repeat(64),
                numValidMembers: 2,
                healthRatio: '0.67',
              },
            },
          ],
        };
      }
      if (method === 'quorum' && args[0] === 'info') {
        return { members: MEMBERS };
      }
      if (method === 'masternode' && args[0] === 'count') return { enabled: 152, total: 152 };
      throw new Error(`unexpected RPC in this test: ${method} ${JSON.stringify(args)}`);
    });

    ({ quorumRoundService: service } = await import('../services/quorumRound.service.js'));
  }, 60_000);

  afterAll(async () => {
    await dropTestMongo();
  });

  it('writes the observed round with every field the API reads', async () => {
    await service.collect();

    const round = await QuorumRound.findOne({ roundKey: `7:${FORMED_HEIGHT}:0` }).lean();
    expect(round, 'the formed round was not written at all').not.toBeNull();

    // Each of these is a separate assertion on purpose: a silently dropped
    // path shows up as one null, and `toMatchObject` on the whole document
    // would name the wrong field first.
    expect(round!.status).toBe('formed');
    expect(round!.formed).toBe(true);
    expect(round!.llmqName).toBe('llmq_defcon');
    expect(round!.expectedHeight).toBe(FORMED_HEIGHT);
    expect(round!.quorumHash).toBe('9'.repeat(64));
    expect(round!.minedBlockHash).toBe('f'.repeat(64));
    // Resolved against the indexed chain, not taken from the RPC.
    expect(round!.minedHeight).toBe(FORMED_HEIGHT + 12);
    expect(round!.numValidMembers).toBe(2);
    expect(round!.healthRatio).toBeCloseTo(0.67, 5);
    expect(round!.members).toHaveLength(3);
    expect(round!.invalidMembers).toEqual(['c'.repeat(64)]);
    // Three members observed, two valid: one punished. The number the whole
    // site is about, and it is derived rather than reported.
    expect(round!.punishedCount).toBe(1);
    expect(round!.detailsComplete).toBe(true);
    expect(round!.firstSeenAt).toBeInstanceOf(Date);
  });

  it('writes the same round once, however many times it collects', async () => {
    const before = await QuorumRound.findOne({ roundKey: `7:${FORMED_HEIGHT}:0` }).lean();

    await service.collect();
    await service.collect();

    const rows = await QuorumRound.find({ roundKey: `7:${FORMED_HEIGHT}:0` }).lean();
    expect(rows).toHaveLength(1);
    // The immutable half is what a restart must not disturb.
    expect(rows[0]!.firstSeenAt).toEqual(before!.firstSeenAt);
    expect(rows[0]!.size).toBe(before!.size);
  });

  it('never writes a verdict it could not support', async () => {
    // Every round it did write is either observed or decided; nothing is
    // recorded as `failed` for a height the RPC window can no longer see.
    const all = await QuorumRound.find().lean();
    expect(all.length).toBeGreaterThan(0);
    for (const row of all) {
      expect(['pending', 'formed', 'failed', 'impossible']).toContain(row.status);
      if (row.status === 'failed' || row.status === 'impossible') {
        // The count that tells those two apart must have been known.
        expect(row.effectiveSize).not.toBeNull();
      }
      if (row.status !== 'formed') {
        // A round with no commitment punishes nobody: an assertion about
        // consensus, and it has to survive the round trip through Mongo.
        expect(row.punishedCount).toBe(0);
        expect(row.quorumHash).toBeNull();
      }
    }
  });

  it('keeps the profiles apart in the record', async () => {
    const names = new Set((await QuorumRound.find().select('llmqName').lean()).map((r) => r.llmqName));
    // Whatever else was scheduled, the observed profile is in there under its
    // own name -- blending schedules is the one reading this project forbids.
    expect(names.has('llmq_defcon')).toBe(true);
    for (const name of names) expect(typeof name).toBe('string');
  });
});

describe.skipIf(HAVE_MONGO)('the round collector, against a real MongoDB', () => {
  it('needs a database', () => {
    expect(NO_MONGO_REASON).toContain('MONGODB_TEST_URI');
  });
});
