import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, NO_MONGO_REASON, syncIndexes } from './mongo.js';
import { hashOf } from './fixtures.js';

/**
 * The masternode poller, end to end, over a real database.
 *
 * It owns the current-state view, the network snapshots and the Sentinel
 * ledger transitions -- and, since the writers were split, it must NOT write
 * the chain transitions the walker owns, or every experiment counts them
 * twice again. A fake `bulkWrite` can show what the poller asked for; only
 * the database can show what landed, and whether a field the state view
 * reads (the DSL ledger, the attribution, the removal mark) survives the
 * round trip through the schema.
 */
const MN_A = hashOf('mn:a');
const MN_B = hashOf('mn:b');
const MN_C = hashOf('mn:c');
const MN_D = hashOf('mn:d');

interface FakeState {
  service: string;
  PoSePenalty: number;
  PoSeBanHeight: number;
  missedServiceEpochs?: number;
  lastServiceEpoch?: number;
  rewardSuspended?: boolean;
  dslBanHeight?: number;
}

const rpcState = vi.hoisted(() => ({
  height: 100,
  list: [] as unknown[],
}));

vi.mock('../services/rpc.service.js', () => ({
  rpc: {
    getBlockCount: async () => rpcState.height,
    call: async (method: string, params: unknown[]) => {
      if (method === 'protx' && params[0] === 'list') return rpcState.list;
      throw new Error(`unexpected RPC in this test: ${method} ${JSON.stringify(params)}`);
    },
  },
}));

function entry(proTxHash: string, host: string, state: Partial<FakeState> = {}) {
  return {
    type: 'Regular',
    proTxHash,
    collateralHash: hashOf(`collateral:${proTxHash}`),
    collateralIndex: 1,
    collateralAddress: `yCollateral${host.replaceAll('.', '')}`,
    state: {
      service: `${host}:19799`,
      registeredHeight: 50,
      lastPaidHeight: 90,
      PoSePenalty: 0,
      PoSeBanHeight: -1,
      PoSeRevivedHeight: -1,
      ownerAddress: 'yOwner',
      votingAddress: 'yVoting',
      payoutAddress: 'yPayout',
      pubKeyOperator: '8'.repeat(96),
      missedServiceEpochs: 0,
      lastServiceEpoch: 399,
      rewardSuspended: false,
      dslBanHeight: -1,
      ...state,
    },
  };
}

