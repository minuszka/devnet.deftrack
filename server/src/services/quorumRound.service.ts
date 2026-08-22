import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc } from './rpc.service.js';
import { chainlockProfile, maxPossibleBan, type LlmqProfile } from '../config/llmq.js';
import { QuorumRound, type RoundMember, type RoundStatus } from '../models/QuorumRound.js';
import { classifyRound, currentRoundHeight, expectedRoundHeights, roundKeyFor } from '../domain/dkgSchedule.js';
import { DevnetOperator } from '../models/DevnetOperator.js';
import { OperatorIndex, hostOf } from '../domain/operatorIndex.js';

/**
 * `quorum listextended` shape (rpc/quorums.cpp:138-166):
 *
 *   { "llmq_400_60": [ { "<quorumHash>": { creationHeight, minedBlockHash,
 *                                          numValidMembers, healthRatio } } ] }
 *
 * healthRatio is a string with two decimals, and quorumIndex appears only for
 * rotated profiles.
 */
interface ListExtendedEntry {
  creationHeight: number;
  minedBlockHash: string;
  numValidMembers: number;
  healthRatio: string;
  quorumIndex?: number;
}
type ListExtendedResult = Record<string, Array<Record<string, ListExtendedEntry>>>;

interface QuorumInfoMember {
  proTxHash: string;
  service: string;
  pubKeyOperator: string;
  valid: boolean;
}
interface QuorumInfoResult {
  height: number;
  type: string;
  quorumHash: string;
  quorumIndex: number;
  minedBlock: string;
  members?: QuorumInfoMember[];
  quorumPublicKey: string;
}

export class QuorumRoundService {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly profile: LlmqProfile;

