import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc } from './rpc.service.js';
import { HostStatus } from '../models/HostStatus.js';
import { StakeScriptObservation } from '../models/StakeScriptObservation.js';
import { localClockService } from './localClock.service.js';

/**
 * The seed node reporting on itself, on the same terms as the fleet agents.
 *
 * It was already the ninth vantage point for block and ChainLock sightings but
 * had no entry in the host table and no payout scripts on record -- so the
 * dominant block producer on this chain was the one machine that could not be
 * attributed. A concentration index that silently omits the biggest producer is
 * worse than none.
 */
const INTERVAL_MS = 10 * 60_000;
/**
 * Cap on address lookups per pass. Only outputs inside stakeValueRange can ever
 * stake, and a coinstake output is already pay-to-pubkey and needs no lookup at
 * all, so this bound is rarely reached -- it exists so a wallet with thousands
 * of small outputs cannot turn this into a flood of RPC calls.
 */
const MAX_ADDRESS_LOOKUPS = 60;

interface Unspent {
  amount: number;
  address?: string;
  scriptPubKey?: string;
}

interface PeerInfo {
  inbound?: boolean;
  pingtime?: number;
  pingwait?: number;
  verified_proregtx_hash?: string;
}

export class SeedStatusService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    logger.info(`Seed self-report started (every ${INTERVAL_MS} ms)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.report();
    } catch (error) {
      logger.error(
        `Seed self-report failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.running = false;
    }
  }

  private async report(): Promise<void> {
    const [unspent, peers, height] = await Promise.all([
      rpc.call<Unspent[]>('listunspent', [0, 9_999_999]).catch(() => [] as Unspent[]),
      rpc.call<PeerInfo[]>('getpeerinfo').catch(() => [] as PeerInfo[]),
      rpc.getBlockCount().catch(() => null),
    ]);

    const scripts = new Set<string>();
    let lookups = 0;

    for (const u of unspent) {
      // Outside the stakeable range this output can never produce a block, so
      // its script is not a payout script and asking about it is wasted work.
      if (u.amount < config.stake.minValue || u.amount > config.stake.maxValue) continue;

      const spk = (u.scriptPubKey ?? '').toLowerCase();
      // Already pay-to-pubkey -- the shape a coinstake pays to, and the shape
      // every output that has staked already carries. No lookup needed.
      if (spk.length === 70 && spk.startsWith('21') && spk.endsWith('ac')) {
        scripts.add(spk);
        continue;
      }

      if (!u.address || lookups >= MAX_ADDRESS_LOOKUPS) continue;
      lookups++;
      const info = await rpc
        .call<{ pubkey?: string }>('getaddressinfo', [u.address])
        .catch(() => null);
      const pubkey = info?.pubkey;
      if (pubkey && pubkey.length === 66) scripts.add(`21${pubkey.toLowerCase()}ac`);
    }

    const pings = peers
      .map((p) => p.pingtime)
      .filter((v): v is number => typeof v === 'number')
      .map((v) => v * 1000)
      .sort((a, b) => a - b);
    const mid = pings.length / 2;
    const medianPingMs = pings.length
      ? pings.length % 2 === 1
        ? pings[(pings.length - 1) / 2]!
        : (pings[mid - 1]! + pings[mid]!) / 2
      : null;

    await HostStatus.updateOne(
      { host: 'seed' },
      {
        $set: {
          host: 'seed',
          peers: peers.length,
          inbound: peers.filter((p) => p.inbound).length,
          verifiedMasternodes: peers.filter((p) => p.verified_proregtx_hash).length,
          medianPingMs,
          maxPingWaitMs: peers.length
            ? Math.max(...peers.map((p) => (p.pingwait ?? 0) * 1000))
            : 0,
          height,
          stakeScripts: [...scripts].sort(),
          clockOffsetMs: await localClockService.current(),
          agentVersion: 'explorer',
          reportedAt: new Date(),
        },
      },
      { upsert: true }
    );

    // Append-only, alongside the current-view overwrite above: this is the
    // immutable half the measurement attributes blocks from, so the same window
    // resolves to the same host however long after finalize verify() runs. A
    // retry at the same height is a $setOnInsert no-op.
    if (typeof height === 'number' && scripts.size > 0) {
      const observedAt = new Date();
      await StakeScriptObservation.bulkWrite(
        [...scripts].map((script) => {
          const observationKey = `seed:${script}:${height}`;
          return {
            updateOne: {
              filter: { observationKey },
              update: { $setOnInsert: { observationKey, host: 'seed', script, height, observedAt } },
              upsert: true,
            },
          };
        }),
        { ordered: false }
      );
    }

    logger.info(`Seed self-report: ${peers.length} peers, ${scripts.size} payout script(s)`);
  }
}

export const seedStatusService = new SeedStatusService();
