import type { Page } from '@playwright/test';
import { expect, fail, ok, test, type ApiStubs } from './harness.js';
import { healthSnapshot } from './fixtures/api.js';
import { emptyLayoutStubs, loadedLayoutStubs } from './fixtures/layout.js';

/**
 * Day 20: a failed load never reads as an empty record.
 *
 * Found by the day-20 regression sweep, which put every public page behind a
 * 401, a 404, a 429 and a 500. Most pages showed the server's message -- and
 * six of them showed it BESIDE their empty-state sentences: "0 indexed",
 * "No bans recorded in this window", "No operator mapping loaded yet". A
 * request that failed read as a record with nothing in it, which on this site
 * is the one reading that has to be impossible. The PoSe page printed the same
 * sentences while it was still loading. Fairness described a ChainLock report
 * that answered 500 as "no ChainLock report".
 *
 * Both directions are held: a failure says what it does not know, and a real,
 * successful, empty answer still says it is empty.
 */

const COULD_NOT_LOAD = 'Could not be loaded, so what exists is unknown.';

interface PageCase {
  path: string;
  /** Sentences and counts that claim something about the record. */
  claims: Array<string | RegExp>;
  /** The one a successful empty answer must still say. */
  empty: string;
}

const PAGES: PageCase[] = [
  { path: '/blocks', claims: [/\b0 indexed\b/, 'No blocks indexed yet', /\bof 0\b/], empty: 'No blocks indexed yet.' },
  { path: '/txs', claims: [/\b0 indexed\b/, 'No transactions indexed yet', /\bof 0\b/], empty: 'No transactions indexed yet.' },
  { path: '/rounds', claims: [/\b0 recorded\b/, 'No rounds match this filter', /\bof 0\b/], empty: 'No rounds match this filter.' },
  {
    path: '/pose',
    claims: ['No samples yet', 'No bans recorded in this window', /\b0 shown\b/, 'No transitions recorded yet'],
    empty: 'No bans recorded in this window.',
  },
  { path: '/operators', claims: [/\b0 formed rounds\b/, 'No operator mapping loaded yet'], empty: 'No operator mapping loaded yet.' },
  { path: '/', claims: [/\b0 recorded\b/, 'No rounds recorded yet'], empty: 'No rounds recorded yet.' },
];

/** Everything the page's main region says, across shadow roots. */
async function mainText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const main = document.querySelector('dd-shell')?.shadowRoot?.querySelector('main');
    let text = '';
    const walk = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) text += `${node.textContent ?? ''} `;
      if (node instanceof Element && node.shadowRoot) walk(node.shadowRoot);
      node.childNodes.forEach(walk);
    };
    if (main) walk(main);
    return text.replace(/\s+/g, ' ');
  });
}

function claimed(text: string, claims: Array<string | RegExp>): string[] {
  return claims.filter((c) => (typeof c === 'string' ? text.includes(c) : c.test(text))).map(String);
}

function failingStubs(marker: string): ApiStubs {
  return {
    '/api/v1/health': { body: ok(healthSnapshot()) },
    '/api/v1/*': { status: 500, body: fail(marker) },
  };
}

test.describe('a failed load is not an empty record', () => {
  for (const c of PAGES) {
    test(`${c.path} says what it could not load, and claims nothing`, async ({ app, page }) => {
      app.stub(failingStubs('stub-500-marker'));
      await app.goto(c.path);
      await expect.poll(async () => (await mainText(page)).includes('stub-500-marker')).toBe(true);
      await page.waitForLoadState('networkidle');

      const text = await mainText(page);
      expect(text).toContain(COULD_NOT_LOAD);
      expect(claimed(text, c.claims), text.slice(0, 400)).toEqual([]);
    });

    test(`${c.path} still says so when the answer really is empty`, async ({ app, page }) => {
      app.stub(emptyLayoutStubs());
      await app.goto(c.path);
      await expect.poll(async () => (await mainText(page)).includes(c.empty)).toBe(true);
      expect(await mainText(page)).not.toContain(COULD_NOT_LOAD);
    });
  }

  test('PoSe claims nothing while it is still loading', async ({ app, page }) => {
    app.stub({
      '/api/v1/health': { body: ok(healthSnapshot()) },
      '/api/v1/*': { delayMs: 60_000, body: ok(null) },
    });
    await app.goto('/pose');
    await expect(page.locator('dd-page-pose .note')).toHaveText('Loading…');
    const pose = PAGES.find((c) => c.path === '/pose');
    expect(claimed(await mainText(page), pose?.claims ?? [])).toEqual([]);
  });

  test('a failed refresh keeps the last good page, and does not call it unknown', async ({ app, page }) => {
    await page.clock.install({ time: new Date('2026-09-11T09:00:00.000Z') });
    app.stub(loadedLayoutStubs());
    await app.goto('/blocks');
    await expect(page.locator('dd-page-blocks tbody tr')).toHaveCount(5);

    app.stub({ '/api/v1/blocks': { status: 500, body: fail('refresh failed') } });
    await page.clock.fastForward(35_000);

    await expect(page.locator('dd-page-blocks .err')).toContainText('refresh failed');
    await expect(page.locator('dd-page-blocks tbody tr')).toHaveCount(5);
    expect(await mainText(page)).not.toContain(COULD_NOT_LOAD);
  });

  test('fairness says the ChainLock report could not be read, not that there is none', async ({ app, page }) => {
    app.stub(failingStubs('stub-500-marker'));
    await app.goto('/fairness');
    await expect(page.locator('dd-page-fairness .note[role="status"]')).toContainText(
      'the ChainLock report could not be read: stub-500-marker'
    );
    await expect(page.locator('dd-page-fairness .note[role="status"]')).not.toContainText('no ChainLock report');
  });
});
