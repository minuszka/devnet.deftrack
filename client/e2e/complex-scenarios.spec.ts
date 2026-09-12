import { expect, ok, test, type ApiStubs, type AppHarness } from './harness.js';
import { adminSessionStubs, controlRun, labRegistry, runStubs, savedPlan, RUN_A } from './fixtures/admin.js';

/**
 * Day 16: the five scenarios that need a real target.
 *
 * `host-outage`, `restart-flapping`, `network-degradation`, `node-isolation`
 * and `clear-recover` all name targets, and the only way to name one was to
 * type its id into a text box. An id the registry did not know, a staker in a
 * masternode slot, a target in maintenance -- each was found out from the
 * server, after Prepare.
 *
 * The chooser lists the whole registry and marks what it cannot take, with the
 * reason. Those reasons are the server's own rules: the role and capability are
 * proven against the dry-run executor in `scenarioFields.test.ts`, and the
 * network, enabled and maintenance rules are the resolver's.
 */
const RUNS = '/api/v1/admin/simulations/runs';
const PREPARE = 'Prepare dry-run plan';
const CREATED = `sim_${'d'.repeat(32)}`;

async function openAdmin(app: AppHarness, extra: ApiStubs = {}, targets = labRegistry()): Promise<void> {
  app.stub({ ...adminSessionStubs({ targets }), ...extra });
  await app.goto('/admin');
}

function createStub(): ApiStubs {
  return {
    ...runStubs({ runKey: CREATED }),
    [RUNS]: (_url: URL, method: string) =>
      method === 'POST'
        ? { body: ok({ run: controlRun({ runKey: CREATED }), plan: savedPlan(CREATED) }) }
        : { body: ok({ items: [], total: 0 }) },
  };
}

function lastCreate(app: AppHarness): Record<string, unknown> {
  const posts = app.requestsTo(RUNS, 'POST');
  expect(posts.length, 'no create was sent').toBeGreaterThan(0);
  return ((posts.at(-1)!.body as { scenario?: { parameters?: Record<string, unknown> } }).scenario?.parameters) ?? {};
}

/** The row for one target inside a chooser, and what it says about itself. */
const row = (page: import('@playwright/test').Page, targetId: string) =>
  page.locator('.target-list li', { hasText: targetId });

async function choose(page: import('@playwright/test').Page, scenarioId: string): Promise<void> {
  await page.locator('select').first().selectOption(scenarioId);
}

