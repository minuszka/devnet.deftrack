import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectTestMongo,
  dropTestMongo,
  HAVE_MONGO,
  MONGO_URI,
  NO_MONGO_REASON,
  syncIndexes,
} from './mongo.js';

/**
 * Does any public endpoint publish a host address?
 *
 * The redaction has unit tests: `containsHostAddress` is exercised directly and
 * `redactService` is exercised directly. What was never tested is the thing the
 * rule is actually about -- a REQUEST, through the real routes, over documents
 * that carry a real address, with the answer inspected as it goes out on the
 * wire. A field added to a projection next month is invisible to a unit test of
 * the redactor and would be published on the first deploy.
 *
 * So: seed addresses everywhere they can live, ask every public endpoint, and
 * assert that nothing in any answer looks like one. The endpoints that were
 * seeded must also come back non-trivially -- an empty answer contains no
 * address either, and would pass this sweep while proving nothing.
 *
 * The planted address is 198.51.100.11 (TEST-NET-2, RFC 5737). It is not a
 * host of ours and never can be, which is the point: nothing in this file
 * needs a real one to prove the rule.
 */
const PLANTED_IP = '198.51.100.11';
const PLANTED_SERVICE = `${PLANTED_IP}:19799`;

interface Probe {
  path: string;
  /** A substring the answer must contain, proving the seeded row was rendered. */
  proves?: string;
}

const PROBES: Probe[] = [
  { path: '/api/v1/masternodes?limit=50', proves: 'host-' },
  { path: '/api/v1/masternodes/timeline?hours=24' },
  { path: '/api/v1/masternodes/events?hours=168&limit=50', proves: 'host-' },
  { path: '/api/v1/masternodes/ban-waves?hours=168' },
  { path: '/api/v1/quorum-rounds?limit=50', proves: '7:8256:0' },
  { path: '/api/v1/quorum-rounds/7:8256:0', proves: 'host-' },
  { path: '/api/v1/quorum-rounds/health-timeline?hours=168&llmqName=llmq_defcon' },
  { path: '/api/v1/operators/reliability?hours=168' },
  { path: '/api/v1/peers/propagation?topic=block&events=10', proves: 'host-' },
  { path: '/api/v1/fairness/selection?rounds=50' },
  { path: '/api/v1/staking/health?blocks=100' },
  { path: '/api/v1/chainlocks?blocks=100' },
  { path: '/api/v1/blocks?limit=10' },
  { path: '/api/v1/txs?limit=10' },
  { path: '/api/v1/experiments?limit=10' },
  { path: '/api/v1/dsl/summary' },
  { path: '/api/v1/dsl/epochs?limit=10' },
  { path: '/api/v1/quorum-commitments?limit=10' },
];

