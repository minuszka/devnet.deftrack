/**
 * What a reorg invalidates beyond the blocks themselves.
 *
 * The rollback used to delete Block and Transaction documents and stop there,
 * which left every chain-derived quorum record intact -- a formed round still
 * pointing at a commitment in a block that no longer exists, and a failed round
 * that only failed on the abandoned chain. Those rows are exactly what this
 * project is measuring, so a silently stale one is the worst possible outcome.
 *
 * Rounds are reset rather than deleted. The schedule is a pure function of
 * height and dkgInterval (rpc/quorums.cpp:320), so the same round slots exist on
 * the new chain and keep the same roundKey; only what was *observed* about them
 * has to be discarded and re-collected.
 */
export interface QuorumReorgReset {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
}

/**
 * How far a single rollback may rewind before it stops and waits for a human.
 *
 * A reorg on a ChainLocked chain is a few blocks; a rewind of hundreds is a
 * symptom, not a reorg. The distinction matters more here than in an ordinary
 * explorer: the rewind resets quorum rounds, and a round older than the
 * `signingActiveQuorumCount` commitments `quorum listextended` still reports
 * can never be observed again. A wrong rewind therefore destroys the
 * failed-round record permanently -- the one record this project exists for.
 */
export const MAX_ROLLBACK_DEPTH = 200;

/** What the node's answer at the indexed tip permits the sync to do. */
export type ReorgVerdict =
  /** Stored and node agree: index forward from where we are. */
  | { action: 'continue' }
  /** The node gave a different hash for a height it has: rewind. */
  | { action: 'rewind' }
  /** Nothing was learned. Leave the index alone and ask again next tick. */
  | { action: 'wait'; reason: string };

/**
 * Whether the stored chain still agrees with the node, told apart from the
 * node being unable to say.
 *
 * A refusal and a different hash are not the same fact, and folding them
 * together is how a rollback deletes a chain that never reorged. `getblockhash`
 * above the node's own tip answers "Block height out of range" -- exactly what
 * a reindexing node says about every height it has not rebuilt yet -- and a
 * restart, a warmup (-28) or a request timeout raise an error too. Every one of
 * those arrives here as `nodeHash: null`, and null never decides anything.
 *
 * A node whose tip is below our own is refused before its hash is even
 * consulted: it is restarting, reindexing or still catching up, and a brief dip
 * during a real reorg resolves itself on the next tick.
 */
export function reorgVerdict(input: {
  indexedHeight: number;
  indexedHash: string;
  nodeTip: number;
  /** The node's hash at `indexedHeight`, or null when it did not answer. */
  nodeHash: string | null;
}): ReorgVerdict {
  const { indexedHeight, indexedHash, nodeTip, nodeHash } = input;

  if (nodeTip < indexedHeight) {
    return {
      action: 'wait',
      reason: `node tip ${nodeTip} is below the indexed height ${indexedHeight}`,
    };
  }
  if (nodeHash === null) {
    return { action: 'wait', reason: `no hash for the indexed height ${indexedHeight}` };
  }
  if (nodeHash === indexedHash) return { action: 'continue' };
  return { action: 'rewind' };
}

/** What one step of the rewind walk may conclude. */
export type RewindStep =
  /** Stored and node agree at this height: it is the fork point. */
  | { action: 'settle' }
  /** Disagreement, or nothing stored here: keep walking down. */
  | { action: 'step' }
  /**
   * Nothing was learned, or the disagreement is too deep to act on alone.
   * `needsOperator` marks the second case: waiting will not resolve it, and
   * the sync says so in the error it records.
   */
  | { action: 'wait'; reason: string; needsOperator?: boolean };

/**
 * One step of the walk back to the fork point.
 *
 * Only a hash the node actually gave, and that differs from the stored one,
 * moves the cursor. A height the node could not answer stops the walk instead
 * of stepping past it -- otherwise a node that stops answering mid-rewind walks
 * the cursor to -1 and the rollback deletes the entire index.
 *
 * A height with nothing stored is a hole in the index, not evidence of a fork;
 * the walk continues past it and the block loop fills it back in.
 */
