/**
 * Synthetic API fixtures for the browser tests.
 *
 * Two rules govern this file.
 *
 * Every value in it is invented. Nothing may be copied from the live devnet --
 * no real host address, no operator identity, no proTxHash, no credential --
 * because a fixture is checked into a public repository and a screenshot of one
 * ends up in a CI artifact.
 *
 * What it does borrow from production is the *shape*. The factories return the
 * shared DTOs rather than loose objects, so a field renamed in `shared/` breaks
 * the client typecheck here instead of quietly leaving a fixture the real
 * server would never send -- which is the failure mode that makes a green
 * browser suite worthless.
 */
import type {
  BlockArrivalReport,
  BlockRow,
  ChainLockReport,
  ExperimentRow,
  HealthSnapshot,
  HealthTimeline,
  LlmqProfileView,
  MasternodeTimelinePoint,
  Page as PageEnvelope,
  PeerPropagation,
  QuorumRoundDetail,
  QuorumRoundListItem,
  SelectionFairness,
  StakingHealth,
  TxRow,
} from '@devnet-deftrack/shared';

/** A fixed instant, so nothing in a fixture depends on the wall clock. */
export const FIXED_NOW_ISO = '2026-09-11T09:00:00.000Z';

/** The ChainLock profile switchover, as the real registry declares it. */
export const V1_PROFILE = 'llmq_400_60';
export const V2_PROFILE = 'llmq_defcon';
export const ACTIVATION_HEIGHT = 3240;

/** A tip well past the switchover: the overview must resolve to V2_PROFILE. */
export const TIP_HEIGHT = 11_500;

export function healthSnapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    status: 'ok',
    failing: [],
    devnet: 'defcon-q60',
    uptimeSeconds: 86_400,
    mongo: 'ok',
    chainTip: TIP_HEIGHT,
    indexedHeight: TIP_HEIGHT,
    indexedBlocks: TIP_HEIGHT + 1,
    behind: 0,
    rounds: { formed: 900, failed: 12, pending: 1, impossible: 0 },
    nodeVersion: '22.1.5',
    masternodes: { total: 152, enabled: 152 },
    stakers: { active: 9, windowBlocks: 500 },
    ...overrides,
  };
}

export function chainLockReport(overrides: Partial<ChainLockReport> = {}): ChainLockReport {
  return {
    firstLockedHeight: 3120,
    blocksConsidered: 50,
    eligible: 50,
    locked: 50,
    unlocked: 0,
    coverage: 1,
    gaps: [],
    latencyMeasured: 50,
    latencySec: { p50: 2, p90: 5, max: 7 },
    eventLatencyMeasured: 50,
    eventLatencyMs: { p50: 1800, p90: 4200, max: 6900 },
    sourceCounts: { zmq: 50, poll: 0, unknown: 0 },
    signers: {
      v1: V1_PROFILE,
      v2: V2_PROFILE,
      activationHeight: ACTIVATION_HEIGHT,
      firstV2LockedHeight: 3264,
      counts: { v1: 0, v2: 50 },
    },
    resolutionSec: 5,
    reconciliationIntervalSec: 60,
    points: [],
    ...overrides,
  };
}

export function healthTimeline(overrides: Partial<HealthTimeline> = {}): HealthTimeline {
  const summary = {
    rounds: 24,
    formed: 23,
    failed: 1,
    pending: 0,
    formationRate: 23 / 24,
    medianHealthRatio: 0.98,
    worstHealthRatio: 0.82,
    longestFailureStreak: 1,
    ...overrides.summary,
  };
  return {
    hours: 168,
    llmqName: V2_PROFILE,
    points: [
      {
        expectedHeight: 11_400,
        detectedAt: FIXED_NOW_ISO,
        status: 'formed',
        healthRatio: 0.98,
        numValidMembers: 59,
        effectiveSize: 60,
        punishedCount: 1,
      },
    ],
    ...overrides,
    summary,
  };
}

export function roundListItem(overrides: Partial<QuorumRoundListItem> = {}): QuorumRoundListItem {
  const expectedHeight = overrides.expectedHeight ?? 11_400;
  return {
    roundKey: `7:${expectedHeight}:0`,
    llmqName: V2_PROFILE,
    llmqType: 7,
    formsOnV23Mainnet: true,
    quorumIndex: 0,
    expectedHeight,
    status: 'formed',
    formed: true,
    quorumHash: 'a'.repeat(64),
    minedBlockHash: 'b'.repeat(64),
    size: 60,
    minSize: 44,
    threshold: 41,
    dkgInterval: 24,
    effectiveSize: 60,
    numValidMembers: 59,
    healthRatio: 59 / 60,
    punishedCount: 1,
    maxPossibleBan: 16,
    consecutiveFailures: 0,
    membershipChurn: {
      previousExpectedHeight: expectedHeight - 24,
      previousEffectiveSize: 60,
      membershipDelta: 0,
      joined: 0,
      left: 0,
      punishedJoiners: 0,
      punishmentExplainedByJoiners: false,
    },
    invalidMemberCount: 1,
    failuresByOperator: [{ operatorLabel: 'op-fixture-1', count: 1 }],
    detectedAt: FIXED_NOW_ISO,
    ...overrides,
  };
}