test.describe('scenarios that name targets', () => {
  test('the chooser marks every reason a target cannot be taken', async ({ app, page }) => {
    await openAdmin(app);
    await choose(page, 'network-degradation');

    // Selectable: an ordinary lab masternode with netem.
    await expect(row(page, 'lab-mn-1').locator('input')).toBeEnabled();

    // And every refusal, in the server's words.
    await expect(row(page, 'lab-mn-off')).toContainText('disabled in the registry');
    await expect(row(page, 'lab-mn-maint')).toContainText('in maintenance');
    await expect(row(page, 'lab-mn-devnet')).toContainText('on devnet; this draft is for regtest');
    await expect(row(page, 'lab-mn-nonetem')).toContainText('has no netem-p2p');
    for (const blocked of ['lab-mn-off', 'lab-mn-maint', 'lab-mn-devnet', 'lab-mn-nonetem']) {
      await expect(row(page, blocked).locator('input'), blocked).toBeDisabled();
    }
  });

  /**
   * The rule the whole chooser rests on. A target's NAME is not what it is:
   * `lab-mn-st` looks like a masternode and is registered as a staker, and the
   * registry is what decides.
   */
  test('a role is read from the registry, never from the name', async ({ app, page }) => {
    await openAdmin(app);
    await choose(page, 'node-isolation');

    await expect(row(page, 'lab-mn-st')).toContainText('a staker; this needs a masternode');
    await expect(row(page, 'lab-mn-st').locator('input')).toBeDisabled();
    // And the seed is never a masternode, whatever shares its host.
    await expect(row(page, 'lab-seed')).toContainText('a seed; this needs a masternode');
  });

  test('a role taken from another field moves the chooser with it', async ({ app, page }) => {
    await openAdmin(app);
    await choose(page, 'restart-flapping');

    await expect(row(page, 'lab-st-1')).toContainText('a staker; this needs a masternode');
    await page.locator('#param-role').selectOption('staker');
    await expect(row(page, 'lab-st-1').locator('input')).toBeEnabled();
    await expect(row(page, 'lab-mn-1')).toContainText('a masternode; this needs a staker');
  });

  test('too many stakers is refused on the form, where the ceiling is shown', async ({ app, page }) => {
    await openAdmin(app);
    await choose(page, 'restart-flapping');
    const count = page.locator('#param-count');

    await expect(count).toHaveAttribute('max', '10');
    await page.locator('#param-role').selectOption('staker');
    // Five, not ten: stakers produce the blocks.
    await expect(count).toHaveAttribute('max', '5');
    await expect(page.locator('.scenario-fields')).toContainText('1–5 services');
  });

  test('an empty registry says so instead of drawing an empty list', async ({ app, page }) => {
    await openAdmin(app, {}, []);
    await choose(page, 'host-outage');

    await expect(page.locator('fieldset.target-chooser')).toContainText('registry is empty');
    await expect(page.locator('.target-list')).toHaveCount(0);
  });

  test('host-outage sends the chosen anchor, and only that', async ({ app, page }) => {
    await openAdmin(app, createStub());
    await choose(page, 'host-outage');

    await row(page, 'lab-mn-3').locator('input').check();
    await page.getByRole('button', { name: PREPARE, exact: true }).click();
    await expect.poll(() => app.requestsTo(RUNS, 'POST').length).toBe(1);
    expect(lastCreate(app)).toEqual({ anchorTargetId: 'lab-mn-3', durationSeconds: 60 });
  });

  test('choosing targets keeps the count in step, as the server requires', async ({ app, page }) => {
    await openAdmin(app, createStub());
    await choose(page, 'node-isolation');

    await row(page, 'lab-mn-1').locator('input').check();
    await row(page, 'lab-mn-2').locator('input').check();
    await expect(page.locator('#param-count')).toHaveValue('2');

    await page.getByRole('button', { name: PREPARE, exact: true }).click();
    await expect.poll(() => app.requestsTo(RUNS, 'POST').length).toBe(1);
    expect(lastCreate(app)).toEqual({ count: 2, durationSeconds: 60, targetIds: ['lab-mn-1', 'lab-mn-2'] });

    // And unchoosing the last one hands the choice back to the server.
    await row(page, 'lab-mn-1').locator('input').uncheck();
    await row(page, 'lab-mn-2').locator('input').uncheck();
    await page.getByRole('button', { name: /Advanced: the parameters as JSON/ }).click();
    expect(JSON.parse(await page.locator('textarea').inputValue())).not.toHaveProperty('targetIds');
  });

  test('network-degradation carries fractional loss and its units', async ({ app, page }) => {
    await openAdmin(app, createStub());
    await choose(page, 'network-degradation');

    const loss = page.locator('#param-lossPercent');
    await expect(loss).toHaveAttribute('step', 'any');
    await loss.fill('2.5');
    await expect(page.locator('.scenario-fields')).toContainText('ms');
    await expect(page.locator('.scenario-fields')).toContainText('%');

    await page.getByRole('button', { name: PREPARE, exact: true }).click();
    await expect.poll(() => app.requestsTo(RUNS, 'POST').length).toBe(1);
    expect(lastCreate(app)).toMatchObject({ lossPercent: 2.5, latencyMs: 100, jitterMs: 20 });
  });

  /**
   * clear-recover under its own policy: no fault duration, because it is not a
   * fault, and no live mode, because a live run of it applies nothing.
   */
  test('clear-recover takes only targets and is not offered live', async ({ app, page }) => {
    await openAdmin(app, createStub());
    await choose(page, 'clear-recover');

    await expect(page.locator('#param-durationSeconds')).toHaveCount(0);
    await expect(page.locator('#param-count')).toHaveCount(0);
    // toHaveAttribute, not toBeDisabled: Playwright's disabled check does not
    // read <option> elements -- the same trap day 5 recorded.
    await expect(page.locator('option[value="live"]')).toHaveAttribute('disabled', '');
    await expect(page.locator('.notes')).toContainText('would apply nothing');

    await row(page, 'lab-mn-1').locator('input').check();
    await page.getByRole('button', { name: PREPARE, exact: true }).click();
    await expect.poll(() => app.requestsTo(RUNS, 'POST').length).toBe(1);
    expect(lastCreate(app)).toEqual({ targetIds: ['lab-mn-1'] });
    expect((app.requestsTo(RUNS, 'POST').at(-1)!.body as { mode?: string }).mode).toBe('dry-run');
  });

  test('choosing clear-recover while live is selected falls back to dry-run', async ({ app, page }) => {
    await openAdmin(app);
    await page.locator('select').nth(2).selectOption('live');
    await choose(page, 'clear-recover');
    // The mode a disabled option would still have sent is not left behind it.
    await expect(page.locator('select').nth(2)).toHaveValue('dry-run');
  });

  test('every one of the five draws its full form', async ({ app, page }) => {
    await openAdmin(app);
    const expected: Record<string, string[]> = {
      'host-outage': ['durationSeconds', 'expectedMasternodes'],
      'restart-flapping': ['role', 'count', 'cycles', 'downSeconds', 'upSeconds'],
      'network-degradation': ['role', 'count', 'durationSeconds', 'latencyMs', 'jitterMs', 'lossPercent', 'correlationPercent'],
      'node-isolation': ['count', 'durationSeconds'],
      'clear-recover': [],
    };
    for (const [scenarioId, inputs] of Object.entries(expected)) {
      await choose(page, scenarioId);
      for (const name of inputs) {
        await expect(page.locator(`#param-${name}`), `${scenarioId}.${name}`).toBeVisible();
      }
      // Each of the five has a registry chooser.
      await expect(page.locator('fieldset.target-chooser'), scenarioId).toHaveCount(1);
    }
  });

  /**
   * A required target starts empty now -- the template's placeholder no longer
   * fills it -- so Prepare has to ask for one rather than send nothing.
   */
  test('a required target nobody chose stops Prepare and names the field', async ({ app, page }) => {
    await openAdmin(app, createStub());
    await choose(page, 'clear-recover');

    await page.getByRole('button', { name: PREPARE, exact: true }).click();
    await expect(page.locator('.alert[role="alert"]').first()).toContainText('Targets to clear');
    expect(app.requestsTo(RUNS, 'POST')).toHaveLength(0);
  });

  test('unreadable JSON still blocks Prepare for a target scenario', async ({ app, page }) => {
    await openAdmin(app, createStub());
    await choose(page, 'host-outage');
    await page.getByRole('button', { name: /Advanced: the parameters as JSON/ }).click();

    await page.locator('textarea').fill('{"anchorTargetId": ');
    await page.getByRole('button', { name: PREPARE, exact: true }).click();
    await expect(page.locator('.alert[role="alert"]').first()).toContainText('could not be read');
    expect(app.requestsTo(RUNS, 'POST')).toHaveLength(0);
  });
});

