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

/**
 * One transition of the run, as the server records it.
 */
export interface SimulationTransitionView {
  eventId: string;
  eventType: string;
  /** Not nullable: every recorded transition has a status it came from. */
  from: string;
  to: string;
  atMs: number;
  reason: string | null;
}

/**
 * The run state as the control API actually serves it.
 *
 * Read back from the server's own projection rather than inferred from what the
 * panel happened to use. `revision` is the field that matters most here and was
 * missing entirely: it is the server's own ordering key, incremented on every
 * transition, and it is the only honest way to tell a late answer from a new
 * one. Without it the panel had nothing to compare, so whichever response
 * arrived last won -- including one describing a state the run had already left.
 */
export interface SimulationRunStateView {
  status: string;
  revision: number;
  live: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  stateEnteredAtMs: number;
  runExpiresAtMs: number;
  cooldownExpiresAtMs?: number;
  faultLeaseExpiresAtMs: number | null;
  /** True until a successful recovery proves the remote mutation is gone. */
  faultMayBeActive: boolean;
  abortRequested: boolean;
  lastTransition: SimulationTransitionView | null;
}

/**
 * The subset of run metadata this panel reads.
 *
 * The projection carries more -- the target snapshot, the quorum snapshot, who
 * requested it -- and those are deliberately not typed here. A field the panel
 * has no use for is a field it cannot accidentally render, and this surface
 * carries registry detail that has no business on a screen by accident.
 */
export interface SimulationRunMetadataView {
  network: 'regtest' | 'devnet';
  scenarioId: string;
  scenarioVersion: number;
  seed: string;
  parameters: Record<string, unknown>;
}

/**
 * The run projection: `runKey`, `metadataFingerprint`, `metadata`, `state`.
 *
 * Note what is NOT here. The stored recovery result is a separate top-level
 * field on the document, and the repository's projection selects only the four
 * above -- so no control endpoint has ever returned it. This interface used to
 * declare `recovery?`, and the panel's "Recovery proof: all targets clear" line
 * was therefore unreachable code. Recovery evidence is `unknown` on this API;
 * see `simulationRunState.ts`, which says so rather than guessing.
 */
export interface SimulationControlRun {
  runKey: string;
  metadataFingerprint: string;
  metadata: SimulationRunMetadataView;
  state: SimulationRunStateView;
}

/**
 * Every mutation answers with this flag, and the panel ignored it.
 *
 * `true` means the server recognised the request as a replay of one it had
 * already applied -- which is what makes a retry after a network timeout safe,
 * and is a different thing from an operation that has just happened.
 */
export interface IdempotentResult {
  idempotentReplay?: boolean;
}

/** Recovery evidence for one run, as the control API serves it. */
export interface RecoveryReportView {
  required: boolean;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  allClear: boolean;
  targets: Array<{
    targetId: string;
    faultStateClear: boolean;
    expectedServiceRunning: boolean;
    observerFresh: boolean;
    checkedAtMs: number;
  }>;
}

/** Who holds the lab, and whether that lease still blocks a new live run. */
export interface LiveRunLockStatus {
  configured: boolean;
  lock: {
    runKey: string;
    status: string;
    leaseUntilMs: number;
  } | null;
  blocking: boolean;
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

/**
 * How one scenario parameter should be drawn, as the server describes it.
 *
 * Display metadata only. The bounds are the validator's own -- the server
 * proves its table against `parseScenarioRequest` -- and the panel keeps no
 * copy of them, so a limit changed on the server changes the form without a
 * client release. A server built before this field sends none, and the panel
 * falls back to the JSON view rather than inventing inputs.
 */
export interface ScenarioFieldSpec {
  name: string;
  label: string;
  kind: 'integer' | 'enum' | 'target-ids';
  required: boolean;
  min?: number;
  max?: number;
  unit?: string;
  values?: string[];
  help?: string;
  /** Shown only while another field holds one of these values. */
  onlyWhen?: { field: string; values: string[] };
}

export interface ScenarioSummary {
  scenarioId: string;
  version: number;
  title: string;
  description: string;
  riskClass: 'low' | 'medium' | 'high';
  /**
   * A parameter object that satisfies this scenario's schema, served by the
   * same module that validates it.
   *
   * Optional because a server built before this field simply does not send it,
   * and absent is the honest reading -- not the same as an empty object, which
   * would look runnable and is refused for every scenario that requires a field.
   */
  parameterTemplate?: Record<string, unknown>;
  /** The template names a placeholder target that no registry will resolve. */
  templateNeedsTargetId?: boolean;
  /** The form fields for this scenario, in the order to show them. */
  parameterFields?: ScenarioFieldSpec[];
}

/**
 * What this deployment can be asked to do.
 *
 * Absent from a server that predates it, and the panel treats absent as "not
 * established" rather than as "yes": offering a live run that the server will
 * refuse at creation is the trap this field exists to remove.
 */
export interface SimulationCapabilities {
  liveExecutorConfigured: boolean;
  liveNetworks: Array<'regtest' | 'devnet'>;
}

interface RequestInput {
  method?: 'GET' | 'POST' | 'DELETE';
  csrfToken?: string;
  idempotencyKey?: string;
  body?: unknown;
  /**
   * Cancels the request when a newer one supersedes it.
   *
   * Only ever passed on reads. A mutation must NOT be abandoned this way: the
   * server may already have applied it, and a cancelled fetch tells the caller
   * nothing about whether it did. Retrying one is what the idempotency key is
   * for.
   */
  signal?: AbortSignal;
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
    signal: input.signal ?? null,
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
  scenarios: () =>
    request<{ items: ScenarioSummary[]; capabilities?: SimulationCapabilities }>(
      `${ADMIN_BASE}/simulations/scenarios`
    ),
  activeRuns: (signal?: AbortSignal) =>
    request<{ items: ActiveSimulationRun[]; total: number }>(
      `${ADMIN_BASE}/simulations/runs?live=true`,
      { signal }
    ),
  history: (runKey: string, signal?: AbortSignal) =>
    request<SimulationHistory>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/history`,
      { signal }
    ),

  /**
   * One run's current projection. The endpoint the panel never called: it held
   * whatever the last operation returned, in memory, and lost it on reload.
   */
  run: (runKey: string, signal?: AbortSignal) =>
    request<SimulationControlRun>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}`,
      { signal }
    ),