export function roundDetail(overrides: Partial<QuorumRoundDetail> = {}): QuorumRoundDetail {
  // The list row minus the two fields only a list carries, plus the two only a
  // detail carries. Derived rather than retyped, so the two fixtures cannot
  // drift into describing different rounds.
  const { invalidMemberCount, failuresByOperator, ...base } = roundListItem();
  void invalidMemberCount;
  void failuresByOperator;
  return {
    ...base,
    invalidMembers: ['c'.repeat(64)],
    members: [
      { proTxHash: 'c'.repeat(64), service: 'host-fixture-1:19799', valid: false, operatorLabel: 'op-fixture-1' },
      { proTxHash: 'd'.repeat(64), service: 'host-fixture-2:19799', valid: true, operatorLabel: 'op-fixture-2' },
    ],
    mainnetNote: 'Fixture profile; this note is invented.',
    ...overrides,
  };
}

/** A short, descending run of rounds -- newest first, as the server serves them. */
export function roundRun(count: number, startHeight = 11_400): QuorumRoundListItem[] {
  return Array.from({ length: count }, (_unused, i) =>
    roundListItem({ expectedHeight: startHeight - i * 24 })
  );
}

export function llmqProfile(overrides: Partial<LlmqProfileView> = {}): LlmqProfileView {
  return {
    llmqName: V2_PROFILE,
    llmqType: 7,
    size: 60,
    minSize: 44,
    threshold: 41,
    dkgInterval: 24,
    tracked: true,
    formsOnV23Mainnet: true,
    mainnetNote: 'Fixture profile; this note is invented.',
    formationGateHeight: 3120,
    ...overrides,
  };
}

export function masternodeTimelinePoint(
  overrides: Partial<MasternodeTimelinePoint> = {}
): MasternodeTimelinePoint {
  return {
    at: FIXED_NOW_ISO,
    height: TIP_HEIGHT,
    total: 152,
    enabled: 152,
    banned: 0,
    penalised: 0,
    penaltyMax: 0,
    effectiveQuorumSize: 60,
    maxPossibleBan: 16,
    ...overrides,
  };
}

export function experimentRow(overrides: Partial<ExperimentRow> = {}): ExperimentRow {
  return {
    runKey: 'fixture-run-0001',
    title: 'Fixture run',
    hypothesis: 'A fixture proves nothing about the network.',
    expected: 'The page renders the row.',
    status: 'closed',
    startedAt: FIXED_NOW_ISO,
    endedAt: FIXED_NOW_ISO,
    startHeight: 11_000,
    endHeight: 11_100,
    nodeVersion: '22.1.5',
    nodeGitSha: null,
    profile: {
      llmqName: V2_PROFILE,
      size: 60,
      minSize: 44,
      threshold: 41,
      dkgInterval: 24,
      formsOnV23Mainnet: true,
    },
    participants: { masternodes: 152, hosts: 16, stakers: 9 },
    intervention: null,
    baselineRunKey: null,
    outcome: null,
    notes: null,
    ...overrides,
  };
}

/** The page envelope, with a `total` that is the true match count. */
export function pageOf<T>(items: T[], overrides: Partial<PageEnvelope<T>> = {}): PageEnvelope<T> {
  return {
    items,
    total: items.length,
    limit: 25,
    offset: 0,
    ...overrides,
  };
}

/** A fairness answer, shaped like the route's. */
export function selectionFairness(
  overrides: Partial<SelectionFairness> = {}
): SelectionFairness {
  const nodes = Array.from({ length: 5 }, (_unused, i) => ({
    proTxHash: `${'e'.repeat(15)}${i}`,
    operatorLabel: 'op-fixture-1',
    host: 'host-fixture-1',
    timesSelected: 20 - i,
    timesInvalid: i === 0 ? 2 : 0,
    selectionRate: (20 - i) / 50,
    invalidRate: i === 0 ? 0.1 : null,
  }));
  return {
    roundsConsidered: 50,
    expectedSelectionRate: 0.3947,
    minSamples: 5,
    llmqName: V2_PROFILE,
    heightRange: { from: 10_224, to: 11_400 },
    nodes,
    hosts: [
      {
        host: 'host-fixture-1',
        // Seven registered, five of them drawn by this window: the two numbers
        // the table used to conflate.
        currentRegisteredNodes: 7,
        nodes: 5,
        timesSelected: 90,
        timesInvalid: 2,
        invalidRate: 2 / 90,
      },
      {
        host: 'host-fixture-quiet',
        currentRegisteredNodes: 3,
        nodes: 0,
        timesSelected: 0,
        timesInvalid: 0,
        invalidRate: null,
      },
    ],
    neverSelected: [],
    neverSelectedCount: 0,
    totals: { nodesCounted: 5, timesSelected: 90, timesInvalid: 2, worstInvalidRate: 0.1 },
    ...overrides,
  };
}

