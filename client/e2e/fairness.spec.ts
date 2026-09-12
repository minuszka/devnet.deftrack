import { expect, fail, ok, test, type ApiStubs } from './harness.js';
import {
  chainLockReport,
  healthSnapshot,
  llmqProfile,
  selectionFairness,
  V1_PROFILE,
  V2_PROFILE,
} from './fixtures/api.js';

/**
 * F05 and F06: the Fairness page answered a question nobody asked, and its host
 * table counted the wrong thing.
 *
 * The server has supported an `llmqName` filter all along. The page never sent
 * it, and without one the server does not filter -- so every figure on the
 * screen was computed across five interleaved schedules at once, with nothing
 * saying so. Blending interleaved schedules is the one reading this project's
 * own notes forbid, because it invents streaks and rates no type ever had.
 *
 * And the "Masternodes" column printed the number of a host's nodes that the
 * window happened to select. A host with seven registered and five drawn read
 * as a host with five. The other two had not gone anywhere: they had been
 * passed over, which is the finding the page exists to show.
 */
const FAIRNESS = '/api/v1/fairness/selection';

function fairnessStubs(extra: ApiStubs = {}): ApiStubs {
  return {
    '/api/v1/health': { body: ok(healthSnapshot()) },
    '/api/v1/chainlocks': { body: ok(chainLockReport()) },
    '/api/v1/quorum-rounds/profiles': {
      body: ok({
        items: [
          llmqProfile(),
          llmqProfile({ llmqName: V1_PROFILE, llmqType: 4, size: 400, minSize: 240, threshold: 240 }),
        ],
      }),
    },
    [FAIRNESS]: (url: URL) => ({
      body: ok(selectionFairness({ llmqName: url.searchParams.get('llmqName') })),
    }),
    ...extra,
  };
}

