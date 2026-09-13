import type { Page } from '@playwright/test';
import { expect, fail, ok, test, type ApiStubs } from './harness.js';
import { healthSnapshot, masternodeTimelinePoint } from './fixtures/api.js';
import { emptyLayoutStubs, HASH, loadedLayoutStubs, LONG_RUN_KEY, LONG_TOKEN, SIM_A } from './fixtures/layout.js';

/**
 * Day 18: the document never scrolls sideways; a table that is wider than the
 * screen scrolls inside its own box, and says so.
 *
 * Measured on every public path, at 360, 390, 768 and 1440 px, in four states
 * -- loaded with the longest identifiers a page can be handed, empty, failing
 * with an error that quotes one unbroken token, and still loading -- and again
 * at 200 % zoom. Before this day, at 360 px, every public page scrolled
 * sideways in the error state (by 587 px) and in the loading state (by 176 px).
 *
 * What "scrolls sideways" means here is the document's own measure:
 * `scrollWidth` of the root against its `clientWidth`. A table inside an
 * `overflow-x: auto` box does not count, which is the point -- that is where
 * the width is meant to go.
 */

const WIDTHS = [360, 390, 768, 1440] as const;

const PATHS = [
  '/',
  '/rounds',
  '/pose',
  '/masternodes',
  '/chainlocks',
  '/dsl',
  '/staking',
  '/peers',
  '/operators',
  '/fairness',
  '/blocks',
  '/txs',
  '/experiments',
  '/simulations',
  `/round/${encodeURIComponent(`7:${LONG_TOKEN}:0`)}`,
  `/block/${HASH}`,
  `/tx/${HASH}`,
  `/experiments/${LONG_RUN_KEY}`,
  `/simulations/${SIM_A}`,
  `/no-such-page-${LONG_TOKEN}`,
  // Day 19: search results for an identifier every lookup endpoint answers,
  // and the methodology page.
  `/search?q=${HASH}`,
  '/methodology',
];

interface Overflow {
  /** How many CSS pixels wider than the viewport the document is. */
  px: number;
  /** The outermost elements past the right edge that nothing clips. */
  culprits: string[];
}

/**
 * The document's horizontal overflow, and what causes it.
 *
 * The culprits are for the failure message only -- the assertion is on `px`.
 * An element counts when it extends past the viewport (its box, or its text
 * spilling out of a box too narrow for it) and no ancestor, across shadow
 * boundaries, clips it horizontally.
 */
async function documentOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const viewport = root.clientWidth;
    const px = root.scrollWidth - viewport;
    const culprits: string[] = [];
    if (px <= 0) return { px, culprits };

    const parentOf = (el: Element): Element | null => {
      if (el.parentElement) return el.parentElement;
      const host = el.getRootNode();
      return host instanceof ShadowRoot ? host.host : null;
    };
    const clipped = (el: Element): boolean => {
      for (let a = parentOf(el); a; a = parentOf(a)) {
        if (getComputedStyle(a).overflowX !== 'visible') return true;
      }
      return false;
    };
    const walk = (scope: Document | ShadowRoot): void => {
      for (const el of Array.from(scope.querySelectorAll('*'))) {
        const box = el.getBoundingClientRect();
        const spills =
          getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1
            ? box.left + el.scrollWidth
            : 0;
        if (box.width > 0 && Math.max(box.right, spills) > viewport + 0.5 && !clipped(el)) {
          const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
          culprits.push(`${el.tagName.toLowerCase()}${cls}`);
        }
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return { px, culprits: culprits.slice(-3) };
  });
}

async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Load a path at desktop width and wait for what the state should show. */
async function load(page: Page, path: string, state: 'loaded' | 'empty' | 'error' | 'loading'): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await expect(page.locator('main > *').first()).toBeAttached();
  if (state === 'loading') {
    await page.waitForTimeout(250);
    return;
  }
  await page.waitForLoadState('networkidle');
  await nextFrame(page);
}

