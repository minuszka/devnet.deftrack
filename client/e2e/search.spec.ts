import type { Page } from '@playwright/test';
import type { BlockDetail, ExperimentDetail, TxDetail } from '@devnet-deftrack/shared';
import { expect, fail, ok, test, type ApiStubs, type StubResponse } from './harness.js';
import { experimentRow, pageOf, TIP_HEIGHT } from './fixtures/api.js';
import { blockDetail } from './fixtures/layout.js';
import { SIM_A, simRun } from './fixtures/simulations.js';
import { overviewStubs, shellStubs } from './fixtures/stubs.js';

/**
 * Day 19: targeted search.
 *
 * What it looks up: a block by height or hash, a transaction by id, an
 * experiment or a simulation by run key. What these tests hold it to: it asks
 * only on an explicit submit; a 64-hex identifier is never decided from its
 * shape; "no match" is said only when every lookup answered 404, and anything
 * else -- a 503, a timeout -- is "could not be checked"; an older search can
 * never overwrite a newer one; and a copy button copies the whole identifier
 * and says when the clipboard refused.
 */

const HASH = `${'5e'.repeat(31)}a1`;
const HEIGHT = 11_402;

type Lookups = {
  blocks?: Record<string, StubResponse>;
  txs?: Record<string, StubResponse>;
  experiments?: Record<string, StubResponse>;
  simulations?: Record<string, StubResponse>;
};

function block(overrides: Partial<BlockDetail> = {}): BlockDetail {
  return { ...blockDetail(), height: HEIGHT, hash: HASH, ...overrides };
}

function tx(): TxDetail {
  return {
    txid: HASH, height: HEIGHT, time: 1_757_000_000, size: 226, type: 0, isCoinbase: false, isCoinstake: false,
    hasChainLock: true, valueOutSat: '1000000000', stakePaidSat: null, voutCount: 1, vinCount: 1,
    blockhash: `${'77'.repeat(32)}`, version: 3, vin: [{ txid: null, vout: null, coinbase: '00' }],
    vout: [{ n: 0, valueSat: '1000000000', scriptType: 'pubkeyhash', address: 'PfixtureAddress' }],
  };
}

function experiment(runKey: string): ExperimentDetail {
  return { ...experimentRow({ runKey, title: 'Fixture outage run' }), currentParticipants: null, tipHeight: TIP_HEIGHT, comparison: null };
}

/** Every lookup endpoint, answering from the table given and 404 otherwise. */
function lookupStubs(table: Lookups): ApiStubs {
  const from =
    (rows: Record<string, StubResponse> | undefined, missing: string) =>
    (url: URL): StubResponse => {
      const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      return rows?.[id] ?? { status: 404, body: fail(missing) };
    };
  return {
    ...shellStubs(),
    '/api/v1/blocks/*': from(table.blocks, 'block not found'),
    '/api/v1/txs/*': from(table.txs, 'transaction not found'),
    '/api/v1/experiments': { body: ok(pageOf([])) },
    '/api/v1/experiments/*': from(table.experiments, 'experiment not found'),
    '/api/v1/simulations/*': (url) => {
      if (url.pathname.endsWith('/report')) return { status: 404, body: fail('simulation measurement report not found') };
      return from(table.simulations, 'simulation run not found')(url);
    },
  };
}

/** Lookup requests only -- not the header's health poll, not a page's own list. */
function lookups(calls: string[]): string[] {
  return calls.filter((call) => /^\/api\/v1\/(blocks|txs|experiments|simulations)\/[^?]/.test(call));
}

async function search(page: Page, query: string): Promise<void> {
  const box = page.getByRole('searchbox', { name: /Block height/ });
  await box.fill(query);
  await box.press('Enter');
}

