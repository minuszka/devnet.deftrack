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

  detectedAt: { type: Date, default: () => new Date() },
});

// The convergence view reads newest-first and splits by outcome.
serviceEpochSchema.index({ boundaryHeight: -1, status: 1 });

export const ServiceEpoch = mongoose.model<ServiceEpochDocument>(
  'ServiceEpoch',
  serviceEpochSchema
);
