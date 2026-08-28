import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc } from './rpc.service.js';
import { chainlockProfileAtHeight, maxPossibleBan } from '../config/llmq.js';
import { MasternodeState } from '../models/MasternodeState.js';
import { MasternodeEvent, type MasternodeEventType } from '../models/MasternodeEvent.js';
import { MasternodeSnapshot } from '../models/MasternodeSnapshot.js';
import { DevnetOperator } from '../models/DevnetOperator.js';
import { OperatorIndex, hostOf } from '../domain/operatorIndex.js';
import { findRemoved } from '../domain/masternodeDiff.js';
import { shouldCollectMasternodes } from '../domain/collectorPolicy.js';

interface ProTxState {
  service?: string;
  registeredHeight?: number;
  lastPaidHeight?: number;
  PoSePenalty?: number;
  PoSeBanHeight?: number;
  PoSeRevivedHeight?: number;
  ownerAddress?: string;
  votingAddress?: string;
  payoutAddress?: string;
  pubKeyOperator?: string;
}
interface ProTxEntry {
  type?: string;
  proTxHash: string;
  collateralHash: string;
  collateralIndex: number;
  collateralAddress?: string;
  state?: ProTxState;
}

/** Re-read the full list and write a snapshot at least this often. */
const HEARTBEAT_MS = 5 * 60_000;

