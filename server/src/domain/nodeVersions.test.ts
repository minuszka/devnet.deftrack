import { describe, expect, it } from 'vitest';
import { releaseOf, summariseVersions, versionsFromPeers } from './nodeVersions.js';

const SUBVER = '/DeFCoN:22.1.5(devnet.devnet-defcon-q60)/';
const NEXT = '/DeFCoN:23.0.0(devnet.devnet-defcon-q60)/';

describe('reading versions off the peer table', () => {
  it('keeps only peers that authenticated as a masternode, one entry per ProTx', () => {
    const seen = versionsFromPeers([
      { subver: SUBVER, version: 70241, verified_proregtx_hash: 'aa' },
      // The same masternode, connected twice: counted once, last row wins.
      { subver: NEXT, version: 70242, verified_proregtx_hash: 'aa' },
      // A full node or staker: no ProTx, no vote in the census.
      { subver: SUBVER, version: 70241 },
      // A masternode row with the version fields missing says nothing usable.
      { verified_proregtx_hash: 'bb' },
      { subver: SUBVER, version: 70241, verified_proregtx_hash: 'cc' },
    ]);
    expect(seen).toEqual([
      { proTxHash: 'aa', subversion: NEXT, protocol: 70242 },
      { proTxHash: 'cc', subversion: SUBVER, protocol: 70241 },
    ]);
  });

  it('extracts the release from a subversion string, and leaves a strange one whole', () => {
    expect(releaseOf(SUBVER)).toBe('22.1.5');
    expect(releaseOf('/DeFCoN:23.0.0/')).toBe('23.0.0');
    expect(releaseOf('/generic-seeder/')).toBe('/generic-seeder/');
  });
});

describe('summarising a census', () => {
  const now = new Date('2026-09-10T12:00:00Z');
  const hour = 60 * 60_000;
  const row = (sub: string | null, seenHoursAgo: number | null, protocol = 70241) => ({
    nodeSubversion: sub,
    nodeProtocol: sub ? protocol : null,
    versionSeenAt: seenHoursAgo === null ? null : new Date(now.getTime() - seenHoursAgo * hour),
  });

  it('buckets known, stale and unknown by the freshness window, and shares are over the whole set', () => {
    const s = summariseVersions(
      [row(SUBVER, 0), row(SUBVER, 1), row(NEXT, 0), row(SUBVER, 30), row(null, null)],
      now,
      24 * hour
    );
    expect(s.total).toBe(5);
    expect(s.known).toBe(3);
    expect(s.stale).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.known + s.stale + s.unknown).toBe(s.total);
    expect(s.byVersion).toEqual([
      { subversion: SUBVER, release: '22.1.5', protocol: 70241, count: 2, share: 0.4 },
      { subversion: NEXT, release: '23.0.0', protocol: 70241, count: 1, share: 0.2 },
    ]);
    // 0.4 + 0.2 is not 1: the stale and the unknown masternode are in the
    // denominator on purpose. That is what makes `share` the adoption ratio.
  });

  it('is all zeros on an empty set rather than dividing by it', () => {
    const s = summariseVersions([], now, hour);
    expect(s).toEqual({ total: 0, known: 0, stale: 0, unknown: 0, staleAfterMs: hour, byVersion: [] });
  });

  it('a sighting exactly at the window edge still counts as known', () => {
    const s = summariseVersions([row(SUBVER, 24)], now, 24 * hour);
    expect(s.known).toBe(1);
    expect(s.stale).toBe(0);
  });
});
