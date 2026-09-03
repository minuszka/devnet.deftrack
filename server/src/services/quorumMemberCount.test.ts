import { describe, expect, it, vi } from 'vitest';
import { QuorumMemberCountResolver } from './quorumMemberCount.js';

/**
 * The member count is the number Core punishes over, so a wrong answer here is
 * a wrong punishment count on every commitment row. The cases below are the
 * two ways the old resolver got it wrong -- asking too early at the tip, and
 * remembering that failure for ever -- plus the lines it must not cross.
 */
const notFound = () => new Error('RPC quorum: quorum not found');

function resolver(answers: Array<unknown | Error>) {
  const call = vi.fn(async (..._args: unknown[]) => {
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async () => undefined);
  const r = new QuorumMemberCountResolver({ call } as never, { attempts: 3, delayMs: 300 }, sleep);
  return { call, sleep, r };
}

describe('quorum member count', () => {
  it('caches a resolved count, and only a resolved count', async () => {
    const { call, r } = resolver([{ members: [1, 2, 3] }]);
    expect(await r.resolve(100, 'aa', { retryBriefly: false })).toBe(3);
    expect(await r.resolve(100, 'aa', { retryBriefly: false })).toBe(3);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('asks again next time after a failure, instead of remembering the failure', async () => {
    const { call, r } = resolver([notFound(), { members: [1, 2] }]);
    expect(await r.resolve(100, 'aa', { retryBriefly: false })).toBeNull();
    expect(await r.resolve(100, 'aa', { retryBriefly: false })).toBe(2);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('at the tip, waits out the node building the quorum', async () => {
    const { call, sleep, r } = resolver([notFound(), notFound(), { members: [1, 2, 3] }]);
    expect(await r.resolve(100, 'aa', { retryBriefly: true })).toBe(3);
    expect(call).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(300);
  });

  it('gives up after the last brief attempt, without caching the failure', async () => {
    const { call, r } = resolver([notFound(), notFound(), notFound(), { members: [1] }]);
    expect(await r.resolve(100, 'aa', { retryBriefly: true })).toBeNull();
    expect(call).toHaveBeenCalledTimes(3);
    expect(await r.resolve(100, 'aa', { retryBriefly: false })).toBe(1);
  });

  it('does not wait for a historical block, where the refusal is final', async () => {
    const { call, sleep, r } = resolver([notFound(), { members: [1] }]);
    expect(await r.resolve(100, 'aa', { retryBriefly: false })).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries only the refusal it expects, and declares that one to the RPC layer', async () => {
    const { call, sleep, r } = resolver([new Error('RPC quorum: connection failed'), { members: [1] }]);
    expect(await r.resolve(100, 'aa', { retryBriefly: true })).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    const options = call.mock.calls[0]?.[3] as { tolerated?: RegExp } | undefined;
    expect(options?.tolerated?.test('quorum not found')).toBe(true);
  });
});
