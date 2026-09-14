import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { ApiError } from '../lib/api.js';
import { errorMessage, isAbortError } from '../lib/errors.js';
import { PollController, type PollRun } from '../lib/poll.js';
import { QueryStateController, pageToOffset, type ParamSpec } from '../lib/queryState.js';
import { ago, num } from '../lib/format.js';
import {
  buildSimulationExport,
  readSimulation,
  RUN_KEY_PATTERN,
  type PublicSimulationRunView,
  type Reading,
  type SettledReportState,
} from '../lib/simulations.js';
import { TableScrollController } from '../lib/tableScroll.js';
import { baseStyles, cardStyles, pageStyles, pagerStyles, tableStyles } from '../styles/shared.js';

const REFRESH_MS = 30_000;
const PAGE_SIZE = 25;

const QUERY: Record<string, ParamSpec> = {
  page: { kind: 'page', limit: PAGE_SIZE },
};

/**
 * What a detail request found.
 *
 * Four answers, and the first two are the ones that matter: a run that does not
 * exist and a run that exists but has no measurement are both a 404 from the
 * server, on different endpoints, and saying "not found" for the second would
 * tell a reader their link was wrong when it was simply early.
 */
type DetailState =
  | { kind: 'loading' }
  | { kind: 'malformed' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; run: PublicSimulationRunView; report: SettledReportState; fetchedAtMs: number };

/**
 * The public simulation results: every run, and what its measurement says.
 *
 * Separate from Experiments and not merged into it. An experiment is a run
 * declared on the devnet; a simulation run is a planned fault in the lab with a
 * measured outcome. Side by side in one list, a dry-run plan would read as the
 * same kind of evidence as a live rollout.
 */
export class DdPageSimulations extends LitElement {
  /** Marks each table wrapper that scrolls sideways, and which way there is more. */
  private readonly _tables = new TableScrollController(this);
  static override properties = {
    runKey: { type: String },
    _rows: { state: true },
    _total: { state: true },
    _offset: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _detail: { state: true },
  };

  runKey: string | null = null;
  private _rows: PublicSimulationRunView[] = [];
  /**
   * The offset the rows on hand were read at, or null. See dd-page-blocks: while
   * page 2 loaded, page 1's runs stood under "26–30 of 30".
   */
  private _heldFor: number | null = null;
  private _total = 0;
  private _offset = 0;
  /** Loading is not empty: the two look alike and mean opposite things. */
  private _loading = true;
  private _error = '';
  private _detail: DetailState = { kind: 'loading' };

  private readonly _query = new QueryStateController(this, QUERY, (values) => {
    this._applyQuery(values);
    this._poll.refresh();
  });

