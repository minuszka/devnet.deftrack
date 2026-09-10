import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc } from './rpc.service.js';
import { MasternodeState } from '../models/MasternodeState.js';
import { versionsFromPeers, type VersionedPeer } from '../domain/nodeVersions.js';

/**
 * The software census: which build each masternode runs, read from the seed's
 * peer table once a minute and written onto the masternode's own row.
 *
 * Written, not derived at read time, because the peer table is a moment and
 * the question is a trend: a masternode that was seen on v23 yesterday and is
 * not connected right now is still on v23, and a census that forgot it every
 * time it dropped off would under-report adoption exactly when the switchover
 * decision is being made. The row keeps the last sighting and its time; the
 * summary decides what is fresh (`config.nodeVersion.staleAfterMs`).
 *
 * Only rows that exist are updated -- never upserted. A peer that
 * authenticates with a ProTx this explorer has not indexed is a masternode
 * the list poller will create on its next pass, with every other field; a
 * row made here would be a masternode with a version and nothing else.
 */
export class NodeVersionService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.nodeVersion.intervalMs);
    logger.info(`Node version census started (every ${config.nodeVersion.intervalMs} ms)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Public like every sibling poller's tick, so it can be driven. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.census();
    } catch (error) {
      logger.error(`Node version census failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async census(): Promise<void> {
    const peers = await rpc.call<VersionedPeer[]>('getpeerinfo');
    const seen = versionsFromPeers(peers);
    if (seen.length === 0) {
      // Not an error, and not a reason to write: a seed with no authenticated
      // masternode peer (just restarted, or not a seed at all) knows nothing.
      logger.warn('Node version census: no authenticated masternode among the peers; nothing written');
      return;
    }
    const seenAt = new Date();
    const result = await MasternodeState.bulkWrite(
      seen.map((v) => ({
        updateOne: {
          filter: { proTxHash: v.proTxHash },
          update: { $set: { nodeSubversion: v.subversion, nodeProtocol: v.protocol, versionSeenAt: seenAt } },
        },
      })),
      { ordered: false }
    );
    logger.debug(`Node version census: ${seen.length} masternodes seen, ${result.matchedCount} of them indexed`);
  }
}

export const nodeVersionService = new NodeVersionService();
