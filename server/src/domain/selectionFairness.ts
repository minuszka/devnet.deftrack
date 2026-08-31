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
 * Eligibility respects registration: a node registered at height H simply did
 * not exist for rounds scheduled before H, and counting those rounds against
 * it manufactures starvation -- exactly the artefact a fleet scale-up would
 * flood this page with. Where heights are unknown the old whole-window
 * behaviour applies unchanged.
 *
 * Pure so the arithmetic can be tested without a chain.
 */
export interface RoundMembership {
  /** Members the round actually selected. */
  members: Array<{ proTxHash: string; valid: boolean; operatorLabel: string | null }>;
  /** min(profile size, masternodes available) -- what the selection drew from. */
  effectiveSize: number | null;
  /** The round's scheduled height; lets eligibility respect registration. */
  expectedHeight?: number | null;
}

export interface KnownNode {
  host: string | null;
  operatorLabel: string | null;
  /** protx registration height; negative or missing means unknown, which is
   *  treated as registered since forever -- the pre-height behaviour. */
  registeredHeight?: number | null;
}

export interface NodeFairness {
  proTxHash: string;
  operatorLabel: string | null;
  host: string | null;

  timesSelected: number;
  timesInvalid: number;
  /** Rounds in the window this node was actually registered for. */
  roundsEligible: number;
  /** Share of its eligible rounds this node was selected for. */
  selectionRate: number;
  /**
   * Wilson 95% interval on the selection rate. An expected rate outside this
   * interval is evidence; 30 picks out of 50 rounds on its own is not -- the
   * interval is what separates an anomaly from a small sample.
   */
  selectionCi95: [number, number] | null;
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
   * Selection rate a node would see by chance, averaged per round: each
   * round's drawn size over the pool that was actually registered by that
   * round's height. A pool taken from today's list would dilute every round
   * measured before a scale-up. Without it, "this node was selected in 40% of
   * rounds" says nothing at all.
   */
  expectedSelectionRate: number | null;

  nodes: NodeFairness[];
  hosts: HostFairness[];
  /** Known masternodes eligible in the window that no round ever selected. */
  neverSelected: string[];
  /** Selections below which no failure rate is reported. */
  minSamples: number;
}

/** Wilson score interval at 95% for a binomial proportion. */
function wilson95(successes: number, trials: number): [number, number] | null {
  if (trials <= 0) return null;
  const z = 1.959963985;
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function selectionFairness(
  rounds: RoundMembership[],
  knownNodes: ReadonlyMap<string, KnownNode> = new Map(),
  minSamples = 5
): SelectionFairness {
  const selected = new Map<string, { picked: number; invalid: number; label: string | null }>();

  for (const round of rounds) {
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

  const isEligible = (registeredHeight: number | null | undefined, expectedHeight: number | null | undefined): boolean => {
    if (registeredHeight === null || registeredHeight === undefined || registeredHeight < 0) return true;
    if (expectedHeight === null || expectedHeight === undefined) return true;
    return registeredHeight <= expectedHeight;
  };

  // Expected rate, per round: the drawn size over the pool registered by that
  // round's height. With no height data every round sees the same pool and
  // this collapses to the old averageSize / pool.
  let rateSum = 0;
  let rateCount = 0;
  for (const round of rounds) {
    if (round.effectiveSize === null) continue;
    let pool = 0;
    if (knownNodes.size > 0) {
      for (const k of knownNodes.values()) {
        if (isEligible(k.registeredHeight, round.expectedHeight)) pool++;
      }
    } else {
      pool = selected.size;
    }
    if (pool > 0) {
      rateSum += Math.min(1, round.effectiveSize / pool);
      rateCount++;
    }
  }
  const expectedSelectionRate = rateCount > 0 ? rateSum / rateCount : null;

  const eligibleRoundsFor = (proTxHash: string): number => {
    const regH = knownNodes.get(proTxHash)?.registeredHeight;
    if (regH === null || regH === undefined || regH < 0) return roundsConsidered;
    let n = 0;
    for (const round of rounds) {
      if (isEligible(regH, round.expectedHeight)) n++;
    }
    return n;
  };

  const nodes: NodeFairness[] = [...selected.entries()]
    .map(([proTxHash, e]) => {
      const known = knownNodes.get(proTxHash);
      const roundsEligible = eligibleRoundsFor(proTxHash);
      return {
        proTxHash,
        operatorLabel: e.label ?? known?.operatorLabel ?? null,
        host: known?.host ?? null,
        timesSelected: e.picked,
        timesInvalid: e.invalid,
        roundsEligible,
        selectionRate: roundsEligible > 0 ? e.picked / roundsEligible : 0,
        selectionCi95: wilson95(e.picked, roundsEligible),
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
  // in any table built only from members. But only for nodes the window could
  // have reached -- a node registered after every round in the window was not
  // passed over, it was not there.
  const neverSelected = [...knownNodes.keys()]
    .filter((h) => !selected.has(h) && eligibleRoundsFor(h) > 0)
    .sort();

  return {
    roundsConsidered,
    expectedSelectionRate,
    nodes,
    hosts,
    neverSelected,
    minSamples,
  };
}
