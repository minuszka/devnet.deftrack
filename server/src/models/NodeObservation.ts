import mongoose, { Schema, type Document } from 'mongoose';
import type { ZmqTopic } from '../domain/zmqTopics.js';

/**
 * Raw, timestamped ZMQ notifications, stored exactly as they arrived.
 *
 * Nothing here is interpreted. Everything shown on the dashboard is derived
 * from these rows and can be recomputed, so a later bug fix or a new hypothesis
 * changes the conclusion without rewriting the past -- which is the difference
 * between an instrument and a status page.
 *
 * This is what the poller could never provide: the node reports whether a block
 * is ChainLocked, never when the CLSIG arrived, so polling measures the poll
 * interval. `receivedAt` here is the moment our node handed us the event.
 */
export interface NodeObservationDocument extends Document {
  /** `${topic}:${hash ?? sequence}` -- one row per notification, restart-safe. */
  observationKey: string;

  topic: ZmqTopic;
  /** Block or transaction hash in RPC byte order; null for the sequence topic. */
  hash: string | null;
  /** Per-topic counter from the node; -1 when the frame was absent. */
  sequence: number;
  /** Verbatim payload, so a topic we do not yet interpret is not lost. */
  payloadHex: string;

  /** When this process received it. The measurement. */
  receivedAt: Date;
  /** When the derivation step consumed it; null while still pending. */
  appliedAt: Date | null;
}

const nodeObservationSchema = new Schema<NodeObservationDocument>({
  observationKey: { type: String, required: true, unique: true },

  topic: { type: String, required: true, index: true },
  hash: { type: String, default: null, index: true },
  sequence: { type: Number, default: -1 },
  payloadHex: { type: String, required: true },

  receivedAt: { type: Date, required: true, index: true },
  appliedAt: { type: Date, default: null },
});

// The derivation step asks for one topic's unapplied rows, oldest first.
nodeObservationSchema.index({ topic: 1, appliedAt: 1, receivedAt: 1 });

// No TTL. Raw observation is the archive; deriving from it later is the point.

export const NodeObservation = mongoose.model<NodeObservationDocument>(
  'NodeObservation',
  nodeObservationSchema
);
