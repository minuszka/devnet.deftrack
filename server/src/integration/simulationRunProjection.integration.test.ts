import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, MONGO_URI, syncIndexes } from './mongo.js';

/**
 * What `GET /runs/:runKey` actually puts on the wire.
 *
 * The panel's type for a run was not read from the server; it was inferred from
 * the fields the panel happened to use, and it had two holes. It declared a
 * `recovery` object -- so "Recovery proof: all targets clear" was written,
 * reviewed and shipped as unreachable code, because the repository's projection
 * selects `runKey metadataFingerprint metadata state` and the stored recovery
 * result is a separate field on the document. And it omitted `state.revision`,
 * the server's own ordering key, which is the only thing that can tell a late
 * answer from a new one.
 *
 * A unit test cannot settle either question: both are about what one `.select()`
 * carries. So the run is made by the real persistence service and then given a
 * recovery result directly, and the assertion is that the read still does not
 * carry it. A run seeded without one would pass while proving nothing.
 */
const API_KEY = 'integration-test-admin-key';

describe.skipIf(!HAVE_MONGO)('the run projection over HTTP', () => {
  let server: Server;
  let base = '';
  let runKey = '';

  beforeAll(async () => {
    const dbName = await connectTestMongo('simprojection');
    process.env.MONGODB_URI = `${MONGO_URI.replace(/\/$/, '')}/${dbName}`;
    process.env.ADMIN_API_KEY = API_KEY;

    const [{ default: express }, { default: v1Routes }, { SimulationRun }, { SimulationTarget }] =
      await Promise.all([
        import('express'),
        import('../routes/v1/index.js'),
        import('../models/SimulationRun.js'),
        import('../models/SimulationTarget.js'),
      ]);
    await syncIndexes([SimulationRun, SimulationTarget]);

    // One enabled regtest masternode, so a plan has something to select. All
    // invented: this registry is a lab's, never the devnet's.
    await SimulationTarget.create({
      targetId: 'lab-mn-1',
      displayLabel: 'lab masternode 1',
      hostRef: 'lab-host-1',
      unitRef: 'defcon-lab-mn@1',
      p2pPort: 19899,
      role: 'masternode',
      network: 'regtest',
      capabilities: ['service-control'],
      enabled: true,
      maintenance: false,
    });

    const app = express();
    app.use(express.json({ limit: '256kb' }));
    app.use('/api/v1', v1Routes);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no test port');
    base = `http://127.0.0.1:${address.port}`;

    // Created through the real persistence service, not inserted by hand and
    // not through the HTTP create route.
    //
    // Not by hand, because the audit stream is the source of truth: `loadRun`
    // replays it, and a run with a complete projection document but no audit
    // events answers 404 -- which is how the first version of this file failed.
    //
    // Not through the route, because creating a draft reaches for chain
    // identity pins and a live node RPC, neither of which exists here. What
    // this file is about is the shape of the READ, so the fixture is made by
    // the same code the route would have used to write it.
    const [{ SimulationPersistenceService }, { MongoSimulationPersistenceRepository }, { simulationRunKeyFor }] =
      await Promise.all([
        import('../services/simulationPersistence.service.js'),
        import('../services/simulationMongo.repository.js'),
        import('../domain/simulationIdentity.js'),
      ]);

    const idempotencyKey = 'integration-projection-create';
    runKey = simulationRunKeyFor(idempotencyKey);
    const parameters = { count: 1, durationSeconds: 60 };
    const metadata = {
      network: 'regtest' as const,
      scenarioId: 'mn-stop',
      scenarioVersion: 1 as const,
      parameters,
      seed: 'projection-test',
      targetSnapshot: [],
      quorumTargetSnapshot: null,
      experimentRunKey: null,
      baselineRunKey: null,
      requestedBy: { actorId: 'integration', actorType: 'system' as const, displayName: null },
    };
    const plan = {
      mode: 'dry-run' as const,
      runKey,
      network: 'regtest' as const,
      scenarioId: 'mn-stop' as const,
      scenarioVersion: 1 as const,
      seed: 'projection-test',
      parameters,
      selectedTargetIds: ['lab-mn-1'],
      selectedRoles: ['masternode' as const],
      actions: [
        {
          actionId: 'action-1',
          runKey,
          sequence: 1,
          targetId: 'lab-mn-1',
          kind: 'service-stop' as const,
          payload: { kind: 'service-stop' as const, faultLeaseSeconds: 120 },
          payloadDigest: 'digest-1',
          notBeforeOffsetMs: 0,
          expiresAfterMs: 120_000,
          maxAttempts: 3,
        },
      ],
      impact: {
        affectedTargetCount: 1,
        affectedMasternodeCount: 1,
        affectedStakerCount: 0,
        affectedHostCount: 1,
        affectedCurrentQuorumMembers: 0,
        currentQuorumSize: null,
        survivingCurrentQuorumMembers: null,
        dkgThreshold: null,
        chainLockThreshold: null,
        dkgMarginAfterFault: null,
        chainLockMarginAfterFault: null,
        warnings: [],
      },
      coreSimulator: {
        status: 'not-modeled' as const,
        repository: 'fixture',
        profile: 'q60_44_41' as const,
        scenarioFamilies: [],
        artifacts: [],
        note: 'fixture',
      },
      planFingerprint: 'plan-fingerprint',
      assurances: [
        'NO_DATABASE_WRITE',
        'NO_RPC_CALL',
        'NO_REMOTE_ACTION',
        'NO_FAULT_APPLIED',
      ] as const,
    };

    const persistence = new SimulationPersistenceService(new MongoSimulationPersistenceRepository());
    await persistence.createRun({
      idempotencyKey,
      live: false,
      createdAtMs: Date.now(),
      metadata,
      dryRunPlan: plan,
    });

    const now = Date.now();
    await SimulationRun.updateOne(
      { runKey },
      {
        $set: {
          recovery: {
            required: true,
            startedAtMs: now - 5_000,
            finishedAtMs: now - 1_000,
            allClear: true,
            targets: [
              {
                targetId: 'lab-mn-1',
                faultStateClear: true,
                expectedServiceRunning: true,
                observerFresh: true,
                checkedAtMs: now - 1_000,
                privateDetail: null,
              },
            ],
          },
        },
      }
    );
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await dropTestMongo();
  });

  interface RunBody {
    success: boolean;
    error?: string;
    data?: {
      runKey?: string;
      metadataFingerprint?: string;
      metadata?: Record<string, unknown>;
      state?: Record<string, unknown>;
      recovery?: unknown;
    };
  }

  async function getRun(path?: string): Promise<{ status: number; body: RunBody }> {
    const target = path ?? `/runs/${runKey}`;
    const response = await fetch(`${base}/api/v1/admin/simulations${target}`, {
      headers: { 'x-admin-api-key': API_KEY },
    });
    return { status: response.status, body: (await response.json()) as RunBody };
  }

  it('refuses an unauthenticated read', async () => {
    const response = await fetch(`${base}/api/v1/admin/simulations/runs/${runKey}`);
    expect(response.status).toBe(401);
  });

  it('carries the revision the panel has to order answers by', async () => {
    const { status, body } = await getRun();
    expect(status).toBe(200);
    expect(body.data?.runKey).toBe(runKey);
    expect(body.data?.state?.['revision']).toBeTypeOf('number');
    expect(body.data?.state?.['status']).toBeTypeOf('string');
    expect(body.data?.state?.['faultMayBeActive']).toBeTypeOf('boolean');
    expect(body.data?.state?.['live']).toBe(false);
    expect(body.data?.metadata?.['scenarioId']).toBe('mn-stop');
  });

  it('does not carry the recovery result, however clear it is on the document', async () => {
    const { status, body } = await getRun();
    // Guarded first: a 404 body contains no recovery either, and would pass the
    // assertion below while proving nothing.
    expect(status).toBe(200);
    expect(body.data?.recovery).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('allClear');
  });

  it('answers 404 for a run that does not exist, rather than an empty run', async () => {
    const { status, body } = await getRun('/runs/sim_000000000000000000000000000000ff');
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it('reports the live lock as its own state', async () => {
    const response = await fetch(`${base}/api/v1/admin/simulations/lock`, {
      headers: { 'x-admin-api-key': API_KEY },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data?: { configured?: boolean; lock?: unknown; blocking?: boolean };
    };
    expect(body.data?.configured).toBeTypeOf('boolean');
    expect(body.data?.blocking).toBeTypeOf('boolean');
  });
});
