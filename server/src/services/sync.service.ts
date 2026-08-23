import mongoose from 'mongoose';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc, type RpcBlock, type RpcTransaction } from './rpc.service.js';
import { Block } from '../models/Block.js';
import { Transaction } from '../models/Transaction.js';
import { SyncState } from '../models/SyncState.js';

const SYNC_KEY = 'blocks';

/** Persist indexing progress this often, in blocks. */
const PROGRESS_EVERY = 25;

const dec = (value: number | string): mongoose.Types.Decimal128 =>
  mongoose.Types.Decimal128.fromString(String(value));

function sumOutputsSat(tx: RpcTransaction): string {
  // valueSat is an integer number of satoshis per output and stays well inside
  // the safe integer range; the *total supply* does not, which is why the sum
  // is accumulated as BigInt and stored as Decimal128.
  let total = 0n;
  for (const out of tx.vout) total += BigInt(Math.round(out.valueSat));
  return total.toString();
}

function outputAddress(out: RpcTransaction['vout'][number]): string | null {
  if (out.scriptPubKey.address) return out.scriptPubKey.address;
  const [first] = out.scriptPubKey.addresses ?? [];
  return first ?? null;
}

/**
 * A coinstake is the second transaction of a proof-of-stake block, recognised
 * by a non-coinbase input plus an empty first output. The empty output is the
 * marker the consensus code itself uses (validation.cpp checks
 * `block.vtx[0]->vout[0].IsEmpty()` for the coinbase side of the same pair).
 */
function looksLikeCoinstake(tx: RpcTransaction, indexInBlock: number): boolean {
  if (indexInBlock !== 1) return false;
  if (tx.vin.some((vin) => vin.coinbase !== undefined)) return false;
  const [firstOut] = tx.vout;
  return firstOut !== undefined && Math.round(firstOut.valueSat) === 0;
}

/**
 * Which masternode a block paid.
 *
 * Read from the node rather than derived from the coinbase: every masternode
 * on this devnet shares one payout address, so the address in the block cannot
 * distinguish them.
 */
async function payeeOf(blockhash: string): Promise<string | null> {
  try {
    const payments = await rpc.masternodePayments(blockhash);
    return payments[0]?.masternodes?.[0]?.proTxHash ?? null;
  } catch {
    return null;
  }
}

