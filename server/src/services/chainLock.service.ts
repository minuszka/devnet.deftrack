import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc } from './rpc.service.js';
import { Block } from '../models/Block.js';
import { Transaction } from '../models/Transaction.js';
import { NodeObservation } from '../models/NodeObservation.js';

/**
 * ChainLock observation.
 *
 * The node reports whether a block is chainlocked, never when the CLSIG
 * arrived, so latency has to be measured by watching. The cost of that is
 * honest and bounded: resolution equals the poll interval, and a lock that
 * landed while the collector was down is recorded as locked with no latency
 * rather than with a fabricated one.
 *
 * Only recent blocks are examined. A ChainLock arrives within seconds of a
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
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  /**
   * Latency is only meaningful for blocks mined after the watcher was
   * running. For anything older, the gap between block time and first sight
   * measures our downtime, not the CLSIG.
   */
  private startedAtSec = 0;

  start(): void {
    this.startedAtSec = Math.floor(Date.now() / 1000);
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.chainlock.intervalMs);
    logger.info(`ChainLock watcher started (every ${config.chainlock.intervalMs} ms, last ${WINDOW} blocks)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.collect();
    } catch (error) {
      logger.error(`ChainLock watch failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Turns raw ZMQ arrivals into the fields the views read.
   *
   * Derivation is deliberately separate from collection: the observation rows
   * are never rewritten, so if this arithmetic turns out to be wrong it can be
   * corrected and re-run over the same evidence.
   */
  private async applyObservations(): Promise<void> {
    const pending = await NodeObservation.find({
      topic: { $in: ['hashblock', 'hashchainlock'] },
      appliedAt: null,
    })
      .sort({ receivedAt: 1 })
      .limit(OBSERVATION_BATCH)
      .lean();
    if (pending.length === 0) return;

    const now = new Date();
    const applied: string[] = [];
    let locks = 0;

    for (const obs of pending) {
      if (!obs.hash) continue;
      const block = await Block.findOne({ hash: obs.hash })
        .select('hash time firstSeenAt chainLockedAt')
        .lean();

      if (!block) {
        // The notification beat the indexer to it, which is the normal order.
        // Leave it pending unless it has aged out -- a hash we never index is
        // a stale-tip or reorg artefact, not something to retry forever.
        if (now.getTime() - new Date(obs.receivedAt).getTime() > ORPHAN_AFTER_MS) {
          applied.push(obs.observationKey);
        }
        continue;
      }

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
      logger.info(`ChainLock event time applied to ${locks} block(s) from ZMQ`);
    }
  }

  private async collect(): Promise<void> {
    await this.applyObservations();

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
      logger.info(
        `ChainLock observed on ${ops.length} block(s) up to ${tip}; ${timed} with measurable latency`
      );
    }
  }
}

export const chainLockService = new ChainLockService();
