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
  /** Last successful `masternode payments` lookup, including "no payee". */
  payeeCheckedAt: Date | null;
  /** Failed lookup count used for exponential retry backoff. */
  payeeCheckAttempts: number;
  /** Earliest time a transient lookup failure may be retried. */
  payeeRetryAt: Date | null;

  /**
   * When a ChainLock was first *observed* on this block.
   *
   * With ZMQ this is the local receipt timestamp. With the RPC fallback it is
   * a coarser sighting timestamp. `chainLockSource` distinguishes the two.
   * Recorded rather than inferred, and never revised once set.
   */
  chainLockedAt: Date | null;
  /** chainLockedAt - block time, in seconds. Same resolution caveat. */
  chainLockLatencySec: number | null;

  /**
   * Which observation the lock time came from.
   *
   * 'zmq' is an event time reported by the node the moment the CLSIG was
   * processed; 'poll' is a sighting whose resolution is the poll interval. They
   * are not the same measurement and must not be averaged together silently.
   */
  chainLockSource: 'zmq' | 'poll' | null;
  /**
   * ChainLock arrival minus block arrival, both measured on this host's clock.
   *
   * Independent of the block's own timestamp, which the staking node writes and
   * which can drift. Null unless both events were observed over ZMQ.
   */
  chainLockLatencyMs: number | null;

  /** When this node first announced the block to us over ZMQ. */
  firstSeenAt: Date | null;
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
    payeeCheckedAt: { type: Date, default: null },
    payeeCheckAttempts: { type: Number, default: 0 },
    payeeRetryAt: { type: Date, default: null },
    chainLockedAt: { type: Date, default: null },
    chainLockLatencySec: { type: Number, default: null, index: true },
    chainLockSource: { type: String, enum: ['zmq', 'poll', null], default: null },
    chainLockLatencyMs: { type: Number, default: null },
    firstSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Blocks list: newest first, with a stable tiebreak.
blockSchema.index({ time: -1, height: -1 });
// Measured with executionStats: the ChainLock view scanned every pre-PoS
// height entry and filtered afterwards. Equality + sort serves it directly.
blockSchema.index({ isProofOfStake: 1, height: -1 });

// The payee backfill filters on payeeCheckedAt and sorts by height. Measured,
// not guessed: without this the plan sorted in memory, which costs nothing at
// one candidate and a great deal after a cold start or a reorg -- exactly when
// the candidate set is largest and the system is already busy.
blockSchema.index({ payeeCheckedAt: 1, height: -1 });

// No TTL. Chain history is the record the whole project is built to preserve.

export const Block = mongoose.model<BlockDocument>('Block', blockSchema);
