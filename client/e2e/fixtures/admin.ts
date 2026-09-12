import type { ScenarioFieldSpec } from '../../src/lib/admin-api.js';
import { ok, type ApiStubs } from '../harness.js';
import { healthSnapshot, pageOf } from './api.js';

/**
 * Fixtures for the signed-in admin surface.
 *
 * What these prove and what they do not. Stubbing the session endpoint makes
 * the dashboard render; it is **not** evidence that the authorisation path
 * works, and nothing here should ever be cited as such. The server mints
 * sessions through the identity proxy, checks the CSRF token on every mutation
 * and re-decides the role -- none of which a browser fixture can exercise. What
 * is under test on this surface is what the panel offers the operator, and what
 * it sends when they act.
 */
export interface AdminScenarioStub {
  scenarioId: string;
  version: number;
  title: string;
  description: string;
  riskClass: 'low' | 'medium' | 'high';
  parameterTemplate?: Record<string, unknown>;
  templateNeedsTargetId?: boolean;
  parameterFields?: ScenarioFieldSpec[];
}

/** A subset of the real allowlist, with the templates the server serves for it. */
export const SCENARIO_STUBS: AdminScenarioStub[] = [
  {
    scenarioId: 'mn-stop',
    version: 1,
    title: 'Masternode stop',
    description: 'One or more masternodes are stopped and later restarted.',
    riskClass: 'medium',
    parameterTemplate: { count: 1, durationSeconds: 60 },
    templateNeedsTargetId: false,
    // Copied from what the server serves. The bounds are the validator's own --
    // server-side `scenarioFields.test.ts` proves that against
    // `parseScenarioRequest`, so what is repeated here is a fixture of the
    // wire, not a second source of truth about the limits.
    parameterFields: [
      { name: 'count', label: 'Masternodes to stop', kind: 'integer', required: true, min: 1, max: 20, unit: 'nodes' },
      { name: 'durationSeconds', label: 'Duration', kind: 'integer', required: true, min: 5, max: 900, unit: 'seconds' },
      { name: 'targetIds', label: 'Explicit target ids', kind: 'target-ids', required: false },
    ],
  },
  {
    scenarioId: 'dsl-fault',
    version: 1,
    title: 'Sentinel Layer fault',
    description: 'Running masternodes withhold or delay their own DSL traffic.',
    riskClass: 'medium',
    // The one the panel had no entry for at all, so it offered `{}`.
    parameterTemplate: { faultKind: 'response-drop', count: 1, epochs: 1 },
    templateNeedsTargetId: false,
    parameterFields: [
      {
        name: 'faultKind',
        label: 'Fault',
        kind: 'enum',
        required: true,
        values: ['response-drop', 'report-drop', 'response-delay', 'report-delay', 'commitment-skip'],
      },
      { name: 'count', label: 'Masternodes affected', kind: 'integer', required: true, min: 1, max: 20, unit: 'nodes' },
      { name: 'epochs', label: 'Epochs', kind: 'integer', required: true, min: 1, max: 3, unit: 'epochs' },
      {
        name: 'param',
        label: 'Delay',
        kind: 'integer',
        required: true,
        min: 1,
        max: 24,
        unit: 'blocks',
        onlyWhen: { field: 'faultKind', values: ['response-delay', 'report-delay'] },
      },
      { name: 'targetIds', label: 'Explicit target ids', kind: 'target-ids', required: false },
    ],
  },
  {
    scenarioId: 'clear-recover',
    version: 1,
    title: 'Clear and recover',
    description: 'Known simulator fault state is cleared for selected targets.',
    riskClass: 'low',
    parameterTemplate: { targetIds: ['replace-with-a-registered-target-id'] },
    templateNeedsTargetId: true,
  },
  {
    // A scenario this server describes but offers no template for -- what a
    // client newer than its server sees, and what a future scenario looks like.
    scenarioId: 'future-scenario',
    version: 1,
    title: 'Something added later',
    description: 'A scenario this panel has never heard of.',
    riskClass: 'high',
  },
];

export interface AdminStubOptions {
  liveExecutorConfigured?: boolean;
  /** Omit the capabilities field entirely, as a server built before it would. */
  omitCapabilities?: boolean;
  scenarios?: AdminScenarioStub[];
}

