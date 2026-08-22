/**
 * Types and constants shared between the server and the client.
 */

/** Devnet network name. Every node must pass the identical `-devnet=` value. */
export const DEVNET_NAME = 'defcon-q60';

/** Shown in the client header so devnet data can never be mistaken for mainnet. */
export const DEVNET_BANNER = 'DEVNET — test network, coins have no value';

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

export type RoundStatus = 'pending' | 'formed' | 'failed';

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

  invalidMembers: string[];
  detectedAt: string;
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
  service: string | null;
  hostIp: string | null;
  operatorLabel: string | null;
  banned: boolean;
  poSePenalty: number;
  poSeBanHeight: number;
  poSeRevivedHeight: number;
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
  | 'service_changed';

export interface MasternodeEventRow {
  eventKey: string;
  proTxHash: string;
  type: MasternodeEventKind;
  height: number;
  penaltyBefore: number | null;
  penaltyAfter: number | null;
  serviceBefore: string | null;
  serviceAfter: string | null;
  hostIp: string | null;
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
  byHost: Array<{ hostIp: string; count: number }>;
  byOperator: Array<{ operatorLabel: string; count: number }>;
}

export interface BanWaveReport {
  hours: number;
  gapMinutes: number;
  waves: BanWave[];
  largestWave: number;
  totalBans: number;
}
