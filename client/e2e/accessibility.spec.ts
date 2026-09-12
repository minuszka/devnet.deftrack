import type { Page } from '@playwright/test';
import { expect, ok, test } from './harness.js';
import { overviewStubs, roundStubs } from './fixtures/stubs.js';
import { adminSessionStubs, RUN_A, runStubs } from './fixtures/admin.js';
import { pageOf, roundRun } from './fixtures/api.js';

/**
 * F12 and F14: what a page is, where the focus goes, and one colour pair.
 *
 * The public pages named themselves in a `<div class="page-title">`, so the
 * document had no heading structure at all -- a screen reader's list of
 * headings was empty on every page of the site. Navigation scrolled and
 * retitled the document and left the focus where it was, so a keyboard user
 * arrived at a new page with no signal that anything had happened and had to
 * tab back through the whole header to reach it. There was no skip link.
 *
 * None of this is provable by a screenshot, which is why every assertion below
 * reads the accessibility tree, the focus, or a computed colour.
 */

/**
 * Where the focus really is, across shadow boundaries.
 *
 * `document.activeElement` answers the outermost host -- `dd-shell` -- for
 * anything focused inside it, so the naive check passes whatever happens and
 * proves nothing. This walks down until the answer is the real element.
 */
async function focused(page: Page): Promise<{ tag: string; text: string }> {
  return page.evaluate(() => {
    let el: Element | null = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return { tag: el?.tagName.toLowerCase() ?? '', text: (el?.textContent ?? '').trim().slice(0, 60) };
  });
}

