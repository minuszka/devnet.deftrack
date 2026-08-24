import mongoose, { Schema, type Document } from 'mongoose';

export type RoundStatus = 'pending' | 'formed' | 'failed';

export interface RoundMember {
  proTxHash: string;
  service: string | null;
  valid: boolean;
  operatorLabel: string | null;
}

export interface QuorumRoundDocument extends Document {
  /**
   * Idempotency key, synthetic on purpose.
   *
   * A round that fails to form mines no commitment, so `quorum listextended`
   * never lists it and there is no quorumHash to key on -- yet those rounds are
   * the entire point of this project. The key is therefore derived from the
   * expected schedule, which the node computes the same way
   * (rpc/quorums.cpp:320):
   *
   *   quorumHeight = tipHeight - (tipHeight % dkgInterval) + quorumIndex
   */
  roundKey: string;

  llmqType: number;
  llmqName: string;
  quorumIndex: number;
  expectedHeight: number;

  /** Present only once the round formed and a commitment was mined. */
  quorumHash: string | null;
  minedBlockHash: string | null;
  minedHeight: number | null;

  // Profile snapshot: what the rules were when this round ran.
  size: number;
  minSize: number;
  threshold: number;
  dkgInterval: number;
  /** min(size, masternodes available) -- what CalculateQuorum actually returned. */
  effectiveSize: number | null;

  numValidMembers: number | null;
  healthRatio: number | null;
  status: RoundStatus;
  formed: boolean;

  members: RoundMember[];
  invalidMembers: string[];

  /** effectiveSize - numValidMembers; 0 for a round that never formed. */
  punishedCount: number;
  /** effectiveSize - minSize: the ceiling on what one round can punish. */
  maxPossibleBan: number | null;
  /**
   * Derived here, not read from RPC. `previousConsecutiveDKGFailures` is gated
   * behind params.useRotation (rpc/quorums.cpp:192) and LLMQ_400_60 is not
   * rotated, so the node never reports it for this profile.
   */
  consecutiveFailures: number;

  firstSeenAt: Date;
  /**
   * When the round stopped being pending, written once and never revised.
   *
   * `detectedAt` is refreshed on every poll, so it says when the collector last
   * looked -- not when the round happened. Windowed queries and the health
   * timeline use this instead, or the chart's x-axis stretches whichever rounds
   * happen to still be inside the observation window.
   */
  resolvedAt: Date | null;
  /** Last observation, not an event time. */
  detectedAt: Date;
  /**
   * True once every detail available for the final outcome was captured.
   * A missing field on an older document is treated as incomplete so one
   * deployment pass can repair it, after which it becomes immutable.
   */
  detailsComplete: boolean;
}

const memberSchema = new Schema<RoundMember>(
  {
    proTxHash: { type: String, required: true },
    service: { type: String, default: null },
    valid: { type: Boolean, required: true },
    operatorLabel: { type: String, default: null },
  },
  { _id: false }
);

const quorumRoundSchema = new Schema<QuorumRoundDocument>(
  {
    roundKey: { type: String, required: true, unique: true },

    llmqType: { type: Number, required: true, index: true },
    llmqName: { type: String, required: true, index: true },
    quorumIndex: { type: Number, required: true, default: 0 },
    expectedHeight: { type: Number, required: true, index: true },

    quorumHash: { type: String, default: null, index: true, sparse: true },
    minedBlockHash: { type: String, default: null },
    minedHeight: { type: Number, default: null },

    size: { type: Number, required: true },
    minSize: { type: Number, required: true },
    threshold: { type: Number, required: true },
    dkgInterval: { type: Number, required: true },
    effectiveSize: { type: Number, default: null },

    numValidMembers: { type: Number, default: null },
    healthRatio: { type: Number, default: null, index: true },
    status: { type: String, enum: ['pending', 'formed', 'failed'], required: true, index: true },
    formed: { type: Boolean, required: true, index: true },

    members: [memberSchema],
    invalidMembers: [{ type: String, index: true }],

    punishedCount: { type: Number, default: 0, index: true },
    maxPossibleBan: { type: Number, default: null },
    consecutiveFailures: { type: Number, default: 0 },

    firstSeenAt: { type: Date, default: () => new Date() },
    resolvedAt: { type: Date, default: null, index: true },
    detectedAt: { type: Date, default: () => new Date() },
    detailsComplete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Primary view: rounds newest first, optionally filtered by profile or outcome.
quorumRoundSchema.index({ llmqName: 1, expectedHeight: -1 });
quorumRoundSchema.index({ status: 1, expectedHeight: -1 });
// Health-ratio timeline over a time window.
quorumRoundSchema.index({ resolvedAt: -1 });

// No TTL. The production noise TTL was shorter than the ban window, which made
// a real mainnet fork impossible to correlate after the fact.

export const QuorumRound = mongoose.model<QuorumRoundDocument>('QuorumRound', quorumRoundSchema);
