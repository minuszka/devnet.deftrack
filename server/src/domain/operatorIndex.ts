/**
 * Resolving a masternode to the person running it.
 *
 * Two tiers, most specific first: an explicit proTxHash beats a host match, so
 * a shared machine can still have individual nodes attributed elsewhere.
 */
export interface OperatorMapping {
  operatorLabel: string;
  proTxHashes: string[];
  hostIps: string[];
}

export class OperatorIndex {
  private readonly byProTx = new Map<string, string>();
  private readonly byHost = new Map<string, string>();

  constructor(mappings: OperatorMapping[]) {
    for (const m of mappings) {
      for (const hash of m.proTxHashes) this.byProTx.set(hash, m.operatorLabel);
      for (const ip of m.hostIps) this.byHost.set(ip, m.operatorLabel);
    }
  }

  resolve(proTxHash: string, hostIp: string | null): string | null {
    return this.byProTx.get(proTxHash) ?? (hostIp ? (this.byHost.get(hostIp) ?? null) : null);
  }

  get size(): number {
    return this.byProTx.size + this.byHost.size;
  }
}

/** Host part of a `1.2.3.4:19799` service string. */
export function hostOf(service: string | null | undefined): string | null {
  if (!service) return null;
  const idx = service.lastIndexOf(':');
  return idx > 0 ? service.slice(0, idx) : service;
}
