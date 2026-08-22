import mongoose, { Schema, type Document } from 'mongoose';

/**
 * Network-level counts over time.
 *
 * The event log says which masternode changed and when; this says what the
 * network looked like at a moment. Drawing "80 -> 21 -> 80" from events alone
 * would mean replaying every transition, so the series is recorded directly.
 *
 * Written when a count changes, and otherwise on a slow heartbeat, so a quiet
 * network costs almost nothing while a collapse is captured at full detail.
 */
export interface MasternodeSnapshotDocument extends Document {
  at: Date;
  height: number;

  total: number;
  enabled: number;
  banned: number;

  penaltySum: number;
  penaltyMax: number;
  /** Masternodes carrying any penalty -- the leading edge of a wave. */
  penalised: number;

  /** min(profile size, enabled): what CalculateQuorum would return now. */
  effectiveQuorumSize: number | null;
  /** effectiveQuorumSize - minSize: what one round could punish right now. */
  maxPossibleBan: number | null;
}

const masternodeSnapshotSchema = new Schema<MasternodeSnapshotDocument>({
  at: { type: Date, required: true, index: true },
  height: { type: Number, required: true, index: true },

  total: { type: Number, required: true },
  enabled: { type: Number, required: true },
  banned: { type: Number, required: true },

  penaltySum: { type: Number, default: 0 },
  penaltyMax: { type: Number, default: 0 },
  penalised: { type: Number, default: 0 },

  effectiveQuorumSize: { type: Number, default: null },
  maxPossibleBan: { type: Number, default: null },
});

export const MasternodeSnapshot = mongoose.model<MasternodeSnapshotDocument>(
  'MasternodeSnapshot',
  masternodeSnapshotSchema
);
