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
  /**
   * The host as the CHAIN sees it -- what a masternode's registered service
   * address resolves to -- when that is not the same string as `hostRef`.
   *
   * On the devnet they are one and the same: attribution is by host IP and the
   * executor acts on that host. In the lab they are not, and the difference is
   * not cosmetic: `hostRef` is the container the executor hands `docker`, while
   * the chain knows the node only by the address in its ProTx. Collapsing the two
   * makes a lab masternode permanently unresolvable (MASTERNODE_HOST_MISMATCH:
   * registry=mn02, observed=172.28.0.3) with no correct value to put in either.
   *
   * Null means "the same as hostRef", so nothing on the devnet changes.
   */
  chainHostRef: string | null;
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
    chainHostRef: { type: String, default: null },
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
