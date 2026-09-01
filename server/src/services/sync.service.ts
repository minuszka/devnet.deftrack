import mongoose from 'mongoose';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  rpc,
  type RpcBlock,
  type RpcBlockVerbose,
  type RpcTransaction,
} from './rpc.service.js';
import { Block } from '../models/Block.js';
import { Transaction } from '../models/Transaction.js';
import { QuorumRound } from '../models/QuorumRound.js';
import { QuorumCommitment } from '../models/QuorumCommitment.js';
import { ServiceEpoch } from '../models/ServiceEpoch.js';
import { closedEpochAt, epochKeyFor, isCommittable } from '../domain/dslSchedule.js';
import { commitmentPunishedCount } from '../domain/commitmentPunishment.js';
import { LLMQ_PROFILES } from '../config/llmq.js';
import { quorumReorgReset } from '../domain/reorg.js';
import { MasternodeEvent } from '../models/MasternodeEvent.js';
import { DIFF_CURSOR_KEY, mnListDiffService } from './mnListDiff.service.js';
import { SyncState } from '../models/SyncState.js';
import { chainLockService } from './chainLock.service.js';
import { mapConcurrent } from '../utils/concurrency.js';
import { metricsService } from './metrics.service.js';
import { payeeRetryDelayMs } from '../domain/collectorPolicy.js';

const SYNC_KEY = 'blocks';

/** Persist indexing progress this often, in blocks. */
/** Consensus TRANSACTION_QUORUM_COMMITMENT; the type a qfcommit carries. */
const TRANSACTION_QUORUM_COMMITMENT = 6;
/** Consensus TRANSACTION_POSE_SERVICE_COMMITMENT; the DSL epoch verdict. */
const TRANSACTION_POSE_SERVICE_COMMITMENT = 10;

const PROGRESS_EVERY = 25;

/**
 * How many members a quorum actually seated, from `quorum info`.
 *
 * This is the number Core punishes over, and nothing in the commitment carries
 * it: the profile size is an upper bound the chain rarely reaches, and the
 * validMembers bitfield is allocated at that same profile size regardless of
 * how many members were selected. Cached because one quorum is referenced by
 * several commitments, and answered as null -- unknown -- when the RPC cannot
 * resolve it, so a failure never turns into a fabricated punishment count.
 */
const memberCountCache = new Map<string, number | null>();

async function quorumMemberCount(llmqType: number, quorumHash: string): Promise<number | null> {
  const key = `${llmqType}:${quorumHash}`;
  const cached = memberCountCache.get(key);
  if (cached !== undefined) return cached;

  let count: number | null = null;
  try {
    const info = await rpc.call<{ members?: unknown[] }>("quorum", ["info", llmqType, quorumHash]);
    if (Array.isArray(info?.members)) count = info.members.length;
  } catch {
    // An aged-out or unknown quorum is not an error worth failing a block over;
    // the punishment count simply stays unknown.
  }
  memberCountCache.set(key, count);
  return count;
}

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
type PayeeLookup =
  | { ok: true; paidProTxHash: string | null }
  | { ok: false };

async function lookupPayee(blockhash: string): Promise<PayeeLookup> {
  try {
    const payments = await rpc.masternodePayments(blockhash);
    return { ok: true, paidProTxHash: payments[0]?.masternodes?.[0]?.proTxHash ?? null };
  } catch {
    return { ok: false };
  }
}

