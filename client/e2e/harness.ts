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
 *
 * It also notes every JSON body the page reads, as pathname and query, so a
 * test can wait until a response has been USED rather than merely sent. That
 * is an observer and nothing more: the page gets back the very promise it
 * asked for, and the note is taken in a reaction registered before the page's
 * own. See `ResponseGate`, which is what needs it.
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
  /**
   * Hold the answer back this long.
   *
   * For the races a control surface has to survive: two requests in flight and
   * the slower one describing a state the reader has already moved on from.
   * Real time, not the page's clock -- the point is that the browser is doing
   * other things while this one is outstanding.
   *
   * A delay says "slower", never "after": when the order of two answers is
   * what a test is about, hold them at a `gate` and release them in that order.
   */
  delayMs?: number;
  /** Hold every request this stub answers until the test releases it. */
  gate?: ResponseGate;
}

/** A stub is fixed, or computed from the request URL when the query matters. */
/**
 * A stub, or a function that decides from the request.
 *
 * The method is passed as well as the URL because one path genuinely serves two
 * things: `/api/v1/admin/simulations/runs` is the run LIST on GET and the
 * create on POST, and a stub that could only see the URL had to answer one of
 * them wrongly.
 */
export type StubHandler = StubResponse | ((url: URL, method: string) => StubResponse);

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

/** One `/api/` request as the harness saw it go out. */
export interface RecordedRequest {
  method: string;
  /** Pathname and query, as sent. */
  path: string;
  /** The parsed JSON body, or null when there was none (or it was not JSON). */
  body: unknown;
  /**
   * The `x-idempotency-key` header, when one was sent.
   *
   * Recorded because it is the thing that makes repeating an uncertain
   * mutation safe, and because getting its scope wrong is invisible in the
   * response: the server would simply answer that it had already done it.
   */
  idempotencyKey: string | null;
}

export class AppHarness {
  /** Requests that broke the harness contract. Asserted empty at teardown. */
  readonly violations: string[] = [];
  /** Every `/api/` request the app made, path and query, in order. */
  readonly apiCalls: string[] = [];
  /** The same requests with their method and body: what a mutation actually sent. */
  readonly requests: RecordedRequest[] = [];

  private stubs: ApiStubs = {};
  private violationsExpected = false;
  private readonly gates: ResponseGate[] = [];

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

  /** Recorded requests to one pathname, optionally narrowed to one method. */
  requestsTo(pathname: string, method?: string): RecordedRequest[] {
    return this.requests.filter(
      (entry) =>
        (entry.path === pathname || entry.path.startsWith(`${pathname}?`)) &&
        (method === undefined || entry.method === method)
    );
  }

  async goto(path: string): Promise<void> {
    await this.page.goto(path);
  }

  /** A gate for held responses. Put it on the stubs whose order matters. */
  gate(): ResponseGate {
    const gate = new ResponseGate(this);
    this.gates.push(gate);
    return gate;
  }

  /** How many responses to exactly this pathname and query the page has read. */
  async readCount(path: string): Promise<number> {
    const count = await this.page.evaluate((wanted) => {
      const read = (window as unknown as { __ddHarnessRead?: string[] }).__ddHarnessRead;
      return read === undefined ? -1 : read.filter((entry) => entry === wanted).length;
    }, path);
    if (count < 0) throw new Error('no read log on this page: it was not loaded through the harness');
    return count;
  }

  /**
   * Wait until the page has read `count` responses to exactly this path.
   *
   * The check is itself a task in the page, so by the time it sees the read
   * every microtask that read released has run: the reader's continuation, the
   * state it set, and the render that followed, since Lit updates in
   * microtasks. Work the app deferred to a timer or a later request is NOT
   * covered; a test that depends on it waits for that work's own result.
   */
  async waitUntilRead(path: string, count: number): Promise<void> {
    await expect
      .poll(() => this.readCount(path), { message: `responses to ${path} the page has read` })
      .toBeGreaterThanOrEqual(count);
  }

  /** Teardown: a request still held when the test ends is abandoned, not answered. */
  abandonHeld(): void {
    for (const gate of this.gates) gate.abandon();
  }

