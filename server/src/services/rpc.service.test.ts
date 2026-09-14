import http from 'node:http';
import https from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The log line an RPC refusal produces is evidence, and its level says whether
 * anyone should look. A refusal the caller expects and handles must not be
 * filed as an error, or the real ones have nothing to stand out against.
 */
const state = vi.hoisted(() => ({
  post: vi.fn(),
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  /** Every config handed to axios.create, in order. */
  created: [] as Array<Record<string, any>>,
}));

vi.mock('axios', () => ({
  default: {
    create: (cfg: Record<string, any>) => {
      state.created.push(cfg);
      return { post: state.post, interceptors: { response: { use: () => undefined } } };
    },
  },
}));
vi.mock('../config.js', () => ({
  config: {
    rpc: { host: '127.0.0.1', port: 1, user: 'u', pass: 'p', timeoutMs: 100 },
    peerRpc: { host: '127.0.0.1', port: 2, user: 'u2', pass: 'p2', timeoutMs: 4_000 },
  },
}));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('./metrics.service.js', () => ({ metricsService: { observeRpc: () => undefined } }));

import { config } from '../config.js';
import { MAX_CACHE_ENTRIES, RpcService } from './rpc.service.js';

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

  it('is an error, as before, when nothing was declared, and is never retried', async () => {
    state.post.mockRejectedValueOnce(refusal('quorum not found'));
    const rpc = new RpcService();
    await expect(rpc.call('quorum', ['info', 100, 'abcd'])).rejects.toThrow('quorum not found');
    expect(state.logs.error).toHaveBeenCalledTimes(1);
    expect(state.logs.info).not.toHaveBeenCalled();
    // The node answered; repeating the question cannot change the answer.
    expect(state.post).toHaveBeenCalledTimes(1);
  });
});

/**
 * A dropped connection is retried once, and only the retry's outcome is news.
 *
 * The first failure used to be logged as an error even when the retry then
 * succeeded, so the explorer's journal filled with "failed" lines for calls
 * that every caller saw succeed (measured on the VPS, 2026-09-14).
 */
describe('a transport failure', () => {
  const hangUp = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });

  it('that the retry recovers is a warning, not an error', async () => {
    state.post.mockRejectedValueOnce(hangUp()).mockResolvedValueOnce({ data: { result: 7, error: null } });
    const rpc = new RpcService();
    await expect(rpc.call('uptime')).resolves.toBe(7);
    expect(state.post).toHaveBeenCalledTimes(2);
    expect(state.logs.error).not.toHaveBeenCalled();
    expect(state.logs.warn).toHaveBeenCalledTimes(1);
    expect(String(state.logs.warn.mock.calls[0]?.[0])).toContain('socket hang up');
  });

  it('that the retry does not recover is one error, after the warning', async () => {
    state.post.mockRejectedValueOnce(hangUp()).mockRejectedValueOnce(hangUp());
    const rpc = new RpcService();
    await expect(rpc.call('uptime')).rejects.toThrow('socket hang up');
    expect(state.post).toHaveBeenCalledTimes(2);
    expect(state.logs.warn).toHaveBeenCalledTimes(1);
    expect(state.logs.error).toHaveBeenCalledTimes(1);
  });
});

/**
 * The response cache is bounded.
 *
 * A key carries the call's parameters, and the quorum collector asks
 * `quorum listextended <height>` once per block. When the TTL only decided
 * whether an entry could be served, every block's listing stayed in memory for
 * the life of the process (review, 2026-09-14: 200 heights read, 200 entries
 * kept, all of them expired).
 */
