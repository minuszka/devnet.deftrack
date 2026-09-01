interface LiveRunLockBase {
  /** One global lock in the first release; kept explicit for a later scope split. */
  scope: 'devnet-live';
  revision: number;
}

export interface HeldLiveRunLock extends LiveRunLockBase {
  status: 'held';
  runKey: string;
  ownerId: string;
  acquiredAtMs: number;
  leaseUntilMs: number;
}

export interface ReleasedLiveRunLock extends LiveRunLockBase {
  status: 'released';
  runKey: null;
  ownerId: null;
  acquiredAtMs: null;
  leaseUntilMs: null;
  releasedAtMs: number;
}

export type LiveRunLock = HeldLiveRunLock | ReleasedLiveRunLock;

export type LiveRunLockAcquireResult =
  | { acquired: true; disposition: 'acquired' | 'already-held'; lock: HeldLiveRunLock }
  | { acquired: false; disposition: 'held-by-other'; lock: HeldLiveRunLock };

export class LiveRunLockError extends Error {
  constructor(
    public readonly code: 'INVALID_IDENTITY' | 'INVALID_LEASE' | 'NOT_OWNER',
    message: string
  ) {
    super(message);
    this.name = 'LiveRunLockError';
  }
}

function validateLease(nowMs: number, leaseUntilMs: number): void {
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(leaseUntilMs) || leaseUntilMs <= nowMs) {
    throw new LiveRunLockError('INVALID_LEASE', 'lock lease must end after now');
  }
}

function validateIdentity(runKey: string, ownerId: string): void {
  if (runKey.trim().length === 0 || ownerId.trim().length === 0) {
    throw new LiveRunLockError('INVALID_IDENTITY', 'runKey and ownerId must not be empty');
  }
}

/**
 * Pure compare-and-decide logic for the single live-run lock.
 *
 * The Mongo service added on day 3 must persist the returned value with a
 * compare-and-swap on `revision`. This function alone never claims to provide
 * cross-process exclusion.
 */
export function acquireLiveRunLock(
  current: LiveRunLock | null,
  input: { runKey: string; ownerId: string; nowMs: number; leaseUntilMs: number }
): LiveRunLockAcquireResult {
  validateIdentity(input.runKey, input.ownerId);
  validateLease(input.nowMs, input.leaseUntilMs);

  if (current?.status === 'held' && current.leaseUntilMs > input.nowMs) {
    if (current.runKey === input.runKey && current.ownerId === input.ownerId) {
      // An identical start retry is successful but cannot silently extend the
      // lease. Renewal is a separate, explicit operation.
      return { acquired: true, disposition: 'already-held', lock: current };
    }
    return { acquired: false, disposition: 'held-by-other', lock: current };
  }

  return {
    acquired: true,
    disposition: 'acquired',
    lock: {
      scope: 'devnet-live',
      status: 'held',
      runKey: input.runKey,
      ownerId: input.ownerId,
      acquiredAtMs: input.nowMs,
      leaseUntilMs: input.leaseUntilMs,
      revision: (current?.revision ?? -1) + 1,
    },
  };
}

export function renewLiveRunLock(
  current: LiveRunLock,
  input: { runKey: string; ownerId: string; nowMs: number; leaseUntilMs: number }
): HeldLiveRunLock {
  validateIdentity(input.runKey, input.ownerId);
  validateLease(input.nowMs, input.leaseUntilMs);
  if (
    current.status !== 'held' ||
    current.runKey !== input.runKey ||
    current.ownerId !== input.ownerId ||
    current.leaseUntilMs <= input.nowMs
  ) {
    throw new LiveRunLockError('NOT_OWNER', 'only the current owner can renew an unexpired lock');
  }
  if (input.leaseUntilMs <= current.leaseUntilMs) {
    throw new LiveRunLockError('INVALID_LEASE', 'renewal must extend the current lock lease');
  }

  return {
    ...current,
    leaseUntilMs: input.leaseUntilMs,
    revision: current.revision + 1,
  };
}

export function releaseLiveRunLock(
  current: LiveRunLock | null,
  input: { runKey: string; ownerId: string; nowMs: number }
): LiveRunLock | null {
  if (current === null) return null;
  if (current.status === 'released') return current;
  validateIdentity(input.runKey, input.ownerId);
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < current.acquiredAtMs) {
    throw new LiveRunLockError('INVALID_LEASE', 'release time predates lock acquisition');
  }
  if (current.runKey !== input.runKey || current.ownerId !== input.ownerId) {
    throw new LiveRunLockError('NOT_OWNER', 'only the current owner can release the lock');
  }
  return {
    scope: 'devnet-live',
    status: 'released',
    runKey: null,
    ownerId: null,
    acquiredAtMs: null,
    leaseUntilMs: null,
    releasedAtMs: input.nowMs,
    revision: current.revision + 1,
  };
}