/** Every heading in the document, in order, across every shadow root. */
async function headings(page: Page): Promise<Array<{ level: number; text: string }>> {
  return page.evaluate(() => {
    const out: Array<{ level: number; text: string }> = [];
    const walk = (root: ParentNode): void => {
      for (const el of root.querySelectorAll('*')) {
        if (/^H[1-6]$/.test(el.tagName)) {
          out.push({ level: Number(el.tagName[1]), text: (el.textContent ?? '').trim() });
        }
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return out;
  });
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(value: string): [number, number, number] {
  const m = value.match(/rgba?\(([^)]+)\)/);
  expect(m, `not a colour: ${value}`).not.toBeNull();
  const parts = m![1]!.split(',').map((p) => Number(p.trim()));
  // An alpha below 1 would make the measurement a lie, because what the eye
  // sees is a composite this arithmetic does not do.
  expect(parts[3] ?? 1, `colour is not opaque: ${value}`).toBe(1);
  return [parts[0]!, parts[1]!, parts[2]!];
}

test.describe('semantics and focus', () => {
  test('a page names itself in one h1, with its sections under it', async ({ app, page }) => {
    app.stub(overviewStubs());
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    const list = await headings(page);
    const h1s = list.filter((h) => h.level === 1);
    // Exactly one, and it is the page -- not the site, not a card.
    expect(h1s).toHaveLength(1);
    expect(h1s[0]?.text).toBe('Overview');
    // And the sections are under it rather than beside it.
    expect(list.filter((h) => h.level === 2).length).toBeGreaterThan(0);
    expect(list.some((h) => h.level > 2)).toBe(false);
  });

  test('every public page carries exactly one h1', async ({ app, page }) => {
    app.stub({
      ...overviewStubs(),
      ...roundStubs(),
      '/api/v1/staking/health': { body: ok({}) },
    });
    for (const path of ['/', '/rounds', '/a-path-that-does-not-exist']) {
      await app.goto(path);
      await expect(page.locator('.page-title')).toHaveCount(1);
      const h1s = (await headings(page)).filter((h) => h.level === 1);
      expect(h1s, `on ${path}`).toHaveLength(1);
    }
  });

  test('navigating moves the focus to the page that was asked for', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...roundStubs() });
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    await page.getByRole('link', { name: 'DKG Rounds', exact: true }).click();
    await expect(page.locator('dd-page-rounds')).toHaveCount(1);

    // The heading of the new page, not the link that was clicked and not the
    // body -- either of which leaves a keyboard reader where they were.
    await expect.poll(async () => (await focused(page)).tag).toBe('h1');
    expect((await focused(page)).text).toContain('DKG Rounds');
  });

  test('Back moves the focus too, because Back is a navigation', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...roundStubs() });
    await app.goto('/');
    await page.getByRole('link', { name: 'DKG Rounds', exact: true }).click();
    await expect.poll(async () => (await focused(page)).text).toContain('DKG Rounds');

    await page.goBack();

    await expect.poll(async () => (await focused(page)).text).toBe('Overview');
  });

  /**
   * The half that is easy to get wrong in the other direction: a poll that
   * takes the focus away is worse than one that never moves it, because it
   * happens while somebody is reading.
   */
  test('the header poll does not take the focus', async ({ app, page }) => {
    await page.clock.install({ time: new Date('2026-09-11T09:00:00.000Z') });
    app.stub(overviewStubs());
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    await page.getByRole('link', { name: 'ChainLocks', exact: true }).focus();
    const before = await focused(page);
    expect(before.tag).toBe('a');

    // Two full header periods, and a health response landing in each.
    await page.clock.fastForward(65_000);

    expect(await focused(page)).toEqual(before);
  });

  test('changing a filter leaves the focus on the control that was pressed', async ({
    app,
    page,
  }) => {
    app.stub({
      ...roundStubs(),
      '/api/v1/quorum-rounds': { body: ok(pageOf(roundRun(5), { total: 120, limit: 50 })) },
    });
    await app.goto('/rounds');
    await expect(page.locator('dd-page-rounds')).toHaveCount(1);

    await page.getByRole('button', { name: 'failed', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('failed');

    // The URL changed and the list reloaded; the focus stayed under the hand
    // that did it. Writing the query string deliberately dispatches no
    // popstate, which is what keeps the shell's focus move out of this.
    const after = await focused(page);
    expect(after.tag).toBe('button');
    expect(after.text).toBe('failed');
  });

  /**
   * Back over a filter change is a popstate, and it is not a navigation.
   *
   * The page did not change, so nothing new has to be announced and the focus
   * belongs where the reader left it. Without the guard the shell would treat
   * every popstate alike and throw the focus at the heading each time somebody
   * undid a filter -- which is the same defect as the poll stealing it, just
   * with a different trigger.
   */
  test('Back over a filter change does not move the focus', async ({ app, page }) => {
    app.stub({
      ...roundStubs(),
      '/api/v1/quorum-rounds': { body: ok(pageOf(roundRun(5), { total: 120, limit: 50 })) },
    });
    await app.goto('/rounds');
    await expect(page.locator('dd-page-rounds')).toHaveCount(1);

    await page.getByRole('button', { name: 'failed', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('failed');
    const before = await focused(page);
    expect(before.tag).toBe('button');

    await page.goBack();
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBeNull();

    // Same page, same reader, same place.
    expect(await focused(page)).toEqual(before);
  });

  test('the skip link is the first stop and actually reaches the content', async ({
    app,
    page,
  }) => {
    app.stub(overviewStubs());
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('Tab');

    const first = await focused(page);
    expect(first.tag).toBe('a');
    expect(first.text).toBe('Skip to content');

    await page.keyboard.press('Enter');

    // `href="#content"` names an id inside a shadow root, which the browser
    // will not resolve, so this proves the handler and not the href.
    await expect.poll(async () => (await focused(page)).tag).toBe('main');
  });

  test('the skip link is visible once it has the focus', async ({ app, page }) => {
    app.stub(overviewStubs());
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    const skip = page.getByRole('link', { name: 'Skip to content' });
    // Off screen until then -- present in the tab order, out of the way.
    const before = await skip.boundingBox();
    expect(before === null || before.x < 0).toBe(true);

    await skip.focus();
    const after = await skip.boundingBox();
    expect(after?.x ?? -1).toBeGreaterThanOrEqual(0);
  });

  test('the keyboard alone reaches a section and its filters', async ({ app, page }) => {
    app.stub({ ...overviewStubs(), ...roundStubs() });
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    // Tab until the nav link is reached, then follow it with the keyboard.
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const el = await focused(page);
      if (el.tag === 'a' && el.text === 'DKG Rounds') break;
    }
    expect((await focused(page)).text).toBe('DKG Rounds');

    await page.keyboard.press('Enter');
    await expect(page.locator('dd-page-rounds')).toHaveCount(1);
    await expect.poll(async () => (await focused(page)).tag).toBe('h1');

    // And from the heading, the page's own controls are the next stops.
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab');
      if ((await focused(page)).tag === 'button') break;
    }
    expect((await focused(page)).tag).toBe('button');
  });
});

