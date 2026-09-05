import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { apiWith, type Api } from './api.js';
import { isAbortError } from './errors.js';

/**
 * One place where every page's polling lives.
 *
 * Thirteen pages and the shell each kept their own `setInterval`, and all of
 * them got the same three things wrong:
 *
 *   - **A hidden tab kept polling.** A background tab asked the server for the
 *     whole chainlock report every minute forever. Nobody was reading it.
 *   - **Nothing cancelled a superseded request.** Change a filter and two
 *     requests are in flight; whichever answers last wins, so a slow answer to
 *     the *previous* filter overwrote the page the reader had just asked for.
 *     That is not a rare race on this site: several endpoints are heavy enough
 *     to be rate-limited, and the heavy one is exactly the one being switched.
 *   - **A cancelled request looked like a failure.** `fetch` rejects on abort,
 *     the page's catch block put the message in the red bar, and the reader was
 *     told the server had broken when nothing had.
 *
 * A run therefore carries its own AbortSignal, its own bound API client, and a
 * `stale` flag that stays correct even when the call it awaited cannot be
 * aborted -- `stale` is the guard a page checks before assigning state.
 */
export interface PollRun {
  /** The API surface bound to this run: cancelled when the run is superseded. */
  readonly api: Api;
  readonly signal: AbortSignal;
  /** True once a newer run has started, or the controller has stopped. */
  readonly stale: boolean;
  /** 1 for the first run of this controller; only ordering matters. */
  readonly seq: number;
}

/** `document`, or a stand-in in tests. */
export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface PollOptions {
  /** How often to repeat, while the tab is visible. */
  intervalMs: number;
  load: (run: PollRun) => Promise<void> | void;
  /**
   * Injected by tests. `null` disables visibility handling entirely, which is
   * what happens anyway where there is no document.
   */
  visibility?: VisibilitySource | null;
}

function defaultVisibility(): VisibilitySource | null {
  return typeof document === 'undefined' ? null : document;
}

export class PollController implements ReactiveController {
  private readonly options: PollOptions;
  private readonly visibility: VisibilitySource | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private abort: AbortController | null = null;
  private seq = 0;
  private started = false;

  constructor(host: ReactiveControllerHost, options: PollOptions) {
    this.options = options;
    this.visibility = options.visibility === undefined ? defaultVisibility() : options.visibility;
    host.addController(this);
  }

  hostConnected(): void {
    this.start();
  }

  hostDisconnected(): void {
    this.stop();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.visibility?.addEventListener('visibilitychange', this.onVisibility);
    // The first load happens even in a hidden tab: it is what the page renders
    // when it is first looked at, and skipping it would leave "Loading…" on
    // screen until something else moved.
    this.refresh();
  }

  /**
   * Load now and restart the clock. What a page calls when the reader changes
   * a filter -- the point at which the superseded request must be cancelled.
   */
  refresh(): void {
    this.tick();
    if (this.visibility?.hidden !== true) this.arm();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.visibility?.removeEventListener('visibilitychange', this.onVisibility);
    this.disarm();
    // Bumping the sequence is what makes everything still in flight stale, so
    // a late answer cannot write into a page that has been navigated away from.
    this.seq += 1;
    this.abort?.abort();
    this.abort = null;
  }

  private readonly onVisibility = (): void => {
    if (!this.started) return;
    if (this.visibility?.hidden === true) {
      // Stop the clock, but leave the in-flight request alone: it is already
      // paid for, and its answer is the freshest thing this page will have.
      this.disarm();
      return;
    }
    // Back in view. Whatever is on screen is as old as the tab was hidden.
    this.refresh();
  };

  private tick(): void {
    this.seq += 1;
    const seq = this.seq;
    const current = (): number => this.seq;

    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;

    const run: PollRun = {
      api: apiWith(controller.signal),
      signal: controller.signal,
      seq,
      get stale(): boolean {
        return seq !== current();
      },
    };

    void (async () => {
      try {
        await this.options.load(run);
      } catch (error) {
        if (isAbortError(error) || run.stale) return;
        // A page reports its own failures; anything reaching here escaped its
        // handler, and swallowing it silently is how a dead page looks healthy.
        console.error('[poll] load failed', error);
      }
    })();
  }

  private arm(): void {
    this.disarm();
    this.timer = setInterval(() => this.tick(), this.options.intervalMs);
  }

  private disarm(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
