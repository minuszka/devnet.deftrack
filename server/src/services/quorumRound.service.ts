import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc } from './rpc.service.js';
import { maxPossibleBan, trackedProfiles, type LlmqProfile } from '../config/llmq.js';
import { QuorumRound, type RoundMember, type RoundStatus } from '../models/QuorumRound.js';
import {
  absenceIsEvidence,
  classifyRound,
  currentRoundHeight,
  expectedRoundHeights,
  roundKeyFor,
} from '../domain/dkgSchedule.js';
import { DevnetOperator } from '../models/DevnetOperator.js';
import { OperatorIndex, hostOf } from '../domain/operatorIndex.js';
import { shouldRefreshRound } from '../domain/collectorPolicy.js';

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

/** Commitments seen for one profile, keyed by the height the round belongs to. */
type ObservedRounds = Map<number, ListExtendedEntry & { quorumHash: string }>;
/** Every tracked profile's commitments from a single listextended call. */
type ObservedByProfile = Map<string, ObservedRounds>;

interface RoundPlan {
  profile: LlmqProfile;
  oldest: number;
  heights: number[];
}

export class QuorumRoundService {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly profiles: LlmqProfile[];

  constructor() {
    this.profiles = trackedProfiles();
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.quorum.intervalMs);
    logger.info(
      `Quorum round collector started for ${this.profiles.map((p) => `${p.llmqName}/${p.dkgInterval}`).join(', ')} ` +
        `(name/dkgInterval, every ${config.quorum.intervalMs} ms)`
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
    const tip = await rpc.getBlockCount();

    // One listextended and one masternode count answer for every profile: the
    // RPC returns all types in a single response, and the available masternode
    // count is a property of the network rather than of a profile. Polling
    // them per profile would triple the round-trips for identical answers.
    const observed = await this.observedQuorums();
    const available = await this.availableMasternodes();

    const plans = await Promise.all(this.profiles.map((p) => this.planProfile(p, tip)));

    // The operator index is one query for all profiles, and is skipped
    // entirely when no profile has a round to write.
    const operators = plans.some((plan) => plan.heights.length > 0)
      ? await this.operatorIndex()
      : new OperatorIndex([]);

    const summary: string[] = [];
    for (const plan of plans) {
      const counts = await this.applyPlan(plan, tip, observed, available, operators);
      summary.push(
        `${plan.profile.llmqName} ${counts.formed}/${counts.failed}/${counts.pending}`
      );
    }

    logger.info(
      `Quorum rounds up to tip ${tip} (formed/failed/pending): ${summary.join(', ')}`
    );
  }

  /**
   * Which heights of one profile still need writing, and how far back its
   * observation window reaches.
   *
   * Split from the write so that the shared lookups above happen once per tick
   * rather than once per profile.
   */
  private async planProfile(p: LlmqProfile, tip: number): Promise<RoundPlan> {
    // Rounds still open plus every round the observation window can still
    // speak about. Anything older is already resolved and immutable.
    const windowSpan = p.dkgInterval * p.signingActiveQuorumCount;
    const oldest = Math.max(0, currentRoundHeight(tip, p.dkgInterval) - windowSpan);

    const existing = await QuorumRound.find({
      llmqName: p.llmqName,
      $or: [{ expectedHeight: { $gte: oldest } }, { status: 'pending' }],
    })
      .select('expectedHeight status detailsComplete')
      .lean();

    const byHeight = new Map(existing.map((r) => [r.expectedHeight, r]));
    const heights = new Set<number>();
    for (const round of existing) {
      if (shouldRefreshRound(round)) heights.add(round.expectedHeight);
    }
    for (const h of expectedRoundHeights(tip, p.dkgInterval)) {
      // New scheduled rounds must be created. Resolved, complete rounds are
      // facts about the past and are deliberately never refreshed.
      if (h >= oldest && shouldRefreshRound(byHeight.get(h))) heights.add(h);
    }

    return { profile: p, oldest, heights: [...heights].sort((a, b) => a - b) };
  }

