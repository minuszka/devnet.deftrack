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
