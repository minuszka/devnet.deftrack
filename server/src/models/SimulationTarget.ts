import mongoose, { Schema, type Document } from 'mongoose';
import type {
  SimulationNetwork,
  SimulationTargetCapability,
  SimulationTargetRole,
} from './SimulationRun.js';

/** Private execution registry. Never serialize this document through a public route. */
export interface SimulationTargetDocument extends Document {
  targetId: string;
  displayLabel: string;
  operatorId: string | null;
  proTxHash: string | null;
  hostRef: string;
  unitRef: string;
  p2pPort: number;
  role: SimulationTargetRole;
  network: SimulationNetwork;
  capabilities: SimulationTargetCapability[];
  expectedBuild: string | null;
  labels: string[];
  enabled: boolean;
  maintenance: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const simulationTargetSchema = new Schema<SimulationTargetDocument>(
  {
    targetId: { type: String, required: true, unique: true, immutable: true },
    displayLabel: { type: String, required: true },
    operatorId: { type: String, default: null, index: true },
    proTxHash: { type: String, default: null, index: true },
    hostRef: { type: String, required: true },
    unitRef: { type: String, required: true },
    p2pPort: { type: Number, required: true, min: 1, max: 65_535 },
    role: { type: String, enum: ['masternode', 'staker', 'seed'], required: true },
    network: { type: String, enum: ['regtest', 'devnet'], required: true },
    capabilities: [
      {
        type: String,
        enum: ['service-control', 'netem-p2p', 'partition-p2p', 'dsl-test-hook'],
      },
    ],
    expectedBuild: { type: String, default: null },
    labels: [{ type: String }],
    enabled: { type: Boolean, default: false, index: true },
    maintenance: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, strict: 'throw', versionKey: false }
);

simulationTargetSchema.index({ network: 1, enabled: 1, maintenance: 1 });

export const SimulationTarget = mongoose.model<SimulationTargetDocument>(
  'SimulationTarget',
  simulationTargetSchema
);
