import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import {
  adminApi,
  type AdminSession,
  type DryRunPlan,
  type RecoveryReportView,
  type ScenarioFieldSpec,
  type ScenarioSummary,
  type SimulationCapabilities,
  type SimulationControlRun,
  type SimulationPreflight,
} from '../lib/admin-api.js';

import { num } from '../lib/format.js';
import { draftScope } from '../lib/draftIdentity.js';
import { acceptsRunUpdate, runSafety } from '../lib/simulationRunState.js';
import { baseStyles, cardStyles, controlStyles, pageStyles, tableStyles } from '../styles/shared.js';

type Network = 'regtest' | 'devnet';
type Mode = 'dry-run' | 'live';

/*
 * There is no `PreparedRun` here any more.
 *
 * The panel used to hold its own copy of the selected run, loaded once when the
 * selection changed and never renewed. So the run list beside it could show
 * `recovery` while these controls still offered to start a run that had already
 * finished, and the only thing that ever corrected them was another selection.
 * The dashboard owns the run and refreshes it; this component renders what it
 * is given and reports what the server answered.
 */

/** What the panel may offer when the server has not said. Deliberately nothing. */
const NO_CAPABILITIES: SimulationCapabilities = {
  liveExecutorConfigured: false,
  liveNetworks: [],
};

function newSeed(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `panel-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newIdempotencyKey(operation: string): string {
  return `admin-panel:${operation}:${newSeed()}`;
}

function countdown(until: number | null, now: number): string {
  if (until === null) return '—';
  const seconds = Math.ceil((until - now) / 1_000);
  if (seconds <= 0) return 'expired — recovery is required';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')} remaining`;
}

