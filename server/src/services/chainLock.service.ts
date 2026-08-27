import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc } from './rpc.service.js';
import { Block } from '../models/Block.js';
import { Transaction } from '../models/Transaction.js';
import { NodeObservation } from '../models/NodeObservation.js';
import { zmqService } from './zmq.service.js';
import { metricsService } from './metrics.service.js';
import { chainLockRpcIntervalMs } from '../domain/collectorPolicy.js';
import {
  CHAINLOCK_V2_ACTIVATION_HEIGHT,
  CHAINLOCK_V2_PROFILE_NAME,
  CHAINLOCK_PROFILE_NAME,
  chainlockProfileNameAtHeight,
} from '../config/llmq.js';
import { PeerObservation } from '../models/PeerObservation.js';
import { localClockService } from './localClock.service.js';

/**
 * ChainLock observation.
 *
 * ZMQ timestamps block and CLSIG arrival on the same host clock, giving a
 * precise event latency without repeatedly asking the node. RPC polling stays
 * as reconciliation for subscriber gaps, and as the fallback when ZMQ is off.
 *
 * Only recent blocks are reconciled. A ChainLock arrives within seconds of a
 * block or not at all, so scanning deeper would burn RPC calls to re-confirm
 * settled history.
 */
const WINDOW = 40;

/** Observations derived per tick; bounded so a backlog cannot stall the loop. */
const OBSERVATION_BATCH = 500;
/**
 * How long a notification waits for its block to be indexed before it is given
 * up on. A hash that never gets indexed belonged to a block that lost a race.
 */
const ORPHAN_AFTER_MS = 60 * 60_000;

export class ChainLockService {
  private reconciling = false;
  private applying = false;
  private deferredObservations = false;
  private timer: NodeJS.Timeout | null = null;
  private unsubscribeZmq: (() => void) | null = null;
  /**
   * Latency is only meaningful for blocks mined after the watcher was
   * running. For anything older, the gap between block time and first sight
   * measures our downtime, not the CLSIG.
   */
  private startedAtSec = 0;

