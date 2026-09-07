import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, NO_MONGO_REASON, syncIndexes } from './mongo.js';
import { blockHash, blockTime, hashOf } from './fixtures.js';
import type { RpcBlock, RpcBlockVerbose, RpcMasternodePayment, RpcTransaction } from '../services/rpc.service.js';

/**
 * The block indexer, end to end, over a real database.
 *
 * `sync.rollback.test.ts` proves the decisions -- when a rewind is allowed,
 * what it must refuse -- against faked models. What a fake cannot show is
 * whether the documents those decisions produce actually land: Mongoose drops
 * an unknown path in strict mode without a word, so a renamed schema field
 * leaves the indexer building updates the driver keeps accepting while the
 * API answers null for ever. The rollback is the sharper case, because it is
 * the only code here that DELETES measurement history, and a delete aimed at
 * the wrong field or the wrong collection is invisible to a fake too.
 *
 * So this runs the real service over a small fake chain, reads every
 * collection it writes back, then moves the chain underneath it and reads
 * again. The RPC is the one thing faked: a node is not something a test may
 * require, and the chain has to be one the test can reorg on purpose.
 */

/** Sentinel schedule for this chain: activation 4, epoch 4, so boundary 8 is the first committable one. */
const DSL_ACTIVATION = 4;
const DSL_EPOCH = 4;
const TIP = 12;

const PAYEE = hashOf('mn:payee');
/** Three registered masternodes; uniform bytes, so canonical order is plain string order. */
const REGISTERED = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
const QUORUM_HASH = hashOf('quorum:1');
const COINSTAKE_SCRIPT = '21' + '03'.repeat(33) + 'ac';

const rpcState = vi.hoisted(() => ({
  /** height -> block, the chain the fake node currently has. */
  chain: new Map<number, unknown>(),
  tip: 0,
}));

vi.mock('../services/rpc.service.js', () => {
  const byHash = (hash: string): RpcBlockVerbose | undefined => {
    for (const block of rpcState.chain.values()) {
      if ((block as RpcBlockVerbose).hash === hash) return block as RpcBlockVerbose;
    }
    return undefined;
  };
  const rpc = {
    getBlockCount: async () => rpcState.tip,
    getBlockHash: async (height: number) => {
      const block = rpcState.chain.get(height) as RpcBlockVerbose | undefined;
      if (!block || height > rpcState.tip) throw new Error('Block height out of range');
      return block.hash;
    },
    getBlockVerbose: async (hash: string) => {
      const block = byHash(hash);
      if (!block) throw new Error('Block not found');
      return block;
    },
    getBlock: async (hash: string): Promise<RpcBlock> => {
      const block = byHash(hash);
      if (!block) throw new Error('Block not found');
      return { ...block, tx: block.tx.map((t) => t.txid) };
    },
    masternodePayments: async (hash: string): Promise<RpcMasternodePayment[]> => {
      const block = byHash(hash);
      if (!block) throw new Error('Block not found');
      // Only block 1 paid a masternode; every other block paid nobody, which is
      // a real answer ("none") and not a failed lookup.
      return block.height === 1
        ? [{ height: 1, blockhash: hash, amount: 1, masternodes: [{ proTxHash: PAYEE, amount: 1 }] }]
        : [];
    },
    protxListRegistered: async (_height: number) => REGISTERED,
    call: async (method: string, params: unknown[]) => {
      if (method === 'quorum' && params[0] === 'info') return { members: new Array(60).fill({}) };
      throw new Error(`unexpected RPC in this test: ${method} ${JSON.stringify(params)}`);
    },
  };
  return { rpc };
});

