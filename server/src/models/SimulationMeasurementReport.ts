import mongoose, { Schema, type Document } from 'mongoose';
import type { SimulationMeasurementReport } from '../simulator/simulationMeasurement.js';

export interface SimulationMeasurementAnchor {
  faultStartHeight: number;
  faultStartBlockHash: string;
  faultEndHeight: number;
  faultEndBlockHash: string;
}

export interface SimulationMeasurementReportDocument extends Document {
  reportId: string;
  runKey: string;
  anchor: SimulationMeasurementAnchor;
  evidenceFingerprint: string;
  reportFingerprint: string;
  report: SimulationMeasurementReport;
  generatedAtMs: number;
  createdAt: Date;
}

const anchorSchema = new Schema<SimulationMeasurementAnchor>({
  faultStartHeight: { type: Number, required: true, min: 0, immutable: true },
  faultStartBlockHash: { type: String, required: true, immutable: true },
  faultEndHeight: { type: Number, required: true, min: 0, immutable: true },
  faultEndBlockHash: { type: String, required: true, immutable: true },
}, { _id: false, strict: 'throw' });

export const simulationMeasurementReportSchema = new Schema<SimulationMeasurementReportDocument>({
  reportId: { type: String, required: true, unique: true, immutable: true },
  runKey: { type: String, required: true, immutable: true },
  anchor: { type: anchorSchema, required: true, immutable: true },
  evidenceFingerprint: { type: String, required: true, immutable: true },
  reportFingerprint: { type: String, required: true, immutable: true },
  // The report is produced only by the typed measurement service. Keeping the
  // aggregate as one immutable value makes its own fingerprint meaningful.
  report: { type: Schema.Types.Mixed, required: true, immutable: true },
  generatedAtMs: { type: Number, required: true, min: 0, immutable: true },
}, { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw', versionKey: false });

simulationMeasurementReportSchema.index({ runKey: 1, generatedAtMs: -1 });
simulationMeasurementReportSchema.index({
  runKey: 1,
  'anchor.faultStartHeight': 1,
  'anchor.faultEndHeight': 1,
}, { unique: true });

const immutableError = (): Error => new Error('SimulationMeasurementReport is append-only');
simulationMeasurementReportSchema.pre('save', function denyResave() { if (!this.isNew) throw immutableError(); });
simulationMeasurementReportSchema.pre('updateOne', function denyUpdateOne() { throw immutableError(); });
simulationMeasurementReportSchema.pre('updateMany', function denyUpdateMany() { throw immutableError(); });
simulationMeasurementReportSchema.pre('findOneAndUpdate', function denyFindOneAndUpdate() { throw immutableError(); });
simulationMeasurementReportSchema.pre('findOneAndReplace', function denyFindOneAndReplace() { throw immutableError(); });
simulationMeasurementReportSchema.pre('replaceOne', function denyReplaceOne() { throw immutableError(); });
simulationMeasurementReportSchema.pre('deleteOne', function denyDeleteOne() { throw immutableError(); });
simulationMeasurementReportSchema.pre('deleteMany', function denyDeleteMany() { throw immutableError(); });
simulationMeasurementReportSchema.pre('findOneAndDelete', function denyFindOneAndDelete() { throw immutableError(); });
simulationMeasurementReportSchema.pre('bulkWrite', function denyBulkWrite() { throw immutableError(); });

export const SimulationMeasurementReportModel = mongoose.model<SimulationMeasurementReportDocument>(
  'SimulationMeasurementReport', simulationMeasurementReportSchema
);