  /**
   * The run and the plan that was SAVED for it, not a new one.
   *
   * Restoring a selection through this endpoint reads the immutable plan the
   * run was created with. Re-creating a draft to get a plan back would produce
   * a different run, which is the failure this exists to prevent.
   */
  dryRun: (runKey: string, signal?: AbortSignal) =>
    request<{ run: SimulationControlRun; plan: DryRunPlan }>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/dry-run`,
      { signal }
    ),

  /**
   * Whether the lab was proven clean for this run, per target.
   *
   * Its own endpoint because the run projection does not carry recovery -- it
   * is a separate field on the document, built past by a projection that lists
   * its fields. Redacted server-side: the prober's private detail never leaves
   * the server.
   */
  recovery: (runKey: string, signal?: AbortSignal) =>
    request<{ recovery: RecoveryReportView | null }>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/recovery`,
      { signal }
    ),

  /** Who holds the lab. Separate from the run list: a stale lock outlives its run. */
  liveLock: (signal?: AbortSignal) =>
    request<LiveRunLockStatus>(`${ADMIN_BASE}/simulations/lock`, { signal }),

  createRun: (input: {
    csrfToken: string;
    idempotencyKey: string;
    network: 'regtest' | 'devnet';
    mode: 'dry-run' | 'live';
    scenario: unknown;
  }) => request<{ run: SimulationControlRun; plan: DryRunPlan } & IdempotentResult>(`${ADMIN_BASE}/simulations/runs`, {
    method: 'POST', csrfToken: input.csrfToken, idempotencyKey: input.idempotencyKey,
    body: { network: input.network, mode: input.mode, scenario: input.scenario },
  }),
  validateRun: (runKey: string, csrfToken: string, idempotencyKey: string) =>
    request<{ run: SimulationControlRun; preflight: SimulationPreflight } & IdempotentResult>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/validate`,
      { method: 'POST', csrfToken, idempotencyKey, body: {} }
    ),
  armRun: (runKey: string, csrfToken: string, idempotencyKey: string, acknowledgedRiskClass: 'low' | 'medium' | 'high') =>
    request<{ run: SimulationControlRun; preflight?: SimulationPreflight } & IdempotentResult>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/arm`,
      { method: 'POST', csrfToken, idempotencyKey, body: { acknowledgedRiskClass } }
    ),
  startRun: (runKey: string, csrfToken: string, idempotencyKey: string) =>
    request<{ run: SimulationControlRun } & IdempotentResult>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/start`,
      { method: 'POST', csrfToken, idempotencyKey, body: {} }
    ),
  abortRun: (runKey: string, csrfToken: string, idempotencyKey: string) =>
    request<{ run: SimulationControlRun } & IdempotentResult>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/abort`,
      { method: 'POST', csrfToken, idempotencyKey, body: {} }
    ),
  recoverRun: (runKey: string, csrfToken: string, idempotencyKey: string) =>
    request<{ run: SimulationControlRun } & IdempotentResult>(
      `${ADMIN_BASE}/simulations/runs/${encodeURIComponent(runKey)}/recover`,
      { method: 'POST', csrfToken, idempotencyKey, body: {} }
    ),

  // This remains the redacted public read model.  The panel uses it for the
  // archive list, then asks its authenticated route for an action timeline.
  runs: () => request<Page<PublicSimulationRun>>('/api/v1/simulations?limit=25'),
};
