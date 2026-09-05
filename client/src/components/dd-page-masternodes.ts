import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { MasternodeRow } from '@devnet-deftrack/shared';
import { api } from '../lib/api.js';
import { ago, num } from '../lib/format.js';
import { baseStyles, cardStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';

const REFRESH_MS = 30_000;

export class DdPageMasternodes extends LitElement {
  static override properties = {
    _rows: { state: true },
    _total: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  private _rows: MasternodeRow[] = [];
  private _total = 0;
  private _error = '';
  private _loading = true;
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    pageStyles,
    css`
      .bar {
        display: inline-block;
        height: 6px;
        background: var(--warn);
        vertical-align: middle;
        margin-left: 6px;
      }
      td.host {
        color: var(--ink-2);
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
      const p = await api.masternodes({ limit: 200 });
      this._rows = p.items;
      this._total = p.total;
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    } finally {
      this._loading = false;
    }
  }

  /** Counts per host, so a whole machine failing is visible as a machine. */
  private _byHost(): Array<{ host: string; total: number; banned: number; penalised: number }> {
    const map = new Map<string, { total: number; banned: number; penalised: number }>();
    for (const m of this._rows) {
      const key = m.hostLabel ?? '(unknown)';
      const e = map.get(key) ?? { total: 0, banned: 0, penalised: 0 };
      e.total++;
      if (m.banned) e.banned++;
      if (m.poSePenalty > 0) e.penalised++;
      map.set(key, e);
    }
    return [...map.entries()]
      .map(([host, v]) => ({ host, ...v }))
      .sort((a, b) => b.banned - a.banned || b.penalised - a.penalised || a.host.localeCompare(b.host));
  }

  override render(): TemplateResult {
    const banned = this._rows.filter((m) => m.banned).length;
    const penalised = this._rows.filter((m) => m.poSePenalty > 0).length;
    const maxPenalty = this._rows.reduce((m, r) => Math.max(m, r.poSePenalty), 0);

    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Masternodes</div>
          <div class="page-sub">
            Current state per masternode. Sorted so anything banned or carrying a penalty is at the
            top, because that is what the page is for.
          </div>
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}

      <section class="tiles">
        <dd-stat label="Registered" value=${num(this._total)} sub="on the devnet"></dd-stat>
        <dd-stat
          label="Banned"
          value=${num(banned)}
          sub=${banned === 0 ? 'none' : 'PoSe'}
          tone=${banned === 0 ? 'good' : 'crit'}
        ></dd-stat>
        <dd-stat
          label="Carrying a penalty"
          value=${num(penalised)}
          sub="highest ${num(maxPenalty)}"
          tone=${penalised === 0 ? 'good' : 'warn'}
        ></dd-stat>
        <dd-stat label="Hosts" value=${num(this._byHost().length)} sub="distinct addresses"></dd-stat>
      </section>

      ${this._hostTable()} ${this._table()}
    `;
  }

  private _hostTable(): TemplateResult {
    const hosts = this._byHost();
    return html`
      <section class="card">
        <div class="card-head"><div class="card-title">By host</div></div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr>
                  <th>Host</th>
                  <th class="r">Masternodes</th>
                  <th class="r">Banned</th>
                  <th class="r">Penalised</th>
                </tr>
              </thead>
              <tbody>
                ${hosts.length === 0
                  ? html`<tr><td class="empty" colspan="4">No masternodes recorded yet.</td></tr>`
                  : hosts.map(
                      (h) => html`
                        <tr>
                          <td class="mono">${h.host}</td>
                          <td class="r mono">${num(h.total)}</td>
                          <td class="r mono">${h.banned > 0 ? num(h.banned) : '—'}</td>
                          <td class="r mono">${h.penalised > 0 ? num(h.penalised) : '—'}</td>
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

  private _table(): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">All masternodes</div>
          <div class="page-sub mono">${num(this._total)} registered</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr>
                  <th>ProTx</th>
                  <th>Service</th>
                  <th>Operator</th>
                  <th class="c">State</th>
                  <th class="r">PoSe penalty</th>
                  <th class="r">Registered</th>
                  <th class="r">Last paid</th>
                  <th class="r">Seen</th>
                </tr>
              </thead>
              <tbody>
                ${this._loading && this._rows.length === 0
                  ? html`<tr><td class="empty" colspan="8">Loading…</td></tr>`
                  : this._rows.length === 0
                    ? html`<tr><td class="empty" colspan="8">No masternodes registered yet.</td></tr>`
                    : this._rows.map((m) => this._row(m))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  private _row(m: MasternodeRow): TemplateResult {
    return html`
      <tr>
        <td class="mono">${m.proTxHash.slice(0, 12)}…</td>
        <td class="mono host">${m.service ?? '—'}</td>
        <td>${m.operatorLabel ?? html`<span class="muted">unattributed</span>`}</td>
        <td class="c">
          <span class="pill ${m.banned ? 'failed' : 'formed'}">${m.banned ? 'banned' : 'enabled'}</span>
        </td>
        <td class="r mono">
          ${m.poSePenalty === 0
            ? '—'
            : html`${num(m.poSePenalty)}<i
                  class="bar"
                  style=${`width:${Math.min(60, m.poSePenalty / 2)}px`}
                ></i>`}
        </td>
        <td class="r mono">${num(m.registeredHeight)}</td>
        <td class="r mono">${m.lastPaidHeight > 0 ? num(m.lastPaidHeight) : '—'}</td>
        <td class="r mono">${ago(m.lastSeenAt)}</td>
      </tr>
    `;
  }
}

customElements.define('dd-page-masternodes', DdPageMasternodes);
