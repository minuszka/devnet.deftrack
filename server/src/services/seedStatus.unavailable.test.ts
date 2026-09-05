import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The seed's self-report is a current-view row: every pass overwrites it. So a
 * call that failed must leave its fields out rather than write the empty
 * answer, or a busy node is recorded as a seed with no peers, no verified
 * masternodes and no payout scripts -- and the experiment measurement then
 * reads the seed's own blocks as unattributed for as long as that row stands.
 */
const state = vi.hoisted(() => ({
  call: vi.fn(),
  getBlockCount: vi.fn(),
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  hostUpdateOne: vi.fn(),
  observationBulkWrite: vi.fn(),
}));

vi.mock('../config.js', () => ({
  config: { stake: { minValue: 10_000, maxValue: 12_500_000 } },
}));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('./rpc.service.js', () => ({
  rpc: { call: state.call, getBlockCount: state.getBlockCount },
}));
vi.mock('../models/HostStatus.js', () => ({
  HostStatus: { updateOne: state.hostUpdateOne },
}));
vi.mock('../models/StakeScriptObservation.js', () => ({
  StakeScriptObservation: { bulkWrite: state.observationBulkWrite },
}));
vi.mock('./localClock.service.js', () => ({
  localClockService: { current: async () => 0 },
}));

import { SeedStatusService } from './seedStatus.service.js';

/** The fields the pass actually wrote. */
function written(): Record<string, unknown> {
  const [, update] = (state.hostUpdateOne.mock.calls[0] ?? []) as [unknown, Record<string, any>];
  return update?.$set ?? {};
}

/** A pay-to-pubkey output inside the stakeable range, so it needs no lookup. */
const stakeable = {
  amount: 11_000_000,
  scriptPubKey: `21${'a'.repeat(66)}ac`,
  address: 'Pxxx',
};

beforeEach(() => {
  for (const fn of Object.values(state.logs)) fn.mockReset();
  for (const fn of [
    state.call,
    state.getBlockCount,
    state.hostUpdateOne,
    state.observationBulkWrite,
  ]) {
    fn.mockReset();
  }
  state.getBlockCount.mockResolvedValue(8030);
  state.hostUpdateOne.mockResolvedValue({});
  state.observationBulkWrite.mockResolvedValue({});
});

describe('a seed report where a call failed', () => {
  it('leaves the peer fields out rather than writing zero', async () => {
    state.call.mockImplementation(async (method: string) => {
      if (method === 'getpeerinfo') throw new Error('Work queue depth exceeded');
      return [stakeable];
    });

    await new SeedStatusService().tick();

    const set = written();
    expect(set).not.toHaveProperty('peers');
    expect(set).not.toHaveProperty('verifiedMasternodes');
    expect(set).not.toHaveProperty('inbound');
    // What was read is still written.
    expect(set.stakeScripts).toEqual([stakeable.scriptPubKey]);
  });

  it('leaves the payout scripts out when listunspent failed', async () => {
    state.call.mockImplementation(async (method: string) => {
      if (method === 'listunspent') throw new Error('socket hang up');
      return [{ inbound: true, verified_proregtx_hash: 'x', pingtime: 0.01 }];
    });

    await new SeedStatusService().tick();

    const set = written();
    expect(set).not.toHaveProperty('stakeScripts');
    expect(set.peers).toBe(1);
  });

  it('leaves the height out when the node could not give one', async () => {
    state.getBlockCount.mockRejectedValue(new Error('timeout'));
    state.call.mockResolvedValue([]);

    await new SeedStatusService().tick();

    expect(written()).not.toHaveProperty('height');
  });
});

describe('a seed report where every call answered', () => {
  it('writes a genuine zero when the seed really has no peers', async () => {
    // The positive control, and the distinction the whole change rests on: an
    // empty answer is still an answer and must be recorded as one.
    state.call.mockImplementation(async (method: string) =>
      method === 'getpeerinfo' ? [] : [stakeable]
    );

    await new SeedStatusService().tick();

    const set = written();
    expect(set.peers).toBe(0);
    expect(set.verifiedMasternodes).toBe(0);
    expect(set.stakeScripts).toEqual([stakeable.scriptPubKey]);
  });
});