  async install(): Promise<void> {
    await this.page.addInitScript(() => {
      const target = window as unknown as { __ddHarnessRead?: string[] };
      if (target.__ddHarnessRead !== undefined) return;
      const read: string[] = [];
      target.__ddHarnessRead = read;
      const original = Response.prototype.json;
      Response.prototype.json = function json(this: Response): Promise<unknown> {
        const promise = original.call(this) as Promise<unknown>;
        let path = this.url;
        try {
          const parsed = new URL(this.url);
          path = `${parsed.pathname}${parsed.search}`;
        } catch {
          // A response with no URL is noted as it is.
        }
        // Registered before the caller's own reaction, so the note is taken
        // first and the caller's continuation runs in the same checkpoint.
        const note = (): void => {
          read.push(path);
        };
        promise.then(note, note);
        return promise;
      };
    });

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
        const path = `${url.pathname}${url.search}`;
        this.apiCalls.push(path);
        let body: unknown = null;
        try {
          const raw = request.postData();
          if (raw !== null && raw !== '') body = JSON.parse(raw);
        } catch {
          // Not JSON. Recorded as null rather than guessed at.
        }
        this.requests.push({
          method: request.method(),
          path,
          body,
          idempotencyKey: request.headers()['x-idempotency-key'] ?? null,
        });
        const handler = this.resolve(url.pathname);
        if (handler === undefined) {
          this.violations.push(
            `unstubbed API request: ${request.method()} ${url.pathname}${url.search}`
          );
          await this.safeAbort(route);
          return;
        }
        const stub = typeof handler === 'function' ? handler(url, request.method()) : handler;
        const ticket = stub.gate?.hold(path, () => request.failure() !== null);
        if (ticket !== undefined && !(await ticket.released)) {
          // Abandoned at teardown. Aborted rather than answered: an answer
          // delivered while the test is being torn down could set off requests
          // that nothing stubbed, and fail a test that had already passed.
          await this.safeAbort(route);
          ticket.settle(false);
          return;
        }
        if (stub.delayMs !== undefined && stub.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, stub.delayMs));
        }
        let delivered = false;
        try {
          await route.fulfill({
            status: stub.status ?? 200,
            contentType: stub.contentType ?? 'application/json',
            body: stub.raw ?? JSON.stringify(stub.body ?? null),
          });
          delivered = true;
        } catch {
          // The page navigated away while this was in flight. Not a violation.
        }
        ticket?.settle(delivered);
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

interface HeldRequest {
  path: string;
  letGo: (answer: boolean) => void;
  delivered: Promise<boolean>;
  /** Whether the page gave up on this request while it was held. */
  cancelled: () => boolean;
}

/** What the harness holds on to while a request waits at a gate. */
export interface HeldTicket {
  /** True when the test released it, false when the test ended first. */
  released: Promise<boolean>;
  /** Whether the answer actually reached the page. */
  settle: (delivered: boolean) => void;
}

/**
 * Responses the test lets go of by hand, in the order it chooses.
 *
 * For the races a control surface has to survive, the order two answers land
 * in is the whole test. A delay cannot state an order -- only that one answer
 * is slower -- and a wait after it proves only that time passed. So a request
 * that reaches a gated stub waits until `release()`, and `release()` returns
 * only once the page has READ that response: an assertion written after it
 * describes the page after the answer, not a page the answer is still on its
 * way to.
 */
export class ResponseGate {
  private readonly queue: HeldRequest[] = [];

  constructor(private readonly app: AppHarness) {}

  /** The requests waiting here, oldest first, as pathname and query. */
  get held(): string[] {
    return this.queue.map((entry) => entry.path);
  }

  /** Called by the harness when a request reaches a stub carrying this gate. */
  hold(path: string, cancelled: () => boolean = () => false): HeldTicket {
    let letGo: (answer: boolean) => void = () => undefined;
    let settle: (delivered: boolean) => void = () => undefined;
    const released = new Promise<boolean>((resolve) => {
      letGo = resolve;
    });
    const delivered = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    this.queue.push({ path, letGo, delivered, cancelled });
    return { released, settle };
  }

  /**
   * Whether the page has cancelled the held request for exactly `path`.
   *
   * A page that abandons a read -- the poll controller does, whenever the query
   * moves on -- never reads the answer, so there is nothing to wait for. This is
   * how a test says that is what happened, rather than waiting out a timeout and
   * calling the silence a pass.
   */
  cancelled(path: string): boolean {
    return this.queue.some((entry) => entry.path === path && entry.cancelled());
  }

  /** Wait until at least `count` requests are being held. */
  async waitForHeld(count = 1): Promise<void> {
    await expect
      .poll(() => this.queue.length, { message: `requests held at the gate (want ${count})` })
      .toBeGreaterThanOrEqual(count);
  }

  /**
   * Answer one held request -- the oldest, or the one for exactly `path` --
   * and return once the page has read it.
   *
   * Releasing something that is not held is an error: a test that meant to
   * order two answers and ordered none would otherwise pass on whatever order
   * they happened to arrive in.
   */
  async release(path?: string): Promise<void> {
    const index = path === undefined ? 0 : this.queue.findIndex((entry) => entry.path === path);
    const entry = index < 0 ? undefined : this.queue[index];
    if (entry === undefined) {
      const held = this.queue.length === 0 ? 'nothing' : this.held.join(', ');
      throw new Error(`nothing to release${path === undefined ? '' : ` for ${path}`}; held: ${held}`);
    }
    this.queue.splice(index, 1);
    if (entry.cancelled()) {
      entry.letGo(false);
      throw new Error(`the page cancelled its request to ${entry.path} while it was held`);
    }
    const before = await this.app.readCount(entry.path);
    entry.letGo(true);
    if (!(await entry.delivered)) {
      throw new Error(`the answer to ${entry.path} did not reach the page: it navigated away while held`);
    }
    await this.app.waitUntilRead(entry.path, before + 1);
  }

  /** Let every waiting request go unanswered. For teardown. */
  abandon(): void {
    for (const entry of this.queue.splice(0)) entry.letGo(false);
  }
}

export const test = base.extend<{ app: AppHarness }>({
  app: async ({ page, baseURL }, use) => {
    if (baseURL === undefined) throw new Error('baseURL is not configured for this project');
    const app = new AppHarness(page, new URL(baseURL).origin);
    await app.install();
    await use(app);
    app.abandonHeld();
    app.assertNoViolations();
  },
});

export { expect };
