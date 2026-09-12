import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, MONGO_URI } from './mongo.js';

/**
 * The public simulation routes, against a real MongoDB, with private data
 * PLANTED in the stored documents.
 *
 * The DTOs that shape these responses have unit tests that hand them a source
 * with extra fields. That proves the copy, and not the route: the route also
 * decides what to read from Mongo, and the two together have never been run
 * over HTTP. A projection that selects a whole sub-document, or a DTO that
 * spreads one, is exactly where a field nobody meant to publish gets out.
 *
 * So the documents here are inserted raw -- through the driver, past Mongoose
 * validation -- carrying a sentinel string at every depth a public field lives
 * next to a private one. No response body may contain it.
 */
const SENTINEL = 'PRIVATE-SENTINEL-7f3c';
const RUN = `sim_${'4'.repeat(32)}`;
const UNMEASURED = `sim_${'5'.repeat(32)}`;
const TAMPERED = `sim_${'6'.repeat(32)}`;
const ABSENT = `sim_${'7'.repeat(32)}`;

describe.skipIf(!HAVE_MONGO)('public simulation routes do not publish private fields', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const dbName = await connectTestMongo('publicsims');
    process.env.MONGODB_URI = `${MONGO_URI.replace(/\/$/, '')}/${dbName}`;

    const [
      { default: express },
      { default: v1Routes },
      { SimulationRun },
      { SimulationMeasurementReportModel },
      { computeSimulationMeasurementReport },
    ] = await Promise.all([
      import('express'),
      import('../routes/v1/index.js'),
      import('../models/SimulationRun.js'),
      import('../models/SimulationMeasurementReport.js'),
      import('../simulator/simulationMeasurement.js'),
    ]);

    const run = (runKey: string) => ({
      runKey,
      // A private top-level field, as a future write path might add one.
      privateAudit: SENTINEL,
      metadata: {
        network: 'regtest',
        scenarioId: 'mn-stop',
        scenarioVersion: 1,
        parameters: { count: 1, durationSeconds: 60 },
        seed: 'fixture-seed',
        actorId: SENTINEL,
        targetSnapshot: [
          {
            targetId: 'lab-mn-1',
            displayLabel: 'lab-mn-1',
            proTxHash: null,
            role: 'masternode',
            // Registered, and private: where the target actually lives.
            hostRef: SENTINEL,
            unitRef: SENTINEL,
            p2pPort: 19_799,
            operatorId: SENTINEL,
            network: 'regtest',
            capturedAtMs: 1,
            capturedAtHeight: 1,
          },
        ],
        experimentRunKey: null,
        baselineRunKey: null,
      },
      state: {
        status: 'completed',
        revision: 7,
        live: true,
        createdAtMs: 1,
        updatedAtMs: 2,
        stateEnteredAtMs: 2,
        runExpiresAtMs: 9,
        faultLeaseExpiresAtMs: null,
        faultMayBeActive: false,
        abortRequested: false,
        // Passed through whole by the DTO: a sentinel inside it would travel.
        lastTransition: { eventType: 'completed', from: 'cooldown', to: 'completed', privateNote: SENTINEL },
        privateState: SENTINEL,
      },
      preflight: [
        {
          checkId: 'chain-identity',
          severity: 'required',
          passed: true,
          checkedAtMs: 1,
          publicMessage: 'chain identity matches',
          privateDetail: SENTINEL,
        },
      ],
      // Also passed through whole.
      dataQuality: {
        observerCoveragePercent: 100,
        staleTargetCount: 0,
        explorerLagBlocks: 0,
        missingHeights: [11_401],
        confidence: 'high',
        privateHosts: SENTINEL,
      },
      createdAt: new Date('2026-09-11T08:00:00Z'),
      updatedAt: new Date('2026-09-11T08:30:00Z'),
    });

    // One document written before `missingHeights` existed: it must still be
    // served, and must not claim that nothing was missing.
    const legacy = run(TAMPERED);
    delete (legacy.dataQuality as Record<string, unknown>)['missingHeights'];
    await SimulationRun.collection.insertMany([run(RUN), run(UNMEASURED), legacy]);

    const report = computeSimulationMeasurementReport({
      faultStartHeight: 10,
      faultEndHeight: 20,
      generatedAtMs: 100,
      impact: {
        affectedTargetCount: 0, affectedMasternodeCount: 0, affectedStakerCount: 0,
        affectedHostCount: 0, affectedCurrentQuorumMembers: 0, currentQuorumSize: null,
        survivingCurrentQuorumMembers: null, dkgThreshold: 44, chainLockThreshold: 41,
        dkgMarginAfterFault: null, chainLockMarginAfterFault: null, warnings: [],
      },
      evidence: {
        primaryLlmqName: 'llmq_defcon',
        blocks: [], rounds: [], poseEvents: [], dslEpochs: [], peerObservations: [],
        observationGaps: [], hosts: [], expectedHostIds: [],
      },
    });
    const record = (runKey: string, reportBody: Record<string, unknown>) => ({
      reportId: `measure_${runKey.slice(4, 12)}`,
      runKey,
      // Outside the fingerprinted report, and spread by the DTO.
      anchor: {
        faultStartHeight: 10, faultStartBlockHash: 'a'.repeat(64),
        faultEndHeight: 20, faultEndBlockHash: 'b'.repeat(64),
        privateSentinel: SENTINEL,
      },
      evidenceFingerprint: report.evidenceFingerprint,
      reportFingerprint: report.reportFingerprint,
      report: reportBody,
      generatedAtMs: 100,
      privateFleet: SENTINEL,
      createdAt: new Date(),
    });
    await SimulationMeasurementReportModel.collection.insertMany([
      record(RUN, { ...report }),
      // Inside the fingerprinted report: this must fail closed, never publish.
      record(TAMPERED, { ...report, delta: { ...report.delta, privateSentinel: SENTINEL } }),
    ]);

    const app = express();
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

  async function get(path: string): Promise<{ status: number; raw: string }> {
    const response = await fetch(`${base}${path}`);
    return { status: response.status, raw: await response.text() };
  }

  it('the list publishes the runs and none of what was planted in them', async () => {
    const { status, raw } = await get('/api/v1/simulations');
    expect(status).toBe(200);
    // The runs really were rendered, or the absence below proves nothing.
    expect(raw).toContain(RUN);
    expect(raw).not.toContain(SENTINEL);
  });

  it('a run publishes its public fields and none of what was planted in it', async () => {
    const { status, raw } = await get(`/api/v1/simulations/${RUN}`);
    expect(status).toBe(200);
    const body = JSON.parse(raw) as { data: { runKey: string; preflight: unknown[]; dataQuality: unknown } };
    expect(body.data.runKey).toBe(RUN);
    expect(body.data.preflight).toHaveLength(1);
    expect(body.data.dataQuality).not.toBeNull();
    expect(raw).not.toContain(SENTINEL);
  });

  it('a legacy run with no missing-heights record is served, and says so', async () => {
    const { status, raw } = await get(`/api/v1/simulations/${TAMPERED}`);
    expect(status).toBe(200);
    const body = JSON.parse(raw) as { data: { dataQuality: { missingHeights: unknown } } };
    // Not [] -- that would claim no heights were missing.
    expect(body.data.dataQuality.missingHeights).toBeNull();
    expect(raw).not.toContain(SENTINEL);
  });

  it('a report publishes its aggregate and none of what was planted beside it', async () => {
    const { status, raw } = await get(`/api/v1/simulations/${RUN}/report`);
    expect(status).toBe(200);
    expect(raw).toContain('"schemaVersion":1');
    expect(raw).not.toContain(SENTINEL);
  });

  /*
   * A field planted INSIDE the fingerprinted report cannot be published,
   * because the report no longer matches its own fingerprint. That is the
   * right failure: refused, and loudly, rather than served.
   */
  it('a report altered inside its fingerprint is refused, not served', async () => {
    const { status, raw } = await get(`/api/v1/simulations/${TAMPERED}/report`);
    expect(status).toBeGreaterThanOrEqual(500);
    expect(raw).not.toContain(SENTINEL);
  });

  /*
   * The two 404s the public page has to tell apart. The report endpoint cannot
   * do it on its own -- it answers 404 for both -- which is why the page asks
   * for the run first. What the server does guarantee is recorded here.
   */
  it('a run with no measurement and a run that does not exist are different answers', async () => {
    const unmeasuredRun = await get(`/api/v1/simulations/${UNMEASURED}`);
    const unmeasuredReport = await get(`/api/v1/simulations/${UNMEASURED}/report`);
    const absentRun = await get(`/api/v1/simulations/${ABSENT}`);

    expect(unmeasuredRun.status).toBe(200);
    expect(unmeasuredReport.status).toBe(404);
    expect(unmeasuredReport.raw).toContain('report not found');
    expect(absentRun.status).toBe(404);
    expect(absentRun.raw).toContain('run not found');
  });

  it('refuses a malformed key before it reaches the database', async () => {
    expect((await get('/api/v1/simulations/not-a-run-key')).status).toBe(400);
    expect((await get('/api/v1/simulations/not-a-run-key/report')).status).toBe(400);
  });
});