  private readonly _poll = new PollController(this, {
    intervalMs: REFRESH_MS,
    load: (run) => this._load(run),
  });

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    pageStyles,
    pagerStyles,
    css`
      .reading {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: var(--fs-sm);
        font-weight: 600;
      }
      .reading::before {
        content: '';
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--ink-3);
      }
      .reading.good::before { background: var(--good); }
      .reading.warn::before { background: var(--warn); }
      .reading.crit::before { background: var(--crit); }
      .kv {
        display: grid;
        grid-template-columns: 190px 1fr;
        gap: 6px 14px;
        padding: 14px;
        font-size: var(--fs-sm);
        margin: 0;
      }
      .kv dt {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ink-3);
      }
      .kv dd { margin: 0; }
      .verdict {
        padding: 14px;
        border-bottom: 1px solid var(--line-soft);
      }
      .verdict p { margin: 6px 0 0; color: var(--ink-2); font-size: var(--fs-sm); line-height: 1.55; }
      .banner {
        padding: 10px 14px;
        border: 1px solid var(--line);
        background: var(--surface-2);
        color: var(--ink-2);
        font-size: var(--fs-sm);
        line-height: 1.5;
        margin-bottom: var(--sp-3);
      }
      .export { display: flex; gap: var(--sp-2); align-items: center; padding: 14px; }
      .export small { color: var(--ink-3); font-size: var(--fs-xs); }
      .none { color: var(--ink-3); }
      .back { margin: var(--sp-4) 0 0; font-size: var(--fs-sm); }
      @media (max-width: 640px) {
        .kv { grid-template-columns: 1fr; }
      }
    `,
  ];

  override connectedCallback(): void {
    this._applyQuery(this._query.values);
    super.connectedCallback();
  }

  override updated(changed: Map<string, unknown>): void {
    // A real change only; see dd-page-experiments for why the first update is not one.
    if (changed.has('runKey') && changed.get('runKey') !== undefined) {
      // What is held belongs to the run that was on screen a moment ago.
      this._detail = { kind: 'loading' };
      this._rows = [];
      this._heldFor = null;
      this._total = 0;
      this._error = '';
      this._poll.refresh();
    }
  }

  private _applyQuery(values: Record<string, string | number | null>): void {
    const page = values['page'];
    this._offset = pageToOffset(typeof page === 'number' ? page : 1, PAGE_SIZE);
  }

  private _page(): number {
    const page = this._query.values['page'];
    return typeof page === 'number' ? page : 1;
  }

  private async _load(run: PollRun): Promise<void> {
    if (this.runKey) {
      await this._loadDetail(run, this.runKey);
      return;
    }
    this._loading = true;
    try {
      const offset = this._offset;
      const result = await run.api.simulations({ limit: PAGE_SIZE, offset });
      if (run.stale) return;
      this._rows = result.items;
      this._total = result.total;
      this._heldFor = offset;
      this._error = '';
    } catch (error) {
      if (run.stale || isAbortError(error)) return;
      this._error = errorMessage(error);
    } finally {
      if (!run.stale) this._loading = false;
    }
  }

  /**
   * The run first, then its report -- and each 404 read for what it means.
   *
   * Asking for the report alone could not tell the two apart: `/report` answers
   * 404 both for a run with no measurement and for a run that does not exist.
   * The run's own endpoint settles which, so it is asked first.
   */
  private async _loadDetail(run: PollRun, runKey: string): Promise<void> {
    if (!RUN_KEY_PATTERN.test(runKey)) {
      this._detail = { kind: 'malformed' };
      return;
    }
    let found: PublicSimulationRunView;
    try {
      found = await run.api.simulation(runKey);
      if (run.stale) return;
    } catch (error) {
      if (run.stale || isAbortError(error)) return;
      this._detail =
        error instanceof ApiError && error.status === 404
          ? { kind: 'missing' }
          : { kind: 'error', message: errorMessage(error) };
      return;
    }

    let report: SettledReportState;
    try {
      report = { kind: 'present', report: await run.api.simulationReport(runKey) };
    } catch (error) {
      if (run.stale || isAbortError(error)) return;
      // The run exists -- established just above -- so a 404 here is "not
      // measured yet", and anything else is the report being unreadable.
      report =
        error instanceof ApiError && error.status === 404
          ? { kind: 'absent' }
          : { kind: 'error', message: errorMessage(error) };
    }
    if (run.stale) return;
    this._detail = { kind: 'loaded', run: found, report, fetchedAtMs: Date.now() };
  }

  private _move(delta: number): void {
    this._query.set({ page: Math.max(1, this._page() + delta) });
  }

  override render(): TemplateResult {
    return html`
      <div class="page-head">
        <div>
          <h1 class="page-title" tabindex="-1">${this.runKey ? 'Simulation run' : 'Simulations'}</h1>
          <div class="page-sub">
            Planned faults run in the lab, and what their measurement says. Separate from Experiments,
            which are runs declared on the devnet itself.
          </div>
        </div>
      </div>
      ${this.runKey ? this._detailView() : this._list()}
    `;
  }

  /* ── list ─────────────────────────────────────────────────────────────── */

  private _list(): TemplateResult {
    // The rows on hand are shown only under the page they were read for.
    const current = this._heldFor === this._offset;
    const error = this._error ? html`<div class="err" role="alert">${this._error}</div>` : nothing;
    /*
     * A failure with nothing held for this page is the failure alone: no
     * invented empty record. A failure with this page's rows on hand -- a
     * refresh of the same page that failed -- keeps them beside the error.
     *
     * The error used to be returned before that question was asked, so a
     * single failed refresh threw away a list that was still true (W1 of the
     * re-review); every other paged page keeps its last good rows (day 3).
     */
    if (!current && this._error) return html`${error}`;
    const to = Math.min(this._offset + PAGE_SIZE, this._total);
    return html`
      ${error}
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">Recorded runs</h2>
          <div class="page-sub mono">${!current ? '' : `${num(this._total)} total`}</div>
        </div>
        <div class="card-body flush">
          ${!current
            ? html`<div class="note">Loading…</div>`
            : this._total === 0
              ? html`<div class="note">
                  No simulation run has been recorded on this deployment yet. Runs are prepared from the
                  private admin panel and appear here once they exist.
                </div>`
              : html`
                  <div class="twrap">
                    <table>
                      <caption class="sr-only">
                        Every recorded simulation run: scenario, mode, network, status and when it was created.
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Run</th>
                          <th scope="col">Scenario</th>
                          <th scope="col">Mode</th>
                          <th scope="col">Network</th>
                          <th scope="col">Status</th>
                          <th scope="col" class="r">Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${this._rows.map(
                          (r) => html`
                            <tr>
                              <td class="mono"><a href="/simulations/${r.runKey}">${r.runKey.slice(0, 16)}…</a></td>
                              <td>${r.scenario.title}</td>
                              <!-- Words, not only a colour: a dry run and a live run are
                                   different kinds of evidence, and that has to survive a
                                   greyscale screenshot. -->
                              <td>${r.state.live ? 'live lab' : 'dry run'}</td>
                              <td class="mono">${r.network}</td>
                              <td class="mono">${r.state.status}</td>
                              <td class="r">${ago(new Date(r.state.createdAtMs).toISOString())}</td>
                            </tr>
                          `
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div class="pager">
                    <button ?disabled=${this._offset === 0} @click=${() => this._move(-1)}>Newer</button>
                    <button ?disabled=${to >= this._total} @click=${() => this._move(1)}>Older</button>
                    <span>${num(this._offset + 1)}–${num(to)} of ${num(this._total)}</span>
                  </div>
                `}
        </div>
      </section>
    `;
  }

  /* ── detail ───────────────────────────────────────────────────────────── */

  private _detailView(): TemplateResult {
    const back = html`<p class="back"><a href="/simulations">&larr; All simulation runs</a></p>`;
    const d = this._detail;
    switch (d.kind) {
      case 'loading':
        return html`<div class="note">Loading…</div>`;
      case 'malformed':
        return html`<div class="err" role="alert">
            <b class="mono">${this.runKey}</b> is not a simulation run key. A run key is
            <span class="mono">sim_</span> followed by 32 hexadecimal characters.
          </div>
          ${back}`;
      case 'missing':
        return html`<div class="err" role="alert">
            No simulation run <b class="mono">${this.runKey}</b> exists on this deployment.
          </div>
          ${back}`;
      case 'error':
        return html`<div class="err" role="alert">${d.message}</div>
          ${back}`;
      case 'loaded':
        return html`${this._loaded(d.run, d.report, d.fetchedAtMs)} ${back}`;
    }
  }

  private _loaded(run: PublicSimulationRunView, report: SettledReportState, fetchedAtMs: number): TemplateResult {
    const reading = readSimulation(run, report);
    return html`
      ${run.state.live
        ? nothing
        : html`<div class="banner" role="note">
            <b>Dry run.</b> Nothing was done to a live network. The plan and any measurement below describe
            what was expected, not how a network behaved.
          </div>`}
      <section class="card">
        <div class="verdict">
          <span class="reading ${reading.tone}" data-reading=${reading.kind}>${reading.label}</span>
          ${reading.detail ? html`<p>${reading.detail}</p>` : nothing}
        </div>
        <dl class="kv run-facts">
          <dt>Run</dt><dd class="mono">${run.runKey}</dd>
          <dt>Scenario</dt><dd>${run.scenario.title} <span class="none mono">${run.scenario.id} v${run.scenario.version}</span></dd>
          <dt>Mode</dt><dd>${run.state.live ? 'Live, in the regtest lab' : 'Dry run'}</dd>
          <dt>Network</dt><dd class="mono">${run.network}</dd>
          <dt>Status</dt><dd class="mono">${run.state.status}</dd>
          <dt>Risk class</dt><dd>${run.scenario.riskClass}</dd>
          <dt>Seed</dt><dd class="mono">${run.scenario.seed}</dd>
          <dt>Targets</dt>
          <dd>
            ${run.targets.length === 0
              ? html`<span class="none">none recorded</span>`
              : run.targets.map((t) => html`<div><span class="mono">${t.targetId}</span> · ${t.displayLabel} · ${t.role}</div>`)}
          </dd>
        </dl>
      </section>
      ${this._measurement(run, report)}
      ${this._export(run, report, fetchedAtMs)}
    `;
  }

  /**
   * The measurement, when there is one -- its actual windows and its quality.
   *
   * Only what the public report carries. There is no field here for a
   * prediction from the Core simulator adapter, and none is shown: that
   * adapter's material is prior modelling, and a page that put it beside a
   * measured result would present a model as a forecast.
   */
  private _measurement(run: PublicSimulationRunView, report: SettledReportState): TemplateResult {
    if (report.kind !== 'present') {
      if (run.state.status !== 'completed') return html`${nothing}`;
      return html`<section class="card">
        <div class="card-head"><h2 class="card-title">Measurement</h2></div>
        <div class="note">
          ${report.kind === 'absent'
            ? 'No measurement has been recorded for this run yet.'
            : report.kind === 'error'
              ? `The measurement could not be read: ${report.message}`
              : 'Loading…'}
        </div>
      </section>`;
    }
    const r = report.report.report;
    const w = r.windows;
    const range = (x: { fromHeight: number; toHeight: number }) => `${num(x.fromHeight)}–${num(x.toHeight)}`;
    const q = r.observation.dataQuality;
    return html`
      <section class="card">
        <div class="card-head"><h2 class="card-title">Measurement</h2><div class="page-sub mono">${report.report.reportId}</div></div>
        <dl class="kv measurement-facts">
          <dt>Fault window</dt><dd class="mono">${num(report.report.anchor.faultStartHeight)}–${num(report.report.anchor.faultEndHeight)}</dd>
          <dt>Baseline</dt><dd class="mono">${range(w.baseline)}</dd>
          <dt>Observation</dt><dd class="mono">${range(w.observation)}</dd>
          <dt>Excluded</dt><dd class="mono">warm-up ${range(w.warmupExcluded)} · cool-down ${range(w.cooldownExcluded)}</dd>
          <dt>Expected vs actual</dt>
          <dd>
            ${(['dkg', 'chainLock', 'dsl'] as const).map((key) => {
              const row = r.expectedVsActual[key];
              return html`<div>
                <span class="mono">${key}</span>: expected <b>${row.expected}</b>, actual <b>${row.actual}</b>
                ${row.reason ? html`<span class="none"> — ${row.reason}</span>` : nothing}
              </div>`;
            })}
          </dd>
          <dt>Measurement valid</dt><dd>${r.verdict.measurementValid ? 'yes' : 'no'}</dd>
          <dt>Data quality</dt>
          <dd>
            ${q.sufficient ? 'sufficient' : 'insufficient'}, confidence ${q.confidence}
            ${q.reasons.length > 0 ? html`<div class="none">${q.reasons.join('; ')}</div>` : nothing}
          </dd>
        </dl>
      </section>
    `;
  }

  /**
   * The downloadable record, built from the two public responses and nothing
   * else. See `buildSimulationExport`.
   *
   * A data: URL rather than a blob: URL, so the link survives being opened in a
   * new tab and does not need revoking. The page is public, so is every byte in
   * the file, and the envelope says where each came from.
   */
  private _export(run: PublicSimulationRunView, report: SettledReportState, fetchedAtMs: number): TemplateResult {
    const exported = buildSimulationExport(run, report, fetchedAtMs);
    const href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(exported, null, 2))}`;
    return html`
      <section class="card">
        <div class="card-head"><h2 class="card-title">Export</h2></div>
        <div class="export">
          <a class="btn" href=${href} download=${`${run.runKey}.json`}>Download JSON</a>
          <small>
            schema v${exported.schemaVersion}, fetched ${exported.fetchedAt} — the public run and its public
            measurement, as served.
          </small>
        </div>
      </section>
    `;
  }
}

customElements.define('dd-page-simulations', DdPageSimulations);

export type { Reading };
