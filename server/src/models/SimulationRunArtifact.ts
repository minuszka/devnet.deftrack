import mongoose, { Schema, type Document } from 'mongoose';
import { simulationAuditActorSchema, type SimulationAuditActor } from './SimulationRun.js';
import type { SimulationControlRole } from './SimulationControlRequest.js';

export const SIMULATION_ARTIFACT_KINDS = ['dry-run', 'preflight', 'approval'] as const;
export type SimulationArtifactKind = (typeof SIMULATION_ARTIFACT_KINDS)[number];

export interface SimulationRunArtifactDocument extends Document {
  artifactId: string;
  runKey: string;
  kind: SimulationArtifactKind;
  requestKey: string;
  payloadFingerprint: string;
  payload: Record<string, unknown>;
  actor: SimulationAuditActor;
  role: SimulationControlRole;
  atMs: number;
  createdAt: Date;
}

export const simulationRunArtifactSchema = new Schema<SimulationRunArtifactDocument>(
  {
    artifactId: { type: String, required: true, unique: true, immutable: true },
    runKey: { type: String, required: true, immutable: true },
    kind: { type: String, enum: SIMULATION_ARTIFACT_KINDS, required: true, immutable: true },
    requestKey: { type: String, required: true, immutable: true },
    payloadFingerprint: { type: String, required: true, immutable: true },
    payload: { type: Schema.Types.Mixed, required: true, immutable: true },
    actor: { type: simulationAuditActorSchema, required: true, immutable: true },
    role: { type: String, enum: ['operator', 'safety-admin'], required: true, immutable: true },
    atMs: { type: Number, required: true, min: 0, immutable: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw', versionKey: false }
);

simulationRunArtifactSchema.index({ runKey: 1, kind: 1, atMs: -1 });
simulationRunArtifactSchema.index({ runKey: 1, requestKey: 1, kind: 1 }, { unique: true });

const immutableError = (): Error => new Error('SimulationRunArtifact is append-only');
simulationRunArtifactSchema.pre('save', function denyResave() { if (!this.isNew) throw immutableError(); });
simulationRunArtifactSchema.pre('updateOne', function denyUpdateOne() { throw immutableError(); });
simulationRunArtifactSchema.pre('updateMany', function denyUpdateMany() { throw immutableError(); });
simulationRunArtifactSchema.pre('findOneAndUpdate', function denyFindOneAndUpdate() { throw immutableError(); });
simulationRunArtifactSchema.pre('findOneAndReplace', function denyFindOneAndReplace() { throw immutableError(); });
simulationRunArtifactSchema.pre('replaceOne', function denyReplaceOne() { throw immutableError(); });
simulationRunArtifactSchema.pre('deleteOne', function denyDeleteOne() { throw immutableError(); });
simulationRunArtifactSchema.pre('deleteMany', function denyDeleteMany() { throw immutableError(); });
simulationRunArtifactSchema.pre('findOneAndDelete', function denyFindOneAndDelete() { throw immutableError(); });
simulationRunArtifactSchema.pre('bulkWrite', function denyBulkWrite() { throw immutableError(); });

export const SimulationRunArtifact = mongoose.model<SimulationRunArtifactDocument>(
  'SimulationRunArtifact', simulationRunArtifactSchema
);
