/**
 * Types and constants shared between the server and the client.
 */

/** Devnet network name. Every node must pass the identical `-devnet=` value. */
export const DEVNET_NAME = 'defcon-q60';

/**
 * Shown in the client header so devnet data can never be mistaken for mainnet.
 *
 * Three things a visitor can be misled by, and the line names all three. That
 * this is not mainnet, and that the history under it is not durable: someone
 * reading a height, a ChainLock or a PoSe ban here could otherwise take it for
 * a permanent record of a production network. And that the coins are worth
 * nothing, which the other two do not imply -- an address and a balance are
 * shown the same way a real explorer shows them, and a visitor who is being
 * asked to send something somewhere needs to be told before, not after.
 */
export const DEVNET_BANNER =
  'DEVNET / EXPERIMENTAL NETWORK — NOT MAINNET — COINS HAVE NO VALUE — DATA MAY RESET OR REORG AT ANY TIME';

/** Successful response envelope used by every v1 endpoint. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: string;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/**
 * Page envelope. `total` is the true match count, not the size of `items` --
 * the production `/events` endpoint truncates at its limit with no indication
 * in the response, and this project does not repeat that.
 */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ── quorum rounds ───────────────────────────────────────────────────────────

export type RoundStatus = 'pending' | 'formed' | 'failed' | 'impossible';

export interface RoundMemberView {
  proTxHash: string;
  service: string | null;
  valid: boolean;
  operatorLabel: string | null;
}

export interface QuorumRoundView {
  roundKey: string;
  llmqName: string;
  llmqType: number;
  quorumIndex: number;
  expectedHeight: number;

  status: RoundStatus;
  formed: boolean;

  /** null for a round that never formed -- there is no commitment to hash. */
  quorumHash: string | null;
  minedBlockHash: string | null;

  size: number;
  minSize: number;
  threshold: number;
  dkgInterval: number;
  effectiveSize: number | null;

  numValidMembers: number | null;
  healthRatio: number | null;

  /**
   * Always 0 for a failed round, and that is a statement about consensus: with
   * no commitment mined, the node's punishment loop never runs.
   */
  punishedCount: number;
  /** effectiveSize - minSize: the ceiling on what a single round can punish. */
  maxPossibleBan: number | null;
  consecutiveFailures: number;

  /**
   * How this round's membership differs from the round before it, and whether
   * that difference accounts for what the round punished. A member drawn in for
   * the first time since the previous round has no DKG mesh yet, so peers that
   * never reach it vote it bad -- punishment that describes the intervention
   * that changed the membership, not the profile and not the member.
   */
  membershipChurn: MembershipChurnView;

  invalidMembers: string[];
  detectedAt: string;
}

export interface MembershipChurnView {
  /** Rounds are scheduled every dkgInterval, so the predecessor is exact. */
  previousExpectedHeight: number;
  /** null when no record of the preceding round exists. */
  previousEffectiveSize: number | null;
  membershipDelta: number | null;
  /**
   * Members here that were absent from the preceding round, and members there
   * that are absent here. Both null when the preceding round left no member
   * list -- a failed round mines no commitment and therefore has none.
   */
  joined: number | null;
  left: number | null;
  punishedJoiners: number | null;
  /**
   * Every member this round punished had joined since the preceding round, and
   * at least one was punished. The round's health is then not comparable with
   * the rounds before it.
   */
  punishmentExplainedByJoiners: boolean;
}

/** List rows omit the member array; it is only worth sending for one round. */
export type QuorumRoundListItem = Omit<QuorumRoundView, 'invalidMembers'> & {
  invalidMemberCount: number;
  /** "op-koen (2), op-marsellus (6)" -- who the invalid members belonged to. */
  failuresByOperator: Array<{ operatorLabel: string | null; count: number }>;
};

export interface QuorumRoundDetail extends QuorumRoundView {
  members: RoundMemberView[];
}

export interface HealthTimelinePoint {
  expectedHeight: number;
  detectedAt: string;
  status: RoundStatus;
  /** null when the round did not form; the chart must show a gap, not a zero. */
  healthRatio: number | null;
  numValidMembers: number | null;
  effectiveSize: number | null;
  punishedCount: number;
}

export interface HealthTimeline {
  points: HealthTimelinePoint[];
  hours: number;
  llmqName: string;
  summary: {
    rounds: number;
    formed: number;
    failed: number;
    pending: number;
    /** Formed / (formed + failed). Pending rounds are excluded, not counted as failures. */
    formationRate: number | null;
    medianHealthRatio: number | null;
    worstHealthRatio: number | null;
    longestFailureStreak: number;
  };
}

