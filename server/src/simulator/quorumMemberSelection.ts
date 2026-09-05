import { createHash } from 'node:crypto';

/**
 * The node's quorum member selection, reproduced bit for bit.
 *
 * `CDeterministicMNList::CalculateQuorum` (src/evo/deterministicmns.cpp) scores
 * every valid, confirmed masternode with a single SHA256 over
 * `confirmedHashWithProRegTxHash || modifier`, sorts the scores descending as
 * 256-bit little-endian integers and keeps the first `size`. The modifier for a
 * non-rotated profile on a chain where v20 is not active is
 * `SerializeHash(pair<LLMQType, cycleBaseBlockHash>)` -- a double SHA256 over
 * one type byte followed by the 32 internal-order bytes of the block hash
 * (`GetHashModifier`, src/llmq/utils.cpp). `confirmedHashWithProRegTxHash` is
 * a single SHA256 over `proTxHash || confirmedHash`
 * (`CDeterministicMNState::UpdateConfirmedHash`, src/evo/dmnstate.h).
 *
 * Why this exists: the member list of a quorum whose DKG is running is not
 * available from any RPC on a non-masternode -- `quorum info` answers only
 * once the commitment is mined, and the node's own `quorum dkginfo` prediction
 * refuses below v20 because the cycle base block hash is the input. Once that
 * block is mined the selection is a pure function of the chain, so the
 * explorer can name the forming quorum's members without guessing.
 *
 * Scope, deliberately narrow: non-rotated profiles, v20 not active. That is
 * every chain this tree runs -- `V20Height` is `numeric_limits<int>::max()` on
 * mainnet, testnet and devnet (src/chainparams.cpp) and no profile in
 * src/llmq/params.h sets `useRotation`. Above v20 the modifier takes the
 * coinbase ChainLock signature of the work block eight blocks earlier, a path
 * this module does not reproduce and therefore refuses. Verified against four
 * formed devnet quorums, member order included, in the fixture beside the test.
 */

export interface QuorumSelectionMasternode {
  proTxHash: string;
  /** The block hash the node confirmed the registration at; all zeros = unconfirmed. */
  confirmedHash: string;
  /** `!IsBanned()` -- neither PoSe-banned nor DSL-banned in the list at the base block. */
  isValid: boolean;
  /**
   * Tie-break the node applies when two scores are equal (which it comments
   * "should actually never happen"). Optional because `protx diff` does not
   * report it; when two scores do collide and neither side carries the
   * outpoint the selection refuses rather than picking arbitrarily.
   */
  collateral?: { hash: string; index: number } | null;
}

export interface QuorumSelectionInput {
  llmqType: number;
  size: number;
  useRotation: boolean;
  /** Hash of the block at `cycleBaseHeight` in RPC display order (as `getblockhash` prints it). */
  cycleBaseBlockHash: string;
  /** Whether v20 is active at the work block; refused when true. */
  v20Active: boolean;
  /** The masternode list as the node holds it *after* connecting the base block. */
  masternodes: readonly QuorumSelectionMasternode[];
}

const HEX_64 = /^[0-9a-f]{64}$/i;
const NULL_HASH = '0'.repeat(64);