export class MasternodePollerService {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private lastSnapshotAt = 0;
  private lastCounts = '';
  private lastCollectedHeight: number | null = null;
  private lastCollectedAt = 0;

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.masternode.intervalMs);
    logger.info(
      `Masternode poller started (height check every ${config.masternode.intervalMs} ms, ` +
        `full heartbeat every ${HEARTBEAT_MS} ms)`
    );
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
      logger.error(
        `Masternode poll failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.running = false;
    }
  }

  async collect(): Promise<void> {
    // PoSe state is committed by blocks. Avoid the expensive protx + Mongo
    // scans while the chain is at the same height; the heartbeat still
    // catches operator metadata changes and validates the complete state.
    const height = await rpc.getBlockCount();
    const nowMs = Date.now();
    if (!shouldCollectMasternodes({
      height,
      lastHeight: this.lastCollectedHeight,
      nowMs,
      lastCollectedAtMs: this.lastCollectedAt,
      heartbeatMs: HEARTBEAT_MS,
    })) {
      return;
    }

    const [list, operators] = await Promise.all([
      rpc.call<ProTxEntry[]>('protx', ['list', 'registered', 1]),
      this.operatorIndex(),
    ]);

    const previous = new Map(
      (
        await MasternodeState.find()
          .select('proTxHash active banned poSePenalty service operatorLabel hostIp lastSeenAt')
          .lean()
      ).map((s) => [s.proTxHash, s])
    );

    const stateOps: Parameters<typeof MasternodeState.bulkWrite>[0] = [];
    const eventOps: Parameters<typeof MasternodeEvent.bulkWrite>[0] = [];
    const now = new Date();

    let enabled = 0;
    let banned = 0;
    let penaltySum = 0;
    let penaltyMax = 0;
    let penalised = 0;

    for (const entry of list) {
      const st = entry.state ?? {};
      const service = st.service ?? null;
      const penalty = st.PoSePenalty ?? 0;
      const banHeight = st.PoSeBanHeight ?? -1;
      const revivedHeight = st.PoSeRevivedHeight ?? -1;
      const isBanned = banHeight !== -1;
      const hostIp = hostOf(service);
      const operatorLabel = operators.resolve(entry.proTxHash, hostIp);

      if (isBanned) banned++;
      else enabled++;
      penaltySum += penalty;
      penaltyMax = Math.max(penaltyMax, penalty);
      if (penalty > 0) penalised++;

      const prev = previous.get(entry.proTxHash);
      const push = (type: MasternodeEventType, keyPart: number | string, extra: object): void => {
        eventOps.push({
          updateOne: {
            filter: { eventKey: `${entry.proTxHash}:${type}:${keyPart}` },
            update: {
              // $setOnInsert only: an event is a fact about a moment and must
              // never be rewritten by a later poll.
              $setOnInsert: {
                eventKey: `${entry.proTxHash}:${type}:${keyPart}`,
                proTxHash: entry.proTxHash,
                type,
                height,
                operatorLabel,
                hostIp,
                source: 'poll' as const,
                detectedAt: now,
                ...extra,
              },
            },
            upsert: true,
          },
        });
      };

      if (!prev) {
        push('registered', st.registeredHeight ?? height, {
          serviceAfter: service,
          penaltyAfter: penalty,
        });
      } else {
        if (isBanned && !prev.banned) {
          push('banned', banHeight, { penaltyBefore: prev.poSePenalty, penaltyAfter: penalty });
        }
        if (!isBanned && prev.banned) {
          push('revived', revivedHeight === -1 ? height : revivedHeight, {
            penaltyBefore: prev.poSePenalty,
            penaltyAfter: penalty,
          });
        }
        // Only an increase. PoSe penalty decays by one per block, so a
        // penalised node produces a row in every single poll: one ban wave
        // arrived here as 11 bans buried under 247 decay events. The decay is
        // the node serving its sentence, and the current value is already in
        // MasternodeState -- nothing is lost by not logging each step of it.
        if (penalty > prev.poSePenalty) {
          push('penalty_up', `${height}:${penalty}`, {
            penaltyBefore: prev.poSePenalty,
            penaltyAfter: penalty,
          });
        }
        if (service !== prev.service) {
          push('service_changed', `${height}:${service ?? 'none'}`, {
            serviceBefore: prev.service,
            serviceAfter: service,
          });
        }
      }

      stateOps.push({
        updateOne: {
          filter: { proTxHash: entry.proTxHash },
          update: {
            $setOnInsert: { proTxHash: entry.proTxHash, firstSeenAt: now },
            $set: {
              type: entry.type ?? 'Regular',
              collateralHash: entry.collateralHash,
              collateralIndex: entry.collateralIndex,
              collateralAddress: entry.collateralAddress ?? null,
              service,
              registeredHeight: st.registeredHeight ?? -1,
              lastPaidHeight: st.lastPaidHeight ?? 0,
              poSePenalty: penalty,
              poSeBanHeight: banHeight,
              poSeRevivedHeight: revivedHeight,
              banned: isBanned,
              ownerAddress: st.ownerAddress ?? null,
              votingAddress: st.votingAddress ?? null,
              payoutAddress: st.payoutAddress ?? null,
              pubKeyOperator: st.pubKeyOperator ?? null,
              operatorLabel,
              hostIp,
              // Reasserted every poll, so a masternode that comes back after
              // being dropped from the list is live again without a special case.
              active: true,
              removedAt: null,
              lastSeenAt: now,
            },
          },
          upsert: true,
        },
      });
    }

    // A masternode can leave `protx list registered` -- collateral spent, or a
    // ProUpRevTx. Nothing in the loop above would ever touch its row again, so
    // it would stay in the current-state view forever and keep being counted as
    // live. The row is kept for history and marked instead of deleted.
    const listed = new Set(list.map((e) => e.proTxHash));
    for (const prev of findRemoved(previous.values(), listed)) {
      const proTxHash = prev.proTxHash;
      eventOps.push({
        updateOne: {
          filter: { eventKey: `${proTxHash}:removed:${height}` },
          update: {
            $setOnInsert: {
              eventKey: `${proTxHash}:removed:${height}`,
              proTxHash,
              type: 'removed' as MasternodeEventType,
              height,
              operatorLabel: prev.operatorLabel ?? null,
              hostIp: prev.hostIp ?? null,
              source: 'poll' as const,
              serviceBefore: prev.service ?? null,
              penaltyBefore: prev.poSePenalty,
              detectedAt: now,
            },
          },
          upsert: true,
        },
      });

      stateOps.push({
        updateOne: {
          filter: { proTxHash },
          update: { $set: { active: false, removedAt: now, lastSeenAt: prev.lastSeenAt } },
        },
      });
    }

    if (stateOps.length > 0) await MasternodeState.bulkWrite(stateOps, { ordered: false });
    if (eventOps.length > 0) await MasternodeEvent.bulkWrite(eventOps, { ordered: false });

    // Resolved at the snapshot height: after the ChainLock switchover the
    // effective quorum size must come from the profile actually signing.
    const profile = chainlockProfileAtHeight(height);
    const effectiveQuorumSize = Math.min(profile.size, enabled);
    const counts = `${list.length}|${enabled}|${banned}|${penaltySum}|${penaltyMax}`;
    const changed = counts !== this.lastCounts;

    if (changed || Date.now() - this.lastSnapshotAt >= HEARTBEAT_MS) {
      await MasternodeSnapshot.create({
        at: now,
        height,
        total: list.length,
        enabled,
        banned,
        penaltySum,
        penaltyMax,
        penalised,
        effectiveQuorumSize,
        maxPossibleBan: maxPossibleBan(effectiveQuorumSize, profile.minSize),
      });
      this.lastSnapshotAt = Date.now();
      this.lastCounts = counts;
    }

    if (eventOps.length > 0 || changed) {
      logger.info(
        `Masternodes at ${height}: ${enabled} enabled, ${banned} banned, ` +
          `${penalised} penalised (max ${penaltyMax}); ${eventOps.length} transition(s)`
      );
    }

    // Advance only after every write succeeded; a failed pass must be retried
    // on the next cheap height check rather than suppressed for five minutes.
    this.lastCollectedHeight = height;
    this.lastCollectedAt = Date.now();
  }

  private async operatorIndex(): Promise<OperatorIndex> {
    return new OperatorIndex(
      await DevnetOperator.find().select('operatorLabel proTxHashes hostIps').lean()
    );
  }
}

export const masternodePollerService = new MasternodePollerService();
