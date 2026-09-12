import { expect, fail, ok, test, type ApiStubs } from './harness.js';
import { experimentRow, pageOf } from './fixtures/api.js';
import { shellStubs } from './fixtures/stubs.js';

/**
 * F04: the experiment list showed 25 of 34 and called it the record.
 *
 * The page asked for the list with no arguments -- no limit, no offset, no
 * total -- and rendered whatever came back, which was the server's default
 * page. Nine runs were unreachable from the only screen that indexes them, and
 * nothing on the page suggested there were more. The server was already paging
 * correctly with a true `total`; the client simply never used either.
 */
const TOTAL = 34;

/** A page of the synthetic archive, answered from the query the client sent. */
function experimentStubs(total = TOTAL): ApiStubs {
  const all = Array.from({ length: total }, (_unused, i) =>
    experimentRow({
      runKey: `fixture-run-${String(total - 1 - i).padStart(3, '0')}`,
      title: `Fixture run ${total - 1 - i}`,
      // Alternating, so a status filter has something to narrow.
      status: i % 2 === 0 ? 'closed' : 'running',
    })
  );
  return {
    ...shellStubs(),
    '/api/v1/experiments': (url: URL) => {
      const status = url.searchParams.get('status');
      const limit = Number(url.searchParams.get('limit') ?? 25);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const matching = status === null ? all : all.filter((row) => row.status === status);
      return {
        body: ok({
          items: matching.slice(offset, offset + limit),
          total: matching.length,
          limit,
          offset,
        }),
      };
    },
  };
}

test.describe('experiment list', () => {
  test('serves the whole archive, not the first page of it', async ({ app, page }) => {
    app.stub(experimentStubs());
    await app.goto('/experiments');

    await expect(page.locator('.pager')).toContainText(`1–25 of ${TOTAL}`);
    await expect(page.locator('tbody tr')).toHaveCount(25);

    await page.getByRole('button', { name: 'Older' }).click();

    await expect(page.locator('.pager')).toContainText(`26–${TOTAL} of ${TOTAL}`);
    await expect(page.locator('tbody tr')).toHaveCount(TOTAL - 25);
    // The last run in the archive: the one that was unreachable before.
    await expect(page.locator('tbody')).toContainText('fixture-run-000');
    // Nothing further to page to.
    await expect(page.getByRole('button', { name: 'Older' })).toBeDisabled();

    await page.getByRole('button', { name: 'Newer' }).click();
    await expect(page.locator('.pager')).toContainText(`1–25 of ${TOTAL}`);
    await expect(page.getByRole('button', { name: 'Newer' })).toBeDisabled();
  });

  test('asks the server for the page, rather than slicing what it has', async ({ app, page }) => {
    app.stub(experimentStubs());
    await app.goto('/experiments');
    await expect(page.locator('.pager')).toContainText('1–25');

    await page.getByRole('button', { name: 'Older' }).click();
    await expect(page.locator('.pager')).toContainText('26–34');

    const calls = app.callsTo('/api/v1/experiments');
    expect(calls.some((call) => call.includes('offset=0'))).toBe(true);
    expect(calls.some((call) => call.includes('offset=25'))).toBe(true);
  });

  test('a status filter narrows the count as well as the rows', async ({ app, page }) => {
    app.stub(experimentStubs());
    await app.goto('/experiments');
    await expect(page.locator('.pager')).toContainText(`of ${TOTAL}`);

    await page.getByRole('button', { name: 'closed' }).click();

    await expect(page.locator('.pager')).toContainText(`of ${TOTAL / 2}`);
    expect(app.callsTo('/api/v1/experiments').some((c) => c.includes('status=closed'))).toBe(true);
  });

  /**
   * Page 2 of the closed runs is not page 2 of all runs. Keeping the offset
   * across a filter change lands the reader in the middle of a different set,
   * or past the end of it.
   */
  test('changing the filter returns to the first page', async ({ app, page }) => {
    app.stub(experimentStubs());
    await app.goto('/experiments');
    await page.getByRole('button', { name: 'Older' }).click();
    await expect(page.locator('.pager')).toContainText('26–34');

    await page.getByRole('button', { name: 'running' }).click();

    await expect(page.locator('.pager')).toContainText('1–17 of 17');
    const last = app.callsTo('/api/v1/experiments').at(-1) ?? '';
    expect(last).toContain('status=running');
    expect(last).toContain('offset=0');
  });

  test('an empty archive says so, and only when it is known to be empty', async ({ app, page }) => {
    app.stub(experimentStubs(0));
    await app.goto('/experiments');

    await expect(page.locator('.empty')).toContainText('No experiment recorded yet');
    await expect(page.locator('.pager')).toContainText('nothing to page through');
  });

  /**
   * Loading and empty looked identical and mean opposite things. On a page
   * whose subject is the record of what was done to the network, "nothing was
   * done" is the one answer that must never be guessed.
   */
  test('while loading it does not claim the archive is empty', async ({ app, page }) => {
    app.stub({
      ...experimentStubs(),
      '/api/v1/experiments': { body: ok(pageOf([], { total: TOTAL })), delayMs: 1_500 },
    });
    await app.goto('/experiments');

    await expect(page.locator('.empty')).toContainText('Loading');
    await expect(page.locator('.empty')).not.toContainText('No experiment recorded yet');
  });

  test('a failed load does not read as an empty archive either', async ({ app, page }) => {
    app.stub({
      ...experimentStubs(),
      '/api/v1/experiments': { status: 503, body: fail('the experiment index is unavailable') },
    });
    await app.goto('/experiments');

    await expect(page.locator('.err')).toContainText('the experiment index is unavailable');
    await expect(page.locator('.empty')).toContainText('what exists is unknown');
    await expect(page.locator('.empty')).not.toContainText('No experiment recorded yet');
  });

  /**
   * Moving from one run's detail to another's: what is on screen belongs to the
   * URL in the address bar, or to nothing at all.
   */
  test('one run detail does not linger under another run URL', async ({ app, page }) => {
    const first = experimentRow({ runKey: 'fixture-run-001', title: 'The first run' });
    const second = experimentRow({ runKey: 'fixture-run-002', title: 'The second run' });
    app.stub({
      ...experimentStubs(),
      '/api/v1/experiments/fixture-run-001': { body: ok({ ...first, members: [] }) },
      '/api/v1/experiments/fixture-run-002': {
        body: ok({ ...second, members: [] }),
        delayMs: 1_200,
      },
    });

    await app.goto('/experiments/fixture-run-001');
    await expect(page.locator('main')).toContainText('The first run');

    await page.evaluate(() => {
      history.pushState(null, '', '/experiments/fixture-run-002');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // The second answer has not arrived yet; the first must already be gone.
    await expect(page.locator('main')).not.toContainText('The first run');
    await expect(page.locator('main')).toContainText('The second run');
  });
});
