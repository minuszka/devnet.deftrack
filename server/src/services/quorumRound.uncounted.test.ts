import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `failed` and `impossible` are told apart by one number: how many masternodes
 * the quorum could have been drawn from. When `masternode count` does not
 * answer, `classifyRound` cannot reach the `impossible` branch and falls
 * through to `failed` -- and `shouldRefreshRound` never revisits a `failed`
 * round, so one RPC hiccup writes a permanent, fabricated failure.
 *
 * This is the same rule as "a failed call must never contribute a zero to a
 * sum", applied to a verdict instead of an arithmetic result.
 */
const state = vi.hoisted(() => ({
  profile: {
    llmqType: 7,
    llmqName: 'llmq_defcon',
    size: 60,
    minSize: 44,
    threshold: 41,
    dkgInterval: 24,
    dkgPhaseBlocks: 2,
    dkgMiningWindowStart: 10,
    dkgMiningWindowEnd: 18,
    dkgBadVotesThreshold: 48,
    useRotation: false,
    signingActiveQuorumCount: 4,
    formationGateHeight: 0,
  },
  getBlockCount: vi.fn(),
  call: vi.fn(),
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  updateOne: vi.fn(),
  updateMany: vi.fn(),
  bulkWrite: vi.fn(),
}));

vi.mock('../config.js', () => ({ config: { quorum: { intervalMs: 30_000 } } }));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('./rpc.service.js', () => ({
  rpc: { getBlockCount: state.getBlockCount, call: state.call },
}));
/** A chainable stand-in for a Mongoose query, in whatever order it is built. */
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
    bulkWrite: state.bulkWrite,
  },
}));
vi.mock('../models/Block.js', () => ({
  Block: { findOne: () => ({ select: () => ({ lean: async () => null }) }) },
}));
vi.mock('../models/DevnetOperator.js', () => ({
  DevnetOperator: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
}));

vi.mock('../config/llmq.js', () => ({
  trackedProfiles: () => [state.profile],
  maxPossibleBan: (size: number, minSize: number) => size - minSize,
}));

import { QuorumRoundService } from './quorumRound.service.js';

/** The statuses the collector wrote this tick. */
function writtenStatuses(): string[] {
  return (state.updateOne.mock.calls as [unknown, Record<string, any>][])
    .map(([, update]) => update?.$set?.status)
    .filter((s): s is string => typeof s === 'string');
}

beforeEach(() => {
  for (const fn of Object.values(state.logs)) fn.mockReset();
  for (const fn of [
    state.getBlockCount,
    state.call,
    state.updateOne,
    state.updateMany,
    state.bulkWrite,
  ]) {
    fn.mockReset();
  }
  state.updateOne.mockResolvedValue({});
  state.updateMany.mockResolvedValue({});
  state.bulkWrite.mockResolvedValue({});
  // A tip well past the mining window of every scheduled height below it, and
  // one observed commitment far enough back that absence above it is evidence.
  state.getBlockCount.mockResolvedValue(8040);
});

/** listextended with a single old commitment, so `oldestObserved` is low. */
function listExtended() {
  return {
    llmq_defcon: [
      {
        '00ff': {
          creationHeight: 7800,
          numValidMembers: 60,
          healthRatio: 1,
          minedBlockHash: 'deadbeef',
          quorumIndex: 0,
        },
      },
    ],
  };
}

describe('a masternode count the node did not answer', () => {
  it('writes no failed verdict for the rounds it cannot judge', async () => {
    state.call.mockImplementation(async (method: string, params: unknown[]) => {
      if (method === 'quorum') return listExtended();
      throw new Error('Work queue depth exceeded');
    });

    await new QuorumRoundService().collect();

    expect(writtenStatuses()).not.toContain('failed');
    expect(state.logs.warn).toHaveBeenCalledWith(expect.stringContaining('did not answer'));
  });
});

describe('a masternode count the node answered', () => {
  it('records the failure when the network was large enough to form', async () => {
    // The positive control. With a real count the same rounds are judged, so
    // the guard above suppresses only what it cannot support.
    state.call.mockImplementation(async (method: string) => {
      if (method === 'quorum') return listExtended();
      return { enabled: 152, total: 152 };
    });

    await new QuorumRoundService().collect();

    expect(writtenStatuses()).toContain('failed');
  });

  it('records impossible rather than failed when the network was too small', async () => {
    // The branch the missing count hides: below minSize the round could not
    // have formed, and calling that a failure is the fabrication.
    state.call.mockImplementation(async (method: string) => {
      if (method === 'quorum') return listExtended();
      return { enabled: 10, total: 10 };
    });

    await new QuorumRoundService().collect();

    const statuses = writtenStatuses();
    expect(statuses).toContain('impossible');
    expect(statuses).not.toContain('failed');
  });
});
