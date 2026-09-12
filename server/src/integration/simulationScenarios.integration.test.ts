import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, MONGO_URI } from './mongo.js';

/**
 * The scenario allowlist, asked for over HTTP the way the panel asks for it.
 *
 * The templates are validated by a unit test against the schema that owns them,
 * which is the claim that matters. What a unit test cannot show is that the
 * route actually serves them -- a field left out of the response builder is
 * invisible to a test of the registry, and the panel would silently fall back
 * to "no template" for every scenario on the first deploy.
 *
 * The capabilities answer is here for the same reason, and for one more: the
 * combination the panel must not offer is refused by the create-run schema, and
 * this checks that the refusal and the advertised network list agree. A
 * deployment with no executor configured -- which is what these tests run
 * against, since SIMULATION_LAB_EXECUTOR_ENABLED is unset -- must advertise no
 * live network at all.
 */
describe.skipIf(!HAVE_MONGO)('the admin scenario catalogue over HTTP', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const dbName = await connectTestMongo('simscenarios');
    // config.ts reads the environment at import time and the route modules
    // import it, so this has to be set before any of them load -- hence the
    // dynamic imports below.
    process.env.MONGODB_URI = `${MONGO_URI.replace(/\/$/, '')}/${dbName}`;
    process.env.ADMIN_API_KEY = 'integration-test-admin-key';

    const [{ default: express }, { default: v1Routes }] = await Promise.all([
      import('express'),
      import('../routes/v1/index.js'),
    ]);
    const app = express();
    // The real entry point mounts this; without it every POST body arrives
    // undefined and the route refuses for the wrong reason -- which is exactly
    // what the first run of this file reported ("body: Required" instead of the
    // live/devnet refusal). A test that asserts only the status code would have
    // passed on that.
    app.use(express.json({ limit: '256kb' }));
    app.use('/api/v1', v1Routes);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no test port');
    base = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await dropTestMongo();
  });

  interface CatalogueBody {
    success: boolean;
    data?: {
      items?: Array<{
        scenarioId: string;
        parameterTemplate?: Record<string, unknown>;
        templateNeedsTargetId?: boolean;
        parameterFields?: Array<{
          name: string;
          kind: string;
          min?: number;
          max?: number;
          values?: string[];
          onlyWhen?: { field: string; values: string[] };
        }>;
      }>;
      capabilities?: { liveExecutorConfigured: boolean; liveNetworks: string[] };
    };
  }

  async function catalogue(): Promise<{ status: number; body: CatalogueBody }> {
    const response = await fetch(`${base}/api/v1/admin/simulations/scenarios`, {
      headers: { 'x-admin-api-key': 'integration-test-admin-key' },
    });
    return { status: response.status, body: (await response.json()) as CatalogueBody };
  }

  it('refuses an unauthenticated request, so the rest of this file means something', async () => {
    const response = await fetch(`${base}/api/v1/admin/simulations/scenarios`);
    expect(response.status).toBe(401);
  });

  it('serves a parameter template with every scenario', async () => {
    const { status, body } = await catalogue();
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const items = body.data?.items ?? [];
    expect(items.length).toBe(9);
    for (const item of items) {
      expect(item.parameterTemplate, item.scenarioId).toBeTypeOf('object');
      // Never an empty object: that is what the panel used to fall back to for
      // anything it did not know, and it is refused by every scenario that
      // requires a field.
      expect(Object.keys(item.parameterTemplate ?? {}).length, item.scenarioId).toBeGreaterThan(0);
      expect(item.templateNeedsTargetId, item.scenarioId).toBeTypeOf('boolean');
    }

    const dsl = items.find((item) => item.scenarioId === 'dsl-fault');
    expect(dsl?.parameterTemplate).toEqual({ faultKind: 'response-drop', count: 1, epochs: 1 });
  });

  /**
   * Day 15's descriptor extension, over the wire rather than from the module.
   *
   * The bounds themselves are proven against the validator in
   * `scenarioFields.test.ts`; what only an HTTP read can show is that the route
   * actually serves them, that the serialised shape survives the envelope, and
   * that a scenario with no form is served WITHOUT the key rather than with an
   * empty list -- because the panel reads an empty list as "this scenario takes
   * no parameters" and a missing key as "draw the JSON view".
   */
  it('serves form fields for exactly the four scenarios that have them', async () => {
    const { body } = await catalogue();
    const items = body.data?.items ?? [];

    const withFields = items.filter((item) => item.parameterFields !== undefined).map((item) => item.scenarioId);
    expect(withFields.sort()).toEqual(['dsl-fault', 'mn-stop', 'quorum-member-outage', 'staker-stop']);

    const stakers = items.find((item) => item.scenarioId === 'staker-stop');
    const stakerCount = stakers?.parameterFields?.find((field) => field.name === 'count');
    expect(stakerCount).toMatchObject({ kind: 'integer', min: 1, max: 5 });

    const dsl = items.find((item) => item.scenarioId === 'dsl-fault');
    const param = dsl?.parameterFields?.find((field) => field.name === 'param');
    expect(param?.onlyWhen).toEqual({ field: 'faultKind', values: ['response-delay', 'report-delay'] });

    // Absent, not empty, for a scenario the panel has no form for yet.
    const host = items.find((item) => item.scenarioId === 'host-outage');
    expect(host).toBeDefined();
    expect('parameterFields' in (host ?? {})).toBe(false);
  });

  it('advertises no live network when no executor is configured', async () => {
    const { body } = await catalogue();
    expect(body.data?.capabilities).toEqual({
      liveExecutorConfigured: false,
      liveNetworks: [],
    });
  });

  /**
   * The pair the panel must never offer, checked where it is actually refused.
   * A capabilities answer that said `devnet` while this still returned 400
   * would be the same trap in a new place.
   */
  it('still refuses a live run on devnet at creation', async () => {
    const response = await fetch(`${base}/api/v1/admin/simulations/runs`, {
      method: 'POST',
      headers: {
        'x-admin-api-key': 'integration-test-admin-key',
        'content-type': 'application/json',
        'x-idempotency-key': 'integration-live-devnet',
      },
      body: JSON.stringify({
        network: 'devnet',
        mode: 'live',
        scenario: {
          scenarioId: 'mn-stop',
          scenarioVersion: 1,
          seed: 'integration',
          parameters: { count: 1, durationSeconds: 60 },
        },
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/live run is only possible on regtest/);
  });
});
