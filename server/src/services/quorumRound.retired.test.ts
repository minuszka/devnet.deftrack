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
 *
 * The tick's two reads -- getblockcount, then listextended -- are separate RPCs
 * behind separate caches, and the node's tip can move between them. The listing
 * is therefore read at the height the tick judges, never at the node's later
 * tip; the last describe block below is the ordering that used to write a
 * permanent `failed` for the last real round.
 */
const END = 13200;
const LAST_ROUND = END - 24; // llmq_50_60's last cycle below the end

const state = vi.hoisted(() => ({
  profile: {} as Record<string, unknown>,
  /** Where the node's own tip is when listextended runs without a height. */
  nodeTip: 0,
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

/** The heights listextended was asked at this tick; `null` for a call without one. */
function listHeights(): (number | null)[] {
  return (state.call.mock.calls as [string, unknown[]][])
    .filter(([m, p]) => m === 'quorum' && p[0] === 'listextended')
    .map(([, p]) => (typeof p[1] === 'number' ? p[1] : null));
}

/**
 * What listextended lists at a block: from end - 1 the retired profile is
 * omitted; at end - 2 and below its last two rounds are there (both mined by
 * end - 6, the last window's close).
 */
function listingAt(height: number) {
  if (height > END - 2) return {};
  return {
    llmq_50_60: [
      { aa: { creationHeight: LAST_ROUND - 24, numValidMembers: 50, healthRatio: '1.00', minedBlockHash: 'b1' } },
      { bb: { creationHeight: LAST_ROUND, numValidMembers: 50, healthRatio: '1.00', minedBlockHash: 'b2' } },
    ],
  };
}

/** The node's answers: a height reads that block, no height reads the node's own tip. */
function node(method: string, params: unknown[]) {
  if (method === 'quorum' && params[0] === 'listextended') {
    return listingAt(typeof params[1] === 'number' ? params[1] : state.nodeTip);
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
  state.nodeTip = END + 30;
  state.getBlockCount.mockResolvedValue(END + 30);
  state.call.mockImplementation(async (method: string, params: unknown[]) => node(method, params));
});

describe('a retired profile after its end', () => {
  it('reads its last rounds where the node still listed it, and judges them formed', async () => {
    state.profile = { ...BASE_PROFILE, formationEndHeight: END };

    await new QuorumRoundService().collect();

    expect(listHeights()).toContain(END - 2);
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

    expect(listHeights()).toEqual([END + 30]);
    expect(written().get(LAST_ROUND)).toBe('failed');
    expect(state.deleteMany).not.toHaveBeenCalled();
  });
});

describe('the listing is read at the height the tick judges', () => {
  it('a block arriving between getblockcount and listextended does not fail the last round', async () => {
    // getblockcount answers end - 2 (no historical read yet); before listextended
    // runs the node mines end - 1, where it omits the profile. Read at the node's
    // tip, the last round came back absent and was written failed -- for good,
    // since a failed round is never refreshed.
    state.profile = { ...BASE_PROFILE, formationEndHeight: END };
    state.getBlockCount.mockResolvedValue(END - 2);
    state.nodeTip = END - 1;

    await new QuorumRoundService().collect();

    const rounds = written();
    expect(rounds.get(LAST_ROUND)).toBe('formed');
    expect([...rounds.values()]).not.toContain('failed');
    expect(listHeights()).toEqual([END - 2]);
  });

  it('a cached getblockcount behind the node is judged against the listing at that same height', async () => {
    // getblockcount is cached for 3 s, listextended for 15 s: the height a tick
    // judges can trail the node by several blocks, across the end.
    state.profile = { ...BASE_PROFILE, formationEndHeight: END };
    state.getBlockCount.mockResolvedValue(END - 3);
    state.nodeTip = END + 5;

    await new QuorumRoundService().collect();

    const rounds = written();
    expect(rounds.get(LAST_ROUND)).toBe('formed');
    expect([...rounds.values()]).not.toContain('failed');
    expect(listHeights()).toEqual([END - 3]);
  });
});
