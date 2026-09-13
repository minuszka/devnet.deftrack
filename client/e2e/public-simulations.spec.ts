import { expect, fail, ok, test, type ApiStubs, type AppHarness } from './harness.js';
import { overviewStubs, shellStubs } from './fixtures/stubs.js';
import { pageOf } from './fixtures/api.js';
import { SIM_A, simReport, simRun, simRuns } from './fixtures/simulations.js';
import type { SimulationStatus } from '../src/lib/simulations.js';

/**
 * Day 17: the simulation results, on the public site.
 *
 * The public API has served `/api/v1/simulations`, `/:runKey` and
 * `/:runKey/report` for weeks and no page read them. So a run's outcome was
 * visible only in the private admin panel, and the part of the project that
 * exists to be shown -- what a planned fault did to the network -- was the
 * part nobody could see.
 *
 * What these tests hold the page to is not claiming more than the data does:
 * waiting is not passing, not evaluable is not a success, and a dry run is not
 * evidence about a network.
 */
const LIST = '/api/v1/simulations';
const one = (key = SIM_A) => `/api/v1/simulations/${key}`;
const report = (key = SIM_A) => `/api/v1/simulations/${key}/report`;

function listStubs(total: number): ApiStubs {
  const all = simRuns(total);
  return {
    ...shellStubs(),
    [LIST]: (url: URL) => {
      const limit = Number(url.searchParams.get('limit') ?? 25);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return { body: ok(pageOf(all.slice(offset, offset + limit), { total, limit, offset })) };
    },
  };
}

/** One run and whatever its report endpoint answers. */
async function openRun(
  app: AppHarness,
  status: SimulationStatus,
  reportStub: ApiStubs[string],
  live = true
): Promise<void> {
  app.stub({
    ...shellStubs(),
    [one()]: { body: ok(simRun({ status, live })) },
    [report()]: reportStub,
  });
  await app.goto(`/simulations/${SIM_A}`);
}

const NOT_MEASURED = { status: 404, body: fail('simulation measurement report not found') };

test.describe('simulation list', () => {
  test('is in the navigation and reachable from it', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...listStubs(3) });
    await app.goto('/');
    await page.getByRole('link', { name: 'Simulations', exact: true }).click();
    await expect(page.locator('dd-page-simulations')).toHaveCount(1);
    await expect(page.locator('.page-title')).toHaveText('Simulations');
  });

  test('an empty record says so, and does not look like a failure', async ({ app, page }) => {
    app.stub(listStubs(0));
    await app.goto('/simulations');
    await expect(page.locator('dd-page-simulations .note')).toContainText('No simulation run has been recorded');
    await expect(page.locator('dd-page-simulations .err')).toHaveCount(0);
  });

  test('twenty-six runs page at twenty-five, with the page in the URL', async ({ app, page }) => {
    app.stub(listStubs(26));
    await app.goto('/simulations');
    await expect(page.locator('.pager')).toContainText('1–25 of 26');
    await expect(page.locator('tbody tr')).toHaveCount(25);

    await page.getByRole('button', { name: 'Older', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
    await expect(page.locator('.pager')).toContainText('26–26 of 26');
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });

  test('says in words which runs were dry runs', async ({ app, page }) => {
    app.stub({
      ...shellStubs(),
      [LIST]: { body: ok(pageOf([simRun({ live: false }), simRun({ runKey: `sim_${'2'.repeat(32)}`, live: true })], { total: 2 })) },
    });
    await app.goto('/simulations');
    await expect(page.locator('tbody')).toContainText('dry run');
    await expect(page.locator('tbody')).toContainText('live lab');
  });
});