async function sweep(page: Page, state: 'loaded' | 'empty' | 'error' | 'loading', widths: readonly number[]): Promise<string[]> {
  const failures: string[] = [];
  for (const path of PATHS) {
    await load(page, path, state);
    if (state === 'loaded' || state === 'empty') {
      // The fixtures must actually render the page. A layout measured on a
      // page that failed to load is a measurement of the error banner.
      const errors = await page.locator('main .err').allTextContents();
      if (errors.length > 0) failures.push(`${state} ${path}: rendered an error instead of the page: ${errors.join(' / ')}`);
    }
    // And the failing state must actually be failing, or it measured a loaded
    // page and called it an error page. Fairness says it as a note: with its
    // inputs unreadable it cannot name a profile, and says that. The search
    // page's own form of it is the unchecked-lookups box. The not-found page
    // and the methodology page ask nothing, so they have no failing state --
    // they are still measured below.
    if (state === 'error' && !path.startsWith('/no-such-page') && path !== '/methodology') {
      await expect(page.locator('main .err, main .note, main .unchecked').first(), `${path} shows its error`).toBeVisible();
    }
    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await nextFrame(page);
      const overflow = await documentOverflow(page);
      if (overflow.px > 0) {
        failures.push(`${state} ${path.slice(0, 60)} @${width}px: ${overflow.px}px wider than the screen (${overflow.culprits.join(', ')})`);
      }
    }
  }
  return failures;
}

function errorStubs(): ApiStubs {
  return {
    '/api/v1/health': { body: ok(healthSnapshot()) },
    // An upstream message that quotes an identifier: the realistic long token.
    '/api/v1/*': { status: 503, body: fail(`upstream unavailable while reading ${LONG_TOKEN}`) },
  };
}

function loadingStubs(): ApiStubs {
  // Answers that do not arrive within the test: every skeleton stays up.
  return { '/api/v1/*': { delayMs: 60_000, body: ok(null) } };
}

test.describe('the document does not scroll sideways', () => {
  test.describe.configure({ timeout: 180_000 });

  test('loaded, with the longest identifiers', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    expect(await sweep(page, 'loaded', WIDTHS)).toEqual([]);
  });

  test('empty', async ({ app, page }) => {
    app.stub(emptyLayoutStubs());
    expect(await sweep(page, 'empty', WIDTHS)).toEqual([]);
  });

  test('failing, with an error that quotes a long identifier', async ({ app, page }) => {
    app.stub(errorStubs());
    expect(await sweep(page, 'error', WIDTHS)).toEqual([]);
  });

  test('still loading', async ({ app, page }) => {
    app.stub(loadingStubs());
    expect(await sweep(page, 'loading', WIDTHS)).toEqual([]);
  });

  /**
   * The measurement has to be able to fail, or every green run above is
   * worthless. One element wider than the screen, planted in a page's shadow
   * root the way a real culprit would sit, must be found and named.
   */
  test('the measurement finds a planted culprit (negative control)', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await load(page, '/rounds', 'loaded');
    await page.setViewportSize({ width: 360, height: 800 });
    await nextFrame(page);
    expect((await documentOverflow(page)).px).toBe(0);

    await page.evaluate(() => {
      const root = document.querySelector('dd-shell')?.shadowRoot?.querySelector('dd-page-rounds')?.shadowRoot;
      const planted = document.createElement('div');
      planted.className = 'planted-culprit';
      planted.style.width = '900px';
      planted.style.height = '4px';
      root?.appendChild(planted);
    });
    await nextFrame(page);
    const overflow = await documentOverflow(page);
    expect(overflow.px).toBeGreaterThan(0);
    expect(overflow.culprits.join(' ')).toContain('planted-culprit');
  });
});

/**
 * 200 % zoom on a 1440 px window: the page is laid out in 720 CSS pixels and
 * drawn at twice the density. Emulated as exactly that -- a real browser zoom
 * is not something Playwright can press -- which is the same layout the zoomed
 * window gets.
 */
