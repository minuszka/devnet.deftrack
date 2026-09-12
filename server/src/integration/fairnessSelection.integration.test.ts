import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, MONGO_URI, syncIndexes } from './mongo.js';

/**
 * The fairness answer over HTTP, against a real MongoDB.
 *
 * Two things needed a request rather than a unit test. The profile filter is a
 * query the route builds and hands to Mongo -- the page never sent it, so every
 * figure was computed across every interleaved schedule at once, and a unit
 * test of the domain cannot show whether the route narrows the sample. And the
 * host table's node count comes from two different places: the registry read in
 * the route, and the member lists read from the rounds. Only a request exercises
 * both together.
 *
 * The planted address is 198.51.100.11 (TEST-NET-2, RFC 5737): not a host of
 * ours and never can be. It is here so the redaction has something to drop --
 * the host figures are labels, and a new field must not be the one that leaks.
 */
const PLANTED_IP = '198.51.100.11';
const QUIET_IP = '198.51.100.12';
/** Registered after every round below, so no window here could have drawn it. */
const LATE_IP = '198.51.100.13';

describe.skipIf(!HAVE_MONGO)('fairness selection over HTTP', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const dbName = await connectTestMongo('fairness');
    process.env.MONGODB_URI = `${MONGO_URI.replace(/\/$/, '')}/${dbName}`;
    process.env.PUBLIC_HOST_ADDRESSES = '0';

    const [{ default: express }, { default: v1Routes }, { MasternodeState }, { QuorumRound }] =
      await Promise.all([
        import('express'),
        import('../routes/v1/index.js'),
        import('../models/MasternodeState.js'),
        import('../models/QuorumRound.js'),
      ]);
    const { initializeHostLabelPolicy } = await import('../services/hostLabel.service.js');
    await initializeHostLabelPolicy();
    await syncIndexes([MasternodeState, QuorumRound]);

    const now = new Date();
    const mn = (index: number, ip: string, registeredHeight = 100) => ({
      proTxHash: `${String(index).padStart(2, '0')}${'a'.repeat(62)}`,
      type: 'Regular',
      collateralHash: 'b'.repeat(64),
      collateralIndex: index,
      service: `${ip}:${19_799 + index}`,
      registeredHeight,
      lastPaidHeight: 8_200,
      poSePenalty: 0,
      poSeBanHeight: -1,
      poSeRevivedHeight: -1,
      banned: false,
      operatorLabel: 'op-fixture-1',
      hostIp: ip,
      active: true,
      firstSeenAt: now,
      lastSeenAt: now,
    });

    /*
      * Seven on the busy host, three on a host no round ever draws from, and one
      * registered at 9_500 -- after every round seeded below.
      *
      * That last one is the review's R6 in the fixture: it is in the registry
      * today, so it belongs in "how many are registered now", and it was not
      * there when these rounds ran, so it belongs in neither `neverSelected`
      * nor the selected count. The host used to be missing from the answer
      * altogether.
      */
    await MasternodeState.insertMany([
      ...Array.from({ length: 7 }, (_unused, i) => mn(i, PLANTED_IP)),
      ...Array.from({ length: 3 }, (_unused, i) => mn(10 + i, QUIET_IP)),
      mn(20, LATE_IP, 9_500),
    ]);

    const member = (index: number, valid: boolean) => ({
      proTxHash: `${String(index).padStart(2, '0')}${'a'.repeat(62)}`,
      service: `${PLANTED_IP}:${19_799 + index}`,
      valid,
      operatorLabel: 'op-fixture-1',
    });

    // Two rounds of llmq_defcon drawing five of the seven, and one round of a
    // different profile drawing a sixth -- so a filtered answer and an
    // aggregate one cannot be the same.
    await QuorumRound.insertMany([
      {
        roundKey: '7:9000:0',
        llmqType: 7,
        llmqName: 'llmq_defcon',
        quorumIndex: 0,
        expectedHeight: 9_000,
        size: 60,
        minSize: 44,
        threshold: 41,
        dkgInterval: 24,
        effectiveSize: 5,
        numValidMembers: 4,
        healthRatio: 0.8,
        status: 'formed',
        formed: true,
        punishedCount: 1,
        quorumHash: 'c'.repeat(64),
        members: [0, 1, 2, 3, 4].map((i) => member(i, i !== 0)),
        invalidMembers: [`00${'a'.repeat(62)}`],
        detailsComplete: true,
        firstSeenAt: now,
        detectedAt: now,
      },
      {
        roundKey: '7:9024:0',
        llmqType: 7,
        llmqName: 'llmq_defcon',
        quorumIndex: 0,
        expectedHeight: 9_024,
        size: 60,
        minSize: 44,
        threshold: 41,
        dkgInterval: 24,
        effectiveSize: 5,
        numValidMembers: 5,
        healthRatio: 1,
        status: 'formed',
        formed: true,
        punishedCount: 0,
        quorumHash: 'd'.repeat(64),
        members: [0, 1, 2, 3, 4].map((i) => member(i, true)),
        invalidMembers: [],
        detailsComplete: true,
        firstSeenAt: now,
        detectedAt: now,
      },
      {
        roundKey: '4:9048:0',
        llmqType: 4,
        llmqName: 'llmq_400_60',
        quorumIndex: 0,
        expectedHeight: 9_048,
        size: 400,
        minSize: 240,
        threshold: 240,
        dkgInterval: 72,
        effectiveSize: 1,
        numValidMembers: 1,
        healthRatio: 1,
        status: 'formed',
        formed: true,
        punishedCount: 0,
        quorumHash: 'e'.repeat(64),
        members: [member(5, true)],
        invalidMembers: [],
        detailsComplete: true,
        firstSeenAt: now,
        detectedAt: now,
      },
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

  interface FairnessBody {
    success: boolean;
    data?: {
      roundsConsidered?: number;
      llmqName?: string | null;
      hosts?: Array<{ host: string; nodes: number; currentRegisteredNodes?: number | null }>;
      totals?: { nodesCounted: number; timesSelected: number; timesInvalid: number };
      nodes?: unknown[];
      neverSelected?: string[];
      neverSelectedCount?: number;
    };
  }

  async function fairness(query: string): Promise<{ raw: string; body: FairnessBody }> {
    const response = await fetch(`${base}/api/v1/fairness/selection?${query}`);
    expect(response.status).toBe(200);
    const raw = await response.text();
    return { raw, body: JSON.parse(raw) as FairnessBody };
  }

  it('narrows the sample to the profile it was asked about', async () => {
    const { body } = await fairness('rounds=50&llmqName=llmq_defcon');
    expect(body.data?.llmqName).toBe('llmq_defcon');
    expect(body.data?.roundsConsidered).toBe(2);

    const other = await fairness('rounds=50&llmqName=llmq_400_60');
    expect(other.body.data?.roundsConsidered).toBe(1);

    // And the aggregate is a different answer again -- which is exactly why it
    // must be asked for rather than arrived at by omission.
    const all = await fairness('rounds=50');
    expect(all.body.data?.llmqName).toBeNull();
    expect(all.body.data?.roundsConsidered).toBe(3);
  });

  /**
   * F06 over the wire: seven registered on the host, five of them drawn by the
   * window. The table used to print the five under a column called
   * "Masternodes".
   */
  it('reports the registry size and the selected count as two fields', async () => {
    const { body } = await fairness('rounds=50&llmqName=llmq_defcon');
    const busy = body.data?.hosts?.find((h) => h.currentRegisteredNodes === 7);
    expect(busy).toBeDefined();
    expect(busy?.nodes).toBe(5);
  });

  it('lists a currently-registered host the window never drew from', async () => {
    const { body } = await fairness('rounds=50&llmqName=llmq_defcon');
    const quiet = body.data?.hosts?.find((h) => h.currentRegisteredNodes === 3);
    expect(quiet).toBeDefined();
    expect(quiet?.nodes).toBe(0);
  });

  /**
   * R6 over the wire. The count is the registry as it is now; the eligibility
   * filter belongs to the historical ratios and to `neverSelected`, and it
   * stayed there. Applied to this field it made "how many are registered" an
   * answer about which window had been asked for.
   */
  it('counts a node registered after the window, without accusing it', async () => {
    const { body } = await fairness('rounds=50&llmqName=llmq_defcon');
    const late = body.data?.hosts?.find((h) => h.currentRegisteredNodes === 1);
    expect(late).toBeDefined();
    // In the registry today, drawn by nothing in this window -- two columns,
    // two questions.
    expect(late?.nodes).toBe(0);
    // And not passed over: it was not there to pass over. A starved host is
    // what this page exists to find, so manufacturing one is the worst
    // available failure.
    expect(body.data?.neverSelected).not.toContain(`20${'a'.repeat(14)}`);
    expect(body.data?.neverSelectedCount).toBe(5);
  });

  it('carries totals computed over every node', async () => {
    const { body } = await fairness('rounds=50&llmqName=llmq_defcon');
    expect(body.data?.totals?.nodesCounted).toBe(5);
    expect(body.data?.totals?.timesSelected).toBe(10);
    expect(body.data?.totals?.timesInvalid).toBe(1);
  });

  /**
   * The rule that governs every public field, including the two added here.
   * The seeded rows carry real-looking addresses precisely so this can fail.
   */
  it('publishes host labels and never the addresses behind them', async () => {
    const { raw, body } = await fairness('rounds=50&llmqName=llmq_defcon');
    expect(raw).not.toContain(PLANTED_IP);
    expect(raw).not.toContain(QUIET_IP);
    expect(raw).not.toContain(LATE_IP);
    // And the seeded rows really were rendered, or this proves nothing. Three
    // hosts, not two: the third is the one registered after the window, which
    // was absent from the answer entirely before R6 was fixed.
    expect(body.data?.hosts?.length).toBe(3);
    expect(body.data?.hosts?.every((h) => h.host.startsWith('host-'))).toBe(true);
  });
});
