import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The operator's path past the rollback cap.
 *
 * The automatic rewind refuses anything deeper than MAX_ROLLBACK_DEPTH and
 * records that an operator has to confirm. What it must refuse is settled in
 * `sync.rollback.test.ts`; what these tests settle is the confirmation itself:
 * that it names the real fork point, that it performs exactly that rewind and
 * nothing else, and that every other request is refused with nothing deleted.
 */
const state = vi.hoisted(() => ({
  getBlockCount: vi.fn(),
  getBlockHash: vi.fn(),
  getBlockVerbose: vi.fn(),
  call: vi.fn(),
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  syncStateDoc: { lastSyncedHeight: 9000, lastSyncedHash: 'stored-9000' } as Record<string, unknown>,
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
const emptyQuery = vi.hoisted(() => (): any => {
  const q: any = { select: () => q, sort: () => q, limit: () => q, lean: async () => [] };
  return q;
});

vi.mock('../config.js', () => ({
  config: {
    sync: { enabled: true, intervalMs: 20_000, batchSize: 50, txConcurrency: 2 },
    dsl: { activationHeight: 0, epochInterval: 24 },
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
  chainLockService: { notifyBlockIndexed: vi.fn() },
}));
vi.mock('./metrics.service.js', () => ({
  metricsService: { setSyncPosition: vi.fn(), observeSync: vi.fn() },
}));
vi.mock('../models/Block.js', () => ({
  Block: {
    findOne: (filter: { height: number }) =>
      lean(state.stored.has(filter.height) ? { hash: state.stored.get(filter.height) } : null),
    deleteMany: state.deleteMany,
    updateOne: state.blockUpdateOne,
    find: emptyQuery,
    bulkWrite: vi.fn(),
  },
}));
vi.mock('../models/Transaction.js', () => ({ Transaction: { deleteMany: state.txDeleteMany } }));
vi.mock('../models/ServiceEpoch.js', () => ({ ServiceEpoch: { deleteMany: state.epochDeleteMany } }));
vi.mock('../models/QuorumCommitment.js', () => ({
  QuorumCommitment: { deleteMany: state.commitmentDeleteMany, find: emptyQuery, bulkWrite: vi.fn() },
}));
vi.mock('../models/QuorumRound.js', () => ({ QuorumRound: { updateMany: state.roundsUpdateMany } }));
vi.mock('../models/MasternodeEvent.js', () => ({ MasternodeEvent: { deleteMany: state.eventDeleteMany } }));
vi.mock('../models/SyncState.js', () => ({
  SyncState: {
    findOne: async () => state.syncStateDoc,
    create: async () => state.syncStateDoc,
    updateOne: state.syncUpdateOne,
  },
}));

import { RewindRefusedError, SyncService } from './sync.service.js';

const FORK = 8000;
/** The index and the node agree through FORK and disagree above it. */
function forkedChain(): void {
  state.stored = new Map(
    Array.from({ length: 9001 }, (_, h) => [h, h <= FORK ? `same-${h}` : `stored-${h}`] as const)
  );
  state.getBlockHash.mockImplementation(async (h: number) => (h <= FORK ? `same-${h}` : `node-${h}`));
  state.getBlockCount.mockResolvedValue(9010);
}

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
  state.syncStateDoc = { lastSyncedHeight: 9000, lastSyncedHash: 'stored-9000' };
  state.deleteMany.mockResolvedValue({ deletedCount: 1000 });
  state.txDeleteMany.mockResolvedValue({ deletedCount: 0 });
  state.epochDeleteMany.mockResolvedValue({ deletedCount: 0 });
  state.commitmentDeleteMany.mockResolvedValue({ deletedCount: 0 });
  state.eventDeleteMany.mockResolvedValue({ deletedCount: 3 });
  state.roundsUpdateMany.mockResolvedValue({ modifiedCount: 40 });
  state.blockUpdateOne.mockResolvedValue({});
  state.syncUpdateOne.mockResolvedValue({});
});

describe('inspecting a disagreement the automatic rewind refused', () => {
  it('names the fork point by bisection and says it is the operator\'s call', async () => {
    forkedChain();
    const inspection = await new SyncService().inspectRewind();

    expect(inspection.verdict).toBe('operator');
    expect(inspection.forkPoint).toEqual({ height: FORK, hash: `same-${FORK}`, depth: 1000 });
    expect(inspection.indexedHeight).toBe(9000);
    expect(inspection.nodeHashAtIndexed).toBe('node-9000');
    expect(inspection.automaticDepth).toBe(200);
    expect(inspection.probes).toBeLessThanOrEqual(14);
    expect(inspection.reason).toContain('POST /api/v1/admin/sync/rewind');
    // Inspection is read-only.
    expect(destructiveCalls()).toBe(0);
  });

  it('reports an index in agreement with the node as nothing to do', async () => {
    forkedChain();
    state.syncStateDoc = { lastSyncedHeight: FORK, lastSyncedHash: `same-${FORK}` };
    const inspection = await new SyncService().inspectRewind();
    expect(inspection.verdict).toBe('in-sync');
    expect(inspection.forkPoint).toBeNull();
    expect(inspection.probes).toBe(0);
  });

  it('leaves a shallow disagreement to the automatic rewind', async () => {
    forkedChain();
    state.syncStateDoc = { lastSyncedHeight: FORK + 50, lastSyncedHash: `stored-${FORK + 50}` };
    const inspection = await new SyncService().inspectRewind();
    expect(inspection.verdict).toBe('automatic');
    expect(inspection.forkPoint).toMatchObject({ height: FORK, depth: 50 });
  });

  it('concludes nothing when the node stops answering mid-search', async () => {
    forkedChain();
    state.getBlockHash.mockImplementation(async (h: number) => {
      if (h === 9000) return 'node-9000';
      throw new Error('socket hang up');
    });
    const inspection = await new SyncService().inspectRewind();
    expect(inspection.verdict).toBe('undecidable');
    expect(inspection.forkPoint).toBeNull();
    expect(inspection.reason).toContain('did not answer');
  });

  it('recognises a different chain rather than proposing a rewind to genesis', async () => {
    forkedChain();
    state.getBlockHash.mockImplementation(async (h: number) => `other-${h}`);
    const inspection = await new SyncService().inspectRewind();
    expect(inspection.verdict).toBe('no-common-history');
    expect(inspection.forkPoint).toBeNull();
  });

  it('is what the automatic refusal points the operator at', async () => {
    forkedChain();
    await new SyncService().tick();
    expect(destructiveCalls()).toBe(0);
    expect(recordedError()).toContain('GET /api/v1/admin/sync/rewind');
  });
});

describe('confirming the rewind', () => {
  it('performs exactly the rewind to the fork point it reported', async () => {
    forkedChain();
    const service = new SyncService();
    const result = await service.confirmRewind({ height: FORK, hash: `same-${FORK}`, actor: 'ops@example' });

    expect(state.deleteMany).toHaveBeenCalledWith({ height: { $gt: FORK } });
    expect(state.roundsUpdateMany).toHaveBeenCalled();
    expect(state.diffReset).toHaveBeenCalled();
    expect(result).toMatchObject({
      height: FORK,
      hash: `same-${FORK}`,
      depth: 1000,
      droppedBlocks: 1000,
      resetRounds: 40,
      droppedEvents: 3,
      actor: 'ops@example',
    });
    // The cursor moves to the fork point first, and the record of who did it
    // lands with the error cleared.
    const writes = state.syncUpdateOne.mock.calls as [unknown, Record<string, any>][];
    expect(writes.some(([, u]) => u?.$set?.lastSyncedHeight === FORK && u?.$set?.lastSyncedHash === `same-${FORK}`)).toBe(true);
    const audit = writes.find(([, u]) => u?.$set?.operatorRewind);
    expect(audit?.[1].$set.operatorRewind).toMatchObject({ height: FORK, actor: 'ops@example', droppedBlocks: 1000 });
    expect(audit?.[1].$set.error).toBeNull();
    expect(state.logs.warn).toHaveBeenCalledWith(expect.stringContaining('ops@example'));
  });

  it('refuses a fork point other than the real one, deleting nothing', async () => {
    forkedChain();
    const service = new SyncService();
    await expect(
      service.confirmRewind({ height: FORK - 100, hash: `same-${FORK - 100}`, actor: 'ops@example' })
    ).rejects.toBeInstanceOf(RewindRefusedError);
    // Right height, wrong hash: the operator is confirming a fact, not a number.
    await expect(
      service.confirmRewind({ height: FORK, hash: 'f'.repeat(64), actor: 'ops@example' })
    ).rejects.toThrow(/fork point is 8000/);
    expect(destructiveCalls()).toBe(0);
  });

  it('refuses when there is nothing beyond the automatic depth to confirm', async () => {
    forkedChain();
    state.syncStateDoc = { lastSyncedHeight: FORK + 50, lastSyncedHash: `stored-${FORK + 50}` };
    await expect(
      new SyncService().confirmRewind({ height: FORK, hash: `same-${FORK}`, actor: 'ops@example' })
    ).rejects.toThrow(/automatic/);

    state.syncStateDoc = { lastSyncedHeight: FORK, lastSyncedHash: `same-${FORK}` };
    await expect(
      new SyncService().confirmRewind({ height: FORK, hash: `same-${FORK}`, actor: 'ops@example' })
    ).rejects.toThrow(/in-sync/);
    expect(destructiveCalls()).toBe(0);
  });

  it('refuses while a tick is in flight, and lets the tick finish', async () => {
    forkedChain();
    let release!: (value: number) => void;
    state.getBlockCount.mockImplementationOnce(() => new Promise<number>((resolve) => (release = resolve)));
    const service = new SyncService();
    const tick = service.tick();

    await expect(
      service.confirmRewind({ height: FORK, hash: `same-${FORK}`, actor: 'ops@example' })
    ).rejects.toThrow(/in progress/);

    release(9010);
    await tick;
    expect(destructiveCalls()).toBe(0);
  });

  it('drops a tick that arrives while it is confirming', async () => {
    forkedChain();
    const service = new SyncService();
    const confirming = service.confirmRewind({ height: FORK, hash: `same-${FORK}`, actor: 'ops@example' });
    // Overlapping ticks are dropped rather than queued; the confirmation holds
    // the same guard, so nothing indexes on top of a rewind in progress.
    await service.tick();
    await confirming;
    expect(state.getBlockVerbose).not.toHaveBeenCalled();
  });
});
