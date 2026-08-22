import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc } from './rpc.service.js';
import { Block } from '../models/Block.js';

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

export class ChainLockService {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  start(): void {
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

    for (const b of candidates) {
      const block = await rpc.getBlock(b.hash).catch(() => null);
      if (block?.chainlock !== true) continue;

      const latency = Math.max(0, Math.round(now.getTime() / 1000 - b.time));
      ops.push({
        updateOne: {
          filter: { hash: b.hash, chainLockedAt: null },
          update: { $set: { hasChainLock: true, chainLockedAt: now, chainLockLatencySec: latency } },
        },
      });
    }

    if (ops.length > 0) {
      await Block.bulkWrite(ops, { ordered: false });
      logger.info(`ChainLock observed on ${ops.length} block(s) up to ${tip}`);
    }
  }
}

export const chainLockService = new ChainLockService();