test.describe('a simulation run', () => {
  test('in progress is in progress, not a result', async ({ app, page }) => {
    await openRun(app, 'fault_active', NOT_MEASURED);
    await expect(page.locator('[data-reading]')).toHaveAttribute('data-reading', 'in-progress');
    await expect(page.locator('.reading')).not.toHaveClass(/good/);
  });

  /*
   * The two 404s. The run's own endpoint decides which one this is, which is
   * why it is asked first: `/report` answers 404 for both.
   */
  test('completed but not measured reads as waiting, not as not found', async ({ app, page }) => {
    await openRun(app, 'completed', NOT_MEASURED);
    await expect(page.locator('[data-reading]')).toHaveAttribute('data-reading', 'awaiting-measurement');
    await expect(page.locator('.verdict')).toContainText('not a passing one');
    await expect(page.locator('dd-page-simulations .err')).toHaveCount(0);
  });

  test('a run that does not exist says so, and asks for no report', async ({ app, page }) => {
    app.stub({ ...shellStubs(), [one()]: { status: 404, body: fail('simulation run not found') } });
    await app.goto(`/simulations/${SIM_A}`);
    await expect(page.locator('dd-page-simulations .err')).toContainText('No simulation run');
    // The report was never asked for: there is no run to have one.
    expect(app.callsTo(report())).toHaveLength(0);
  });

  test('a malformed key is named as malformed, before anything is fetched', async ({ app, page }) => {
    app.stub(shellStubs());
    await app.goto('/simulations/not-a-run-key');
    await expect(page.locator('dd-page-simulations .err')).toContainText('is not a simulation run key');
    expect(app.callsTo('/api/v1/simulations/not-a-run-key')).toHaveLength(0);
  });

  test('a mismatch reads as a mismatch, with its reason', async ({ app, page }) => {
    await openRun(app, 'completed', { body: ok(simReport('mismatched', { reasons: ['chainlock coverage degraded'] })) });
    await expect(page.locator('[data-reading]')).toHaveAttribute('data-reading', 'mismatched');
    await expect(page.locator('.verdict')).toContainText('chainlock coverage degraded');
  });

  test('a measurement that cannot decide is not a success', async ({ app, page }) => {
    await openRun(app, 'completed', {
      body: ok(simReport('not-evaluable', { reasons: ['expected-versus-actual result is not evaluable'] })),
    });
    await expect(page.locator('[data-reading]')).toHaveAttribute('data-reading', 'not-evaluable');
    await expect(page.locator('.reading')).not.toHaveClass(/good/);
    await expect(page.locator('.measurement-facts')).toContainText('Measurement valid');
    await expect(page.locator('.measurement-facts')).toContainText('insufficient');
  });

  test('a failed run is failed', async ({ app, page }) => {
    await openRun(app, 'failed', NOT_MEASURED);
    await expect(page.locator('[data-reading]')).toHaveAttribute('data-reading', 'failed');
  });

  test('a valid live match is the only reading drawn as good', async ({ app, page }) => {
    await openRun(app, 'completed', { body: ok(simReport('matched')) });
    await expect(page.locator('[data-reading]')).toHaveAttribute('data-reading', 'matched');
    await expect(page.locator('.reading')).toHaveClass(/good/);
    // And its actual windows, from the report rather than from the plan.
    await expect(page.locator('.measurement-facts')).toContainText('11,403–11,430');
  });

  test('a dry run is labelled a dry run, even when it matched', async ({ app, page }) => {
    await openRun(app, 'completed', { body: ok(simReport('matched')) }, false);
    await expect(page.locator('.banner')).toContainText('Nothing was done to a live network');
    await expect(page.locator('[data-reading]')).toHaveAttribute('data-reading', 'dry-run');
    await expect(page.locator('.reading')).not.toHaveClass(/good/);
  });

  test('a report that cannot be read is not the same as a report that does not exist', async ({ app, page }) => {
    await openRun(app, 'completed', { status: 503, body: fail('measurement store unavailable') });
    await expect(page.locator('[data-reading]')).toHaveAttribute('data-reading', 'report-unavailable');
  });

  test('is reachable by its URL directly', async ({ app, page }) => {
    await openRun(app, 'completed', { body: ok(simReport('matched')) });
    await expect(page.locator('.page-title')).toHaveText('Simulation run');
    await expect(page.locator('.run-facts')).toContainText(SIM_A);
  });
});

test.describe('the export', () => {
  /**
   * The file carries the two public responses and an envelope, and nothing an
   * admin endpoint could have supplied. The page never calls one: the harness
   * refuses any unstubbed request, and only public paths are stubbed, so an
   * admin call would fail this test on its own.
   */
  test('is the public run and report, versioned and dated', async ({ app, page }) => {
    await openRun(app, 'completed', { body: ok(simReport('matched')) });
    const link = page.getByRole('link', { name: 'Download JSON' });
    await expect(link).toHaveAttribute('download', `${SIM_A}.json`);

    const href = await link.getAttribute('href');
    expect(href).toMatch(/^data:application\/json/);
    const exported = JSON.parse(decodeURIComponent(href!.slice(href!.indexOf(',') + 1)));

    expect(exported.schemaVersion).toBe(1);
    expect(Date.parse(exported.fetchedAt)).not.toBeNaN();
    expect(exported.source).toEqual({ run: one(), report: report() });
    expect(Object.keys(exported).sort()).toEqual(['fetchedAt', 'report', 'run', 'schemaVersion', 'source']);
    // Exactly what the public API returned, not a re-assembly of it.
    expect(exported.run).toEqual(simRun({ status: 'completed' }));
    expect(exported.report).toEqual(simReport('matched'));
    expect(app.apiCalls.some((call) => call.startsWith('/api/v1/admin'))).toBe(false);
  });

  test('carries no report when there is none, rather than inventing one', async ({ app, page }) => {
    await openRun(app, 'completed', NOT_MEASURED);
    const href = await page.getByRole('link', { name: 'Download JSON' }).getAttribute('href');
    const exported = JSON.parse(decodeURIComponent(href!.slice(href!.indexOf(',') + 1)));
    expect(exported.report).toBeNull();
  });
});
