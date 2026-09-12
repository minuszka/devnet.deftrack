import { expect, ok, test, type ApiStubs, type AppHarness } from './harness.js';
import { adminSessionStubs, controlRun, savedPlan, SCENARIO_STUBS } from './fixtures/admin.js';

/**
 * F09: the panel offered parameters and modes the server could only refuse.
 *
 * Its table of defaults was maintained separately from the schema that
 * validates them, and it had drifted: `dsl-fault` had no entry at all, so
 * choosing it put `{}` in the field -- three required fields short. And `live`
 * was selectable beside `devnet`, a pair the server rejects at creation because
 * the only executor is the Docker lab.
 *
 * The templates now come from the module that owns the schema. That every one
 * of them satisfies its own schema is proven on the server, where the schema
 * is; what these tests cover is what the panel does with what it was given.
 */
const PARAMETERS = 'textarea';
const MODE = 'select >> nth=2';

async function openAdmin(app: AppHarness, stubs: ApiStubs): Promise<void> {
  app.stub(stubs);
  await app.goto('/admin');
}

/**
 * The JSON is behind a disclosure since day 15: the parameters have real form
 * fields now, and a JSON blob is not a form. These assertions are about what
 * the panel was GIVEN, which is still what the JSON shows, so they open it
 * rather than change what they check.
 */
async function openJson(page: import('@playwright/test').Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /Advanced: the parameters as JSON/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(page.locator(PARAMETERS)).toBeVisible();
}

