import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `protx list registered` answering with an empty array is not the same event
 * as every collateral on the network being spent at once. A node reindexing at
 * a low height, or one still in warmup, can answer that way -- and acting on it
 * writes a `removed` event for all 152 masternodes. The next poll re-registers
 * them silently, so the state recovers and the fabricated events stay in the
 * record for ever.
 */
const state = vi.hoisted(() => ({
  getBlockCount: vi.fn(),
  call: vi.fn(),
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  previous: [] as Record<string, unknown>[],
  stateBulkWrite: vi.fn(),
  eventBulkWrite: vi.fn(),
  snapshotCreate: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: { masternode: { intervalMs: 60_000 } },
}));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('./rpc.service.js', () => ({
  rpc: { getBlockCount: state.getBlockCount, call: state.call },
}));
vi.mock('../config/llmq.js', () => ({
  chainlockProfileAtHeight: () => ({ size: 60, minSize: 44, llmqName: 'llmq_defcon' }),
  maxPossibleBan: () => 16,
}));
vi.mock('../models/MasternodeState.js', () => ({
  MasternodeState: {
    find: () => ({ select: () => ({ lean: async () => state.previous }) }),
    bulkWrite: state.stateBulkWrite,
  },
}));
vi.mock('../models/MasternodeEvent.js', () => ({
  MasternodeEvent: { bulkWrite: state.eventBulkWrite },
}));
vi.mock('../models/MasternodeSnapshot.js', () => ({
  MasternodeSnapshot: { create: state.snapshotCreate },
}));
vi.mock('../models/DevnetOperator.js', () => ({
  DevnetOperator: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));

import { MasternodePollerService } from './masternodePoller.service.js';

function masternode(proTxHash: string) {
  return {
    proTxHash,
    collateralHash: 'c'.repeat(64),
    collateralIndex: 0,
    state: {
      service: '203.0.113.7:19799',
      PoSePenalty: 0,
      PoSeBanHeight: -1,
      registeredHeight: 100,
    },
  };
}

beforeEach(() => {
  for (const fn of Object.values(state.logs)) fn.mockReset();
  for (const fn of [
    state.getBlockCount,
    state.call,
    state.stateBulkWrite,
    state.eventBulkWrite,
    state.snapshotCreate,
  ]) {
    fn.mockReset();
  }
  state.getBlockCount.mockResolvedValue(8030);
  state.stateBulkWrite.mockResolvedValue({});
  state.eventBulkWrite.mockResolvedValue({});
  state.snapshotCreate.mockResolvedValue({});
  state.previous = [
    { proTxHash: 'a'.repeat(64), active: true, banned: false, poSePenalty: 0 },
    { proTxHash: 'b'.repeat(64), active: true, banned: false, poSePenalty: 0 },
  ];
});

describe('an empty protx list', () => {
  it('writes nothing while the index still holds masternodes', async () => {
    state.call.mockResolvedValue([]);

    await new MasternodePollerService().collect();

    expect(state.stateBulkWrite).not.toHaveBeenCalled();
    expect(state.eventBulkWrite).not.toHaveBeenCalled();
    expect(state.snapshotCreate).not.toHaveBeenCalled();
    expect(state.logs.warn).toHaveBeenCalledWith(expect.stringContaining('network-wide removal'));
  });

  it('is accepted on a network that genuinely has none indexed yet', async () => {
    // A first run against a chain with no masternodes must not be blocked by
    // the guard; there is no prior observation to contradict.
    state.previous = [];
    state.call.mockResolvedValue([]);

    await new MasternodePollerService().collect();

    expect(state.snapshotCreate).toHaveBeenCalled();
  });
});

describe('a list the node could answer', () => {
  it('still records a masternode that really left', async () => {
    // The positive control: the removal sweep is disabled by the guard only
    // when the answer itself is unusable, never when it is merely bad news.
    state.call.mockResolvedValue([masternode('a'.repeat(64))]);

    await new MasternodePollerService().collect();

    expect(state.eventBulkWrite).toHaveBeenCalled();
    const [ops] = state.eventBulkWrite.mock.calls[0] as [{ updateOne: { update: any } }[]];
    const kinds = ops.map((op) => op.updateOne.update.$setOnInsert?.type).filter(Boolean);
    expect(kinds).toContain('removed');
  });
});
