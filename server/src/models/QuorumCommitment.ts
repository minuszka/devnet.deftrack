import mongoose, { Schema, type Document } from 'mongoose';

/**
 * Every quorum commitment mined on this chain, whatever its type.
 *
 * The explorer measures one profile -- the ChainLock quorum -- but the chain
 * runs several, and PoSe punishment comes from whichever quorum a masternode
 * failed. Without this the PoSe view can say who was punished and never who
 * punished them, which is how 46 bans were read as a fault in the measured
 * quorum while that quorum was sitting at 80 out of 80 valid members.
 *
 * Read straight out of the block at index time: a commitment is a transaction
 * of type 6, and blocks are already fetched whole.
 */
export interface QuorumCommitmentDocument extends Document {
  /** `${llmqType}:${quorumHeight}:${quorumHash}` -- one row per commitment. */
  commitmentKey: string;

  /** Consensus::LLMQType. Names come from config, which may not know them all. */
  llmqType: number;
  llmqName: string | null;
  quorumHash: string | null;
  /** The height the quorum was formed for. */
  quorumHeight: number;

  /** Where the commitment was mined -- not the same as quorumHeight. */
  minedHeight: number;
  minedBlockHash: string;

  /**
   * Members the commitment accepted, and the size it was built from.
   *
   * A null commitment -- a DKG that failed outright -- mines with zero valid
   * members and punishes nobody, which is the distinction the whole project
   * exists to draw.
   */
  validMembersCount: number;
  signersCount: number;
  /**
   * How many members this commitment punished: profile size minus
   * validMembersCount for a formed commitment, zero for a null one -- Core
   * punishes every selected member whose validMembers bit is false, and its
   * punishment loop is guarded on a non-null commitment. (Not
   * signersCount-based: signers measure who signed the final commitment, and
   * signersCount <= validMembersCount made that formula report zero through
   * real punishment.)
   */
  /**
   * Selected members minus validMembersCount -- the figure Core punishes over.
   * Null when the quorum member list could not be resolved: unknown is a real
   * answer here, and better than a fabricated count.
   */
  punishedCount: number | null;
  /**
   * When the member list was last resolved, or null while it never has been.
   *
   * A commitment indexed at the tip asks the node about a quorum the node is
   * still building -- the block notification runs ahead of the quorum cache by
   * a few hundred milliseconds -- and a null written then is not an answer,
   * it is a question asked too early. These three fields let the sync come
   * back for it, on the same schedule the payee backfill uses.
   */
  memberCountCheckedAt: Date | null;
  memberCountAttempts: number;
  memberCountRetryAt: Date | null;
  detectedAt: Date;
}

const quorumCommitmentSchema = new Schema<QuorumCommitmentDocument>({
  commitmentKey: { type: String, required: true, unique: true },

  llmqType: { type: Number, required: true, index: true },
  llmqName: { type: String, default: null },
  quorumHash: { type: String, default: null },
  quorumHeight: { type: Number, required: true, index: true },

  minedHeight: { type: Number, required: true, index: true },
  minedBlockHash: { type: String, required: true },

  validMembersCount: { type: Number, default: 0 },
  signersCount: { type: Number, default: 0 },
  punishedCount: { type: Number, default: null },
  memberCountCheckedAt: { type: Date, default: null },
  memberCountAttempts: { type: Number, default: 0 },
  memberCountRetryAt: { type: Date, default: null },

  detectedAt: { type: Date, default: () => new Date() },
});

// The PoSe view asks "what was mined at the height these bans landed".
quorumCommitmentSchema.index({ minedHeight: -1, llmqType: 1 });
// The member-count backfill asks "which rows are still unanswered", newest first.
quorumCommitmentSchema.index({ memberCountCheckedAt: 1, punishedCount: 1, minedHeight: -1 });

export const QuorumCommitment = mongoose.model<QuorumCommitmentDocument>(
  'QuorumCommitment',
  quorumCommitmentSchema
);
