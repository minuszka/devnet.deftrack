import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { api, type SelectionFairness } from '../lib/api.js';
import { num, ratio } from '../lib/format.js';
import { baseStyles, cardStyles, controlStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';

const REFRESH_MS = 60_000;
const WINDOWS = [20, 50, 100, 250];

export class DdPageFairness extends LitElement {
  static override properties = {
    _d: { state: true },
    _rounds: { state: true },
    _error: { state: true },
  };

  private _d: SelectionFairness | null = null;
  private _rounds = 50;
  private _error = '';
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    controlStyles,
    pageStyles,
    css`
      .caveat {
        padding: 10px 14px;
        border-top: 1px solid var(--line-soft);
        color: var(--ink-3);
        font-size: 12px;
        line-height: 1.55;
      }
      .bar {
        display: inline-block;
        width: 90px;
        height: 8px;
        background: var(--surface-3);
        border: 1px solid var(--line);
        vertical-align: middle;
        margin-right: 8px;
      }
      .bar > i {
        display: block;
        height: 100%;
        background: var(--accent-dim);
      }
      .bar.over > i {
        background: var(--warn);
      }
      .bar.under > i {
        background: var(--info, var(--accent-dim));
      }
      .none {
        color: var(--ink-3);
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

  private async _load(): Promise<void> {
    try {
      this._d = await api.selectionFairness(this._rounds);
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    }
  }

  private _setWindow(n: number): void {
    this._rounds = n;
    void this._load();
  }

  override render(): TemplateResult {
    const d = this._d;
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Selection fairness</div>
          <div class="page-sub">
            Who the selection reaches, and who fails once reached — two different questions, and only
            the second is a fault.
          </div>
        </div>
        <div class="seg">
          ${WINDOWS.map(
            (n) => html`
              <button class=${this._rounds === n ? 'on' : ''} @click=${() => this._setWindow(n)}>
                ${num(n)}
              </button>
            `
          )}
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
      ${!d
        ? html`<div class="note">Loading…</div>`
        : d.roundsConsidered === 0
          ? html`<div class="note">
              No round has formed yet, so there is no member list to count. Selection can only be
              measured on rounds that produced a commitment.
            </div>`
          : html`${this._tiles(d)} ${this._hosts(d)} ${this._nodes(d)} ${this._missing(d)}`}
    `;
  }

  private _tiles(d: SelectionFairness): TemplateResult {
    const worst = d.nodes.find((n) => n.invalidRate !== null && n.invalidRate > 0);
    const totalInvalid = d.nodes.reduce((sum, n) => sum + n.timesInvalid, 0);

    return html`
      <section class="tiles">
        <dd-stat
          label="Formed rounds"
          value=${num(d.roundsConsidered)}
          sub=${d.heightRange
            ? `heights ${num(d.heightRange.from)}–${num(d.heightRange.to)}`
            : 'no range'}
        ></dd-stat>
        <dd-stat
          label="Expected selection"
          value=${d.expectedSelectionRate === null ? '—' : ratio(d.expectedSelectionRate)}
          sub="what chance alone would give each node"
        ></dd-stat>
        <dd-stat
          label="Never selected"
          value=${num(d.neverSelectedCount)}
          sub="masternodes no round ever chose"
          tone=${d.neverSelectedCount > 0 ? 'warn' : 'good'}
        ></dd-stat>
        <dd-stat
          label="Invalid members"
          value=${num(totalInvalid)}
          sub=${worst ? `worst node ${ratio(worst.invalidRate)}` : 'no member failed'}
          tone=${totalInvalid > 0 ? 'crit' : 'good'}
        ></dd-stat>
      </section>
    `;
  }

  /** Selection rate against chance, as a bar the eye can compare across rows. */
  private _rateBar(rate: number, expected: number | null): TemplateResult {
    const ref = expected && expected > 0 ? expected : 1;
    const relative = Math.min(2, rate / ref);
    const cls = expected === null ? '' : relative > 1.15 ? 'over' : relative < 0.85 ? 'under' : '';
    return html`<span class="bar ${cls}"><i style="width:${(relative / 2) * 100}%"></i></span>`;
  }

  private _hosts(d: SelectionFairness): TemplateResult {
    const maxSelected = Math.max(...d.hosts.map((h) => h.timesSelected), 1);
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">By host</div>
          <div class="page-sub mono">${num(d.hosts.length)} hosts</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr>
                  <th>Host</th>
                  <th class="r">Masternodes</th>
                  <th class="r">Selections</th>
                  <th>Share of the busiest</th>
                  <th class="r">Invalid</th>
                  <th class="r">Failure rate</th>
                </tr>
              </thead>
              <tbody>
                ${d.hosts.map(
                  (h) => html`
                    <tr>
                      <td class="mono">${h.host}</td>
                      <td class="r mono">${num(h.nodes)}</td>
                      <td class="r mono">${num(h.timesSelected)}</td>
                      <td>
                        <span class="bar"
                          ><i style="width:${((h.timesSelected / maxSelected) * 100).toFixed(0)}%"></i
                        ></span>
                        <span class="mono">${ratio(h.timesSelected / maxSelected)}</span>
                      </td>
                      <td class="r mono ${h.timesInvalid > 0 ? 'bad' : ''}">${num(h.timesInvalid)}</td>
                      <td class="r mono">
                        ${h.invalidRate === null
                          ? html`<span class="none">too few</span>`
                          : ratio(h.invalidRate)}
                      </td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          </div>
          <div class="caveat">
            Ten masternodes on one machine are not ten independent participants, so the same rounds
            are counted per host as well as per node. An uneven column here is a property of the
            selection, not a fault of anyone.
          </div>
        </div>
      </section>
    `;
  }

  private _nodes(d: SelectionFairness): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">By masternode</div>
          <div class="page-sub mono">worst first · ${num(d.nodes.length)} shown</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr>
                  <th>proTxHash</th>
                  <th>Host</th>
                  <th>Operator</th>
                  <th class="r">Selections</th>
                  <th>Against chance</th>
                  <th class="r">Invalid</th>
                  <th class="r">Failure rate</th>
                </tr>
              </thead>
              <tbody>
                ${d.nodes.slice(0, 40).map(
                  (n) => html`
                    <tr>
                      <td class="mono">${n.proTxHash}…</td>
                      <td class="mono">${n.host ?? '—'}</td>
                      <td>${n.operatorLabel ?? '—'}</td>
                      <td class="r mono">${num(n.timesSelected)}</td>
                      <td>
                        ${this._rateBar(n.selectionRate, d.expectedSelectionRate)}
                        <span class="mono">${ratio(n.selectionRate)}</span>
                      </td>
                      <td class="r mono ${n.timesInvalid > 0 ? 'bad' : ''}">${num(n.timesInvalid)}</td>
                      <td class="r mono">
                        ${n.invalidRate === null
                          ? html`<span class="none">too few</span>`
                          : ratio(n.invalidRate)}
                      </td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          </div>
          <div class="caveat">
            A failure rate is withheld below ${num(d.minSamples)} selections: one failure out of two
            is two data points, not fifty percent, and printing that beside a node with hundreds of
            selections invites exactly the wrong comparison. The bar compares each node against
            ${d.expectedSelectionRate === null ? 'chance' : ratio(d.expectedSelectionRate)}, the rate
            chance alone would give it.
          </div>
        </div>
      </section>
    `;
  }

  private _missing(d: SelectionFairness): TemplateResult | typeof nothing {
    if (d.neverSelectedCount === 0) return nothing;
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Never selected</div>
          <div class="page-sub mono">${num(d.neverSelectedCount)}</div>
        </div>
        <div class="card-body">
          <div class="mono" style="font-size:12px;line-height:1.9">
            ${d.neverSelected.map((h) => html`${h}… `)}
          </div>
        </div>
        <div class="caveat">
          These masternodes are active but no round in this window chose them. They appear in no
          member list, so any table built only from members would omit them entirely — being passed
          over is the finding, and it is invisible unless stated.
        </div>
      </section>
    `;
  }
}

customElements.define('dd-page-fairness', DdPageFairness);
