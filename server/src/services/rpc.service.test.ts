import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The log line an RPC refusal produces is evidence, and its level says whether
 * anyone should look. A refusal the caller expects and handles must not be
 * filed as an error, or the real ones have nothing to stand out against.
 */
const state = vi.hoisted(() => ({
  post: vi.fn(),
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('axios', () => ({
  default: {
    create: () => ({ post: state.post, interceptors: { response: { use: () => undefined } } }),
  },
}));
vi.mock('../config.js', () => ({
  config: { rpc: { host: '127.0.0.1', port: 1, user: 'u', pass: 'p', timeoutMs: 100 } },
}));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('./metrics.service.js', () => ({ metricsService: { observeRpc: () => undefined } }));

import { RpcService } from './rpc.service.js';

/** How the node refuses: a non-2xx status with the RPC error in the body. */
function refusal(message: string) {
  return Object.assign(new Error('Request failed with status code 500'), {
    response: { status: 500, data: { error: { code: -8, message } } },
  });
}

beforeEach(() => {
  state.post.mockReset();
  for (const fn of Object.values(state.logs)) fn.mockReset();
});

describe('a refusal the caller declared it expects', () => {
  it('still fails the call, and is logged as information rather than an error', async () => {
    state.post.mockRejectedValueOnce(refusal('quorum not found'));
    const rpc = new RpcService();
    await expect(
      rpc.call('quorum', ['info', 100, 'abcd'], undefined, { tolerated: /quorum not found/i })
    ).rejects.toThrow('RPC quorum: quorum not found');
    expect(state.logs.error).not.toHaveBeenCalled();
    expect(state.logs.info).toHaveBeenCalledTimes(1);
    expect(String(state.logs.info.mock.calls[0]?.[0])).toContain('quorum not found');
  });

  it('does not extend to refusals the caller did not name', async () => {
    // Tolerance is for one named condition, not for the method: a caller that
    // catches "quorum not found" is not thereby handling a malformed argument.
    state.post.mockRejectedValueOnce(refusal('quorumHash must be hex'));
    const rpc = new RpcService();
    await expect(
      rpc.call('quorum', ['info', 100, 'zz'], undefined, { tolerated: /quorum not found/i })
    ).rejects.toThrow('quorumHash must be hex');
    expect(state.logs.error).toHaveBeenCalledTimes(1);
    expect(state.logs.info).not.toHaveBeenCalled();
  });

  it('is an error, as before, when nothing was declared', async () => {
    state.post.mockRejectedValueOnce(refusal('quorum not found'));
    const rpc = new RpcService();
    await expect(rpc.call('quorum', ['info', 100, 'abcd'])).rejects.toThrow('quorum not found');
    expect(state.logs.error).toHaveBeenCalledTimes(1);
    expect(state.logs.info).not.toHaveBeenCalled();
  });
});
