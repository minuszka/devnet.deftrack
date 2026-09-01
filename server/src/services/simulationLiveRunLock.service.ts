import {
  acquireLiveRunLock,
  releaseLiveRunLock,
  renewLiveRunLock,
  type HeldLiveRunLock,
  type LiveRunLock,
  type LiveRunLockAcquireResult,
  type ReleasedLiveRunLock,
} from '../domain/liveRunLock.js';
import type { SimulationLiveRunLockRepository } from './simulationMongo.repository.js';

export class SimulationLiveRunLockPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationLiveRunLockPersistenceError';
  }
}

const MAX_LOCK_CAS_ATTEMPTS = 5;

/** Persist the day-2 lock decisions with optimistic compare-and-swap. */
export class SimulationLiveRunLockService {
  constructor(private readonly repository: SimulationLiveRunLockRepository) {}

  async acquire(input: {
    runKey: string;
    ownerId: string;
    nowMs: number;
    leaseUntilMs: number;
  }): Promise<LiveRunLockAcquireResult> {
    for (let attempt = 0; attempt < MAX_LOCK_CAS_ATTEMPTS; attempt++) {
      const current = await this.repository.find();
      const decision = acquireLiveRunLock(current, input);
      if (!decision.acquired || decision.disposition === 'already-held') return decision;

      const persisted = await this.repository.compareAndSwap(current?.revision ?? null, decision.lock);
      if (persisted) return decision;
    }
    throw new SimulationLiveRunLockPersistenceError('live-run lock changed repeatedly during acquire');
  }

  async renew(input: {
    runKey: string;
    ownerId: string;
    nowMs: number;
    leaseUntilMs: number;
  }): Promise<HeldLiveRunLock> {
    for (let attempt = 0; attempt < MAX_LOCK_CAS_ATTEMPTS; attempt++) {
      const current = await this.repository.find();
      if (current === null) {
        throw new SimulationLiveRunLockPersistenceError('cannot renew a missing live-run lock');
      }
      const next = renewLiveRunLock(current, input);
      if (await this.repository.compareAndSwap(current.revision, next)) return next;
    }
    throw new SimulationLiveRunLockPersistenceError('live-run lock changed repeatedly during renew');
  }

  async release(input: {
    runKey: string;
    ownerId: string;
    nowMs: number;
  }): Promise<ReleasedLiveRunLock | null> {
    for (let attempt = 0; attempt < MAX_LOCK_CAS_ATTEMPTS; attempt++) {
      const current = await this.repository.find();
      if (current === null) return null;
      const next = releaseLiveRunLock(current, input);
      if (next === null) return null;
      if (next.status === 'released' && next === current) return next;
      if (await this.repository.compareAndSwap(current.revision, next)) {
        return next as ReleasedLiveRunLock;
      }
    }
    throw new SimulationLiveRunLockPersistenceError('live-run lock changed repeatedly during release');
  }

  async current(): Promise<LiveRunLock | null> {
    return this.repository.find();
  }
}