function coinbase(height: number): RpcTransaction {
  return {
    txid: hashOf(`coinbase:${height}`),
    version: 3,
    type: 5,
    size: 200,
    locktime: 0,
    blocktime: blockTime(height),
    vin: [{ coinbase: '03' + height.toString(16).padStart(6, '0'), sequence: 0xffffffff }],
    vout: [
      {
        value: 5,
        valueSat: 500_000_000,
        n: 0,
        scriptPubKey: { asm: '', hex: '76a914' + '11'.repeat(20) + '88ac', type: 'pubkeyhash', address: 'yCoinbasePayee' },
      },
    ],
  };
}

/** A coinstake: second in the block, spends a real input, first output empty, pays a bare pubkey. */
function coinstake(height: number): RpcTransaction {
  return {
    txid: hashOf(`coinstake:${height}`),
    version: 3,
    type: 0,
    size: 300,
    locktime: 0,
    blocktime: blockTime(height),
    vin: [{ txid: hashOf(`kernel:${height}`), vout: 1, sequence: 0xffffffff }],
    vout: [
      { value: 0, valueSat: 0, n: 0, scriptPubKey: { asm: '', hex: '', type: 'nonstandard' } },
      {
        value: 50_000_500,
        valueSat: 5_000_050_000_000,
        n: 1,
        scriptPubKey: { asm: '', hex: COINSTAKE_SCRIPT, type: 'pubkey' },
      },
    ],
  };
}

function plain(height: number): RpcTransaction {
  return {
    txid: hashOf(`plain:${height}`),
    version: 3,
    type: 0,
    size: 250,
    locktime: 0,
    blocktime: blockTime(height),
    vin: [{ txid: hashOf(`spent:${height}`), vout: 0, sequence: 0xffffffff }],
    vout: [
      {
        value: 1,
        valueSat: 100_000_000,
        n: 0,
        scriptPubKey: { asm: '', hex: '76a914' + '22'.repeat(20) + '88ac', type: 'pubkeyhash', addresses: ['yPlainRecipient'] },
      },
    ],
  };
}

function quorumCommitment(height: number): RpcTransaction {
  return {
    ...plain(height),
    txid: hashOf(`qc:${height}`),
    type: 6,
    qcTx: {
      version: 1,
      height,
      commitment: { version: 1, llmqType: 7, quorumHash: QUORUM_HASH, validMembersCount: 58, signersCount: 50 },
    },
  };
}

function dslCommitment(height: number, epoch: number, epochBlockHash: string): RpcTransaction {
  return {
    ...plain(height),
    txid: hashOf(`dsl:${height}`),
    type: 10,
    poseServiceTx: {
      version: 1,
      commitment: {
        version: 1,
        epoch,
        epochBlockHash,
        llmqType: 7,
        quorumHash: QUORUM_HASH,
        missedCount: 1,
        size: REGISTERED.length,
        missedIndices: [1],
      },
    },
  };
}

function block(height: number, tx: RpcTransaction[], overrides: Partial<RpcBlockVerbose> = {}): RpcBlockVerbose {
  const hash = overrides.hash ?? blockHash(height);
  return {
    hash,
    confirmations: 1,
    height,
    version: 4,
    merkleroot: hashOf(`merkle:${hash}`),
    time: blockTime(height),
    mediantime: blockTime(height) - 300,
    nonce: 0,
    bits: '1e0ffff0',
    difficulty: 1,
    chainwork: '00',
    nTx: tx.length,
    size: 1_000,
    previousblockhash: height > 0 ? blockHash(height - 1) : undefined,
    nextblockhash: undefined,
    tx,
    ...overrides,
  };
}

/** The chain as the node first reports it: genesis, then 1..TIP. */
function buildChain(): void {
  rpcState.chain.clear();
  rpcState.chain.set(0, block(0, [coinbase(0)]));
  for (let h = 1; h <= TIP; h++) {
    const txs: RpcTransaction[] = [coinbase(h)];
    const extra: Partial<RpcBlockVerbose> = {};
    if (h === 1) txs.push(plain(h));
    if (h === 5) {
      txs.push(coinstake(h));
      extra.blocksignature = 'ab'.repeat(32);
    }
    if (h === 10) txs.push(quorumCommitment(h));
    if (h === 12) txs.push(dslCommitment(h, 2, blockHash(8)));
    rpcState.chain.set(h, block(h, txs, extra));
  }
  // The fake node knows every successor except the tip's, as a real one would.
  for (let h = 0; h < TIP; h++) {
    (rpcState.chain.get(h) as RpcBlockVerbose).nextblockhash = blockHash(h + 1);
  }
  rpcState.tip = TIP;
}

