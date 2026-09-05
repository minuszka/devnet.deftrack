import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rollback is the only code in this project that deletes measurement
 * history, and a reset round older than the commitments `quorum listextended`
 * still reports can never be observed again. So the question these tests ask is
 * not "does a reorg rewind correctly" but "can anything other than a reorg make
 * it rewind at all".
 *
 * Before the fix, `getblockhash` was called as `.catch(() => null)` and the
 * null was compared against the stored hash -- so an RPC timeout, a node
 * restart, a `-28` warmup or a reindex (which answers "Block height out of
 * range" for every height it has not rebuilt) all read as "the hash differs",
 * walked the cursor to -1 and deleted the entire index.
 */
const state = vi.hoisted(() => ({
  getBlockCount: vi.fn(),
  getBlockHash: vi.fn(),
  getBlockVerbose: vi.fn(),
  call: vi.fn(),
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  syncStateDoc: { lastSyncedHeight: 8028, lastSyncedHash: 'aaaa' } as Record<string, unknown>,
  /** height -> hash the index holds. */
  stored: new Map<number, string>(),
  deleteMany: vi.fn(),
  txDeleteMany: vi.fn(),
  epochDeleteMany: vi.fn(),
  commitmentDeleteMany: vi.fn(),
  eventDeleteMany: vi.fn(),
  roundsUpdateMany: vi.fn(),
  blockUpdateOne: vi.fn(),
  syncUpdateOne: vi.fn(),
  diffReset: vi.fn(),
}));

const lean = <T>(value: T) => ({ select: () => ({ lean: async () => value }) });

vi.mock('../config.js', () => ({
  config: {
    sync: { enabled: true, intervalMs: 20_000, batchSize: 50, txConcurrency: 2 },
    dsl: { activationHeight: 5472, epochInterval: 24 },
  },
}));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('./rpc.service.js', () => ({
  rpc: {
    getBlockCount: state.getBlockCount,
    getBlockHash: state.getBlockHash,
    getBlockVerbose: state.getBlockVerbose,
    call: state.call,
  },
}));
vi.mock('../config/llmq.js', () => ({ LLMQ_PROFILES: [] }));
vi.mock('./quorumMemberCount.js', () => ({
  QuorumMemberCountResolver: class {
    async resolve() {
      return null;
    }
  },
}));
vi.mock('./mnListDiff.service.js', () => ({
  DIFF_CURSOR_KEY: 'listdiff',
  mnListDiffService: { reset: state.diffReset },
}));
vi.mock('./chainLock.service.js', () => ({
  chainLockService: { noteBlock: vi.fn(), notifyBlockIndexed: vi.fn() },
}));
vi.mock('./metrics.service.js', () => ({
  metricsService: { setSyncPosition: vi.fn(), observeSync: vi.fn() },
}));
vi.mock('../models/Block.js', () => ({
  Block: {
    findOne: (filter: { height: number }) =>
      lean(
        state.stored.has(filter.height) ? { hash: state.stored.get(filter.height) } : null
      ),
    deleteMany: state.deleteMany,
    updateOne: state.blockUpdateOne,
    find: () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }) }),
    bulkWrite: vi.fn(),
  },
}));
vi.mock('../models/Transaction.js', () => ({ Transaction: { deleteMany: state.txDeleteMany } }));
vi.mock('../models/ServiceEpoch.js', () => ({
  ServiceEpoch: { deleteMany: state.epochDeleteMany },
}));
vi.mock('../models/QuorumCommitment.js', () => ({
  QuorumCommitment: {
    deleteMany: state.commitmentDeleteMany,
    find: () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }) }),
    bulkWrite: vi.fn(),
  },
}));
vi.mock('../models/QuorumRound.js', () => ({
  QuorumRound: { updateMany: state.roundsUpdateMany },
}));
vi.mock('../models/MasternodeEvent.js', () => ({
  MasternodeEvent: { deleteMany: state.eventDeleteMany },
}));
vi.mock('../models/SyncState.js', () => ({
  SyncState: {
    findOne: async () => state.syncStateDoc,
    create: async () => state.syncStateDoc,
    updateOne: state.syncUpdateOne,
  },
}));

import { SyncService } from './sync.service.js';

/** Every write the rollback would perform, in one place. */
function destructiveCalls(): number {
  return (
    state.deleteMany.mock.calls.length +
    state.txDeleteMany.mock.calls.length +
    state.epochDeleteMany.mock.calls.length +
    state.commitmentDeleteMany.mock.calls.length +
    state.eventDeleteMany.mock.calls.length +
    state.roundsUpdateMany.mock.calls.length
  );
}

/** What the tick recorded as the reason it stopped, if it stopped. */
function recordedError(): string | null {
  for (const [, update] of state.syncUpdateOne.mock.calls as [unknown, Record<string, any>][]) {
    const message = update?.$set?.error;
    if (typeof message === 'string') return message;
  }
  return null;
}