test.describe('at 200 % zoom', () => {
  test.use({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  test.describe.configure({ timeout: 180_000 });

  // Two tests, not one: stubs merge, and an exact stub from the loaded set
  // would still answer after the error set was added -- the "failing" sweep
  // would have measured loaded pages again. It did, the first time.
  test('loaded pages hold their width', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    expect(await sweep(page, 'loaded', [720])).toEqual([]);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
  });

  test('failing pages hold their width', async ({ app, page }) => {
    app.stub(errorStubs());
    expect(await sweep(page, 'error', [720])).toEqual([]);
  });
});

/*
 * A term and its value, on a phone: one above the other. Side by side, a
 * 170 px label column left the values about a hundred pixels, and a sentence
 * became a column of single words.
 */
test('an experiment’s declared facts stack on a phone and sit side by side on a desktop', async ({ app, page }) => {
  app.stub(loadedLayoutStubs());
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/experiments/${LONG_RUN_KEY}`);
  const term = page.locator('dd-page-experiments .kv dt').first();
  const value = page.locator('dd-page-experiments .kv dd').first();
  await expect(value).toBeVisible();

  const narrow = { term: await term.boundingBox(), value: await value.boundingBox() };
  expect(narrow.term && narrow.value && Math.abs(narrow.term.x - narrow.value.x) < 1).toBe(true);
  expect(narrow.term && narrow.value && narrow.value.y > narrow.term.y).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => ((await value.boundingBox())?.x ?? 0) - ((await term.boundingBox())?.x ?? 0)).toBeGreaterThan(100);
});

/*
 * Day 20: a chart that follows the width of its box without a resize loop.
 *
 * Both charts set their width from a ResizeObserver and derive their height
 * from it, so each width they took changed the height of the very element they
 * were observing, inside the observer's own delivery -- which the browser
 * reports as "ResizeObserver loop completed with undelivered notifications".
 * It was on main before day 18 (measured then, with and without the table
 * controller), four times per resize sweep on the front page.
 */
test('resizing the pages with charts raises no ResizeObserver loop error', async ({ app, page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    (window as unknown as { __resizeLoops: number }).__resizeLoops = 0;
    window.addEventListener('error', (event) => {
      if (String(event.message).includes('ResizeObserver loop')) {
        (window as unknown as { __resizeLoops: number }).__resizeLoops += 1;
      }
    });
  });
  const stubs = loadedLayoutStubs();
  // The PoSe chart needs more than one sample to draw.
  stubs['/api/v1/masternodes/timeline'] = {
    body: ok({ hours: 168, points: [0, 1, 2].map((i) => ({ ...masternodeTimelinePoint(), height: 11_400 + i })) }),
  };
  app.stub(stubs);
  const loops: string[] = [];
  for (const [path, chart] of [['/', 'dd-health-chart'], ['/pose', 'dd-mn-chart']] as const) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await expect(page.locator(chart)).toBeVisible();
    for (const width of [1280, 900, 700, 1440, 600, 1100]) {
      await page.setViewportSize({ width, height: 800 });
      await nextFrame(page);
      await nextFrame(page);
    }
    const count = await page.evaluate(() => (window as unknown as { __resizeLoops: number }).__resizeLoops);
    if (count > 0) loops.push(`${path}: ${count}`);
  }
  expect(loops).toEqual([]);
});

test.describe('a wide table scrolls in its own box, and says so', () => {
  async function roundsTable(page: Page) {
    return page.locator('dd-page-rounds .twrap').first();
  }

  test('on a phone: marked, focusable, and still a table', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/rounds');
    const wrapper = await roundsTable(page);
    await expect(wrapper.locator('tbody tr')).toHaveCount(5);

    await expect(wrapper).toHaveAttribute('data-scrollable', '');
    await expect(wrapper).toHaveAttribute('data-more-end', '');
    await expect(wrapper).not.toHaveAttribute('data-more-start', '');

    // The hint is drawn, and the fade is on.
    const drawn = await wrapper.evaluate((el) => ({
      hint: getComputedStyle(el, '::before').content,
      mask: getComputedStyle(el).maskImage || getComputedStyle(el).getPropertyValue('-webkit-mask-image'),
    }));
    expect(drawn.hint).toContain('Scroll sideways for more columns');
    expect(drawn.mask).not.toBe('none');

    // Still a table: a value is read against its column header, and CSS that
    // turned rows into cards would break that for every reader at once.
    const shape = await wrapper.evaluate((el) => {
      const table = el.querySelector('table');
      const headers = el.querySelectorAll('thead th');
      const firstRow = el.querySelectorAll('tbody tr:first-child td');
      return {
        table: table ? getComputedStyle(table).display : 'missing',
        th: headers[0] ? getComputedStyle(headers[0]).display : 'missing',
        td: firstRow[0] ? getComputedStyle(firstRow[0]).display : 'missing',
        columns: headers.length,
        cells: firstRow.length,
      };
    });
    expect(shape).toMatchObject({ table: 'table', th: 'table-cell', td: 'table-cell' });
    expect(shape.cells).toBe(shape.columns);

    // A keyboard reader can reach it, and it has a name.
    await expect(wrapper).toHaveAttribute('tabindex', '0');
    await expect(wrapper).toHaveAttribute('role', 'group');
    await expect(wrapper).toHaveAttribute('aria-label', /scrolls sideways/);
    await wrapper.focus();
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight');
    await expect.poll(() => wrapper.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  });

  test('scrolled to the end, the hint turns round', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/rounds');
    const wrapper = await roundsTable(page);
    await expect(wrapper).toHaveAttribute('data-more-end', '');

    await wrapper.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(wrapper).toHaveAttribute('data-more-start', '');
    await expect(wrapper).not.toHaveAttribute('data-more-end', '');
  });

  /*
   * The other direction. A marker that is always on is as useless as one that
   * is never on, and a tab stop on a table that does not scroll is a stop that
   * does nothing.
   */
  test('a table that fits carries no hint and no tab stop', async ({ app, page }) => {
    app.stub(loadedLayoutStubs());
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/rounds');
    const wrapper = await roundsTable(page);
    await expect(wrapper).toHaveAttribute('data-scrollable', '');

    await page.setViewportSize({ width: 2400, height: 900 });
    await expect(wrapper).not.toHaveAttribute('data-scrollable', '');
    await expect(wrapper).not.toHaveAttribute('data-more-end', '');
    await expect(wrapper).not.toHaveAttribute('tabindex', /.*/);
    expect(await wrapper.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
  });

  test('every table on every page agrees with its own measurement', async ({ app, page }) => {
    // Forty page loads: generous, because under four workers the dev server is
    // shared and a load can take a few seconds. The assertion is not timing.
    test.setTimeout(180_000);
    app.stub(loadedLayoutStubs());
    const disagreements: string[] = [];
    let scrollable = 0;
    let fitting = 0;
    for (const path of PATHS) {
      for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await nextFrame(page);
        await nextFrame(page);
        const rows = await page.locator('main .twrap').evaluateAll((els) =>
          els.map((el) => ({
            overflows: el.scrollWidth - el.clientWidth > 1,
            marked: el.hasAttribute('data-scrollable'),
            tab: el.getAttribute('tabindex'),
          }))
        );
        rows.forEach((row, i) => {
          if (row.overflows) scrollable += 1;
          else fitting += 1;
          if (row.marked !== row.overflows || (row.tab === '0') !== row.overflows) {
            disagreements.push(`${path.slice(0, 40)} @${width} table ${i}: overflows=${row.overflows} marked=${row.marked} tabindex=${row.tab}`);
          }
        });
      }
    }
    expect(disagreements).toEqual([]);
    // Both sides were actually exercised.
    expect(scrollable).toBeGreaterThan(0);
    expect(fitting).toBeGreaterThan(0);
  });
});