  private async applyPlan(
    plan: RoundPlan,
    tip: number,
    observed: ObservedByProfile,
    available: number | null,
    operators: OperatorIndex
  ): Promise<{ formed: number; failed: number; pending: number }> {
    const p = plan.profile;
    const seen = observed.get(p.llmqName) ?? new Map();
    // CalculateQuorum returns min(profile size, masternodes available), so the
    // effective size differs per profile even though the count does not.
    const effectiveSize = available === null ? null : Math.min(p.size, available);
    // The oldest commitment listextended still reports for this profile. Below
    // it, a missing commitment is out of the RPC's reach rather than absent.
    const oldestObserved = seen.size > 0 ? Math.min(...seen.keys()) : null;

    let formed = 0;
    let failed = 0;
    let pending = 0;
    let unseeable = 0;

    for (const expectedHeight of plan.heights) {
      const entry = seen.get(expectedHeight);
      const status: RoundStatus = classifyRound({
        tip,
        expectedHeight,
        dkgMiningWindowEnd: p.dkgMiningWindowEnd,
        commitmentSeen: entry !== undefined,
      });

      // Write nothing rather than a verdict the observation cannot support.
      // The height stays absent from the record, which is honest; recording it
      // as failed would be a fabricated failure.
      if (status === 'failed' && !absenceIsEvidence(expectedHeight, oldestObserved)) {
        unseeable++;
        continue;
      }

      if (status === 'formed') formed++;
      else if (status === 'failed') failed++;
      else pending++;

      await this.upsertRound(p, expectedHeight, status, entry, effectiveSize, operators);
    }

    if (unseeable > 0) {
      logger.info(
        `${p.llmqName}: ${unseeable} scheduled round(s) below the oldest commitment ` +
          `listextended still reports (${oldestObserved}) -- not judged`
      );
    }

    // Stamp the moment a round stopped being pending, once. Conditional on the
    // field still being null, so a later poll cannot move it.
    await QuorumRound.updateMany(
      { llmqName: p.llmqName, status: { $ne: 'pending' }, resolvedAt: null },
      { $set: { resolvedAt: new Date() } }
    );

    await this.recomputeConsecutiveFailures(p, plan.oldest);

    return { formed, failed, pending };
  }

  /**
   * llmqName -> creationHeight -> entry, for every tracked profile.
   *
   * A single `quorum listextended` carries all types, so the response is
   * indexed once here instead of being re-requested per profile.
   */
  private async observedQuorums(): Promise<ObservedByProfile> {
    const result = await rpc.call<ListExtendedResult>('quorum', ['listextended'], 'listextended');
    const byProfile: ObservedByProfile = new Map();

    for (const p of this.profiles) {
      const byHeight: ObservedRounds = new Map();
      for (const wrapper of result[p.llmqName] ?? []) {
        for (const [quorumHash, entry] of Object.entries(wrapper)) {
          byHeight.set(entry.creationHeight, { ...entry, quorumHash });
        }
      }
      byProfile.set(p.llmqName, byHeight);
    }
    return byProfile;
  }

  /**
   * Masternodes a quorum can be drawn from. CalculateQuorum returns
   * min(profile size, this), so with fewer masternodes than `size` every
   * masternode is a member of every round -- exactly the mainnet condition
   * under test. The count is network-wide, so it is fetched once and each
   * profile applies its own `size` to it.
   */
  private async availableMasternodes(): Promise<number | null> {
    try {
      const counts = await rpc.call<{ enabled?: number; total?: number }>('masternode', ['count']);
      return counts.enabled ?? counts.total ?? 0;
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
    p: LlmqProfile,
    expectedHeight: number,
    status: RoundStatus,
    entry: (ListExtendedEntry & { quorumHash: string }) | undefined,
    effectiveSize: number | null,
    operators: OperatorIndex
  ): Promise<void> {
    const quorumIndex = entry?.quorumIndex ?? 0;
    const roundKey = roundKeyFor(p.llmqType, expectedHeight, quorumIndex);

    let members: RoundMember[] = [];
    let invalidMembers: string[] = [];
    let observedSize: number | null = effectiveSize;
    let detailsComplete = status === 'failed';

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
      // A null response is transient and must remain retryable. A successful
      // response with zero members is still a complete observation.
      detailsComplete = info !== null;
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
          detailsComplete,
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
   * (rpc/quorums.cpp:192), and none of the tracked profiles is rotated.
   *
   * Scoped to one profile: a streak is a run of failures of the same quorum
   * type, and mixing three interleaved schedules into one sequence would
   * invent streaks that no profile ever had.
   */
  private async recomputeConsecutiveFailures(p: LlmqProfile, fromHeight: number): Promise<void> {
    const rounds = await QuorumRound.find({
      llmqName: p.llmqName,
      expectedHeight: { $gte: Math.max(0, fromHeight - p.dkgInterval * 50) },
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