test.describe('simulation control', () => {
  test('a scenario is seeded from the template the server serves for it', async ({ app, page }) => {
    await openAdmin(app, adminSessionStubs());
    await openJson(page);

    // mn-stop is selected first, so its template is what the object holds.
    expect(JSON.parse(await page.locator(PARAMETERS).inputValue())).toEqual({
      count: 1,
      durationSeconds: 60,
    });

    // The one that used to be `{}`.
    await page.locator('select').first().selectOption('dsl-fault');
    expect(JSON.parse(await page.locator(PARAMETERS).inputValue())).toEqual({
      faultKind: 'response-drop',
      count: 1,
      epochs: 1,
    });
  });

  test('a scenario with no template gets an empty field and says why', async ({ app, page }) => {
    await openAdmin(app, adminSessionStubs());
    await page.locator('select').first().selectOption('future-scenario');

    // Not `{}`: an empty object looks runnable and is refused by every scenario
    // that requires a field. A scenario the server describes no fields for also
    // gets no invented inputs -- it says so and offers the JSON.
    await expect(page.locator('.scenario-fields')).toHaveCount(0);
    await openJson(page);
    await expect(page.locator(PARAMETERS)).toHaveValue('{}');
    await expect(page.locator('.notes')).toContainText('offered no parameter template');
  });

  test('a placeholder target id is called a placeholder', async ({ app, page }) => {
    await openAdmin(app, adminSessionStubs());
    await page.locator('select').first().selectOption('clear-recover');

    await openJson(page);
    await expect(page.locator(PARAMETERS)).toHaveValue(/replace-with-a-registered-target-id/);
    await expect(page.locator('.notes')).toContainText('the registry will not');
  });

  test('live is offered only for the lab network, and never beside devnet', async ({
    app,
    page,
  }) => {
    await openAdmin(app, adminSessionStubs({ liveExecutorConfigured: true }));

    const mode = page.locator(MODE);
    await expect(mode.locator('option[value="live"]')).toHaveText('Live · regtest lab');

    // Choosing live settles the network rather than leaving a refused pair to
    // be assembled by hand.
    await mode.selectOption('live');
    await expect(page.locator('select >> nth=1')).toHaveValue('regtest');
    // `toBeDisabled` does not apply to <option>: Playwright's enabled/disabled
    // rule covers button, select, input and textarea only, so an option always
    // reads as enabled. The attribute is what carries the fact here.
    await expect(
      page.locator('select >> nth=1').locator('option[value="devnet"]')
    ).toHaveAttribute('disabled', '');
    await expect(page.locator('button[type="submit"]')).toContainText('Prepare live plan');
  });

  test('no configured executor means live cannot be chosen at all', async ({ app, page }) => {
    await openAdmin(app, adminSessionStubs({ liveExecutorConfigured: false }));

    await expect(page.locator(MODE).locator('option[value="live"]')).toHaveAttribute('disabled', '');
    await expect(page.locator('.notes')).toContainText('no configured lab executor');
  });

  /**
   * A client newer than its server. Absent capabilities are treated as "not
   * established", not as "yes" -- the panel fails closed rather than offering a
   * run this deployment may be unable to perform.
   */
  test('a server that reports no capabilities gets no live option', async ({ app, page }) => {
    await openAdmin(app, adminSessionStubs({ omitCapabilities: true }));

    await expect(page.locator(MODE).locator('option[value="live"]')).toHaveAttribute('disabled', '');
    await expect(page.locator('.notes')).toContainText('no configured lab executor');
  });

  test('the prepared run carries the mode and network that are selected', async ({ app, page }) => {
    await openAdmin(app, {
      ...adminSessionStubs(),
      '/api/v1/admin/simulations/runs': (url: URL) =>
        url.search.includes('live=true')
          ? { body: ok({ items: [], total: 0 }) }
          : {
              body: ok({
                run: {
                  runKey: 'sim_00000000000000000000000000000001',
                  state: {
                    status: 'draft',
                    live: false,
                    stateEnteredAtMs: 0,
                    faultLeaseExpiresAtMs: null,
                    faultMayBeActive: false,
                    abortRequested: false,
                  },
                },
                plan: {
                  runKey: 'sim_00000000000000000000000000000001',
                  network: 'regtest',
                  scenarioId: 'mn-stop',
                  selectedTargetIds: [],
                  actions: [],
                  impact: {
                    affectedTargetCount: 0,
                    affectedMasternodeCount: 0,
                    affectedStakerCount: 0,
                    affectedHostCount: 0,
                    affectedCurrentQuorumMembers: 0,
                    currentQuorumSize: null,
                    survivingCurrentQuorumMembers: null,
                    dkgMarginAfterFault: null,
                    chainLockMarginAfterFault: null,
                    warnings: [],
                  },
                  assurances: ['NO_REMOTE_ACTION'],
                },
              }),
            },
    });

    // Creating a run selects it, and a selected run is loaded back from the
    // server -- day 6's restoration path. Both reads have to be answered or the
    // harness refuses them, which is how this test found the new behaviour.
    const created = 'sim_00000000000000000000000000000001';
    app.stub({
      [`/api/v1/admin/simulations/runs/${created}`]: { body: ok(controlRun({ runKey: created })) },
      [`/api/v1/admin/simulations/runs/${created}/dry-run`]: {
        body: ok({ run: controlRun({ runKey: created }), plan: savedPlan(created) }),
      },
      [`/api/v1/admin/simulations/runs/${created}/history`]: {
        body: ok({ run: controlRun({ runKey: created }), audit: [], artifacts: [] }),
      },
      [`/api/v1/admin/simulations/runs/${created}/recovery`]: { body: ok({ recovery: null }) },
    });

    await page.locator(MODE).selectOption('live');
    await page.locator('button[type="submit"]').click();

    const posts = app.requestsTo('/api/v1/admin/simulations/runs', 'POST');
    expect(posts).toHaveLength(1);
    // The button used to say "dry-run" while the request carried the selected
    // mode. The request is what matters, and it must match the selection.
    expect(posts[0]?.body).toMatchObject({ mode: 'live', network: 'regtest' });
  });

  test('every scenario the server offers a template for is rendered as valid JSON', async ({
    app,
    page,
  }) => {
    await openAdmin(app, adminSessionStubs());
    await openJson(page);

    for (const scenario of SCENARIO_STUBS) {
      await page.locator('select').first().selectOption(scenario.scenarioId);
      const value = await page.locator(PARAMETERS).inputValue();
      if (scenario.parameterTemplate === undefined) {
        expect(value, scenario.scenarioId).toBe('{}');
        continue;
      }
      expect(JSON.parse(value), scenario.scenarioId).toEqual(scenario.parameterTemplate);
      // Never `{}`: the empty object is the shape the old table produced for
      // anything it did not know, and it is refused by every scenario that
      // requires a field.
      expect(Object.keys(JSON.parse(value) as object).length, scenario.scenarioId).toBeGreaterThan(0);
    }
  });
});
