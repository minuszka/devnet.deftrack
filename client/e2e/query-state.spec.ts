import { expect, ok, test, type ApiStubs } from './harness.js';
import {
  blockArrivalReport,
  blockRun,
  chainLockReport,
  experimentRow,
  healthSnapshot,
  llmqProfile,
  pageOf,
  peerPropagation,
  roundRun,
  selectionFairness,
  stakingHealth,
  txRun,
  V1_PROFILE,
  V2_PROFILE,
} from './fixtures/api.js';
import { overviewStubs, shellStubs } from './fixtures/stubs.js';

/**
 * F11's foundation: the filters a view is showing, in the address bar.
 *
 * Every filtered page held its state in component memory. A reload lost it and
 * a link carried none of it -- so the profile, status, window and page somebody
 * had arrived at while looking into an incident could not be handed to anybody
 * else. The URL in the ticket opened a different screen from the one that found
 * the thing.
 */
const ROUNDS = '/api/v1/quorum-rounds';
const FAIRNESS = '/api/v1/fairness/selection';
const EXPERIMENTS = '/api/v1/experiments';

function roundsStubs(): ApiStubs {
  return {
    ...shellStubs(),
    [ROUNDS]: { body: ok(pageOf(roundRun(5), { total: 120, limit: 50 })) },
    '/api/v1/quorum-rounds/profiles': {
      body: ok({ items: [llmqProfile(), llmqProfile({ llmqName: V1_PROFILE, llmqType: 4 })] }),
    },
    [EXPERIMENTS]: { body: ok(pageOf([experimentRow()], { total: 1 })) },
    '/api/v1/masternodes/events': { body: ok(pageOf([])) },
  };
}

function fairnessStubs(): ApiStubs {
  return {
    ...shellStubs(),
    '/api/v1/chainlocks': { body: ok(chainLockReport()) },
    '/api/v1/health': { body: ok(healthSnapshot()) },
    '/api/v1/quorum-rounds/profiles': {
      body: ok({ items: [llmqProfile(), llmqProfile({ llmqName: V1_PROFILE, llmqType: 4 })] }),
    },
    [FAIRNESS]: (url: URL) => ({
      body: ok(selectionFairness({ llmqName: url.searchParams.get('llmqName') })),
    }),
  };
}

function experimentStubs(total = 60): ApiStubs {
  const all = Array.from({ length: total }, (_unused, i) =>
    experimentRow({
      runKey: `fixture-run-${String(i).padStart(3, '0')}`,
      status: i % 2 === 0 ? 'closed' : 'running',
    })
  );
  return {
    ...shellStubs(),
    [EXPERIMENTS]: (url: URL) => {
      const status = url.searchParams.get('status');
      const limit = Number(url.searchParams.get('limit') ?? 25);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const matching = status === null ? all : all.filter((r) => r.status === status);
      return {
        body: ok({ items: matching.slice(offset, offset + limit), total: matching.length, limit, offset }),
      };
    },
  };
}

