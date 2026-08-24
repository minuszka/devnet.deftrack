import mongoose, { Schema, type Document } from 'mongoose';

/**
 * When a particular host first saw a particular block or ChainLock.
 *
 * The seed node can say a block was late; it cannot say whether it was late
 * for everyone. Eight vantage points can, and that is the difference between
 * "the quorum is broken" and "one VPS is broken" -- a distinction that once
 * cost twenty unreachable masternodes and a ban wave that looked like data.
 *
 * Each row is one host's own claim, on its own clock, with the error it knew
 * about at the time. Nothing here is corrected on the way in: the correction
 * would be a guess, and the comparison is honest only if it can state its own
 * uncertainty.
 */
export interface PeerObservationDocument extends Document {
  /** `${host}:${topic}:${hash}` -- one row per host per event, replay-safe. */
  observationKey: string;

  /** Operator-facing label, not an address: the host list is not public. */
  host: string;
  topic: 'block' | 'chainlock';
  hash: string;
  height: number | null;

  /** The host's own clock when it saw the event. */
  receivedAt: Date;
  /** That host's NTP offset at the time, in milliseconds; null if unknown. */
  clockOffsetMs: number | null;
  /** The agent's timing resolution: a poll interval, or 0 for an event feed. */
  resolutionMs: number;

  agentVersion: string;
  /** When the explorer accepted it, for spotting a delayed or replayed push. */
  ingestedAt: Date;
}

const peerObservationSchema = new Schema<PeerObservationDocument>({
  observationKey: { type: String, required: true, unique: true },

  host: { type: String, required: true, index: true },
  topic: { type: String, enum: ['block', 'chainlock'], required: true, index: true },
  hash: { type: String, required: true, index: true },
  height: { type: Number, default: null, index: true },

  receivedAt: { type: Date, required: true, index: true },
  clockOffsetMs: { type: Number, default: null },
  resolutionMs: { type: Number, default: 0 },

  agentVersion: { type: String, default: 'unknown' },
  ingestedAt: { type: Date, default: () => new Date() },
});

// The comparison reads every host's sighting of one hash.
peerObservationSchema.index({ hash: 1, topic: 1, receivedAt: 1 });
// The laggard view walks recent events per host.
peerObservationSchema.index({ topic: 1, height: -1 });

// No TTL. Retention is at least 90 days by policy, and a propagation anomaly
// is exactly the thing someone wants to re-examine months later.

export const PeerObservation = mongoose.model<PeerObservationDocument>(
  'PeerObservation',
  peerObservationSchema
);
