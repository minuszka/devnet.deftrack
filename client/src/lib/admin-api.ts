import type { ApiEnvelope, Page } from '@devnet-deftrack/shared';
import { ApiError } from './api.js';

const ADMIN_BASE = '/api/v1/admin';

export type AdminRole = 'operator' | 'safety-admin';

/** A browser session is deliberately separate from the API-key-only control client. */
export interface AdminSession {
  subject: string;
  role: AdminRole;
  /** Kept in memory only. The matching session id stays in an HttpOnly cookie. */
  csrfToken: string;
  expiresAtMs?: number;
}

export interface SimulationTarget {
  targetId: string;
  displayLabel: string;
  hostRef: string;
  role: 'masternode' | 'staker' | 'seed';
  network: 'regtest' | 'devnet';
  expectedBuild: string | null;
  enabled: boolean;
  maintenance: boolean;
}

export interface ActiveSimulationRun {
  runKey: string;
  status: string;
  stateEnteredAtMs: number;
}

export interface PublicSimulationRun {
  runKey: string;
  network: 'regtest' | 'devnet';
  scenario: { id: string; version: number; title: string; riskClass: 'low' | 'medium' | 'high' };
  state: {
    status: string;
    live: boolean;
    stateEnteredAtMs: number;
    faultLeaseExpiresAtMs: number | null;
    faultMayBeActive: boolean;
  };
}

export interface SimulationControlRun {
  runKey: string;
  state: {
    status: string;
    live: boolean;
    stateEnteredAtMs: number;
    faultLeaseExpiresAtMs: number | null;
    faultMayBeActive: boolean;
    abortRequested: boolean;
  };
  recovery?: {
    required: boolean;
    allClear: boolean;
    targets: Array<{
      targetId: string;
      faultStateClear: boolean;
      expectedServiceRunning: boolean;
      observerFresh: boolean;
    }>;
  };
}

export interface DryRunPlan {
  runKey: string;
  network: 'regtest' | 'devnet';
  scenarioId: string;
  selectedTargetIds: string[];
  actions: Array<{
    actionId: string;
    targetId: string;
    kind: string;
    notBeforeOffsetMs: number;
  }>;
  impact: {
    affectedTargetCount: number;
    affectedMasternodeCount: number;
    affectedStakerCount: number;
    affectedHostCount: number;
    affectedCurrentQuorumMembers: number;
    currentQuorumSize: number | null;
    survivingCurrentQuorumMembers: number | null;
    dkgMarginAfterFault: number | null;
    chainLockMarginAfterFault: number | null;
    warnings: string[];
  };
  assurances: string[];
}

export interface SimulationPreflight {
  passed: boolean;
  checkedAtMs: number;
  checks: Array<{
    checkId: string;
    severity: 'required' | 'warning';
    passed: boolean;
    publicMessage: string;
  }>;
  dataQuality: {
    observerCoveragePercent: number;
    staleTargetCount: number;
    explorerLagBlocks: number;
    confidence: 'high' | 'medium' | 'low';
  };
}

export interface SimulationAuditEvent {
  sequence: number;
  stream: 'run' | 'action';
  eventType: string;
  atMs: number;
  fromStatus: string | null;
  toStatus: string | null;
}

export interface SimulationHistory {
  run: {
    runKey: string;
    state: {
      status: string;
      live: boolean;
      faultMayBeActive: boolean;
      faultLeaseExpiresAtMs: number | null;
    };
  };
  audit: SimulationAuditEvent[];
}

export interface ScenarioSummary {
  scenarioId: string;
  version: number;
  title: string;
  description: string;
  riskClass: 'low' | 'medium' | 'high';
}

interface RequestInput {
  method?: 'GET' | 'POST' | 'DELETE';
  csrfToken?: string;
  idempotencyKey?: string;
  body?: unknown;
}

/**
 * Requests made by the panel always stay same-origin.  In particular, this
 * helper has no API-key parameter: a browser reaches the control API only with
 * the server-side session and, for a mutation, the in-memory CSRF token.
 */
async function request<T>(path: string, input: RequestInput = {}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (input.csrfToken !== undefined) headers.set('x-csrf-token', input.csrfToken);
  if (input.idempotencyKey !== undefined) headers.set('x-idempotency-key', input.idempotencyKey);
  if (input.body !== undefined) headers.set('Content-Type', 'application/json');

  const response = await fetch(path, {
    method: input.method ?? 'GET',
    headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    credentials: 'same-origin',
    cache: 'no-store',
  });

  let body: ApiEnvelope<T>;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(response.status, `${response.status} ${response.statusText}`);
  }
  if (!body.success) throw new ApiError(response.status, body.error);
  return body.data;
}

export const adminApi = {
  session: () => request<AdminSession>(`${ADMIN_BASE}/session`),
  signIn: () => request<AdminSession>(`${ADMIN_BASE}/session`, { method: 'POST' }),
  signOut: (csrfToken: string) =>
    request<{ signedOut: true }>(`${ADMIN_BASE}/session`, { method: 'DELETE', csrfToken }),

  targets: () => request<{ items: SimulationTarget[]; total: number }>(`${ADMIN_BASE}/simulations/targets`),
  scenarios: () => request<{ items: ScenarioSummary[] }>(`${ADMIN_BASE}/simulations/scenarios`),
  activeRuns: () =>
    request<{ items: ActiveSimulationRun[]; total: number }>(`${ADMIN_BASE}/simulations/runs?live=true`),
  history: (runKey: string) =>
    request<SimulationHistory>(`${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/history`),

  createRun: (input: {
    csrfToken: string;
    idempotencyKey: string;
    network: 'regtest' | 'devnet';
    mode: 'dry-run' | 'live';
    scenario: unknown;
  }) => request<{ run: SimulationControlRun; plan: DryRunPlan }>(`${ADMIN_BASE}/simulations/runs`, {
    method: 'POST', csrfToken: input.csrfToken, idempotencyKey: input.idempotencyKey,
    body: { network: input.network, mode: input.mode, scenario: input.scenario },
  }),
  validateRun: (runKey: string, csrfToken: string, idempotencyKey: string) =>
    request<{ run: SimulationControlRun; preflight: SimulationPreflight }>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/validate`,
      { method: 'POST', csrfToken, idempotencyKey, body: {} }
    ),
  armRun: (runKey: string, csrfToken: string, idempotencyKey: string, acknowledgedRiskClass: 'low' | 'medium' | 'high') =>
    request<{ run: SimulationControlRun; preflight: SimulationPreflight }>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/arm`,
      { method: 'POST', csrfToken, idempotencyKey, body: { acknowledgedRiskClass } }
    ),
  startRun: (runKey: string, csrfToken: string, idempotencyKey: string) =>
    request<{ run: SimulationControlRun }>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/start`,
      { method: 'POST', csrfToken, idempotencyKey, body: {} }
    ),
  abortRun: (runKey: string, csrfToken: string, idempotencyKey: string) =>
    request<{ run: SimulationControlRun }>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/abort`,
      { method: 'POST', csrfToken, idempotencyKey, body: {} }
    ),
  recoverRun: (runKey: string, csrfToken: string, idempotencyKey: string) =>
    request<{ run: SimulationControlRun }>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/recover`,
      { method: 'POST', csrfToken, idempotencyKey, body: {} }
    ),

  // This remains the redacted public read model.  The panel uses it for the
  // archive list, then asks its authenticated route for an action timeline.
  runs: () => request<Page<PublicSimulationRun>>('/api/v1/simulations?limit=25'),
};
