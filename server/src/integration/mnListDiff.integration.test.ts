import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, NO_MONGO_REASON, syncIndexes } from './mongo.js';
import { hashOf } from './fixtures.js';
import type { ListDiffResult } from '../domain/mnListDiff.js';

/**
 * The list-diff walker, end to end, over a real database.
 *
 * It is the only writer of chain-derived masternode transitions, so what it
 * writes is what the record says about every ban wave. Its unit test proves
 * the walk's discipline against fakes -- the penalty baseline, the abandoned
 * batch. This one lets the real models write and reads the rows back, which
 * is the only place a silently dropped path (an attribution that never lands,
 * a source that defaults to the wrong value) can be seen.
 */
const MN_A = 'a'.repeat(64);
const MN_B = 'b'.repeat(64);
const MN_C = 'c'.repeat(64);

const rpcState = vi.hoisted(() => ({
  /** `${base}:${target}` -> the diff the fake node answers with. */
  diffs: new Map<string, unknown>(),
  asked: [] as string[],
}));

vi.mock('../services/rpc.service.js', () => ({
  rpc: {
    call: async (method: string, params: unknown[]) => {
      if (method === 'protx' && params[0] === 'listdiff') {
        const key = `${params[1]}:${params[2]}`;
        rpcState.asked.push(key);
        const diff = rpcState.diffs.get(key);
        if (!diff) throw new Error(`no diff prepared for listdiff ${key}`);
        return diff;
      }
      throw new Error(`unexpected RPC in this test: ${method} ${JSON.stringify(params)}`);
    },
  },
}));

const diff = (base: number, target: number, body: Partial<ListDiffResult>): void => {
  rpcState.diffs.set(`${base}:${target}`, {
    baseHeight: base,
    blockHeight: target,
    addedMNs: [],
    removedMNs: [],
    updatedMNs: [],
    ...body,
  });
};

