import mongoose, { Schema, type Document } from 'mongoose';
export interface SimulationLiveRunLockDocument extends Document {
  scope: 'devnet-live';
  status: 'held' | 'released';
  runKey: string | null;
  ownerId: string | null;
  acquiredAtMs: number | null;
  leaseUntilMs: number | null;
  releasedAtMs: number | null;
  revision: number;
  updatedAt: Date;
}

export const simulationLiveRunLockSchema = new Schema<SimulationLiveRunLockDocument>(
  {
    scope: { type: String, enum: ['devnet-live'], required: true, unique: true, immutable: true },
    status: { type: String, enum: ['held', 'released'], required: true },
    runKey: { type: String, default: null },
    ownerId: { type: String, default: null },
    acquiredAtMs: { type: Number, default: null, min: 0 },
    leaseUntilMs: { type: Number, default: null, min: 0 },
    releasedAtMs: { type: Number, default: null, min: 0 },
    revision: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true }, strict: 'throw', versionKey: false }
);

simulationLiveRunLockSchema.pre('validate', function validateLockShape() {
  if (
    this.status === 'held' &&
    (this.runKey === null ||
      this.ownerId === null ||
      this.acquiredAtMs === null ||
      this.leaseUntilMs === null ||
      this.leaseUntilMs <= this.acquiredAtMs)
  ) {
    this.invalidate('status', 'held lock requires a valid owner and future lease');
  }
  if (
    this.status === 'released' &&
    (this.runKey !== null ||
      this.ownerId !== null ||
      this.acquiredAtMs !== null ||
      this.leaseUntilMs !== null ||
      this.releasedAtMs === null)
  ) {
    this.invalidate('status', 'released lock must be a revisioned tombstone');
  }
});

export const SimulationLiveRunLock = mongoose.model<SimulationLiveRunLockDocument>(
  'SimulationLiveRunLock',
  simulationLiveRunLockSchema
);
