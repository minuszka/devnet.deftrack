/**
 * How many masternodes a mined quorum commitment punished.
 *
 * Core punishes every SELECTED member whose validMembers bit is false
 * (`if (!qc.validMembers[i]) PoSePunish(...)`), so the count is the selected
 * size minus validMembersCount. Two traps live here, and both have already
 * produced a wrong number on this explorer:
 *
 *  - It is NOT signersCount minus validMembersCount. Signers measure who signed
 *    the final commitment, and signersCount <= validMembersCount, so that
 *    formula reported zero straight through real punishment.
 *  - The selected size is NOT the profile's nominal size. A quorum can only draw
 *    from the masternodes that exist: llmq_400_60 nominally seats 400 and forms
 *    with 80 on this devnet. Using 400 would report a perfectly healthy quorum
 *    as 320 members punished.
 *
 * The commitment's validMembers bitfield carries one bit per selected member,
 * so its byte length bounds the real size; the smaller of that bound and the
 * profile size is the best figure available at index time. Byte alignment makes
 * it exact for a full quorum and for any size that is a multiple of 8, and
 * otherwise it can overstate by at most 7 -- which is why the authoritative
 * punishment figure remains the one QuorumRound derives from the observed
 * member list.
 */
export function selectedQuorumSize(
  profileSize: number | null | undefined,
  validMembersHex: string | null | undefined
): number | null {
  const bitfieldBits =
    typeof validMembersHex === 'string' && validMembersHex.length > 0
      ? Math.floor(validMembersHex.length / 2) * 8
      : null;
  if (profileSize === null || profileSize === undefined) return null;
  return bitfieldBits === null ? profileSize : Math.min(profileSize, bitfieldBits);
}

export function commitmentPunishedCount(
  validMembersCount: number,
  selectedSize: number | null
): number {
  // A null commitment -- the failed-DKG marker -- carries zero valid members and
  // punishes nobody: Core's punishment loop is guarded on a non-null commitment.
  if (validMembersCount === 0 || selectedSize === null) return 0;
  return Math.max(0, selectedSize - validMembersCount);
}