  constructor() {
    this.profile = chainlockProfile();
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.quorum.intervalMs);
    logger.info(
      `Quorum round collector started for ${this.profile.llmqName} ` +
        `(dkgInterval ${this.profile.dkgInterval}, every ${config.quorum.intervalMs} ms)`
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
      logger.error(`Quorum round collection failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  async collect(): Promise<void> {
    const p = this.profile;
    const tip = await rpc.getBlockCount();

    const observed = await this.observedQuorums();
    const operators = await this.operatorIndex();
    const effectiveSize = await this.effectiveSize();

    // Rounds still open plus every round the observation window can still
    // speak about. Anything older is already resolved and immutable.
    const windowSpan = p.dkgInterval * p.signingActiveQuorumCount;
    const oldest = Math.max(0, currentRoundHeight(tip, p.dkgInterval) - windowSpan);

    const unresolved = await QuorumRound.find({ llmqName: p.llmqName, status: 'pending' })
      .select('expectedHeight')
      .lean();

    const heights = new Set<number>(unresolved.map((r) => r.expectedHeight));
    for (const h of expectedRoundHeights(tip, p.dkgInterval)) {
      if (h >= oldest) heights.add(h);
    }

    let formed = 0;
    let failed = 0;
    let pending = 0;

    for (const expectedHeight of [...heights].sort((a, b) => a - b)) {
      const entry = observed.get(expectedHeight);
      const status: RoundStatus = classifyRound({
        tip,
        expectedHeight,
        dkgMiningWindowEnd: p.dkgMiningWindowEnd,
        commitmentSeen: entry !== undefined,
      });

      if (status === 'formed') formed++;
      else if (status === 'failed') failed++;
      else pending++;

      await this.upsertRound(expectedHeight, status, entry, effectiveSize, operators);
    }

    await this.recomputeConsecutiveFailures(oldest);

    logger.info(
      `Quorum rounds up to tip ${tip}: ${formed} formed, ${failed} failed, ${pending} pending ` +
        `(window from height ${oldest})`
    );
  }

  /** creationHeight -> entry, for the tracked profile only. */
  private async observedQuorums(): Promise<Map<number, ListExtendedEntry & { quorumHash: string }>> {
    const result = await rpc.call<ListExtendedResult>('quorum', ['listextended'], 'listextended');
    const byHeight = new Map<number, ListExtendedEntry & { quorumHash: string }>();

    for (const wrapper of result[this.profile.llmqName] ?? []) {
      for (const [quorumHash, entry] of Object.entries(wrapper)) {
        byHeight.set(entry.creationHeight, { ...entry, quorumHash });
      }
    }
    return byHeight;
  }

  /**
   * What CalculateQuorum would return: min(profile size, masternodes available).
   * With fewer masternodes than `size`, every masternode is a member of every
   * round -- which is exactly the mainnet condition under test.
   */
  private async effectiveSize(): Promise<number | null> {
    try {
      const counts = await rpc.call<{ enabled?: number; total?: number }>('masternode', ['count']);
      const available = counts.enabled ?? counts.total ?? 0;
      return Math.min(this.profile.size, available);
    } catch {
      return null;
    }
  }

  private async operatorIndex(): Promise<OperatorIndex> {
    return new OperatorIndex(
      await DevnetOperator.find().select('operatorLabel proTxHashes hostIps').lean()
    );
  }

  private async upsertRound(
    expectedHeight: number,
    status: RoundStatus,
    entry: (ListExtendedEntry & { quorumHash: string }) | undefined,
    effectiveSize: number | null,
    operators: OperatorIndex
  ): Promise<void> {
    const p = this.profile;
    const quorumIndex = entry?.quorumIndex ?? 0;
    const roundKey = roundKeyFor(p.llmqType, expectedHeight, quorumIndex);

    let members: RoundMember[] = [];
    let invalidMembers: string[] = [];
    let observedSize: number | null = effectiveSize;

    if (entry) {
      const info = await rpc
        .call<QuorumInfoResult>('quorum', ['info', p.llmqType, entry.quorumHash])
        .catch(() => null);

      members = (info?.members ?? []).map((m) => ({
        proTxHash: m.proTxHash,
        service: m.service || null,
        valid: m.valid,
        operatorLabel: operators.resolve(m.proTxHash, hostOf(m.service)),
      }));
      invalidMembers = members.filter((m) => !m.valid).map((m) => m.proTxHash);
      if (members.length > 0) observedSize = members.length;
    }

    // A failed DKG mines no commitment, and the node's punishment loop is
    // guarded by a non-null commitment -- so nobody is punished. That zero is
    // an assertion about consensus, not a missing value.
    const punishedCount =
      status === 'formed' && entry && observedSize !== null
        ? Math.max(0, observedSize - entry.numValidMembers)
        : 0;

    await QuorumRound.updateOne(
      { roundKey },
      {
        $setOnInsert: {
          roundKey,
          llmqType: p.llmqType,
          llmqName: p.llmqName,
          quorumIndex,
          expectedHeight,
          size: p.size,
          minSize: p.minSize,
          threshold: p.threshold,
          dkgInterval: p.dkgInterval,
          firstSeenAt: new Date(),
        },
        $set: {
          quorumHash: entry?.quorumHash ?? null,
          minedBlockHash: entry?.minedBlockHash ?? null,
          minedHeight: null,
          effectiveSize: observedSize,
          numValidMembers: entry ? entry.numValidMembers : null,
          healthRatio: entry ? Number.parseFloat(entry.healthRatio) : null,
          status,
          formed: status === 'formed',
          members,
          invalidMembers,
          punishedCount,
          maxPossibleBan: observedSize !== null ? maxPossibleBan(observedSize, p.minSize) : null,
          detectedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  /**
   * Consecutive failures immediately preceding each round.
   *
   * Derived rather than read: the node only reports
   * previousConsecutiveDKGFailures for rotated profiles
   * (rpc/quorums.cpp:192), and the ChainLock profile is not rotated.
   */
  private async recomputeConsecutiveFailures(fromHeight: number): Promise<void> {
    const rounds = await QuorumRound.find({
      llmqName: this.profile.llmqName,
      expectedHeight: { $gte: Math.max(0, fromHeight - this.profile.dkgInterval * 50) },
    })
      .sort({ expectedHeight: 1 })
      .select('roundKey status consecutiveFailures')
      .lean();

    let streak = 0;
    const ops = [];
    for (const round of rounds) {
      if (round.consecutiveFailures !== streak) {
        ops.push({
          updateOne: { filter: { roundKey: round.roundKey }, update: { $set: { consecutiveFailures: streak } } },
        });
      }
      // A pending round neither breaks nor extends the streak yet.
      if (round.status === 'failed') streak++;
      else if (round.status === 'formed') streak = 0;
    }
    if (ops.length > 0) await QuorumRound.bulkWrite(ops, { ordered: false });
  }
}

export const quorumRoundService = new QuorumRoundService();
