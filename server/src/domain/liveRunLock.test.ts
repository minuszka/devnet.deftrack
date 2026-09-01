import { describe, expect, it } from 'vitest';
import {
  LiveRunLockError,
  acquireLiveRunLock,
  releaseLiveRunLock,
  renewLiveRunLock,
} from './liveRunLock.js';

describe('single live simulation lock', () => {
  it('acquires an empty lock with the first revision', () => {
    const result = acquireLiveRunLock(null, {
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 100,
      leaseUntilMs: 200,
    });

    expect(result).toMatchObject({ acquired: true, disposition: 'acquired' });
    expect(result.lock).toEqual({
      scope: 'devnet-live',
      status: 'held',
      runKey: 'sim-a',
      ownerId: 'worker-1',
      acquiredAtMs: 100,
      leaseUntilMs: 200,
      revision: 0,
    });
  });

  it('makes a duplicate start idempotent without extending its lease', () => {
    const first = acquireLiveRunLock(null, {
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 100,
      leaseUntilMs: 200,
    });
    if (!first.acquired) throw new Error('test setup failed');

    const duplicate = acquireLiveRunLock(first.lock, {
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 120,
      leaseUntilMs: 999,
    });
    expect(duplicate).toEqual({
      acquired: true,
      disposition: 'already-held',
      lock: first.lock,
    });
  });

  it('refuses a second live experiment while the first lease is active', () => {
    const first = acquireLiveRunLock(null, {
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 100,
      leaseUntilMs: 200,
    });
    if (!first.acquired) throw new Error('test setup failed');

    const second = acquireLiveRunLock(first.lock, {
      runKey: 'sim-b',
      ownerId: 'worker-2',
      nowMs: 150,
      leaseUntilMs: 250,
    });
    expect(second).toMatchObject({ acquired: false, disposition: 'held-by-other' });
    expect(second.lock).toBe(first.lock);
  });

  it('allows takeover only after the persisted lease expires', () => {
    const first = acquireLiveRunLock(null, {
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 100,
      leaseUntilMs: 200,
    });
    if (!first.acquired) throw new Error('test setup failed');

    const takeover = acquireLiveRunLock(first.lock, {
      runKey: 'sim-b',
      ownerId: 'worker-2',
      nowMs: 200,
      leaseUntilMs: 300,
    });
    expect(takeover).toMatchObject({
      acquired: true,
      disposition: 'acquired',
      lock: { runKey: 'sim-b', ownerId: 'worker-2', revision: 1 },
    });
  });

  it('renews only an unexpired lock held by the same owner', () => {
    const first = acquireLiveRunLock(null, {
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 100,
      leaseUntilMs: 200,
    });
    if (!first.acquired) throw new Error('test setup failed');

    expect(
      renewLiveRunLock(first.lock, {
        runKey: 'sim-a',
        ownerId: 'worker-1',
        nowMs: 150,
        leaseUntilMs: 300,
      })
    ).toMatchObject({ leaseUntilMs: 300, revision: 1 });

    expect(() =>
      renewLiveRunLock(first.lock, {
        runKey: 'sim-a',
        ownerId: 'worker-2',
        nowMs: 150,
        leaseUntilMs: 300,
      })
    ).toThrowError(LiveRunLockError);
    expect(() =>
      renewLiveRunLock(first.lock, {
        runKey: 'sim-a',
        ownerId: 'worker-1',
        nowMs: 200,
        leaseUntilMs: 300,
      })
    ).toThrowError(LiveRunLockError);
    expect(() =>
      renewLiveRunLock(first.lock, {
        runKey: 'sim-a',
        ownerId: 'worker-1',
        nowMs: 150,
        leaseUntilMs: 190,
      })
    ).toThrowError(expect.objectContaining<Partial<LiveRunLockError>>({ code: 'INVALID_LEASE' }));
  });

  it('releases to a revisioned tombstone and never releases another owner\'s lock', () => {
    const first = acquireLiveRunLock(null, {
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 100,
      leaseUntilMs: 200,
    });
    if (!first.acquired) throw new Error('test setup failed');

    const released = releaseLiveRunLock(first.lock, {
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 150,
    });
    expect(released).toEqual({
      scope: 'devnet-live',
      status: 'released',
      runKey: null,
      ownerId: null,
      acquiredAtMs: null,
      leaseUntilMs: null,
      releasedAtMs: 150,
      revision: 1,
    });
    expect(
      releaseLiveRunLock(released, { runKey: 'sim-a', ownerId: 'worker-1', nowMs: 160 })
    ).toBe(released);
    expect(
      releaseLiveRunLock(null, { runKey: 'sim-a', ownerId: 'worker-1', nowMs: 160 })
    ).toBeNull();
    expect(() =>
      releaseLiveRunLock(first.lock, { runKey: 'sim-a', ownerId: 'worker-2', nowMs: 150 })
    ).toThrowError(LiveRunLockError);
  });

  it('keeps revisions monotonic across release and reacquire to prevent ABA updates', () => {
    const first = acquireLiveRunLock(null, {
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 100,
      leaseUntilMs: 200,
    });
    if (!first.acquired) throw new Error('test setup failed');
    const released = releaseLiveRunLock(first.lock, {
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 150,
    });
    if (released === null) throw new Error('test setup failed');

    const second = acquireLiveRunLock(released, {
      runKey: 'sim-b',
      ownerId: 'worker-2',
      nowMs: 160,
      leaseUntilMs: 260,
    });
    expect(second).toMatchObject({
      acquired: true,
      lock: { status: 'held', runKey: 'sim-b', revision: 2 },
    });
  });

  it('rejects zero-length leases', () => {
    expect(() =>
      acquireLiveRunLock(null, {
        runKey: 'sim-a',
        ownerId: 'worker-1',
        nowMs: 100,
        leaseUntilMs: 100,
      })
    ).toThrowError(LiveRunLockError);
  });
});
