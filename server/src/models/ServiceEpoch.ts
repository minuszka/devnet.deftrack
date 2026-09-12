import mongoose, { Schema, type Document } from 'mongoose';

/**
 * One row per DSL observation epoch whose boundary block has been indexed.
 *
 * The Sentinel Layer's shadow phase exists to measure pool convergence, and
 * the measurement is exactly this collection: a boundary carrying a
 * commitment is a converged epoch, a boundary without one is the datum the
 * design calls fail-open -- the quorum did not converge on a report set, or
 * the block producer's pool did not reproduce the signed hash. Neither is a
 * chain fault, and no masternode is penalised by an absent row; recording it
 * is the whole point.
 *
 * Rows are written at block index time, when the verdict is already final: a
 * commitment is a transaction in the boundary block or it is nowhere. There
 * is no observation window to age out of, so unlike the DKG rounds there is
 * no `pending` state -- a boundary not yet indexed simply has no row.
 */
export interface ServiceEpochDocument extends Document {
  /** `dsl:${epoch}` -- one row per observation epoch. */
  epochKey: string;
  /** The observation epoch this row describes. */
  epoch: number;
  /** The boundary block that carried -- or lacked -- the commitment. */
  boundaryHeight: number;
  boundaryBlockHash: string;

  status: 'committed' | 'absent';

  /** Commitment payload; null on absent rows. */
  txid: string | null;
  /** The epoch's first block, the one sentinel selection was keyed on. */
  epochBlockHash: string | null;
  llmqType: number | null;
  quorumHash: string | null;
  missedCount: number | null;
  /** How many masternodes the bitfield covered -- the canonical list size. */
  listSize: number | null;
  /**
   * Set bits by canonical index into the deterministic list at
   * epochBlockHash, sorted by proTxHash. Resolution to proTxHashes needs that
   * list and is done at read time, not here.
   */
  missedIndices: number[];
  /**
   * The members those indices name, resolved against the deterministic list at
   * the epoch base. Empty when nothing was missed, and also when the indices
   * could not be resolved -- the resolver refuses a partial answer rather than
   * accuse the wrong masternodes.
   */
  missedProTxHashes: string[];

  /**
   * The commitment's own format version. Null on absent rows, and null on rows
   * written before this field existed; `ops/backfill-epoch-observed.cjs` fills
   * those from the chain rather than assuming them.
   */
  commitmentVersion: number | null;
  /**
   * How many of the epoch's masternodes the pool reached a verdict on at all.
   *
   * This is the distinction format version 2 exists to make, and storing only
   * `missedCount` collapses it: a masternode nobody reported on is not a
   * masternode seen online, and until this field existed the explorer showed
   * the two identically -- the "no evidence heals" reading the format was
   * changed to end. The node emits it for version 1 as well, in the same shape
   * (everyone observed, nobody unobserved), so nothing here branches on the
   * version -- `CPoSeServiceCommitment::ToJson`, evo/pose_service.h.
   */
  observedCount: number | null;
  /** Canonical indices the commitment reached no verdict on; empty under v1. */
  unobservedIndices: number[];
  /**
   * Those indices resolved against the same epoch-base list as
   * `missedProTxHashes`, by the same resolver and with the same refusal: an
   * unresolvable list stays empty rather than naming the wrong masternodes.
   */
  unobservedProTxHashes: string[];

  detectedAt: Date;
}

const serviceEpochSchema = new Schema<ServiceEpochDocument>({
  epochKey: { type: String, required: true, unique: true },
  epoch: { type: Number, required: true, index: true },
  boundaryHeight: { type: Number, required: true, index: true },
  boundaryBlockHash: { type: String, required: true },

  status: { type: String, enum: ['committed', 'absent'], required: true },

  txid: { type: String, default: null },
  epochBlockHash: { type: String, default: null },
  llmqType: { type: Number, default: null },
  quorumHash: { type: String, default: null },
  missedCount: { type: Number, default: null },
  listSize: { type: Number, default: null },
  missedIndices: { type: [Number], default: [] },
  missedProTxHashes: { type: [String], default: [] },

  commitmentVersion: { type: Number, default: null },
  observedCount: { type: Number, default: null },
  unobservedIndices: { type: [Number], default: [] },
  unobservedProTxHashes: { type: [String], default: [] },

  detectedAt: { type: Date, default: () => new Date() },
});

// The convergence view reads newest-first and splits by outcome.
serviceEpochSchema.index({ boundaryHeight: -1, status: 1 });

export const ServiceEpoch = mongoose.model<ServiceEpochDocument>(
  'ServiceEpoch',
  serviceEpochSchema
);
