import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { rpc } from './rpc.service.js';
import { maxPossibleBan, trackedProfiles, type LlmqProfile } from '../config/llmq.js';
import { QuorumRound, type RoundMember, type RoundStatus } from '../models/QuorumRound.js';
import { Block } from '../models/Block.js';
import { MasternodeSnapshot } from '../models/MasternodeSnapshot.js';
import {
  absenceIsEvidence,
  classifyRound,
  currentRoundHeight,
  expectedRoundHeights,
  isSchedulable,
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

/**
 * How many masternode snapshots to hold for the per-round count. Sorted newest
 * first, so this is a window back from the tip; a round older than the window
 * falls back to the current count, exactly as before.
 */
const SNAPSHOT_LOOKBACK = 500;

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
    // How many masternodes each round could actually have drawn from. Loaded
    // once for the whole tick; see `enabledAtHeight`.
    const enabledAt = await this.enabledCountAtHeight(available);

    // The operator index is one query for all profiles, and is skipped
    // entirely when no profile has a round to write.
    const operators = plans.some((plan) => plan.heights.length > 0)
      ? await this.operatorIndex()
      : new OperatorIndex([]);

    const summary: string[] = [];
    for (const plan of plans) {
      const counts = await this.applyPlan(plan, tip, observed, enabledAt, operators);
      summary.push(
        `${plan.profile.llmqName} ${counts.formed}/${counts.failed}/${counts.pending}` +
          (counts.impossible > 0 ? `/${counts.impossible} below minSize` : '')
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
      // facts about the past and are deliberately never refreshed. Heights
      // below the profile's formation gate are not rounds at all -- the node
      // refuses to form the type there -- so they are never planned.
      if (!isSchedulable(h, p.formationGateHeight)) continue;
      if (h >= oldest && shouldRefreshRound(byHeight.get(h))) heights.add(h);
    }

    return { profile: p, oldest, heights: [...heights].sort((a, b) => a - b) };
  }

  private async applyPlan(
    plan: RoundPlan,
    tip: number,
    observed: ObservedByProfile,
    enabledAt: (height: number) => number | null,
    operators: OperatorIndex
  ): Promise<{ formed: number; failed: number; pending: number; impossible: number }> {
    const p = plan.profile;
    const seen = observed.get(p.llmqName) ?? new Map();
    // The oldest commitment listextended still reports for this profile. Below
    // it, a missing commitment is out of the RPC's reach rather than absent.
    const oldestObserved = seen.size > 0 ? Math.min(...seen.keys()) : null;

    let formed = 0;
    let failed = 0;
    let pending = 0;
    let impossible = 0;
    let unseeable = 0;
    let uncounted = 0;

    for (const expectedHeight of plan.heights) {
      // Belt to planProfile's braces: a height below the formation gate must
      // never receive a verdict, whichever path put it in the plan.
      if (!isSchedulable(expectedHeight, p.formationGateHeight)) continue;
      const entry = seen.get(expectedHeight);
      // CalculateQuorum draws from the masternode list AT THE ROUND'S OWN base
      // block, not from today's. Using the current count meant a ban wave
      // reclassified history in both directions: during one (152 enabled down
      // to 21) a round that genuinely failed with 152 members read as
      // `impossible` and was never revisited, and after the revive the rounds
      // that really were impossible read as failures.
      const enabled = enabledAt(expectedHeight);
      const effectiveSize = enabled === null ? null : Math.min(p.size, enabled);
      const status: RoundStatus = classifyRound({
        tip,
        expectedHeight,
        dkgMiningWindowEnd: p.dkgMiningWindowEnd,
        commitmentSeen: entry !== undefined,
        // A profile needing more members than the network has cannot form. That
        // is not the same as failing, and llmq_400_85 -- minSize 350 against a
        // devnet of at most 80 -- would otherwise report a failure at every one
        // of its intervals for as long as the chain runs.
        effectiveSize,
        minSize: p.minSize,
      });

      // Write nothing rather than a verdict the observation cannot support.
      // The height stays absent from the record, which is honest; recording it
      // as failed would be a fabricated failure.
      if (status === 'failed' && !absenceIsEvidence(expectedHeight, oldestObserved)) {
        unseeable++;
        continue;
      }

      // `failed` and `impossible` are told apart by the masternode count, so a
      // count the node did not answer cannot tell them apart -- classifyRound
      // skips the `impossible` branch on a null and falls through to `failed`.
      // Writing it would be a verdict derived from a failed lookup, and
      // shouldRefreshRound never revisits `failed`, so the fabrication would be
      // permanent. Skip the height; the next tick asks again.
      if (status === 'failed' && effectiveSize === null) {
        uncounted++;
        continue;
      }

      if (status === 'formed') formed++;
      else if (status === 'failed') failed++;
      else if (status === 'impossible') impossible++;
      else pending++;

      await this.upsertRound(p, expectedHeight, status, entry, effectiveSize, operators);
    }

    if (unseeable > 0) {
      logger.info(
        `${p.llmqName}: ${unseeable} scheduled round(s) below the oldest commitment ` +
          `listextended still reports (${oldestObserved}) -- not judged`
      );
    }

    if (uncounted > 0) {
      logger.warn(
        `${p.llmqName}: ${uncounted} scheduled round(s) left unjudged -- the masternode ` +
          `count did not answer, so failed and impossible cannot be told apart`
      );
    }

    // Stamp the moment a round stopped being pending, once. Conditional on the
    // field still being null, so a later poll cannot move it.
    await QuorumRound.updateMany(
      { llmqName: p.llmqName, status: { $ne: 'pending' }, resolvedAt: null },
      { $set: { resolvedAt: new Date() } }
    );

    await this.recomputeConsecutiveFailures(p, plan.oldest);

    return { formed, failed, pending, impossible };
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


  /**
   * Enabled masternodes as of a height, from the indexed snapshots.
   *
   * A snapshot is written whenever the counts change and at least every five
   * minutes, so the newest one at or before a height is what the network looked
   * like when that round was drawn. Loaded once per tick rather than per round.
   *
   * Before the first snapshot there is nothing to read, and the current count is
   * used instead -- the old behaviour, and the era it covers is the early chain,
   * where the count was not moving. A tick with no count at all answers null,
   * and a null never becomes a verdict.
   */
  private async enabledCountAtHeight(
    fallback: number | null
  ): Promise<(height: number) => number | null> {
    const rows = await MasternodeSnapshot.find()
      .sort({ height: -1 })
      .limit(SNAPSHOT_LOOKBACK)
      .select('height enabled')
      .lean();
    return (height: number): number | null => {
      for (const row of rows) {
        if (row.height <= height) return row.enabled;
      }
      return fallback;
    };
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
      // The node lists a quorum from the block its commitment is mined in, and
      // can describe it a moment later, once its quorum cache has built it. In
      // that gap `quorum info` answers "quorum not found" for a hash the node
      // itself just listed. That is the transient the null below stands for, so
      // it is declared here instead of being filed as a failure at every round.
      const info = await rpc
        .call<QuorumInfoResult>('quorum', ['info', p.llmqType, entry.quorumHash], undefined, {
          tolerated: /quorum not found/i,
        })
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

    /*
     * The one cross-check the chain can give on a declared profile.
     *
     * No RPC returns a quorum's size, minSize or threshold, so the profile table
     * is taken on trust -- and a table written for one binary is simply wrong
     * under another, or under `-llmqtestparams`. What IS observable is how many
     * members a formed quorum actually has, and that can never exceed the size
     * the node was configured with. When it does, the declaration is wrong, and
     * every round recorded under it carries rules the node was not applying.
     *
     * Only the impossible direction is reported. Fewer members than `size` is
     * ordinary: CalculateQuorum returns min(size, available masternodes), which
     * is what `effectiveSize` records.
     */
    if (observedSize !== null && observedSize > p.size) {
      logger.error(
        `${p.llmqName} round at ${expectedHeight} has ${observedSize} members but the profile ` +
          `declares size ${p.size}; the declared numbers do not match the running node ` +
          `(set LLMQ_PROFILE_OVERRIDES) and every round recorded under them is misattributed`
      );
    }

    // A failed DKG mines no commitment, and the node's punishment loop is
    // guarded by a non-null commitment -- so nobody is punished. That zero is
    // an assertion about consensus, not a missing value.
    const punishedCount =
      status === 'formed' && entry && observedSize !== null
        ? Math.max(0, observedSize - entry.numValidMembers)
        : 0;

    // Reorg handling cuts rounds by minedHeight > forkPoint, but the RPC names
    // the mined block only by hash -- left null, a round whose schedule sat
    // before the fork but whose commitment was mined in an abandoned block
    // never reset. Resolve against the indexed chain; a block not indexed yet
    // stays null and the next poll fills it, which is why this lives in $set
    // rather than $setOnInsert.
    let minedHeight: number | null = null;
    if (entry?.minedBlockHash) {
      const minedBlock = await Block.findOne({ hash: entry.minedBlockHash }).select('height').lean();
      minedHeight = minedBlock?.height ?? null;
      // "the next poll fills it" was only true when the block happened to be
      // indexed already: shouldRefreshRound refuses a round once
      // detailsComplete is set, and it was set on the `quorum info` answer
      // alone. This collector runs at the node's tip while the block indexer
      // lags behind it, so a round resolved just after its commitment was mined
      // kept minedHeight null for ever -- and the reorg reset cuts on
      // minedHeight, so exactly those rounds, the freshly mined ones and the
      // likeliest to be reorged away, were the ones it could not reach.
      if (minedHeight === null) detailsComplete = false;
    }

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
          minedHeight,
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
