import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, NO_MONGO_REASON, syncIndexes } from './mongo.js';
import { blockTime, hashOf } from './fixtures.js';
import type { RpcBlock, RpcBlockVerbose, RpcTransaction } from '../services/rpc.service.js';

/**
 * A reorg deeper than the automatic cap, end to end: the sync refuses it and
 * says so, the operator inspects and confirms through the admin routes, and
 * the index follows the surviving chain afterwards.
 *
 * Until this path existed the only way out was dropping the database -- which
 * is what happened on the lab explorer on 2026-09-06. The fake chain is 231
 * blocks long and forks at 20, so the disagreement is 210 deep against a cap
 * of 200: past it, but not by so much that the test takes minutes.
 */
const FORK = 20;
const TIP_BEFORE = 230;
const TIP_AFTER = 232;
const API_KEY = 'itest-admin-key';

const rpcState = vi.hoisted(() => ({
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
    masternodePayments: async () => [],
    protxListRegistered: async () => [],
    call: async (method: string, params: unknown[]) => {
      throw new Error(`unexpected RPC in this test: ${method} ${JSON.stringify(params)}`);
    },
  };
  return { rpc };
});

/** Hashes on the surviving chain are keyed on a different label than the abandoned ones. */
const hashAt = (height: number, chain: 'a' | 'b'): string =>
  height <= FORK || chain === 'a' ? hashOf(`deep:${height}`) : hashOf(`deep-forked:${height}`);

function coinbase(height: number, chain: 'a' | 'b'): RpcTransaction {
  return {
    txid: hashOf(`deep-coinbase:${chain}:${height}`),
    version: 3,
    type: 5,
    size: 200,
    locktime: 0,
    blocktime: blockTime(height),
    vin: [{ coinbase: '03', sequence: 0xffffffff }],
    vout: [{ value: 5, valueSat: 500_000_000, n: 0, scriptPubKey: { asm: '', hex: '6a', type: 'nulldata' } }],
  };
}

function block(height: number, chain: 'a' | 'b'): RpcBlockVerbose {
  const hash = hashAt(height, chain);
  return {
    hash,
    confirmations: 1,
    height,
    version: 4,
    merkleroot: hashOf(`deep-merkle:${hash}`),
    time: blockTime(height),
    nonce: 0,
    bits: '1e0ffff0',
    difficulty: 1,
    chainwork: '00',
    nTx: 1,
    size: 300,
    previousblockhash: height > 0 ? hashAt(height - 1, chain) : undefined,
    nextblockhash: undefined,
    tx: [coinbase(height, chain)],
  };
}

function buildChain(chain: 'a' | 'b', tip: number): void {
  rpcState.chain.clear();
  for (let h = 0; h <= tip; h++) rpcState.chain.set(h, block(h, chain));
  for (let h = 0; h < tip; h++) (rpcState.chain.get(h) as RpcBlockVerbose).nextblockhash = hashAt(h + 1, chain);
  rpcState.tip = tip;
}