describe.skipIf(!HAVE_MONGO)('the masternode poller, against a real MongoDB', () => {
  let MasternodeState: typeof import('../models/MasternodeState.js').MasternodeState;
  let MasternodeEvent: typeof import('../models/MasternodeEvent.js').MasternodeEvent;
  let MasternodeSnapshot: typeof import('../models/MasternodeSnapshot.js').MasternodeSnapshot;
  let service: import('../services/masternodePoller.service.js').MasternodePollerService;
  let llmq: typeof import('../config/llmq.js');

  beforeAll(async () => {
    const dbName = await connectTestMongo('mnpoller');
    process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${dbName}`;

    ({ MasternodeState } = await import('../models/MasternodeState.js'));
    ({ MasternodeEvent } = await import('../models/MasternodeEvent.js'));
    ({ MasternodeSnapshot } = await import('../models/MasternodeSnapshot.js'));
    const { DevnetOperator } = await import('../models/DevnetOperator.js');
    await syncIndexes([MasternodeState, MasternodeEvent, MasternodeSnapshot, DevnetOperator]);
    await DevnetOperator.create({ operatorLabel: 'op-fullnode-1', proTxHashes: [], hostIps: ['10.0.0.1'] });

    llmq = await import('../config/llmq.js');
    const { MasternodePollerService } = await import('../services/masternodePoller.service.js');
    service = new MasternodePollerService();
  }, 60_000);

  afterAll(async () => {
    await dropTestMongo();
  });

  const eventKeys = async (): Promise<string[]> =>
    (await MasternodeEvent.find().select('eventKey').lean()).map((e) => e.eventKey).sort();

  it('writes the current state of every masternode with every field the view reads', async () => {
    rpcState.height = 100;
    rpcState.list = [
      entry(MN_A, '10.0.0.1'),
      entry(MN_B, '10.0.0.2', { PoSePenalty: 30 }),
      entry(MN_C, '10.0.0.3', { PoSePenalty: 152, PoSeBanHeight: 90 }),
      entry(MN_D, '10.0.0.4'),
    ];
    await service.collect();

    const a = await MasternodeState.findOne({ proTxHash: MN_A }).lean();
    expect(a, 'masternode A was not written').not.toBeNull();
    expect(a!.type).toBe('Regular');
    expect(a!.collateralHash).toBe(hashOf(`collateral:${MN_A}`));
    expect(a!.collateralIndex).toBe(1);
    expect(a!.collateralAddress).toBe('yCollateral10001');
    expect(a!.service).toBe('10.0.0.1:19799');
    expect(a!.registeredHeight).toBe(50);
    expect(a!.lastPaidHeight).toBe(90);
    expect(a!.poSePenalty).toBe(0);
    expect(a!.poSeBanHeight).toBe(-1);
    expect(a!.poSeRevivedHeight).toBe(-1);
    expect(a!.banned).toBe(false);
    // The Sentinel ledger, verbatim from the node's JSON.
    expect(a!.missedServiceEpochs).toBe(0);
    expect(a!.lastServiceEpoch).toBe(399);
    expect(a!.rewardSuspended).toBe(false);
    expect(a!.dslBanHeight).toBe(-1);
    expect(a!.ownerAddress).toBe('yOwner');
    expect(a!.votingAddress).toBe('yVoting');
    expect(a!.payoutAddress).toBe('yPayout');
    expect(a!.pubKeyOperator).toBe('8'.repeat(96));
    // Attribution by host, from the declared operator map.
    expect(a!.hostIp).toBe('10.0.0.1');
    expect(a!.operatorLabel).toBe('op-fullnode-1');
    expect(a!.active).toBe(true);
    expect(a!.removedAt).toBeNull();
    expect(a!.firstSeenAt).toBeInstanceOf(Date);
    expect(a!.lastSeenAt).toBeInstanceOf(Date);

    const c = await MasternodeState.findOne({ proTxHash: MN_C }).lean();
    expect(c!.banned).toBe(true);
    expect(c!.poSeBanHeight).toBe(90);
    expect(c!.operatorLabel).toBeNull();

    // A first sighting is not a transition: nothing to record yet.
    expect(await MasternodeEvent.countDocuments()).toBe(0);
  });

  it('writes a network snapshot with the counts and the structural ceiling', async () => {
    const snapshots = await MasternodeSnapshot.find().lean();
    expect(snapshots).toHaveLength(1);
    const [snap] = snapshots;
    expect(snap!.height).toBe(100);
    expect(snap!.at).toBeInstanceOf(Date);
    expect(snap!.total).toBe(4);
    expect(snap!.enabled).toBe(3);
    expect(snap!.banned).toBe(1);
    expect(snap!.penaltySum).toBe(182);
    expect(snap!.penaltyMax).toBe(152);
    expect(snap!.penalised).toBe(2);
    // What CalculateQuorum would return right now, and what one round could
    // punish -- derived from the profile signing at this height.
    const profile = llmq.chainlockProfileAtHeight(100);
    const effective = Math.min(profile.size, 3);
    expect(snap!.effectiveQuorumSize).toBe(effective);
    expect(snap!.maxPossibleBan).toBe(llmq.maxPossibleBan(effective, profile.minSize));
  });

  it('records the Sentinel transitions and only those, and marks a masternode that left the list', async () => {
    const dBefore = await MasternodeState.findOne({ proTxHash: MN_D }).lean();

    rpcState.height = 101;
    rpcState.list = [
      entry(MN_A, '10.0.0.1', { missedServiceEpochs: 1, lastServiceEpoch: 400 }),
      // A PoSe penalty jump is the walker's to record, not the poller's.
      entry(MN_B, '10.0.0.2', { PoSePenalty: 130, rewardSuspended: true }),
      entry(MN_C, '10.0.0.3', { PoSePenalty: 151, PoSeBanHeight: 90, dslBanHeight: 101 }),
    ];
    await service.collect();

    expect(await eventKeys()).toEqual(
      [`${MN_A}:service_missed:101:1`, `${MN_B}:service_suspended:101`, `${MN_C}:service_banned:101`].sort()
    );
    const missed = await MasternodeEvent.findOne({ eventKey: `${MN_A}:service_missed:101:1` }).lean();
    expect(missed!.proTxHash).toBe(MN_A);
    expect(missed!.type).toBe('service_missed');
    expect(missed!.height).toBe(101);
    expect(missed!.source).toBe('poll');
    expect(missed!.hostIp).toBe('10.0.0.1');
    expect(missed!.operatorLabel).toBe('op-fullnode-1');
    expect(missed!.detectedAt).toBeInstanceOf(Date);

    // The state view follows the ledger.
    const b = await MasternodeState.findOne({ proTxHash: MN_B }).lean();
    expect(b!.rewardSuspended).toBe(true);
    expect(b!.poSePenalty).toBe(130);
    const c = await MasternodeState.findOne({ proTxHash: MN_C }).lean();
    expect(c!.dslBanHeight).toBe(101);

    // D left `protx list`: kept for history, marked, and its last sighting
    // preserved rather than bumped to now.
    const d = await MasternodeState.findOne({ proTxHash: MN_D }).lean();
    expect(d!.active).toBe(false);
    expect(d!.removedAt).toBeInstanceOf(Date);
    expect(d!.lastSeenAt).toEqual(dBefore!.lastSeenAt);
    // The `removed` event itself belongs to the walker.
    expect(await MasternodeEvent.countDocuments({ type: 'removed' })).toBe(0);

    // The counts changed, so a second snapshot was taken.
    expect(await MasternodeSnapshot.countDocuments()).toBe(2);
    const latest = await MasternodeSnapshot.findOne().sort({ height: -1 }).lean();
    expect(latest!.height).toBe(101);
    expect(latest!.total).toBe(3);
  });

  it('records the recovery and reinstates a masternode that returns', async () => {
    rpcState.height = 102;
    rpcState.list = [
      entry(MN_A, '10.0.0.1', { missedServiceEpochs: 0, lastServiceEpoch: 401 }),
      entry(MN_B, '10.0.0.2', { PoSePenalty: 129, rewardSuspended: true }),
      entry(MN_C, '10.0.0.3', { PoSePenalty: 150, PoSeBanHeight: 90, dslBanHeight: 101 }),
      entry(MN_D, '10.0.0.4'),
    ];
    await service.collect();

    expect(await eventKeys()).toContain(`${MN_A}:service_recovered:102:401`);
    expect(await MasternodeEvent.countDocuments()).toBe(4);

    const d = await MasternodeState.findOne({ proTxHash: MN_D }).lean();
    expect(d!.active).toBe(true);
    expect(d!.removedAt).toBeNull();
    // Reinstated, not re-created: the first sighting stands.
    expect(await MasternodeState.countDocuments({ proTxHash: MN_D })).toBe(1);
  });

  it('does not collect again at an unchanged height, and writes nothing new for an unchanged ledger', async () => {
    const snapshots = await MasternodeSnapshot.countDocuments();
    await service.collect();
    expect(await MasternodeSnapshot.countDocuments()).toBe(snapshots);

    rpcState.height = 103;
    await service.collect();
    expect(await MasternodeEvent.countDocuments()).toBe(4);
    expect(await MasternodeState.countDocuments()).toBe(4);
  });
});

describe.skipIf(HAVE_MONGO)('the masternode poller, against a real MongoDB', () => {
  it('needs a database', () => {
    expect(NO_MONGO_REASON).toContain('MONGODB_TEST_URI');
  });
});
