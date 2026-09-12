import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestMongo, dropTestMongo, HAVE_MONGO, MONGO_URI, syncIndexes } from './mongo.js';

/**
 * Paging the experiment list, against a real MongoDB.
 *
 * The list is the only index this project keeps of what was done to the
 * network, and the page that renders it asked for it with no arguments at all:
 * it got the server's default page of 25 out of 34 and put "Recorded runs" above
 * it. Nine runs were unreachable from the only screen that lists them.
 *
 * The paging itself was already correct on the server, with a true `total`. What
 * was not specified is the ORDER. `sort({ startedAt: -1 })` has no tie-breaker,
 * and experiments declared in the same second are common -- a rollout closes one
 * and opens the next. Rows with equal keys then come back in whatever order the
 * storage engine chooses, which is not an order this code asked for.
 *
 * A note on what this file does and does not demonstrate, because two versions
 * of it overclaimed before this one. Removing the tie-breaker makes NOTHING
 * here fail -- not completeness, not the declared order. `ExperimentRun` has an
 * index on `startedAt`, the sort is served from it, and equal keys come back in
 * a deterministic order without any help.
 *
 * The failure mode is real, and was measured separately: with the same sort NOT
 * backed by an index, paging 8 equal-keyed documents in pages of 4 returned two
 * of them twice and two not at all. That is what the tie-breaker insures
 * against, and it is not reproducible through this route today.
 *
 * What this file therefore proves is the thing the reader actually lost: that
 * the whole list is reachable, that the total is the true match count, and that
 * the filter counts what it matches. F04 was a client-side defect, and that is
 * where its regression test lives.
 */
const TOTAL = 34;
const PAGE = 5;

describe.skipIf(!HAVE_MONGO)('the experiment list pages completely', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    const dbName = await connectTestMongo('experimentpaging');
    process.env.MONGODB_URI = `${MONGO_URI.replace(/\/$/, '')}/${dbName}`;

    const [{ default: express }, { default: v1Routes }, { ExperimentRun }] = await Promise.all([
      import('express'),
      import('../routes/v1/index.js'),
      import('../models/ExperimentRun.js'),
    ]);
    await syncIndexes([ExperimentRun]);

    // Every run declared at the same instant, which is the case the missing
    // tie-breaker cannot order. Half closed, half running, so the status filter
    // has something to filter.
    const sameInstant = new Date('2026-09-11T09:00:00.000Z');
    await ExperimentRun.insertMany(
      Array.from({ length: TOTAL }, (_unused, i) => ({
        runKey: `paging-run-${String(i).padStart(3, '0')}`,
        title: `Paging fixture ${i}`,
        status: i % 2 === 0 ? 'closed' : 'running',
        startedAt: sameInstant,
        startHeight: 10_000 + i,
        llmqName: 'llmq_defcon',
        llmqSize: 60,
        llmqMinSize: 44,
        llmqThreshold: 41,
        dkgInterval: 24,
      }))
    );

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

  interface ListBody {
    success: boolean;
    data?: {
      items?: Array<{ runKey: string; status: string }>;
      total?: number;
      limit?: number;
      offset?: number;
    };
  }

  async function list(query: string): Promise<ListBody> {
    const response = await fetch(`${base}/api/v1/experiments?${query}`);
    expect(response.status).toBe(200);
    return (await response.json()) as ListBody;
  }

  it('reports the true total beside the page it served', async () => {
    const body = await list('limit=25&offset=0');
    expect(body.data?.total).toBe(TOTAL);
    expect(body.data?.items).toHaveLength(25);
    expect(body.data?.limit).toBe(25);
    expect(body.data?.offset).toBe(0);
  });

  /**
   * Completeness: page through the whole set and get every run exactly once.
   * This is what the reader needs and what the client could not do at all; it
   * is not, on its own, evidence about the sort (see the next test).
   */
  it('pages through every run exactly once, with equal timestamps', async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < TOTAL; offset += PAGE) {
      const body = await list(`limit=${PAGE}&offset=${offset}`);
      for (const item of body.data?.items ?? []) seen.push(item.runKey);
    }

    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
  });

  /**
   * The contract: the list comes back newest first, in one declared order.
   *
   * Not a regression test for the tie-breaker -- it passes with and without it,
   * because the index decides. It is here so a future change to the sort, the
   * index or the filter has to say so out loud.
   */
  it('returns the order the query declares, not the order the storage chose', async () => {
    const expected = Array.from({ length: TOTAL }, (_unused, i) =>
      `paging-run-${String(TOTAL - 1 - i).padStart(3, '0')}`
    );

    const seen: string[] = [];
    for (let offset = 0; offset < TOTAL; offset += PAGE) {
      const body = await list(`limit=${PAGE}&offset=${offset}`);
      for (const item of body.data?.items ?? []) seen.push(item.runKey);
    }
    expect(seen).toEqual(expected);
  });

  it('gives the same page the same answer twice', async () => {
    const first = await list(`limit=${PAGE}&offset=10`);
    const second = await list(`limit=${PAGE}&offset=10`);
    expect(second.data?.items?.map((i) => i.runKey)).toEqual(
      first.data?.items?.map((i) => i.runKey)
    );
  });

  it('counts what the filter matches, not what exists', async () => {
    const closed = await list('limit=25&offset=0&status=closed');
    expect(closed.data?.total).toBe(TOTAL / 2);
    expect(closed.data?.items?.every((item) => item.status === 'closed')).toBe(true);

    const running = await list('limit=25&offset=0&status=running');
    expect(running.data?.total).toBe(TOTAL / 2);
  });

  it('serves the last partial page rather than refusing it', async () => {
    const body = await list('limit=25&offset=25');
    expect(body.data?.items).toHaveLength(TOTAL - 25);
    expect(body.data?.total).toBe(TOTAL);
  });

  it('answers an offset past the end with an empty page and the true total', async () => {
    const body = await list('limit=25&offset=100');
    expect(body.data?.items).toHaveLength(0);
    // Not zero: nothing on this page is a different statement from nothing at all.
    expect(body.data?.total).toBe(TOTAL);
  });
});
