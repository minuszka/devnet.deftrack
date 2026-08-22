import mongoose, { Schema, type Document } from 'mongoose';

/**
 * Maps masternodes to the person running them.
 *
 * Without this the round data cannot answer "is the protocol failing, or is it
 * one operator's VPS?" -- the single biggest misreading during the July mainnet
 * incident. It is populated at onboarding, not derived.
 */
export interface DevnetOperatorDocument extends Document {
  operatorLabel: string;
  /** Explicit per-masternode attribution; wins over hostIps. */
  proTxHashes: string[];
  /**
   * Whole hosts owned by this operator.
   *
   * Coarser than proTxHashes and better for it: an address survives a
   * re-registration that gives the masternode a new proTxHash, and eight
   * lines cover eighty nodes.
   */
  hostIps: string[];
  contact: string | null;
  vpsProvider: string | null;
  country: string | null;
  notes: string | null;
}

const devnetOperatorSchema = new Schema<DevnetOperatorDocument>(
  {
    operatorLabel: { type: String, required: true, unique: true },
    // Indexed because resolving a member to its operator is a per-member lookup
    // on every round.
    proTxHashes: [{ type: String, index: true }],
    hostIps: [{ type: String, index: true }],
    contact: { type: String, default: null },
    vpsProvider: { type: String, default: null, index: true },
    country: { type: String, default: null, index: true },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

export const DevnetOperator = mongoose.model<DevnetOperatorDocument>(
  'DevnetOperator',
  devnetOperatorSchema
);
