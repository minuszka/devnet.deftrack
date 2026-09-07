import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A ZMQ observation whose block is not indexed yet is the NORMAL case: the
 * notification beats the indexer by design. The derivation leaves such a row
 * pending and is woken again by the indexer (`notifyBlockIndexed`) or the next
 * RPC tick.
 *
 * It must not wake itself. The tail of `applyPendingObservations` re-runs the
 * batch when a notification arrived while it was busy -- and it used to fold
 * "rows left pending" into the same flag, so a single not-yet-indexed block
 * made it re-query Mongo in a tight loop until the block landed: two queries
 * per iteration, for up to a sync interval per block, and for an hour for a
 * hash that never gets indexed. Found by the integration test, whose worker
 * ran out of heap with one fresh unplaceable observation in the table.
 */
const state = vi.hoisted(() => ({
  finds: 0,
  pending: [] as Record<string, unknown>[],
  blockFound: null as Record<string, unknown> | null,
  listeners: [] as Array<(topic: string) => void>,
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const query = <T>(rows: T) => {
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'sort', 'limit']) q[method] = () => q;
  q.lean = async () => rows;
  return q;
};

vi.mock('../config.js', () => ({
  config: { chainlock: { intervalMs: 10_000, reconcileIntervalMs: 300_000 } },
}));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('./rpc.service.js', () => ({
  rpc: { getBlockCount: async () => 100, getBlock: async () => ({ chainlock: false }), getBestChainLock: async () => null },
}));
vi.mock('./zmq.service.js', () => ({
  zmqService: {
    enabled: true,
    onObservation: (listener: (topic: string) => void) => {
      state.listeners.push(listener);
      return () => undefined;
    },
  },
}));
vi.mock('./metrics.service.js', () => ({ metricsService: { observeChainLocks: vi.fn() } }));
vi.mock('./localClock.service.js', () => ({ localClockService: { current: async () => null } }));
vi.mock('../models/NodeObservation.js', () => ({
  NodeObservation: {
    find: () => {
      state.finds++;
      return query(state.pending);
    },
    updateMany: async () => ({}),
  },
}));
vi.mock('../models/Block.js', () => ({
  Block: {
    find: () => query([]),
    findOne: () => query(state.blockFound),
    updateOne: async () => ({}),
    updateMany: async () => ({ modifiedCount: 0 }),
    bulkWrite: async () => ({}),
  },
}));
vi.mock('../models/Transaction.js', () => ({ Transaction: { updateMany: async () => ({}) } }));
vi.mock('../models/PeerObservation.js', () => ({ PeerObservation: { updateOne: async () => ({}) } }));

import { ChainLockService } from './chainLock.service.js';

const settle = () => new Promise((done) => setTimeout(done, 100));

beforeEach(() => {
  state.finds = 0;
  state.blockFound = null;
  state.listeners.length = 0;
  state.pending = [
    { observationKey: 'hashblock:aa', topic: 'hashblock', hash: 'aa', receivedAt: new Date() },
  ];
});

describe('the ZMQ derivation, with a block that is not indexed yet', () => {
  it('reads the pending rows once per tick and then waits to be woken', async () => {
    const service = new ChainLockService();
    await service.tick();
    await settle();
    // One read for the tick. Anything more is the derivation waking itself.
    expect(state.finds).toBe(1);
  });

  it('is woken by the indexer, and by a notification that arrived while it was busy', async () => {
    const service = new ChainLockService();
    await service.tick();
    await settle();
    expect(state.finds).toBe(1);

    service.notifyBlockIndexed();
    await settle();
    expect(state.finds).toBe(2);

    service.start();
    try {
      await settle();
      const before = state.finds;
      // A notification lands mid-batch: the guard drops the second call and
      // the tail runs the batch once more for it -- once, not for ever.
      state.listeners[0]!('hashblock');
      state.listeners[0]!('hashchainlock');
      await settle();
      expect(state.finds - before).toBeLessThanOrEqual(2);
    } finally {
      service.stop();
    }
  });
});
