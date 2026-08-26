import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { api, type ExperimentDetail, type ExperimentRow } from '../lib/api.js';
import { ago, num, ratio } from '../lib/format.js';
import { baseStyles, cardStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';

const REFRESH_MS = 60_000;

export class DdPageExperiments extends LitElement {
  static override properties = {
    runKey: { type: String },
    _rows: { state: true },
    _detail: { state: true },
    _error: { state: true },
  };

  runKey: string | null = null;
  private _rows: ExperimentRow[] = [];
  private _detail: ExperimentDetail | null = null;
  private _error = '';
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    pageStyles,
    css`
      .kv {
        display: grid;
        grid-template-columns: 170px 1fr;
        gap: 6px 14px;
        padding: 14px;
        font-size: 13px;
      }
      .kv dt {
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ink-3);
        margin: 0;
      }
      .kv dd {
        margin: 0;
      }
      .prose {
        white-space: pre-wrap;
        line-height: 1.55;
      }
      .delta.up {
        color: var(--good);
      }
      .delta.down {
        color: var(--crit);
      }
      .delta.flat {
        color: var(--ink-3);
      }
      .caveat {
        padding: 10px 14px;
        border-top: 1px solid var(--line-soft);
        color: var(--ink-3);
        font-size: 12px;
        line-height: 1.55;
      }
      .bad {
        color: var(--crit);
        font-weight: 600;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
    this._timer = window.setInterval(() => void this._load(), REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._timer !== null) clearInterval(this._timer);
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('runKey')) void this._load();
  }

  private async _load(): Promise<void> {
    try {
      if (this.runKey) {
        this._detail = await api.experiment(this.runKey);
      } else {
        this._rows = (await api.experiments()).items;
      }
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    }
  }

  override render(): TemplateResult {
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">${this.runKey ? 'Experiment' : 'Experiments'}</div>
          <div class="page-sub">
            What was done to the network, what was expected, and what actually happened — a result
            nobody can repeat is an anecdote.
          </div>
        </div>
      </div>
      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
      ${this.runKey ? this._detailView() : this._list()}
    `;
  }

  private _list(): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head"><div class="card-title">Recorded runs</div></div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Title</th>
                  <th class="c">Status</th>
                  <th class="r">Heights</th>
                  <th class="r">MN</th>
                  <th>Intervention</th>
                  <th class="r">Started</th>
                </tr>
              </thead>
              <tbody>
                ${this._rows.length === 0
                  ? html`<tr>
                      <td class="empty" colspan="7">
                        No experiment recorded yet. Open one through the admin API before changing
                        anything on the network.
                      </td>
                    </tr>`
                  : this._rows.map(
                      (r) => html`
                        <tr>
                          <td class="mono"><a href="/experiments/${r.runKey}">${r.runKey}</a></td>
                          <td>${r.title}</td>
                          <td class="c"><span class="pill ${r.status}">${r.status}</span></td>
                          <td class="r mono">
                            ${num(r.startHeight)}${r.endHeight === null ? '→' : `–${num(r.endHeight)}`}
                          </td>
                          <td class="r mono">${num(r.participants.masternodes)}</td>
                          <td>${r.intervention?.kind ?? '—'}</td>
                          <td class="r mono">${ago(r.startedAt)}</td>
                        </tr>
                      `
                    )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  private _detailView(): TemplateResult {
    const d = this._detail;
    if (!d) return html`<div class="note">Loading…</div>`;
    const o = d.outcome;

    return html`
      ${o
        ? html`
            <section class="tiles">
              <dd-stat
                label="Formation rate"
                value=${o.formationRate === null ? '—' : ratio(o.formationRate)}
                sub="${num(o.rounds.formed)} formed · ${num(o.rounds.failed)} failed"
              ></dd-stat>
              <dd-stat
                label="Median health"
                value=${o.medianHealthRatio === null ? '—' : ratio(o.medianHealthRatio)}
                sub=${o.worstHealthRatio === null ? 'no formed round' : `worst ${ratio(o.worstHealthRatio)}`}
              ></dd-stat>
              <dd-stat
                label="Masternodes punished"
                value=${num(o.masternodesPunished)}
                sub="${num(o.banEvents)} ban · ${num(o.penaltyIncreases)} penalty"
                tone=${o.masternodesPunished > 0 ? 'warn' : 'good'}
              ></dd-stat>
              <dd-stat
                label="ChainLock coverage"
                value=${o.chainLockCoverage === null ? '—' : ratio(o.chainLockCoverage)}
                sub="${num(o.chainLockedBlocks)} of ${num(o.blocks)} blocks"
              ></dd-stat>
            </section>
          `
        : nothing}
      ${this._found(d)} ${this._byProfile(d)} ${this._declared(d)}
      ${d.comparison ? this._comparison(d) : nothing}
    `;
  }

  /**
   * What the run concluded, in prose.
   *
   * Placed above the declaration on purpose: a reader who scrolls no further
   * should still get the finding rather than the intention, and the two must
   * never be confused for one another.
   */
  private _found(d: ExperimentDetail): TemplateResult | typeof nothing {
    if (!d.notes) return nothing;
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">What it found</div>
          <div class="page-sub mono">recorded after the numbers froze</div>
        </div>
        <div class="card-body">
          <div class="prose">${d.notes}</div>
        </div>
      </section>
    `;
  }

  /**
   * The same window, per quorum type.
   *
   * Blending them hides the finding: the profiles close rounds at different
   * rates, so the frequent one dominates every total while the type that
   * actually degraded disappears into the average.
   */
  private _byProfile(d: ExperimentDetail): TemplateResult | typeof nothing {
    const rows = d.outcome?.byProfile ?? [];
    if (rows.length === 0) return nothing;

    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">By quorum type</div>
          <div class="page-sub mono">${num(rows.length)} tracked</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th class="r">Every</th>
                  <th class="r">Formed</th>
                  <th class="r">Failed</th>
                  <th class="r">Pending</th>
                  <th class="r">Impossible</th>
                  <th class="r">Formation</th>
                  <th class="r">Median health</th>
                  <th class="r">Worst</th>
                  <th class="r">Members punished</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(
                  (p) => html`
                    <tr>
                      <td class="mono">${p.llmqName}</td>
                      <td class="r mono">${num(p.dkgInterval)} blk</td>
                      <td class="r mono">${num(p.rounds.formed)}</td>
                      <td class="r mono ${p.rounds.failed > 0 ? 'bad' : ''}">
                        ${num(p.rounds.failed)}
                      </td>
                      <td class="r mono">${num(p.rounds.pending)}</td>
                      <td class="r mono ${p.rounds.impossible > 0 ? 'muted' : ''}">
                        ${num(p.rounds.impossible)}
                      </td>
                      <td class="r mono">
                        ${p.formationRate === null ? '—' : ratio(p.formationRate)}
                      </td>
                      <td class="r mono">
                        ${p.medianHealthRatio === null ? '—' : ratio(p.medianHealthRatio)}
                      </td>
                      <td class="r mono ${(p.worstHealthRatio ?? 1) < 0.5 ? 'bad' : ''}">
                        ${p.worstHealthRatio === null ? '—' : ratio(p.worstHealthRatio)}
                      </td>
                      <td class="r mono ${p.membersPunished > 0 ? 'bad' : ''}">
                        ${num(p.membersPunished)}
                      </td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          </div>
          <div class="caveat">
            A failed round mines no commitment, so only the reconstructed schedule shows it was
            ever due — and that reconstruction runs per type. Rounds are counted separately
            because the intervals differ: one type can hold a perfect record while another
            degrades, and a single blended rate would report neither.
            <br /><br />
            <strong>Impossible</strong> is not a softer word for failed. A profile needing more
            members than the network has cannot form however well every masternode behaves —
            llmq_400_85 asks for 350 against a devnet of at most 80 — so those rounds are held
            out of the formation rate rather than counted against it.
          </div>
        </div>
      </section>
    `;
  }

  private _declared(d: ExperimentDetail): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Declared before the run</div>
          <div class="page-sub mono">${d.status}</div>
        </div>
        <div class="card-body flush">
          <dl class="kv">
            <dt>Title</dt><dd>${d.title}</dd>
            <dt>Hypothesis</dt><dd class="prose">${d.hypothesis || '—'}</dd>
            <dt>Expected</dt><dd class="prose">${d.expected || '—'}</dd>
            <dt>Intervention</dt>
            <dd class="prose">
              ${d.intervention
                ? `${d.intervention.kind}: ${d.intervention.description} (${d.intervention.targets.length} target(s))`
                : 'none — observation only'}
            </dd>
            <dt>Node</dt>
            <dd class="mono">v${d.nodeVersion}${d.nodeGitSha ? ` @ ${d.nodeGitSha.slice(0, 10)}` : ''}</dd>
            <dt>Profile</dt>
            <dd class="mono">
              ${d.profile.llmqName} · size ${num(d.profile.size)} / min ${num(d.profile.minSize)} /
              threshold ${num(d.profile.threshold)} · dkgInterval ${num(d.profile.dkgInterval)}
            </dd>
            <dt>Participants</dt>
            <dd class="mono">
              ${num(d.participants.masternodes)} masternodes on ${num(d.participants.hosts)} hosts ·
              ${num(d.participants.stakers)} staker(s)
              <span class="muted">at open</span>
            </dd>
            ${d.currentParticipants
              ? html`
                  <dt>Right now</dt>
                  <dd class="mono">
                    ${num(d.currentParticipants.masternodes)} masternodes on
                    ${num(d.currentParticipants.hosts)} hosts ·
                    ${num(d.currentParticipants.stakers)} staker(s)
                    <span class="muted">height ${num(d.tipHeight)}</span>
                  </dd>
                `
              : nothing}
            <dt>Window</dt>
            <dd class="mono">
              height ${num(d.startHeight)}${d.endHeight === null
                ? ' → open'
                : `–${num(d.endHeight)}`}
            </dd>
          </dl>
        </div>
      </section>
    `;
  }

  /** A difference is only worth showing next to what it is a difference from. */
  private _comparison(d: ExperimentDetail): TemplateResult {
    const c = d.comparison!;
    const rows: Array<[string, number | null, number | null, number | null, boolean]> = [
      ['Formation rate', d.outcome?.formationRate ?? null, c.baseline.formationRate, c.delta.formationRate, true],
      ['Median health', d.outcome?.medianHealthRatio ?? null, c.baseline.medianHealthRatio, c.delta.medianHealthRatio, true],
      ['ChainLock coverage', d.outcome?.chainLockCoverage ?? null, c.baseline.chainLockCoverage, c.delta.chainLockCoverage, true],
      ['Masternodes punished', d.outcome?.masternodesPunished ?? null, c.baseline.masternodesPunished, c.delta.masternodesPunished, false],
      ['Median block interval (s)', d.outcome?.medianBlockIntervalSec ?? null, c.baseline.medianBlockIntervalSec, c.delta.medianBlockIntervalSec, false],
    ];

    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Against baseline</div>
          <div class="page-sub mono">${c.baselineRunKey}</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr><th>Measure</th><th class="r">This run</th><th class="r">Baseline</th><th class="r">Δ</th></tr>
              </thead>
              <tbody>
                ${rows.map(([label, run, base, delta, isRatio]) => {
                  // Higher is better for the ratios, worse for punishments and
                  // block spacing -- so the sign alone cannot pick the colour.
                  const better = delta === null || delta === 0 ? 'flat' : (delta > 0) === isRatio ? 'up' : 'down';
                  const fmt = (v: number | null): string =>
                    v === null ? '—' : isRatio ? ratio(v) : num(Math.round(v * 100) / 100);
                  return html`
                    <tr>
                      <td>${label}</td>
                      <td class="r mono">${fmt(run)}</td>
                      <td class="r mono">${fmt(base)}</td>
                      <td class="r mono delta ${better}">
                        ${delta === null ? '—' : `${delta > 0 ? '+' : ''}${fmt(delta)}`}
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }
}

customElements.define('dd-page-experiments', DdPageExperiments);
