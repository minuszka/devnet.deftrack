import type { Locator, Page } from '@playwright/test';
import { expect, test } from './harness.js';
import { HASH, loadedLayoutStubs } from './fixtures/layout.js';

/**
 * Day 18: the grouped menu.
 *
 * Fourteen equal tabs became four groups -- Overview; Network; Blockchain;
 * Experiments -- with the original paths unchanged. Wide, the groups sit in one
 * row and the current group's pages in a second; narrow, one Menu button opens
 * a list of groups that expand and collapse. What these tests pin is the part a
 * reader relies on: where they are is always lit, a detail page is lit under
 * the section it belongs to, the narrow menu works from the keyboard and gets
 * out of the way, and nothing is reachable twice.
 */

const NETWORK_PAGES = ['DKG Rounds', 'PoSe Watch', 'Masternodes', 'ChainLocks', 'Sentinel Layer', 'Staking', 'Vantage Points', 'Operators', 'Fairness'];

function sections(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Sections' });
}

async function focused(page: Page): Promise<{ tag: string; text: string }> {
  return page.evaluate(() => {
    let el: Element | null = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return { tag: el?.tagName.toLowerCase() ?? '', text: (el?.textContent ?? '').replace(/\s+/g, ' ').trim() };
  });
}

test.describe('the menu on a wide screen', () => {
  test('shows the four groups, and the current group’s pages under them', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/pose');
    await expect(page.locator('.page-title')).toHaveText('PoSe Watch');

    const nav = sections(page);
    await expect(nav.locator('.groups a')).toHaveText(['Overview', 'Network', 'Blockchain', 'Experiments']);
    await expect(nav.getByRole('list', { name: 'Network pages' }).getByRole('link')).toHaveText(NETWORK_PAGES);

    // The group and the page are both lit, and they say different things.
    await expect(nav.getByRole('link', { name: 'Network', exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(nav.getByRole('link', { name: 'PoSe Watch', exact: true })).toHaveAttribute('aria-current', 'page');
    // Two in the wide menu, the only one shown; the narrow one is display:none.
    await expect(nav.locator('.nav-wide [aria-current]')).toHaveCount(2);
  });

  test('the overview is a group of one, lit as the page', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    const nav = sections(page);
    await expect(nav.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('list', { name: /pages$/ })).toHaveCount(0);
  });

  /*
   * A single block used to light nothing -- its path is /block and the menu
   * entry's is /blocks -- so the reader of a block had no sign in the menu of
   * where they were.
   */
  test('a detail page lights the section it belongs to, as a location', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto(`/block/${HASH}`);
    await expect(page.locator('.page-title')).toContainText('Block');

    const nav = sections(page);
    await expect(nav.getByRole('link', { name: 'Blockchain', exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(nav.getByRole('link', { name: 'Blocks', exact: true })).toHaveAttribute('aria-current', 'true');
    // Not "page": the page is the block, and the Blocks link does not lead to it.
    await expect(nav.locator('.nav-wide [aria-current="page"]')).toHaveCount(0);
  });

  test('a page that does not exist lights nothing', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/no-such-section');
    await expect(page.locator('dd-page-not-found')).toHaveCount(1);
    await expect(sections(page).locator('[aria-current]')).toHaveCount(0);
  });

  test('a group link lands on the group’s first page, at its original path', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/');
    await sections(page).getByRole('link', { name: 'Blockchain', exact: true }).click();
    await expect(page.locator('.page-title')).toHaveText('Blocks');
    expect(new URL(page.url()).pathname).toBe('/blocks');

    await sections(page).getByRole('link', { name: 'Transactions', exact: true }).click();
    await expect(page.locator('.page-title')).toHaveText('Transactions');
    expect(new URL(page.url()).pathname).toBe('/txs');
  });

  test('the brand is a link back to the overview', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/staking');
    await expect(page.locator('.page-title')).toHaveText('Staking health');

    await page.getByRole('link', { name: 'devnet.deftrack' }).click();
    await expect(page.locator('.page-title')).toHaveText('Overview');
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('the narrow menu is not in the page as well', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/pose');
    await expect(page.locator('.page-title')).toHaveText('PoSe Watch');
    await expect(sections(page).getByRole('button', { name: /Menu/ })).toHaveCount(0);
    // Each page link exactly once.
    await expect(sections(page).getByRole('link', { name: 'PoSe Watch', exact: true })).toHaveCount(1);
  });
});

test.describe('the menu on a phone', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('one button says where the reader is, and the wide menu is gone', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/pose');
    await expect(page.locator('.page-title')).toHaveText('PoSe Watch');

    const toggle = sections(page).getByRole('button', { name: /Menu/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText('Network › PoSe Watch');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Closed, the menu holds no reachable link at all.
    await expect(sections(page).getByRole('link')).toHaveCount(0);
  });

  test('opens on the reader’s own group, and the others expand on request', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/pose');
    await expect(page.locator('.page-title')).toHaveText('PoSe Watch');

    const nav = sections(page);
    await nav.getByRole('button', { name: /Menu/ }).click();
    await expect(nav.getByRole('button', { name: /Menu/ })).toHaveAttribute('aria-expanded', 'true');

    const network = nav.getByRole('button', { name: 'Network', exact: true });
    const blockchain = nav.getByRole('button', { name: 'Blockchain', exact: true });
    await expect(network).toHaveAttribute('aria-expanded', 'true');
    await expect(blockchain).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.getByRole('link', { name: 'PoSe Watch', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Transactions', exact: true })).toHaveCount(0);

    await blockchain.click();
    await expect(blockchain).toHaveAttribute('aria-expanded', 'true');
    await nav.getByRole('link', { name: 'Transactions', exact: true }).click();

    await expect(page.locator('.page-title')).toHaveText('Transactions');
    expect(new URL(page.url()).pathname).toBe('/txs');
    // Out of the way once used, and the focus is on the page that was chosen.
    await expect(nav.getByRole('button', { name: /Menu/ })).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await focused(page)).tag).toBe('h1');
    await expect(nav.getByRole('button', { name: /Menu/ })).toContainText('Blockchain › Transactions');
  });

  test('works from the keyboard alone', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    await page.locator('body').click({ position: { x: 1, y: 1 } });
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      if ((await focused(page)).text.startsWith('Menu')) break;
    }
    expect((await focused(page)).text).toMatch(/^Menu/);
    await page.keyboard.press('Enter');

    // Overview, then the Network group's button; Enter expands it.
    await page.keyboard.press('Tab');
    expect(await focused(page)).toEqual({ tag: 'a', text: 'Overview' });
    await page.keyboard.press('Tab');
    expect(await focused(page)).toMatchObject({ tag: 'button', text: expect.stringMatching(/^Network/) });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    expect(await focused(page)).toEqual({ tag: 'a', text: 'DKG Rounds' });
    await page.keyboard.press('Enter');

    await expect(page.locator('dd-page-rounds')).toHaveCount(1);
    await expect.poll(async () => (await focused(page)).tag).toBe('h1');
  });

  test('Escape closes it and hands the focus back to its button', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/staking');
    await expect(page.locator('.page-title')).toHaveText('Staking health');

    const toggle = sections(page).getByRole('button', { name: /Menu/ });
    await toggle.click();
    await sections(page).getByRole('link', { name: 'Staking', exact: true }).focus();
    await page.keyboard.press('Escape');

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await focused(page)).text).toMatch(/^Menu/);
  });

  /*
   * The case a navigation does not cover: the link to the page already on
   * screen. The router ignores it, so nothing would close the menu, and the
   * focus would sit on a link about to disappear.
   */
  test('following the link to the page already open closes it too', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/staking');
    await expect(page.locator('.page-title')).toHaveText('Staking health');

    const toggle = sections(page).getByRole('button', { name: /Menu/ });
    await toggle.click();
    await sections(page).getByRole('link', { name: 'Staking', exact: true }).click();

    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await focused(page)).text).toMatch(/^Menu/);
    expect(new URL(page.url()).pathname).toBe('/staking');
  });

  /*
   * A link in the menu closes it on its own; Back does not go through the menu.
   * Without the close on navigation, Back with the menu open changed the page
   * underneath and left the menu covering it.
   */
  test('Back closes it too', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/staking');
    await expect(page.locator('.page-title')).toHaveText('Staking health');
    await sections(page).getByRole('button', { name: /Menu/ }).click();
    await sections(page).getByRole('link', { name: 'Fairness', exact: true }).click();
    await expect(page.locator('.page-title')).toHaveText('Selection fairness');

    const toggle = sections(page).getByRole('button', { name: /Menu/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.goBack();

    await expect(page.locator('.page-title')).toHaveText('Staking health');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('the skip link still reaches the content', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await app.goto('/rounds');
    await expect(page.locator('.page-title')).toHaveText('DKG Rounds');

    const skip = page.getByRole('link', { name: 'Skip to content' });
    await skip.focus();
    await expect.poll(async () => (await skip.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await focused(page)).tag).toBe('main');
  });
});
