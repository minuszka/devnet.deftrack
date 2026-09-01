import { describe, expect, it } from 'vitest';
import type { LiveRunLock } from '../domain/liveRunLock.js';
import { SimulationLiveRunLockService } from './simulationLiveRunLock.service.js';
import type { SimulationLiveRunLockRepository } from './simulationMongo.repository.js';

class MemoryLockRepository implements SimulationLiveRunLockRepository {
  lock: LiveRunLock | null = null;
  rejectNextCas = false;

  async find(): Promise<LiveRunLock | null> {
    return this.lock === null ? null : structuredClone(this.lock);
  }

  async compareAndSwap(expectedRevision: number | null, next: LiveRunLock): Promise<boolean> {
    if (this.rejectNextCas) {
      this.rejectNextCas = false;
      return false;
    }
    if (expectedRevision === null) {
      if (this.lock !== null) return false;
    } else if (this.lock?.revision !== expectedRevision) {
      return false;
    }
    this.lock = structuredClone(next);
    return true;
  }
}

describe('persisted live-run lock service', () => {
  it('persists acquire, renew and release with monotonic revisions', async () => {
    const repository = new MemoryLockRepository();
    const service = new SimulationLiveRunLockService(repository);

    const acquired = await service.acquire({
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 100,
      leaseUntilMs: 200,
    });
    expect(acquired).toMatchObject({ acquired: true, lock: { status: 'held', revision: 0 } });

    const renewed = await service.renew({
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 150,
      leaseUntilMs: 300,
    });
    expect(renewed).toMatchObject({ leaseUntilMs: 300, revision: 1 });

    const released = await service.release({
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 160,
    });
    expect(released).toMatchObject({ status: 'released', revision: 2 });

    const next = await service.acquire({
      runKey: 'sim-b',
      ownerId: 'worker-2',
      nowMs: 170,
      leaseUntilMs: 270,
    });
    expect(next).toMatchObject({ acquired: true, lock: { runKey: 'sim-b', revision: 3 } });
  });

  it('makes duplicate acquire and release idempotent', async () => {
    const repository = new MemoryLockRepository();
    const service = new SimulationLiveRunLockService(repository);
    const input = { runKey: 'sim-a', ownerId: 'worker-1', nowMs: 100, leaseUntilMs: 200 };
    const first = await service.acquire(input);
    const duplicate = await service.acquire({ ...input, nowMs: 110, leaseUntilMs: 300 });
    expect(duplicate).toMatchObject({ acquired: true, disposition: 'already-held' });
    expect(duplicate.lock).toEqual(first.lock);

    const released = await service.release({ runKey: 'sim-a', ownerId: 'worker-1', nowMs: 150 });
    const repeated = await service.release({ runKey: 'sim-a', ownerId: 'worker-1', nowMs: 160 });
    expect(repeated).toEqual(released);
  });

  it('refuses a second run while the first lock is live', async () => {
    const service = new SimulationLiveRunLockService(new MemoryLockRepository());
    await service.acquire({
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 100,
      leaseUntilMs: 200,
    });
    const denied = await service.acquire({
      runKey: 'sim-b',
      ownerId: 'worker-2',
      nowMs: 150,
      leaseUntilMs: 250,
    });
    expect(denied).toMatchObject({ acquired: false, disposition: 'held-by-other' });
  });

  it('retries a lost CAS race without manufacturing a second revision', async () => {
    const repository = new MemoryLockRepository();
    repository.rejectNextCas = true;
    const service = new SimulationLiveRunLockService(repository);
    const acquired = await service.acquire({
      runKey: 'sim-a',
      ownerId: 'worker-1',
      nowMs: 100,
      leaseUntilMs: 200,
    });
    expect(acquired).toMatchObject({ acquired: true, lock: { revision: 0 } });
    expect(repository.lock).toMatchObject({ revision: 0 });
  });

  it('fails closed after repeated CAS contention', async () => {
    class AlwaysRejectRepository extends MemoryLockRepository {
      override async compareAndSwap(): Promise<boolean> {
        return false;
      }
    }
    const service = new SimulationLiveRunLockService(new AlwaysRejectRepository());
    await expect(
      service.acquire({
        runKey: 'sim-a',
        ownerId: 'worker-1',
        nowMs: 100,
        leaseUntilMs: 200,
      })
    ).rejects.toMatchObject({
      name: 'SimulationLiveRunLockPersistenceError',
    });
  });
});
