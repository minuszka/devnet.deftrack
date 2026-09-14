import { describe, expect, it } from 'vitest';
import { evaluateReadiness, readinessInput, type ReadinessInput } from './readiness.js';

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
    lastSyncPassAtMs: 1_000_000,
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

/**
 * A quiet chain is not a stalled indexer.
 *
 * `lastSyncedAt` moves only when a block is indexed; a pass that finds nothing
 * to do writes `heartbeatAt`. Measured from the first alone, every block gap
 * longer than the stall limit read as a stalled indexer for the seconds between
 * the block reaching the node and the next pass -- the devnet health endpoint
 * answered 503 at 10:21Z and 11:31:57Z on 2026-09-14, each time within seconds
 * of a block that followed a gap of more than five minutes.
 */
describe('stall detection after a quiet gap', () => {
  const base: ReadinessInput = {
    mongoConnected: true,
    chainTip: 13272,
    indexedHeight: 13271,
    syncError: null,
    lastSyncedAtMs: 1_000_000,
    lastSyncPassAtMs: 1_000_000,
    nowMs: 1_000_000,
    syncIntervalMs: 20_000,
  };
  // 11:26:49.6Z block 13271 indexed; 11:31:46Z block 13272; 11:31:57Z the 503.
  const quietGapMs = 5 * 60_000 + 7_600;

  it('is ready when a block arrives after a long gap and the last pass ran moments ago', () => {
    const nowMs = base.lastSyncedAtMs! + quietGapMs;
    const r = evaluateReadiness({ ...base, lastSyncPassAtMs: nowMs - 10_000, nowMs });
    expect(r).toEqual({ status: 'ok', httpStatus: 200, failing: [] });
  });

  it('still reports a stall when the passes have stopped as well', () => {
    const nowMs = base.lastSyncedAtMs! + 11 * 60_000;
    const r = evaluateReadiness({ ...base, lastSyncPassAtMs: base.lastSyncedAtMs! + 30_000, nowMs });
    expect(r).toEqual({ status: 'degraded', httpStatus: 503, failing: ['sync-stalled'] });
  });

  it('falls back to the last advance for a cursor that has never recorded a pass', () => {
    const later = base.lastSyncedAtMs! + 11 * 60_000;
    expect(evaluateReadiness({ ...base, lastSyncPassAtMs: null, nowMs: later }).failing).toEqual(['sync-stalled']);
    expect(evaluateReadiness({ ...base, lastSyncPassAtMs: null, nowMs: base.lastSyncedAtMs! + 60_000 }).status).toBe('ok');
  });

  it('treats a cursor with neither time as never having run', () => {
    const r = evaluateReadiness({ ...base, lastSyncedAtMs: null, lastSyncPassAtMs: null });
    expect(r.failing).toEqual(['sync-stalled']);
  });
});

/** What the health endpoint hands `evaluateReadiness`, built from the stored sync cursor. */
describe('the readiness input built from the sync cursor', () => {
  it('carries the last pass as well as the last advance', () => {
    const cursor = {
      lastSyncedHeight: 13271,
      lastSyncedAt: new Date(1_000_000),
      heartbeatAt: new Date(1_297_600),
      error: null,
    };
    expect(
      readinessInput({ mongoConnected: true, chainTip: 13272, cursor, nowMs: 1_307_600, syncIntervalMs: 20_000 })
    ).toEqual({
      mongoConnected: true,
      chainTip: 13272,
      indexedHeight: 13271,
      syncError: null,
      lastSyncedAtMs: 1_000_000,
      lastSyncPassAtMs: 1_297_600,
      nowMs: 1_307_600,
      syncIntervalMs: 20_000,
    });
  });

  it('reads a missing cursor as nothing indexed, never synced, and no error recorded', () => {
    expect(readinessInput({ mongoConnected: true, chainTip: 5, cursor: null, nowMs: 1, syncIntervalMs: 20_000 })).toEqual({
      mongoConnected: true,
      chainTip: 5,
      indexedHeight: -1,
      syncError: null,
      lastSyncedAtMs: null,
      lastSyncPassAtMs: null,
      nowMs: 1,
      syncIntervalMs: 20_000,
    });
  });

  it('mapped, then decided: the 11:31:57Z cursor is ready, not stalled', () => {
    const cursor = {
      lastSyncedHeight: 13271,
      lastSyncedAt: new Date(1_000_000),
      heartbeatAt: new Date(1_000_000 + 5 * 60_000 - 5_000),
      error: null,
    };
    const input = readinessInput({
      mongoConnected: true,
      chainTip: 13272,
      cursor,
      nowMs: 1_000_000 + 5 * 60_000 + 7_600,
      syncIntervalMs: 20_000,
    });
    expect(evaluateReadiness(input).httpStatus).toBe(200);
  });
});