  start(): void {
    this.startedAtSec = Math.floor(Date.now() / 1000);

    // Locks recorded before the signer field existed get their profile from
    // the same height rule new observations use. Idempotent, and safe to run
    // unconditionally: only rows still missing the field are touched.
    void Block.updateMany({ hasChainLock: true, chainLockLlmqName: null }, [
      {
        $set: {
          chainLockLlmqName: {
            $cond: [
              { $gte: ['$height', CHAINLOCK_V2_ACTIVATION_HEIGHT] },
              CHAINLOCK_V2_PROFILE_NAME,
              CHAINLOCK_PROFILE_NAME,
            ],
          },
        },
      },
    ])
      .then((r) => {
        if (r.modifiedCount > 0) {
          logger.info(`ChainLock signer profile backfilled on ${r.modifiedCount} block(s)`);
        }
      })
      .catch((error) =>
        logger.error(
          `ChainLock signer backfill failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    this.unsubscribeZmq = zmqService.onObservation((topic) => {
      if (topic !== 'hashblock' && topic !== 'hashchainlock') return;
      this.deferredObservations = true;
      void this.applyPendingObservations();
    });

    const intervalMs = chainLockRpcIntervalMs(
      zmqService.enabled,
      config.chainlock.intervalMs,
      config.chainlock.reconcileIntervalMs
    );
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    logger.info(
      `ChainLock watcher started (${zmqService.enabled ? 'ZMQ + reconciliation' : 'poll fallback'}, ` +
        `RPC every ${intervalMs} ms, last ${WINDOW} blocks)`
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribeZmq?.();
    this.unsubscribeZmq = null;
  }

  async tick(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await this.applyPendingObservations();
      await this.collect();
      await this.reconcileBestLock();
    } catch (error) {
      logger.error(`ChainLock watch failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.reconciling = false;
    }
  }

  /**
   * Called by the block indexer after a block becomes queryable in Mongo. A
   * ZMQ notification normally beats indexing, so this closes that short race
   * without adding a permanent database polling loop.
   */
  notifyBlockIndexed(): void {
    if (this.deferredObservations) void this.applyPendingObservations();
  }

  private async applyPendingObservations(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    // Preserve a notification that arrives while the current batch is being
    // consumed. Missing blocks set this flag again via the return value.
    this.deferredObservations = false;
    try {
      const deferred = await this.applyObservations();
      this.deferredObservations = this.deferredObservations || deferred;
    } catch (error) {
      this.deferredObservations = true;
      logger.error(
        `ChainLock ZMQ derivation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.applying = false;
    }

    // A notification that arrived while the batch was running set the flag
    // again. Without this it would wait for the next block index or the next
    // RPC tick -- which, now that ZMQ demoted polling to reconciliation, can be
    // minutes. The stored arrival times are unaffected either way; what would
    // lag is when the views can see them.
    if (this.deferredObservations) void this.applyPendingObservations();
  }

  private async recordSeedSighting(
    topic: string,
    hash: string,
    block: { height?: number },
    receivedAt: Date
  ): Promise<void> {
    const peerTopic = topic === 'hashblock' ? 'block' : 'chainlock';
    const observationKey = `seed:${peerTopic}:${hash}`;
    await PeerObservation.updateOne(
      { observationKey },
      {
        $setOnInsert: {
          observationKey,
          host: 'seed',
          topic: peerTopic,
          hash,
          height: block.height ?? null,
          receivedAt,
          clockOffsetMs: await localClockService.current(),
          // ZMQ is an event feed: the notification is the moment, not a window.
          resolutionMs: 0,
          agentVersion: 'explorer',
          ingestedAt: new Date(),
        },
      },
      { upsert: true }
    ).catch(() => undefined);
  }

  /**
   * Turns raw ZMQ arrivals into the fields the views read.
   *
   * Derivation is deliberately separate from collection: the observation rows
   * are never rewritten, so if this arithmetic turns out to be wrong it can be
   * corrected and re-run over the same evidence.
   */
  private async applyObservations(): Promise<boolean> {
    const pending = await NodeObservation.find({
      topic: { $in: ['hashblock', 'hashchainlock'] },
      appliedAt: null,
    })
      .sort({ receivedAt: 1 })
      .limit(OBSERVATION_BATCH)
      .lean();
    if (pending.length === 0) return false;

    const now = new Date();
    const applied: string[] = [];
    let locks = 0;
    let deferred = false;

    for (const obs of pending) {
      if (!obs.hash) {
        applied.push(obs.observationKey);
        continue;
      }
      const block = await Block.findOne({ hash: obs.hash })
        .select('hash height time firstSeenAt chainLockedAt')
        .lean();

      if (!block) {
        // The notification beat the indexer to it, which is the normal order.
        // Leave it pending unless it has aged out -- a hash we never index is
        // a stale-tip or reorg artefact, not something to retry forever.
        if (now.getTime() - new Date(obs.receivedAt).getTime() > ORPHAN_AFTER_MS) {
          applied.push(obs.observationKey);
        } else {
          deferred = true;
        }
        continue;
      }

      // The seed is a vantage point like any other, and the one the explorer
      // measures with the sharpest instrument -- an event feed rather than a
      // poll, so resolution 0. Recording it here puts the reference into the
      // same comparison as the fleet instead of leaving it implicit.
      await this.recordSeedSighting(obs.topic, obs.hash, block, new Date(obs.receivedAt));

      if (obs.topic === 'hashblock') {
        if (!block.firstSeenAt) {
          await Block.updateOne({ hash: obs.hash, firstSeenAt: null }, { $set: { firstSeenAt: obs.receivedAt } });
        }
      } else if (!block.chainLockedAt) {
        // Measured on one clock, block arrival to lock arrival. The seconds
        // field keeps its old meaning -- against the block's own timestamp --
        // so the two are never silently mixed.
        const latencyMs = block.firstSeenAt
          ? Math.max(0, new Date(obs.receivedAt).getTime() - new Date(block.firstSeenAt).getTime())
          : null;

        await Block.updateOne(
          { hash: obs.hash, chainLockedAt: null },
          {
            $set: {
              hasChainLock: true,
              chainLockedAt: obs.receivedAt,
              chainLockLatencySec: Math.max(
                0,
                Math.round(new Date(obs.receivedAt).getTime() / 1000 - block.time)
              ),
              chainLockLatencyMs: latencyMs,
              chainLockSource: 'zmq',
              // The signed-height resolver is height-only and one-way, so the
              // signer is a consensus fact derivable at observation time.
              chainLockLlmqName:
                typeof block.height === 'number' ? chainlockProfileNameAtHeight(block.height) : null,
            },
          }
        );
        await Transaction.updateMany(
          { blockhash: obs.hash, hasChainLock: false },
          { $set: { hasChainLock: true } }
        );
        locks++;
      }

      applied.push(obs.observationKey);
    }

    if (applied.length > 0) {
      await NodeObservation.updateMany(
        { observationKey: { $in: applied } },
        { $set: { appliedAt: now } }
      );
    }
    if (locks > 0) {
      metricsService.observeChainLocks('zmq', locks, true);
      logger.info(`ChainLock event time applied to ${locks} block(s) from ZMQ`);
    }
    return deferred;
  }

  private async collect(): Promise<void> {
    const tip = await rpc.getBlockCount();
    const from = Math.max(1, tip - WINDOW + 1);

    // Only blocks not yet seen locked; once observed the record stands.
    const candidates = await Block.find({
      height: { $gte: from, $lte: tip },
      chainLockedAt: null,
    })
      .select('hash height time')
      .lean();
    if (candidates.length === 0) return;

    const now = new Date();
    const ops = [];
    const lockedHashes: string[] = [];

    for (const b of candidates) {
      const block = await rpc.getBlock(b.hash).catch(() => null);
      if (block?.chainlock !== true) continue;

      // Null, not a number, when the block predates the watcher: the lock is
      // real, the timing is not ours to claim.
      const observable = b.time >= this.startedAtSec;
      const latency = observable ? Math.max(0, Math.round(now.getTime() / 1000 - b.time)) : null;

      lockedHashes.push(b.hash);
      ops.push({
        updateOne: {
          filter: { hash: b.hash, chainLockedAt: null },
          update: {
            $set: {
              hasChainLock: true,
              chainLockedAt: now,
              chainLockLatencySec: latency,
              // Poll resolution, not an event time -- recorded so the two are
              // never averaged together as if they were the same measurement.
              chainLockSource: 'poll' as const,
              chainLockLlmqName: chainlockProfileNameAtHeight(b.height),
            },
          },
        },
      });
    }

    if (ops.length > 0) {
      await Block.bulkWrite(ops, { ordered: false });
      // A transaction is indexed with the lock state its block had at index
      // time, which is almost always "not locked yet". Without this the
      // per-transaction flag stayed false on a chain where every block is
      // locked, and the two views contradicted each other.
      await Transaction.updateMany(
        { blockhash: { $in: lockedHashes }, hasChainLock: false },
        { $set: { hasChainLock: true } }
      );
      const timed = ops.filter((o) => o.updateOne.update.$set.chainLockLatencySec !== null).length;
      metricsService.observeChainLocks('poll', ops.length, zmqService.enabled);
      logger.info(
        `ChainLock observed on ${ops.length} block(s) up to ${tip}; ${timed} with measurable latency`
      );
    }
  }

  /**
   * Cross-checks the signed-height resolver mirror against the node.
   *
   * `getbestchainlock` is the only place the node names the profile that
   * signed a lock, and only for the current best one. The derived name should
   * always agree; a mismatch means this deployment's activation constants
   * have drifted from the node's, and the node's answer wins -- both in the
   * stored record and in the log line that says the config needs fixing.
   */
  private async reconcileBestLock(): Promise<void> {
    const best = await rpc.getBestChainLock().catch(() => null);
    if (!best?.llmqType) return;

    const derived = chainlockProfileNameAtHeight(best.height);
    if (best.llmqType !== derived) {
      logger.warn(
        `ChainLock resolver drift: node signs height ${best.height} with ${best.llmqType}, ` +
          `config derives ${derived} -- storing the node's answer; check CHAINLOCK_V2_* config`
      );
    }
    await Block.updateOne(
      { hash: best.blockhash, chainLockLlmqName: { $ne: best.llmqType } },
      { $set: { chainLockLlmqName: best.llmqType } }
    );
  }
}

export const chainLockService = new ChainLockService();
