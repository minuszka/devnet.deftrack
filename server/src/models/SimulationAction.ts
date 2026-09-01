import mongoose, { Schema, type Document } from 'mongoose';

export type SimulationActionStatus =
  | 'pending'
  | 'claimed'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'compensated';

export interface SimulationActionResult {
  code:
    | 'applied'
    | 'already-applied'
    | 'cleared'
    | 'already-clear'
    | 'guard-rejected'
    | 'target-unreachable'
    | 'wrapper-failed';
  publicMessage: string;
  privateDetail: string | null;
  wrapperVersion: string | null;
  finishedAtMs: number;
}

export interface SimulationActionDocument extends Document {
  actionId: string;
  runKey: string;
  sequence: number;
  targetId: string;
  kind: string;
  status: SimulationActionStatus;
  revision: number;
  /** Produced only by the code-owned registry; external input reaches it after day-4 validation. */
  payload: Record<string, unknown>;
  payloadDigest: string;
  notBeforeMs: number | null;
  expiresAtMs: number;
  attempts: number;
  maxAttempts: number;
  claimedBy: string | null;
  leaseUntilMs: number | null;
  claimedAtMs: number | null;
  executedAtMs: number | null;
  result: SimulationActionResult | null;
  createdAt: Date;
  updatedAt: Date;
}

const resultSchema = new Schema<SimulationActionResult>(
  {
    code: {
      type: String,
      enum: [
        'applied',
        'already-applied',
        'cleared',
        'already-clear',
        'guard-rejected',
        'target-unreachable',
        'wrapper-failed',
      ],
      required: true,
    },
    publicMessage: { type: String, required: true },
    privateDetail: { type: String, default: null },
    wrapperVersion: { type: String, default: null },
    finishedAtMs: { type: Number, required: true, min: 0 },
  },
  { _id: false, strict: 'throw' }
);

export const simulationActionSchema = new Schema<SimulationActionDocument>(
  {
    actionId: { type: String, required: true, unique: true, immutable: true },
    runKey: { type: String, required: true, immutable: true },
    sequence: { type: Number, required: true, min: 0, immutable: true },
    targetId: { type: String, required: true, immutable: true },
    kind: { type: String, required: true, immutable: true },
    status: {
      type: String,
      enum: ['pending', 'claimed', 'succeeded', 'failed', 'expired', 'compensated'],
      required: true,
      default: 'pending',
    },
    revision: { type: Number, required: true, min: 0, default: 0 },
    payload: { type: Schema.Types.Mixed, required: true, immutable: true },
    payloadDigest: { type: String, required: true, immutable: true },
    notBeforeMs: { type: Number, default: null, min: 0, immutable: true },
    expiresAtMs: { type: Number, required: true, min: 0, immutable: true },
    attempts: { type: Number, required: true, min: 0, default: 0 },
    maxAttempts: { type: Number, required: true, min: 1 },
    claimedBy: { type: String, default: null },
    leaseUntilMs: { type: Number, default: null, min: 0 },
    claimedAtMs: { type: Number, default: null, min: 0 },
    executedAtMs: { type: Number, default: null, min: 0 },
    result: { type: resultSchema, default: null },
  },
  { timestamps: true, strict: 'throw', versionKey: false }
);

simulationActionSchema.index({ runKey: 1, sequence: 1 }, { unique: true });
simulationActionSchema.index({ status: 1, notBeforeMs: 1, leaseUntilMs: 1 });
simulationActionSchema.index({ runKey: 1, status: 1 });

simulationActionSchema.pre('validate', function validateActionProjection() {
  if (this.notBeforeMs !== null && this.expiresAtMs <= this.notBeforeMs) {
    this.invalidate('expiresAtMs', 'action must expire after notBeforeMs');
  }
  if (this.status === 'claimed' && (this.claimedBy === null || this.leaseUntilMs === null)) {
    this.invalidate('status', 'claimed action requires an owner and lease');
  }
});

export const SimulationAction = mongoose.model<SimulationActionDocument>(
  'SimulationAction',
  simulationActionSchema
);