describe('the response cache', () => {
  let now = 1_000_000;
  const cacheOf = (rpc: RpcService) => (rpc as unknown as { cache: Map<string, unknown> }).cache;
  const inFlightOf = (rpc: RpcService) => (rpc as unknown as { inFlight: Map<string, unknown> }).inFlight;
  /** Let the store, catch and finally callbacks chained onto a call run. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  /** The node answers a listing with the height it was asked at. */
  const answerWithHeight = async (_url: string, body: { params: unknown[] }) => ({
    data: { result: { readAt: body.params[1] }, error: null },
  });

  beforeEach(() => {
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    state.post.mockImplementation(answerWithHeight);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps no expired listing, however many heights it has read', async () => {
    const rpc = new RpcService();
    for (let n = 0; n < 200; n++) {
      now += 151_000; // a block apart, ten times the 15 s TTL
      await expect(rpc.call('quorum', ['listextended', 14_000 + n], 'listextended')).resolves.toEqual({
        readAt: 14_000 + n,
      });
      await settle();
    }
    expect(state.post).toHaveBeenCalledTimes(200);
    // Only the last listing is left, and it is still inside its TTL.
    expect([...cacheOf(rpc).keys()]).toEqual(['quorum:listextended|["listextended",14199]']);
  });

  it('still serves a live entry without asking again, and asks once it has expired', async () => {
    const rpc = new RpcService();
    await rpc.call('quorum', ['listextended', 14_000], 'listextended');
    await settle();
    now += 14_999;
    await expect(rpc.call('quorum', ['listextended', 14_000], 'listextended')).resolves.toEqual({ readAt: 14_000 });
    expect(state.post).toHaveBeenCalledTimes(1);
    now += 1;
    await rpc.call('quorum', ['listextended', 14_000], 'listextended');
    expect(state.post).toHaveBeenCalledTimes(2);
  });

  it(`holds at most ${MAX_CACHE_ENTRIES} live entries, dropping the oldest stored first`, async () => {
    const rpc = new RpcService();
    const extra = 44;
    for (let n = 0; n < MAX_CACHE_ENTRIES + extra; n++) {
      now += 1; // every one of them still live
      await rpc.call('quorum', ['listextended', 20_000 + n], 'listextended');
      await settle();
    }
    expect(cacheOf(rpc).size).toBe(MAX_CACHE_ENTRIES);
    const asked = state.post.mock.calls.length;
    // The newest is served from the cache...
    await rpc.call('quorum', ['listextended', 20_000 + MAX_CACHE_ENTRIES + extra - 1], 'listextended');
    expect(state.post).toHaveBeenCalledTimes(asked);
    // ...the oldest kept one too, while the ones stored before it were dropped and are asked again.
    await rpc.call('quorum', ['listextended', 20_000 + extra], 'listextended');
    expect(state.post).toHaveBeenCalledTimes(asked);
    await rpc.call('quorum', ['listextended', 20_000 + extra - 1], 'listextended');
    expect(state.post).toHaveBeenCalledTimes(asked + 1);
  });

  it('keeps nothing from a refused call, and asks again on the next one', async () => {
    const rpc = new RpcService();
    state.post.mockRejectedValueOnce(refusal('Block height out of range'));
    await expect(rpc.call('quorum', ['listextended', 15_000], 'listextended')).rejects.toThrow('out of range');
    await settle();
    expect(cacheOf(rpc).size).toBe(0);
    expect(inFlightOf(rpc).size).toBe(0);
    await expect(rpc.call('quorum', ['listextended', 15_000], 'listextended')).resolves.toEqual({ readAt: 15_000 });
    expect(state.post).toHaveBeenCalledTimes(2);
  });
});

/**
 * Production never sets the pool's idle limit: neither `config.rpc` nor
 * `config.peerRpc` carries one, so both clients run on the default -- and the
 * default is the whole of the fix for the node closing a 30-second-idle socket
 * under a reused request. The keep-alive tests all pass an explicit limit, so
 * a default of 0, which turns the protection off in production, left every one
 * of them green (review P3, 2026-09-14). These build the two clients the way
 * production does and read what reaches the agents.
 */
describe('the pooled-connection idle limit an endpoint does not set', () => {
  it('is 15 seconds for the primary and the peer client, on the http and the https agent', () => {
    state.created.length = 0;
    new RpcService();
    new RpcService(config.peerRpc, 'peer:');
    expect(state.created).toHaveLength(2);
    for (const cfg of state.created) {
      expect(cfg.httpAgent).toBeInstanceOf(http.Agent);
      expect(cfg.httpsAgent).toBeInstanceOf(https.Agent);
      expect(cfg.httpAgent.options).toMatchObject({ keepAlive: true, maxSockets: 16, timeout: 15_000 });
      expect(cfg.httpsAgent.options).toMatchObject({ keepAlive: true, maxSockets: 16, timeout: 15_000 });
      cfg.httpAgent.destroy();
      cfg.httpsAgent.destroy();
    }
  });

  it('leaves the request timeout to the endpoint, apart from the idle limit', () => {
    state.created.length = 0;
    new RpcService();
    new RpcService(config.peerRpc, 'peer:');
    expect(state.created.map((cfg) => cfg.timeout)).toEqual([100, 4_000]);
    for (const cfg of state.created) {
      cfg.httpAgent.destroy();
      cfg.httpsAgent.destroy();
    }
  });
});
