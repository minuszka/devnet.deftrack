import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import {
  adminApi,
  type AdminSession,
  type DryRunPlan,
  type ScenarioSummary,
  type SimulationControlRun,
  type SimulationPreflight,
} from '../lib/admin-api.js';
import { num } from '../lib/format.js';
import { baseStyles, cardStyles, controlStyles, pageStyles, tableStyles } from '../styles/shared.js';

type Network = 'regtest' | 'devnet';
type Mode = 'dry-run' | 'live';

interface PreparedRun {
  descriptor: ScenarioSummary;
  run: SimulationControlRun;
  plan: DryRunPlan;
  preflight: SimulationPreflight | null;
}

const parameterDefaults: Record<string, Record<string, unknown>> = {
  'mn-stop': { count: 1, durationSeconds: 60 },
  'host-outage': { anchorTargetId: 'target-id', durationSeconds: 60 },
  'quorum-member-outage': { count: 1, phase: 'dkg', durationSeconds: 60 },
  'staker-stop': { count: 1, durationSeconds: 60 },
  'restart-flapping': { role: 'masternode', count: 1, cycles: 1, downSeconds: 10, upSeconds: 10 },
  'network-degradation': {
    role: 'masternode', count: 1, durationSeconds: 60, latencyMs: 100, jitterMs: 20, lossPercent: 1, correlationPercent: 0,
  },
  'node-isolation': { count: 1, durationSeconds: 60 },
  'clear-recover': { targetIds: ['target-id'] },
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
    _scenarioId: { state: true },
    _network: { state: true },
    _mode: { state: true },
    _seed: { state: true },
    _parameters: { state: true },
    _prepared: { state: true },
    _riskAcknowledged: { state: true },
    _startAcknowledged: { state: true },
    _busy: { state: true },
    _message: { state: true },
    _now: { state: true },
  };

  session: AdminSession | null = null;
  scenarios: ScenarioSummary[] = [];
  private _scenarioId = 'mn-stop';
  private _network: Network = 'regtest';
  private _mode: Mode = 'dry-run';
  private _seed = newSeed();
  private _parameters = JSON.stringify(parameterDefaults['mn-stop'], null, 2);
  private _prepared: PreparedRun | null = null;
  private _riskAcknowledged = false;
  private _startAcknowledged = false;
  private _busy = false;
  private _message = '';
  private _now = Date.now();
  private _clock: number | null = null;
  private _retryKey: { operation: string; key: string } | null = null;

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

  private _newInput(): void {
    this._prepared = null;
    this._riskAcknowledged = false;
    this._startAcknowledged = false;
    this._message = '';
    this._retryKey = null;
  }

  private _idempotency(operation: string): string {
    if (this._retryKey?.operation === operation) return this._retryKey.key;
    const key = newIdempotencyKey(operation);
    this._retryKey = { operation, key };
    return key;
  }

  private _completedOperation(): void {
    this._retryKey = null;
    this.dispatchEvent(new CustomEvent('simulation-changed', { bubbles: true, composed: true }));
  }

  private _selectScenario(event: Event): void {
    this._scenarioId = (event.target as HTMLSelectElement).value;
    this._parameters = JSON.stringify(parameterDefaults[this._scenarioId] ?? {}, null, 2);
    this._newInput();
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
        idempotencyKey: this._idempotency('create'),
        network: this._network,
        mode: this._mode,
        scenario: { scenarioId: descriptor.scenarioId, scenarioVersion: descriptor.version, seed: this._seed, parameters },
      });
      this._prepared = { descriptor, run: result.run, plan: result.plan, preflight: null };
      this._completedOperation();
    } catch (error) {
      this._message = errorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  private async _validate(): Promise<void> {
    const prepared = this._prepared;
    const session = this.session;
    if (prepared === null || session === null) return;
    this._busy = true;
    this._message = '';
    try {
      const result = await adminApi.validateRun(prepared.run.runKey, session.csrfToken, this._idempotency('validate'));
      this._prepared = { ...prepared, run: result.run, preflight: result.preflight };
      this._completedOperation();
    } catch (error) {
      this._message = errorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  private async _arm(): Promise<void> {
    const prepared = this._prepared;
    const session = this.session;
    if (prepared === null || session === null || !this._riskAcknowledged) return;
    this._busy = true;
    this._message = '';
    try {
      const result = await adminApi.armRun(
        prepared.run.runKey, session.csrfToken, this._idempotency('arm'), prepared.descriptor.riskClass
      );
      this._prepared = { ...prepared, run: result.run, preflight: result.preflight };
      this._completedOperation();
    } catch (error) {
      this._message = errorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  private async _start(): Promise<void> {
    const prepared = this._prepared;
    const session = this.session;
    if (prepared === null || session === null || !this._startAcknowledged) return;
    this._busy = true;
    this._message = '';
    try {
      const result = await adminApi.startRun(prepared.run.runKey, session.csrfToken, this._idempotency('start'));
      this._prepared = { ...prepared, run: result.run };
      this._completedOperation();
    } catch (error) {
      this._message = errorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  private async _abort(): Promise<void> {
    const prepared = this._prepared;
    const session = this.session;
    if (prepared === null || session === null) return;
    this._busy = true;
    this._message = '';
    try {
      const result = await adminApi.abortRun(prepared.run.runKey, session.csrfToken, this._idempotency('abort'));
      this._prepared = { ...prepared, run: result.run };
      this._completedOperation();
    } catch (error) {
      this._message = errorMessage(error);
    } finally {
      this._busy = false;
    }
  }

  private async _recover(): Promise<void> {
    const prepared = this._prepared;
    const session = this.session;
    if (prepared === null || session === null) return;
    this._busy = true;
    this._message = '';
    try {
      const result = await adminApi.recoverRun(prepared.run.runKey, session.csrfToken, this._idempotency('recover'));
      this._prepared = { ...prepared, run: result.run };
      this._completedOperation();
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
        ${this._prepared ? this._preparedView(this._prepared) : nothing}
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
            <select .value=${this._network} @change=${(event: Event) => { this._network = (event.target as HTMLSelectElement).value as Network; this._newInput(); }} ?disabled=${this._busy}>
              <option value="regtest">regtest (local lab)</option><option value="devnet">devnet</option>
            </select>
          </label>
          <label><span>Mode</span>
            <select .value=${this._mode} @change=${(event: Event) => { this._mode = (event.target as HTMLSelectElement).value as Mode; this._newInput(); }} ?disabled=${this._busy}>
              <option value="dry-run">dry-run</option><option value="live">live (lab only)</option>
            </select>
          </label>
          <label><span>Deterministic seed</span><input type="text" .value=${this._seed} @input=${(event: Event) => { this._seed = (event.target as HTMLInputElement).value; this._newInput(); }} ?disabled=${this._busy} required /></label>
          <label class="parameters"><span>Typed scenario parameters (JSON)</span><textarea .value=${this._parameters} @input=${(event: Event) => { this._parameters = (event.target as HTMLTextAreaElement).value; this._newInput(); }} ?disabled=${this._busy} spellcheck="false" required></textarea></label>
        </div>
        <div class="form-foot">
          <span class="warning">${descriptor ? `${descriptor.riskClass.toUpperCase()} RISK — ${descriptor.description}` : 'Loading scenario allowlist…'}</span>
          <button class="btn primary" type="submit" ?disabled=${this._busy || descriptor === null}>${this._busy ? 'Preparing…' : 'Prepare dry-run preview'}</button>
        </div>
      </form>
    `;
  }

  private _preparedView(prepared: PreparedRun): TemplateResult {
    return html`
      ${this._preview(prepared.plan)}
      ${this._preflight(prepared)}
      ${this._approvalAndRecovery(prepared)}
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

  private _preflight(prepared: PreparedRun): TemplateResult {
    const preflight = prepared.preflight;
    return html`
      <section class="card">
        <div class="card-head"><div class="card-title">2. Preflight</div><div class="page-sub mono">${preflight ? (preflight.passed ? 'passed' : 'blocked') : 'not run'}</div></div>
        ${preflight === null
          ? html`<div class="card-body"><p class="intro">The server verifies chain identity, data quality, target mapping and recovery readiness before this plan can be armed.</p><div class="actions" style="margin-top:var(--sp-4)"><button class="btn primary" ?disabled=${this._busy} @click=${this._validate}>Validate preflight</button></div></div>`
          : html`<ul class="check-list">${preflight.checks.map((check) => html`<li class=${check.passed ? 'passed' : 'failed'}><strong>${check.passed ? '✓' : '×'} ${check.checkId}</strong> — ${check.publicMessage}</li>`)}</ul>`}
      </section>
    `;
  }

  private _approvalAndRecovery(prepared: PreparedRun): TemplateResult {
    const run = prepared.run;
    const isArmed = run.state.status === 'armed';
    const mayApprove = prepared.descriptor.riskClass !== 'high' || this.session?.role === 'safety-admin';
    const canAbort = run.state.live && !['completed', 'aborted', 'rejected'].includes(run.state.status);
    const needsRecovery = run.state.faultMayBeActive || run.state.status === 'failed';
    return html`
      <section class="card">
        <div class="card-head"><div class="card-title">3. Approval and recovery</div><div class="page-sub mono">${run.state.status}</div></div>
        <div class="approval">
          <div class="state-line">Run <strong class="mono">${run.runKey}</strong> is <strong>${run.state.status}</strong>${run.state.live ? ' (live lab run)' : ' (dry-run)'}.</div>
          ${run.state.faultLeaseExpiresAtMs !== null ? html`<div class="countdown">Fault lease: ${countdown(run.state.faultLeaseExpiresAtMs, this._now)}</div>` : nothing}
          ${run.recovery ? html`<div class=${run.recovery.allClear ? 'recovery-ok' : 'recovery-bad'}>Recovery proof: ${run.recovery.allClear ? 'all targets clear' : 'manual attention required'} (${num(run.recovery.targets.length)} targets checked)</div>` : nothing}
          ${run.state.status === 'scheduled'
            ? html`
                <label><input type="checkbox" .checked=${this._riskAcknowledged} @change=${(event: Event) => { this._riskAcknowledged = (event.target as HTMLInputElement).checked; }} ?disabled=${this._busy || !mayApprove} />
                  <span>I acknowledge the server-declared <strong>${prepared.descriptor.riskClass}</strong> risk for “${prepared.descriptor.title}”.</span>
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
