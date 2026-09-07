import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, NO_MONGO_REASON, syncIndexes } from './mongo.js';
import { blockHash, blockRow, hashOf } from './fixtures.js';

/**
 * The ChainLock watcher, end to end, over a real database.
 *
 * Three of its writes are things a fake model cannot exercise at all: two
 * start-up backfills are aggregation-pipeline updates (`$subtract`, `$cond`),
 * whose correctness is decided by the server and not by the arguments; and
 * the ZMQ derivation sets fields conditionally on what an earlier row already
 * holds, so the order in which two observations are applied changes what is
 * written. Everything else is the usual question: does every field the
 * ChainLock views read survive the schema.
 *
 * The RPC is faked; the ZMQ socket is never opened (no ZMQ_ENDPOINT), so the
 * event path is driven by inserting the raw observation rows the listener
 * would have stored.
 */
const rpcState = vi.hoisted(() => ({
  tip: 0,
  unlocked: new Set<string>(),
  best: null as null | { blockhash: string; height: number; llmqType?: string },
}));

vi.mock('../services/rpc.service.js', () => ({
  rpc: {
    getBlockCount: async () => rpcState.tip,
    getBlock: async (hash: string) => ({ hash, chainlock: !rpcState.unlocked.has(hash) }),
    getBestChainLock: async () =>
      rpcState.best ? { ...rpcState.best, signature: '', known_block: true } : null,
  },
}));

/** Poll until `read` answers, or fail: the start-up writes are fire-and-forget. */
async function eventually<T>(read: () => Promise<T | null | undefined>, what: string): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