function signedMargin(value: number | null): string {
  return value === null ? 'unknown' : `${value > 0 ? '+' : ''}${value}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The requested control operation did not complete.';
}

/**
 * Day-11 control surface. The server remains the source of truth for roles,
 * target allowlists, risk and transitions; this component only makes those
 * checks visible before it asks the already-guarded API to act.
 */
export class DdSimulationControl extends LitElement {
  static override properties = {
    session: { attribute: false },
    scenarios: { attribute: false },
    capabilities: { attribute: false },
    selectedRunKey: { attribute: false },
    run: { attribute: false },
    plan: { attribute: false },
    recovery: { attribute: false },
    preflight: { attribute: false },
    _scenarioId: { state: true },
    _network: { state: true },
    _mode: { state: true },
    _seed: { state: true },
    _params: { state: true },
    _paramsText: { state: true },
    _paramsError: { state: true },
    _advanced: { state: true },
    _riskAcknowledged: { state: true },
    _startAcknowledged: { state: true },
    _busy: { state: true },
    _message: { state: true },
    _now: { state: true },
  };

  session: AdminSession | null = null;
  scenarios: ScenarioSummary[] = [];
  /** Undefined until the server answers; an older server never sends it. */
  capabilities: SimulationCapabilities | undefined = undefined;
  /**
   * The run the dashboard is looking at, from the URL. Null while a new draft
   * is being written.
   *
   * A draft and a selected run are two different things, and conflating them is
   * what lost the Abort button: any edit to the form used to discard the
   * prepared run, so touching the seed field while a fault was live took its
   * recovery controls off the screen.
   */
  selectedRunKey: string | null = null;
  /** The selected run, owned and refreshed by the dashboard. */
  run: SimulationControlRun | null = null;
  /** Its saved, immutable plan. */
  plan: DryRunPlan | null = null;
  /** Recovery evidence, or null for "none recorded" -- never read as clear. */
  recovery: RecoveryReportView | null = null;
  /** A preflight the server actually produced. Null means not run. */
  preflight: SimulationPreflight | null = null;
  private _scenarioId = 'mn-stop';
  private _network: Network = 'regtest';
  private _mode: Mode = 'dry-run';
  private _seed = newSeed();
  /** Which scenario the parameter object was last filled from. */
  private _seededScenarioId: string | null = null;

  private _riskAcknowledged = false;
  private _startAcknowledged = false;
  /**
   * Which run the two acknowledgements below were given for.
   *
   * They were reset when a new plan was prepared and at no other time, so an
   * acknowledgement survived a change of selection: tick "I confirm this will
   * execute the approved fault" for run A, switch to run B, and B's start
   * button was already enabled with nobody having confirmed anything about B.
   * Keyed by run key rather than by the run object, because the status poll
   * replaces that object every few seconds and would otherwise clear the box
   * under the operator's hand.
   */
  private _acknowledgedRunKey: string | null = null;
  private _busy = false;
  private _message = '';
  private _now = Date.now();
  private _clock: number | null = null;
  /** One idempotency key per run-and-operation, kept until that one succeeds. */
  private readonly _retryKeys = new Map<string, string>();

  static override styles = [
    baseStyles,
    cardStyles,
    controlStyles,
    pageStyles,
    tableStyles,
    css`
      :host { display: block; }
      .control { display: flex; flex-direction: column; gap: var(--sp-4); }
      .intro { margin: 0; color: var(--ink-2); font-size: var(--fs-sm); line-height: 1.55; }
      .form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-3); padding: var(--sp-4); }
      label { display: flex; flex-direction: column; gap: 6px; color: var(--ink-2); font-size: var(--fs-sm); }
      label > span, .field-label { font-family: var(--font-mono); font-size: var(--fs-xs); font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-3); }
      .parameters { grid-column: 1 / -1; }
      .scenario-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-3); }
      .scenario-fields label.wide { grid-column: 1 / -1; }
      .field-range { color: var(--ink-3); font-family: var(--font-mono); font-size: var(--fs-xs); }
      .field-help { color: var(--ink-2); font-size: var(--fs-xs); line-height: 1.45; }
      .unit, .optional { color: var(--ink-3); font-style: normal; text-transform: none; letter-spacing: 0; }
      .seed-row { display: flex; gap: var(--sp-2); align-items: stretch; }
      .seed-row input { flex: 1; min-width: 0; }
      .disclosure { background: none; border: none; padding: 0; color: var(--ink-2); font-family: var(--font-mono); font-size: var(--fs-xs); letter-spacing: .09em; text-transform: uppercase; cursor: pointer; }
      .disclosure:hover { color: var(--ink); }
      @media (max-width: 900px) { .scenario-fields { grid-template-columns: 1fr; } }
      .notes { display: flex; flex-direction: column; gap: var(--sp-2); }
      textarea { width: 100%; min-height: 156px; resize: vertical; line-height: 1.5; }
      .form-foot { display: flex; justify-content: space-between; align-items: center; gap: var(--sp-3); flex-wrap: wrap; padding: 0 var(--sp-4) var(--sp-4); }
      .warning { color: var(--warn); font-size: var(--fs-sm); }
      .alert { padding: var(--sp-3) var(--sp-4); border: 1px solid color-mix(in srgb, var(--crit) 45%, transparent); background: var(--crit-wash); color: var(--ink); font-size: var(--fs-sm); }
      .notice { padding: var(--sp-3) var(--sp-4); border: 1px solid color-mix(in srgb, var(--info) 45%, transparent); background: var(--info-wash); color: var(--ink-2); font-size: var(--fs-sm); }
      .impact { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--line); border-bottom: 1px solid var(--line); }
      .impact > div { padding: var(--sp-3) var(--sp-4); background: var(--surface); }
      .impact b { display: block; margin-top: 4px; font-family: var(--font-mono); font-size: var(--fs-md); font-variant-numeric: tabular-nums; }
      .impact span { color: var(--ink-3); font-family: var(--font-mono); font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: .08em; }
      .check-list { list-style: none; margin: 0; padding: 0; }
      .check-list li { padding: 9px var(--sp-4); border-bottom: 1px solid var(--line-soft); font-size: var(--fs-sm); }
      .check-list li:last-child { border-bottom: none; }
      .check-list .failed { color: var(--crit); }
      .check-list .passed { color: var(--good); }
      .approval { display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-4); }
      .approval label { flex-direction: row; align-items: flex-start; color: var(--ink); cursor: pointer; }
      .approval input { margin-top: 4px; accent-color: var(--accent); }
      .actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
      /* The background is its own token: white on --crit is 3.23:1, and --crit
         has to stay bright because it is a text colour everywhere else. The
         border keeps --crit, so the button still reads as a shape. */
      .btn.danger { background: var(--btn-danger-bg); border-color: var(--crit); color: var(--btn-danger-fg); font-weight: 700; }
      .btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--btn-danger-bg) 85%, black); }
      .state-line { color: var(--ink-2); font-size: var(--fs-sm); }
      .state-line strong { color: var(--ink); }
      .countdown { color: var(--crit); font-family: var(--font-mono); font-weight: 700; }
      .recovery-ok { color: var(--good); }
      .recovery-bad { color: var(--crit); }
      @media (max-width: 900px) { .form-grid { grid-template-columns: 1fr; } .impact { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 520px) { .impact { grid-template-columns: 1fr; } }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    this._clock = window.setInterval(() => { this._now = Date.now(); }, 1_000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._clock !== null) clearInterval(this._clock);
  }

  private get _descriptor(): ScenarioSummary | null {
    return this.scenarios.find((scenario) => scenario.scenarioId === this._scenarioId) ?? this.scenarios[0] ?? null;
  }

  /** Fail closed: what the server has not established, the panel does not offer. */
  private get _caps(): SimulationCapabilities {
    return this.capabilities ?? NO_CAPABILITIES;
  }

  private get _liveNetworks(): string[] {
    return this._caps.liveNetworks;
  }

  private get _liveOffered(): boolean {
    return this._caps.liveExecutorConfigured && this._liveNetworks.length > 0;
  }

  /**
   * The allowlist arrives after the first render, so the parameter field is
   * filled from whichever scenario is selected once its descriptor exists --
   * and again whenever the selection changes. One rule covers both.
   */
  override willUpdate(): void {
    // An acknowledgement is given about one run, and it does not travel.
    const runKey = this.run?.runKey ?? null;
    if (runKey !== this._acknowledgedRunKey) {
      this._acknowledgedRunKey = runKey;
      this._riskAcknowledged = false;
      this._startAcknowledged = false;
    }

    const descriptor = this._descriptor;
    if (descriptor === null || this._seededScenarioId === descriptor.scenarioId) return;
    this._seededScenarioId = descriptor.scenarioId;
    this._params = { ...(descriptor.parameterTemplate ?? {}) };
    this._paramsText = null;
    this._paramsError = '';
  }

  /* ── the canonical parameter object, and its two faces ──────────────────── */

  /**
   * ONE object is the truth, and both the form and the JSON render from it.
   *
   * The panel used to hold the parameters as a string of JSON, which made the
   * textarea the only editor there could ever be: a form field would have had
   * to parse, edit and reserialise on every keystroke, and an unparseable
   * moment in the middle would have destroyed what the reader had typed.
   */
  private _params: Record<string, unknown> = {};

  /**
   * The Advanced editor's raw text, while it differs from the canonical object.
   *
   * `null` means "show what the object says". A string means somebody is
   * editing JSON by hand, and the text is kept verbatim even when it does not
   * parse -- losing what a person typed because it was briefly invalid is the
   * behaviour this replaces.
   */
  private _paramsText: string | null = null;

  /** Non-empty while the Advanced text cannot be read. Blocks Prepare. */
  private _paramsError = '';

  /** The Advanced JSON view is collapsed until somebody asks for it. */
  private _advanced = false;

  /** What the textarea shows: the edit in progress, or the object. */
  private _paramsJson(): string {
    return this._paramsText ?? JSON.stringify(this._params, null, 2);
  }

  /** The fields this scenario's descriptor describes, or none. */
  private _fields(): ScenarioFieldSpec[] {
    return this._descriptor?.parameterFields ?? [];
  }

  /** A field is shown only when the field it depends on has an admitting value. */
  private _fieldApplies(field: ScenarioFieldSpec): boolean {
    if (field.onlyWhen === undefined) return true;
    return field.onlyWhen.values.includes(String(this._params[field.onlyWhen.field] ?? ''));
  }

  /**
   * A form edit. The canonical object moves, and the JSON view follows.
   *
   * Setting a value also settles every field that depends on it, because the
   * server refuses both halves of getting that wrong: the delay kinds REQUIRE
   * `param` and the others REFUSE it, so a form that left the old value behind
   * would send a request that cannot be accepted, for a reason the reader
   * cannot see on the screen.
   */
  private _setParam(name: string, value: unknown): void {
    const next: Record<string, unknown> = { ...this._params };
    if (value === undefined || value === '') delete next[name];
    else next[name] = value;

    for (const field of this._fields()) {
      if (field.onlyWhen?.field !== name) continue;
      if (field.onlyWhen.values.includes(String(value))) {
        if (next[field.name] === undefined) next[field.name] = field.min ?? 1;
      } else {
        delete next[field.name];
      }
    }

    this._params = next;
    // The object moved, so the JSON view is no longer somebody's edit.
    this._paramsText = null;
    this._paramsError = '';
    this._draftChanged();
  }

  /**
   * An Advanced-view edit. The text is kept as typed; the object follows only
   * when the text can be read.
   */
  private _setParamsJson(text: string): void {
    this._paramsText = text;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Parameters must be a JSON object.');
      }
      this._params = parsed as Record<string, unknown>;
      this._paramsError = '';
    } catch (error) {
      // Deliberately not cleared: an unreadable draft must not be able to start
      // a run, and it must not quietly revert to the last good object either.
      this._paramsError = error instanceof Error ? error.message : 'That is not valid JSON.';
    }
    this._draftChanged();
  }


  /**
   * The run these controls may act on: the one held, and only while it is the
   * one the address bar names.
   *
   * Every button below sends a command naming `run.runKey`, so a control whose
   * target is not the selected run must not act and must not be on the screen.
   * The dashboard now drops the previous run the moment the selection moves, so
   * this should never disagree — which is exactly why it is checked here as
   * well. The cost of being wrong is an abort delivered to a live run that
   * nobody is looking at.
   */
  private _actionRun(): SimulationControlRun | null {
    const run = this.run;
    if (run === null) return null;
    return run.runKey === this.selectedRunKey ? run : null;
  }

  /**
   * The draft changed.
   *
   * It used to clear the prepared run as well, which is why editing any field
   * -- even the seed, even by one character -- removed the abort and recovery
   * controls of a run that was still going. The draft is what this form
   * describes; the selected run is what the server is holding, and the two only
   * meet when Prepare is pressed.
   */
  private _draftChanged(): void {
    this._message = '';
  }

  /**
   * The same key for the same uncertain request, a different key for anything
   * else.
   *
   * A request that times out may still have been applied, and the only safe way
   * to find out is to repeat it under the key it was first sent with -- which
   * is what makes the server answer `idempotentReplay` instead of refusing.
   *
   * Keyed by RUN and operation, not by operation alone. With one key per
   * operation, aborting run A and then aborting run B inside the same panel
   * reused A's key: the second abort would have been recognised as a replay of
   * the first, and B would never have been aborted at all.
   */
  private _idempotency(runKey: string, operation: string): string {
    const scope = `${runKey}:${operation}`;
    const held = this._retryKeys.get(scope);
    if (held !== undefined) return held;
    const key = newIdempotencyKey(scope);
    this._retryKeys.set(scope, key);
    return key;
  }

  /** Only the key that just succeeded is retired; the others are still owed. */
  private _completedOperation(runKey: string, operation: string): void {
    this._retryKeys.delete(`${runKey}:${operation}`);
    this.dispatchEvent(new CustomEvent('simulation-changed', { bubbles: true, composed: true }));
  }

  /**
   * Hand the freshest description of the run to its owner.
   *
   * A mutation's response IS the newest state there is, and the operator has
   * just acted: making them wait for the next tick is how a second click
   * happens. The dashboard still decides whether to take it -- on the server's
   * revision, so an answer describing an older state is refused here too.
   */
  private _report(run: SimulationControlRun, preflight?: SimulationPreflight): void {
    this.dispatchEvent(
      new CustomEvent('run-updated', {
        detail: preflight === undefined ? { run } : { run, preflight },
        bubbles: true,
        composed: true,
      })
    );
  }

  /** The descriptor for the SELECTED run, which need not be the drafted one. */
  private _runDescriptor(): ScenarioSummary | null {
    const run = this._actionRun();
    if (run === null) return null;
    return (
      this.scenarios.find((item) => item.scenarioId === run.metadata.scenarioId) ?? this._descriptor
    );
  }

  private _selectScenario(event: Event): void {
    this._scenarioId = (event.target as HTMLSelectElement).value;
    // The parameter field is refilled by willUpdate, from the server's own
    // template for the newly chosen scenario.
    this._draftChanged();
  }

  /**
   * Choosing live also settles the network, rather than leaving the reader to
   * assemble a pair the server refuses at creation.
   *
   * `live` on `devnet` was selectable and always rejected: the only executor is
   * the Docker lab. The refusal was correct; offering the combination was the
   * defect.
   */
  private _selectMode(event: Event): void {
    const mode = (event.target as HTMLSelectElement).value as Mode;
    this._mode = mode;
    if (mode === 'live') {
      const only = this._liveNetworks[0];
      if (only !== undefined) this._network = only as Network;
    }
    this._draftChanged();
  }

  /**
   * A fresh seed for the draft.
   *
   * The seed scopes the create idempotency key along with the rest of the
   * request, so a new seed is a genuinely new request -- which is what this
   * button is for, and why it is offered for a draft and nowhere else.
   */
  private _newSeed(): void {
    this._seed = newSeed();
    this._draftChanged();
  }

  private _prepare(event: SubmitEvent): void {
    event.preventDefault();
    void this._prepareRun();
  }

  private async _prepareRun(): Promise<void> {
    const session = this.session;
    const descriptor = this._descriptor;
    if (session === null || descriptor === null) return;
    // An unreadable Advanced edit stops here rather than being silently
    // replaced by the last object that did parse. The server would refuse the
    // difference anyway; refusing it on the screen says which one is wrong.
    if (this._paramsError !== '') {
      this._message = `The parameters could not be read: ${this._paramsError}`;
      return;
    }
    const parameters: Record<string, unknown> = { ...this._params };
    /*
     * A draft has no run key yet, so its own identity scopes the retry -- and
     * that identity is the whole request, not the seed it happens to carry.
     *
     * Scoped to the seed, an uncertain Prepare followed by an edit sent a
     * different body under the same key, which the server binds to the payload
     * it first saw and refuses for any other. The corrected draft could then
     * not be created at all until the page was reloaded. Repeating the same
     * draft is still the same request, which is the whole point of a retry.
     *
     * Taken from the snapshot that is about to be sent, and the same snapshot
     * retires the key on the answer: nothing between the two can move.
     */
    const request = {
      network: this._network,
      mode: this._mode,
      scenario: {
        scenarioId: descriptor.scenarioId,
        scenarioVersion: descriptor.version,
        seed: this._seed,
        parameters,
      },
    };
    const scope = draftScope(request);
    this._busy = true;
    this._message = '';
    try {
      const result = await adminApi.createRun({
        csrfToken: session.csrfToken,
        idempotencyKey: this._idempotency(scope, 'create'),
        ...request,
      });
      this._report(result.run);
      this._completedOperation(scope, 'create');
      // The acknowledgements are not cleared here any more. They are cleared
      // wherever the selected run changes, which covers this case and the one
      // this line missed: moving between two runs that already exist.
      // The dashboard owns the address bar; it puts this key in it, so a reload
      // comes back to the run that was just created rather than to nothing.
      this.dispatchEvent(
        new CustomEvent('run-selected', {
          detail: { runKey: result.run.runKey },
          bubbles: true,
          composed: true,
        })
      );
    } catch (error) {
      this._message = errorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  private async _validate(): Promise<void> {
    const run = this._actionRun();
    const session = this.session;
    if (run === null || session === null) return;
    this._busy = true;
    this._message = '';
    try {
      const result = await adminApi.validateRun(run.runKey, session.csrfToken, this._idempotency(run.runKey, 'validate'));
      this._report(result.run, result.preflight);
      this._completedOperation(run.runKey, 'validate');
    } catch (error) {
      this._message = errorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  private async _arm(): Promise<void> {
    const run = this._actionRun();
    const session = this.session;
    const descriptor = this._runDescriptor();
    if (run === null || session === null || descriptor === null || !this._riskAcknowledged) return;
    this._busy = true;
    this._message = '';
    try {
      const result = await adminApi.armRun(
        run.runKey, session.csrfToken, this._idempotency(run.runKey, 'arm'), descriptor.riskClass
      );
      // An idempotent replay of arm answers WITHOUT a preflight -- the checks
      // were run once, and re-running them is not what a retry means. Keeping
      // the one already held is the difference between "checked earlier" and
      // "never checked"; overwriting it with undefined would turn a passed
      // preflight into "not run" on a retry after a network timeout.
      this._report(result.run, result.preflight);
      this._completedOperation(run.runKey, 'arm');
    } catch (error) {
      this._message = errorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  private async _start(): Promise<void> {
    const run = this._actionRun();
    const session = this.session;
    if (run === null || session === null || !this._startAcknowledged) return;
    this._busy = true;
    this._message = '';
    try {
      const result = await adminApi.startRun(run.runKey, session.csrfToken, this._idempotency(run.runKey, 'start'));
      this._report(result.run);
      this._completedOperation(run.runKey, 'start');
    } catch (error) {
      this._message = errorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  private async _abort(): Promise<void> {
    const run = this._actionRun();
    const session = this.session;
    if (run === null || session === null) return;
    this._busy = true;
    this._message = '';
    try {
      const result = await adminApi.abortRun(run.runKey, session.csrfToken, this._idempotency(run.runKey, 'abort'));
      this._report(result.run);
      this._completedOperation(run.runKey, 'abort');
    } catch (error) {
      this._message = errorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  private async _recover(): Promise<void> {
    const run = this._actionRun();
    const session = this.session;
    if (run === null || session === null) return;
    this._busy = true;
    this._message = '';
    try {
      const result = await adminApi.recoverRun(run.runKey, session.csrfToken, this._idempotency(run.runKey, 'recover'));
      this._report(result.run);
      this._completedOperation(run.runKey, 'recover');
    } catch (error) {
      this._message = errorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  override render(): TemplateResult {
    const descriptor = this._descriptor;
    return html`
      <section class="control" aria-label="Simulation control">
        <div class="page-head">
          <div>
            <h2 class="page-title">Simulation control</h2>
            <p class="intro">Prepare a bounded plan, inspect its exact targets and impact, validate preflight, then acknowledge risk and confirm the start separately. The server independently enforces every one of those gates.</p>
          </div>
        </div>
        ${this._message ? html`<div class="alert" role="alert">${this._message}</div>` : nothing}
        ${this._form(descriptor)}
        ${(() => {
          const run = this._actionRun();
          return run !== null && this.plan !== null ? this._selectedView(run, this.plan) : nothing;
        })()}
      </section>
    `;
  }

  private _form(descriptor: ScenarioSummary | null): TemplateResult {
    return html`
      <form class="card" @submit=${this._prepare}>
        <div class="card-head"><h3 class="card-title">1. Prepare and preview</h3><div class="page-sub mono">no remote action</div></div>
        <div class="form-grid">
          <label><span>Scenario</span>
            <select .value=${this._scenarioId} @change=${this._selectScenario} ?disabled=${this._busy}>
              ${this.scenarios.map((scenario) => html`<option value=${scenario.scenarioId}>${scenario.title} · ${scenario.riskClass}</option>`)}
            </select>
          </label>
          <label><span>Network</span>
            <select .value=${this._network} @change=${(event: Event) => { this._network = (event.target as HTMLSelectElement).value as Network; this._draftChanged(); }} ?disabled=${this._busy}>
              <option value="regtest">regtest (local lab)</option>
              <!-- While live is selected the only reachable network is the lab's,
                   so the other one is not offered rather than offered and refused. -->
              <option value="devnet" ?disabled=${this._mode === 'live'}>devnet</option>
            </select>
          </label>
          <label><span>Mode</span>
            <select .value=${this._mode} @change=${this._selectMode} ?disabled=${this._busy}>
              <option value="dry-run">dry-run</option>
              <option value="live" ?disabled=${!this._liveOffered}>Live · regtest lab</option>
            </select>
          </label>
          <label class="seed"><span>Deterministic seed</span>
            <span class="seed-row">
              <input type="text" .value=${this._seed} @input=${(event: Event) => { this._seed = (event.target as HTMLInputElement).value; this._draftChanged(); }} ?disabled=${this._busy} required />
              <!-- Only a draft may be reseeded. A run that already exists has
                   its seed recorded in its own metadata, and reseeding would
                   describe it wrongly rather than change it. -->
              <button type="button" class="btn" @click=${this._newSeed} ?disabled=${this._busy} title="Generate a new seed for this draft">New</button>
            </span>
          </label>
          ${this._parameterForm()}
          ${this._parameterJsonView()}
          ${this._parameterNotes(descriptor)}
        </div>
        <div class="form-foot">
          <span class="warning">${descriptor ? `${descriptor.riskClass.toUpperCase()} RISK — ${descriptor.description}` : 'Loading scenario allowlist…'}</span>
          <!-- The label used to read "dry-run" whatever was selected, while the
               request carried the selected mode. It says which mode it is
               preparing now; preparing itself still performs no remote action. -->
          <button class="btn primary" type="submit" ?disabled=${this._busy || descriptor === null}>
            ${this._busy
              ? 'Preparing…'
              : this._mode === 'live'
                ? 'Prepare live plan · regtest lab'
                : 'Prepare dry-run plan'}
          </button>
        </div>
      </form>
    `;
  }

  /**
   * The scenario's own parameters, as fields.
   *
   * Drawn from what the server's descriptor says about them, so the bounds on
   * screen are the bounds the validator enforces -- they are not a second copy
   * kept here, and `scenarioFields.test.ts` proves the server's table against
   * `parseScenarioRequest` itself. A scenario the server describes no fields
   * for gets the JSON view and no invented inputs.
   */
  private _parameterForm(): TemplateResult {
    const fields = this._fields().filter((field) => this._fieldApplies(field));
    if (fields.length === 0) {
      return html`<div class="parameters notice">
        This server describes no form fields for
        <b class="mono">${this._descriptor?.scenarioId ?? 'this scenario'}</b>. Use the JSON below —
        the server validates it either way.
      </div>`;
    }
    return html`<div class="parameters scenario-fields">${fields.map((f) => this._parameterField(f))}</div>`;
  }

  private _parameterField(field: ScenarioFieldSpec): TemplateResult {
    const value = this._params[field.name];
    const id = `param-${field.name}`;
    if (field.kind === 'enum') {
      return html`
        <label for=${id}>
          <span>${field.label}</span>
          <select
            id=${id}
            .value=${String(value ?? '')}
            @change=${(e: Event) => this._setParam(field.name, (e.target as HTMLSelectElement).value)}
            ?disabled=${this._busy}
          >
            ${(field.values ?? []).map((v: string) => html`<option value=${v}>${v}</option>`)}
          </select>
          ${field.help ? html`<small class="field-help">${field.help}</small>` : nothing}
        </label>
      `;
    }
    if (field.kind === 'target-ids') {
      const list = Array.isArray(value) ? (value as string[]).join(', ') : '';
      return html`
        <label for=${id} class="wide">
          <span>${field.label} <em class="optional">optional</em></span>
          <input
            id=${id}
            type="text"
            .value=${list}
            placeholder="lab-mn-1, lab-mn-2"
            @input=${(e: Event) => {
              const raw = (e.target as HTMLInputElement).value.trim();
              const ids = raw === '' ? undefined : raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
              this._setParam(field.name, ids);
            }}
            ?disabled=${this._busy}
          />
          ${field.help ? html`<small class="field-help">${field.help}</small>` : nothing}
        </label>
      `;
    }
    return html`
      <label for=${id}>
        <span>${field.label}${field.unit ? html` <em class="unit">${field.unit}</em>` : nothing}</span>
        <input
          id=${id}
          type="number"
          inputmode="numeric"
          step="1"
          min=${field.min ?? nothing}
          max=${field.max ?? nothing}
          .value=${value === undefined ? '' : String(value)}
          @input=${(e: Event) => {
            const raw = (e.target as HTMLInputElement).value;
            // An empty box is "not set", not zero. Zero is a value the server
            // refuses for every one of these, and inventing it here would turn
            // a half-typed number into a refused request.
            this._setParam(field.name, raw === '' ? undefined : Number(raw));
          }}
          ?disabled=${this._busy}
          required=${field.required ? true : nothing}
        />
        <small class="field-range"
          >${field.min}–${field.max}${field.unit ? ` ${field.unit}` : ''}</small
        >
        ${field.help ? html`<small class="field-help">${field.help}</small>` : nothing}
      </label>
    `;
  }

  /**
   * The same object, as JSON, behind a disclosure.
   *
   * Kept because it is the only way to express something the form has no field
   * for, and because an operator reading a refusal from the server wants to see
   * exactly what was sent. It is not the default view any more: a JSON blob is
   * not a form, and it was the whole of this panel's parameter editing.
   */
  private _parameterJsonView(): TemplateResult {
    return html`
      <div class="parameters">
        <button
          type="button"
          class="disclosure"
          aria-expanded=${this._advanced ? 'true' : 'false'}
          @click=${() => {
            this._advanced = !this._advanced;
          }}
        >
          ${this._advanced ? '▾' : '▸'} Advanced: the parameters as JSON
        </button>
        ${this._advanced
          ? html`
              <textarea
                .value=${this._paramsJson()}
                @input=${(e: Event) => this._setParamsJson((e.target as HTMLTextAreaElement).value)}
                ?disabled=${this._busy}
                spellcheck="false"
                aria-label="Scenario parameters as JSON"
              ></textarea>
            `
          : nothing}
        ${this._paramsError
          ? html`<div class="alert" role="alert">
              The parameters cannot be read: ${this._paramsError}. What you typed is kept; nothing
              will be prepared until it parses.
            </div>`
          : nothing}
      </div>
    `;
  }

  /**
   * What the operator still has to do before this plan could resolve, and what
   * this deployment cannot do at all.
   *
   * Kept apart on purpose. A schema-valid parameter object is not a resolvable
   * target, and a configured executor is not a passed preflight.
   */
  private _parameterNotes(descriptor: ScenarioSummary | null): TemplateResult {
    if (descriptor === null) return html`${nothing}`;
    return html`
      <div class="parameters notes">
        ${descriptor.parameterTemplate === undefined
          ? html`<div class="notice">
              This server offered no parameter template for
              <b class="mono">${descriptor.scenarioId}</b>. Enter the parameters its schema
              requires — the server validates them, and refuses what it does not recognise.
            </div>`
          : nothing}
        ${descriptor.templateNeedsTargetId === true
          ? html`<div class="notice">
              The template names a placeholder target id. Replace it with a registered target:
              the schema accepts the placeholder, the registry will not.
            </div>`
          : nothing}
        ${this._liveOffered
          ? nothing
          : html`<div class="notice">
              Live mode is unavailable: this deployment reports no configured lab executor.
              Dry-run plans are unaffected.
            </div>`}
        ${this._mode === 'live'
          ? html`<div class="notice">
              A live run executes in the regtest lab only. A configured executor is not a passed
              preflight — chain identity, data quality, target mapping and recovery readiness are
              checked separately when the plan is validated.
            </div>`
          : nothing}
      </div>
    `;
  }

  /**
   * What is actually known about the lab's state, and what is not.
   *
   * This line used to read `run.recovery` and print "Recovery proof: all
   * targets clear". The control API's run projection selects runKey,
   * metadataFingerprint, metadata and state; the stored recovery result is a
   * separate field on the document and no endpoint returns it -- so the
   * condition was never true and the line never rendered. Removing it silently
   * would leave the panel saying nothing about recovery at all, which reads as
   * "nothing to worry about". It says what the server does report
   * (`faultMayBeActive`) and that the proof itself is not available here.
   */
  private _safetyLine(run: SimulationControlRun): TemplateResult {
    const safety = runSafety(run, this.recovery);
    const proof =
      safety.allClear === 'unknown'
        ? html`<span class="state-line">
            No recovery proof has been recorded for this run yet.
          </span>`
        : html`<span class=${safety.allClear === 'yes' ? 'recovery-ok' : 'recovery-bad'}>
            Recovery proof:
            ${safety.allClear === 'yes' ? 'all targets clear' : 'manual attention required'}
            (${num(this.recovery?.targets.length ?? 0)} targets checked)
          </span>`;
    return html`
      <div class=${safety.faultMayBeActive ? 'recovery-bad' : ''}>
        ${safety.faultMayBeActive
          ? 'A fault may still be active: the server has not recorded a proven recovery. '
          : 'No fault outstanding. '}
        ${proof}
      </div>
    `;
  }

  private _selectedView(run: SimulationControlRun, plan: DryRunPlan): TemplateResult {
    return html`
      ${this._preview(plan)}
      ${this._preflightCard()}
      ${this._approvalAndRecovery(run)}
    `;
  }

  private _preview(plan: DryRunPlan): TemplateResult {
    const impact = plan.impact;
    return html`
      <section class="card">
        <div class="card-head"><h3 class="card-title">Target preview</h3><div class="page-sub mono">${plan.runKey}</div></div>
        <div class="impact">
          <div><span>Targets</span><b>${num(impact.affectedTargetCount)}</b></div>
          <div><span>Hosts</span><b>${num(impact.affectedHostCount)}</b></div>
          <div><span>Quorum members affected</span><b>${num(impact.affectedCurrentQuorumMembers)}</b></div>
          <div><span>DKG margin</span><b>${signedMargin(impact.dkgMarginAfterFault)}</b></div>
          <div><span>ChainLock margin</span><b>${signedMargin(impact.chainLockMarginAfterFault)}</b></div>
          <div><span>Actions</span><b>${num(plan.actions.length)}</b></div>
        </div>
        ${impact.warnings.length ? html`<div class="alert">${impact.warnings.map((warning) => html`<div>${warning}</div>`)}</div>` : nothing}
        <div class="card-body flush">
          <div class="twrap"><table><caption class="sr-only">The targets this scenario would act on.</caption><thead><tr><th scope="col">Target</th><th scope="col">Action</th><th scope="col" class="r">Offset</th></tr></thead><tbody>
          ${plan.actions.map((action) => html`<tr><td class="mono">${action.targetId}</td><td>${action.kind}</td><td class="r mono">${Math.round(action.notBeforeOffsetMs / 1_000)} s</td></tr>`)}
        </tbody></table></div></div>
        <div class="notice">${plan.assurances.join(' · ')}</div>
      </section>
    `;
  }

  private _preflightCard(): TemplateResult {
    const preflight = this.preflight;
    return html`
      <section class="card">
        <div class="card-head"><h3 class="card-title">2. Preflight</h3><div class="page-sub mono">${preflight ? (preflight.passed ? 'passed' : 'blocked') : 'not run'}</div></div>
        ${preflight === null
          ? html`<div class="card-body"><p class="intro">The server verifies chain identity, data quality, target mapping and recovery readiness before this plan can be armed.</p><div class="actions" style="margin-top:var(--sp-4)"><button class="btn primary" ?disabled=${this._busy} @click=${this._validate}>Validate preflight</button></div></div>`
          : html`<ul class="check-list">${preflight.checks.map((check: SimulationPreflight['checks'][number]) => html`<li class=${check.passed ? 'passed' : 'failed'}><strong>${check.passed ? '✓' : '×'} ${check.checkId}</strong> — ${check.publicMessage}</li>`)}</ul>`}
      </section>
    `;
  }

  private _approvalAndRecovery(run: SimulationControlRun): TemplateResult {
    const descriptor = this._runDescriptor();
    const isArmed = run.state.status === 'armed';
    // A descriptor the panel cannot resolve is not a reason to widen approval:
    // an unknown scenario is treated as the strictest one it could be.
    const mayApprove =
      (descriptor !== null && descriptor.riskClass !== 'high') ||
      this.session?.role === 'safety-admin';
    const canAbort = run.state.live && !['completed', 'aborted', 'rejected'].includes(run.state.status);
    const needsRecovery = run.state.faultMayBeActive || run.state.status === 'failed';
    return html`
      <section class="card">
        <div class="card-head"><h3 class="card-title">3. Approval and recovery</h3><div class="page-sub mono">${run.state.status}</div></div>
        <div class="approval">
          <div class="state-line run-state">Run <strong class="mono">${run.runKey}</strong> is <strong>${run.state.status}</strong>${run.state.live ? ' (live lab run)' : ' (dry-run)'}.</div>
          <!-- The saved seed, from the run rather than from the form beside it.
               The draft above is a different thing with a different seed, and
               reading this one off that one is how a reproduction is written
               down wrongly. -->
          <div class="state-line">Created from seed <strong class="mono">${run.metadata.seed}</strong>, scenario <strong class="mono">${run.metadata.scenarioId}</strong> v${run.metadata.scenarioVersion}.</div>
          ${run.state.faultLeaseExpiresAtMs !== null ? html`<div class="countdown">Fault lease: ${countdown(run.state.faultLeaseExpiresAtMs, this._now)}</div>` : nothing}
          ${this._safetyLine(run)}
          ${run.state.status === 'scheduled'
            ? html`
                <label><input type="checkbox" .checked=${this._riskAcknowledged} @change=${(event: Event) => { this._riskAcknowledged = (event.target as HTMLInputElement).checked; }} ?disabled=${this._busy || !mayApprove} />
                  <span>I acknowledge the server-declared <strong>${descriptor?.riskClass ?? 'unknown'}</strong> risk for “${descriptor?.title ?? run.metadata.scenarioId}”.</span>
                </label>
                ${!mayApprove ? html`<div class="alert">Only a safety-admin may approve this high-risk scenario.</div>` : nothing}
                <div class="actions"><button class="btn primary" ?disabled=${this._busy || !this._riskAcknowledged || !mayApprove} @click=${this._arm}>Arm approved plan</button></div>
              `
            : nothing}
          ${isArmed
            ? html`
                <label><input type="checkbox" .checked=${this._startAcknowledged} @change=${(event: Event) => { this._startAcknowledged = (event.target as HTMLInputElement).checked; }} ?disabled=${this._busy} />
                  <span>I confirm ${run.state.live ? 'this will execute the approved fault in the local lab' : 'this will complete the approved dry-run'}.</span>
                </label>
                <div class="actions"><button class="btn primary" ?disabled=${this._busy || !this._startAcknowledged} @click=${this._start}>${run.state.live ? 'Confirm and start' : 'Confirm and complete dry-run'}</button></div>
              `
            : nothing}
          ${(canAbort || needsRecovery) ? html`<div class="actions">
            ${canAbort ? html`<button class="btn danger" ?disabled=${this._busy} @click=${this._abort}>Abort & recover</button>` : nothing}
            ${needsRecovery ? html`<button class="btn" ?disabled=${this._busy} @click=${this._recover}>Retry recovery proof</button>` : nothing}
          </div>` : nothing}
        </div>
      </section>
    `;
  }
}

customElements.define('dd-simulation-control', DdSimulationControl);
