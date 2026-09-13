import type { Page } from '@playwright/test';
import { expect, fail, ok, test, type ApiStubs, type StubResponse } from './harness.js';
import {
  blockRun,
  experimentRow,
  llmqProfile,
  pageOf,
  peerPropagation,
  roundRun,
  stakingHealth,
  txRun,
  V1_PROFILE,
} from './fixtures/api.js';
import { simRuns } from './fixtures/simulations.js';
import { shellStubs } from './fixtures/stubs.js';

/**
 * V4 of the final review: data belongs to the query that asked for it.
 *
 * Every filtered or paged page kept what it had loaded when the reader moved to
 * another page, filter, window or topic, and relabelled it: the pager, the
 * pressed filter and the section titles moved to the new query at once, while
 * the rows under them stayed the previous query's -- for as long as the new
 * answer took, and for good if it failed. Page 1's blocks read as page 2's.
 *
 * The rule kept from day 3 is untouched: when a refresh of the SAME query
 * fails, what was last loaded for it stays on screen beside the error. What
 * changes is that data is shown only under the query it answers.
 *
 * Measured on these seven pages; Fairness already dropped its data on a query
 * change, and PoSe Watch and Operators have no query to change.
 */

const NEXT_FAILED = 'the next slice is unavailable';

interface QueryCase {
  name: string;
  path: string;
  endpoint: string;
  /** Does this request ask for the query the change moves to? */
  isNext: (url: URL) => boolean;
  /** The honest answer for whatever is asked. */
  answer: (url: URL) => StubResponse;
  extra?: ApiStubs;
  change: (page: Page) => Promise<void>;
  /** A piece of the first query's data. */
  before: string;
  /** A piece of the next query's data. */
  after: string;
}

function paged(rows: (n: number, top?: number) => unknown[], total: number) {
  return (url: URL): StubResponse => {
    const limit = Number(url.searchParams.get('limit') ?? 25);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const remaining = Math.max(0, total - offset);
    return { body: ok({ items: rows(Math.min(limit, remaining), 11_500 - offset), total, limit, offset }) };
  };
}

const older = (page: Page) => page.getByRole('button', { name: 'Older', exact: true }).click();

