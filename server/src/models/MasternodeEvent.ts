import mongoose, { Schema, type Document } from 'mongoose';

export type MasternodeEventType =
  | 'registered'
  | 'banned'
  | 'revived'
  | 'penalty_up'
  | 'penalty_down'
  | 'service_changed'
  | 'removed'
  | 'key_changed'
  | 'revoked';

/**
 * Append-only log of every masternode state transition.
 *
 * This is the collection that did not exist when 59 of 80 masternodes were
 * banned and revived within an hour: the event happened, and afterwards there
 * was no way to say when it started, how fast it spread, or which hosts went
 * first. Nothing here is ever overwritten.
 */
export interface MasternodeEventDocument extends Document {
  /**
   * Idempotency key, the audited pattern from the production ban collector:
   * a unique index plus $setOnInsert, so a poller restart cannot duplicate a
   * transition it already recorded.
   */
  eventKey: string;

  proTxHash: string;
  type: MasternodeEventType;
  /** Chain height the transition was attributed to. */
  height: number;

  penaltyBefore: number | null;
  penaltyAfter: number | null;
  serviceBefore: string | null;
  serviceAfter: string | null;

  operatorLabel: string | null;
  hostIp: string | null;

  /** Reason the node itself gave, on a ProUpRevTx. */
  revocationReason: number | null;
  /**
   * Where the transition was seen.
   *
   * 'listdiff' is chain-derived and exact to the block; 'poll' is a comparison
   * of two snapshots, dated to when the poller happened to look. Mixing the two
   * without saying which is which would make a timing claim the data cannot
   * support.
   */
  source: 'listdiff' | 'poll';

  detectedAt: Date;
}

const masternodeEventSchema = new Schema<MasternodeEventDocument>({
  eventKey: { type: String, required: true, unique: true },

  proTxHash: { type: String, required: true, index: true },
  type: { type: String, required: true, index: true },
  height: { type: Number, required: true, index: true },

  penaltyBefore: { type: Number, default: null },
  penaltyAfter: { type: Number, default: null },
  serviceBefore: { type: String, default: null },
  serviceAfter: { type: String, default: null },

  operatorLabel: { type: String, default: null, index: true },
  hostIp: { type: String, default: null, index: true },

  revocationReason: { type: Number, default: null },
  source: { type: String, enum: ['listdiff', 'poll'], default: 'poll', index: true },

  detectedAt: { type: Date, default: () => new Date(), index: true },
});

// Ban-wave clustering reads events of one type ordered in time.
masternodeEventSchema.index({ type: 1, detectedAt: -1 });

// No TTL. The production noise TTL was shorter than the ban window, which made
// a real mainnet fork impossible to correlate afterwards.

export const MasternodeEvent = mongoose.model<MasternodeEventDocument>(
  'MasternodeEvent',
  masternodeEventSchema
);
