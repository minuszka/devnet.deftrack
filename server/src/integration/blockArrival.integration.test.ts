import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, MONGO_URI, NO_MONGO_REASON, syncIndexes } from './mongo.js';

/**
 * `/api/v1/block-arrival` over real documents, through the real route.
 *
 * The arithmetic is unit-tested in domain/blockArrival.ts. What only a real
 * query can prove is the wiring: that the route's projection actually carries
 * `firstSeenAt` (a field dropped from a `select()` would make every block look
 * unmeasured, and the answer would still be a valid-looking report), that the
 * window is taken from the tip downwards, and that a block the watcher never
 * saw arrive stays out of the percentiles instead of entering them as zero.
 *
 * The seeded heights are the real ones from 2026-09-10: 11059 was 172 s late
 * at the seed while its neighbours were within seconds, which is the case the
 * endpoint exists to make visible.
 */
const AT = (iso: string): Date => new Date(iso);
const UNIX = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

interface Seed {
  height: number;
  time: number;
  firstSeenAt: Date | null;
}

const SEEDS: Seed[] = [
  { height: 11_057, time: UNIX('2026-09-10T13:32:42Z'), firstSeenAt: AT('2026-09-10T13:32:47Z') },
  { height: 11_058, time: UNIX('2026-09-10T13:33:46Z'), firstSeenAt: AT('2026-09-10T13:33:47Z') },
  { height: 11_059, time: UNIX('2026-09-10T13:36:42Z'), firstSeenAt: AT('2026-09-10T13:39:34Z') },
  { height: 11_060, time: UNIX('2026-09-10T13:43:30Z'), firstSeenAt: AT('2026-09-10T13:43:35Z') },
  // Indexed before the watcher ran: no sighting at all.
  { height: 11_061, time: UNIX('2026-09-10T13:44:02Z'), firstSeenAt: null },
];

interface ArrivalBody {
  blocksConsidered: number;
  measured: number;
  unmeasured: number;
  lagSec: { min: number | null; p50: number | null; p90: number | null; p99: number | null; max: number | null };
  late: Array<{ thresholdSec: number; blocks: number; share: number | null }>;
  slowest: Array<{ height: number; lagSec: number | null }>;
  points: Array<{ height: number; lagSec: number | null }>;
  zmqEnabled: boolean;
}

describe.skipIf(!HAVE_MONGO)('GET /api/v1/block-arrival', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const dbName = await connectTestMongo('blockarrival');
    process.env.MONGODB_URI = `${MONGO_URI.replace(/\/$/, '')}/${dbName}`;

    const { Block } = await import('../models/Block.js');
    await syncIndexes([Block]);

    for (const s of SEEDS) {
      await Block.create({
        hash: s.height.toString(16).padStart(64, '0'),
        height: s.height,
        size: 763,
        version: 536_870_912,
        merkleroot: 'a'.repeat(64),
        time: s.time,
        nonce: 0,
        bits: '1d00ffff',
        difficulty: 1,
        chainwork: 'f'.repeat(64),
        nTx: 3,
        isProofOfStake: true,
        txids: [],
        firstSeenAt: s.firstSeenAt,
      });
    }

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

  const fetchArrival = async (query = 'blocks=100'): Promise<ArrivalBody> => {
    const res = await fetch(`${base}/api/v1/block-arrival?${query}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: ArrivalBody };
    expect(body.success).toBe(true);
    return body.data;
  };

  it('reports the late block with the lag the chain data implies', async () => {
    const d = await fetchArrival();
    expect(d.blocksConsidered).toBe(5);
    expect(d.measured).toBe(4);
    expect(d.unmeasured).toBe(1);
    expect(d.lagSec.max).toBe(172);
    expect(d.slowest[0]).toMatchObject({ height: 11_059, lagSec: 172 });
    expect(d.late.find((l) => l.thresholdSec === 120)).toEqual({
      thresholdSec: 120,
      blocks: 1,
      share: 0.25,
    });
  });

  it('carries firstSeenAt through the projection -- the wiring this test exists for', async () => {
    // If the route stopped selecting firstSeenAt, every block would come back
    // unmeasured and the report would still look perfectly well-formed.
    const d = await fetchArrival();
    expect(d.points.filter((p) => p.lagSec !== null)).toHaveLength(4);
    expect(d.points.map((p) => p.height)).toEqual([11_057, 11_058, 11_059, 11_060, 11_061]);
    expect(d.points.at(-1)!.lagSec).toBeNull();
  });

  it('takes the window from the tip downwards', async () => {
    const d = await fetchArrival('blocks=10');
    expect(d.points.at(-1)!.height).toBe(11_061);
    const two = await fetchArrival('blocks=10&_=1');
    expect(two.blocksConsidered).toBe(5);
  });

  it('refuses a window outside the declared bounds instead of silently clamping', async () => {
    const res = await fetch(`${base}/api/v1/block-arrival?blocks=9`);
    expect(res.status).toBe(400);
  });
});