export function rewindStep(input: {
  cursor: number;
  floor: number;
  storedHash: string | null;
  /** The node's hash at `cursor`, or null when it did not answer. */
  nodeHash: string | null;
}): RewindStep {
  const { cursor, floor, storedHash, nodeHash } = input;

  if (nodeHash === null) {
    return { action: 'wait', reason: `no hash for height ${cursor} while rewinding` };
  }
  if (storedHash !== null && storedHash === nodeHash) return { action: 'settle' };
  if (cursor - 1 < floor) {
    return {
      action: 'wait',
      needsOperator: true,
      reason:
        `the stored chain disagrees with the node for more than ${MAX_ROLLBACK_DEPTH} blocks ` +
        `above ${floor}; an operator has to confirm a rewind that deep`,
    };
  }
  return { action: 'step' };
}

export function quorumReorgReset(cursor: number): QuorumReorgReset {
  return {
    // Either the round's slot is above the fork point, or its commitment was
    // mined in a block that has just been rewound.
    filter: {
      $or: [{ expectedHeight: { $gt: cursor } }, { minedHeight: { $gt: cursor } }],
    },
    update: {
      $set: {
        status: 'pending',
        formed: false,
        quorumHash: null,
        minedBlockHash: null,
        minedHeight: null,
        effectiveSize: null,
        numValidMembers: null,
        healthRatio: null,
        members: [],
        invalidMembers: [],
        punishedCount: 0,
        // The round has not been resolved on this chain yet; keeping the old
        // timestamp would place a re-observed outcome at the wrong moment.
        resolvedAt: null,
      },
    },
  };
}

/** What the fork-point search learns about one height. */
export type ForkPointProbe =
  | { agrees: boolean }
  /** Nothing was learned here: the node did not answer, or nothing is stored. */
  | { undecidable: string };

export type ForkPointSearch =
  /** The highest height where the stored chain and the node agree. */
  | { outcome: 'found'; height: number; probes: number }
  /** They disagree at every height, genesis included: a different chain. */
  | { outcome: 'no-common-history'; probes: number }
  /** A height could not be compared; nothing is concluded. */
  | { outcome: 'undecidable'; reason: string; probes: number };

/**
 * The fork point by bisection, for the rewinds the walk refused.
 *
 * The automatic rollback walks down one block per RPC and gives up at
 * `MAX_ROLLBACK_DEPTH`; the operator who then has to confirm needs the fork
 * point of a disagreement that is hundreds of blocks deep at least, and one
 * call per block is the wrong tool for that. Bisection is sound because
 * agreement is monotone along a single fork: every height below the fork point
 * agrees, every height above it disagrees. The caller has established that
 * `indexedHeight` disagrees; -1 agrees by definition, there being nothing below
 * genesis to disagree about.
 *
 * The answer is the HIGHEST agreeing height, and the operator path insists on
 * exactly it. A deeper rewind is not merely wasteful: it resets quorum rounds
 * that `quorum listextended` can no longer describe, and those rows -- the
 * failed-round record this project exists for -- are then gone for good.
 *
 * Fail-closed: a height that cannot be compared stops the search rather than
 * being stepped over. A hole in the index or a node that stops answering is a
 * reason to look, not a reason to guess.
 */
export async function findForkPoint(
  indexedHeight: number,
  probe: (height: number) => Promise<ForkPointProbe>
): Promise<ForkPointSearch> {
  let agrees = -1;
  let disagrees = indexedHeight;
  let probes = 0;
  while (disagrees - agrees > 1) {
    const mid = Math.floor((agrees + disagrees) / 2);
    const answer = await probe(mid);
    probes++;
    if ('undecidable' in answer) {
      return { outcome: 'undecidable', reason: `height ${mid}: ${answer.undecidable}`, probes };
    }
    if (answer.agrees) agrees = mid;
    else disagrees = mid;
  }
  return agrees < 0
    ? { outcome: 'no-common-history', probes }
    : { outcome: 'found', height: agrees, probes };
}
