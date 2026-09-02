/**
 * Who a DSL service commitment named, from the indices it carries.
 *
 * The commitment reports missed members as bit positions, not identities. The
 * node's own comment says an observer can "resolve WHO was missed against the
 * deterministic list at epochBlockHash", and the order it means is built in
 * `pose_service_sentinels.cpp`:
 *
 *     epochBaseList.ForEachMN(false, [&](const auto& dmn) {
 *         order.push_back(dmn.proTxHash);
 *     });
 *     std::sort(order.begin(), order.end());
 *
 * Both halves matter. The walk is over every registered masternode, banned
 * ones included, which `protx list registered` reproduces exactly. The sort is
 * on uint256, and uint256 compares its internal little-endian bytes -- the
 * reverse of the hex a proTxHash is printed as.
 *
 * Sorting the printed hex instead is the trap, because it fails plausibly
 * rather than obviously. On epoch 264 it resolved the five flagged indices to
 * five ENABLED masternodes spread across five hosts -- a coherent-looking
 * story about the DSL flagging different nodes than PoSe. The true order
 * resolves the same five indices to the five POSE_BANNED masternodes, all on
 * one host. One `std::sort` line separates a correct reading from a confident
 * wrong one, which is why the ordering lives here with a test rather than
 * inline at the call site.
 */

/** A proTxHash's bytes in uint256's internal order: the printed hex, reversed. */
function internalByteOrder(hex: string): string {
  let out = '';
  for (let i = hex.length - 2; i >= 0; i -= 2) out += hex.slice(i, i + 2);
  return out;
}

/**
 * The order the bitfield indexes, given every registered proTxHash at the
 * epoch base.
 *
 * Compared as plain strings rather than with localeCompare: the inputs are
 * fixed-width lowercase hex, so byte order and codepoint order agree, and a
 * collation that varies with the runtime's ICU build has no business deciding
 * a consensus reading.
 */
export function canonicalDslOrder(proTxHashes: readonly string[]): string[] {
  return [...proTxHashes]
    .map((hash) => ({ hash, key: internalByteOrder(hash.toLowerCase()) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry) => entry.hash);
}

/**
 * The proTxHashes a commitment's indices name, or null when they cannot be
 * resolved.
 *
 * Null rather than a partial answer, and it is the point of the function. A
 * list of a different length is not the list the commitment counted -- the
 * chain may have re-orged, or the height may be wrong -- and an index outside
 * it means the same. Either way the honest output is "unresolved": a partial
 * or shifted answer would name real masternodes as having failed when they did
 * not, which is worse than leaving the field empty.
 */
export function resolveMissedMembers(
  order: readonly string[],
  missedIndices: readonly number[],
  listSize: number
): string[] | null {
  if (order.length !== listSize) return null;
  for (const index of missedIndices) {
    if (!Number.isInteger(index) || index < 0 || index >= order.length) return null;
  }
  return missedIndices.map((index) => order[index]!);
}
