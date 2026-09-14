import type { Page } from '@playwright/test';
import { expect, ok, test } from './harness.js';
import { healthSnapshot } from './fixtures/api.js';
import { overviewStubs } from './fixtures/stubs.js';

/**
 * The harness testing itself.
 *
 * A verification tool must be shown to fail on data it should reject before its
 * passes are worth anything -- this project has already paid for that lesson
 * once, with a repair tool whose failures were believed for a day and whose bug
 * was in the tool. These two tests are the negative controls for the two ways a
 * browser suite silently stops testing anything: an endpoint that escapes to a
 * real server, and a request that leaves the machine.
 */
test.describe('harness guards', () => {
  test('an API call with no stub is refused and recorded', async ({ app }) => {
    app.expectViolations();
    // Only /health is answered. The overview also needs the ChainLock report,
    // the round list and the timeline; each of those must be refused.
    app.stub({ '/api/v1/health': { body: ok(healthSnapshot()) } });
    await app.goto('/');

    await expect
      .poll(() => app.violations.length, { message: 'refusals recorded' })
      .toBeGreaterThan(0);
    expect(app.violations.some((v) => v.includes('/api/v1/chainlocks'))).toBe(true);
    expect(app.violations.every((v) => v.startsWith('unstubbed API request:'))).toBe(true);
  });

  test('a request that leaves the machine is refused and recorded', async ({ app, page }) => {
    app.expectViolations();
    app.stub(overviewStubs());
    await app.goto('/');
    await page.evaluate(() => fetch('https://example.invalid/probe').catch(() => null));

    await expect.poll(() => app.violations).toEqual([
      expect.stringContaining('external request refused:'),
    ]);
  });
});

/**
 * Held responses, and the one promise `release()` makes: when it returns, the
 * page has read the answer. Every assertion right after a release below is
 * deliberately NOT polled -- a poll would pass against a release that returned
 * too early, and hide exactly the defect these tests exist to catch.
 */
