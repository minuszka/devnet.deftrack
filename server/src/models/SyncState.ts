import mongoose, { Schema, type Document } from 'mongoose';

/**
 * A rewind an operator confirmed past the automatic depth: who, when, to
 * where, and what it cost. The automatic rewinds are routine and only logged;
 * this one deleted more history than the sync would delete on its own, so it
 * is kept on the cursor it moved.
 */
export interface OperatorRewind {
  height: number;
  hash: string;
  depth: number;
  droppedBlocks: number;
  actor: string;
  at: Date;
}

export interface SyncStateDocument extends Document {
  key: string;
  lastSyncedHeight: number;
  lastSyncedHash: string;
  lastSyncedAt: Date;
  isRunning: boolean;
  heartbeatAt: Date | null;
  error: string | null;
  /** The last operator-confirmed rewind; null until one has happened. */
  operatorRewind: OperatorRewind | null;
}

const syncStateSchema = new Schema<SyncStateDocument>({
  key: { type: String, required: true, unique: true, default: 'blocks' },
  // -1 means "nothing indexed yet"; height 0 is a real block.
  lastSyncedHeight: { type: Number, default: -1 },
  lastSyncedHash: { type: String, default: '' },
  lastSyncedAt: { type: Date, default: Date.now },
  isRunning: { type: Boolean, default: false },
  heartbeatAt: { type: Date, default: null },
  error: { type: String, default: null },
  operatorRewind: {
    type: new Schema<OperatorRewind>(
      {
        height: { type: Number, required: true },
        hash: { type: String, required: true },
        depth: { type: Number, required: true },
        droppedBlocks: { type: Number, required: true },
        actor: { type: String, required: true },
        at: { type: Date, required: true },
      },
      { _id: false }
    ),
    default: null,
  },
});

export const SyncState = mongoose.model<SyncStateDocument>('SyncState', syncStateSchema);
