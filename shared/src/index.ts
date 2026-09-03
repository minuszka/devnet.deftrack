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
  service: string | null;
  hostIp: string | null;
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