export interface OperatorReliabilityRow {
  operatorLabel: string;
  vpsProvider: string | null;
  country: string | null;
  masternodeCount: number;
  /** Rounds this operator had at least one member in. */
  roundsSelected: number;
  /** Member-slots across those rounds. */
  memberSlots: number;
  /** Member-slots marked invalid. */
  invalidSlots: number;
  /** invalidSlots / memberSlots. */
  failureRate: number | null;
}

// ── masternodes ─────────────────────────────────────────────────────────────

export interface MasternodeRow {
  proTxHash: string;
  /** Redacted: `<host label>:<port>`, or the raw service when the deployment
   *  opts in with PUBLIC_HOST_ADDRESSES. */
  service: string | null;
  /** Stable per-host label. Never an address unless the deployment opts in. */
  hostLabel: string | null;
  operatorLabel: string | null;
  banned: boolean;
  poSePenalty: number;
  poSeBanHeight: number;
  poSeRevivedHeight: number;
  /** Sentinel Layer service ledger, shadow-only until enforcement exists. */
  missedServiceEpochs: number;
  rewardSuspended: boolean;
  dslBanHeight: number;
  registeredHeight: number;
  lastPaidHeight: number;
  payoutAddress: string | null;
  lastSeenAt: string;
}

export interface MasternodeTimelinePoint {
  at: string;
  height: number;
  total: number;
  enabled: number;
  banned: number;
  penalised: number;
  penaltyMax: number;
  effectiveQuorumSize: number | null;
  /** The ceiling on what a single DKG round could punish at this moment. */
  maxPossibleBan: number | null;
}

export type MasternodeEventKind =
  | 'registered'
  | 'banned'
  | 'revived'
  | 'penalty_up'
  | 'penalty_down'
  | 'service_changed'
  | 'removed'
  | 'key_changed'
  | 'revoked';

export interface MasternodeEventRow {
  eventKey: string;
  proTxHash: string;
  type: MasternodeEventKind;
  height: number;
  penaltyBefore: number | null;
  penaltyAfter: number | null;
  serviceBefore: string | null;
  serviceAfter: string | null;
  hostLabel: string | null;
  operatorLabel: string | null;
  detectedAt: string;
}

export interface BanWave {
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  size: number;
  /** The ceiling as it stood when the wave began, not as it stands now. */
  maxPossibleBanAtStart: number | null;
  firstHeight: number;
  lastHeight: number;
  byHost: Array<{ hostLabel: string; count: number }>;
  byOperator: Array<{ operatorLabel: string; count: number }>;
}

export interface BanWaveReport {
  hours: number;
  gapMinutes: number;
  waves: BanWave[];
  largestWave: number;
  totalBans: number;
}

// ── chain (blocks and transactions) ─────────────────────────────────────────

/**
 * Human label for a transaction kind. Special transactions carry no ordinary
 * inputs or outputs, so leaving them labelled "normal" with 0.00 value hides
 * exactly the objects this explorer exists to show -- 885 of them are the
 * mined DKG commitments themselves.
 */
export function txKindLabel(type: number, isCoinbase: boolean, isCoinstake: boolean): string {
  if (isCoinstake) return 'coinstake';
  if (isCoinbase) return 'coinbase';
  switch (type) {
    case 1: return 'proreg';
    case 2: return 'proupserv';
    case 3: return 'proupreg';
    case 4: return 'prouprev';
    case 6: return 'qc commit';
    default: return 'normal';
  }
}

export interface BlockRow {
  height: number;
  hash: string;
  time: number;
  nTx: number;
  size: number;
  isProofOfStake: boolean;
  hasChainLock: boolean;
  totalOutSat: string;
  /** Masternode reward that reached a payee. */
  masternodePaidSat: string;
  /** Masternode reward burned to an OP_RETURN output. */
  burnedSat: string;
  /**
   * Stake reward minted by the coinstake: its outputs minus its inputs. Null
   * on proof-of-work blocks, and null -- never a guess -- when an input's
   * funding transaction is not indexed.
   */
  stakePaidSat: string | null;
  payee: string | null;
}

export interface BlockTxSummary {
  txid: string;
  /** Dash special-transaction type; 0 is a plain transaction. */
  type: number;
  isCoinbase: boolean;
  isCoinstake: boolean;
  size: number;
  valueOutSat: string;
  voutCount: number;
  vinCount: number;
}

export interface BlockDetail extends Omit<BlockRow, 'nTx'> {
  previousblockhash: string | null;
  nextblockhash: string | null;
  mediantime: number | null;
  version: number;
  merkleroot: string;
  bits: string;
  nonce: number;
  difficulty: number;
  chainwork: string;
  nTx: number;
  /** Which masternode this block paid; all nodes share one payout address. */
  paidMasternode: { proTxHash: string; service: string | null; operatorLabel: string | null } | null;
  txs: BlockTxSummary[];
}