test.describe('held responses', () => {
  const PROBE = '/api/v1/harness-probe';

  async function inPage<T>(page: Page, key: string): Promise<T | undefined> {
    return page.evaluate((name) => (window as unknown as Record<string, unknown>)[name], key) as Promise<
      T | undefined
    >;
  }

  test('release returns only once the page has read the answer', async ({ app, page }) => {
    const gate = app.gate();
    app.stub({ ...overviewStubs(), [PROBE]: { body: ok({ n: 1 }), gate } });
    await app.goto('/');
    // The page waits a real 300 ms between receiving the response and reading
    // it. A release() that returned on delivery alone comes back inside that
    // window, and the read below finds nothing.
    await page.evaluate((path) => {
      const target = window as unknown as Record<string, unknown>;
      void fetch(path).then(async (response) => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        target['probed'] = await response.json();
      });
    }, PROBE);
    await gate.waitForHeld(1);
    expect(gate.held).toEqual([PROBE]);
    expect(await inPage(page, 'probed')).toBeUndefined();

    await gate.release();
    expect(await inPage(page, 'probed')).toEqual(ok({ n: 1 }));
    expect(gate.held).toEqual([]);
  });

  test('held answers land in the order the test releases them, not the order they were asked', async ({
    app,
    page,
  }) => {
    const gate = app.gate();
    app.stub({
      ...overviewStubs(),
      [PROBE]: (url) => ({ body: ok({ n: Number(url.searchParams.get('n')) }), gate }),
    });
    await app.goto('/');
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>)['landed'] = [];
    });
    const ask = (n: number): Promise<void> =>
      page.evaluate(
        ({ path, n }) => {
          const target = window as unknown as { landed: number[] };
          void fetch(`${path}?n=${n}`)
            .then((response) => response.json())
            .then((body: { data: { n: number } }) => {
              target.landed.push(body.data.n);
            });
        },
        { path: PROBE, n }
      );
    // Asked one after the other, so "oldest first" would answer 1 then 2.
    await ask(1);
    await gate.waitForHeld(1);
    await ask(2);
    await gate.waitForHeld(2);

    await gate.release(`${PROBE}?n=2`);
    expect(await inPage(page, 'landed')).toEqual([2]);
    await gate.release(`${PROBE}?n=1`);
    expect(await inPage(page, 'landed')).toEqual([2, 1]);
  });

  test('releasing what is not held is an error, not a silent pass', async ({ app }) => {
    const gate = app.gate();
    app.stub(overviewStubs());
    await app.goto('/');
    await expect(gate.release()).rejects.toThrow('nothing to release; held: nothing');
    await expect(gate.release(PROBE)).rejects.toThrow(`nothing to release for ${PROBE}; held: nothing`);
  });

  /**
   * W3 of the re-review. release() waited for "one more read of this URL", and
   * a read is not a response: another answer on the same path and query,
   * read first, satisfied the count while the released response was still
   * unread. The page below defers reading the released body and reads a
   * second response for the same URL meanwhile -- which is exactly when a
   * count says yes and the body says no.
   */
  test('release waits for its own response, not another read of the same URL', async ({ app, page }) => {
    const gate = app.gate();
    app.stub({ ...overviewStubs(), [PROBE]: { body: ok({ n: 1 }), gate } });
    await app.goto('/');
    await page.evaluate((path) => {
      const target = window as unknown as Record<string, unknown>;
      target['readHeld'] = new Promise<void>((resolve) => {
        target['allowHeldRead'] = resolve;
      });
      void fetch(path).then(async (response) => {
        target['heldArrived'] = true;
        await target['readHeld'];
        target['heldBody'] = await response.json();
      });
    }, PROBE);
    await gate.waitForHeld(1);

    const released = gate.release();
    await expect.poll(() => inPage<boolean>(page, 'heldArrived')).toBe(true);
    // Another response for the same URL, read at once.
    app.stub({ [PROBE]: { body: ok({ n: 2 }) } });
    await page.evaluate(async (path) => {
      await (await fetch(path)).json();
    }, PROBE);
    // The held body is let through a moment later, from outside the page.
    const allow = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        page.evaluate(() => (window as unknown as { allowHeldRead: () => void }).allowHeldRead()).then(resolve, reject);
      }, 500);
    });

    // Read the moment release() returns, and not polled: release() is what must
    // have waited for this very body. Asserted only once the timer has run, so a
    // release that returned early fails here alone -- the assertion used to
    // throw first, and the timer then called a page the teardown had closed
    // (X2 of the third review).
    let body: unknown;
    try {
      await released;
      body = await inPage(page, 'heldBody');
    } finally {
      await allow;
    }
    expect(body).toEqual(ok({ n: 1 }));
  });

  test('two held answers for one URL, read in reverse order, are each waited for on their own', async ({
    app,
    page,
  }) => {
    const gate = app.gate();
    let n = 0;
    app.stub({
      ...overviewStubs(),
      [PROBE]: () => {
        n += 1;
        return { body: ok({ n }), gate };
      },
    });
    await app.goto('/');
    // The first answer is read 500 ms after it arrives, the second at once.
    // Asked one at a time, so the first held is the first asked.
    const ask = (label: string, deferMs: number): Promise<void> =>
      page.evaluate(
        ({ path, label, deferMs }) => {
          const target = window as unknown as Record<string, Record<string, unknown>>;
          target['bodies'] ??= {};
          void fetch(path).then(async (response) => {
            await new Promise((resolve) => setTimeout(resolve, deferMs));
            target['bodies']![label] = await response.json();
          });
        },
        { path: PROBE, label, deferMs }
      );
    await ask('first', 500);
    await gate.waitForHeld(1);
    await ask('second', 0);
    await gate.waitForHeld(2);

    // Both let go together: the second's read lands long before the first's.
    const first = gate.release();
    const second = gate.release();
    // Read as soon as the first release returns; asserted once the second has
    // settled too, for the same reason as above.
    let bodies: Record<string, unknown> | undefined;
    try {
      await first;
      bodies = await inPage<Record<string, unknown>>(page, 'bodies');
    } finally {
      await second;
    }
    expect(bodies?.['first'], 'release() of the first answer returned before its own body was read').toEqual(ok({ n: 1 }));
  });

  test('a request the page cancels while held is reported as cancelled, not waited for', async ({
    app,
    page,
  }) => {
    const gate = app.gate();
    app.stub({ ...overviewStubs(), [PROBE]: { body: ok({ n: 1 }), gate } });
    await app.goto('/');
    await page.evaluate((path) => {
      const controller = new AbortController();
      (window as unknown as Record<string, unknown>)['cancelProbe'] = () => controller.abort();
      void fetch(path, { signal: controller.signal }).catch(() => undefined);
    }, PROBE);
    await gate.waitForHeld(1);
    expect(gate.cancelled(PROBE)).toBe(false);

    await page.evaluate(() => (window as unknown as { cancelProbe: () => void }).cancelProbe());
    await expect.poll(() => gate.cancelled(PROBE)).toBe(true);

    // Said at once, and said as what it is -- not a read that timed out.
    const started = Date.now();
    await expect(gate.release()).rejects.toThrow(`the page cancelled its request to ${PROBE} while it was held`);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('release works while the page clock is paused', async ({ app, page }) => {
    // Measured: an installed clock alone keeps the page's timers running, so
    // that case proves nothing here. A PAUSED clock stops them, and waiting
    // for the read must not depend on one firing.
    await page.clock.install({ time: new Date('2026-09-11T09:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-11T09:00:01Z'));
    const gate = app.gate();
    app.stub({ ...overviewStubs(), [PROBE]: { body: ok({ n: 7 }), gate } });
    await app.goto('/');
    await page.evaluate((path) => {
      const target = window as unknown as Record<string, unknown>;
      void fetch(path)
        .then((response) => response.json())
        .then((body) => {
          target['probed'] = body;
        });
    }, PROBE);
    await gate.waitForHeld(1);
    await gate.release();
    expect(await inPage(page, 'probed')).toEqual(ok({ n: 7 }));
  });
});
