import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The census writes what it saw and nothing it did not: a masternode is
 * updated only when it authenticated as a peer, never created, and a pass
 * whose RPC failed writes nothing at all -- a failed read must not become a
 * row full of nulls that the summary then counts as "unknown" for a
 * masternode it knew yesterday.
 */
const state = vi.hoisted(() => ({
  call: vi.fn(),
  bulkWrite: vi.fn(),
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../config.js', () => ({
  config: { nodeVersion: { intervalMs: 60_000, staleAfterMs: 24 * 60 * 60_000 } },
}));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('./rpc.service.js', () => ({ rpc: { call: state.call } }));
vi.mock('../models/MasternodeState.js', () => ({
  MasternodeState: { bulkWrite: state.bulkWrite },
}));

import { NodeVersionService } from './nodeVersion.service.js';

const SUBVER = '/DeFCoN:22.1.5(devnet.devnet-defcon-q60)/';

beforeEach(() => {
  for (const fn of Object.values(state.logs)) fn.mockReset();
  state.call.mockReset();
  state.bulkWrite.mockReset();
  state.bulkWrite.mockResolvedValue({ matchedCount: 2 });
});

describe('the node version census', () => {
  it('updates exactly the masternodes that authenticated, by ProTx, and never upserts', async () => {
    state.call.mockResolvedValue([
      { addr: 'x', subver: SUBVER, version: 70241, verified_proregtx_hash: 'aa' },
      { addr: 'y', subver: SUBVER, version: 70241 },
      { addr: 'z', subver: SUBVER, version: 70241, verified_proregtx_hash: 'bb' },
    ]);
    await new NodeVersionService().tick();

    expect(state.call).toHaveBeenCalledWith('getpeerinfo');
    expect(state.bulkWrite).toHaveBeenCalledTimes(1);
    const [ops, options] = state.bulkWrite.mock.calls[0] as [Array<Record<string, any>>, Record<string, unknown>];
    expect(ops.map((o) => o.updateOne.filter)).toEqual([{ proTxHash: 'aa' }, { proTxHash: 'bb' }]);
    for (const o of ops) {
      expect(o.updateOne.upsert).toBeUndefined();
      expect(o.updateOne.update.$set.nodeSubversion).toBe(SUBVER);
      expect(o.updateOne.update.$set.nodeProtocol).toBe(70241);
      expect(o.updateOne.update.$set.versionSeenAt).toBeInstanceOf(Date);
    }
    expect(options).toEqual({ ordered: false });
    expect(state.logs.error).not.toHaveBeenCalled();
  });

  it('writes nothing when the RPC fails, and says so', async () => {
    state.call.mockRejectedValue(new Error('connection refused'));
    await new NodeVersionService().tick();
    expect(state.bulkWrite).not.toHaveBeenCalled();
    expect(state.logs.error).toHaveBeenCalledTimes(1);
    expect(String(state.logs.error.mock.calls[0]?.[0])).toContain('connection refused');
  });

  it('writes nothing when no peer authenticated as a masternode', async () => {
    state.call.mockResolvedValue([{ addr: 'x', subver: SUBVER, version: 70241 }]);
    await new NodeVersionService().tick();
    expect(state.bulkWrite).not.toHaveBeenCalled();
    expect(state.logs.warn).toHaveBeenCalledTimes(1);
    expect(state.logs.error).not.toHaveBeenCalled();
  });
});