function payeeRetryAt(attempt: number, nowMs = Date.now()): Date {
  return new Date(nowMs + payeeRetryDelayMs(attempt));
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
    const now = new Date();
    const pending = await Block.find({
      paidProTxHash: null,
      payeeCheckedAt: null,
      height: { $gt: 0 },
      $or: [{ payeeRetryAt: null }, { payeeRetryAt: { $lte: now } }],
    })
      .sort({ height: -1 })
      .limit(limit)
      .select('hash height payeeCheckAttempts')
      .lean();
    if (pending.length === 0) return;

    const ops = [];
    const results = await mapConcurrent(
      pending,
      Math.min(4, config.sync.txConcurrency),
      async (block) => ({ block, lookup: await lookupPayee(block.hash) })
    );
    let found = 0;
    let none = 0;
    let failed = 0;

    for (const { block, lookup } of results) {
      if (lookup.ok) {
        if (lookup.paidProTxHash) found++;
        else none++;
        ops.push({
          updateOne: {
            filter: { hash: block.hash, payeeCheckedAt: null },
            update: {
              $set: {
                paidProTxHash: lookup.paidProTxHash,
                payeeCheckedAt: now,
                payeeRetryAt: null,
                payeeCheckAttempts: 0,
              },
            },
          },
        });
      } else {
        failed++;
        const attempt = (block.payeeCheckAttempts ?? 0) + 1;
        ops.push({
          updateOne: {
            filter: { hash: block.hash, payeeCheckedAt: null },
            update: {
              $set: { payeeRetryAt: payeeRetryAt(attempt) },
              $inc: { payeeCheckAttempts: 1 },
            },
          },
        });
      }
    }

    await Block.bulkWrite(ops, { ordered: false });
    logger.info(`Payee backfill checked ${pending.length} block(s): ${found} found, ${none} none, ${failed} retry`);
  }

  /** One pass. Overlapping timer ticks are dropped rather than queued. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const caughtUp = await this.syncOnce();
      if (caughtUp) await this.backfillPayees();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Block sync failed: ${message}`);
      await SyncState.updateOne({ key: SYNC_KEY }, { $set: { error: message } }, { upsert: true });
    } finally {
      this.running = false;
    }
  }

  private async syncOnce(): Promise<boolean> {
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
      metricsService.setSyncPosition(tip, state.lastSyncedHeight);
      return true;
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

    const durationMs = Date.now() - startedAt;
    metricsService.observeSync(to - from + 1, durationMs, tip, to);
    logger.info(
      `Indexed blocks ${from}..${to} of ${tip} in ${durationMs} ms` +
        (to < tip ? ` (${tip - to} behind)` : '')
    );
    return to >= tip;
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
    // Epoch verdicts read off abandoned boundary blocks are verdicts about a
    // chain that no longer exists; the surviving chain's boundary re-indexes.
    await ServiceEpoch.deleteMany({ boundaryHeight: { $gt: cursor } });
    // Same rule for quorum commitments: one mined in an abandoned block never
    // happened on the surviving chain, and left in place it would keep
    // counting punishment that was reorged away. minedHeight is the block it
    // was mined in, so the same cut applies; the surviving chain's copy
    // re-indexes under its own key.
    await QuorumCommitment.deleteMany({ minedHeight: { $gt: cursor } });

    // The blocks are gone; anything derived from them must go with them, or the
    // quorum record keeps describing a chain that no longer exists.
    const reset = quorumReorgReset(cursor);
    const rounds = await QuorumRound.updateMany(reset.filter, reset.update);

    // The predecessor of the first rewound block now has a successor that was
    // just deleted.
    await Block.updateOne({ height: cursor }, { $set: { nextblockhash: null } });

    // Masternode transitions read off the abandoned blocks describe changes
    // that no longer happened. Only the chain-derived ones are dropped -- a
    // polled sighting was still a real observation of a real moment.
    const events = await MasternodeEvent.deleteMany({
      source: 'listdiff',
      height: { $gt: cursor },
    });
    await SyncState.updateOne(
      { key: DIFF_CURSOR_KEY, lastSyncedHeight: { $gt: cursor } },
      { $set: { lastSyncedHeight: cursor } }
    );
    // The in-memory penalty baseline belongs to a chain that no longer exists.
    mnListDiffService.reset();
    if (events.deletedCount > 0) {
      logger.warn(`Dropped ${events.deletedCount} chain-derived masternode event(s) above ${cursor}`);
    }

    logger.warn(
      `Rewound to height ${cursor}, dropped ${deleted.deletedCount} block(s), ` +
        `reset ${rounds.modifiedCount} quorum round(s)`
    );
    return cursor;
  }

  private async indexBlock(height: number): Promise<string> {
    const hash = await rpc.getBlockHash(height);

    // The genesis coinbase is not in the transaction index and the node refuses
    // to serve it ("not considered an ordinary transaction"), so genesis is
    // fetched without its transactions. The block itself is still recorded;
    // only its single unspendable coinbase is absent.
    //
    // Everything else comes back whole in one call. Verbosity 2 used to abort
    // on every proof-of-stake block -- a coinstake mints its reward, so inputs
    // minus outputs is negative and MoneyRange(fee) rejected it -- which is why
    // this used to fetch each transaction separately. Upstream #55 fixed that,
    // and one call per block now replaces one per transaction.
    const [block, payeeLookup]: [RpcBlock | RpcBlockVerbose, PayeeLookup] = await Promise.all([
      height === 0 ? rpc.getBlock(hash) : rpc.getBlockVerbose(hash),
      lookupPayee(hash),
    ]);

    let blockTotalSat = 0n;
    const txOps = [];

    const transactions: RpcTransaction[] =
      height === 0 ? [] : (block as RpcBlockVerbose).tx;
    const txids = transactions.map((tx) => tx.txid);

    for (const [index, tx] of transactions.entries()) {
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
              // Expanded transactions carry no chainlock flag of their own,
              // and a transaction in a locked block is locked.
              hasChainLock: block.chainlock === true,
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

    // Quorum commitments, whatever their type. PoSe punishment comes from
    // whichever quorum a masternode failed, and the explorer measures only one
    // of them -- without this the punishment can never be traced to its cause.
    const commitmentOps = [];
    for (const tx of transactions) {
      if (tx.type !== TRANSACTION_QUORUM_COMMITMENT || !tx.qcTx?.commitment) continue;
      const c = tx.qcTx.commitment;
      const llmqType = c.llmqType ?? -1;
      const quorumHeight = tx.qcTx.height ?? block.height;
      const quorumHash = c.quorumHash ?? null;
      const commitmentKey = `${llmqType}:${quorumHeight}:${quorumHash ?? 'null'}`;
      const valid = c.validMembersCount ?? 0;
      const signers = c.signersCount ?? 0;
      const profile = Object.values(LLMQ_PROFILES).find((p) => p.llmqType === llmqType);
      // How many members the DKG actually selected. Core punishes over this list
      // (`for i < members.size()`), and neither the profile size nor the
      // validMembers bitfield gives it: llmq_400_60 seats 400 nominally, forms
      // with 80 here, and allocates a 400-bit bitfield either way. `quorum info`
      // returns the real member list and resolves for historical quorums too;
      // when it cannot, the count stays null rather than becoming a guess.
      const memberCount = quorumHash === null ? null : await quorumMemberCount(llmqType, quorumHash);

      commitmentOps.push({
        updateOne: {
          filter: { commitmentKey },
          update: {
            $setOnInsert: {
              commitmentKey,
              llmqType,
              // The chain runs types this deployment has no profile for; the
              // number is still the truth, so a missing name is not a gap.
              llmqName: profile?.llmqName ?? null,
              quorumHash,
              quorumHeight,
              minedHeight: block.height,
              minedBlockHash: block.hash,
              validMembersCount: valid,
              signersCount: signers,
              punishedCount: commitmentPunishedCount(valid, memberCount),
              detectedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }
    if (commitmentOps.length > 0) {
      await QuorumCommitment.bulkWrite(commitmentOps, { ordered: false });
    }

    // DSL service commitments. The verdict is final the moment the boundary
    // block is here: the commitment is a transaction in it or it is nowhere,
    // and an absent one is the pool-convergence datum the shadow phase exists
    // to measure -- fail-open recorded as data, never as silence. Boundaries
    // below the first committable one are left out entirely: no commitment
    // could exist there by rule, and recording them as absent would
    // manufacture failures (the DKG collector's formation-gate lesson).
    if (isCommittable(block.height, config.dsl.activationHeight, config.dsl.epochInterval)) {
      const dslTx = transactions.find(
        (tx) => tx.type === TRANSACTION_POSE_SERVICE_COMMITMENT && tx.poseServiceTx?.commitment
      );
      const epoch = closedEpochAt(block.height, config.dsl.epochInterval);
      const c = dslTx?.poseServiceTx?.commitment;
      await ServiceEpoch.updateOne(
        { epochKey: epochKeyFor(epoch) },
        {
          $setOnInsert: {
            epochKey: epochKeyFor(epoch),
            // The payload's own epoch when present -- consensus already
            // rejected the block if it disagreed with the height arithmetic.
            epoch: c?.epoch ?? epoch,
            boundaryHeight: block.height,
            boundaryBlockHash: block.hash,
            status: dslTx ? 'committed' : 'absent',
            txid: dslTx?.txid ?? null,
            epochBlockHash: c?.epochBlockHash ?? null,
            llmqType: c?.llmqType ?? null,
            quorumHash: c?.quorumHash ?? null,
            missedCount: c?.missedCount ?? null,
            listSize: c?.size ?? null,
            missedIndices: c?.missedIndices ?? [],
            detectedAt: new Date(),
          },
        },
        { upsert: true }
      );
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
          txids,
          totalOutSat: dec(blockTotalSat.toString()),
          ...(payeeLookup.ok
            ? {
                paidProTxHash: payeeLookup.paidProTxHash,
                payeeCheckedAt: new Date(),
                payeeCheckAttempts: 0,
                payeeRetryAt: null,
              }
            : { payeeRetryAt: payeeRetryAt(1) }),
        },
        $setOnInsert: { hash: block.hash },
        ...(payeeLookup.ok ? {} : { $inc: { payeeCheckAttempts: 1 } }),
      },
      { upsert: true }
    );

    // A block is indexed as soon as it arrives, when the node does not yet know
    // its successor, so `nextblockhash` was null forever and next-block
    // navigation dead-ended on every block. Fill it in on the predecessor now
    // that the answer exists.
    if (block.previousblockhash) {
      await Block.updateOne(
        { hash: block.previousblockhash, nextblockhash: { $ne: block.hash } },
        { $set: { nextblockhash: block.hash } }
      );
    }

    // hashblock/hashchainlock usually reaches us before this Mongo row exists.
    // Wake the derivation now instead of polling the observation collection.
    chainLockService.notifyBlockIndexed();

    return block.hash;
  }
}

export const syncService = new SyncService();