describe.skipIf(!HAVE_MONGO)('the block indexer, against a real MongoDB', () => {
  let models: {
    Block: typeof import('../models/Block.js').Block;
    Transaction: typeof import('../models/Transaction.js').Transaction;
    SyncState: typeof import('../models/SyncState.js').SyncState;
    ServiceEpoch: typeof import('../models/ServiceEpoch.js').ServiceEpoch;
    QuorumCommitment: typeof import('../models/QuorumCommitment.js').QuorumCommitment;
    MasternodeEvent: typeof import('../models/MasternodeEvent.js').MasternodeEvent;
  };
  let service: import('../services/sync.service.js').SyncService;

  beforeAll(async () => {
    const dbName = await connectTestMongo('sync');
    process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${dbName}`;
    process.env.DSL_ACTIVATION_HEIGHT = String(DSL_ACTIVATION);
    process.env.DSL_EPOCH_INTERVAL = String(DSL_EPOCH);

    models = {
      Block: (await import('../models/Block.js')).Block,
      Transaction: (await import('../models/Transaction.js')).Transaction,
      SyncState: (await import('../models/SyncState.js')).SyncState,
      ServiceEpoch: (await import('../models/ServiceEpoch.js')).ServiceEpoch,
      QuorumCommitment: (await import('../models/QuorumCommitment.js')).QuorumCommitment,
      MasternodeEvent: (await import('../models/MasternodeEvent.js')).MasternodeEvent,
    };
    await syncIndexes(Object.values(models));

    buildChain();
    const { SyncService } = await import('../services/sync.service.js');
    service = new SyncService();
  }, 60_000);

  afterAll(async () => {
    await dropTestMongo();
  });

  it('indexes the chain from genesis and records the cursor', async () => {
    await service.tick();

    const state = await models.SyncState.findOne({ key: 'blocks' }).lean();
    expect(state, 'no sync cursor was written').not.toBeNull();
    expect(state!.lastSyncedHeight).toBe(TIP);
    expect(state!.lastSyncedHash).toBe(blockHash(TIP));
    expect(state!.error).toBeNull();
    expect(state!.heartbeatAt).toBeInstanceOf(Date);

    expect(await models.Block.countDocuments()).toBe(TIP + 1);
    const genesis = await models.Block.findOne({ height: 0 }).lean();
    expect(genesis!.hash).toBe(blockHash(0));
    expect(genesis!.previousblockhash).toBeNull();
    // Genesis is fetched without its coinbase -- the node refuses to serve
    // it -- so the block carries no transaction and no txid. Recorded as
    // observed: an empty list here is the indexer's rule, not a dropped path.
    expect(genesis!.txids).toEqual([]);
    expect(await models.Transaction.countDocuments({ height: 0 })).toBe(0);
  });

  it('writes a proof-of-stake block with every field the views read', async () => {
    const five = await models.Block.findOne({ height: 5 }).lean();
    expect(five, 'block 5 was not written').not.toBeNull();
    // Each field on its own line on purpose: a dropped path shows up as one
    // named null rather than a diff of the whole document.
    expect(five!.isProofOfStake).toBe(true);
    expect(five!.hasChainLock).toBe(false);
    expect(five!.txids).toEqual([hashOf('coinbase:5'), hashOf('coinstake:5')]);
    expect(five!.totalOutSat.toString()).toBe(String(500_000_000 + 5_000_050_000_000));
    expect(five!.mediantime).toBe(blockTime(5) - 300);
    expect(five!.previousblockhash).toBe(blockHash(4));
    // Filled in on the predecessor when its successor arrives, not at index time.
    expect(five!.nextblockhash).toBe(blockHash(6));
    // "Paid nobody" is an answer and is recorded as one.
    expect(five!.paidProTxHash).toBeNull();
    expect(five!.payeeCheckedAt).toBeInstanceOf(Date);
    expect(five!.payeeCheckAttempts).toBe(0);
    expect(five!.payeeRetryAt).toBeNull();

    const one = await models.Block.findOne({ height: 1 }).lean();
    expect(one!.isProofOfStake).toBe(false);
    expect(one!.paidProTxHash).toBe(PAYEE);

    const tip = await models.Block.findOne({ height: TIP }).lean();
    expect(tip!.nextblockhash).toBeNull();
  });

  it('writes the transactions with the coinstake told apart from the coinbase', async () => {
    const stake = await models.Transaction.findOne({ txid: hashOf('coinstake:5') }).lean();
    expect(stake, 'the coinstake was not written').not.toBeNull();
    expect(stake!.isCoinstake).toBe(true);
    expect(stake!.isCoinbase).toBe(false);
    expect(stake!.blockhash).toBe(blockHash(5));
    expect(stake!.height).toBe(5);
    expect(stake!.time).toBe(blockTime(5));
    expect(stake!.hasChainLock).toBe(false);
    expect(stake!.vin).toEqual([{ txid: hashOf('kernel:5'), vout: 1, coinbase: null, sequence: 0xffffffff }]);
    expect(stake!.vout).toHaveLength(2);
    // The pay-to-pubkey payout has no address; the script is its only identity.
    expect(stake!.vout[1]!.address).toBeNull();
    expect(stake!.vout[1]!.scriptHex).toBe(COINSTAKE_SCRIPT);
    expect(stake!.vout[1]!.scriptType).toBe('pubkey');
    expect(stake!.vout[1]!.valueSat.toString()).toBe('5000050000000');
    expect(stake!.valueOutSat.toString()).toBe('5000050000000');

    const cb = await models.Transaction.findOne({ txid: hashOf('coinbase:5') }).lean();
    expect(cb!.isCoinbase).toBe(true);
    expect(cb!.isCoinstake).toBe(false);
    expect(cb!.vin[0]!.coinbase).toBe('03000005');

    // An address reported under `addresses` rather than `address` still lands.
    const spend = await models.Transaction.findOne({ txid: hashOf('plain:1') }).lean();
    expect(spend!.vout[0]!.address).toBe('yPlainRecipient');
  });

  it('records the quorum commitment under its cycle, with the punished count resolved', async () => {
    // A commitment mined at 10 belongs to the cycle starting at 0 for a
    // 24-block profile; qcTx.height is the mined height, not this.
    const row = await models.QuorumCommitment.findOne({ commitmentKey: `7:0:${QUORUM_HASH}` }).lean();
    expect(row, 'the commitment was not written under its cycle key').not.toBeNull();
    expect(row!.llmqType).toBe(7);
    expect(row!.llmqName).toBe('llmq_defcon');
    expect(row!.quorumHash).toBe(QUORUM_HASH);
    expect(row!.quorumHeight).toBe(0);
    expect(row!.minedHeight).toBe(10);
    expect(row!.minedBlockHash).toBe(blockHash(10));
    expect(row!.validMembersCount).toBe(58);
    expect(row!.signersCount).toBe(50);
    // 60 selected by `quorum info`, 58 valid: two punished. Settled at index
    // time, so the backfill has nothing to come back for.
    expect(row!.punishedCount).toBe(2);
    expect(row!.memberCountCheckedAt).toBeInstanceOf(Date);
    expect(row!.memberCountAttempts).toBe(0);
    expect(row!.memberCountRetryAt).toBeNull();
  });

  it('records one Sentinel epoch per committable boundary, absent and committed alike', async () => {
    const epochs = await models.ServiceEpoch.find().sort({ boundaryHeight: 1 }).lean();
    // Boundary 4 is below the first committable boundary (8) and gets no row:
    // no commitment could exist there by rule, and an "absent" row would be a
    // manufactured failure.
    expect(epochs.map((e) => e.boundaryHeight)).toEqual([8, 12]);

    const [absent, committed] = epochs;
    expect(absent!.epochKey).toBe('dsl:1');
    expect(absent!.epoch).toBe(1);
    expect(absent!.status).toBe('absent');
    expect(absent!.boundaryBlockHash).toBe(blockHash(8));
    expect(absent!.txid).toBeNull();
    expect(absent!.missedCount).toBeNull();
    expect(absent!.missedIndices).toEqual([]);
    expect(absent!.missedProTxHashes).toEqual([]);

    expect(committed!.epochKey).toBe('dsl:2');
    expect(committed!.status).toBe('committed');
    expect(committed!.txid).toBe(hashOf('dsl:12'));
    expect(committed!.epochBlockHash).toBe(blockHash(8));
    expect(committed!.llmqType).toBe(7);
    expect(committed!.quorumHash).toBe(QUORUM_HASH);
    expect(committed!.missedCount).toBe(1);
    expect(committed!.listSize).toBe(REGISTERED.length);
    expect(committed!.missedIndices).toEqual([1]);
    // Index 1 of the canonical list at the epoch base, resolved to a name.
    expect(committed!.missedProTxHashes).toEqual([REGISTERED[1]]);
  });

  it('changes nothing on a tick with no new block', async () => {
    const before = await models.SyncState.findOne({ key: 'blocks' }).lean();
    await service.tick();
    const after = await models.SyncState.findOne({ key: 'blocks' }).lean();
    expect(after!.lastSyncedHeight).toBe(before!.lastSyncedHeight);
    expect(after!.lastSyncedHash).toBe(before!.lastSyncedHash);
    expect(after!.error).toBeNull();
    expect(await models.Block.countDocuments()).toBe(TIP + 1);
    expect(await models.ServiceEpoch.countDocuments()).toBe(2);
  });

  it('rewinds a reorged tip and re-indexes the surviving chain, dropping only what the abandoned block carried', async () => {
    // Rows the rollback has to reason about: chain-derived events on both sides
    // of the fork point, a polled sighting above it, and the walker's cursor.
    await models.MasternodeEvent.create([
      { eventKey: `${REGISTERED[0]}:penalty_up:11`, proTxHash: REGISTERED[0], type: 'penalty_up', height: 11, source: 'listdiff' },
      { eventKey: `${REGISTERED[1]}:banned:12`, proTxHash: REGISTERED[1], type: 'banned', height: 12, source: 'listdiff' },
      { eventKey: `${REGISTERED[2]}:service_missed:12:1`, proTxHash: REGISTERED[2], type: 'service_missed', height: 12, source: 'poll' },
    ]);
    await models.SyncState.updateOne({ key: 'mndiff' }, { $set: { lastSyncedHeight: 12 } }, { upsert: true });

    // The node abandons block 12: a different 12 with no Sentinel commitment,
    // and a 13 on top of it.
    const forkedHash = hashHash('block:12-forked');
    // A different block has a different coinbase; sharing the txid would make
    // "the old coinbase is gone" untestable.
    const forkedCoinbase = { ...coinbase(12), txid: hashHash('coinbase:12-forked') };
    rpcState.chain.set(12, block(12, [forkedCoinbase], { hash: forkedHash, nextblockhash: blockHash(13) }));
    rpcState.chain.set(13, block(13, [coinbase(13)], { previousblockhash: forkedHash }));
    rpcState.tip = 13;

    await service.tick();

    const state = await models.SyncState.findOne({ key: 'blocks' }).lean();
    expect(state!.error).toBeNull();
    expect(state!.lastSyncedHeight).toBe(13);
    expect(state!.lastSyncedHash).toBe(blockHash(13));

    // The abandoned block and everything only it carried are gone.
    expect(await models.Block.findOne({ hash: blockHash(12) }).lean()).toBeNull();
    expect(await models.Transaction.findOne({ txid: hashOf('dsl:12') }).lean()).toBeNull();
    expect(await models.Transaction.findOne({ txid: hashOf('coinbase:12') }).lean()).toBeNull();
    expect((await models.Transaction.findOne({ txid: hashHash('coinbase:12-forked') }).lean())!.blockhash).toBe(forkedHash);

    // The surviving chain is indexed in its place and linked to its predecessor.
    const twelve = await models.Block.findOne({ height: 12 }).lean();
    expect(twelve!.hash).toBe(forkedHash);
    expect(twelve!.previousblockhash).toBe(blockHash(11));
    expect(twelve!.nextblockhash).toBe(blockHash(13));
    expect((await models.Block.findOne({ height: 11 }).lean())!.nextblockhash).toBe(forkedHash);
    expect(await models.Block.countDocuments()).toBe(14);

    // The epoch verdict read off the abandoned boundary is re-decided on the
    // surviving one: the same key, now absent.
    const epoch = await models.ServiceEpoch.findOne({ epochKey: 'dsl:2' }).lean();
    expect(epoch!.status).toBe('absent');
    expect(epoch!.boundaryBlockHash).toBe(forkedHash);
    expect(epoch!.txid).toBeNull();
    expect(await models.ServiceEpoch.countDocuments()).toBe(2);

    // Mined below the fork point, so it survives.
    expect(await models.QuorumCommitment.countDocuments({ commitmentKey: `7:0:${QUORUM_HASH}` })).toBe(1);

    // Chain-derived events above the fork point describe changes that no
    // longer happened; the polled sighting was a real observation and stays.
    const events = (await models.MasternodeEvent.find().select('eventKey').lean()).map((e) => e.eventKey).sort();
    expect(events).toEqual(
      [`${REGISTERED[0]}:penalty_up:11`, `${REGISTERED[2]}:service_missed:12:1`].sort()
    );
    // And the walker is sent back to re-read them from the surviving chain.
    expect((await models.SyncState.findOne({ key: 'mndiff' }).lean())!.lastSyncedHeight).toBe(11);
  });

  it('keeps the index untouched when the node cannot say what its chain is', async () => {
    const before = await models.SyncState.findOne({ key: 'blocks' }).lean();
    const blocks = await models.Block.countDocuments();

    // A node mid-reindex: its tip is below what we hold. Nothing was learned,
    // so nothing may be deleted -- only the error is recorded for the health
    // endpoint.
    rpcState.tip = 5;
    await service.tick();

    const after = await models.SyncState.findOne({ key: 'blocks' }).lean();
    expect(after!.lastSyncedHeight).toBe(before!.lastSyncedHeight);
    expect(after!.lastSyncedHash).toBe(before!.lastSyncedHash);
    expect(after!.error).toContain('below the indexed height');
    expect(await models.Block.countDocuments()).toBe(blocks);

    // The node catches up: the error clears on the next successful tick.
    rpcState.tip = 13;
    await service.tick();
    expect((await models.SyncState.findOne({ key: 'blocks' }).lean())!.error).toBeNull();
  });
});

/** A second hash namespace, so a forked block can never collide with a height-keyed one. */
function hashHash(label: string): string {
  return hashOf(`fork:${label}`);
}

describe.skipIf(HAVE_MONGO)('the block indexer, against a real MongoDB', () => {
  it('needs a database', () => {
    expect(NO_MONGO_REASON).toContain('MONGODB_TEST_URI');
  });
});