export interface TxRow {
  txid: string;
  height: number;
  time: number;
  size: number;
  /** Dash special-transaction type; 0 is a plain transaction. */
  type: number;
  isCoinbase: boolean;
  isCoinstake: boolean;
  hasChainLock: boolean;
  valueOutSat: string;
  /**
   * For a coinstake, the reward it minted: outputs minus inputs. Null on
   * every other transaction, and null -- never a guess -- when a funding
   * transaction is not indexed.
   */
  stakePaidSat: string | null;
  voutCount: number;
  vinCount: number;
}

export interface TxDetail extends TxRow {
  blockhash: string;
  version: number;
  vin: Array<{ txid: string | null; vout: number | null; coinbase: string | null }>;
  vout: Array<{ n: number; valueSat: string; scriptType: string; address: string | null }>;
}

// ── API response shapes ─────────────────────────────────────────────────────
//
// Eleven of these lived only in the client, hand-copied from whatever the
// server happened to send. Nothing checked the two against each other, and
// they had already drifted: the client declared StakingHealth.byHost
// non-nullable where the server returns null when no host ownership is known,
// so the page would have read `.hosts` off null the first time it happened.
// Both sides now compile against the definitions below, and the routes
// annotate what they send -- which is the only way the drift shows up as an
// error rather than as an empty page.

export interface ChainLockReport {
  firstLockedHeight: number | null;
  blocksConsidered: number;
  eligible: number;
  locked: number;
  unlocked: number;
  coverage: number | null;
  gaps: Array<{ from: number; to: number; blocks: number }>;
  latencyMeasured: number;
  latencySec: { p50: number | null; p90: number | null; max: number | null };
  /** Same-host ZMQ block-arrival -> CLSIG-arrival measurements. */
  eventLatencyMeasured: number;
  eventLatencyMs: { p50: number | null; p90: number | null; max: number | null };
  sourceCounts: { zmq: number; poll: number; unknown: number };
  /**
   * The Q60 switchover as data: the signed-height resolver flips the signing
   * profile from v1 to v2 at activationHeight, one-way. firstV2LockedHeight is
   * null until the first post-activation lock is observed.
   */
  signers: {
    v1: string;
    v2: string;
    activationHeight: number;
    firstV2LockedHeight: number | null;
    counts: { v1: number; v2: number };
  };
  /** Fast polling interval used only when ZMQ is disabled. */
  resolutionSec: number;
  reconciliationIntervalSec: number;
  points: Array<{
    height: number;
    time: number;
    locked: boolean;
    latencySec: number | null;
    latencyMs: number | null;
    source: 'zmq' | 'poll' | null;
    /** LLMQ profile that signed this block's lock; null when unknown. */
    signer: string | null;
  }>;
}

export interface HealthSnapshot {
  /** 'ok' | 'degraded' | 'down' -- the endpoint answers 503 for the last two. */
  status: string;
  /** Which readiness probes failed; empty when status is 'ok'. */
  failing: string[];
  devnet: string;
  uptimeSeconds: number;
  mongo: string;
  chainTip: number;
  indexedHeight: number;
  indexedBlocks: number;
  behind: number;
  rounds: { formed: number; failed: number; pending: number; impossible: number };
  nodeVersion: string;
  masternodes: { total: number; enabled: number };
  stakers: { active: number; windowBlocks: number };
  observation?: {
    zmq: { enabled: boolean; connected: boolean; received: number; missed: number };
  };
}

export interface StakingHealth {
  blocks: number;
  windowBlocks: number;
  fromHeight: number;
  toHeight: number;
  medianIntervalSec: number | null;
  meanIntervalSec: number | null;
  longestGapSec: number | null;
  stallCount: number;
  distinctStakers: number;
  hhi: number | null;
  gini: number | null;
  topStakerShare: number | null;
  /** `payee` is truncated for display; `host` is null when nobody claims it. */
  stakers: Array<{ payee: string; blocks: number; share: number; host: string | null }>;
  /**
   * The same window counted by machine rather than by payout key, and **null
   * when no host ownership is known at all** -- not a zeroed object. A
   * coinstake pays the key of the output it spent, so one host with five
   * staked outputs looks like five producers; falling back to the per-key
   * numbers here would dilute the concentration in exactly the wrong
   * direction, and silently.
   */
  byHost: {
    distinctHosts: number;
    hhi: number | null;
    topHostShare: number | null;
    unattributedBlocks: number;
    hosts: Array<{ host: string; blocks: number; share: number }>;
  } | null;
}

