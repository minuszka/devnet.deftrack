import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { MasternodeRow } from '@devnet-deftrack/shared';
import { errorMessage, isAbortError } from '../lib/errors.js';
import { PollController, type PollRun } from '../lib/poll.js';
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
  /** Interval, visibility, cancellation and the sequence guard, in one place. */
  private readonly _poll = new PollController(this, {
    intervalMs: REFRESH_MS,
    load: (run) => this._load(run),
  });

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

  private async _load(run: PollRun): Promise<void> {
    try {
      const p = await run.api.masternodes({ limit: 200 });
      if (run.stale) return;
      this._rows = p.items;
      this._total = p.total;
      this._error = '';
    } catch (error) {
      if (run.stale || isAbortError(error)) return;
      this._error = errorMessage(error);
    } finally {
      if (!run.stale) this._loading = false;
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
              <caption class="sr-only">Masternodes grouped by the host they run on, with the bans and penalties of each.</caption>
              <thead>
                <tr>
                  <th scope="col">Host</th>
                  <th scope="col" class="r">Masternodes</th>
                  <th scope="col" class="r">Banned</th>
                  <th scope="col" class="r">Penalised</th>
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
              <caption class="sr-only">Every registered masternode with its PoSe state, penalty and Sentinel Layer ledger.</caption>
              <thead>
                <tr>
                  <th scope="col">ProTx</th>
                  <th scope="col">Service</th>
                  <th scope="col">Operator</th>
                  <th scope="col" class="c">State</th>
                  <th scope="col" class="r">PoSe penalty</th>
                  <th scope="col" class="r">Registered</th>
                  <th scope="col" class="r">Last paid</th>
                  <th scope="col" class="r">Seen</th>
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
