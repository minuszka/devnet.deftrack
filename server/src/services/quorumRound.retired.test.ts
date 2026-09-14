import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A retired profile (formationEndHeight) seen by the collector after its end.
 *
 * From the end the node no longer lists the profile as enabled, so `quorum
 * listextended` at the tip omits it -- including the last rounds below the end,
 * whose commitments are on the chain. Read only at the tip, a round of that last
 * cycle that was still pending (the collector was down across the end, say)
 * would look absent and be written as a failure that never happened. The
 * collector reads a retired profile at end - 2, plans nothing at or above the
 * end, and removes a pending placeholder written there before the end was known.
 */
const END = 13200;
const LAST_ROUND = END - 24; // llmq_50_60's last cycle below the end

const state = vi.hoisted(() => ({
  profile: {} as Record<string, unknown>,
  getBlockCount: vi.fn(),
  call: vi.fn(),
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  updateOne: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  bulkWrite: vi.fn(),
}));

vi.mock('../config.js', () => ({ config: { quorum: { intervalMs: 30_000 } } }));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('./rpc.service.js', () => ({
  rpc: { getBlockCount: state.getBlockCount, call: state.call },
}));
const query = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const method of ['sort', 'select', 'limit']) q[method] = () => q;
  q.lean = async () => rows;
  return q;
};
vi.mock('../models/QuorumRound.js', () => ({
  QuorumRound: {
    find: () => query([]),
    updateOne: state.updateOne,
    updateMany: state.updateMany,
    deleteMany: state.deleteMany,
    bulkWrite: state.bulkWrite,
  },
}));
vi.mock('../models/Block.js', () => ({
  Block: { findOne: () => ({ select: () => ({ lean: async () => null }) }) },
}));
vi.mock('../models/DevnetOperator.js', () => ({
  DevnetOperator: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));
vi.mock('../models/MasternodeSnapshot.js', () => ({
  MasternodeSnapshot: { find: () => query([]) },
}));
vi.mock('../config/llmq.js', () => ({
  trackedProfiles: () => [state.profile],
  maxPossibleBan: (size: number, minSize: number) => size - minSize,
}));

import { QuorumRoundService } from './quorumRound.service.js';

const BASE_PROFILE = {
  llmqType: 1,
  llmqName: 'llmq_50_60',
  size: 50,
  minSize: 3,
  threshold: 3,
  dkgInterval: 24,
  dkgPhaseBlocks: 2,
  dkgMiningWindowStart: 10,
  dkgMiningWindowEnd: 18,
  dkgBadVotesThreshold: 40,
  useRotation: false,
  signingActiveQuorumCount: 2,
};

/** Rounds written this tick, height -> status. */
function written(): Map<number, string> {
  const out = new Map<number, string>();
  for (const [filter, update] of state.updateOne.mock.calls as [Record<string, any>, Record<string, any>][]) {
    const status = update?.$set?.status;
    const height = filter?.expectedHeight ?? update?.$setOnInsert?.expectedHeight ?? update?.$set?.expectedHeight;
    if (typeof status === 'string' && typeof height === 'number') out.set(height, status);
  }
  return out;
}

/** The node's answers: the tip omits the retired profile; end - 2 still lists its last round. */
function node(method: string, params: unknown[]) {
  if (method === 'quorum' && params[0] === 'listextended') {
    if (params[1] === END - 2) {
      return {
        llmq_50_60: [
          { aa: { creationHeight: LAST_ROUND - 24, numValidMembers: 50, healthRatio: '1.00', minedBlockHash: 'b1' } },
          { bb: { creationHeight: LAST_ROUND, numValidMembers: 50, healthRatio: '1.00', minedBlockHash: 'b2' } },
        ],
      };
    }
    return {};
  }
  if (method === 'quorum') return { members: [] };
  return { enabled: 152, total: 152 };
}

beforeEach(() => {
  for (const fn of Object.values(state.logs)) fn.mockReset();
  for (const fn of [state.getBlockCount, state.call, state.updateOne, state.updateMany, state.deleteMany, state.bulkWrite]) {
    fn.mockReset();
  }
  state.updateOne.mockResolvedValue({});
  state.updateMany.mockResolvedValue({});
  state.deleteMany.mockResolvedValue({ deletedCount: 0 });
  state.bulkWrite.mockResolvedValue({});
  state.getBlockCount.mockResolvedValue(END + 30);
  state.call.mockImplementation(async (method: string, params: unknown[]) => node(method, params));
});

describe('a retired profile after its end', () => {
  it('reads its last rounds where the node still listed it, and judges them formed', async () => {
    state.profile = { ...BASE_PROFILE, formationEndHeight: END };

    await new QuorumRoundService().collect();

    const listCalls = (state.call.mock.calls as [string, unknown[]][]).filter(
      ([m, p]) => m === 'quorum' && p[0] === 'listextended'
    );
    expect(listCalls.some(([, p]) => p[1] === END - 2)).toBe(true);
    const rounds = written();
    expect(rounds.get(LAST_ROUND)).toBe('formed');
    expect([...rounds.values()]).not.toContain('failed');
  });

  it('plans nothing at or above the end, and clears a pending placeholder there', async () => {
    state.profile = { ...BASE_PROFILE, formationEndHeight: END };

    await new QuorumRoundService().collect();

    expect([...written().keys()].every((h) => h < END)).toBe(true);
    expect(state.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ llmqName: 'llmq_50_60', status: 'pending', expectedHeight: { $gte: END } })
    );
  });

  it('control: the same profile without an end is read at the tip, and its absence there is a failure', async () => {
    // What the collector did before: nothing listed at the tip, so every round in
    // the window, the last formed one included, is written as failed.
    state.profile = { ...BASE_PROFILE };

    await new QuorumRoundService().collect();

    const listCalls = (state.call.mock.calls as [string, unknown[]][]).filter(
      ([m, p]) => m === 'quorum' && p[0] === 'listextended'
    );
    expect(listCalls.every(([, p]) => p.length === 1)).toBe(true);
    expect(written().get(LAST_ROUND)).toBe('failed');
    expect(state.deleteMany).not.toHaveBeenCalled();
  });
});
