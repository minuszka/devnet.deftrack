import mongoose, { Schema, type Document } from 'mongoose';

export interface TxInput {
  txid: string | null;
  vout: number | null;
  coinbase: string | null;
  sequence: number;
}

export interface TxOutput {
  n: number;
  valueSat: mongoose.Types.Decimal128;
  scriptType: string;
  address: string | null;
}

export interface TransactionDocument extends Document {
  txid: string;
  blockhash: string;
  height: number;
  time: number;
  version: number;
  /** Dash special-transaction type; 0 is a plain transaction, 5 is a coinbase. */
  type: number;
  size: number;

  isCoinbase: boolean;
  /**
   * A coinstake is the second transaction of a proof-of-stake block and mints
   * the stake reward, so its outputs exceed its inputs. Any code that derives
   * a fee must skip it -- the node's own RPC does not, which is what breaks
   * `getblock <hash> 2`.
   */
  isCoinstake: boolean;
  hasChainLock: boolean;

  vin: TxInput[];
  vout: TxOutput[];
  valueOutSat: mongoose.Types.Decimal128;
}

const inputSchema = new Schema<TxInput>(
  {
    txid: { type: String, default: null },
    vout: { type: Number, default: null },
    coinbase: { type: String, default: null },
    sequence: { type: Number, required: true },
  },
  { _id: false }
);

const outputSchema = new Schema<TxOutput>(
  {
    n: { type: Number, required: true },
    valueSat: { type: Schema.Types.Decimal128, required: true },
    scriptType: { type: String, required: true },
    address: { type: String, default: null },
  },
  { _id: false }
);

const transactionSchema = new Schema<TransactionDocument>(
  {
    txid: { type: String, required: true, unique: true },
    blockhash: { type: String, required: true, index: true },
    height: { type: Number, required: true, index: true },
    time: { type: Number, required: true, index: true },
    version: { type: Number, required: true },
    type: { type: Number, required: true },
    size: { type: Number, required: true },

    isCoinbase: { type: Boolean, default: false },
    isCoinstake: { type: Boolean, default: false, index: true },
    hasChainLock: { type: Boolean, default: false },

    vin: [inputSchema],
    vout: [outputSchema],
    valueOutSat: { type: Schema.Types.Decimal128, default: '0' },
  },
  { timestamps: true }
);

transactionSchema.index({ height: -1, txid: 1 });
transactionSchema.index({ 'vout.address': 1, height: -1 });

export const Transaction = mongoose.model<TransactionDocument>('Transaction', transactionSchema);