beforeEach(() => {
  for (const fn of Object.values(state.logs)) fn.mockReset();
  for (const fn of [
    state.getBlockCount,
    state.getBlockHash,
    state.call,
    state.deleteMany,
    state.txDeleteMany,
    state.epochDeleteMany,
    state.commitmentDeleteMany,
    state.eventDeleteMany,
    state.roundsUpdateMany,
    state.blockUpdateOne,
    state.syncUpdateOne,
    state.getBlockVerbose,
    state.diffReset,
  ]) {
    fn.mockReset();
  }
  state.syncStateDoc = { lastSyncedHeight: 8028, lastSyncedHash: 'aaaa' };
  state.stored = new Map([
    [8028, 'aaaa'],
    [8027, 'cccc'],
    [8026, 'dddd'],
  ]);
  state.deleteMany.mockResolvedValue({ deletedCount: 1 });
  state.txDeleteMany.mockResolvedValue({ deletedCount: 0 });
  state.epochDeleteMany.mockResolvedValue({ deletedCount: 0 });
  state.commitmentDeleteMany.mockResolvedValue({ deletedCount: 0 });
  state.eventDeleteMany.mockResolvedValue({ deletedCount: 0 });
  state.roundsUpdateMany.mockResolvedValue({ modifiedCount: 0 });
  state.blockUpdateOne.mockResolvedValue({});
  state.syncUpdateOne.mockResolvedValue({});
});

describe('a node that cannot answer', () => {
  it('deletes nothing when getblockhash fails at the indexed tip', async () => {
    state.getBlockCount.mockResolvedValue(8030);
    state.getBlockHash.mockRejectedValue(new Error('timeout of 10000ms exceeded'));

    await new SyncService().tick();

    expect(destructiveCalls()).toBe(0);
    expect(state.diffReset).not.toHaveBeenCalled();
    expect(recordedError()).toContain('index untouched');
  });

  it('deletes nothing when the node is reindexing and sits below our height', async () => {
    // "Block height out of range" is what a reindexing node says about every
    // height it has not rebuilt yet. Reindexing the seed is a documented,
    // routine verification step on this project.
    state.getBlockCount.mockResolvedValue(4000);
    state.getBlockHash.mockRejectedValue(new Error('Block height out of range'));

    await new SyncService().tick();

    expect(destructiveCalls()).toBe(0);
    expect(recordedError()).toContain('4000');
  });

  it('deletes nothing when the node stops answering part-way through the rewind', async () => {
    state.getBlockCount.mockResolvedValue(8030);
    // The tip genuinely differs, so the rewind starts -- and then the node goes
    // away. Walking past that would run the cursor to -1.
    state.getBlockHash.mockImplementation(async (height: number) => {
      if (height === 8028) return 'bbbb';
      throw new Error('socket hang up');
    });

    await new SyncService().tick();

    expect(destructiveCalls()).toBe(0);
    expect(recordedError()).toContain('index untouched');
  });

  it('refuses a rewind deeper than the cap instead of performing it', async () => {
    state.getBlockCount.mockResolvedValue(8030);
    // Every height disagrees and the index holds all of them: a disagreement
    // this deep is a symptom, not a reorg.
    state.stored = new Map(
      Array.from({ length: 9000 }, (_, height) => [height, `stored-${height}`] as const)
    );
    state.getBlockHash.mockImplementation(async (height: number) => `node-${height}`);

    await new SyncService().tick();

    expect(destructiveCalls()).toBe(0);
    expect(recordedError()).toContain('operator');
  });
});

describe('a reorg that lands mid-batch', () => {
  it('refuses the block that does not follow the one before it', async () => {
    // Only the batch's LAST hash was ever checked, on the next tick. A reorg
    // that landed while a batch was being indexed therefore went straight in:
    // blocks from the abandoned chain were stored below a tip that was valid,
    // and nothing above them ever disagreed, so no later rollback had a reason
    // to look at them.
    state.syncStateDoc = { lastSyncedHeight: 8028, lastSyncedHash: 'aaaa' };
    state.getBlockCount.mockResolvedValue(8031);
    state.getBlockHash.mockImplementation(async (height: number) =>
      height === 8028 ? 'aaaa' : `hash-${height}`
    );
    // 8029 follows the indexed tip; 8030 names a predecessor from another chain.
    state.getBlockVerbose.mockImplementation(async (hash: string) => {
      const height = Number(hash.replace('hash-', ''));
      return {
        hash,
        height,
        previousblockhash: height === 8029 ? 'aaaa' : 'from-another-chain',
        time: 0, mediantime: 0, size: 0, version: 0, merkleroot: 'm',
        bits: '1', nonce: 0, difficulty: 0, chainwork: 'c', nTx: 0, tx: [],
      };
    });

    await new SyncService().tick();

    expect(recordedError()).toContain('moved mid-batch');
  });
});

describe('a real reorg', () => {
  it('still rewinds to the fork point', async () => {
    // The positive control: without it every test above would pass on a
    // rollback that had simply been disabled.
    state.getBlockCount.mockResolvedValue(8028);
    state.getBlockHash.mockImplementation(async (height: number) =>
      height === 8028 ? 'bbbb' : state.stored.get(height)
    );
    // Indexing the replacement block is out of scope here; letting it fail
    // inside tick's own catch keeps this test about the rewind.
    state.call.mockRejectedValue(new Error('not part of this test'));

    await new SyncService().tick();

    expect(state.deleteMany).toHaveBeenCalledWith({ height: { $gt: 8027 } });
    expect(state.roundsUpdateMany).toHaveBeenCalled();
    expect(state.diffReset).toHaveBeenCalled();
  });
});