describe.skipIf(!HAVE_MONGO)('the ChainLock watcher, against a real MongoDB', () => {
  let Block: typeof import('../models/Block.js').Block;
  let Transaction: typeof import('../models/Transaction.js').Transaction;
  let NodeObservation: typeof import('../models/NodeObservation.js').NodeObservation;
  let PeerObservation: typeof import('../models/PeerObservation.js').PeerObservation;
  let service: import('../services/chainLock.service.js').ChainLockService;

  /** The switchover height, so the profile assertions hold whatever the config says. */
  let V2: number;
  let TIP: number;
  const nowSec = Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    const dbName = await connectTestMongo('chainlock');
    process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${dbName}`;
    delete process.env.ZMQ_ENDPOINT;

    ({ Block } = await import('../models/Block.js'));
    ({ Transaction } = await import('../models/Transaction.js'));
    ({ NodeObservation } = await import('../models/NodeObservation.js'));
    ({ PeerObservation } = await import('../models/PeerObservation.js'));
    await syncIndexes([Block, Transaction, NodeObservation, PeerObservation]);

    const llmq = await import('../config/llmq.js');
    V2 = llmq.CHAINLOCK_V2_ACTIVATION_HEIGHT;
    TIP = V2 + 10;

    // Inside the 40-block window: one block signed under the old profile, two
    // under the new, and the tip the node has not locked yet. Times decide
    // whether a poll latency is claimable: only a block whose timestamp is at
    // or after the watcher's start may carry one, so the "recent" block is
    // stamped a little ahead of the clock -- the watcher starts below, after
    // the seeding, and must not overtake it.
    await Block.create([
      blockRow(V2 - 1, { time: nowSec - 3_600 }),
      blockRow(V2 + 5, { time: nowSec - 3_600 }),
      blockRow(V2 + 9, { time: nowSec + 30, nTx: 2 }),
      blockRow(TIP, { time: nowSec + 30 }),
      // Below the window, for the start-up backfills: a ZMQ lock recorded
      // before the latency was derived, and two locks recorded before the
      // signer field existed, on either side of the switchover.
      blockRow(10, {
        chainLockSource: 'zmq',
        chainLockLatencyMs: null,
        firstSeenAt: new Date(1_757_000_000_000),
        chainLockedAt: new Date(1_757_000_001_500),
        hasChainLock: true,
      }),
      blockRow(V2 - 30, { hasChainLock: true, chainLockedAt: new Date(), chainLockLlmqName: null }),
      // Already locked (so the poll skips it) but unnamed: gets its name from
      // the height rule alone.
      blockRow(V2 + 3, { hasChainLock: true, chainLockedAt: new Date(), chainLockLlmqName: null }),
    ]);
    await Transaction.create(
      [hashOf('tx:1'), hashOf('tx:2')].map((txid) => ({
        txid,
        blockhash: blockHash(V2 + 9),
        height: V2 + 9,
        time: nowSec - 5,
        version: 3,
        type: 0,
        size: 200,
      }))
    );

    rpcState.tip = TIP;
    rpcState.unlocked.add(blockHash(TIP));
    rpcState.best = { blockhash: blockHash(V2 + 9), height: V2 + 9, llmqType: 'llmq_defcon' };

    const { ChainLockService } = await import('../services/chainLock.service.js');
    service = new ChainLockService();
    service.start();
    // The timer is not wanted, the start-up tick and the two backfills are.
    // All three are fire-and-forget, so each is waited for by its own
    // evidence: the tick by its guard releasing (a tick started while it holds
    // the guard is dropped, which is exactly what a test calling tick() next
    // must not run into), the backfills by the rows they change. Waiting for
    // the tick's first write instead let the tests start while it was still
    // flagging transactions and reconciling the best lock.
    service.stop();
    await eventually(
      async () => ((service as unknown as { reconciling: boolean }).reconciling ? null : true),
      'the start-up tick'
    );
    await eventually(
      async () => (await Block.findOne({ height: 10, chainLockLatencyMs: { $ne: null } }).lean()) ?? null,
      'the latency backfill'
    );
    await eventually(
      async () => (await Block.findOne({ height: V2 + 3, chainLockLlmqName: { $ne: null } }).lean()) ?? null,
      'the signer backfill'
    );
  }, 60_000);

  afterAll(async () => {
    service?.stop();
    await dropTestMongo();
  });

  it('derives what the start-up backfills promise, in the database', async () => {
    // Pipeline update: chainLockedAt - firstSeenAt, computed by the server.
    const ten = await Block.findOne({ height: 10 }).lean();
    expect(ten!.chainLockLatencyMs).toBe(1_500);

    // Pipeline update: the signer profile from the height rule.
    expect((await Block.findOne({ height: V2 - 30 }).lean())!.chainLockLlmqName).toBe('llmq_400_60');
    expect((await Block.findOne({ height: V2 + 3 }).lean())!.chainLockLlmqName).toBe('llmq_defcon');
  });

  it('records a polled lock with its source, its signer and a latency only where one is claimable', async () => {
    const recent = await Block.findOne({ height: V2 + 9 }).lean();
    expect(recent!.hasChainLock).toBe(true);
    expect(recent!.chainLockedAt).toBeInstanceOf(Date);
    expect(recent!.chainLockSource).toBe('poll');
    expect(recent!.chainLockLlmqName).toBe('llmq_defcon');
    // Mined after the watcher started: the sighting is ours to time.
    expect(typeof recent!.chainLockLatencySec).toBe('number');
    expect(recent!.chainLockLatencySec).toBeGreaterThanOrEqual(0);
    // Poll resolution, so no millisecond event latency is claimed.
    expect(recent!.chainLockLatencyMs).toBeNull();

    // Mined an hour before the watcher: the lock is real, the timing is not ours.
    const old = await Block.findOne({ height: V2 + 5 }).lean();
    expect(old!.hasChainLock).toBe(true);
    expect(old!.chainLockSource).toBe('poll');
    expect(old!.chainLockLatencySec).toBeNull();

    const pre = await Block.findOne({ height: V2 - 1 }).lean();
    expect(pre!.chainLockLlmqName).toBe('llmq_400_60');

    // The node has not locked the tip: untouched.
    const tip = await Block.findOne({ height: TIP }).lean();
    expect(tip!.hasChainLock).toBe(false);
    expect(tip!.chainLockedAt).toBeNull();

    // A transaction is indexed unlocked and follows its block.
    const txs = await Transaction.find({ blockhash: blockHash(V2 + 9) }).lean();
    expect(txs).toHaveLength(2);
    expect(txs.every((t) => t.hasChainLock === true)).toBe(true);
  });

  it('stores the node\'s own answer for the best lock when the resolver mirror disagrees', async () => {
    // Agreement first: nothing to correct.
    expect((await Block.findOne({ height: V2 + 9 }).lean())!.chainLockLlmqName).toBe('llmq_defcon');

    rpcState.best = { blockhash: blockHash(V2 + 9), height: V2 + 9, llmqType: 'llmq_400_60' };
    await service.tick();
    // The node signs; the mirror is a copy of its rule. When they differ the
    // record carries the node's answer, and the log says the config drifted.
    expect((await Block.findOne({ height: V2 + 9 }).lean())!.chainLockLlmqName).toBe('llmq_400_60');
    rpcState.best = { blockhash: blockHash(V2 + 9), height: V2 + 9, llmqType: 'llmq_defcon' };
  });

  it('turns raw ZMQ arrivals into event times, and leaves what it cannot place', async () => {
    const eventBlock = V2 + 2;
    const raceBlock = V2 + 1;
    await Block.create([
      blockRow(eventBlock, { time: nowSec - 3 }),
      blockRow(raceBlock, { time: nowSec - 4 }),
    ]);
    await Transaction.create({
      txid: hashOf('tx:zmq'),
      blockhash: blockHash(eventBlock),
      height: eventBlock,
      time: nowSec - 3,
      version: 3,
      type: 0,
      size: 200,
    });

    const t0 = Date.now() - 10_000;
    const observation = (topic: string, hash: string, receivedAt: number) => ({
      observationKey: `${topic}:${hash}`,
      topic,
      hash,
      sequence: 1,
      payloadHex: hash,
      receivedAt: new Date(receivedAt),
    });
    await NodeObservation.create([
      // The normal order: block first, lock 800 ms later.
      observation('hashblock', blockHash(eventBlock), t0),
      observation('hashchainlock', blockHash(eventBlock), t0 + 800),
      // The race: the lock is applied while the first sight is still unknown,
      // then the block arrives. Both stamps exist afterwards, so the latency
      // is derived on the second pass rather than left null for good.
      observation('hashchainlock', blockHash(raceBlock), t0 + 1_000),
      observation('hashblock', blockHash(raceBlock), t0 + 1_300),
      // A hash that never gets indexed: given up after an hour...
      observation('hashblock', hashOf('orphan'), Date.now() - 2 * 3_600_000),
      // ...and kept pending while it is still fresh.
      observation('hashblock', hashOf('not-yet'), Date.now()),
    ]);

    await service.tick();

    const locked = await Block.findOne({ height: eventBlock }).lean();
    expect(locked!.firstSeenAt).toEqual(new Date(t0));
    expect(locked!.chainLockedAt).toEqual(new Date(t0 + 800));
    expect(locked!.chainLockLatencyMs).toBe(800);
    expect(locked!.chainLockSource).toBe('zmq');
    expect(locked!.hasChainLock).toBe(true);
    expect(locked!.chainLockLlmqName).toBe('llmq_defcon');
    // Against the block's own timestamp, in seconds: the older meaning, kept apart.
    expect(locked!.chainLockLatencySec).toBe(Math.max(0, Math.round((t0 + 800) / 1000 - (nowSec - 3))));
    expect((await Transaction.findOne({ txid: hashOf('tx:zmq') }).lean())!.hasChainLock).toBe(true);

    const raced = await Block.findOne({ height: raceBlock }).lean();
    expect(raced!.chainLockedAt).toEqual(new Date(t0 + 1_000));
    expect(raced!.firstSeenAt).toEqual(new Date(t0 + 1_300));
    expect(raced!.chainLockSource).toBe('zmq');
    // Derived, not null: the lock's row had no latency to give, the block's
    // row filled it in. Clamped at zero because the lock came first.
    expect(raced!.chainLockLatencyMs).toBe(0);

    // The seed is a vantage point too, at event-feed resolution.
    const sightings = await PeerObservation.find({ hash: blockHash(eventBlock) }).sort({ topic: 1 }).lean();
    expect(sightings.map((s) => s.observationKey)).toEqual([
      `seed:block:${blockHash(eventBlock)}`,
      `seed:chainlock:${blockHash(eventBlock)}`,
    ]);
    expect(sightings[0]!.host).toBe('seed');
    expect(sightings[0]!.height).toBe(eventBlock);
    expect(sightings[0]!.receivedAt).toEqual(new Date(t0));
    expect(sightings[0]!.resolutionMs).toBe(0);
    expect(sightings[0]!.agentVersion).toBe('explorer');
    expect(sightings[0]!.ingestedAt).toBeInstanceOf(Date);

    // Consumed rows are marked; the fresh unplaceable one is not.
    const applied = await NodeObservation.find({ appliedAt: { $ne: null } }).select('observationKey').lean();
    expect(applied.map((o) => o.observationKey).sort()).toEqual(
      [
        `hashblock:${blockHash(eventBlock)}`,
        `hashchainlock:${blockHash(eventBlock)}`,
        `hashblock:${blockHash(raceBlock)}`,
        `hashchainlock:${blockHash(raceBlock)}`,
        `hashblock:${hashOf('orphan')}`,
      ].sort()
    );
    expect((await NodeObservation.findOne({ hash: hashOf('not-yet') }).lean())!.appliedAt).toBeNull();
  });

  it('never revises a lock time once recorded', async () => {
    const before = await Block.findOne({ height: V2 + 2 }).lean();
    await NodeObservation.create({
      observationKey: `hashchainlock:${blockHash(V2 + 2)}:again`,
      topic: 'hashchainlock',
      hash: blockHash(V2 + 2),
      sequence: 2,
      payloadHex: blockHash(V2 + 2),
      receivedAt: new Date(),
    });
    await service.tick();
    const after = await Block.findOne({ height: V2 + 2 }).lean();
    expect(after!.chainLockedAt).toEqual(before!.chainLockedAt);
    expect(after!.chainLockLatencyMs).toBe(before!.chainLockLatencyMs);
  });
});

describe.skipIf(HAVE_MONGO)('the ChainLock watcher, against a real MongoDB', () => {
  it('needs a database', () => {
    expect(NO_MONGO_REASON).toContain('MONGODB_TEST_URI');
  });
});
