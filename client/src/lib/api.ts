import type {
  ApiEnvelope,
  HealthTimeline,
  OperatorReliabilityRow,
  Page,
  QuorumRoundDetail,
  QuorumRoundListItem,
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

  operatorReliability: (hours: number) =>
    get<{ hours: number; roundsConsidered: number; operators: OperatorReliabilityRow[] }>(
      '/operators/reliability',
      { hours }
    ),
};
