/**
 * Who gets chosen for quorums, and who fails once chosen.
 *
 * Two different questions live here, and conflating them is the mistake this
 * module exists to prevent. A masternode can be a problem because it is never
 * selected -- which is a property of the selection, not of the node -- or
 * because it is selected and then does not participate, which is the node's
 * own doing. A profile change like Q60 can move either one, and only the
 * second is a fault.
 *
 * Pure so the arithmetic can be tested without a chain.
 */
export interface RoundMembership {
  /** Members the round actually selected. */
  members: Array<{ proTxHash: string; valid: boolean; operatorLabel: string | null }>;
  /** min(profile size, masternodes available) -- what the selection drew from. */
  effectiveSize: number | null;
}

export interface NodeFairness {
  proTxHash: string;
  operatorLabel: string | null;
  host: string | null;

  timesSelected: number;
  timesInvalid: number;
  /** Share of rounds this node was selected for. */
  selectionRate: number;
  /**
   * Share of its selections in which it was marked invalid.
   *
   * Null below the sample floor: one failure out of two selections is not a
   * 50% failure rate, it is two data points, and printing 50% next to a node
   * with two hundred selections invites exactly the wrong comparison.
   */
  invalidRate: number | null;
}

export interface HostFairness {
  host: string;
  nodes: number;
  timesSelected: number;
  timesInvalid: number;
  invalidRate: number | null;
}

export interface SelectionFairness {
  roundsConsidered: number;
  /**
   * Selection rate a node would see by chance: the average quorum size divided
   * by the number of masternodes that could have been chosen. Without it, "this
   * node was selected in 40% of rounds" says nothing at all.
   */
  expectedSelectionRate: number | null;

  nodes: NodeFairness[];
  hosts: HostFairness[];
  /** Known masternodes that no round in the window ever selected. */
  neverSelected: string[];
  /** Selections below which no failure rate is reported. */
  minSamples: number;
}

export function selectionFairness(
  rounds: RoundMembership[],
  knownNodes: ReadonlyMap<string, { host: string | null; operatorLabel: string | null }> = new Map(),
  minSamples = 5
): SelectionFairness {
  const selected = new Map<string, { picked: number; invalid: number; label: string | null }>();
  let sizeSum = 0;
  let sizeCount = 0;

  for (const round of rounds) {
    if (round.effectiveSize !== null) {
      sizeSum += round.effectiveSize;
      sizeCount++;
    }
    for (const m of round.members) {
      const entry = selected.get(m.proTxHash) ?? { picked: 0, invalid: 0, label: m.operatorLabel };
      entry.picked++;
      if (!m.valid) entry.invalid++;
      // The label can arrive later than the first sighting; keep whichever is known.
      entry.label = entry.label ?? m.operatorLabel;
      selected.set(m.proTxHash, entry);
    }
  }

  const roundsConsidered = rounds.length;
  const averageSize = sizeCount > 0 ? sizeSum / sizeCount : null;
  // The pool is every masternode that could have been drawn, which is what the
  // caller knows -- not just the ones that happened to be picked.
  const pool = knownNodes.size > 0 ? knownNodes.size : selected.size;
  const expectedSelectionRate = averageSize !== null && pool > 0 ? Math.min(1, averageSize / pool) : null;

  const nodes: NodeFairness[] = [...selected.entries()]
    .map(([proTxHash, e]) => {
      const known = knownNodes.get(proTxHash);
      return {
        proTxHash,
        operatorLabel: e.label ?? known?.operatorLabel ?? null,
        host: known?.host ?? null,
        timesSelected: e.picked,
        timesInvalid: e.invalid,
        selectionRate: roundsConsidered > 0 ? e.picked / roundsConsidered : 0,
        invalidRate: e.picked >= minSamples ? e.invalid / e.picked : null,
      };
    })
    .sort((a, b) => b.timesInvalid - a.timesInvalid || b.timesSelected - a.timesSelected);

  const perHost = new Map<string, { nodes: Set<string>; picked: number; invalid: number }>();
  for (const n of nodes) {
    if (!n.host) continue;
    const h = perHost.get(n.host) ?? { nodes: new Set<string>(), picked: 0, invalid: 0 };
    h.nodes.add(n.proTxHash);
    h.picked += n.timesSelected;
    h.invalid += n.timesInvalid;
    perHost.set(n.host, h);
  }

  const hosts: HostFairness[] = [...perHost.entries()]
    .map(([host, h]) => ({
      host,
      nodes: h.nodes.size,
      timesSelected: h.picked,
      timesInvalid: h.invalid,
      invalidRate: h.picked >= minSamples ? h.invalid / h.picked : null,
    }))
    .sort((a, b) => b.timesInvalid - a.timesInvalid || b.timesSelected - a.timesSelected);

  // Silence is a finding: a masternode the selection never reached is invisible
  // in any table built only from members.
  const neverSelected = [...knownNodes.keys()].filter((h) => !selected.has(h)).sort();

  return {
    roundsConsidered,
    expectedSelectionRate,
    nodes,
    hosts,
    neverSelected,
    minSamples,
  };
}
