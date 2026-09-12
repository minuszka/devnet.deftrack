import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { api, ApiError, type HealthSnapshot } from '../lib/api.js';
import {
  adminApi,
  type ActiveSimulationRun,
  type AdminSession,
  type PublicSimulationRun,
  type DryRunPlan,
  type RecoveryReportView,
  type ScenarioSummary,
  type SimulationCapabilities,
  type SimulationControlRun,
  type SimulationPreflight,
  type SimulationHistory,
  type SimulationTarget,
} from '../lib/admin-api.js';
import { num } from '../lib/format.js';
import { isAbortError } from '../lib/errors.js';
import { PollController, type PollRun } from '../lib/poll.js';
import { acceptsRunUpdate } from '../lib/simulationRunState.js';
import {
  adminHref,
  decideSelection,
  isRunKey,
  runKeyFromSearch,
} from '../lib/adminRunSelection.js';
import { baseStyles, cardStyles, controlStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-simulation-control.js';

/** The dashboard's own tables: targets, the run list, the allowlist. */
const REFRESH_MS = 30_000;
/**
 * The selected run's status, while it is still going.
 *
 * Faster than the dashboard because it is the thing an operator is watching,
 * and cheap because it asks for one run rather than five collections. Stops on
 * a terminal status: a completed run does not change again, and polling it for
 * ever is load with no reader.
 */
const RUN_STATUS_MS = 5_000;

/** Statuses a run never leaves, so there is nothing left to poll for. */
const TERMINAL = new Set(['completed', 'aborted', 'rejected', 'expired']);

function dateTime(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function shortKey(value: string): string {
  return value.length > 20 ? `${value.slice(0, 16)}…` : value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The dashboard could not be refreshed.';
}

/**
 * The day-10 browser surface is intentionally observational.  It may create
 * and revoke its own session, but it exposes no scenario or fault controls;
 * those require the two-step confirmation work of day 11.
 */
export class DdAdminShell extends LitElement {
  static override properties = {
    _screen: { state: true },
    _session: { state: true },
    _health: { state: true },
    _targets: { state: true },
    _activeRuns: { state: true },
    _runs: { state: true },
    _scenarios: { state: true },
    _capabilities: { state: true },
    _history: { state: true },
    _selectedRunKey: { state: true },
    _badRunKey: { state: true },
    _selectedRun: { state: true },
    _selectedPlan: { state: true },
    _selectedRecovery: { state: true },
    _selectedPreflight: { state: true },
    _loading: { state: true },
    _message: { state: true },
  };

  private _screen: 'checking' | 'signed-out' | 'unavailable' | 'ready' = 'checking';
  private _session: AdminSession | null = null;
  private _health: HealthSnapshot | null = null;
  private _targets: SimulationTarget[] = [];
  private _activeRuns: ActiveSimulationRun[] = [];
  private _runs: PublicSimulationRun[] = [];
  private _scenarios: ScenarioSummary[] = [];
  /** Undefined until the server has answered; absent from an older server. */
  private _capabilities: SimulationCapabilities | undefined = undefined;
  /** The selected run's status: interval, visibility and cancellation in one. */
  private readonly _runPoll = new PollController(this, {
    intervalMs: RUN_STATUS_MS,
    load: (poll) => this._pollSelectedRun(poll),
  });
  private _history: SimulationHistory | null = null;
  private _selectedRunKey: string | null = null;
  /**
   * The one copy of the selected run, and the only thing allowed to refresh it.
   *
   * The control panel used to hold its own, loaded once and never renewed, so
   * the run list could show `recovery` while the panel beside it still offered
   * to start a run that had finished. One owner; the list, the controls and the
   * timeline all read from here.
   */
  private _selectedRun: SimulationControlRun | null = null;
  private _selectedPlan: DryRunPlan | null = null;
  private _selectedRecovery: RecoveryReportView | null = null;
  private _selectedPreflight: SimulationPreflight | null = null;
  /**
   * A run key in the URL that is not a run key.
   *
   * Held rather than swallowed: the alternative is falling through to another
   * run, which puts an Abort button for something the operator never asked for
   * on their screen.
   */
  private _badRunKey: string | null = null;
  private _onPopState = (): void => {
    void this._applyUrlSelection();
  };
  private _loading = false;
  private _message = '';
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    controlStyles,
    pageStyles,
    tableStyles,
    css`
      :host {
        display: block;
        max-width: var(--content-max);
        margin: 0 auto;
        padding: 0 var(--gutter) var(--sp-7);
      }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--sp-3);
        padding: var(--sp-3) 0;
        border-bottom: 1px solid var(--line-soft);
      }
      .private {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 5px 9px;
        color: var(--warn);
        border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
        background: var(--warn-wash);
        border-radius: var(--radius);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .private::before { content: '•'; font-size: 18px; line-height: 0; }
      .identity { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
      .subject { color: var(--ink-2); font-size: var(--fs-sm); }
      header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--sp-4);
        padding: var(--sp-5) 0 var(--sp-4);
      }
      .brand {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--fs-xl);
        line-height: 1.15;
        letter-spacing: 0.02em;
      }
      .brand .dim { color: var(--ink-3); font-weight: 400; }
      .readonly {
        max-width: 800px;
        color: var(--ink-2);
        font-size: var(--fs-sm);
        margin: var(--sp-2) 0 0;
      }
      .head-actions { display: flex; gap: var(--sp-2); align-items: center; }
      .gate {
        width: min(620px, 100%);
        margin: clamp(72px, 15vh, 180px) auto;
      }
      .gate .card-body { display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-4); }
      .gate h1 { margin: 0; font-size: var(--fs-xl); }
      .gate p { margin: 0; color: var(--ink-2); line-height: 1.6; }
      .note {
        padding: var(--sp-3) var(--sp-4);
        border: 1px solid color-mix(in srgb, var(--info) 45%, transparent);
        background: var(--info-wash);
        color: var(--ink-2);
        font-size: var(--fs-sm);
      }
      .alert {
        padding: var(--sp-3) var(--sp-4);
        border: 1px solid color-mix(in srgb, var(--crit) 45%, transparent);
        background: var(--crit-wash);
        color: var(--ink);
        font-size: var(--fs-sm);
      }
      .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--sp-3); }
      .metric {
        padding: var(--sp-4);
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: var(--radius-md);
      }
      .metric .label {
        color: var(--ink-3);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .metric .value {
        margin-top: var(--sp-2);
        color: var(--ink);
        font-family: var(--font-mono);
        font-size: var(--fs-lg);
        font-variant-numeric: tabular-nums;
      }
      .metric .value.warn { color: var(--warn); }
      .metric .value.bad { color: var(--crit); }
      .metric .sub { margin-top: 2px; color: var(--ink-3); font-size: var(--fs-xs); }
      .grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.85fr); gap: var(--sp-4); }
      .wide { grid-column: 1 / -1; }
      .timeline { list-style: none; margin: 0; padding: 0; }
      .timeline li {
        display: grid;
        grid-template-columns: 12px minmax(130px, auto) 1fr;
        gap: var(--sp-3);
        align-items: baseline;
        padding: 11px var(--sp-4);
        border-bottom: 1px solid var(--line-soft);
        font-size: var(--fs-sm);
      }
      .timeline li:last-child { border-bottom: none; }
      .timeline i { width: 8px; height: 8px; background: var(--accent); display: block; }
      .timeline .when { color: var(--ink-3); font-family: var(--font-mono); font-size: var(--fs-xs); }
      .timeline .event { font-family: var(--font-mono); color: var(--ink); }
      .timeline .transition { color: var(--ink-2); margin-left: var(--sp-2); }
      .run-button {
        padding: 0;
        background: none;
        color: var(--accent);
        font: inherit;
        text-align: left;
        border: none;
        cursor: pointer;
      }
      .run-button:hover { color: var(--accent-strong); text-decoration: underline; text-underline-offset: 3px; }
      .run-button[aria-current='true'] { color: var(--ink); font-weight: 700; }
      .empty { white-space: normal; }
      @media (max-width: 1000px) { .grid { grid-template-columns: 1fr; } }
      @media (max-width: 640px) {
        .timeline li { grid-template-columns: 12px 1fr; }
        .timeline .when { grid-column: 2; grid-row: 2; }
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    document.title = 'devnet.deftrack — Admin';
    window.addEventListener('popstate', this._onPopState);
    void this._restoreSession();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('popstate', this._onPopState);
    if (this._timer !== null) clearInterval(this._timer);
  }

  /**
   * Put the selection in the address bar, so a reload, a second tab and a
   * pasted link all reach the same run.
   *
   * `replace` for a correction the reader did not ask for -- adopting the live
   * slot, or clearing a key that turned out not to exist -- and `push` for a
   * choice they made, so Back returns to what they were looking at.
   */
  private _writeUrl(runKey: string | null, mode: 'push' | 'replace'): void {
    const href = adminHref(runKey);
    if (href === `${location.pathname}${location.search}`) return;
    if (mode === 'push') history.pushState(null, '', href);
    else history.replaceState(null, '', href);
  }

  /** Read the URL and act on it. The one place a selection is decided. */
  private async _applyUrlSelection(): Promise<void> {
    const decision = decideSelection({
      urlRunKey: runKeyFromSearch(location.search),
      heldRunKey: null,
      activeRunKeys: this._activeRuns.map((entry) => entry.runKey),
    });
    this._badRunKey = decision.malformedRunKey;
    if (decision.runKey === null) {
      this._clearSelection();
      return;
    }
    if (decision.runKey === this._selectedRunKey && this._history !== null) return;
    await this._loadSelectedRun(decision.runKey);
  }

  private async _restoreSession(): Promise<void> {
    this._screen = 'checking';
    this._message = '';
    try {
      this._session = await adminApi.session();
      this._screen = 'ready';
      this._startRefresh();
      await this._loadDashboard();
    } catch (error) {
      this._session = null;
      if (error instanceof ApiError && error.status === 401) {
        this._screen = 'signed-out';
      } else {
        this._screen = 'unavailable';
        this._message = messageOf(error);
      }
    }
  }

  private _startRefresh(): void {
    if (this._timer !== null) clearInterval(this._timer);
    this._timer = window.setInterval(() => void this._loadDashboard(), REFRESH_MS);
  }

  private async _signIn(): Promise<void> {
    this._loading = true;
    this._message = '';
    try {
      // The identity proxy has already authenticated the browser. This exchange
      // only asks the server to mint the HttpOnly, path-scoped session cookie.
      this._session = await adminApi.signIn();
      this._screen = 'ready';
      this._startRefresh();
      await this._loadDashboard();
    } catch {
      // Do not repeat the sign-in endpoint's distinction between an unknown
      // subject, proxy and disabled deployment in the page itself.
      this._screen = 'signed-out';
      this._message = 'Sign-in was not accepted. Use the approved identity proxy or contact an administrator.';
    } finally {
      this._loading = false;
    }
  }

  private async _signOut(): Promise<void> {
    const session = this._session;
    if (session === null) return;
    this._loading = true;
    try {
      await adminApi.signOut(session.csrfToken);
    } catch {
      // A timed-out server session has the same safe client outcome as a
      // successful sign-out: discard the only in-memory credential.
    } finally {
      this._session = null;
      this._health = null;
      this._targets = [];
      this._activeRuns = [];
      this._runs = [];
      this._scenarios = [];
      this._capabilities = undefined;
      this._history = null;
      this._selectedRun = null;
      this._selectedPlan = null;
      this._selectedRecovery = null;
      this._selectedPreflight = null;
      this._selectedRunKey = null;
      this._badRunKey = null;
      // The key is not a secret, but leaving it in the address bar of a
      // signed-out browser invites the next person to reload into it.
      this._writeUrl(null, 'replace');
      this._screen = 'signed-out';
      this._loading = false;
      if (this._timer !== null) clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _loadDashboard(): Promise<void> {
    if (this._session === null || this._loading) return;
    this._loading = true;
    // Cleared here, before the work, and not after it.
    //
    // It used to be cleared at the end, which wiped whatever the selection load
    // inside this same function had just reported -- so "no run sim_… exists on
    // this deployment" appeared and vanished in the same tick, and the only
    // reason anyone saw it at all was that the control panel happened to print
    // its own copy. It does not any more, and the message stayed invisible
    // until a test caught it.
    this._message = '';
    try {
      const [health, targets, activeRuns, runs, scenarios] = await Promise.all([
        api.health(),
        adminApi.targets(),
        adminApi.activeRuns(),
        adminApi.runs(),
        adminApi.scenarios(),
      ]);
      this._health = health;
      this._targets = targets.items;
      this._activeRuns = activeRuns.items;
      this._runs = runs.items;
      this._scenarios = scenarios.items;
      this._capabilities = scenarios.capabilities;

      /*
       * The selection is decided, not recomputed.
       *
       * This used to read `activeRuns[0]?.runKey ?? selected`, so every refresh
       * moved the panel to the first active run: choose run B, wait thirty
       * seconds, and the Abort button on screen belonged to run A. The held
       * selection now wins over the live slot, and the live slot is adopted
       * only when nothing is selected at all.
       */
      const decision = decideSelection({
        urlRunKey: runKeyFromSearch(location.search),
        heldRunKey: this._selectedRunKey,
        activeRunKeys: this._activeRuns.map((entry) => entry.runKey),
      });
      this._badRunKey = decision.malformedRunKey;
      if (decision.runKey === null) {
        this._clearSelection();
      } else if (decision.runKey !== this._selectedRunKey || this._history === null) {
        await this._loadSelectedRun(decision.runKey);
        // A run adopted rather than asked for is a correction, not a choice.
        // Replace, not push: neither adopting the live slot nor confirming
        // what the URL already said is a step the reader chose to take.
        this._writeUrl(this._selectedRunKey, 'replace');
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this._endSession('Your session ended. Sign in again to view the private dashboard.');
      } else {
        this._message = messageOf(error);
      }
    } finally {
      this._loading = false;
    }
  }

  /**
   * Everything about one run, fetched together.
   *
   * The plan and the recovery evidence are read here and not on every tick:
   * the plan is immutable and the evidence changes only when a recovery runs,
   * so re-reading them five times a minute would be load without information.
   * The status poll below renews the part that moves.
   */
  private async _loadHistory(runKey: string): Promise<void> {
    this._selectedRunKey = runKey;
    const [detail, history, recovery] = await Promise.all([
      adminApi.dryRun(runKey),
      adminApi.history(runKey),
      // Evidence that is merely unavailable must never read as "clear".
      adminApi.recovery(runKey).then((r) => r.recovery).catch(() => null),
    ]);
    if (this._selectedRunKey !== runKey) return;
    this._selectedRun = detail.run;
    this._selectedPlan = detail.plan;
    this._selectedRecovery = recovery;
    this._selectedPreflight = null;
    this._history = history;
  }

  /**
   * One status request at a time, for the run on screen, while it is still
   * moving and the tab is being looked at.
   *
   * The controller supplies all three: the interval, the visibility handling
   * and the abort of whatever the previous tick left in flight. A late answer
   * is refused on the server's own revision rather than on arrival order.
   */
  private async _pollSelectedRun(poll: PollRun): Promise<void> {
    const runKey = this._selectedRunKey;
    const held = this._selectedRun;
    if (runKey === null || this._session === null) return;
    if (held !== null && TERMINAL.has(held.state.status)) return;
    try {
      const run = await adminApi.run(runKey, poll.signal);
      if (poll.stale || this._selectedRunKey !== runKey) return;
      this._acceptRun(run);
    } catch (error) {
      if (isAbortError(error) || poll.stale) return;
      if (error instanceof ApiError && error.status === 401) {
        this._endSession('Your session ended. Sign in again to view the private dashboard.');
        return;
      }
      // A failed status read leaves the selection and the last good run alone.
      // Clearing either would take the controls away from a live fault because
      // one request timed out.
      this._message = messageOf(error);
    }
  }

  /**
   * Take a run update if it is newer than what is held, and say nothing
   * otherwise.
   *
   * The rule is the server's revision, shared with the control panel so the two
   * cannot disagree about which answer is the current one.
   */
  private _acceptRun(run: SimulationControlRun): boolean {
    if (run.runKey !== this._selectedRunKey) return false;
    if (!acceptsRunUpdate(this._selectedRun, run)) return false;
    this._selectedRun = run;
    return true;
  }

  /**
   * A mutation answered. Reconcile at once rather than waiting for the tick.
   *
   * The response is the freshest description of the run there is, and the
   * operator has just acted: making them watch a stale panel for five seconds
   * is how a second click happens.
   */
  private _onRunUpdated(event: CustomEvent<{ run: SimulationControlRun; preflight?: SimulationPreflight }>): void {
    const { run, preflight } = event.detail;
    if (!this._acceptRun(run)) return;
    // "not run" and "passed" are different answers: only a preflight the server
    // actually produced is stored, and an idempotent replay that carries none
    // leaves the previous one alone.
    if (preflight !== undefined) this._selectedPreflight = preflight;
    void this._loadHistoryOnly(run.runKey);
  }

  /** The audit trail alone, after an action that will have added to it. */
  private async _loadHistoryOnly(runKey: string): Promise<void> {
    try {
      const history = await adminApi.history(runKey);
      if (this._selectedRunKey === runKey) this._history = history;
    } catch {
      // The timeline is a record, not a control. A failure to refresh it must
      // not disturb the run on screen.
    }
  }

  private _clearSelection(): void {
    this._selectedRunKey = null;
    this._selectedRun = null;
    this._selectedPlan = null;
    this._selectedRecovery = null;
    this._selectedPreflight = null;
    this._history = null;
  }

  /** One place to drop everything private, whatever ended the session. */
  private _endSession(message: string): void {
    this._session = null;
    this._screen = 'signed-out';
    this._message = message;
    this._selectedRun = null;
    this._selectedPlan = null;
    this._selectedRecovery = null;
    this._selectedPreflight = null;
    this._history = null;
  }

  private _selectRun(runKey: string): void {
    if (this._selectedRunKey === runKey && this._history !== null) return;
    this._message = '';
    this._badRunKey = null;
    // The address bar first: a choice the operator made is one Back should
    // return from, and one a reload must reproduce.
    this._writeUrl(runKey, 'push');
    void this._loadSelectedRun(runKey);
  }

  /**
   * Load one run, and fail visibly rather than falling back.
   *
   * A key that does not resolve is an error about that key. Silently selecting
   * something else would leave the operator looking at -- and able to abort --
   * a run they never named.
   */
  private async _loadSelectedRun(runKey: string): Promise<void> {
    this._loading = true;
    // Held while the request is in flight, so the panel shows which run it is
    // waiting for rather than the previous one.
    this._selectedRunKey = runKey;
    try {
      await this._loadHistory(runKey);
      this._message = '';
    } catch (error) {
      this._history = null;
      this._selectedRun = null;
      this._selectedPlan = null;
      this._selectedRecovery = null;
      if (error instanceof ApiError && error.status === 404) {
        this._message = `No run ${runKey} exists on this deployment.`;
      } else if (error instanceof ApiError && error.status === 401) {
        this._endSession('Your session ended. Sign in again to view the private dashboard.');
      } else {
        this._message = messageOf(error);
      }
    } finally {
      this._loading = false;
    }
  }

  override render(): TemplateResult {
    switch (this._screen) {
      case 'checking':
        return this._gate('Checking your admin session', 'The private dashboard is verifying its server-side session.');
      case 'signed-out':
        return this._signInGate();
      case 'unavailable':
        return this._unavailableGate();
      case 'ready':
        return this._dashboard();
    }
  }

  private _gate(title: string, description: string): TemplateResult {
    return html`
      <section class="gate card" aria-live="polite">
        <div class="card-head"><div class="card-title">Private admin area</div></div>
        <div class="card-body"><h1>${title}</h1><p>${description}</p></div>
      </section>
    `;
  }

  private _signInGate(): TemplateResult {
    return html`
      <section class="gate card" aria-live="polite">
        <div class="card-head"><div class="card-title">Private admin area</div></div>
        <div class="card-body">
          <h1>Admin access</h1>
          <p>
            This dashboard is available only through the approved identity proxy. No administrator API key or infrastructure credential is used by the browser.
          </p>
          ${this._message ? html`<div class="alert" role="alert">${this._message}</div>` : nothing}
          <button class="btn primary" ?disabled=${this._loading} @click=${this._signIn}>
            ${this._loading ? 'Signing in…' : 'Continue to admin dashboard'}
          </button>
          <a href="/">Return to the public explorer</a>
        </div>
      </section>
    `;
  }

  private _unavailableGate(): TemplateResult {
    return html`
      <section class="gate card" aria-live="polite">
        <div class="card-head"><div class="card-title">Private admin area</div></div>
        <div class="card-body">
          <h1>Admin access is unavailable</h1>
          <p>The identity-proxy session endpoint could not be reached or is not configured for this deployment.</p>
          <div class="alert" role="alert">${this._message}</div>
          <button class="btn" ?disabled=${this._loading} @click=${this._restoreSession}>Try again</button>
          <a href="/">Return to the public explorer</a>
        </div>
      </section>
    `;
  }

  private _dashboard(): TemplateResult {
    const session = this._session!;
    const enabled = this._targets.filter((target) => target.enabled).length;
    const maintenance = this._targets.filter((target) => target.maintenance).length;
    const active = this._activeRuns[0] ?? null;
    const faultMayBeActive = this._history?.run.state.faultMayBeActive ?? false;

    return html`
      <div class="topbar">
        <span class="private">Private administration</span>
        <div class="identity">
          <span class="subject">${session.subject}</span>
          <span class="pill accent">${session.role}</span>
          <button class="btn" ?disabled=${this._loading} @click=${this._signOut}>Sign out</button>
        </div>
      </div>
      <header>
        <div>
          <h1 class="brand">devnet<span class="dim">.deftrack</span> / admin</h1>
          <p class="readonly">
            Every change is CSRF-protected, idempotent and server-authorized. The plan is previewed and preflighted before risk acknowledgement; a live start needs a second explicit confirmation.
          </p>
        </div>
        <div class="head-actions"><button class="btn" ?disabled=${this._loading} @click=${this._loadDashboard}>Refresh</button></div>
      </header>

      ${this._badRunKey !== null
        ? html`<div class="alert" role="alert">
            The address asked for a run called <b class="mono">${this._badRunKey}</b>, which is not
            a run key. Nothing was selected — choose a run below rather than assuming this one.
          </div>`
        : nothing}
      ${this._message ? html`<div class="alert" role="alert">${this._message}</div>` : nothing}
      <section class="metrics" aria-label="Orchestrator summary">
        ${this._metric('Explorer', this._health?.status ?? 'unknown', this._health ? `tip ${num(this._health.chainTip)}` : 'health unavailable', this._health?.status === 'ok' ? '' : 'warn')}
        ${this._metric('Registered targets', `${num(enabled)} / ${num(this._targets.length)}`, `${num(maintenance)} in maintenance`, '')}
        ${this._metric('Allowed scenarios', num(this._scenarios.length), 'registry allowlist', '')}
        ${this._metric('Live slot', active ? shortKey(active.runKey) : 'clear', active ? active.status : 'no active live run', active ? (faultMayBeActive ? 'bad' : 'warn') : '')}
      </section>

      <div class="grid">
        <dd-simulation-control
          class="wide"
          .session=${session}
          .scenarios=${this._scenarios}
          .capabilities=${this._capabilities}
          .selectedRunKey=${this._selectedRunKey}
          .run=${this._selectedRun}
          .plan=${this._selectedPlan}
          .recovery=${this._selectedRecovery}
          .preflight=${this._selectedPreflight}
          @simulation-changed=${this._loadDashboard}
          @run-selected=${(event: CustomEvent<{ runKey: string }>) => this._selectRun(event.detail.runKey)}
          @run-updated=${this._onRunUpdated}
        ></dd-simulation-control>
        ${this._runsCard()}
        ${this._timelineCard()}
        ${this._targetsCard()}
      </div>
    `;
  }

  private _metric(label: string, value: string, sub: string, tone: string): TemplateResult {
    return html`
      <div class="metric">
        <div class="label">${label}</div>
        <div class="value ${tone}">${value}</div>
        <div class="sub">${sub}</div>
      </div>
    `;
  }

  private _runsCard(): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Simulation runs</div>
          <div class="page-sub mono">latest ${num(this._runs.length)}</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">Simulation runs and the state each is in.</caption>
              <thead><tr><th scope="col">Run</th><th scope="col">Scenario</th><th scope="col" class="c">State</th><th scope="col" class="c">Mode</th><th scope="col" class="r">Entered</th></tr></thead>
              <tbody>
                ${this._runs.length === 0
                  ? html`<tr><td class="empty" colspan="5">No simulation run has been recorded.</td></tr>`
                  : this._runs.map((run) => html`
                      <tr>
                        <td class="mono"><button class="run-button" aria-current=${this._selectedRunKey === run.runKey ? 'true' : 'false'} @click=${() => this._selectRun(run.runKey)}>${shortKey(run.runKey)}</button></td>
                        <td>${run.scenario.title}</td>
                        <td class="c"><span class="pill ${run.state.status}">${run.state.status}</span></td>
                        <td class="c">${run.state.live ? 'live' : 'dry-run'}</td>
                        <td class="r mono">${dateTime(run.state.stateEnteredAtMs)}</td>
                      </tr>
                    `)}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  private _timelineCard(): TemplateResult {
    const history = this._history;
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Action timeline</div>
          <div class="page-sub mono">${history ? shortKey(history.run.runKey) : 'select a run'}</div>
        </div>
        ${history === null
          ? html`<div class="empty">Select a recorded run to view its append-only control timeline.</div>`
          : html`
              <ul class="timeline">
                ${[...history.audit]
                  .sort((a, b) => a.sequence - b.sequence)
                  .map((event) => html`
                    <li>
                      <i aria-hidden="true"></i>
                      <span class="when">${dateTime(event.atMs)}</span>
                      <span><span class="event">${event.eventType}</span>${event.fromStatus || event.toStatus ? html`<span class="transition">${event.fromStatus ?? '—'} → ${event.toStatus ?? '—'}</span>` : nothing}</span>
                    </li>
                  `)}
              </ul>
            `}
      </section>
    `;
  }

  private _targetsCard(): TemplateResult {
    return html`
      <section class="card wide">
        <div class="card-head">
          <div class="card-title">Execution registry</div>
          <div class="page-sub mono">private target inventory</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">The execution registry: which targets exist and whether each is enabled.</caption>
              <thead><tr><th scope="col">Target</th><th scope="col">Role</th><th scope="col">Network</th><th scope="col">Host</th><th scope="col" class="c">Enabled</th><th scope="col" class="c">Maintenance</th><th scope="col">Expected build</th></tr></thead>
              <tbody>
                ${this._targets.length === 0
                  ? html`<tr><td class="empty" colspan="7">No target is registered for simulation.</td></tr>`
                  : this._targets.map((target) => html`
                      <tr>
                        <td><strong>${target.displayLabel}</strong><span class="subtle mono"> · ${target.targetId}</span></td>
                        <td>${target.role}</td><td>${target.network}</td><td class="mono">${target.hostRef}</td>
                        <td class="c"><span class="pill ${target.enabled ? 'good' : 'muted'}">${target.enabled ? 'yes' : 'no'}</span></td>
                        <td class="c"><span class="pill ${target.maintenance ? 'warn' : 'muted'}">${target.maintenance ? 'yes' : 'no'}</span></td>
                        <td class="mono">${target.expectedBuild ?? '—'}</td>
                      </tr>
                    `)}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }
}

customElements.define('dd-admin-shell', DdAdminShell);
