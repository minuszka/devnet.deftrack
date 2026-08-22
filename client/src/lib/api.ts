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
  status: string;
  devnet: string;
  uptimeSeconds: number;
  mongo: string;
  chainTip: number;
  indexedHeight: number;
  indexedBlocks: number;
  behind: number;
  rounds: { formed: number; failed: number; pending: number };
}

export const api = {
  health: () => get<HealthSnapshot>('/health'),

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