test.describe('filters in the URL', () => {
  test('a link opens the view it describes, in one request', async ({ app, page }) => {
    app.stub(roundsStubs());
    await app.goto(`/rounds?llmq=${V2_PROFILE}&status=failed&page=2`);

    await expect(page.locator('dd-page-rounds')).toHaveCount(1);
    const calls = app.callsTo(ROUNDS);
    // One fetch, carrying everything the URL said: `page` is 1-based for the
    // reader, `offset` is what the API takes.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`llmqName=${V2_PROFILE}`);
    expect(calls[0]).toContain('status=failed');
    expect(calls[0]).toContain('offset=50');
  });

  test('a filter the reader changes lands in the URL and fetches once', async ({ app, page }) => {
    app.stub(roundsStubs());
    await app.goto('/rounds');
    await expect(page.locator('dd-page-rounds')).toHaveCount(1);
    const before = app.callsTo(ROUNDS).length;

    await page.getByRole('button', { name: 'failed', exact: true }).click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get('status'))
      .toBe('failed');
    // Exactly one more request: the control writes the URL, the URL hands the
    // values back once, and the poll reloads from that one callback.
    await expect.poll(() => app.callsTo(ROUNDS).length).toBe(before + 1);
    await page.waitForTimeout(300);
    expect(app.callsTo(ROUNDS).length).toBe(before + 1);
  });

  test('Back returns to the previous filter', async ({ app, page }) => {
    app.stub(roundsStubs());
    await app.goto('/rounds');
    await page.getByRole('button', { name: 'failed', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('failed');

    await page.goBack();

    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBeNull();
    expect((app.callsTo(ROUNDS).at(-1) ?? '')).not.toContain('status=');
  });

  /**
   * A correction nobody asked for is not a history entry. Normalising with
   * `push` would make Back return to the broken URL -- and then forward to the
   * fixed one, for ever.
   */
  test('an unreadable query is corrected without costing a Back', async ({ app, page }) => {
    app.stub({ ...roundsStubs(), ...overviewStubs() });
    // Start somewhere else, so a spurious history entry is visible as a
    // pathname rather than only as a query string. Asserting the path after
    // Back was not enough on its own -- a correction pushed instead of replaced
    // leaves an entry on the SAME path, so the first version of this test
    // passed with the bug in place.
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    await page.evaluate(() => {
      history.pushState(null, '', '/rounds?page=-4&status=banana&llmq=NOT%20VALID');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // Everything unreadable fell back to its default, and the defaults are not
    // written out: the plain path is the plain view.
    await expect(page.locator('dd-page-rounds')).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).search).toBe('');

    await page.goBack();

    // One step back is where the reader actually was. A correction pushed
    // rather than replaced would land them on the corrected /rounds instead.
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  });

  test('a page past the server offset cap is clamped rather than refused', async ({ app, page }) => {
    app.stub(roundsStubs());
    await app.goto('/rounds?page=999999');

    // 100000 / 50 + 1
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2001');
    expect(app.callsTo(ROUNDS).at(-1) ?? '').toContain('offset=100000');
  });

  test('fairness carries its profile and window', async ({ app, page }) => {
    app.stub(fairnessStubs());
    await app.goto(`/fairness?llmq=${V1_PROFILE}&rounds=100`);

    await expect(page.locator('.tiles')).toContainText(V1_PROFILE);
    const call = app.callsTo(FAIRNESS).at(-1) ?? '';
    expect(call).toContain(`llmqName=${V1_PROFILE}`);
    expect(call).toContain('rounds=100');
  });

  /**
   * Absent is not the aggregate here: it means "whatever signs at the tip", so
   * the link keeps following the chain. `all` is the aggregate, and somebody
   * had to choose it.
   */
  test('fairness without a profile follows the tip, and Back restores that', async ({
    app,
    page,
  }) => {
    app.stub(fairnessStubs());
    await app.goto('/fairness');
    await expect(page.locator('.tiles')).toContainText(V2_PROFILE);

    await page.getByRole('button', { name: V1_PROFILE, exact: false }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('llmq')).toBe(V1_PROFILE);
    await expect(page.locator('.tiles')).toContainText(V1_PROFILE);

    await page.goBack();

    await expect.poll(() => new URL(page.url()).searchParams.get('llmq')).toBeNull();
    // Back to the tip's profile, resolved again rather than left at the last
    // one that happened to be chosen.
    await expect(page.locator('.tiles')).toContainText(V2_PROFILE);
  });

  test('experiments carry their status and page', async ({ app, page }) => {
    app.stub(experimentStubs());
    await app.goto('/experiments?status=closed&page=2');

    await expect(page.locator('.pager')).toContainText('26–30 of 30');
    const call = app.callsTo(EXPERIMENTS).at(-1) ?? '';
    expect(call).toContain('status=closed');
    expect(call).toContain('offset=25');
  });

  test('a filter change resets the page, in the URL as well as in the request', async ({
    app,
    page,
  }) => {
    app.stub(experimentStubs());
    await app.goto('/experiments?page=2');
    await expect(page.locator('.pager')).toContainText('26–50');

    await page.getByRole('button', { name: 'closed', exact: true }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBeNull();
    expect(app.callsTo(EXPERIMENTS).at(-1) ?? '').toContain('offset=0');
  });

  /**
   * Several changes in quick succession. The poll controller cancels what it
   * supersedes, so the answer on screen is the answer to the last question --
   * not whichever request happened to finish last.
   */
  test('rapid switching leaves the last choice on screen', async ({ app, page }) => {
    app.stub(experimentStubs());
    await app.goto('/experiments');

    await page.getByRole('button', { name: 'closed', exact: true }).click();
    await page.getByRole('button', { name: 'running', exact: true }).click();
    await page.getByRole('button', { name: 'closed', exact: true }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('closed');
    await expect(page.locator('.pager')).toContainText('of 30');
    await expect(page.locator('tbody')).toContainText('fixture-run-000');
  });
});

/**
 * Day 11: the same rule, applied to the controls the remaining pages already
 * had.
 *
 * Nothing new was invented. The survey behind this block found exactly four
 * pages with a control -- a topic, a window, a leaderboard view and two pagers
 * -- and three of the pages the plan names (PoSe, ChainLocks, Sentinel Layer)
 * have no control at all, so they get no parameter.
 */
const PEERS = '/api/v1/peers/propagation';
const STAKING = '/api/v1/staking/health';
const BLOCKS = '/api/v1/blocks';
const TXS = '/api/v1/txs';

function peerStubs(): ApiStubs {
  return {
    ...shellStubs(),
    [PEERS]: (url: URL) => ({
      body: ok(
        peerPropagation({
          topic: (url.searchParams.get('topic') ?? 'block') as 'block' | 'chainlock',
        })
      ),
    }),
  };
}

function stakingStubs(): ApiStubs {
  return {
    ...shellStubs(),
    [STAKING]: (url: URL) => ({
      body: ok(stakingHealth({ windowBlocks: Number(url.searchParams.get('blocks') ?? 500) })),
    }),
  };
}

/** One paged list, answering honestly for whatever slice is asked for. */
function pagedStubs(path: string, rows: (n: number, top?: number) => unknown[], total: number): ApiStubs {
  return {
    ...shellStubs(),
    [path]: (url: URL) => {
      const limit = Number(url.searchParams.get('limit') ?? 25);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const remaining = Math.max(0, total - offset);
      return {
        body: ok({
          items: rows(Math.min(limit, remaining), 11_500 - offset),
          total,
          limit,
          offset,
        }),
      };
    },
  };
}

test.describe('filters in the URL: the remaining pages', () => {
  /* ── Vantage Points: a topic ────────────────────────────────────────────── */

  test('a link opens the propagation topic it names, in one request', async ({ app, page }) => {
    app.stub(peerStubs());
    await app.goto('/peers?topic=chainlock');

    await expect(page.locator('dd-page-peers')).toHaveCount(1);
    const calls = app.callsTo(PEERS);
    // One fetch, already carrying the topic: not blocks followed by a
    // correction to chainlocks.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('topic=chainlock');
  });

  test('choosing a topic lands in the URL, and Back returns to the other one', async ({
    app,
    page,
  }) => {
    app.stub(peerStubs());
    await app.goto('/peers');
    await expect(page.locator('dd-page-peers')).toHaveCount(1);
    const before = app.callsTo(PEERS).length;

    await page.getByRole('button', { name: 'ChainLocks', exact: true }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('topic')).toBe('chainlock');
    // Exactly one more request: the control writes the URL, the URL hands the
    // value back once, and the poll reloads from that one callback.
    await expect.poll(() => app.callsTo(PEERS).length).toBe(before + 1);

    await page.goBack();

    await expect.poll(() => new URL(page.url()).searchParams.get('topic')).toBeNull();
    await expect.poll(() => app.callsTo(PEERS).at(-1) ?? '').toContain('topic=block');
  });

  test('a reload keeps the topic that was being read', async ({ app, page }) => {
    app.stub(peerStubs());
    await app.goto('/peers?topic=chainlock');
    await expect(page.locator('dd-page-peers')).toHaveCount(1);

    await page.reload();

    await expect(page.locator('dd-page-peers')).toHaveCount(1);
    expect(app.callsTo(PEERS).at(-1) ?? '').toContain('topic=chainlock');
  });

  /* ── Staking: a window that refetches, and a view that must not ─────────── */

  test('a link opens the staking window it names', async ({ app, page }) => {
    app.stub(stakingStubs());
    await app.goto('/staking?blocks=1000');

    await expect(page.locator('dd-page-staking')).toHaveCount(1);
    const calls = app.callsTo(STAKING);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('blocks=1000');
  });

  test('the window lands in the URL and Back restores the previous sample', async ({
    app,
    page,
  }) => {
    app.stub(stakingStubs());
    await app.goto('/staking');
    await expect(page.locator('dd-page-staking')).toHaveCount(1);

    await page.getByRole('button', { name: '1,000', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('blocks')).toBe('1000');

    await page.goBack();

    // The default is absent from the URL, not written into it.
    await expect.poll(() => new URL(page.url()).searchParams.get('blocks')).toBeNull();
    await expect.poll(() => app.callsTo(STAKING).at(-1) ?? '').toContain('blocks=500');
  });

  /**
   * The leaderboard view is a way of reading the answer already on screen --
   * machines against payout keys -- so it belongs in the link but must not ask
   * the server anything. Two daemons on one box are one machine; which question
   * somebody was looking at is part of what they found.
   */
  test('the leaderboard view is in the URL and costs no request', async ({ app, page }) => {
    app.stub(stakingStubs());
    await app.goto('/staking');
    await expect(page.locator('dd-page-staking')).toHaveCount(1);
    const before = app.callsTo(STAKING).length;

    await page.getByRole('button', { name: 'Payout keys', exact: false }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('keys');
    await page.waitForTimeout(300);
    expect(app.callsTo(STAKING).length).toBe(before);
  });

  test('a link carries the window and the view together', async ({ app, page }) => {
    app.stub(stakingStubs());
    await app.goto('/staking?blocks=200&view=keys');

    await expect(page.locator('dd-page-staking')).toHaveCount(1);
    expect(app.callsTo(STAKING).at(-1) ?? '').toContain('blocks=200');
    // And the view really is the chosen one, not merely a parameter nobody read.
    await expect(page.locator('.toggle button.on')).toHaveText(/payout keys/i);
  });

  /* ── Blocks and Transactions: a pager each ──────────────────────────────── */

  test('a link opens the page of blocks it names, in one request', async ({ app, page }) => {
    app.stub(pagedStubs(BLOCKS, blockRun, 200));
    await app.goto('/blocks?page=3');

    await expect(page.locator('dd-page-blocks')).toHaveCount(1);
    const calls = app.callsTo(BLOCKS);
    expect(calls).toHaveLength(1);
    // page 3 at 25 a page.
    expect(calls[0]).toContain('offset=50');
    await expect(page.locator('.pager')).toContainText('51–75 of 200');
  });

  test('paging lands in the URL, and Back returns to the page before', async ({ app, page }) => {
    app.stub(pagedStubs(BLOCKS, blockRun, 200));
    await app.goto('/blocks');
    await expect(page.locator('.pager')).toContainText('1–25');

    await page.getByRole('button', { name: 'Older', exact: true }).click();

    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
    await expect(page.locator('.pager')).toContainText('26–50');

    await page.goBack();

    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBeNull();
    await expect(page.locator('.pager')).toContainText('1–25');
  });

  test('a reload keeps the page of transactions that was being read', async ({ app, page }) => {
    app.stub(pagedStubs(TXS, txRun, 90));
    await app.goto('/txs?page=2');
    await expect(page.locator('.pager')).toContainText('26–50 of 90');

    await page.reload();

    await expect(page.locator('.pager')).toContainText('26–50 of 90');
    expect(app.callsTo(TXS).at(-1) ?? '').toContain('offset=25');

    // And the other direction on this page too, not only on Blocks: reading the
    // URL and writing it are two different pieces of wiring, and a control that
    // reads but does not write is exactly the state this page started in.
    await page.getByRole('button', { name: 'Older', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('3');
    await expect(page.locator('.pager')).toContainText('51–75 of 90');
  });

  /**
   * The same normalising rule as the three pages of day 10, on a page that was
   * wired today: unreadable becomes the default, and the correction is a
   * replace rather than a push -- nobody asked for it, so it must not cost a
   * press of Back.
   */
  test('an unreadable page number is corrected without costing a Back', async ({ app, page }) => {
    app.stub({ ...pagedStubs(TXS, txRun, 90), ...overviewStubs() });
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    await page.evaluate(() => {
      history.pushState(null, '', '/txs?page=-9');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await expect(page.locator('dd-page-txs')).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).search).toBe('');

    await page.goBack();

    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  });

  /**
   * The pages the plan names that have no control at all. They are here so the
   * claim "nothing was invented for them" is checked rather than asserted: a
   * later change that adds a parameter to one of these has to come with a
   * control somebody can actually operate.
   */
  test('a page with no control acquires no parameter', async ({ app, page }) => {
    app.stub({
      ...shellStubs(),
      '/api/v1/chainlocks': { body: ok(chainLockReport()) },
      '/api/v1/block-arrival': { body: ok(blockArrivalReport()) },
    });
    await app.goto('/chainlocks');

    await expect(page.locator('dd-page-chainlocks')).toHaveCount(1);
    expect(new URL(page.url()).search).toBe('');
    // And no control that a URL ought to have been carrying.
    await expect(page.locator('dd-page-chainlocks .seg')).toHaveCount(0);
  });
});
