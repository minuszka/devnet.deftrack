import mongoose, { Schema, type Document } from 'mongoose';

/**
 * Current state of one masternode, overwritten on every poll.
 *
 * Answers "what does the network look like right now". History lives in
 * MasternodeEvent and MasternodeSnapshot -- this collection deliberately keeps
 * only the latest value so the common query stays a single indexed read.
 */
export interface MasternodeStateDocument extends Document {
  proTxHash: string;
  type: string;

  collateralHash: string;
  collateralIndex: number;
  collateralAddress: string | null;

  service: string | null;
  registeredHeight: number;
  lastPaidHeight: number;

  /**
   * PoSe penalty accumulates on failed duty and decays by one per block. The
   * ban lands when it reaches the threshold, which scales with the masternode
   * count -- so the same penalty means different things at different network
   * sizes.
   */
  poSePenalty: number;
  poSeBanHeight: number;
  poSeRevivedHeight: number;
  banned: boolean;

  ownerAddress: string | null;
  votingAddress: string | null;
  payoutAddress: string | null;
  pubKeyOperator: string | null;

  /** Resolved from DevnetOperator; null until the mapping is loaded. */
  operatorLabel: string | null;
  /** Derived from `service`, so a whole host can be spotted failing at once. */
  hostIp: string | null;

  /**
   * Still present in `protx list registered`.
   *
   * A masternode can leave the list -- collateral spent, ProUpRevTx -- and the
   * stored row would otherwise linger forever, counted as live by every health
   * figure. The row is kept for history and marked instead of deleted.
   */
  active: boolean;
  removedAt: Date | null;

  firstSeenAt: Date;
  lastSeenAt: Date;
}

const masternodeStateSchema = new Schema<MasternodeStateDocument>(
  {
    proTxHash: { type: String, required: true, unique: true },
    type: { type: String, default: 'Regular' },

    collateralHash: { type: String, required: true },
    collateralIndex: { type: Number, required: true },
    collateralAddress: { type: String, default: null },

    service: { type: String, default: null },
    registeredHeight: { type: Number, default: -1, index: true },
    lastPaidHeight: { type: Number, default: 0 },

    poSePenalty: { type: Number, default: 0, index: true },
    poSeBanHeight: { type: Number, default: -1 },
    poSeRevivedHeight: { type: Number, default: -1 },
    banned: { type: Boolean, default: false, index: true },

    ownerAddress: { type: String, default: null },
    votingAddress: { type: String, default: null },
    payoutAddress: { type: String, default: null },
    pubKeyOperator: { type: String, default: null },

    operatorLabel: { type: String, default: null, index: true },
    hostIp: { type: String, default: null, index: true },

    active: { type: Boolean, default: true, index: true },
    removedAt: { type: Date, default: null },

    firstSeenAt: { type: Date, default: () => new Date() },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

export const MasternodeState = mongoose.model<MasternodeStateDocument>(
  'MasternodeState',
  masternodeStateSchema
);
