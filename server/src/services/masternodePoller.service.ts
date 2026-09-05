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
  /** Sentinel Layer service ledger; absent on a node predating the DSL build. */
  missedServiceEpochs?: number;
  lastServiceEpoch?: number;
  rewardSuspended?: boolean;
  dslBanHeight?: number;
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
          .select(
            'proTxHash active banned poSePenalty service operatorLabel hostIp lastSeenAt ' +
              'missedServiceEpochs rewardSuspended dslBanHeight'
          )
          .lean()
      ).map((s) => [s.proTxHash, s])
    );

    // An empty `protx list` while the index holds masternodes is not a network
    // in which every collateral was spent at once; it is a node that cannot
    // answer properly yet -- a reindex at a low height, or a warmup that
    // answers with an empty list rather than an error. Acting on it writes a
    // `removed` event for every masternode on the network, and those rows stay
    // in the record after the next poll quietly re-registers them.
    if (list.length === 0 && previous.size > 0) {
      logger.warn(
        `protx list returned no masternodes while ${previous.size} are indexed; ` +
          'skipping this poll rather than recording a network-wide removal'
      );
      return;
    }

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
      const missedServiceEpochs = st.missedServiceEpochs ?? 0;
      const lastServiceEpoch = st.lastServiceEpoch ?? 0;
      const rewardSuspended = st.rewardSuspended ?? false;
      const dslBanHeight = st.dslBanHeight ?? -1;
      const hostIp = hostOf(service);
      const operatorLabel = operators.resolve(entry.proTxHash, hostIp);

      if (isBanned) banned++;
      else enabled++;
      penaltySum += penalty;
      penaltyMax = Math.max(penaltyMax, penalty);
      if (penalty > 0) penalised++;

      const prev = previous.get(entry.proTxHash);
      /**
       * The poller writes only what `protx listdiff` cannot report.
       *
       * Both writers used to record the same chain transitions, and their keys
       * agreed for only some of them. `banned`, `revived` and `registered`
       * collided on an exact chain height, so the poller's row won and the
       * walker's block-exact one was a silent no-op. `penalty_up`,
       * `service_changed` and `removed` did not collide -- the poller keys them
       * on the height it happened to poll at -- so every one of those was
       * written TWICE, and every closed experiment counted them twice.
       *
       * The walker owns the chain transitions: it reads them from the chain at
       * their own heights, and the reorg rollback drops them again when the
       * blocks that carried them are abandoned. Nothing here can say either of
       * those things. What is left for the poller is the Sentinel ledger, which
       * `MnStateDiff` does not carry at all.
       */
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

      if (prev) {

        // Sentinel Layer transitions. A masternode can miss at most one epoch
        // per epoch (hourly), so unlike the PoSe penalty decay every step is
        // signal worth a row. Fields may be absent on rows written before the
        // DSL columns existed, so default them.
        const prevMissed = prev.missedServiceEpochs ?? 0;
        const prevSuspended = prev.rewardSuspended ?? false;
        const prevDslBan = prev.dslBanHeight ?? -1;
        if (missedServiceEpochs > prevMissed) {
          push('service_missed', `${height}:${missedServiceEpochs}`, {});
        }
        // A miss counter that falls to zero is the node's ONLINE reset -- in
        // shadow that includes the "too few reports" case, which is exactly the
        // measurement caveat the reviewer flagged; the explorer records the
        // node's verdict, it does not second-guess it.
        if (prevMissed > 0 && missedServiceEpochs === 0) {
          push('service_recovered', `${height}:${lastServiceEpoch}`, {});
        }
        if (rewardSuspended && !prevSuspended) {
          push('service_suspended', `${height}`, {});
        }
        if (dslBanHeight !== -1 && prevDslBan === -1) {
          push('service_banned', dslBanHeight, {});
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
              missedServiceEpochs,
              lastServiceEpoch,
              rewardSuspended,
              dslBanHeight,
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
      // The `removed` EVENT belongs to the walker, which sees the removal at
      // its own height; this one was keyed on whatever height the poll happened
      // to land on, so the two never collided and every removal was recorded
      // twice. What still belongs here is the state: nothing in the loop above
      // would touch this row again, so without the mark it stays in the
      // current-state view for ever and keeps being counted as live.
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
