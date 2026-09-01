import { describe, expect, it } from 'vitest';
import {
  claimActionUpdate,
  claimableActionFilter,
  expireOverdueFilter,
  expireOverdueUpdate,
  renewLeaseFilter,
  renewLeaseUpdate,
  settleActionFilter,
  settleActionUpdate,
} from './actionLease.js';

const NOW = 1_000_000;

describe('action lease filters', () => {
  it('claims a due action that is pending or holds an expired lease, with attempts left', () => {
    const filter = claimableActionFilter(NOW) as any;
    // Window still open.
    expect(filter.expiresAtMs).toEqual({ $gt: NOW });
    // Due: no notBefore, or notBefore reached.
    expect(filter.$or).toEqual([{ notBeforeMs: null }, { notBeforeMs: { $lte: NOW } }]);
    // Claimable status: fresh, or a lapsed lease to reclaim.
    const statusBranch = filter.$and[0].$or;
    expect(statusBranch).toContainEqual({ status: 'pending' });
    expect(statusBranch).toContainEqual({ status: 'claimed', leaseUntilMs: { $lte: NOW } });
    // Never past the attempt ceiling.
    expect(filter.$and[1]).toEqual({ $expr: { $lt: ['$attempts', '$maxAttempts'] } });
  });

  it('claiming takes ownership, sets a fresh lease and counts the attempt', () => {
    const update = claimActionUpdate({ claimedBy: 'worker-1', nowMs: NOW, leaseMs: 30_000 }) as any;
    expect(update.$set).toMatchObject({
      status: 'claimed', claimedBy: 'worker-1', claimedAtMs: NOW, leaseUntilMs: NOW + 30_000,
    });
    expect(update.$inc).toEqual({ attempts: 1, revision: 1 });
  });

  it('only the current owner inside a live lease may renew, and renewal extends it', () => {
    const filter = renewLeaseFilter({ actionId: 'act-1', claimedBy: 'worker-1', nowMs: NOW }) as any;
    expect(filter).toEqual({ actionId: 'act-1', status: 'claimed', claimedBy: 'worker-1', leaseUntilMs: { $gt: NOW } });
    const update = renewLeaseUpdate({ nowMs: NOW, leaseMs: 15_000 }) as any;
    expect(update.$set).toEqual({ leaseUntilMs: NOW + 15_000 });
    expect(update.$inc).toEqual({ revision: 1 });
  });

  it('settling requires ownership and drops the lease on a terminal outcome', () => {
    const filter = settleActionFilter({ actionId: 'act-1', claimedBy: 'worker-1' }) as any;
    expect(filter).toEqual({ actionId: 'act-1', status: 'claimed', claimedBy: 'worker-1' });
    const result = { code: 'applied' as const, publicMessage: 'ok', privateDetail: null, wrapperVersion: '1.0.0', finishedAtMs: NOW };
    const update = settleActionUpdate({ status: 'succeeded', result, executedAtMs: NOW }) as any;
    expect(update.$set).toMatchObject({ status: 'succeeded', executedAtMs: NOW, leaseUntilMs: null, result });
    expect(update.$inc).toEqual({ revision: 1 });
  });

  it('expiry sweeps both a closed window and an exhausted, unleased action', () => {
    const filter = expireOverdueFilter(NOW) as any;
    expect(filter.$or).toContainEqual({ status: { $in: ['pending', 'claimed'] }, expiresAtMs: { $lte: NOW } });
    expect(filter.$or).toContainEqual({
      status: 'claimed', leaseUntilMs: { $lte: NOW }, $expr: { $gte: ['$attempts', '$maxAttempts'] },
    });
    const update = expireOverdueUpdate() as any;
    expect(update.$set).toEqual({ status: 'expired', claimedBy: null, leaseUntilMs: null });
  });
});
