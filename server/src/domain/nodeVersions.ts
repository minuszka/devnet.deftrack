/**
 * Node versions as the seed sees them.
 *
 * A masternode's software version is not on the chain: a ProTx carries no
 * version and `protx list` reports none. What does carry it is the peer table
 * of a node the masternodes connect to. Every masternode authenticates to its
 * peers with MNAUTH, so a `getpeerinfo` row with `verified_proregtx_hash`
 * names the masternode it is, and its `subver` names the build. On the devnet
 * seed 151 of 152 masternodes were such rows at one reading (2026-09-10), so
 * this is nearly a census rather than a sample -- and it is the only
 * measurement of adoption there is.
 *
 * Why it exists: the v23 switchover's first Q60 DKG needs 44 of the 60
 * selected members on the new binary, and the go/no-go for pinning the
 * activation height is an adoption ratio. Nothing measured it.
 */

/** The three `getpeerinfo` fields this reads; everything else is ignored. */
export interface VersionedPeer {
  subver?: string;
  version?: number;
  verified_proregtx_hash?: string;
}

export interface ObservedVersion {
  proTxHash: string;
  subversion: string;
  protocol: number;
}

/**
 * One entry per authenticated masternode. A peer without a verified ProTx is
 * a full node, a staker or an unauthenticated masternode, and says nothing
 * about which masternode runs what; a masternode connected twice reports the
 * same build twice, and the last row wins so nothing is counted double.
 */
export function versionsFromPeers(peers: readonly VersionedPeer[]): ObservedVersion[] {
  const byProTx = new Map<string, ObservedVersion>();
  for (const p of peers) {
    const proTxHash = p.verified_proregtx_hash;
    if (!proTxHash || typeof p.subver !== 'string' || typeof p.version !== 'number') continue;
    byProTx.set(proTxHash, { proTxHash, subversion: p.subver, protocol: p.version });
  }
  return [...byProTx.values()];
}

/** `/DeFCoN:22.1.5(devnet.devnet-defcon-q60)/` -> `22.1.5`; anything else is returned whole. */
export function releaseOf(subversion: string): string {
  const m = /^\/[^:/]+:([^(/]+)/.exec(subversion);
  return m?.[1] ?? subversion;
}

export interface VersionRow {
  nodeSubversion: string | null;
  nodeProtocol: number | null;
  versionSeenAt: Date | null;
}

export interface VersionCount {
  subversion: string;
  release: string;
  protocol: number | null;
  count: number;
  /** Of every masternode counted, not of the known ones -- so this IS the adoption ratio. */
  share: number;
}

export interface VersionSummary {
  total: number;
  /** Seen within the freshness window. */
  known: number;
  /** Seen once, but not within the window: probably running, version possibly changed. */
  stale: number;
  /** Never seen as an authenticated peer. */
  unknown: number;
  staleAfterMs: number;
  byVersion: VersionCount[];
}

/**
 * Counts by build over the masternodes given, with a freshness window.
 *
 * `share` is taken over `total` and not over `known`, deliberately: "90% of
 * masternodes run v23" is the question the switchover asks, and a ratio over
 * the known ones would answer it too kindly on the day the census is thin.
 * Known, stale and unknown together are the whole set.
 */
export function summariseVersions(rows: readonly VersionRow[], now: Date, staleAfterMs: number): VersionSummary {
  const cutoff = now.getTime() - staleAfterMs;
  const counts = new Map<string, { subversion: string; protocol: number | null; count: number }>();
  let known = 0;
  let stale = 0;
  let unknown = 0;
  for (const r of rows) {
    if (!r.nodeSubversion || !r.versionSeenAt) {
      unknown += 1;
      continue;
    }
    if (r.versionSeenAt.getTime() < cutoff) {
      stale += 1;
      continue;
    }
    known += 1;
    const entry = counts.get(r.nodeSubversion) ?? { subversion: r.nodeSubversion, protocol: r.nodeProtocol, count: 0 };
    entry.count += 1;
    counts.set(r.nodeSubversion, entry);
  }
  const total = rows.length;
  const byVersion: VersionCount[] = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.subversion.localeCompare(b.subversion))
    .map((e) => ({ ...e, release: releaseOf(e.subversion), share: total > 0 ? e.count / total : 0 }));
  return { total, known, stale, unknown, staleAfterMs, byVersion };
}
