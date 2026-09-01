/**
 * How many masternodes a mined quorum commitment punished.
 *
 * Core's rule, from CDeterministicMNManager::HandleQuorumCommitment:
 *
 *   auto members = GetAllQuorumMembers(...);
 *   for (size_t i = 0; i < members.size(); i++) {
 *       if (!mnList.HasMN(members[i]->proTxHash)) continue;
 *       if (!qc.validMembers[i]) PoSePunish(members[i]->proTxHash, ...);
 *   }
 *
 * So the count is the SELECTED MEMBER COUNT minus validMembersCount. Three
 * traps live here, and each has already produced a wrong number on this
 * explorer:
 *
 *  - It is NOT signersCount minus validMembersCount. Signers measure who signed
 *    the final commitment, a different set, so that formula reported zero
 *    straight through real punishment wherever every member happened to sign.
 *  - It is NOT the profile's nominal size. A quorum only draws from the
 *    masternodes that exist: llmq_400_60 nominally seats 400 and forms with 80
 *    here, so the profile size would report a healthy quorum as 320 punished.
 *  - It is NOT derivable from the validMembers bitfield either. That bitfield is
 *    allocated at the PROFILE size (`validMembers(params.size)` in
 *    llmq/commitment.cpp), so it is 400 bits wide for an 80-member quorum. Its
 *    length says nothing about how many members were selected.
 *
 * The only honest source is the member list itself, which `quorum info` returns
 * and which resolves for historical quorums too. When it cannot be resolved the
 * answer is null -- unknown -- never a guess.
 */
export function commitmentPunishedCount(
  validMembersCount: number,
  memberCount: number | null
): number | null {
  if (memberCount === null) return null;
  // A null commitment -- the failed-DKG marker -- carries zero valid members and
  // punishes nobody: Core's punishment loop is guarded on a non-null commitment.
  if (validMembersCount === 0) return 0;
  return Math.max(0, memberCount - validMembersCount);
}
