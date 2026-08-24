import { describe, expect, it } from 'vitest';
import {
  chainLockRpcIntervalMs,
  payeeRetryDelayMs,
  shouldCollectMasternodes,
  shouldRefreshRound,
} from './collectorPolicy.js';

describe('collector policy', () => {
  it('uses rare reconciliation only while ZMQ is enabled', () => {
    expect(chainLockRpcIntervalMs(true, 10_000, 300_000)).toBe(300_000);
    expect(chainLockRpcIntervalMs(false, 10_000, 300_000)).toBe(10_000);
  });

  it('polls masternodes on a new height or heartbeat', () => {
    const base = { height: 42, lastHeight: 42, lastCollectedAtMs: 1_000, heartbeatMs: 300_000 };
    expect(shouldCollectMasternodes({ ...base, nowMs: 2_000 })).toBe(false);
    expect(shouldCollectMasternodes({ ...base, height: 43, nowMs: 2_000 })).toBe(true);
    expect(shouldCollectMasternodes({ ...base, nowMs: 301_000 })).toBe(true);
  });

  it('refreshes only unresolved or incomplete rounds', () => {
    expect(shouldRefreshRound(undefined)).toBe(true);
    expect(shouldRefreshRound({ status: 'pending' })).toBe(true);
    expect(shouldRefreshRound({ status: 'formed', detailsComplete: false })).toBe(true);
    expect(shouldRefreshRound({ status: 'formed', detailsComplete: true })).toBe(false);
    expect(shouldRefreshRound({ status: 'failed' })).toBe(false);
  });

  it('backs payee retries off and caps them at 24 hours', () => {
    expect(payeeRetryDelayMs(1)).toBe(5 * 60_000);
    expect(payeeRetryDelayMs(2)).toBe(10 * 60_000);
    expect(payeeRetryDelayMs(100)).toBeLessThanOrEqual(24 * 60 * 60_000);
  });
});