describe.skipIf(!HAVE_MONGO)('no public endpoint publishes a host address', () => {
  let server: Server;
  let base = '';
  let containsHostAddress: (body: unknown) => boolean;

  beforeAll(async () => {
    const dbName = await connectTestMongo('publicapi');

    // config.ts reads MONGODB_URI at import time and the route modules import
    // it, so the environment has to be right before any of them are loaded --
    // hence the dynamic imports below rather than static ones at the top. The
    // value is never dialled: the connection is the one connectTestMongo
    // already opened, and this only has to satisfy the required() check.
    process.env.MONGODB_URI = `${MONGO_URI.replace(/\/$/, '')}/${dbName}`;
    process.env.PUBLIC_HOST_ADDRESSES = '0';

    const [{ MasternodeState }, { MasternodeEvent }, { QuorumRound }, { HostStatus }, { PeerObservation }] =
      await Promise.all([
        import('../models/MasternodeState.js'),
        import('../models/MasternodeEvent.js'),
        import('../models/QuorumRound.js'),
        import('../models/HostStatus.js'),
        import('../models/PeerObservation.js'),
      ]);
    ({ containsHostAddress } = await import('../domain/hostRedaction.js'));

    // What the server does at startup, done here for the same reason: with no
    // key the redactor issues no label at all, and every address-bearing field
    // comes back null. That is the right failure mode, but it is not the path
    // production takes, and a sweep run against it would pass without ever
    // redacting anything.
    const { initializeHostLabelPolicy } = await import('../services/hostLabel.service.js');
    await initializeHostLabelPolicy();

    await syncIndexes([MasternodeState, MasternodeEvent, QuorumRound, HostStatus, PeerObservation]);

    const now = new Date();
    await MasternodeState.create({
      proTxHash: 'a'.repeat(64),
      type: 'Regular',
      collateralHash: 'b'.repeat(64),
      collateralIndex: 0,
      service: PLANTED_SERVICE,
      registeredHeight: 100,
      lastPaidHeight: 8_200,
      poSePenalty: 0,
      poSeBanHeight: -1,
      poSeRevivedHeight: -1,
      banned: false,
      operatorLabel: 'op-fullnode-1',
      hostIp: PLANTED_IP,
      active: true,
      firstSeenAt: now,
      lastSeenAt: now,
    });

    await MasternodeEvent.create({
      eventKey: `${'a'.repeat(64)}:banned:8100`,
      proTxHash: 'a'.repeat(64),
      type: 'banned',
      height: 8_100,
      serviceBefore: PLANTED_SERVICE,
      serviceAfter: PLANTED_SERVICE,
      hostIp: PLANTED_IP,
      operatorLabel: 'op-fullnode-1',
      source: 'poll',
      detectedAt: now,
    });

    await QuorumRound.create({
      roundKey: '7:8256:0',
      llmqType: 7,
      llmqName: 'llmq_defcon',
      quorumIndex: 0,
      expectedHeight: 8_256,
      size: 60,
      minSize: 44,
      threshold: 41,
      dkgInterval: 24,
      effectiveSize: 60,
      numValidMembers: 59,
      healthRatio: 0.983,
      status: 'formed',
      formed: true,
      punishedCount: 1,
      quorumHash: 'c'.repeat(64),
      members: [
        { proTxHash: 'a'.repeat(64), service: PLANTED_SERVICE, valid: true, operatorLabel: 'op-fullnode-1' },
        { proTxHash: 'd'.repeat(64), service: `${PLANTED_IP}:19800`, valid: false, operatorLabel: null },
      ],
      invalidMembers: ['d'.repeat(64)],
      detailsComplete: true,
      firstSeenAt: now,
      detectedAt: now,
    });

    await HostStatus.create({
      host: PLANTED_IP,
      peers: 8,
      inbound: 3,
      verifiedMasternodes: 2,
      height: 8_270,
      agentVersion: 'observer/1',
      nodeBuild: 'abc123',
      reportedAt: now,
    });

    await PeerObservation.create({
      observationKey: `${PLANTED_IP}:block:${'e'.repeat(8)}`,
      host: PLANTED_IP,
      topic: 'block',
      hash: 'e'.repeat(64),
      height: 8_270,
      receivedAt: now,
      resolutionMs: 0,
      agentVersion: 'observer/1',
      ingestedAt: now,
    });

    const [{ default: express }, { default: v1Routes }] = await Promise.all([
      import('express'),
      import('../routes/v1/index.js'),
    ]);
    const app = express();
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

  it('planted an address the redaction has to deal with', async () => {
    // Guard against the sweep passing because the seed silently failed.
    const { MasternodeState } = await import('../models/MasternodeState.js');
    const row = await MasternodeState.findOne({ hostIp: PLANTED_IP }).lean();
    expect(row?.service).toBe(PLANTED_SERVICE);
    expect(containsHostAddress(row)).toBe(true);
  });

  for (const probe of PROBES) {
    it(`answers ${probe.path} without an address`, async () => {
      const response = await fetch(`${base}${probe.path}`);
      const text = await response.text();

      // A 500 also contains no address. The status is part of the assertion.
      expect(response.status, `${probe.path} -> ${text.slice(0, 200)}`).toBe(200);

      const body: unknown = JSON.parse(text);
      expect(containsHostAddress(body), `${probe.path} published an address`).toBe(false);
      expect(text).not.toContain(PLANTED_IP);

      if (probe.proves !== undefined) {
        expect(text, `${probe.path} answered without the seeded row`).toContain(probe.proves);
      }
    });
  }
});

describe.skipIf(HAVE_MONGO)('no public endpoint publishes a host address', () => {
  it('needs a database', () => {
    expect(NO_MONGO_REASON).toContain('MONGODB_TEST_URI');
  });
});
