import mongoose, { Schema, type Document } from 'mongoose';
import { simulationAuditActorSchema, type SimulationAuditActor } from './SimulationRun.js';

export const SIMULATION_CONTROL_OPERATIONS = [
  'create', 'validate', 'arm', 'start', 'abort', 'recover',
] as const;
export type SimulationControlOperation = (typeof SIMULATION_CONTROL_OPERATIONS)[number];
export type SimulationControlRole = 'operator' | 'safety-admin';

export interface SimulationControlRequestDocument extends Document {
  requestKey: string;
  operation: SimulationControlOperation;
  runKey: string | null;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  actor: SimulationAuditActor;
  role: SimulationControlRole;
  acceptedAtMs: number;
  createdAt: Date;
}

export const simulationControlRequestSchema = new Schema<SimulationControlRequestDocument>(
  {
    requestKey: { type: String, required: true, unique: true, immutable: true },
    operation: { type: String, enum: SIMULATION_CONTROL_OPERATIONS, required: true, immutable: true },
    runKey: { type: String, default: null, immutable: true },
    idempotencyKeyHash: { type: String, required: true, immutable: true },
    requestFingerprint: { type: String, required: true, immutable: true },
    actor: { type: simulationAuditActorSchema, required: true, immutable: true },
    role: { type: String, enum: ['operator', 'safety-admin'], required: true, immutable: true },
    acceptedAtMs: { type: Number, required: true, min: 0, immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw', versionKey: false }
);

simulationControlRequestSchema.index({ runKey: 1, acceptedAtMs: 1 });

const immutableError = (): Error => new Error('SimulationControlRequest is append-only');
simulationControlRequestSchema.pre('save', function denyResave() { if (!this.isNew) throw immutableError(); });
simulationControlRequestSchema.pre('updateOne', function denyUpdateOne() { throw immutableError(); });
simulationControlRequestSchema.pre('updateMany', function denyUpdateMany() { throw immutableError(); });
simulationControlRequestSchema.pre('findOneAndUpdate', function denyFindOneAndUpdate() { throw immutableError(); });
simulationControlRequestSchema.pre('findOneAndReplace', function denyFindOneAndReplace() { throw immutableError(); });
simulationControlRequestSchema.pre('replaceOne', function denyReplaceOne() { throw immutableError(); });
simulationControlRequestSchema.pre('deleteOne', function denyDeleteOne() { throw immutableError(); });
simulationControlRequestSchema.pre('deleteMany', function denyDeleteMany() { throw immutableError(); });
simulationControlRequestSchema.pre('findOneAndDelete', function denyFindOneAndDelete() { throw immutableError(); });
simulationControlRequestSchema.pre('bulkWrite', function denyBulkWrite() { throw immutableError(); });

export const SimulationControlRequest = mongoose.model<SimulationControlRequestDocument>(
  'SimulationControlRequest', simulationControlRequestSchema
);
