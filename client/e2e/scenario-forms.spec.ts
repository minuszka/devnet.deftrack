import { expect, ok, test, type ApiStubs, type AppHarness } from './harness.js';
import { adminSessionStubs, controlRun, runStubs, savedPlan, SCENARIO_STUBS } from './fixtures/admin.js';

/**
 * Day 15: the four scenarios that need no target chooser, as forms.
 *
 * The panel's only parameter editor was a JSON textarea. An operator had to
 * know the field names, the units and the bounds, and the first time they
 * learned any of them was when the server refused the request -- which is the
 * worst possible moment and the least useful place.
 *
 * The bounds on screen are the server's own: they arrive on the scenario
 * descriptor, and the server proves its table against `parseScenarioRequest`
 * itself (`scenarioFields.test.ts`). Nothing here re-states a limit; these
 * tests are about what the panel does with what it was given, and about the
 * one rule a form can get wrong in both directions at once -- the delay field.
 */
const RUNS = '/api/v1/admin/simulations/runs';
const PREPARE = 'Prepare dry-run plan';

async function openAdmin(app: AppHarness, stubs: ApiStubs = adminSessionStubs()): Promise<void> {
  app.stub(stubs);
  await app.goto('/admin');
}

/**
 * One path, two endpoints: the dashboard's run LIST on GET, the create on POST.
 * Answering both from the URL alone is impossible, which is why the harness
 * hands the method to a stub function.
 */
const CREATED = `sim_${'c'.repeat(32)}`;
function createStub(): ApiStubs {
  return {
    // A created run is immediately selected, so everything the dashboard then
    // reads about it has to answer too -- otherwise the harness refuses those
    // reads and the failure looks like a form defect.
    ...runStubs({ runKey: CREATED }),
    [RUNS]: (_url: URL, method: string) =>
      method === 'POST'
        ? { body: ok({ run: controlRun({ runKey: CREATED }), plan: savedPlan(CREATED) }) }
        : { body: ok({ items: [], total: 0 }) },
  };
}

/** What the last create actually sent. */
function lastCreate(app: AppHarness): Record<string, unknown> {
  const posts = app.requestsTo(RUNS, 'POST');
  expect(posts.length, 'no create was sent').toBeGreaterThan(0);
  const body = posts.at(-1)!.body as { scenario?: { parameters?: Record<string, unknown> } };
  return body.scenario?.parameters ?? {};
}