const CASES: QueryCase[] = [
  {
    name: 'Blocks',
    path: '/blocks',
    endpoint: '/api/v1/blocks',
    isNext: (url) => url.searchParams.get('offset') === '25',
    answer: paged(blockRun, 200),
    change: older,
    before: 'dd-page-blocks tbody a[href="/block/11500"]',
    after: 'dd-page-blocks tbody a[href="/block/11475"]',
  },
  {
    name: 'Transactions',
    path: '/txs',
    endpoint: '/api/v1/txs',
    isNext: (url) => url.searchParams.get('offset') === '25',
    answer: paged(txRun, 90),
    change: older,
    before: 'dd-page-txs tbody a[href="/block/11500"]',
    after: 'dd-page-txs tbody a[href="/block/11475"]',
  },
  {
    name: 'DKG Rounds',
    path: '/rounds',
    endpoint: '/api/v1/quorum-rounds',
    isNext: (url) => url.searchParams.get('status') === 'failed',
    answer: (url) =>
      url.searchParams.get('status') === 'failed'
        ? { body: ok(pageOf(roundRun(2, 10_000), { total: 2, limit: 50 })) }
        : { body: ok(pageOf(roundRun(5), { total: 120, limit: 50 })) },
    extra: {
      '/api/v1/quorum-rounds/profiles': {
        body: ok({ items: [llmqProfile(), llmqProfile({ llmqName: V1_PROFILE, llmqType: 4 })] }),
      },
      '/api/v1/experiments': { body: ok(pageOf([experimentRow()], { total: 1 })) },
      '/api/v1/masternodes/events': { body: ok(pageOf([])) },
    },
    change: (page) => page.getByRole('button', { name: 'failed', exact: true }).click(),
    before: 'dd-page-rounds tbody a:text-is("7:11400:0")',
    after: 'dd-page-rounds tbody a:text-is("7:10000:0")',
  },
  {
    name: 'Experiments',
    path: '/experiments',
    endpoint: '/api/v1/experiments',
    isNext: (url) => url.searchParams.get('offset') === '25',
    answer: (url) => {
      const all = Array.from({ length: 60 }, (_unused, i) =>
        experimentRow({ runKey: `fixture-run-${String(i).padStart(3, '0')}` })
      );
      const limit = Number(url.searchParams.get('limit') ?? 25);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return { body: ok({ items: all.slice(offset, offset + limit), total: all.length, limit, offset }) };
    },
    change: older,
    before: 'dd-page-experiments tbody a[href="/experiments/fixture-run-000"]',
    after: 'dd-page-experiments tbody a[href="/experiments/fixture-run-025"]',
  },
  {
    name: 'Simulations',
    path: '/simulations',
    endpoint: '/api/v1/simulations',
    isNext: (url) => url.searchParams.get('offset') === '25',
    answer: (url) => {
      const all = simRuns(30);
      const limit = Number(url.searchParams.get('limit') ?? 25);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return { body: ok({ items: all.slice(offset, offset + limit), total: all.length, limit, offset }) };
    },
    change: older,
    before: `dd-page-simulations tbody a[href="/simulations/sim_${'0'.repeat(32)}"]`,
    after: `dd-page-simulations tbody a[href="/simulations/sim_${'0'.repeat(30)}25"]`,
  },
  {
    name: 'Staking',
    path: '/staking',
    endpoint: '/api/v1/staking/health',
    isNext: (url) => url.searchParams.get('blocks') === '1000',
    answer: (url) => ({ body: ok(stakingHealth({ windowBlocks: Number(url.searchParams.get('blocks') ?? 500) })) }),
    change: (page) => page.getByRole('button', { name: '1,000', exact: true }).click(),
    before: 'dd-page-staking .eyebrow:has-text("last 500 blocks")',
    after: 'dd-page-staking .eyebrow:has-text("last 1,000 blocks")',
  },
  {
    name: 'Vantage points',
    path: '/peers',
    endpoint: '/api/v1/peers/propagation',
    isNext: (url) => url.searchParams.get('topic') === 'chainlock',
    answer: (url) => {
      const topic = (url.searchParams.get('topic') ?? 'block') as 'block' | 'chainlock';
      const host = topic === 'block' ? 'laggard-of-blocks' : 'laggard-of-chainlocks';
      return {
        body: ok(peerPropagation({ topic, laggards: [{ host, samples: 12, meanDelayMs: 380, lastPlaceShare: 0.75 }] })),
      };
    },
    change: (page) => page.getByRole('button', { name: 'ChainLocks', exact: true }).click(),
    before: 'dd-page-peers td:text-is("laggard-of-blocks")',
    after: 'dd-page-peers td:text-is("laggard-of-chainlocks")',
  },
];