export class SyncService {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (!config.sync.enabled) {
      logger.warn('Block sync is disabled (SYNC_ENABLED=0)');
      return;
    }
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.sync.intervalMs);
    logger.info(`Block sync started (every ${config.sync.intervalMs} ms, batch ${config.sync.batchSize})`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Fill in payees for blocks indexed before the field existed.
   *
   * Bounded per pass so a backfill never competes with keeping up with the
   * tip, and idempotent: it only ever looks at blocks still missing a value.
   */
  private async backfillPayees(limit = 300): Promise<void> {
    const pending = await Block.find({ paidProTxHash: null, height: { $gt: 0 } })
      .sort({ height: -1 })
      .limit(limit)
      .select('hash height')
      .lean();
    if (pending.length === 0) return;

    const ops = [];
    for (const b of pending) {
      const paid = await payeeOf(b.hash);
      if (paid) ops.push({ updateOne: { filter: { hash: b.hash }, update: { $set: { paidProTxHash: paid } } } });
    }
    if (ops.length > 0) {
      await Block.bulkWrite(ops, { ordered: false });
      logger.info(`Backfilled payee for ${ops.length} block(s); ${pending.length - ops.length} paid nobody`);
    }
  }

  /** One pass. Overlapping timer ticks are dropped rather than queued. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.syncOnce();
      await this.backfillPayees();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Block sync failed: ${message}`);
      await SyncState.updateOne({ key: SYNC_KEY }, { $set: { error: message } }, { upsert: true });
    } finally {
      this.running = false;
    }
  }

  private async syncOnce(): Promise<void> {
    const state =
      (await SyncState.findOne({ key: SYNC_KEY })) ??
      (await SyncState.create({ key: SYNC_KEY }));

    const tip = await rpc.getBlockCount();
    let from = state.lastSyncedHeight + 1;

    if (state.lastSyncedHeight >= 0) {
      const rolledBackTo = await this.rollbackIfReorged(state.lastSyncedHeight, state.lastSyncedHash);
      if (rolledBackTo !== null) from = rolledBackTo + 1;
    }

    if (from > tip) {
      await SyncState.updateOne({ key: SYNC_KEY }, { $set: { heartbeatAt: new Date(), error: null } });
      return;
    }

    const to = Math.min(tip, from + config.sync.batchSize - 1);
    const startedAt = Date.now();

    let lastHash = state.lastSyncedHash;
    for (let height = from; height <= to; height++) {
      lastHash = await this.indexBlock(height);
      // Checkpoint inside the batch. Writing progress only at the end left the
      // health endpoint reporting -1 while thousands of blocks were already
      // stored, and made a restart mid-batch redo all of it.
      if (height % PROGRESS_EVERY === 0) {
        await this.saveProgress(height, lastHash);
      }
    }

    await this.saveProgress(to, lastHash);

    logger.info(
      `Indexed blocks ${from}..${to} of ${tip} in ${Date.now() - startedAt} ms` +
        (to < tip ? ` (${tip - to} behind)` : '')
    );
  }

  private async saveProgress(height: number, hash: string): Promise<void> {
    await SyncState.updateOne(
      { key: SYNC_KEY },
      {
        $set: {
          lastSyncedHeight: height,
          lastSyncedHash: hash,
          lastSyncedAt: new Date(),
          heartbeatAt: new Date(),
          error: null,
        },
      }
    );
  }

  /**
   * Walk back until the stored chain agrees with the node, deleting anything
   * that no longer exists. Returns the height the database was rewound to, or
   * null when nothing had to change.
   */
  private async rollbackIfReorged(height: number, hash: string): Promise<number | null> {
    const onChain = await rpc.getBlockHash(height).catch(() => null);
    if (onChain === hash) return null;

    logger.warn(`Reorg detected at height ${height}; stored ${hash || '(none)'} is not on the active chain`);

    let cursor = height;
    while (cursor >= 0) {
      const stored = await Block.findOne({ height: cursor }).select('hash').lean();
      const actual = await rpc.getBlockHash(cursor).catch(() => null);
      if (stored && actual && stored.hash === actual) break;
      cursor--;
    }

    const deleted = await Block.deleteMany({ height: { $gt: cursor } });
    await Transaction.deleteMany({ height: { $gt: cursor } });
    logger.warn(`Rewound to height ${cursor}, dropped ${deleted.deletedCount} block(s)`);
    return cursor;
  }

  private async indexBlock(height: number): Promise<string> {
    const hash = await rpc.getBlockHash(height);
    const block: RpcBlock = await rpc.getBlock(hash);
    const paidProTxHash = await payeeOf(hash);

    let blockTotalSat = 0n;
    const txOps = [];

    // The genesis coinbase is not in the transaction index and the node refuses
    // to serve it ("not considered an ordinary transaction"). The block itself
    // is still recorded; only its single unspendable coinbase is absent.
    const txids = block.height === 0 ? [] : block.tx;

    for (const [index, txid] of txids.entries()) {
      const tx = await rpc.getRawTransaction(txid);
      const valueOutSat = sumOutputsSat(tx);
      blockTotalSat += BigInt(valueOutSat);

      txOps.push({
        updateOne: {
          filter: { txid: tx.txid },
          update: {
            $set: {
              blockhash: block.hash,
              height: block.height,
              time: tx.blocktime ?? block.time,
              version: tx.version,
              type: tx.type,
              size: tx.size,
              isCoinbase: index === 0,
              isCoinstake: looksLikeCoinstake(tx, index),
              hasChainLock: tx.chainlock === true,
              vin: tx.vin.map((vin) => ({
                txid: vin.txid ?? null,
                vout: vin.vout ?? null,
                coinbase: vin.coinbase ?? null,
                sequence: vin.sequence,
              })),
              vout: tx.vout.map((out) => ({
                n: out.n,
                valueSat: dec(Math.round(out.valueSat)),
                scriptType: out.scriptPubKey.type,
                address: outputAddress(out),
                scriptHex: out.scriptPubKey.hex || null,
              })),
              valueOutSat: dec(valueOutSat),
            },
            $setOnInsert: { txid: tx.txid },
          },
          upsert: true,
        },
      });
    }

    if (txOps.length > 0) {
      await Transaction.bulkWrite(txOps, { ordered: false });
    }

    await Block.updateOne(
      { hash: block.hash },
      {
        $set: {
          height: block.height,
          size: block.size,
          version: block.version,
          merkleroot: block.merkleroot,
          time: block.time,
          mediantime: block.mediantime ?? null,
          nonce: block.nonce,
          bits: block.bits,
          difficulty: block.difficulty,
          chainwork: block.chainwork,
          nTx: block.nTx,
          previousblockhash: block.previousblockhash ?? null,
          nextblockhash: block.nextblockhash ?? null,
          isProofOfStake: typeof block.blocksignature === 'string' && block.blocksignature.length > 0,
          hasChainLock: block.chainlock === true,
          cbTxHeight: block.cbTx?.height ?? null,
          merkleRootMNList: block.cbTx?.merkleRootMNList ?? null,
          merkleRootQuorums: block.cbTx?.merkleRootQuorums ?? null,
          txids: block.tx,
          totalOutSat: dec(blockTotalSat.toString()),
          paidProTxHash,
        },
        $setOnInsert: { hash: block.hash },
      },
      { upsert: true }
    );

    return block.hash;
  }
}

export const syncService = new SyncService();
