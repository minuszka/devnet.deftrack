import mongoose, { Schema, type Document } from 'mongoose';

export interface BlockDocument extends Document {
  hash: string;
  height: number;
  size: number;
  version: number;
  merkleroot: string;
  time: number;
  mediantime: number | null;
  nonce: number;
  bits: string;
  difficulty: number;
  chainwork: string;
  nTx: number;
  previousblockhash: string | null;
  nextblockhash: string | null;

  /**
   * Derived from the presence of `blocksignature`. Heights up to
   * consensus.lastPowBlock (1000 on this devnet) are proof-of-work, everything
   * above is proof-of-stake, and block spacing is not comparable across the
   * boundary.
   */
  isProofOfStake: boolean;
  hasChainLock: boolean;

  cbTxHeight: number | null;
  merkleRootMNList: string | null;
  merkleRootQuorums: string | null;

  txids: string[];
  totalOutSat: mongoose.Types.Decimal128;

  /**
   * Which masternode this block paid, from `masternode payments`.
   *
   * The coinbase payee address cannot answer this on a devnet where every
   * masternode shares one payout address, and lastPaidHeight only ever covers
   * each node's most recent payment -- 76 blocks out of two thousand.
   */
  paidProTxHash: string | null;
}

const blockSchema = new Schema<BlockDocument>(
  {
    hash: { type: String, required: true, unique: true },
    height: { type: Number, required: true, unique: true },
    size: { type: Number, required: true },
    version: { type: Number, required: true },
    merkleroot: { type: String, required: true },
    time: { type: Number, required: true, index: true },
    mediantime: { type: Number, default: null },
    nonce: { type: Number, required: true },
    bits: { type: String, required: true },
    difficulty: { type: Number, required: true },
    chainwork: { type: String, required: true },
    nTx: { type: Number, default: 0 },
    previousblockhash: { type: String, default: null },
    nextblockhash: { type: String, default: null },

    isProofOfStake: { type: Boolean, required: true, index: true },
    hasChainLock: { type: Boolean, default: false, index: true },

    cbTxHeight: { type: Number, default: null },
    merkleRootMNList: { type: String, default: null },
    merkleRootQuorums: { type: String, default: null },

    txids: [{ type: String }],
    totalOutSat: { type: Schema.Types.Decimal128, default: '0' },
    paidProTxHash: { type: String, default: null, index: true },
  },
  { timestamps: true }
);

// Blocks list: newest first, with a stable tiebreak.
blockSchema.index({ time: -1, height: -1 });

// No TTL. Chain history is the record the whole project is built to preserve.

export const Block = mongoose.model<BlockDocument>('Block', blockSchema);
