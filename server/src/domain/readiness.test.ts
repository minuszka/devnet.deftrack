import { describe, expect, it } from 'vitest';
import { evaluateReadiness, type ReadinessInput } from './readiness.js';

/**
 * The endpoint this backs previously answered "ok" while both dependencies were
 * down, because every probe was swallowed and the literal was hardcoded. These
 * cases exist so that cannot come back unnoticed.
 */
describe('readiness', () => {
  const healthy: ReadinessInput = {
    mongoConnected: true,
    chainTip: 1200,
    indexedHeight: 1200,
    syncError: null,
    lastSyncedAtMs: 1_000_000,
    nowMs: 1_020_000,
    syncIntervalMs: 20_000,
  };

  it('is ok when every dependency answers and the indexer is at the tip', () => {
    expect(evaluateReadiness(healthy)).toEqual({ status: 'ok', httpStatus: 200, failing: [] });
  });

  it('reports 503 and "down" when Mongo is disconnected', () => {
    const r = evaluateReadiness({ ...healthy, mongoConnected: false });
    expect(r.status).toBe('down');
    expect(r.httpStatus).toBe(503);
    expect(r.failing).toContain('mongo');
  });

  it('treats an unanswered RPC (tip -1) as down, not as height -1', () => {
    const r = evaluateReadiness({ ...healthy, chainTip: -1, indexedHeight: 1200 });
    expect(r.status).toBe('down');
    expect(r.failing).toEqual(['rpc']);
  });

  it('surfaces a recorded sync error as degraded rather than down', () => {
    const r = evaluateReadiness({ ...healthy, syncError: 'ECONNREFUSED' });
    expect(r).toEqual({ status: 'degraded', httpStatus: 503, failing: ['sync'] });
  });

  it('does not fault a catching-up indexer that is still advancing', () => {
    // 500 blocks behind on a fresh chain, but it moved 20 seconds ago.
    const r = evaluateReadiness({ ...healthy, indexedHeight: 700, nowMs: 1_020_000 });
    expect(r.status).toBe('ok');
  });

  it('faults an indexer that is behind and has stopped moving', () => {
    const r = evaluateReadiness({
      ...healthy,
      indexedHeight: 700,
      lastSyncedAtMs: 1_000_000,
      nowMs: 1_000_000 + 11 * 60_000,
    });
    expect(r.status).toBe('degraded');
    expect(r.failing).toEqual(['sync-stalled']);
  });

  it('does not fault an idle indexer that is level with the tip', () => {
    // Nothing to index is not a stall: a PoS chain can be quiet for a while.
    const r = evaluateReadiness({ ...healthy, nowMs: 1_000_000 + 60 * 60_000 });
    expect(r.status).toBe('ok');
  });

  it('lists every failing probe, and lets a dependency outrank a lagging sync', () => {
    const r = evaluateReadiness({
      ...healthy,
      mongoConnected: false,
      syncError: 'boom',
    });
    expect(r.failing).toEqual(['mongo', 'sync']);
    expect(r.status).toBe('down');
  });
});