test.describe('contrast, motion and zoom', () => {
  /**
   * F14, measured on the button rather than on the tokens.
   *
   * The unit test holds the token pair to 4.5:1; this is what proves the button
   * uses the pair. A palette that passes while the component paints something
   * else is the failure the unit test cannot see.
   */
  for (const theme of ['dark', 'light'] as const) {
    test(`the danger button clears 4.5:1 in the ${theme} theme`, async ({ app, page }) => {
      app.stub({
        ...adminSessionStubs(),
        ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true, faultMayBeActive: true }),
      });
      await app.goto(`/admin?run=${RUN_A}`);
      const abort = page.getByRole('button', { name: 'Abort & recover' });
      await expect(abort).toBeVisible();

      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);

      const pair = await abort.evaluate((el) => {
        const style = getComputedStyle(el);
        return { fg: style.color, bg: style.backgroundColor };
      });
      const ratio = contrast(parseRgb(pair.fg), parseRgb(pair.bg));
      expect(ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  test('reduced motion really stops the animations', async ({ app, page }) => {
    app.stub(overviewStubs());
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    const dot = page.locator('.live-dot').first();
    const read = (): Promise<string> =>
      dot.evaluate((el) => getComputedStyle(el).animationDuration);

    // Measured both ways in one test on purpose. Asserting only the reduced
    // value would pass just as well against an element that never animated,
    // which proves nothing about the media query.
    const moving = Number.parseFloat(await read());
    expect(moving).toBeGreaterThan(0.1);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(Number.parseFloat(await read())).toBeLessThanOrEqual(0.01);
  });

  /**
   * 200% zoom, as a browser does it: the CSS viewport halves. Nothing may then
   * need sideways scrolling, because a page that scrolls in both directions is
   * unreadable long before it is inaccessible.
   */
  test('nothing overflows sideways at 200% zoom', async ({ app, page }) => {
    app.stub(overviewStubs());
    await page.setViewportSize({ width: 640, height: 800 });
    await app.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Overview');

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  /**
   * The target preview's caption, which was outside its table.
   *
   * Measured rather than assumed, and the measurement corrected the
   * expectation: a caption written outside a table is not merely
   * mis-associated, the HTML parser DISCARDS it. The first version of this
   * test counted orphans and passed with the defect in place, because there
   * was no orphan to count -- the element was never in the DOM. What the panel
   * lost was not an association but the text itself.
   */
  test('the target table carries its caption, inside the table', async ({ app, page }) => {
    app.stub({
      ...adminSessionStubs(),
      ...runStubs({ runKey: RUN_A, status: 'fault_active', live: true }),
    });
    await app.goto(`/admin?run=${RUN_A}`);
    await expect(page.locator('.run-state')).toBeVisible();

    const captions = await page.evaluate(() => {
      const out: Array<{ parent: string; text: string }> = [];
      const walk = (root: ParentNode): void => {
        for (const el of root.querySelectorAll('caption')) {
          out.push({ parent: el.parentElement?.tagName ?? '', text: (el.textContent ?? '').trim() });
        }
        for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot);
      };
      walk(document);
      return out;
    });

    const target = captions.find((c) => c.text.startsWith('The targets this scenario'));
    expect(target, 'the target table has no caption at all').toBeDefined();
    expect(target?.parent).toBe('TABLE');
    // And nothing anywhere is a caption outside a table, which the parser would
    // have thrown away just the same.
    expect(captions.every((c) => c.parent === 'TABLE')).toBe(true);
  });
});
