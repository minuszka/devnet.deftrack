import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc } from './rpc.service.js';
import { chainlockProfile, maxPossibleBan } from '../config/llmq.js';
import { MasternodeState } from '../models/MasternodeState.js';
import { MasternodeEvent, type MasternodeEventType } from '../models/MasternodeEvent.js';
import { MasternodeSnapshot } from '../models/MasternodeSnapshot.js';
import { DevnetOperator } from '../models/DevnetOperator.js';
import { OperatorIndex, hostOf } from '../domain/operatorIndex.js';

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

/** A snapshot is written at least this often even when nothing changes. */
const HEARTBEAT_MS = 5 * 60_000;

export class MasternodePollerService {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private lastSnapshotAt = 0;
  private lastCounts = '';

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.masternode.intervalMs);
    logger.info(`Masternode poller started (every ${config.masternode.intervalMs} ms)`);
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
    const [height, list, operators] = await Promise.all([
      rpc.getBlockCount(),
      rpc.call<ProTxEntry[]>('protx', ['list', 'registered', 1]),
      this.operatorIndex(),
    ]);

    const previous = new Map(
      (await MasternodeState.find().lean()).map((s) => [s.proTxHash, s])
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
        if (penalty !== prev.poSePenalty) {
          push(penalty > prev.poSePenalty ? 'penalty_up' : 'penalty_down', `${height}:${penalty}`, {
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
              lastSeenAt: now,
            },
          },
          upsert: true,
        },
      });
    }

    if (stateOps.length > 0) await MasternodeState.bulkWrite(stateOps, { ordered: false });
    if (eventOps.length > 0) await MasternodeEvent.bulkWrite(eventOps, { ordered: false });

    const profile = chainlockProfile();
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
  }

  private async operatorIndex(): Promise<OperatorIndex> {
    return new OperatorIndex(
      await DevnetOperator.find().select('operatorLabel proTxHashes hostIps').lean()
    );
  }
}

export const masternodePollerService = new MasternodePollerService();