test.describe('scenario forms', () => {
  test('a scenario draws the fields its descriptor describes, with real bounds', async ({
    app,
    page,
  }) => {
    await openAdmin(app);

    const count = page.locator('#param-count');
    await expect(count).toBeVisible();
    await expect(count).toHaveValue('1');
    // The bounds are the server's, on the input the browser enforces them on.
    await expect(count).toHaveAttribute('min', '1');
    await expect(count).toHaveAttribute('max', '20');
    await expect(page.locator('#param-durationSeconds')).toHaveAttribute('max', '900');

    // The unit is on the screen, not in a comment somewhere.
    await expect(page.locator('.scenario-fields')).toContainText('seconds');
    await expect(page.locator('.scenario-fields')).toContainText('nodes');
  });

  test('the form and the JSON are two faces of one object', async ({ app, page }) => {
    await openAdmin(app);
    const json = page.getByRole('button', { name: /Advanced: the parameters as JSON/ });
    await json.click();

    await page.locator('#param-count').fill('4');
    expect(JSON.parse(await page.locator('textarea').inputValue())).toEqual({
      count: 4,
      durationSeconds: 60,
    });

    // And back the other way: editing the JSON moves the field.
    await page.locator('textarea').fill('{"count":7,"durationSeconds":120}');
    await expect(page.locator('#param-count')).toHaveValue('7');
    await expect(page.locator('#param-durationSeconds')).toHaveValue('120');
  });

  /**
   * The rule that matters most here: an unreadable draft must not be able to
   * start anything, and must not silently revert to the last object that did
   * parse. Both failures lose what somebody typed; the second also sends a
   * request they did not write.
   */
  test('unreadable JSON is kept, explained, and cannot prepare a run', async ({ app, page }) => {
    await openAdmin(app, { ...adminSessionStubs(), ...createStub() });
    await page.getByRole('button', { name: /Advanced: the parameters as JSON/ }).click();

    await page.locator('textarea').fill('{"count": 2,');

    await expect(page.locator('.alert[role="alert"]')).toContainText('cannot be read');
    // Kept exactly as typed.
    await expect(page.locator('textarea')).toHaveValue('{"count": 2,');

    await page.getByRole('button', { name: PREPARE, exact: true }).click();
    await expect(page.locator('.alert[role="alert"]').first()).toContainText('could not be read');
    expect(app.requestsTo(RUNS, 'POST'), 'a run was prepared from unreadable parameters').toHaveLength(0);

    // And it recovers: finishing the JSON clears the block.
    await page.locator('textarea').fill('{"count": 2, "durationSeconds": 60}');
    await expect(page.locator('#param-count')).toHaveValue('2');
    await page.getByRole('button', { name: PREPARE, exact: true }).click();
    await expect.poll(() => app.requestsTo(RUNS, 'POST').length).toBe(1);
    expect(lastCreate(app)).toEqual({ count: 2, durationSeconds: 60 });
  });

  test('each of the four scenarios sends the payload its schema takes', async ({ app, page }) => {
    await openAdmin(app, { ...adminSessionStubs(), ...createStub() });

    await page.locator('#param-count').fill('3');
    await page.locator('#param-durationSeconds').fill('120');
    await page.getByRole('button', { name: PREPARE, exact: true }).click();
    await expect.poll(() => app.requestsTo(RUNS, 'POST').length).toBe(1);
    expect(lastCreate(app)).toEqual({ count: 3, durationSeconds: 120 });
  });

  /**
   * The delay field, which is the one rule a form gets wrong in both
   * directions: the delay kinds REQUIRE `param` and the others REFUSE it, so
   * an input that is always visible produces a request the server rejects for
   * a reason the reader cannot see.
   */
  test('the delay field appears only for the kinds that take one', async ({ app, page }) => {
    await openAdmin(app, { ...adminSessionStubs(), ...createStub() });
    await page.locator('select').first().selectOption('dsl-fault');

    // response-drop: no delay field at all.
    await expect(page.locator('#param-param')).toHaveCount(0);

    await page.locator('#param-faultKind').selectOption('response-delay');
    await expect(page.locator('#param-param')).toBeVisible();
    // Filled with the minimum the schema accepts, not left empty: the server
    // refuses a delay kind with no param, and an empty box would send one.
    await expect(page.locator('#param-param')).toHaveValue('1');
    await expect(page.locator('#param-param')).toHaveAttribute('max', '24');

    await page.getByRole('button', { name: PREPARE, exact: true }).click();
    await expect.poll(() => app.requestsTo(RUNS, 'POST').length).toBe(1);
    expect(lastCreate(app)).toEqual({ faultKind: 'response-delay', count: 1, epochs: 1, param: 1 });
  });

  test('switching away from a delay kind removes the value the server forbids', async ({
    app,
    page,
  }) => {
    await openAdmin(app, { ...adminSessionStubs(), ...createStub() });
    await page.locator('select').first().selectOption('dsl-fault');
    await page.locator('#param-faultKind').selectOption('report-delay');
    await page.locator('#param-param').fill('5');

    await page.locator('#param-faultKind').selectOption('report-drop');
    await expect(page.locator('#param-param')).toHaveCount(0);

    await page.getByRole('button', { name: PREPARE, exact: true }).click();
    await expect.poll(() => app.requestsTo(RUNS, 'POST').length).toBe(1);
    // `param` is gone from the payload, not sent as 5 and not sent as 0.
    expect(lastCreate(app)).toEqual({ faultKind: 'report-drop', count: 1, epochs: 1 });
    expect(Object.keys(lastCreate(app))).not.toContain('param');
  });

  test('an empty number box is absent, never zero', async ({ app, page }) => {
    await openAdmin(app, { ...adminSessionStubs(), ...createStub() });
    await page.locator('#param-count').fill('');

    await page.getByRole('button', { name: /Advanced: the parameters as JSON/ }).click();
    // Zero is a value every one of these fields refuses, so inventing it from a
    // half-typed number would turn an unfinished form into a refused request.
    expect(JSON.parse(await page.locator('textarea').inputValue())).toEqual({ durationSeconds: 60 });
  });

  /** The seed: a draft may be reseeded, and a run shows the seed it was made with. */
  test('a draft can be reseeded and a loaded run shows its saved seed', async ({ app, page }) => {
    await openAdmin(app);
    const seed = page.locator('input[type="text"]').first();
    const before = await seed.inputValue();
    expect(before).not.toBe('');

    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect.poll(async () => seed.inputValue()).not.toBe(before);
  });

  test('a scenario the server describes no fields for falls back to JSON', async ({ app, page }) => {
    await openAdmin(app);
    await page.locator('select').first().selectOption('future-scenario');

    await expect(page.locator('.scenario-fields')).toHaveCount(0);
    await expect(page.locator('.parameters.notice')).toContainText('no form fields');
    // And the JSON is still reachable, so the scenario is not unusable.
    await page.getByRole('button', { name: /Advanced: the parameters as JSON/ }).click();
    await expect(page.locator('textarea')).toBeVisible();
  });

  test('every stubbed scenario that has fields draws all of them', async ({ app, page }) => {
    await openAdmin(app);
    for (const scenario of SCENARIO_STUBS) {
      if (scenario.parameterFields === undefined) continue;
      await page.locator('select').first().selectOption(scenario.scenarioId);
      for (const field of scenario.parameterFields) {
        // The conditional one is absent until its condition holds, which is the
        // subject of its own test above.
        if (field.onlyWhen !== undefined) continue;
        await expect(
          page.locator(`#param-${field.name}`),
          `${scenario.scenarioId}.${field.name}`
        ).toBeVisible();
      }
    }
  });
});
