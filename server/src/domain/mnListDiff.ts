/**
 * Turns `protx listdiff` into masternode transitions.
 *
 * The poller can only ever compare two snapshots it happened to take, so a
 * change that came and went between polls leaves no trace, and every event
 * carries the poll time rather than the height it happened at. The node will
 * instead compute the exact difference between two blocks
 * (`src/rpc/evo.cpp:1604`), which is deterministic, attributable to a height,
 * and replayable after the fact.
 *
 * The diff reports only the fields that changed, and reports their *new*
 * values -- which is enough to name the transition without holding the previous
 * state: `PoSeBanHeight` appearing with a height means the ban just landed,
 * appearing as -1 means the node was just revived.
 */
export type MnChangeType =
  | 'registered'
  | 'removed'
  | 'banned'
  | 'revived'
  | 'penalty_up'
  | 'service_changed'
  | 'key_changed'
  | 'revoked';

export interface MnStateDiff {
  service?: string;
  registeredHeight?: number;
  lastPaidHeight?: number;
  consecutivePayments?: number;
  PoSePenalty?: number;
  PoSeBanHeight?: number;
  PoSeRevivedHeight?: number;
  revocationReason?: number;
  ownerAddress?: string;
  votingAddress?: string;
  payoutAddress?: string;
  pubKeyOperator?: string;
  version?: number;
}

export interface ListDiffResult {
  baseHeight: number;
  blockHeight: number;
  addedMNs: Array<{ proTxHash: string; state?: MnStateDiff; [k: string]: unknown }>;
  removedMNs: string[];
  updatedMNs: Array<Record<string, MnStateDiff>>;
}

export interface MnChange {
  proTxHash: string;
  type: MnChangeType;
  height: number;
  serviceAfter: string | null;
  penaltyAfter: number | null;
  /** Only set where the node gives a reason of its own. */
  revocationReason: number | null;
}

/** Fields whose change means the registrar was updated, not the node's state. */
const KEY_FIELDS = ['ownerAddress', 'votingAddress', 'payoutAddress', 'pubKeyOperator'] as const;

/**
 * @param previousPenalty penalty from the last observation, per proTxHash.
 *   PoSe penalty decays by one per block, so every penalised node appears in
 *   every single diff. Only an *increase* is a transition; the decay is the
 *   node serving its sentence and must not be logged as an event, or one ban
 *   wave buries itself under thousands of rows.
 */
export function classifyListDiff(
  diff: ListDiffResult,
  previousPenalty: ReadonlyMap<string, number> = new Map()
): MnChange[] {
  const height = diff.blockHeight;
  const changes: MnChange[] = [];

  const base = (proTxHash: string, type: MnChangeType, state?: MnStateDiff): MnChange => ({
    proTxHash,
    type,
    height,
    serviceAfter: state?.service ?? null,
    penaltyAfter: state?.PoSePenalty ?? null,
    revocationReason: state?.revocationReason ?? null,
  });

  for (const added of diff.addedMNs ?? []) {
    changes.push(base(added.proTxHash, 'registered', added.state));
  }

  for (const proTxHash of diff.removedMNs ?? []) {
    changes.push(base(proTxHash, 'removed'));
  }

  for (const entry of diff.updatedMNs ?? []) {
    for (const [proTxHash, state] of Object.entries(entry)) {
      if (state.PoSeBanHeight !== undefined) {
        // -1 is not a height; it is the absence of a ban.
        changes.push(base(proTxHash, state.PoSeBanHeight === -1 ? 'revived' : 'banned', state));
      }

      if (state.PoSePenalty !== undefined) {
        const before = previousPenalty.get(proTxHash);
        if (before === undefined || state.PoSePenalty > before) {
          changes.push(base(proTxHash, 'penalty_up', state));
        }
      }

      if (state.service !== undefined) {
        changes.push(base(proTxHash, 'service_changed', state));
      }

      if (state.revocationReason !== undefined) {
        changes.push(base(proTxHash, 'revoked', state));
      }

      if (KEY_FIELDS.some((f) => state[f] !== undefined)) {
        changes.push(base(proTxHash, 'key_changed', state));
      }
    }
  }

  return changes;
}

/** The penalty each node ends the diff on, for the next block's comparison. */
export function penaltiesAfter(
  diff: ListDiffResult,
  previous: ReadonlyMap<string, number>
): Map<string, number> {
  const next = new Map(previous);

  for (const added of diff.addedMNs ?? []) {
    next.set(added.proTxHash, added.state?.PoSePenalty ?? 0);
  }
  for (const proTxHash of diff.removedMNs ?? []) {
    next.delete(proTxHash);
  }
  for (const entry of diff.updatedMNs ?? []) {
    for (const [proTxHash, state] of Object.entries(entry)) {
      if (state.PoSePenalty !== undefined) next.set(proTxHash, state.PoSePenalty);
    }
  }

  return next;
}
