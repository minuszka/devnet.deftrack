/**
 * What changed in a quorum's membership since its previous round, and whether
 * that change accounts for the punishment the round recorded.
 *
 * A DKG session builds its own connections between the members it drew. A
 * member drawn in for the first time since the previous round therefore starts
 * with no mesh, and peers that never reach it vote it bad -- so the round
 * records punishment that says nothing about the profile, and nothing about
 * that member's own health either.
 *
 * CLAUDE.md records the canonical instance and warns against measuring it: 46
 * masternodes revived at height 2404 were drawn into the very next round, which
 * closed at health 0.16 with 42 members punished, and nothing was wrong with any
 * of them. The devnet produced it again at height 5904, where `llmq_400_60`
 * went from 80 members to 152 in one step and marked 59 bad; every one of the
 * 59 had joined since the previous round, no incumbent was touched, and the
 * next round of the same profile closed at 1.00 with 58 of those same 59 valid.
 *
 * This asks that question from the record instead of from memory, so a reader
 * of a 0.61 round does not have to already know what happened to interpret it.
 */

export interface ChurnRoundLike {
  expectedHeight: number;
  dkgInterval: number;
  effectiveSize: number | null;
  members: readonly { proTxHash: string }[];
  invalidMembers: readonly string[];
}

export interface MembershipChurn {
  /**
   * The height the preceding round of this profile was scheduled at. Always
   * computable -- rounds are scheduled every `dkgInterval` -- which is what
   * makes the lookup a single exact match rather than a scan.
   */
  previousExpectedHeight: number;
  /** null when no record of the preceding round exists. */
  previousEffectiveSize: number | null;
  /** effectiveSize - previousEffectiveSize; null when either side is unknown. */
  membershipDelta: number | null;
  /**
   * Members here that were absent from the preceding round, and members there
   * that are absent here. Both are null when the preceding round has no member
   * list to compare against -- a failed round mines no commitment, so it has
   * none, and treating that emptiness as "everybody is new" would manufacture
   * exactly the false reading this module exists to prevent.
   */
  joined: number | null;
  left: number | null;
  /** Of the members this round marked invalid, how many had just joined. */
  punishedJoiners: number | null;
  /**
   * Every member this round punished had joined since the preceding round, and
   * at least one member was punished. The round is then measuring a mesh still
   * forming rather than the profile, and its health is not comparable with the
   * rounds before it.
   *
   * Deliberately not a threshold on `membershipDelta`: a rotation that keeps
   * the size identical strands newcomers just as thoroughly as growth does, and
   * a size heuristic would miss it while inventing a cutoff nothing supports.
   */
  punishmentExplainedByJoiners: boolean;
}

const UNKNOWN = {
  previousEffectiveSize: null,
  membershipDelta: null,
  joined: null,
  left: null,
  punishedJoiners: null,
  punishmentExplainedByJoiners: false,
} as const;

export function membershipChurn(
  round: ChurnRoundLike,
  previous: ChurnRoundLike | null
): MembershipChurn {
  const previousExpectedHeight = round.expectedHeight - round.dkgInterval;
  if (previous === null) return { previousExpectedHeight, ...UNKNOWN };

  const membershipDelta =
    round.effectiveSize !== null && previous.effectiveSize !== null
      ? round.effectiveSize - previous.effectiveSize
      : null;

  // No member list to diff against: report the sizes, claim nothing about who
  // is new.
  if (previous.members.length === 0) {
    return {
      ...UNKNOWN,
      previousExpectedHeight,
      previousEffectiveSize: previous.effectiveSize,
      membershipDelta,
    };
  }

  const before = new Set(previous.members.map((m) => m.proTxHash));
  const now = new Set(round.members.map((m) => m.proTxHash));
  const joiners = new Set([...now].filter((id) => !before.has(id)));
  const punished = new Set(round.invalidMembers);
  const punishedJoiners = [...punished].filter((id) => joiners.has(id)).length;

  return {
    previousExpectedHeight,
    previousEffectiveSize: previous.effectiveSize,
    membershipDelta,
    joined: joiners.size,
    left: [...before].filter((id) => !now.has(id)).length,
    punishedJoiners,
    punishmentExplainedByJoiners: punished.size > 0 && punishedJoiners === punished.size,
  };
}

/**
 * The key a round's predecessor is looked up by. Exported so the query that
 * batches those lookups and the map it fills cannot drift apart.
 */
export function churnPredecessorKey(llmqName: string, expectedHeight: number): string {
  return `${llmqName}:${expectedHeight}`;
}