describe.skipIf(!HAVE_MONGO)('a reorg deeper than the automatic cap, against a real MongoDB', () => {
  let Block: typeof import('../models/Block.js').Block;
  let Transaction: typeof import('../models/Transaction.js').Transaction;
  let SyncState: typeof import('../models/SyncState.js').SyncState;
  let service: import('../services/sync.service.js').SyncService;
  let server: Server;
  let base = '';

  const api = (path: string, init: RequestInit = {}, key: string | null = API_KEY) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(key === null ? {} : { 'x-admin-api-key': key }),
        ...(init.headers ?? {}),
      },
    });

  beforeAll(async () => {
    const dbName = await connectTestMongo('deeprewind');
    process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${dbName}`;
    // The Sentinel collector is off and one tick may take the whole chain, so
    // the test is about the rewind and nothing else.
    process.env.DSL_ACTIVATION_HEIGHT = '0';
    process.env.SYNC_BATCH_SIZE = '500';
    process.env.ADMIN_API_KEY = API_KEY;

    ({ Block } = await import('../models/Block.js'));
    ({ Transaction } = await import('../models/Transaction.js'));
    ({ SyncState } = await import('../models/SyncState.js'));
    const { MasternodeEvent } = await import('../models/MasternodeEvent.js');
    await syncIndexes([Block, Transaction, SyncState, MasternodeEvent]);

    const { SyncService } = await import('../services/sync.service.js');
    service = new SyncService();

    // The admin routes, mounted exactly as the server mounts them, behind the
    // real guard; only the key is a test one.
    const { default: adminRoutes } = await import('../routes/v1/admin.v1.routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/admin', adminRoutes);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${address.port}`;

    buildChain('a', TIP_BEFORE);
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await dropTestMongo();
  });

  it('indexes the original chain', async () => {
    await service.tick();
    const state = await SyncState.findOne({ key: 'blocks' }).lean();
    expect(state!.lastSyncedHeight).toBe(TIP_BEFORE);
    expect(state!.error).toBeNull();
    expect(await Block.countDocuments()).toBe(TIP_BEFORE + 1);
  }, 30_000);

  it('refuses the deep rewind on its own and says where to look', async () => {
    buildChain('b', TIP_AFTER);
    await service.tick();

    const state = await SyncState.findOne({ key: 'blocks' }).lean();
    expect(state!.error).toContain('an operator has to confirm');
    expect(state!.error).toContain('GET /api/v1/admin/sync/rewind');
    // Nothing moved.
    expect(state!.lastSyncedHeight).toBe(TIP_BEFORE);
    expect(await Block.countDocuments()).toBe(TIP_BEFORE + 1);
    expect((await Block.findOne({ height: TIP_BEFORE }).lean())!.hash).toBe(hashAt(TIP_BEFORE, 'a'));
  });

  it('answers the inspection with the fork point, behind the admin guard', async () => {
    expect((await api('/api/v1/admin/sync/rewind', {}, null)).status).toBe(401);
    expect((await api('/api/v1/admin/sync/rewind', {}, 'wrong-key')).status).toBe(401);

    const res = await api('/api/v1/admin/sync/rewind');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Record<string, any> };
    expect(body.success).toBe(true);
    expect(body.data.verdict).toBe('operator');
    expect(body.data.indexedHeight).toBe(TIP_BEFORE);
    expect(body.data.nodeTip).toBe(TIP_AFTER);
    expect(body.data.automaticDepth).toBe(200);
    expect(body.data.forkPoint).toEqual({ height: FORK, hash: hashAt(FORK, 'a'), depth: TIP_BEFORE - FORK });
    // Bisection: eight or nine questions for 231 heights, not 210.
    expect(body.data.probes).toBeLessThanOrEqual(9);
  });

  it('refuses a wrong confirmation and a malformed one, deleting nothing', async () => {
    const wrongHeight = await api('/api/v1/admin/sync/rewind', {
      method: 'POST',
      body: JSON.stringify({ height: FORK - 1, hash: hashAt(FORK - 1, 'a') }),
    });
    expect(wrongHeight.status).toBe(409);
    expect(((await wrongHeight.json()) as { error: string }).error).toContain(`fork point is ${FORK}`);

    const wrongHash = await api('/api/v1/admin/sync/rewind', {
      method: 'POST',
      body: JSON.stringify({ height: FORK, hash: hashAt(FORK, 'b').replace(/^./, 'f') }),
    });
    expect(wrongHash.status).toBe(409);

    const malformed = await api('/api/v1/admin/sync/rewind', {
      method: 'POST',
      body: JSON.stringify({ height: -1, hash: 'not-a-hash' }),
    });
    expect(malformed.status).toBe(400);

    expect(await Block.countDocuments()).toBe(TIP_BEFORE + 1);
    expect((await SyncState.findOne({ key: 'blocks' }).lean())!.lastSyncedHeight).toBe(TIP_BEFORE);
  });

  it('performs the confirmed rewind and records who confirmed it', async () => {
    // Rows the rewind has to carry along: the walker's cursor and its events.
    await SyncState.updateOne({ key: 'mndiff' }, { $set: { lastSyncedHeight: TIP_BEFORE } }, { upsert: true });
    const { MasternodeEvent } = await import('../models/MasternodeEvent.js');
    await MasternodeEvent.create([
      { eventKey: 'a:penalty_up:15', proTxHash: 'a'.repeat(64), type: 'penalty_up', height: 15, source: 'listdiff' },
      { eventKey: 'a:banned:100', proTxHash: 'a'.repeat(64), type: 'banned', height: 100, source: 'listdiff' },
    ]);

    const res = await api('/api/v1/admin/sync/rewind', {
      method: 'POST',
      // Upper-case hex is accepted and normalised; the operator copied it from somewhere.
      body: JSON.stringify({ height: FORK, hash: hashAt(FORK, 'a').toUpperCase() }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, any> };
    expect(body.data).toMatchObject({
      height: FORK,
      hash: hashAt(FORK, 'a'),
      depth: TIP_BEFORE - FORK,
      droppedBlocks: TIP_BEFORE - FORK,
      droppedEvents: 1,
    });
    expect(typeof body.data.actor).toBe('string');

    expect(await Block.countDocuments()).toBe(FORK + 1);
    // One coinbase per block above genesis; genesis's is never fetched.
    expect(await Transaction.countDocuments()).toBe(FORK);
    expect((await Block.findOne({ height: FORK }).lean())!.nextblockhash).toBeNull();
    expect(await MasternodeEvent.countDocuments()).toBe(1);
    expect((await SyncState.findOne({ key: 'mndiff' }).lean())!.lastSyncedHeight).toBe(FORK);

    const state = await SyncState.findOne({ key: 'blocks' }).lean();
    expect(state!.lastSyncedHeight).toBe(FORK);
    expect(state!.lastSyncedHash).toBe(hashAt(FORK, 'a'));
    expect(state!.error).toBeNull();
    expect(state!.operatorRewind).toMatchObject({
      height: FORK,
      hash: hashAt(FORK, 'a'),
      depth: TIP_BEFORE - FORK,
      droppedBlocks: TIP_BEFORE - FORK,
    });
    expect(state!.operatorRewind!.at).toBeInstanceOf(Date);
  });

  it('follows the surviving chain on the next tick, and has nothing left to confirm', async () => {
    await service.tick();

    const state = await SyncState.findOne({ key: 'blocks' }).lean();
    expect(state!.error).toBeNull();
    expect(state!.lastSyncedHeight).toBe(TIP_AFTER);
    expect(state!.lastSyncedHash).toBe(hashAt(TIP_AFTER, 'b'));
    expect(await Block.countDocuments()).toBe(TIP_AFTER + 1);
    expect((await Block.findOne({ height: FORK + 1 }).lean())!.hash).toBe(hashAt(FORK + 1, 'b'));
    expect((await Block.findOne({ height: FORK }).lean())!.nextblockhash).toBe(hashAt(FORK + 1, 'b'));

    const inspection = (await (await api('/api/v1/admin/sync/rewind')).json()) as { data: Record<string, any> };
    expect(inspection.data.verdict).toBe('in-sync');

    const again = await api('/api/v1/admin/sync/rewind', {
      method: 'POST',
      body: JSON.stringify({ height: FORK, hash: hashAt(FORK, 'a') }),
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toContain('nothing for an operator to confirm');
  }, 30_000);
});

describe.skipIf(HAVE_MONGO)('a reorg deeper than the automatic cap, against a real MongoDB', () => {
  it('needs a database', () => {
    expect(NO_MONGO_REASON).toContain('MONGODB_TEST_URI');
  });
});