test.describe('search', () => {
  test('a blank submit asks nothing, stays put, and says what the box takes', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...lookupStubs({}) });
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    await search(page, '   ');
    await expect(page.getByRole('search').getByRole('status')).toHaveText(
      'Type a block height, a hash, a transaction id or a run key.'
    );
    expect(new URL(page.url()).pathname).toBe('/');
    expect(lookups(app.apiCalls)).toEqual([]);
  });

  test('an address with a blank query asks nothing either', async ({ app, page }) => {
    app.stub(lookupStubs({}));
    await app.goto('/search?q=%20%20');
    await expect(page.locator('.page-title')).toHaveText('Search');
    await expect(page.locator('dd-page-search .note')).toContainText('Type a block height');
    expect(lookups(app.apiCalls)).toEqual([]);
  });

  test('typing asks nothing; the submit does', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...lookupStubs({ blocks: { [String(HEIGHT)]: { body: ok(block()) } } }) });
    await app.goto('/');
    await page.getByRole('searchbox', { name: /Block height/ }).pressSequentially(String(HEIGHT), { delay: 30 });
    await page.waitForTimeout(400);
    expect(lookups(app.apiCalls)).toEqual([]);

    await page.getByRole('searchbox', { name: /Block height/ }).press('Enter');
    await expect.poll(() => lookups(app.apiCalls).length).toBeGreaterThan(0);
  });

  test('a height goes straight to its block, and Back leaves the search behind', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...lookupStubs({ blocks: { [String(HEIGHT)]: { body: ok(block()) }, [HASH]: { body: ok(block()) } } }) });
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    await search(page, String(HEIGHT));
    await expect(page.locator('dd-page-block .page-title')).toHaveText('Block 11,402');
    expect(new URL(page.url()).pathname).toBe(`/block/${HASH}`);
    // The height is also a well-formed experiment key, so that was asked too.
    expect(lookups(app.apiCalls)).toEqual(expect.arrayContaining([`/api/v1/blocks/${HEIGHT}`, `/api/v1/experiments/${HEIGHT}`]));

    // The forward replaced the search in history: Back goes to where the
    // reader searched from, not to a search that would forward again.
    await page.goBack();
    await expect(page.locator('.page-title')).toHaveText('Overview');
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('a 64-hex identifier is asked of blocks and transactions both, and goes to the one that has it', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...lookupStubs({ txs: { [HASH]: { body: ok(tx()) } } }) });
    await app.goto('/');
    await search(page, HASH.toUpperCase());

    await expect(page.locator('dd-page-tx .page-title')).toHaveText('Transaction');
    expect(new URL(page.url()).pathname).toBe(`/tx/${HASH}`);
    expect(lookups(app.apiCalls)).toEqual(expect.arrayContaining([`/api/v1/blocks/${HASH}`, `/api/v1/txs/${HASH}`]));
  });

  test('an identifier found twice is shown twice, each on its own', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...lookupStubs({ blocks: { [HASH]: { body: ok(block()) } }, txs: { [HASH]: { body: ok(tx()) } } }) });
    await app.goto('/');
    await search(page, HASH);

    const results = page.locator('dd-page-search .result');
    await expect(results).toHaveCount(2);
    await expect(results.nth(0)).toHaveAttribute('data-target', 'block');
    await expect(results.nth(1)).toHaveAttribute('data-target', 'tx');
    await expect(page.locator('dd-page-search').getByText('matched 2 different things')).toBeVisible();
    // Neither was picked for the reader.
    expect(new URL(page.url()).pathname).toBe('/search');
    await expect(results.nth(0).getByRole('link', { name: 'Block 11,402' })).toHaveAttribute('href', `/block/${HASH}`);
    await expect(results.nth(1).getByRole('link', { name: 'Transaction' })).toHaveAttribute('href', `/tx/${HASH}`);
  });

  test('"no match" is said when every lookup answered 404 -- and a proTxHash is not guessed at', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...lookupStubs({}) });
    await app.goto('/');
    await search(page, HASH);

    const answer = page.locator('dd-page-search');
    await expect(answer.getByText('No match.')).toBeVisible();
    await expect(answer).toContainText('masternode search is not available yet');
    await expect(answer.locator('.unchecked')).toHaveCount(0);
    await expect(answer.locator('.result')).toHaveCount(0);
  });

  test('a lookup that failed is "could not be checked", never "no match"', async ({ app, page }) => {
    app.stub({
      ...overviewStubs(),
      ...lookupStubs({ txs: { [HASH]: { status: 503, body: fail('transaction index unavailable') } } }),
    });
    await app.goto('/');
    await search(page, HASH);

    const answer = page.locator('dd-page-search');
    await expect(answer.locator('.unchecked')).toContainText('Not a “no match”');
    await expect(answer.locator('.unchecked')).toContainText('transactions: HTTP 503: transaction index unavailable');
    await expect(answer.locator('.unchecked')).toContainText('Checked and not found in: blocks, experiments.');
    await expect(answer.getByText('No match.')).toHaveCount(0);

    // Asking again is the reader's call, and it really asks again.
    const before = lookups(app.apiCalls).length;
    await answer.getByRole('button', { name: 'Search again' }).click();
    await expect.poll(() => lookups(app.apiCalls).length).toBeGreaterThan(before);
  });

  test('a lookup with no answer times out as unchecked', async ({ app, page }) => {
    await page.clock.install({ time: new Date('2026-09-11T09:00:00.000Z') });
    app.stub({
      ...overviewStubs(),
      ...lookupStubs({ txs: { [HASH]: { delayMs: 60_000, body: ok(tx()) } } }),
    });
    await app.goto('/');
    await search(page, HASH);
    await expect(page.locator('dd-page-search .note[aria-busy="true"]')).toBeVisible();

    await page.clock.fastForward(8_100);

    const answer = page.locator('dd-page-search');
    await expect(answer.locator('.unchecked')).toContainText('transactions: no answer within 8 s');
    await expect(answer.getByText('No match.')).toHaveCount(0);
  });

  test('an older search cannot overwrite a newer one', async ({ app, page }) => {
    app.stub({
      ...overviewStubs(),
      ...lookupStubs({ blocks: { '1': { delayMs: 1_500, body: ok(block({ height: 1 })) } } }),
    });
    await app.goto('/');
    await search(page, '1');
    await expect(page.locator('dd-page-search .note[aria-busy="true"]')).toBeVisible();
    await search(page, '2');

    const answer = page.locator('dd-page-search');
    await expect(answer.getByText('No match.')).toBeVisible();
    // Long past the moment the first search's block would have landed.
    await page.waitForTimeout(2_200);
    expect(new URL(page.url()).search).toBe('?q=2');
    await expect(answer.getByText('No match.')).toBeVisible();
    await expect(page.locator('dd-page-block')).toHaveCount(0);
  });

  test('a simulation run key goes to the simulation', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...lookupStubs({ simulations: { [SIM_A]: { body: ok(simRun()) } } }) });
    await app.goto('/');
    await search(page, SIM_A);
    await expect(page.locator('dd-page-simulations')).toHaveCount(1);
    expect(new URL(page.url()).pathname).toBe(`/simulations/${SIM_A}`);
  });

  test('an experiment run key goes to the experiment', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...lookupStubs({ experiments: { 'fixture-run-0001': { body: ok(experiment('fixture-run-0001')) } } }) });
    await app.goto('/');
    await search(page, 'fixture-run-0001');
    await expect(page.locator('dd-page-experiments')).toHaveCount(1);
    expect(new URL(page.url()).pathname).toBe('/experiments/fixture-run-0001');
  });

  test('something it cannot look up is refused without asking', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...lookupStubs({}) });
    await app.goto('/');
    await search(page, 'hello world');
    await expect(page.locator('dd-page-search .note')).toContainText('not something the search can look up');
    expect(lookups(app.apiCalls)).toEqual([]);
  });

  test('the search page shows its query in the box, to correct rather than retype', async ({ app, page }) => {
    app.stub(lookupStubs({}));
    await app.goto(`/search?q=${HASH}`);
    await expect(page.locator('dd-page-search').getByText('No match.')).toBeVisible();
    await expect(page.getByRole('searchbox', { name: /Block height/ })).toHaveValue(HASH);
  });
});

