import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The walker is now the only writer of chain transitions, so what it invents is
 * what the record says.
 *
 * Two ways it could invent one. Its penalty map advances per height inside the
 * walk while the cursor is persisted only after it, so a throw part-way leaves
 * the map AHEAD of the cursor -- and PoSe penalties decay by one per block, so
 * replaying those heights compares each real penalty against an already decayed
 * one and reads every penalised masternode as freshly punished. And the block
 * sync calls `reset` from its reorg rollback, which it can do mid-walk: that
 * walk then carried on against a cleared map, where every masternode looks like
 * a first sighting, and finished by writing its own cursor over the rewound one.
 */
const state = vi.hoisted(() => ({
  call: vi.fn(),
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  blocksHeight: 40,
  cursor: 10,
  cursorWrites: [] as number[],
  eventBulkWrite: vi.fn(),
}));

const query = (rows: unknown) => {
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'sort', 'limit']) q[method] = () => q;
  q.lean = async () => rows;
  return q;
};

vi.mock('../config.js', () => ({ config: { masternode: { intervalMs: 60_000 } } }));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('./rpc.service.js', () => ({ rpc: { call: state.call } }));
vi.mock('../models/MasternodeEvent.js', () => ({
  MasternodeEvent: { bulkWrite: state.eventBulkWrite },
}));
vi.mock('../models/MasternodeState.js', () => ({
  MasternodeState: { find: () => query([]) },
}));
vi.mock('../models/DevnetOperator.js', () => ({
  DevnetOperator: { find: () => query([]) },
}));
vi.mock('../models/SyncState.js', () => ({
  SyncState: {
    findOne: (filter: { key: string }) =>
      query(filter.key === 'blocks' ? { lastSyncedHeight: state.blocksHeight } : { lastSyncedHeight: state.cursor }),
    findOneAndUpdate: async () => ({ lastSyncedHeight: state.cursor }),
    updateOne: async (_filter: unknown, update: { $set?: { lastSyncedHeight?: number } }) => {
      const height = update.$set?.lastSyncedHeight;
      if (typeof height === 'number') state.cursorWrites.push(height);
      return {};
    },
  },
}));

import { MnListDiffService } from './mnListDiff.service.js';

/** A masternode carrying a penalty, as `listdiff` reports one. */
const withPenalty = (proTxHash: string, penalty: number) => ({
  [proTxHash]: { PoSePenalty: penalty, PoSeBanHeight: -1 },
});

beforeEach(() => {
  for (const fn of Object.values(state.logs)) fn.mockReset();
  state.call.mockReset();
  state.eventBulkWrite.mockReset();
  state.eventBulkWrite.mockResolvedValue({});
  state.blocksHeight = 40;
  state.cursor = 10;
  state.cursorWrites = [];
});

/** The transition types the walk wrote, across every bulk write. */
function writtenTypes(): string[] {
  return state.eventBulkWrite.mock.calls.flatMap(([ops]) =>
    (ops as { updateOne: { update: { $setOnInsert?: { type?: string } } } }[]).map(
      (op) => op.updateOne.update.$setOnInsert?.type ?? ''
    )
  );
}

describe('a walk that fails part-way', () => {
  it('drops its penalty map, so the replay invents no punishment', async () => {
    const proTxHash = 'a'.repeat(64);
    // Seed at the cursor, then a decaying penalty: 30 at height 11, 29 at 12.
    // A decay is not an increase; only a map left ahead of the cursor makes it
    // look like one.
    state.call.mockImplementation(async (_method: string, params: unknown[]) => {
      const [, from, to] = params as [string, number, number];
      if (from === 1) return { baseHeight: 1, blockHeight: to, addedMNs: [{ proTxHash, state: { PoSePenalty: 31, PoSeBanHeight: -1 } }], removedMNs: [], updatedMNs: [] };
      // Walks 11, 12, 13 -- the map reaches 28 -- and then the node stops
      // answering. The cursor is still 10, so the map is three blocks ahead.
      if (to === 14) throw new Error('node is busy');
      return {
        baseHeight: from,
        blockHeight: to,
        addedMNs: [],
        removedMNs: [],
        updatedMNs: [withPenalty(proTxHash, 31 - (to - 10))],
      };
    });

    const service = new MnListDiffService();
    await service.tick();
    expect(state.logs.error).toHaveBeenCalled();

    // The replay: every height answers again, nothing throws.
    state.eventBulkWrite.mockClear();
    state.call.mockImplementation(async (_method: string, params: unknown[]) => {
      const [, from, to] = params as [string, number, number];
      if (from === 1) return { baseHeight: 1, blockHeight: to, addedMNs: [{ proTxHash, state: { PoSePenalty: 31, PoSeBanHeight: -1 } }], removedMNs: [], updatedMNs: [] };
      return {
        baseHeight: from,
        blockHeight: to,
        addedMNs: [],
        removedMNs: [],
        updatedMNs: [withPenalty(proTxHash, Math.max(0, 31 - (to - 10)))],
      };
    });

    await service.tick();

    expect(writtenTypes()).not.toContain('penalty_up');
  });
});

describe('a walk overtaken by a reorg', () => {
  it('abandons its batch rather than writing over the rewound cursor', async () => {
    const proTxHash = 'b'.repeat(64);
    const service = new MnListDiffService();
    let seen = 0;
    state.call.mockImplementation(async (_method: string, params: unknown[]) => {
      const [, from, to] = params as [string, number, number];
      if (from === 1) return { baseHeight: 1, blockHeight: to, addedMNs: [{ proTxHash, state: { PoSePenalty: 0, PoSeBanHeight: -1 } }], removedMNs: [], updatedMNs: [] };
      // The rollback lands after the walk has started but before it finishes.
      if (++seen === 2) service.reset();
      return { baseHeight: from, blockHeight: to, addedMNs: [], removedMNs: [], updatedMNs: [] };
    });

    await service.tick();

    expect(state.cursorWrites).toEqual([]);
    expect(state.logs.warn).toHaveBeenCalledWith(expect.stringContaining('rewound underneath it'));
  });

  it('still records the cursor on an undisturbed walk', async () => {
    // The positive control: the guard must not simply stop the walker.
    const proTxHash = 'c'.repeat(64);
    state.call.mockImplementation(async (_method: string, params: unknown[]) => {
      const [, from, to] = params as [string, number, number];
      if (from === 1) return { baseHeight: 1, blockHeight: to, addedMNs: [{ proTxHash, state: { PoSePenalty: 0, PoSeBanHeight: -1 } }], removedMNs: [], updatedMNs: [] };
      return { baseHeight: from, blockHeight: to, addedMNs: [], removedMNs: [], updatedMNs: [] };
    });

    await new MnListDiffService().tick();

    expect(state.cursorWrites.length).toBeGreaterThan(0);
  });
});
