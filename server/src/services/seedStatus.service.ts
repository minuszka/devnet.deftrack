import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc, RpcService } from './rpc.service.js';
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
 *
 * The same argument reaches one step further. This machine runs a second
 * staking daemon, and its wallet is not the seed's -- so its payout script
 * appeared in no host's report and its blocks read as unattributed: 22 in every
 * 500 measured on 2026-09-08, which is by itself enough to hold `byHost.hhi` at
 * null, since that index is deliberately withheld while any producer is
 * unmapped. Reading the peer's wallet too closes the gap at its source, and
 * keeps closing it as the daemon stakes and mints keys nobody declared.
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
  /** Built on first use, and only when a second daemon is actually configured. */
  private peer: RpcService | null = null;

  /**
   * The second staking daemon on this machine, or null when none is declared.
   *
   * A port alone is not enough: this reads a wallet, so it is off until
   * credentials are given too. `config.peerRpc` may be absent entirely in a
   * caller that stubs the config, and that reads as "no second daemon".
   */
  private peerRpc(): RpcService | null {
    const cfg = config.peerRpc;
    if (!cfg || !cfg.port || !cfg.user || !cfg.pass) return null;
    this.peer ??= new RpcService(cfg, 'peer:');
    return this.peer;
  }

  /**
   * The payout scripts a wallet's unspent outputs can produce, from one node.
   *
   * Pulled out of `report` so the second daemon is read by the same rules as
   * the first -- the stakeable-range filter and the pay-to-pubkey shortcut
   * included. A second copy of this arithmetic would be a second place for the
   * two to drift apart.
   */
  private async payoutScripts(node: RpcService, unspent: readonly Unspent[]): Promise<Set<string>> {
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
      const info = await node
        .call<{ pubkey?: string }>('getaddressinfo', [u.address])
        .catch(() => null);
      const pubkey = info?.pubkey;
      if (pubkey && pubkey.length === 66) scripts.add(`21${pubkey.toLowerCase()}ac`);
    }
    return scripts;
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    logger.info(`Seed self-report started (every ${INTERVAL_MS} ms)`);
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
    // null means the node did not answer, which is not the same fact as an
    // empty answer. Writing the empty case would report zero peers, zero
    // verified masternodes and no payout scripts for a seed that is simply
    // busy -- and the measurement then reads its blocks as unattributed for as
    // long as the row stands.
    const [unspent, peers, height] = await Promise.all([
      rpc.call<Unspent[]>('listunspent', [0, 9_999_999]).catch(() => null),
      rpc.call<PeerInfo[]>('getpeerinfo').catch(() => null),
      rpc.getBlockCount().catch(() => null),
    ]);

    const scripts = await this.payoutScripts(rpc, unspent ?? []);

    // The second staking daemon on this machine, folded into the same host.
    //
    // `byHost` groups production by machine, so two daemons on one box are one
    // entry: giving the peer a label of its own would read as a ninth machine
    // and understate exactly the concentration the index is there to show.
    //
    // A configured peer that does not answer is not an empty peer. Its scripts
    // are simply unknown this pass, and writing the seed's alone would publish
    // a payout list that is short by a producer -- the same failure this
    // service already refuses for the seed itself.
    const peer = this.peerRpc();
    let peerRead = true;
    if (peer) {
      const peerUnspent = await peer.call<Unspent[]>('listunspent', [0, 9_999_999]).catch(() => null);
      if (peerUnspent === null) {
        peerRead = false;
        logger.warn('Seed self-report: peer daemon did not answer; payout scripts left as they were');
      } else {
        for (const script of await this.payoutScripts(peer, peerUnspent)) scripts.add(script);
      }
    }

    // Only what was actually read is written. A field whose source did not
    // answer is left out of the $set entirely, so the previous observation
    // stands until a real one replaces it.
    const update: Record<string, unknown> = {
      host: 'seed',
      clockOffsetMs: await localClockService.current(),
      agentVersion: 'explorer',
      reportedAt: new Date(),
    };

    if (peers !== null) {
      const pings = peers
        .map((p) => p.pingtime)
        .filter((v): v is number => typeof v === 'number')
        .map((v) => v * 1000)
        .sort((a, b) => a - b);
      const mid = pings.length / 2;
      update.medianPingMs = pings.length
        ? pings.length % 2 === 1
          ? pings[(pings.length - 1) / 2]!
          : (pings[mid - 1]! + pings[mid]!) / 2
        : null;
      update.peers = peers.length;
      update.inbound = peers.filter((p) => p.inbound).length;
      update.verifiedMasternodes = peers.filter((p) => p.verified_proregtx_hash).length;
      update.maxPingWaitMs = peers.length
        ? Math.max(...peers.map((p) => (p.pingwait ?? 0) * 1000))
        : 0;
    }
    if (height !== null) update.height = height;
    // Written only when every configured wallet was actually read. The
    // append-only sightings below are not gated the same way: each one records
    // a script a host really did hold at that height, and a pass that saw
    // fewer of them leaves a gap rather than an error.
    if (unspent !== null && peerRead) update.stakeScripts = [...scripts].sort();

    await HostStatus.updateOne({ host: 'seed' }, { $set: update }, { upsert: true });

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

    logger.info(
      `Seed self-report: ${peers === null ? 'peers unavailable' : `${peers.length} peers`}, ` +
        `${unspent === null ? 'unspent unavailable' : `${scripts.size} payout script(s)`}`
    );
  }
}

export const seedStatusService = new SeedStatusService();
