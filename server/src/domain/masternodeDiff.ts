/**
 * Which stored masternodes are no longer in `protx list registered`.
 *
 * Collateral can be spent and a ProUpRevTx can retire a node; the poller only
 * ever iterates the list it received, so without this the stored row is never
 * touched again and every "current network size" figure counts it forever.
 * Rows already marked inactive are skipped so the removal event is emitted once.
 */
export interface KnownMasternode {
  proTxHash: string;
  active?: boolean;
}

export function findRemoved<T extends KnownMasternode>(known: Iterable<T>, listed: Set<string>): T[] {
  const gone: T[] = [];
  for (const node of known) {
    if (listed.has(node.proTxHash) || node.active === false) continue;
    gone.push(node);
  }
  return gone;
}
