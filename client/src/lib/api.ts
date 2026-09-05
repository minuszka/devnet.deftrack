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
  ChainLockReport,
  HealthSnapshot,
  StakingHealth,
  ProfileOutcome,
  ExperimentOutcome,
  ExperimentRow,
  ExperimentDetail,
  PeerPropagation,
  SelectionFairness,
  DslSummary,
  DslEpochRow,
} from '@devnet-deftrack/shared';

/*
 * The response shapes live in shared/ now, so the server compiles against the
 * same definitions. Re-exported here because a page asks its API client what
 * a response looks like, not the wire contract package.
 */
export type {
  ChainLockReport,
  HealthSnapshot,
  StakingHealth,
  ProfileOutcome,
  ExperimentOutcome,
  ExperimentRow,
  ExperimentDetail,
  PeerPropagation,
  SelectionFairness,
  DslSummary,
  DslEpochRow,
};

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

async function request<T>(path: string, params?: Params, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}${path}${qs(params)}`, {
    headers: { Accept: 'application/json' },
    signal: signal ?? null,
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












/**
 * The whole API surface, optionally bound to one AbortSignal.
 *
 * Every page polls, and until now nothing cancelled the request a newer poll
 * replaced: two responses could land in either order, and the older one won
 * whenever it was slower -- a filter switched back to the previous filter's
 * data with no way for the reader to tell. A run of the poller builds its own
 * bound copy, so cancelling the run cancels every call it made.
 */
function makeApi(signal?: AbortSignal) {
  const get = <T>(path: string, params?: Params): Promise<T> => request<T>(path, params, signal);

  return {
    health: () => get<HealthSnapshot>('/health'),

    dslSummary: () => get<DslSummary>('/dsl/summary'),
    dslEpochs: (params?: { limit?: number; offset?: number; status?: string }) =>
      get<Page<DslEpochRow>>('/dsl/epochs', params),

    stakingHealth: (blocks: number) => get<StakingHealth>('/staking/health', { blocks }),

    peerPropagation: (topic: 'block' | 'chainlock', events: number) =>
      get<PeerPropagation>('/peers/propagation', { topic, events }),

    selectionFairness: (rounds: number) =>
      get<SelectionFairness>('/fairness/selection', { rounds }),

    experiments: (params?: { limit?: number; offset?: number; status?: string }) =>
      get<Page<ExperimentRow>>('/experiments', params),
    experiment: (runKey: string) => get<ExperimentDetail>(`/experiments/${encodeURIComponent(runKey)}`),

    rounds: (params?: { limit?: number; offset?: number; status?: string; llmqName?: string }) =>
      get<Page<QuorumRoundListItem>>('/quorum-rounds', params),

    round: (id: string) => get<QuorumRoundDetail>(`/quorum-rounds/${encodeURIComponent(id)}`),

    /**
     * Without `llmqName` the server does not filter, and the summary is computed
     * across every interleaved schedule at once -- which invents streaks no type
     * ever had. Callers should name the profile they mean.
     */
    healthTimeline: (hours: number, llmqName?: string) =>
      get<HealthTimeline>('/quorum-rounds/health-timeline', { hours, llmqName }),

    masternodes: (params?: { limit?: number; offset?: number; banned?: boolean }) =>
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
}

/** The unbound client: for one-off calls that nothing will supersede. */
export const api = makeApi();

export type Api = ReturnType<typeof makeApi>;

/** The same surface, cancelled together when the signal aborts. */
export function apiWith(signal: AbortSignal): Api {
  return makeApi(signal);
}
