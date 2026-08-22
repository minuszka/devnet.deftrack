import mongoose, { Schema, type Document } from 'mongoose';

export interface SyncStateDocument extends Document {
  key: string;
  lastSyncedHeight: number;
  lastSyncedHash: string;
  lastSyncedAt: Date;
  isRunning: boolean;
  heartbeatAt: Date | null;
  error: string | null;
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
});

export const SyncState = mongoose.model<SyncStateDocument>('SyncState', syncStateSchema);