test.describe('copying an identifier', () => {
  async function twoResults(app: import('./harness.js').AppHarness, page: Page): Promise<void> {
    app.stub(lookupStubs({ blocks: { [HASH]: { body: ok(block()) } }, txs: { [HASH]: { body: ok(tx()) } } }));
    await app.goto(`/search?q=${HASH}`);
    await expect(page.locator('dd-page-search .result')).toHaveCount(2);
  }

  test('copies the whole identifier, and says so', async ({ app, page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await twoResults(app, page);
    const copy = page.locator('dd-page-search .result').first().getByRole('button', { name: 'Copy block identifier' });
    await copy.click();
    await expect(copy).toHaveText('copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(HASH);
  });

  test('a refused clipboard is said, not swallowed', async ({ app, page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
      });
    });
    await twoResults(app, page);
    const result = page.locator('dd-page-search .result').first();
    const copy = result.getByRole('button', { name: 'Copy block identifier' });
    await copy.click();
    await expect(copy).toHaveText('copy failed');
    await expect(result.locator('dd-copy').getByRole('status')).toContainText('Copy failed');
  });

  // The button the overview had swallowed the failure; it is the shared one now.
  test('the overview’s quorum-hash button says so too', async ({ app, page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
      });
    });
    app.stub(overviewStubs());
    await app.goto('/');
    const copy = page.locator('dd-page-overview tbody').getByRole('button', { name: /^Copy quorum hash/ }).first();
    await copy.click();
    await expect(copy).toHaveText('copy failed');
  });
});

test.describe('how we measure, and the icon', () => {
  test('is one link from the header, and says what each figure cannot tell you', async ({ app, page }) => {
    app.stub(overviewStubs());
    await app.goto('/');
    await page.getByRole('link', { name: 'How we measure' }).click();
    await expect(page.locator('.page-title')).toHaveText('How we measure');
    expect(new URL(page.url()).pathname).toBe('/methodology');

    const sections = page.locator('dd-page-methodology section.card');
    await expect(sections.locator('h2')).toHaveText([
      'DKG rounds',
      'PoSe',
      'Sentinel Layer (DSL)',
      'Staking concentration: HHI',
      'Staking inequality: Gini',
    ]);
    for (let i = 0; i < 5; i += 1) {
      await expect(sections.nth(i).locator('dt')).toHaveText(['What it is', 'Sample', 'What it cannot tell you']);
    }
    // A page in no section lights nothing in the menu.
    await expect(page.getByRole('navigation', { name: 'Sections' }).locator('.nav-wide [aria-current]')).toHaveCount(0);
  });

  test('the site has its own icon, served from the site itself', async ({ app, page }) => {
    app.stub(shellStubs());
    await app.goto('/methodology');
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
    const response = await page.request.get('/favicon.svg');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
    const svg = await response.text();
    expect(svg).toContain('<svg');
    // Nothing in it that would fetch from anywhere.
    expect(svg).not.toMatch(/href=|url\(|<image|<script/i);
  });
});