describe.skipIf(!HAVE_MONGO)('the list-diff walker, against a real MongoDB', () => {
  let MasternodeEvent: typeof import('../models/MasternodeEvent.js').MasternodeEvent;
  let SyncState: typeof import('../models/SyncState.js').SyncState;
  let MnListDiffService: typeof import('../services/mnListDiff.service.js').MnListDiffService;

  beforeAll(async () => {
    const dbName = await connectTestMongo('mndiff');
    process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${dbName}`;

    ({ MasternodeEvent } = await import('../models/MasternodeEvent.js'));
    ({ SyncState } = await import('../models/SyncState.js'));
    const { MasternodeState } = await import('../models/MasternodeState.js');
    const { DevnetOperator } = await import('../models/DevnetOperator.js');
    await syncIndexes([MasternodeEvent, SyncState, MasternodeState, DevnetOperator]);

    // The indexer is at 5, so the walker may go that far and no further.
    await SyncState.create({ key: 'blocks', lastSyncedHeight: 5, lastSyncedHash: hashOf('block:5') });

    // What the poller already knows about B: its host. A ban carries no
    // service in the diff, and this is where the attribution comes from.
    await MasternodeState.create({
      proTxHash: MN_B,
      collateralHash: hashOf('collateral:b'),
      collateralIndex: 0,
      service: '10.0.0.2:19799',
      hostIp: '10.0.0.2',
    });
    await DevnetOperator.create([
      { operatorLabel: 'op-fullnode-1', proTxHashes: [MN_A], hostIps: [] },
      { operatorLabel: 'op-fullnode-2', proTxHashes: [], hostIps: ['10.0.0.2'] },
    ]);

    // The chain: A and B exist from the start (B already serving a penalty),
    // C registers at 2, A is punished at 3, B is banned at 4 and revived at 5,
    // C leaves at 5. B's penalty decays by one every block throughout.
    diff(1, 1, {
      addedMNs: [
        { proTxHash: MN_A, state: { PoSePenalty: 0, PoSeBanHeight: -1 } },
        { proTxHash: MN_B, state: { PoSePenalty: 50, PoSeBanHeight: -1 } },
      ],
    });
    diff(1, 2, { addedMNs: [{ proTxHash: MN_C, state: { service: '10.0.0.3:19799', PoSePenalty: 0 } }] });
    diff(2, 3, { updatedMNs: [{ [MN_A]: { PoSePenalty: 100 } }, { [MN_B]: { PoSePenalty: 49 } }] });
    diff(3, 4, { updatedMNs: [{ [MN_B]: { PoSeBanHeight: 4, PoSePenalty: 48 } }] });
    diff(4, 5, { updatedMNs: [{ [MN_B]: { PoSeBanHeight: -1, PoSePenalty: 47 } }], removedMNs: [MN_C] });

    ({ MnListDiffService } = await import('../services/mnListDiff.service.js'));
  }, 60_000);

  afterAll(async () => {
    await dropTestMongo();
  });

  const keys = async (): Promise<string[]> =>
    (await MasternodeEvent.find().select('eventKey').lean()).map((e) => e.eventKey).sort();

  it('walks to the indexed height and writes exactly the transitions, block-exact', async () => {
    await new MnListDiffService().tick();

    expect(await keys()).toEqual(
      [
        `${MN_C}:registered:2`,
        `${MN_A}:penalty_up:3`,
        `${MN_B}:banned:4`,
        `${MN_B}:revived:5`,
        `${MN_C}:removed:5`,
      ].sort()
    );
    // B's decay never became a row: 50 -> 49 -> 48 -> 47 is the node serving
    // its sentence, and the seed at 1 is what let the walk know that.
    expect(rpcState.asked[0]).toBe('1:1');

    const cursor = await SyncState.findOne({ key: 'mndiff' }).lean();
    expect(cursor!.lastSyncedHeight).toBe(5);
    expect(cursor!.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('writes every field the ban-wave views read, attributed through what the poller knew', async () => {
    const ban = await MasternodeEvent.findOne({ eventKey: `${MN_B}:banned:4` }).lean();
    expect(ban, 'the ban was not written').not.toBeNull();
    expect(ban!.proTxHash).toBe(MN_B);
    expect(ban!.type).toBe('banned');
    expect(ban!.height).toBe(4);
    expect(ban!.penaltyAfter).toBe(48);
    // The diff carried no service; the host came from the state row, and the
    // operator from the host. This is the attribution a ban wave is read by.
    expect(ban!.serviceAfter).toBeNull();
    expect(ban!.hostIp).toBe('10.0.0.2');
    expect(ban!.operatorLabel).toBe('op-fullnode-2');
    expect(ban!.source).toBe('listdiff');
    expect(ban!.revocationReason).toBeNull();
    expect(ban!.detectedAt).toBeInstanceOf(Date);

    const punished = await MasternodeEvent.findOne({ eventKey: `${MN_A}:penalty_up:3` }).lean();
    expect(punished!.penaltyAfter).toBe(100);
    // Explicit proTxHash attribution wins even with no host at all.
    expect(punished!.operatorLabel).toBe('op-fullnode-1');
    expect(punished!.hostIp).toBeNull();

    const registered = await MasternodeEvent.findOne({ eventKey: `${MN_C}:registered:2` }).lean();
    expect(registered!.serviceAfter).toBe('10.0.0.3:19799');
    expect(registered!.hostIp).toBe('10.0.0.3');
    // Nobody declared this host: null, never a guess.
    expect(registered!.operatorLabel).toBeNull();
  });

  it('writes nothing new when a restarted walker re-seeds and continues', async () => {
    const before = await keys();
    // The chain moved one block: only decay, no transition.
    await SyncState.updateOne({ key: 'blocks' }, { $set: { lastSyncedHeight: 6 } });
    diff(1, 5, {
      addedMNs: [
        { proTxHash: MN_A, state: { PoSePenalty: 98, PoSeBanHeight: -1 } },
        { proTxHash: MN_B, state: { PoSePenalty: 47, PoSeBanHeight: -1 } },
      ],
    });
    diff(5, 6, { updatedMNs: [{ [MN_A]: { PoSePenalty: 97 } }, { [MN_B]: { PoSePenalty: 46 } }] });

    rpcState.asked.length = 0;
    await new MnListDiffService().tick();

    // A fresh instance seeds from the cursor, not from the start.
    expect(rpcState.asked[0]).toBe('1:5');
    expect(await keys()).toEqual(before);
    expect((await SyncState.findOne({ key: 'mndiff' }).lean())!.lastSyncedHeight).toBe(6);
  });

  it('replays a rewound range without duplicating or rewriting a transition', async () => {
    const original = await MasternodeEvent.findOne({ eventKey: `${MN_B}:banned:4` }).lean();

    // A reorg rollback pulled the cursor back to 3; the walker re-reads 4..6.
    await SyncState.updateOne({ key: 'mndiff' }, { $set: { lastSyncedHeight: 3 } });
    diff(1, 3, {
      addedMNs: [
        { proTxHash: MN_A, state: { PoSePenalty: 100, PoSeBanHeight: -1 } },
        { proTxHash: MN_B, state: { PoSePenalty: 49, PoSeBanHeight: -1 } },
        { proTxHash: MN_C, state: { PoSePenalty: 0 } },
      ],
    });

    await new MnListDiffService().tick();

    expect(await MasternodeEvent.countDocuments()).toBe(5);
    // $setOnInsert only: the first observation of a transition is the record,
    // and a replay must not so much as touch its timestamp.
    const replayed = await MasternodeEvent.findOne({ eventKey: `${MN_B}:banned:4` }).lean();
    expect(replayed!.detectedAt).toEqual(original!.detectedAt);
    expect(replayed!._id).toEqual(original!._id);
    expect((await SyncState.findOne({ key: 'mndiff' }).lean())!.lastSyncedHeight).toBe(6);
  });
});

describe.skipIf(HAVE_MONGO)('the list-diff walker, against a real MongoDB', () => {
  it('needs a database', () => {
    expect(NO_MONGO_REASON).toContain('MONGODB_TEST_URI');
  });
});
