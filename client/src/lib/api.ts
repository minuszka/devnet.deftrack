import type {
  ApiEnvelope,
  HealthTimeline,
  OperatorReliabilityRow,
  Page,
  QuorumRoundDetail,
  QuorumRoundListItem,
  MasternodeRow,
  MasternodeTimelinePoint,
  MasternodeEventRow,
  BanWaveReport,
  BlockRow,
  BlockDetail,
  TxRow,
  TxDetail,
} from '@devnet-deftrack/shared';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | null | undefined>;

function qs(params?: Params): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function get<T>(path: string, params?: Params): Promise<T> {
  const response = await fetch(`${BASE}${path}${qs(params)}`, {
    headers: { Accept: 'application/json' },
  });

  let body: ApiEnvelope<T>;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(response.status, `${response.status} ${response.statusText}`);
  }

  // The server answers errors in the same envelope, so the message is usable
  // rather than a bare status code.
  if (!body.success) throw new ApiError(response.status, body.error);
  return body.data;
}

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
  /** Poll interval of the watcher; the latency figures are no finer than this. */
  resolutionSec: number;
  points: Array<{ height: number; time: number; locked: boolean; latencySec: number | null }>;
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
  rounds: { formed: number; failed: number; pending: number };
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
  stakers: Array<{ payee: string; blocks: number; share: number }>;
}

export interface ExperimentOutcome {
  rounds: { formed: number; failed: number; pending: number };
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

export const api = {
  health: () => get<HealthSnapshot>('/health'),

  stakingHealth: (blocks: number) => get<StakingHealth>('/staking/health', { blocks }),

  experiments: (params?: { limit?: number; offset?: number; status?: string }) =>
    get<Page<ExperimentRow>>('/experiments', params),
  experiment: (runKey: string) => get<ExperimentDetail>(`/experiments/${encodeURIComponent(runKey)}`),

  rounds: (params?: { limit?: number; offset?: number; status?: string; llmqName?: string }) =>
    get<Page<QuorumRoundListItem>>('/quorum-rounds', params),

  round: (id: string) => get<QuorumRoundDetail>(`/quorum-rounds/${encodeURIComponent(id)}`),

  healthTimeline: (hours: number) =>
    get<HealthTimeline>('/quorum-rounds/health-timeline', { hours }),

  masternodes: (params?: { limit?: number; offset?: number; banned?: boolean; hostIp?: string }) =>
    get<Page<MasternodeRow>>('/masternodes', params),

  masternodeTimeline: (hours: number) =>
    get<{ hours: number; points: MasternodeTimelinePoint[] }>('/masternodes/timeline', { hours }),

  masternodeEvents: (params: { hours: number; limit?: number; type?: string }) =>
    get<Page<MasternodeEventRow>>('/masternodes/events', params),

  banWaves: (hours: number) => get<BanWaveReport>('/masternodes/ban-waves', { hours }),

  chainlocks: (blocks: number) => get<ChainLockReport>('/chainlocks', { blocks }),

  blocks: (params?: { limit?: number; offset?: number }) => get<Page<BlockRow>>('/blocks', params),

  block: (id: string) => get<BlockDetail>(`/blocks/${encodeURIComponent(id)}`),

  txs: (params?: { limit?: number; offset?: number }) => get<Page<TxRow>>('/txs', params),

  tx: (txid: string) => get<TxDetail>(`/txs/${encodeURIComponent(txid)}`),

  operatorReliability: (hours: number) =>
    get<{ hours: number; roundsConsidered: number; operators: OperatorReliabilityRow[] }>(
      '/operators/reliability',
      { hours }
    ),
};
