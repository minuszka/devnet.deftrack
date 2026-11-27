import { expect, ok, test } from './harness.js';
import { experimentRow, masternodeTimelinePoint, pageOf, roundListItem } from './fixtures/api.js';
import { overviewStubs, shellStubs } from './fixtures/stubs.js';

test('updates member evidence and flags a masked fleet loss on the next poll', async ({ app, page }) => {
  await page.clock.install();
  let complete = false;
  let missingExpected = 0;
  let invalid = false;
  app.stub({
    ...overviewStubs(),
    '/api/v1/quorum-rounds': () => ({ body: ok(pageOf([roundListItem({
      memberDetailsComplete: complete, failuresByOperator: invalid ? [{ operatorLabel: 'fixture-op', count: 1 }] : [],
      punishedCount: invalid ? 1 : 0,
    })])) }),
    '/api/v1/masternodes/timeline': () => ({ body: ok({ hours: 1, points: [
      masternodeTimelinePoint({ enabled: 8, banned: 2, expectedEnabled: 8, missingExpected }),
    ] }) }),
  });
  await app.goto('/');
  const card = page.locator('dd-stat').filter({ hasText: 'expected nodes unavailable' });
  await expect(page.locator('.evidence')).toHaveText('awaiting member details');
  await expect(card).toHaveAttribute('tone', 'warn');
  complete = true;
  missingExpected = 1;
  await page.clock.fastForward(30_000);
  await expect(page.locator('.evidence')).toHaveText('all members valid');
  await expect(card).toHaveAttribute('tone', 'crit');
  await expect(card).toContainText('1 of 8 expected nodes unavailable');
  invalid = true;
  await page.clock.fastForward(30_000);
  await expect(page.locator('.evidence')).toHaveText('fixture-op (1)');
});

test('a running experiment names the height it can show across an RPC outage', async ({ app, page }) => {
  await page.clock.install();
  const run = experimentRow({ status: 'running', endHeight: null, endedAt: null });
  let tipHeight: number | null = null;
  let observedThroughHeight: number | null = null;
  app.stub({
    ...shellStubs(),
    '/api/v1/experiments': { body: ok(pageOf([run])) },
    '/api/v1/experiments/*': () => ({ body: ok({ ...run, tipHeight, observedThroughHeight, currentParticipants: null, comparison: null }) }),
  });
  await app.goto('/experiments/' + run.runKey);
  const note = page.locator('dd-page-experiments .note[role=status]');
  await expect(note).toContainText('Waiting for indexed observations');
  observedThroughHeight = 11012;
  await page.clock.fastForward(60_000);
  await expect(note).toContainText('Node tip unavailable.');
  await expect(note).toContainText('Observations through block 11,012.');
  tipHeight = 11014;
  observedThroughHeight = 11013;
  await page.clock.fastForward(60_000);
  await expect(note).toContainText('Node tip 11,014.');
  await expect(note).toContainText('Observations through block 11,013.');
});