test.describe('the preview of a prepared run', () => {
  /**
   * Unknown is "unknown". A margin of zero is a finding -- the fault leaves the
   * quorum exactly at threshold -- and a quorum the server could not size is not
   * one; printing 0 for it would report a finding that was never measured.
   */
  test('an unknown margin and an unknown quorum size read unknown, never 0', async ({ app, page }) => {
    app.stub({ ...adminSessionStubs({ targets: labRegistry() }), ...runStubs({ runKey: RUN_A }) });
    await app.goto(`/admin?run=${RUN_A}`);

    await expect(page.locator('.dkg-margin')).toHaveText('unknown');
    await expect(page.locator('.cl-margin')).toHaveText('unknown');
    await expect(page.locator('.quorum-size')).toHaveText('unknown / unknown');
    await expect(page.locator('.impact')).toContainText('Masternodes');
    await expect(page.locator('.impact')).toContainText('Stakers');
  });

  /**
   * A changed target set needs a new preview -- and must not cost the run on
   * screen its controls. The preview is the SAVED plan; an operator who has
   * just ticked two more targets must not read the old impact as the new one.
   */
  test('a changed draft says the preview is stale, and the run keeps its controls', async ({
    app,
    page,
  }) => {
    app.stub({
      ...adminSessionStubs({ targets: labRegistry() }),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true }),
    });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.getByRole('button', { name: 'Abort & recover' })).toBeVisible();
    // The draft starts as the run was made, so nothing is stale yet.
    await expect(page.locator('.draft-differs')).toHaveCount(0);

    await row(page, 'lab-mn-2').locator('input').check();

    await expect(page.locator('.draft-differs')).toContainText('has changed');
    await expect(page.getByRole('button', { name: 'Abort & recover' })).toBeVisible();
  });
});
