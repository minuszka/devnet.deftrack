import { test as base, expect, type Page } from '@playwright/test';

/**
 * The browser test harness.
 *
 * It renders the real application -- the same `dd-shell` and `dd-admin-shell`
 * the site ships -- against a local Vite dev server, and answers every API call
 * from a stub declared by the test.
 *
 * The rule it enforces is the one a UI suite is easiest to get wrong: a request
 * that is not explicitly stubbed is **refused and recorded**, and an unrecorded
 * refusal fails the test at teardown. Without that, a forgotten endpoint falls
 * through Vite's `/api` proxy to whatever happens to be listening on the
 * developer's machine, and the suite quietly becomes a test of the live devnet
 * -- green on one laptop, red on another, and evidence of nothing on either.
 * The dev server this config starts also points its proxy at a dead port, so
 * even a request that escaped interception cannot reach a real server.
 *
 * What a green run here proves: the client renders, routes and reports errors
 * correctly for a given response. It is not evidence about the server, the
 * database, the node, or the devnet.
 */

/** The envelope every route of this API answers in. */
export type Envelope<T> = { success: true; data: T } | { success: false; error: string };

export function ok<T>(data: T): Envelope<T> {
  return { success: true, data };
}

export function fail(error: string): Envelope<never> {
  return { success: false, error };
}

export interface StubResponse {
  /** Defaults to 200. */
  status?: number;
  /** Serialised as JSON. Ignored when `raw` is given. */
  body?: unknown;
  /** A literal body, for the cases where the envelope itself is malformed. */
  raw?: string;
  /** Defaults to application/json. */
  contentType?: string;
}

/** A stub is fixed, or computed from the request URL when the query matters. */
export type StubHandler = StubResponse | ((url: URL) => StubResponse);

/**
 * Keyed by pathname; the query string is matched inside a handler, not here.
 *
 * A key ending in `/*` matches every path under it, which is how a detail route
 * whose identifier is part of the path (`/quorum-rounds/7%3A7416%3A0`) is
 * stubbed without spelling out the encoding. An exact key always wins over a
 * prefix, and the longest prefix wins among prefixes -- so
 * `/quorum-rounds/profiles` stays its own answer even with
 * `/quorum-rounds/*` declared.
 */
export type ApiStubs = Record<string, StubHandler>;

export class AppHarness {
  /** Requests that broke the harness contract. Asserted empty at teardown. */
  readonly violations: string[] = [];
  /** Every `/api/` request the app made, path and query, in order. */
  readonly apiCalls: string[] = [];

  private stubs: ApiStubs = {};
  private violationsExpected = false;

  constructor(
    private readonly page: Page,
    private readonly origin: string
  ) {}

  /** Add or replace stubs. Safe to call between navigations. */
  stub(stubs: ApiStubs): this {
    this.stubs = { ...this.stubs, ...stubs };
    return this;
  }

  /** Remove a stub, so the next call to it is refused as unstubbed. */
  unstub(pathname: string): this {
    const next = { ...this.stubs };
    delete next[pathname];
    this.stubs = next;
    return this;
  }

  /**
   * For the tests that exist to prove the guard fires. Every other test must
   * leave the teardown assertion armed.
   */
  expectViolations(): this {
    this.violationsExpected = true;
    return this;
  }

  /** API calls whose pathname matches, in order. */
  callsTo(pathname: string): string[] {
    return this.apiCalls.filter((call) => call === pathname || call.startsWith(`${pathname}?`));
  }

  async goto(path: string): Promise<void> {
    await this.page.goto(path);
  }

  async install(): Promise<void> {
    await this.page.route('**/*', async (route) => {
      const request = route.request();
      let url: URL;
      try {
        url = new URL(request.url());
      } catch {
        this.violations.push(`unparseable request URL: ${request.url()}`);
        await this.safeAbort(route);
        return;
      }

      // Nothing leaves the machine. A test that reaches a CDN, a font host or
      // the live site is not a test of this client.
      if (url.origin !== this.origin) {
        this.violations.push(`external request refused: ${request.method()} ${request.url()}`);
        await this.safeAbort(route);
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        this.apiCalls.push(`${url.pathname}${url.search}`);
        const handler = this.resolve(url.pathname);
        if (handler === undefined) {
          this.violations.push(
            `unstubbed API request: ${request.method()} ${url.pathname}${url.search}`
          );
          await this.safeAbort(route);
          return;
        }
        const stub = typeof handler === 'function' ? handler(url) : handler;
        try {
          await route.fulfill({
            status: stub.status ?? 200,
            contentType: stub.contentType ?? 'application/json',
            body: stub.raw ?? JSON.stringify(stub.body ?? null),
          });
        } catch {
          // The page navigated away while this was in flight. Not a violation.
        }
        return;
      }

      // The app's own documents, modules and assets, served by Vite.
      try {
        await route.continue();
      } catch {
        // Same: a request abandoned by a navigation cannot be continued.
      }
    });
  }

  assertNoViolations(): void {
    if (this.violationsExpected) return;
    expect(this.violations, 'requests the harness refused').toEqual([]);
  }

  /** Exact first, then the longest declared `/*` prefix. */
  private resolve(pathname: string): StubHandler | undefined {
    const exact = this.stubs[pathname];
    if (exact !== undefined) return exact;

    let bestPrefix = '';
    let bestHandler: StubHandler | undefined;
    for (const [key, handler] of Object.entries(this.stubs)) {
      if (!key.endsWith('/*')) continue;
      const prefix = key.slice(0, -1);
      if (!pathname.startsWith(prefix)) continue;
      if (prefix.length > bestPrefix.length) {
        bestPrefix = prefix;
        bestHandler = handler;
      }
    }
    return bestHandler;
  }

  private async safeAbort(route: { abort: (code: string) => Promise<void> }): Promise<void> {
    try {
      await route.abort('blockedbyclient');
    } catch {
      // Already handled, or the page is gone.
    }
  }
}

export const test = base.extend<{ app: AppHarness }>({
  app: async ({ page, baseURL }, use) => {
    if (baseURL === undefined) throw new Error('baseURL is not configured for this project');
    const app = new AppHarness(page, new URL(baseURL).origin);
    await app.install();
    await use(app);
    app.assertNoViolations();
  },
});

export { expect };