test.describe('selection fairness', () => {
  test('asks about the profile signing at the tip, and says which it is', async ({ app, page }) => {
    app.stub(fairnessStubs());
    await app.goto('/fairness');

    await expect(page.locator('dd-stat').first()).toBeVisible();
    // The profile was resolved the same way the front page resolves it, and
    // the request carried it.
    const calls = app.callsTo(FAIRNESS);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.includes(`llmqName=${V2_PROFILE}`))).toBe(true);
    // And it is on the screen, not only in the query string.
    await expect(page.locator('.tiles')).toContainText(V2_PROFILE);
  });

  test('another profile can be chosen, and the answer follows it', async ({ app, page }) => {
    app.stub(fairnessStubs());
    await app.goto('/fairness');
    await expect(page.locator('.tiles')).toContainText(V2_PROFILE);

    await page.getByRole('button', { name: V1_PROFILE, exact: false }).click();

    await expect(page.locator('.tiles')).toContainText(V1_PROFILE);
    expect(app.callsTo(FAIRNESS).at(-1) ?? '').toContain(`llmqName=${V1_PROFILE}`);
  });

  /**
   * The aggregate still exists. It is a choice somebody makes, under a name
   * that says what it is -- not the silent default it used to be.
   */
  test('the aggregate is available as an explicit choice', async ({ app, page }) => {
    app.stub(fairnessStubs());
    await app.goto('/fairness');
    await expect(page.locator('.tiles')).toContainText(V2_PROFILE);

    await page.getByRole('button', { name: 'All profiles · aggregate' }).click();

    const last = app.callsTo(FAIRNESS).at(-1) ?? '';
    expect(last).not.toContain('llmqName');
    await expect(page.locator('.tiles')).toContainText('all profiles');
  });

  /**
   * If the signing profile cannot be resolved, the page asks. It does not
   * quietly fall back to the aggregate, which is what it did before -- and the
   * blended number looks like an answer.
   */
  test('an unresolvable profile asks rather than aggregating', async ({ app, page }) => {
    app.stub(
      fairnessStubs({
        '/api/v1/chainlocks': { status: 503, body: fail('chainlock report unavailable') },
      })
    );
    await app.goto('/fairness');

    await expect(page.locator('.note[role="status"]')).toContainText(
      'signing profile could not be determined'
    );
    // Nothing was asked for at all: no sample, no figures.
    expect(app.callsTo(FAIRNESS)).toHaveLength(0);
    await expect(page.locator('.tiles')).toHaveCount(0);

    // Choosing one is what starts it.
    await page.getByRole('button', { name: V2_PROFILE, exact: false }).click();
    await expect(page.locator('.tiles')).toBeVisible();
    expect(app.callsTo(FAIRNESS).at(-1) ?? '').toContain(`llmqName=${V2_PROFILE}`);
  });

  /**
   * F06 in one row: seven registered, five selected, and both numbers on the
   * screen under names that cannot be confused.
   */
  test('a host reports its registry size and its selected count separately', async ({
    app,
    page,
  }) => {
    app.stub(fairnessStubs());
    await app.goto('/fairness');

    const row = page.locator('tbody tr').filter({ hasText: 'host-fixture-1' }).first();
    await expect(row).toContainText('7');
    await expect(row).toContainText('5');
    // The by-host table specifically: the page has two tables.
    const hostHead = page.locator('thead').filter({ hasText: 'Host' }).first();
    await expect(hostHead).toContainText('Registered nodes');
    await expect(hostHead).toContainText('Selected nodes');
  });

  test('a host the window never drew from is listed at zero, not omitted', async ({
    app,
    page,
  }) => {
    app.stub(fairnessStubs());
    await app.goto('/fairness');

    const quiet = page.locator('tbody tr').filter({ hasText: 'host-fixture-quiet' }).first();
    await expect(quiet).toBeVisible();
    await expect(quiet).toContainText('3');
  });

  /**
   * A server built before the field sends nothing. Nothing is not zero, and a
   * host of unknown size must not be drawn as a host with no masternodes.
   */
  test('an unreported registry size reads as unknown, never as zero', async ({ app, page }) => {
    const withoutField = selectionFairness();
    const hosts = withoutField.hosts.map(({ currentRegisteredNodes, ...rest }) => {
      void currentRegisteredNodes;
      return rest;
    });
    app.stub(fairnessStubs({ [FAIRNESS]: { body: ok({ ...withoutField, hosts }) } }));
    await app.goto('/fairness');

    const row = page.locator('tbody tr').filter({ hasText: 'host-fixture-1' }).first();
    await expect(row).toContainText('—');
  });

  /**
   * The route truncates the node list at 200 rows. The page used to sum the
   * rows it received and print the result as the network's figure.
   */
  test('the invalid total comes from the server, not from the rows on screen', async ({
    app,
    page,
  }) => {
    app.stub(
      fairnessStubs({
        [FAIRNESS]: {
          body: ok(
            selectionFairness({
              // Five rows on screen carrying 2 invalid between them, while the
              // whole window counted 41 across 300 nodes.
              totals: {
                nodesCounted: 300,
                timesSelected: 4_000,
                timesInvalid: 41,
                worstInvalidRate: 0.25,
              },
            })
          ),
        },
      })
    );
    await app.goto('/fairness');

    const tile = page.locator('dd-stat[label="Invalid members"]');
    await expect(tile).toHaveAttribute('value', '41');
    await expect(tile).toHaveAttribute('sub', /over all 300/);
  });

  test('a server that reports no total says so instead of summing the slice', async ({
    app,
    page,
  }) => {
    const { totals, ...withoutTotals } = selectionFairness();
    void totals;
    app.stub(fairnessStubs({ [FAIRNESS]: { body: ok(withoutTotals) } }));
    await app.goto('/fairness');

    const tile = page.locator('dd-stat[label="Invalid members"]');
    await expect(tile).toHaveAttribute('value', '—');
    await expect(tile).toHaveAttribute('sub', 'not reported by this server');
  });
});
