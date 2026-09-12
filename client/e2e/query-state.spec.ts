import { expect, ok, test, type ApiStubs } from './harness.js';
import {
  chainLockReport,
  experimentRow,
  healthSnapshot,
  llmqProfile,
  pageOf,
  roundRun,
  selectionFairness,
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