test.describe('data belongs to the query that asked for it', () => {
  for (const c of CASES) {
    test(`${c.name}: a query that fails leaves nothing of the previous one under it`, async ({ app, page }) => {
      app.stub({
        ...shellStubs(),
        ...c.extra,
        [c.endpoint]: (url) => (c.isNext(url) ? { status: 503, body: fail(NEXT_FAILED) } : c.answer(url)),
      });
      await app.goto(c.path);
      await expect(page.locator(c.before)).toBeVisible();

      await c.change(page);
      // The failure has been handled once its message is on screen.
      await expect(page.locator('.err').first()).toContainText(NEXT_FAILED);
      await expect(page.locator(c.before)).toHaveCount(0);
    });

    test(`${c.name}: a query still loading shows nothing of the previous one under it`, async ({ app, page }) => {
      const next = app.gate();
      app.stub({
        ...shellStubs(),
        ...c.extra,
        [c.endpoint]: (url) => (c.isNext(url) ? { ...c.answer(url), gate: next } : c.answer(url)),
      });
      await app.goto(c.path);
      await expect(page.locator(c.before)).toBeVisible();

      await c.change(page);
      await next.waitForHeld(1);
      await expect(page.locator(c.before)).toHaveCount(0);

      await next.release();
      await expect(page.locator(c.after)).toBeVisible();
    });
  }

  /**
   * The rule V4 must not break: a refresh of the same query that fails keeps
   * what was loaded for it. On a page whose data is one object rather than rows,
   * where hiding it on every error would be the easy, wrong fix.
   */
  test('a failed refresh of the same topic keeps what was loaded for it', async ({ app, page }) => {
    let failNext = false;
    const peers = CASES.find((c) => c.name === 'Vantage points')!;
    app.stub({
      ...shellStubs(),
      [peers.endpoint]: (url) => (failNext ? { status: 503, body: fail('refresh failed') } : peers.answer(url)),
    });
    await page.clock.install({ time: new Date('2026-09-11T09:00:00.000Z') });
    await app.goto(peers.path);
    await expect(page.locator(peers.before)).toBeVisible();

    failNext = true;
    await page.clock.fastForward(30_000);
    await expect(page.locator('.err').first()).toContainText('refresh failed');
    await expect(page.locator(peers.before)).toBeVisible();
  });

  /**
   * An answer for a page the reader has already left, released after the page
   * they moved on to has loaded.
   *
   * Measured before this test was written: it cannot land at all, because the
   * poll controller CANCELS the read of a query that has moved on -- the held
   * request fails with net::ERR_ABORTED, and its answer is never read. A first
   * version released it anyway, waited nine seconds for a read that could not
   * happen, swallowed the timeout and passed. Now the test says what happens:
   * the read was cancelled, and page 3 is what stays.
   */
  test('a late answer for the page before cannot land under the page after', async ({ app, page }) => {
    const second = app.gate();
    const blocks = CASES[0]!;
    app.stub({
      ...shellStubs(),
      [blocks.endpoint]: (url) =>
        url.searchParams.get('offset') === '25' ? { ...blocks.answer(url), gate: second } : blocks.answer(url),
    });
    await app.goto(blocks.path);
    await expect(page.locator(blocks.before)).toBeVisible();

    await older(page);
    await second.waitForHeld(1);
    // Page 3, while page 2's answer is still out. The pager is not usable while
    // nothing is loaded, so the address bar moves instead, as a link would.
    await page.evaluate(() => {
      history.pushState(null, '', '/blocks?page=3');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.locator('dd-page-blocks tbody a[href="/block/11450"]')).toBeVisible();

    await expect.poll(() => second.cancelled('/api/v1/blocks?limit=25&offset=25')).toBe(true);
    await expect(second.release()).rejects.toThrow('the page cancelled its request');
    await expect(page.locator('dd-page-blocks tbody a[href="/block/11450"]')).toBeVisible();
    await expect(page.locator(blocks.after)).toHaveCount(0);
    await expect(page.locator('dd-page-blocks .pager')).toContainText('51–75 of 200');
  });

  /** Back is a query change like any other: page 2's rows do not stand in for page 1's. */
  test('Back to the page before shows its own rows, not the ones it left', async ({ app, page }) => {
    const firstAgain = app.gate();
    let firstPageReads = 0;
    const blocks = CASES[0]!;
    app.stub({
      ...shellStubs(),
      [blocks.endpoint]: (url) => {
        if ((url.searchParams.get('offset') ?? '0') !== '0') return blocks.answer(url);
        firstPageReads += 1;
        return firstPageReads === 1 ? blocks.answer(url) : { ...blocks.answer(url), gate: firstAgain };
      },
    });
    await app.goto(blocks.path);
    await expect(page.locator(blocks.before)).toBeVisible();
    await older(page);
    await expect(page.locator(blocks.after)).toBeVisible();

    await page.goBack();
    await firstAgain.waitForHeld(1);
    await expect(page.locator(blocks.after)).toHaveCount(0);

    await firstAgain.release();
    await expect(page.locator(blocks.before)).toBeVisible();
    await expect(page.locator('dd-page-blocks .pager')).toContainText('1–25 of 200');
  });
});
