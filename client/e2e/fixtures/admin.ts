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
