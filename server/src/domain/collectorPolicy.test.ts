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
  });

  /**
   * A decided-against round is never asked about again, and that is a rule with
   * a cost, so it is written down here rather than left as a bare `false`.
   *
   * What makes it safe is entirely on the write side, and none of it is
   * optional: `classifyRound` cannot answer `failed` before the mining window
   * has closed (below it the answer is `pending`), the collector refuses to
   * write `failed` for a height older than the RPC can still see
   * (`absenceIsEvidence`), and it refuses to write it at all when the
   * masternode count is unknown -- because `failed` and `impossible` are told
   * apart by that count, and a guess here would be permanent.
   *
   * What it does not cover: a reorg below the mining window could change an
   * outcome already recorded, and nothing would revisit it. That is the
   * commitment-index reconciliation deferred out of the 7th audit day, not
   * something this policy can decide on its own.
   */
  it('never revisits a round that was decided against, by design', () => {
    expect(shouldRefreshRound({ status: 'failed' })).toBe(false);
    expect(shouldRefreshRound({ status: 'failed', detailsComplete: false })).toBe(false);
    // `impossible` is the same kind of verdict -- the profile could not have
    // formed at that height -- and was not covered at all before.
    expect(shouldRefreshRound({ status: 'impossible' })).toBe(false);
    expect(shouldRefreshRound({ status: 'impossible', detailsComplete: false })).toBe(false);
  });

  it('backs payee retries off and caps them at 24 hours', () => {
    expect(payeeRetryDelayMs(1)).toBe(5 * 60_000);
    expect(payeeRetryDelayMs(2)).toBe(10 * 60_000);
    expect(payeeRetryDelayMs(100)).toBeLessThanOrEqual(24 * 60 * 60_000);
  });
});
