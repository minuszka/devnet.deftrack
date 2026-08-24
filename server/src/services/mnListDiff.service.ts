import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc } from './rpc.service.js';
import { MasternodeEvent } from '../models/MasternodeEvent.js';
import { SyncState } from '../models/SyncState.js';
import { DevnetOperator } from '../models/DevnetOperator.js';
import { OperatorIndex, hostOf } from '../domain/operatorIndex.js';
import { classifyListDiff, penaltiesAfter, type ListDiffResult } from '../domain/mnListDiff.js';

/**
 * Block-exact masternode history, walked one height at a time.
 *
 * The poller answers "what does the list look like now" and can only date a
 * change to the moment it happened to look. This walks `protx listdiff` block
 * by block, so every transition carries the height it occurred at, nothing that
 * happened between two polls is lost, and the whole history can be recomputed
 * from the chain after the fact. The poller stays on as the current-state view
 * and as reconciliation.
 */
export const DIFF_CURSOR_KEY = 'mndiff';

/** Heights processed per tick. One RPC call each, so this bounds the burst. */
const BATCH = 200;

export class MnListDiffService {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  /**
   * Penalty per masternode as of the cursor height.
   *
   * Needed to tell a missed duty from the penalty decaying one per block --
   * without it every penalised node produces an event in every block.
   */
  private penalties = new Map<string, number>();
  private seeded = false;

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.masternode.intervalMs);
    logger.info(`Masternode list-diff walker started (every ${config.masternode.intervalMs} ms)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.walk();
    } catch (error) {
      logger.error(
        `Masternode list-diff walk failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.running = false;
    }
  }

  /** Forces the penalty map to be rebuilt, after a reorg moved the cursor. */
  reset(): void {
    this.seeded = false;
    this.penalties.clear();
  }

  private async walk(): Promise<void> {
    // Never run past the indexer: an event whose height is not indexed yet
    // would point at a block the API cannot show.
    const blocks = await SyncState.findOne({ key: 'blocks' }).select('lastSyncedHeight').lean();
    const target = blocks?.lastSyncedHeight ?? -1;
    if (target < 1) return;

    const state = await SyncState.findOneAndUpdate(
      { key: DIFF_CURSOR_KEY },
      { $setOnInsert: { key: DIFF_CURSOR_KEY, lastSyncedHeight: -1 } },
      { upsert: true, new: true }
    );

    // Nothing before the first block can have a diff, and the deterministic MN
    // list only starts existing once there are registrations.
    let cursor = state.lastSyncedHeight < 1 ? 1 : state.lastSyncedHeight;
    if (cursor >= target) return;

    if (!this.seeded) {
      await this.seed(cursor);
    }

    const operators = await this.operatorIndex();
    const last = Math.min(target, cursor + BATCH);
    let events = 0;

    for (let height = cursor + 1; height <= last; height++) {
      const diff = await rpc.call<ListDiffResult>('protx', ['listdiff', height - 1, height]);
      const changes = classifyListDiff(diff, this.penalties);
      this.penalties = penaltiesAfter(diff, this.penalties);

      if (changes.length > 0) {
        const ops = changes.map((c) => {
          const hostIp = hostOf(c.serviceAfter);
          const eventKey = `${c.proTxHash}:${c.type}:${c.height}`;
          return {
            updateOne: {
              filter: { eventKey },
              update: {
                // $setOnInsert only: a transition is a fact about a height and
                // is never rewritten, however often the walk is replayed.
                $setOnInsert: {
                  eventKey,
                  proTxHash: c.proTxHash,
                  type: c.type,
                  height: c.height,
                  penaltyAfter: c.penaltyAfter,
                  serviceAfter: c.serviceAfter,
                  revocationReason: c.revocationReason,
                  operatorLabel: operators.resolve(c.proTxHash, hostIp),
                  hostIp,
                  // Chain-derived and block-exact, unlike the poller's sighting.
                  source: 'listdiff' as const,
                  detectedAt: new Date(),
                },
              },
              upsert: true,
            },
          };
        });
        await MasternodeEvent.bulkWrite(ops, { ordered: false });
        events += changes.length;
      }

      cursor = height;
    }

    await SyncState.updateOne(
      { key: DIFF_CURSOR_KEY },
      { $set: { lastSyncedHeight: cursor, lastSyncedAt: new Date() } }
    );

    if (events > 0) {
      logger.info(`Masternode list-diff walked to ${cursor}: ${events} transition(s)`);
    }
  }

  /**
   * Penalties as of the cursor, from a single diff against the start of the
   * chain -- `addedMNs` then carries every masternode that exists at that
   * height with its full state. Without this a restart would read each node's
   * first penalty change as an increase and invent a missed duty.
   */
  private async seed(cursor: number): Promise<void> {
    const diff = await rpc.call<ListDiffResult>('protx', ['listdiff', 1, cursor]);
    this.penalties = penaltiesAfter(diff, new Map());
    this.seeded = true;
    logger.info(`Masternode list-diff seeded at height ${cursor} (${this.penalties.size} masternode(s))`);
  }

  private async operatorIndex(): Promise<OperatorIndex> {
    return new OperatorIndex(
      await DevnetOperator.find().select('operatorLabel proTxHashes hostIps').lean()
    );
  }
}

export const mnListDiffService = new MnListDiffService();