export interface ProfileOutcome {
  llmqName: string;
  dkgInterval: number;
  rounds: { formed: number; failed: number; pending: number; impossible: number };
  formationRate: number | null;
  medianHealthRatio: number | null;
  worstHealthRatio: number | null;
  longestFailureStreak: number;
  membersPunished: number;
}

export interface ExperimentOutcome {
  rounds: { formed: number; failed: number; pending: number; impossible: number };
  formationRate: number | null;
  medianHealthRatio: number | null;
  worstHealthRatio: number | null;
  longestFailureStreak: number;
  banEvents: number;
  revivalEvents: number;
  penaltyIncreases: number;
  masternodesPunished: number;
  blocks: number;
  medianBlockIntervalSec: number | null;
  distinctStakers: number;
  chainLockedBlocks: number;
  chainLockCoverage: number | null;
  /** Absent on runs closed before more than one quorum type was tracked. */
  byProfile?: ProfileOutcome[];
}

export interface ExperimentRow {
  runKey: string;
  title: string;
  hypothesis: string;
  expected: string;
  status: 'running' | 'closed';
  startedAt: string;
  endedAt: string | null;
  startHeight: number;
  endHeight: number | null;
  nodeVersion: string;
  nodeGitSha: string | null;
  profile: { llmqName: string; size: number; minSize: number; threshold: number; dkgInterval: number };
  participants: { masternodes: number; hosts: number; stakers: number };
  intervention: { kind: string; description: string; targets: string[] } | null;
  baselineRunKey: string | null;
  outcome: ExperimentOutcome | null;
  notes: string | null;
}

export interface ExperimentDetail extends ExperimentRow {
  /** The network as it stands now; null once the run is closed. */
  currentParticipants: { masternodes: number; hosts: number; stakers: number } | null;
  tipHeight: number;
  comparison: {
    baselineRunKey: string;
    baseline: ExperimentOutcome;
    delta: {
      formationRate: number | null;
      medianHealthRatio: number | null;
      masternodesPunished: number;
      medianBlockIntervalSec: number | null;
      chainLockCoverage: number | null;
    };
  } | null;
}

export interface PeerPropagation {
  topic: 'block' | 'chainlock';
  hostsReporting: string[];
  events: Array<{
    hash: string;
    height: number | null;
    hosts: number;
    firstHost: string | null;
    lastHost: string | null;
    spreadMs: number | null;
    medianDelayMs: number | null;
    uncertaintyMs: number;
    uncertaintyIsLowerBound: boolean;
    clockUnknownHosts: string[];
    withinNoise: boolean;
    missingHosts: string[];
    delays: Array<{ host: string; delayMs: number }>;
  }>;
  laggards: Array<{ host: string; samples: number; meanDelayMs: number; lastPlaceShare: number }>;
  hosts: Array<{
    host: string;
    peers: number;
    inbound: number;
    verifiedMasternodes: number;
    medianPingMs: number | null;
    height: number | null;
    clockOffsetMs: number | null;
    agentVersion: string;
    /** Fingerprint of the daemon binary; '' when the agent could not read it. */
    nodeBuild: string;
    reportedAt: string;
  }>;
}

export interface SelectionFairness {
  roundsConsidered: number;
  expectedSelectionRate: number | null;
  minSamples: number;
  llmqName: string | null;
  heightRange: { from: number; to: number } | null;
  nodes: Array<{
    proTxHash: string;
    operatorLabel: string | null;
    host: string | null;
    timesSelected: number;
    timesInvalid: number;
    selectionRate: number;
    invalidRate: number | null;
  }>;
  hosts: Array<{
    host: string;
    nodes: number;
    timesSelected: number;
    timesInvalid: number;
    invalidRate: number | null;
  }>;
  neverSelected: string[];
  neverSelectedCount: number;
}

export interface DslSummary {
  activationHeight: number;
  epochInterval: number;
  firstCommittableBoundary: number | null;
  enforcement: boolean;
  epochsJudged: number;
  committed: number;
  absent: number;
  convergenceRate: number | null;
  totalMissedBits: number;
  latest: {
    epoch: number;
    boundaryHeight: number;
    status: 'committed' | 'absent';
    missedCount: number | null;
  } | null;
}

export interface DslEpochRow {
  epoch: number;
  boundaryHeight: number;
  status: 'committed' | 'absent';
  txid: string | null;
  epochBlockHash: string | null;
  quorumHash: string | null;
  missedCount: number | null;
  listSize: number | null;
  missedIndices: number[];
  /** Resolved from the indices against the list the epoch was judged on. */
  missedProTxHashes: string[];
  detectedAt: string;
}
