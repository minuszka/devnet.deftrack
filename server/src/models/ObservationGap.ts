import mongoose, { Schema, type Document } from 'mongoose';
import type { ZmqTopic } from '../domain/zmqTopics.js';

/**
 * A stretch of ZMQ messages the node published and we never received.
 *
 * The PUB socket drops silently at its high-water mark, and a subscriber that
 * reconnects misses everything published while it was away. Without this row a
 * ChainLock we failed to see is indistinguishable from a ChainLock that never
 * happened -- and this project exists to tell those two apart.
 *
 * A gap is not an error to be hidden; it is a stated limit on what the data can
 * support, and the reconciliation poller is what fills it in.
 */
export interface ObservationGapDocument extends Document {
  topic: ZmqTopic;
  /** First and last sequence number that never arrived, inclusive. */
  from: number;
  to: number;
  missed: number;
  detectedAt: Date;
}

const observationGapSchema = new Schema<ObservationGapDocument>({
  topic: { type: String, required: true, index: true },
  from: { type: Number, required: true },
  to: { type: Number, required: true },
  missed: { type: Number, required: true },
  detectedAt: { type: Date, default: () => new Date(), index: true },
});

observationGapSchema.index({ topic: 1, from: 1, to: 1 }, { unique: true });

export const ObservationGap = mongoose.model<ObservationGapDocument>(
  'ObservationGap',
  observationGapSchema
);
