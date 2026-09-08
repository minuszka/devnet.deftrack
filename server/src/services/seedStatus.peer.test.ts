import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The second staking daemon on the seed machine.
 *
 * Its wallet is not the seed's, so until it was read its payout script
 * belonged to no host and its blocks counted as unattributed -- and `byHost`
 * withholds its concentration index entirely while any producer is unmapped.
 * These cases pin the three things that gap taught: the peer's scripts join
 * the seed's own rather than forming a host of their own, a peer that cannot
 * be read leaves the previous list standing instead of publishing a short one,
 * and a deployment without a peer behaves exactly as it did before.
 */
const state = vi.hoisted(() => ({
  call: vi.fn(),
  getBlockCount: vi.fn(),
  peerCall: vi.fn(),
  peerCtorArgs: vi.fn(),
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  hostUpdateOne: vi.fn(),
  observationBulkWrite: vi.fn(),
  peerRpc: undefined as Record<string, unknown> | undefined,
}));

vi.mock('../config.js', () => ({
  config: {
    stake: { minValue: 10_000, maxValue: 12_500_000 },
    // A getter, so a case can turn the peer on and off between ticks.
    get peerRpc() {
      return state.peerRpc;
    },
  },
}));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('./rpc.service.js', () => ({
  rpc: { call: state.call, getBlockCount: state.getBlockCount },
  RpcService: class {
    call = state.peerCall;
    constructor(...args: unknown[]) {
      state.peerCtorArgs(...args);
    }
  },
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

function written(): Record<string, unknown> {
  const [, update] = (state.hostUpdateOne.mock.calls[0] ?? []) as [unknown, Record<string, any>];
  return update?.$set ?? {};
}

/** Every host the append-only sightings were written under, and their scripts. */
function sightings(): Array<{ host: string; script: string }> {
  const [ops] = (state.observationBulkWrite.mock.calls[0] ?? []) as [Array<any>];
  return (ops ?? []).map((op) => ({
    host: op.updateOne.update.$setOnInsert.host,
    script: op.updateOne.update.$setOnInsert.script,
  }));
}

const SEED_SCRIPT = `21${'a'.repeat(66)}ac`;
const PEER_SCRIPT = `21${'b'.repeat(66)}ac`;
const seedOutput = { amount: 11_000_000, scriptPubKey: SEED_SCRIPT, address: 'Pseed' };
const peerOutput = { amount: 10_000_000, scriptPubKey: PEER_SCRIPT, address: 'Ppeer' };

const PEER_CONFIG = { host: '127.0.0.1', port: 19_800, user: 'u', pass: 'p', timeoutMs: 1000 };

beforeEach(() => {
  for (const fn of Object.values(state.logs)) fn.mockReset();
  for (const fn of [
    state.call,
    state.getBlockCount,
    state.peerCall,
    state.peerCtorArgs,
    state.hostUpdateOne,
    state.observationBulkWrite,
  ]) {
    fn.mockReset();
  }
  state.peerRpc = undefined;
  state.getBlockCount.mockResolvedValue(9985);
  state.hostUpdateOne.mockResolvedValue({});
  state.observationBulkWrite.mockResolvedValue({});
  state.call.mockImplementation(async (method: string) =>
    method === 'getpeerinfo' ? [] : [seedOutput]
  );
});

describe('a second staking daemon on the same machine', () => {
  it('folds its payout scripts into the seed host rather than a host of its own', async () => {
    state.peerRpc = PEER_CONFIG;
    state.peerCall.mockResolvedValue([peerOutput]);

    await new SeedStatusService().tick();

    // One machine, one row: the peer never becomes a ninth host.
    expect(state.hostUpdateOne).toHaveBeenCalledTimes(1);
    expect(state.hostUpdateOne.mock.calls[0]![0]).toEqual({ host: 'seed' });
    expect(written().stakeScripts).toEqual([SEED_SCRIPT, PEER_SCRIPT].sort());

    // And the sightings the attribution actually reads carry both, under seed.
    expect(sightings().map((s) => s.host)).toEqual(['seed', 'seed']);
    expect(sightings().map((s) => s.script).sort()).toEqual([SEED_SCRIPT, PEER_SCRIPT].sort());
  });

  it('is read through its own endpoint, with its own metric names', async () => {
    state.peerRpc = PEER_CONFIG;
    state.peerCall.mockResolvedValue([]);

    await new SeedStatusService().tick();

    expect(state.peerCtorArgs).toHaveBeenCalledWith(PEER_CONFIG, 'peer:');
    expect(state.peerCall).toHaveBeenCalledWith('listunspent', [0, 9_999_999]);
  });

  it('leaves the payout scripts alone when the peer does not answer', async () => {
    // The distinction the seed's own fields already make: a peer that failed is
    // not a peer with no keys. Publishing the seed's list alone would be a
    // payout list short by a producer, and the measurement would read that
    // producer's blocks as unattributed for as long as the row stood.
    state.peerRpc = PEER_CONFIG;
    state.peerCall.mockRejectedValue(new Error('socket hang up'));

    await new SeedStatusService().tick();

    const set = written();
    expect(set).not.toHaveProperty('stakeScripts');
    // Everything that was read is still written, and the failure is stated.
    expect(set.height).toBe(9985);
    expect(set.peers).toBe(0);
    expect(state.logs.warn).toHaveBeenCalledWith(expect.stringContaining('peer daemon did not answer'));
  });

  it('still records what it did see when the peer is down', async () => {
    // The append-only half is not gated on completeness: a sighting says a host
    // really held that script at that height, and a missing one is a gap rather
    // than a wrong answer.
    state.peerRpc = PEER_CONFIG;
    state.peerCall.mockRejectedValue(new Error('socket hang up'));

    await new SeedStatusService().tick();

    expect(sightings()).toEqual([{ host: 'seed', script: SEED_SCRIPT }]);
  });
});

describe('a deployment with no second daemon', () => {
  it('never builds a peer client and reports exactly what it did before', async () => {
    // The negative control. If this passed with the peer configured too, the
    // cases above would prove nothing about where the extra script came from.
    state.peerRpc = undefined;

    await new SeedStatusService().tick();

    expect(state.peerCtorArgs).not.toHaveBeenCalled();
    expect(state.peerCall).not.toHaveBeenCalled();
    expect(written().stakeScripts).toEqual([SEED_SCRIPT]);
  });

  it('stays off when a port is named but credentials are not', async () => {
    state.peerRpc = { host: '127.0.0.1', port: 19_800, user: '', pass: '', timeoutMs: 1000 };

    await new SeedStatusService().tick();

    expect(state.peerCtorArgs).not.toHaveBeenCalled();
    expect(written().stakeScripts).toEqual([SEED_SCRIPT]);
  });
});
