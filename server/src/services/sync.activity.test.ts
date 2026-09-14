import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two activity times readiness reads, as the sync service writes them.
 *
 * `lastSyncedAt` moves when the index advances; `heartbeatAt` also moves when a
 * pass finds nothing to index. Readiness measures idleness from the later of
 * the two (#186). These tests pin what that heartbeat does and does not mean:
 * it is the last recorded checkpoint or finished idle pass -- not a promise
 * that the whole tick succeeded. A failure after a checkpoint shows through the
 * recorded sync error; a hung or overlapping tick shows by the heartbeat
 * growing old (independent review of #186, H186-01).
 */
const state = vi.hoisted(() => ({
  getBlockCount: vi.fn(),
  getBlockHash: vi.fn(),
  getBlockVerbose: vi.fn(),
  call: vi.fn(),
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  syncStateDoc: { lastSyncedHeight: 100, lastSyncedHash: 'aaaa' } as Record<string, unknown>,
  syncUpdateOne: vi.fn(),
}));

const emptyQuery = vi.hoisted(() => (): any => {
  const q: any = {
    select: () => q,
    sort: () => q,
    limit: () => q,
    lean: async () => [],
  };
  return q;
});

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
  mnListDiffService: { reset: vi.fn() },
}));
vi.mock('./chainLock.service.js', () => ({
  chainLockService: { noteBlock: vi.fn(), notifyBlockIndexed: vi.fn() },
}));
vi.mock('./metrics.service.js', () => ({
  metricsService: { setSyncPosition: vi.fn(), observeSync: vi.fn() },
}));
vi.mock('../models/Block.js', () => ({
  Block: {
    findOne: () => ({ select: () => ({ lean: async () => ({ hash: 'aaaa' }) }) }),
    deleteMany: vi.fn(),
    updateOne: vi.fn(),
    find: emptyQuery,
    bulkWrite: vi.fn(),
  },
}));
vi.mock('../models/Transaction.js', () => ({ Transaction: { deleteMany: vi.fn() } }));
vi.mock('../models/ServiceEpoch.js', () => ({ ServiceEpoch: { deleteMany: vi.fn() } }));
vi.mock('../models/QuorumCommitment.js', () => ({
  QuorumCommitment: { deleteMany: vi.fn(), find: emptyQuery, bulkWrite: vi.fn() },
}));
vi.mock('../models/QuorumRound.js', () => ({ QuorumRound: { updateMany: vi.fn() } }));
vi.mock('../models/MasternodeEvent.js', () => ({ MasternodeEvent: { deleteMany: vi.fn() } }));
vi.mock('../models/SyncState.js', () => ({
  SyncState: {
    findOne: async () => state.syncStateDoc,
    create: async () => state.syncStateDoc,
    updateOne: state.syncUpdateOne,
  },
}));

import { evaluateReadiness, readinessInput } from '../domain/readiness.js';
import { SyncService } from './sync.service.js';

type Update = { $set?: Record<string, any> };

/** Every cursor write that carried a heartbeat, in order. */
function heartbeatWrites(): Record<string, any>[] {
  return (state.syncUpdateOne.mock.calls as [unknown, Update][])
    .map(([, update]) => update?.$set ?? {})
    .filter((set) => set.heartbeatAt instanceof Date);
}

/** What the tick recorded as the reason it stopped, if it stopped. */
function recordedError(): string | null {
  for (const [, update] of state.syncUpdateOne.mock.calls as [unknown, Update][]) {
    const message = update?.$set?.error;
    if (typeof message === 'string') return message;
  }
  return null;
}

/** A service whose cursor is at `height` against a node at `tip`, with an unbroken chain. */
function serviceAt(height: number, tip: number): SyncService {
  state.syncStateDoc = { lastSyncedHeight: height, lastSyncedHash: 'aaaa' };
  state.getBlockCount.mockResolvedValue(tip);
  state.getBlockHash.mockResolvedValue('aaaa');
  return new SyncService();
}

beforeEach(() => {
  for (const fn of Object.values(state.logs)) fn.mockReset();
  for (const fn of [state.getBlockCount, state.getBlockHash, state.getBlockVerbose, state.call, state.syncUpdateOne]) {
    fn.mockReset();
  }
  state.syncUpdateOne.mockResolvedValue({});
});

describe('the activity times readiness reads', () => {
  it('an idle pass records a pass time and leaves the advance time alone', async () => {
    await serviceAt(100, 100).tick();
    const writes = heartbeatWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.lastSyncedAt).toBeUndefined();
    expect(recordedError()).toBeNull();
  });

  it('a pass that fails after a checkpoint keeps it, and readiness still reports the recorded error', async () => {
    const service = serviceAt(99, 200);
    vi.spyOn(service as any, 'indexBlock').mockImplementation(async (height: unknown) => {
      if (height === 126) throw new Error('block 126 could not be read');
      return 'aaaa';
    });
    await service.tick();

    // Checkpoints every 25 heights: 100 and 125 were recorded before the failure.
    expect(heartbeatWrites().map((set) => set.lastSyncedHeight)).toEqual([100, 125]);
    expect(recordedError()).toBe('block 126 could not be read');

    const last = heartbeatWrites().at(-1)!;
    const input = readinessInput({
      mongoConnected: true,
      chainTip: 200,
      cursor: { lastSyncedHeight: 125, lastSyncedAt: last.lastSyncedAt, heartbeatAt: last.heartbeatAt, error: recordedError() },
      nowMs: last.heartbeatAt.getTime() + 1_000,
      syncIntervalMs: 20_000,
    });
    expect(evaluateReadiness(input)).toEqual({ status: 'degraded', httpStatus: 503, failing: ['sync'] });
  });

  it('an overlapping tick and a hung backfill do not refresh the pass time', async () => {
    const service = serviceAt(100, 100);
    let release!: () => void;
    vi.spyOn(service as any, 'backfillPayees').mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve))
    );

    const hung = service.tick();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    // The idle pass wrote its heartbeat before the backfill began...
    expect(heartbeatWrites()).toHaveLength(1);
    // ...and a tick that overlaps the hung one writes nothing.
    await service.tick();
    expect(heartbeatWrites()).toHaveLength(1);
    expect(state.getBlockCount).toHaveBeenCalledTimes(1);

    // So the heartbeat ages, and once a block is waiting past the limit it reads as a stall.
    const passAt = heartbeatWrites()[0]!.heartbeatAt.getTime();
    const input = readinessInput({
      mongoConnected: true,
      chainTip: 101,
      cursor: { lastSyncedHeight: 100, lastSyncedAt: new Date(passAt - 60 * 60_000), heartbeatAt: new Date(passAt), error: null },
      nowMs: passAt + 5 * 60_000 + 1,
      syncIntervalMs: 20_000,
    });
    expect(evaluateReadiness(input).failing).toEqual(['sync-stalled']);

    release();
    await hung;
  });
});