function sha256(...parts: readonly Buffer[]): Buffer {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/** RPC display order is the byte-reversed internal `uint256`; the node hashes internal bytes. */
export function internalBytes(displayHex: string): Buffer {
  if (!HEX_64.test(displayHex)) throw new Error(`not a 32-byte hash: ${displayHex}`);
  return Buffer.from(displayHex, 'hex').reverse();
}

/** `arith_uint256` comparison: the internal buffer is little-endian, so the last byte is the most significant. */
export function compareArith256(left: Buffer, right: Buffer): number {
  for (let i = 31; i >= 0; i -= 1) {
    if (left[i] !== right[i]) return (left[i] as number) - (right[i] as number);
  }
  return 0;
}

/** `uint256::operator<` is `memcmp` over the internal bytes -- lexicographic from byte 0, not numeric. */
function compareBlob256(left: Buffer, right: Buffer): number {
  return Buffer.compare(left, right);
}

export function confirmedHashWithProRegTxHash(proTxHash: string, confirmedHash: string): Buffer {
  return sha256(internalBytes(proTxHash), internalBytes(confirmedHash));
}

/** `SerializeHash(std::make_pair(llmqType, cycleBaseBlockHash))`: SHA256d over one type byte and the internal hash bytes. */
export function quorumSelectionModifier(llmqType: number, cycleBaseBlockHash: string): Buffer {
  if (!Number.isInteger(llmqType) || llmqType < 0 || llmqType > 0xff) {
    throw new Error(`llmqType is not a uint8: ${llmqType}`);
  }
  const serialized = Buffer.concat([Buffer.from([llmqType]), internalBytes(cycleBaseBlockHash)]);
  return sha256(sha256(serialized));
}

export interface QuorumSelectionScore {
  proTxHash: string;
  score: Buffer;
  collateral: { hash: string; index: number } | null;
}

/** Score every eligible masternode; unconfirmed and banned ones are never scored, exactly as `CalculateScores` skips them. */
export function scoreQuorumCandidates(
  masternodes: readonly QuorumSelectionMasternode[],
  modifier: Buffer
): QuorumSelectionScore[] {
  const seen = new Set<string>();
  const scores: QuorumSelectionScore[] = [];
  for (const mn of masternodes) {
    const proTxHash = mn.proTxHash.toLowerCase();
    if (!HEX_64.test(proTxHash)) throw new Error(`masternode proTxHash is invalid: ${mn.proTxHash}`);
    if (seen.has(proTxHash)) throw new Error(`masternode list contains ${proTxHash} twice`);
    seen.add(proTxHash);
    if (!mn.isValid) continue;
    const confirmedHash = mn.confirmedHash.toLowerCase();
    if (!HEX_64.test(confirmedHash)) throw new Error(`masternode confirmedHash is invalid: ${mn.confirmedHash}`);
    if (confirmedHash === NULL_HASH) continue;
    scores.push({
      proTxHash,
      score: sha256(confirmedHashWithProRegTxHash(proTxHash, confirmedHash), modifier),
      collateral: mn.collateral ?? null,
    });
  }
  return scores;
}

/**
 * The node sorts ascending and reads the vector backwards, which is a
 * descending sort by score with the *ascending* collateral outpoint order kept
 * for equal scores. Written here directly as the descending comparator.
 */
export function compareQuorumScores(left: QuorumSelectionScore, right: QuorumSelectionScore): number {
  const byScore = compareArith256(right.score, left.score);
  if (byScore !== 0) return byScore;
  if (left.collateral === null || right.collateral === null) {
    throw new Error(
      `two masternodes scored equally (${left.proTxHash}, ${right.proTxHash}) and the collateral tie-break is unavailable`
    );
  }
  const byHash = compareBlob256(internalBytes(right.collateral.hash), internalBytes(left.collateral.hash));
  if (byHash !== 0) return byHash;
  return right.collateral.index - left.collateral.index;
}

/**
 * The members of the quorum whose base block is `cycleBaseBlockHash`, in the
 * node's own order -- the same order `quorum info` lists them in once the
 * commitment is mined.
 */
export function selectQuorumMembers(input: QuorumSelectionInput): string[] {
  if (input.useRotation) {
    throw new Error('rotated quorum member selection is not reproduced here');
  }
  if (input.v20Active) {
    throw new Error('post-v20 quorum member selection (ChainLock-signature modifier) is not reproduced here');
  }
  if (!Number.isInteger(input.size) || input.size < 1) throw new Error(`quorum size is invalid: ${input.size}`);
  const modifier = quorumSelectionModifier(input.llmqType, input.cycleBaseBlockHash);
  const scores = scoreQuorumCandidates(input.masternodes, modifier);
  scores.sort(compareQuorumScores);
  return scores.slice(0, Math.min(input.size, scores.length)).map((entry) => entry.proTxHash);
}