export function adminSessionStubs(options: AdminStubOptions = {}): ApiStubs {
  const scenarios = options.scenarios ?? SCENARIO_STUBS;
  const liveExecutorConfigured = options.liveExecutorConfigured ?? true;
  const capabilities = options.omitCapabilities
    ? undefined
    : {
        liveExecutorConfigured,
        liveNetworks: liveExecutorConfigured ? ['regtest'] : [],
      };

  return {
    '/api/v1/admin/session': {
      body: ok({ subject: 'fixture-operator', role: 'operator', csrfToken: 'fixture-csrf-token' }),
    },
    '/api/v1/health': { body: ok(healthSnapshot()) },
    '/api/v1/admin/simulations/targets': { body: ok({ items: [], total: 0 }) },
    '/api/v1/admin/simulations/runs': { body: ok({ items: [], total: 0 }) },
    '/api/v1/admin/simulations/scenarios': {
      body: ok(capabilities === undefined ? { items: scenarios } : { items: scenarios, capabilities }),
    },
    '/api/v1/simulations': { body: ok(pageOf([])) },
  };
}

/** A run key of the shape the server mints, for the selection tests. */
export const RUN_A = `sim_${'a'.repeat(32)}`;
export const RUN_B = `sim_${'b'.repeat(32)}`;

export interface RunStubOptions {
  runKey: string;
  /** The recovery evidence the server reports. `null` means none recorded. */
  recovery?: {
    required: boolean;
    allClear: boolean;
    targets: Array<{
      targetId: string;
      faultStateClear: boolean;
      expectedServiceRunning: boolean;
      observerFresh: boolean;
      checkedAtMs: number;
    }>;
  } | null;
  status?: string;
  revision?: number;
  live?: boolean;
  faultMayBeActive?: boolean;
  faultLeaseExpiresAtMs?: number | null;
  abortRequested?: boolean;
  scenarioId?: string;
}

/** The run projection, as `GET /runs/:key` and `/dry-run` carry it. */
export function controlRun(options: RunStubOptions): Record<string, unknown> {
  return {
    runKey: options.runKey,
    metadataFingerprint: `fingerprint-${options.runKey.slice(4, 10)}`,
    metadata: {
      network: 'regtest',
      scenarioId: options.scenarioId ?? 'mn-stop',
      scenarioVersion: 1,
      seed: 'fixture-seed',
      parameters: { count: 1, durationSeconds: 60 },
    },
    state: {
      status: options.status ?? 'armed',
      revision: options.revision ?? 3,
      live: options.live ?? true,
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
      stateEnteredAtMs: 2_000,
      runExpiresAtMs: 9_000_000,
      faultLeaseExpiresAtMs: options.faultLeaseExpiresAtMs ?? null,
      faultMayBeActive: options.faultMayBeActive ?? false,
      abortRequested: options.abortRequested ?? false,
      lastTransition: null,
    },
  };
}

/** The saved plan for a run. Minimal, and never a new one. */
export function savedPlan(runKey: string): Record<string, unknown> {
  return {
    runKey,
    network: 'regtest',
    scenarioId: 'mn-stop',
    selectedTargetIds: ['lab-mn-1'],
    actions: [
      { actionId: 'a1', targetId: 'lab-mn-1', kind: 'service-stop', notBeforeOffsetMs: 0 },
    ],
    impact: {
      affectedTargetCount: 1,
      affectedMasternodeCount: 1,
      affectedStakerCount: 0,
      affectedHostCount: 1,
      affectedCurrentQuorumMembers: 0,
      currentQuorumSize: null,
      survivingCurrentQuorumMembers: null,
      dkgMarginAfterFault: null,
      chainLockMarginAfterFault: null,
      warnings: [],
    },
    assurances: ['NO_REMOTE_ACTION'],
  };
}

/** Everything the dashboard needs to show one existing run. */
export function runStubs(options: RunStubOptions): ApiStubs {
  const run = controlRun(options);
  const base = `/api/v1/admin/simulations/runs/${options.runKey}`;
  return {
    [base]: { body: ok(run) },
    [`${base}/dry-run`]: { body: ok({ run, plan: savedPlan(options.runKey) }) },
    [`${base}/recovery`]: {
      body: ok({
        recovery:
          options.recovery === undefined
            ? null
            : options.recovery === null
              ? null
              : { startedAtMs: 1_000, finishedAtMs: 2_000, ...options.recovery },
      }),
    },
    [`${base}/history`]: {
      body: ok({
        run,
        audit: [
          {
            sequence: 1,
            stream: 'run',
            eventType: 'dry_run_completed',
            atMs: 2_000,
            fromStatus: 'draft',
            toStatus: options.status ?? 'armed',
          },
        ],
        artifacts: [],
      }),
    },
  };
}
