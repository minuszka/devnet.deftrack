import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import {
  adminApi,
  type AdminSession,
  type DryRunPlan,
  type RecoveryReportView,
  type ScenarioSummary,
  type SimulationCapabilities,
  type SimulationControlRun,
  type SimulationPreflight,
} from '../lib/admin-api.js';

import { num } from '../lib/format.js';
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

/**
 * The panel no longer keeps its own table of parameter defaults.
 *
 * It kept one, maintained separately from the schema that validates it, and it
 * drifted exactly as such a table does: `dsl-fault` had no entry at all, so
 * selecting it put `{}` in the field -- three required fields short, refused by
 * the server, with nothing here saying why. The template now comes from the
 * module that owns the schema, and a scenario this server does not describe
 * gets no template rather than an empty one that looks runnable.
 */
function templateJson(descriptor: ScenarioSummary | null): string {
  if (descriptor?.parameterTemplate === undefined) return '';
  return JSON.stringify(descriptor.parameterTemplate, null, 2);
}

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
    _parameters: { state: true },
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
  private _parameters = '';
  /** Which scenario the parameter field was last filled from. */
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
      .btn.danger { background: var(--crit); border-color: var(--crit); color: #fff; font-weight: 700; }
      .btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--crit) 85%, black); }
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
    this._parameters = templateJson(descriptor);
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

  private _prepare(event: SubmitEvent): void {
    event.preventDefault();
    void this._prepareRun();
  }

  private async _prepareRun(): Promise<void> {
    const session = this.session;
    const descriptor = this._descriptor;
    if (session === null || descriptor === null) return;
    let parameters: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(this._parameters);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Parameters must be a JSON object.');
      parameters = parsed as Record<string, unknown>;
    } catch (error) {
      this._message = errorMessage(error);
      return;
    }
    this._busy = true;
    this._message = '';
    try {
      const result = await adminApi.createRun({
        csrfToken: session.csrfToken,
        // A draft has no run key yet, so the seed scopes it: repeating the
        // same draft is the same request, a new seed is a new one.
        idempotencyKey: this._idempotency(`draft:${this._seed}`, 'create'),
        network: this._network,
        mode: this._mode,
        scenario: { scenarioId: descriptor.scenarioId, scenarioVersion: descriptor.version, seed: this._seed, parameters },
      });
      this._report(result.run);
      this._completedOperation(`draft:${this._seed}`, 'create');
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
            <div class="page-title">Simulation control</div>
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
        <div class="card-head"><div class="card-title">1. Prepare and preview</div><div class="page-sub mono">no remote action</div></div>
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
          <label><span>Deterministic seed</span><input type="text" .value=${this._seed} @input=${(event: Event) => { this._seed = (event.target as HTMLInputElement).value; this._draftChanged(); }} ?disabled=${this._busy} required /></label>
          <label class="parameters"><span>Typed scenario parameters (JSON)</span><textarea .value=${this._parameters} @input=${(event: Event) => { this._parameters = (event.target as HTMLTextAreaElement).value; this._draftChanged(); }} ?disabled=${this._busy} spellcheck="false" required></textarea></label>
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
        <div class="card-head"><div class="card-title">Target preview</div><div class="page-sub mono">${plan.runKey}</div></div>
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
          <caption class="sr-only">The targets this scenario would act on.</caption>
          <div class="twrap"><table><thead><tr><th scope="col">Target</th><th scope="col">Action</th><th scope="col" class="r">Offset</th></tr></thead><tbody>
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
        <div class="card-head"><div class="card-title">2. Preflight</div><div class="page-sub mono">${preflight ? (preflight.passed ? 'passed' : 'blocked') : 'not run'}</div></div>
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
        <div class="card-head"><div class="card-title">3. Approval and recovery</div><div class="page-sub mono">${run.state.status}</div></div>
        <div class="approval">
          <div class="state-line run-state">Run <strong class="mono">${run.runKey}</strong> is <strong>${run.state.status}</strong>${run.state.live ? ' (live lab run)' : ' (dry-run)'}.</div>
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