/* ── day 11: the remaining pages that carry a control ─────────────────────── */

export function blockArrivalReport(
  overrides: Partial<BlockArrivalReport> = {}
): BlockArrivalReport {
  return {
    blocksConsidered: 500,
    measured: 480,
    unmeasured: 20,
    firstMeasuredHeight: TIP_HEIGHT - 499,
    lastMeasuredHeight: TIP_HEIGHT,
    lagSec: { min: 0, p50: 2, p90: 7, p99: 82, max: 448 },
    late: [{ thresholdSec: 120, blocks: 7, share: 0.0146 }],
    slowest: [{ height: TIP_HEIGHT - 12, time: 1_757_000_000, lagSec: 448 }],
    points: [{ height: TIP_HEIGHT, time: 1_757_000_100, lagSec: 2 }],
    zmqEnabled: true,
    ...overrides,
  };
}

export function peerPropagation(overrides: Partial<PeerPropagation> = {}): PeerPropagation {
  return {
    topic: 'block',
    hostsReporting: ['host-a', 'host-b'],
    events: [
      {
        hash: 'f'.repeat(64),
        height: TIP_HEIGHT,
        hosts: 2,
        firstHost: 'host-a',
        lastHost: 'host-b',
        spreadMs: 420,
        medianDelayMs: 210,
        uncertaintyMs: 50,
        uncertaintyIsLowerBound: false,
        clockUnknownHosts: [],
        withinNoise: false,
        missingHosts: [],
        delays: [
          { host: 'host-a', delayMs: 0 },
          { host: 'host-b', delayMs: 420 },
        ],
      },
    ],
    laggards: [{ host: 'host-b', samples: 12, meanDelayMs: 380, lastPlaceShare: 0.75 }],
    hosts: [
      {
        host: 'host-a',
        peers: 9,
        inbound: 3,
        verifiedMasternodes: 2,
        medianPingMs: 18,
        height: TIP_HEIGHT,
        clockOffsetMs: 4,
        agentVersion: '/DeFCoN:22.1.5/',
        nodeBuild: 'd067c3dd6ba9a29eb86797db75816a47',
        reportedAt: FIXED_NOW_ISO,
      },
    ],
    ...overrides,
  };
}

export function stakingHealth(overrides: Partial<StakingHealth> = {}): StakingHealth {
  const windowBlocks = overrides.windowBlocks ?? 500;
  return {
    blocks: windowBlocks,
    windowBlocks,
    fromHeight: TIP_HEIGHT - windowBlocks + 1,
    toHeight: TIP_HEIGHT,
    medianIntervalSec: 112,
    meanIntervalSec: 161,
    longestGapSec: 454,
    stallCount: 0,
    distinctStakers: 9,
    hhi: 0.1179,
    gini: 0.21,
    topStakerShare: 0.16,
    stakers: [
      { payee: 'PfixtureStaker1', blocks: 80, share: 0.16, host: 'fullnode-1' },
      { payee: 'PfixtureStaker2', blocks: 60, share: 0.12, host: 'fullnode-2' },
    ],
    byHost: {
      distinctHosts: 9,
      hhi: 0.1179,
      topHostShare: 0.16,
      unattributedBlocks: 0,
      hosts: [
        { host: 'fullnode-1', blocks: 80, share: 0.16 },
        { host: 'fullnode-2', blocks: 60, share: 0.12 },
      ],
    },
    ...overrides,
  };
}

export function blockRow(overrides: Partial<BlockRow> = {}): BlockRow {
  const height = overrides.height ?? TIP_HEIGHT;
  return {
    height,
    hash: `${String(height).padStart(8, '0')}${'b'.repeat(56)}`,
    time: Date.parse(FIXED_NOW_ISO) / 1_000 - (TIP_HEIGHT - height) * 150,
    nTx: 2,
    size: 1_024,
    isProofOfStake: true,
    hasChainLock: true,
    totalOutSat: '50000000000',
    masternodePaidSat: '25000000000',
    burnedSat: '0',
    stakePaidSat: '50000000000',
    payee: 'PfixturePayee1',
    ...overrides,
  };
}

export function blockRun(count: number, topHeight = TIP_HEIGHT): BlockRow[] {
  return Array.from({ length: count }, (_unused, i) => blockRow({ height: topHeight - i }));
}

export function txRow(overrides: Partial<TxRow> = {}): TxRow {
  const height = overrides.height ?? TIP_HEIGHT;
  return {
    txid: `${String(height).padStart(8, '0')}${'d'.repeat(56)}`,
    height,
    time: Date.parse(FIXED_NOW_ISO) / 1_000,
    size: 226,
    type: 0,
    isCoinbase: false,
    isCoinstake: false,
    hasChainLock: true,
    valueOutSat: '1000000000',
    stakePaidSat: null,
    voutCount: 2,
    vinCount: 1,
    ...overrides,
  };
}

export function txRun(count: number, topHeight = TIP_HEIGHT): TxRow[] {
  return Array.from({ length: count }, (_unused, i) => txRow({ height: topHeight - i }));
}
