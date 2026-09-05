import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { txKindLabel, type TxDetail, type TxRow } from '@devnet-deftrack/shared';
import { errorMessage, isAbortError } from '../lib/errors.js';
import { PollController, type PollRun } from '../lib/poll.js';
import { ago, coin, num, shortHash, utc } from '../lib/format.js';
import { baseStyles, cardStyles, pageStyles, pagerStyles, tableStyles } from '../styles/shared.js';

const PAGE_SIZE = 25;
const REFRESH_MS = 20_000;

/** Transaction-kind chips. The pager and its buttons are shared styles. */
const shared = css`
  .kind {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 1px 6px;
    border: 1px solid var(--line-strong);
    color: var(--ink-3);
  }
  .kind.coinstake {
    color: var(--s2);
    border-color: var(--s2);
  }
  .kind.special {
    color: var(--s4);
    border-color: var(--s4);
  }
  .kind.coinbase {
    color: var(--s3);
    border-color: var(--s3);
  }
`;

export class DdPageTxs extends LitElement {
  static override properties = {
    _rows: { state: true },
    _total: { state: true },
    _offset: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  private _rows: TxRow[] = [];
  private _total = 0;
  private _offset = 0;
  private _error = '';
  private _loading = true;
  /** Interval, visibility, cancellation and the sequence guard, in one place. */
  private readonly _poll = new PollController(this, {
    intervalMs: REFRESH_MS,
    load: (run) => this._load(run),
  });

  static override styles = [baseStyles, cardStyles, tableStyles, pageStyles, pagerStyles, shared];

  private async _load(run: PollRun): Promise<void> {
    try {
      const p = await run.api.txs({ limit: PAGE_SIZE, offset: this._offset });
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

  private _move(delta: number): void {
    this._offset = Math.max(0, this._offset + delta * PAGE_SIZE);
    this._poll.refresh();
  }

  override render(): TemplateResult {
    const to = Math.min(this._offset + PAGE_SIZE, this._total);
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Transactions</div>
          <div class="page-sub">
            A coinstake mints its reward, so its outputs exceed its inputs — it has no fee, and none
            is shown for it.
          </div>
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}

      <section class="card">
        <div class="card-head">
          <div class="card-title">Latest transactions</div>
          <div class="page-sub mono">${num(this._total)} indexed</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr>
                  <th>Txid</th>
                  <th class="c">Kind</th>
                  <th class="r">Height</th>
                  <th class="r">In</th>
                  <th class="r">Out</th>
                  <th class="r">Value out</th>
                  <th class="r">Minted</th>
                  <th class="r">Age</th>
                </tr>
              </thead>
              <tbody>
                ${this._loading && this._rows.length === 0
                  ? html`<tr><td class="empty" colspan="8">Loading…</td></tr>`
                  : this._rows.map(
                      (t) => html`
                        <tr>
                          <td class="mono"><a href="/tx/${t.txid}">${shortHash(t.txid, 12, 8)}</a></td>
                          <td class="c">
                            <span class="kind ${t.isCoinbase ? 'coinbase' : t.isCoinstake ? 'coinstake' : t.type !== 0 ? 'special' : ''}">
                              ${txKindLabel(t.type, t.isCoinbase, t.isCoinstake)}
                            </span>
                          </td>
                          <td class="r mono"><a href="/block/${t.height}">${num(t.height)}</a></td>
                          <td class="r mono">${num(t.vinCount)}</td>
                          <td class="r mono">${num(t.voutCount)}</td>
                          <td class="r mono">${t.voutCount === 0 ? html`<span class="muted">—</span>` : coin(t.valueOutSat)}</td>
                          <td class="r mono">${t.stakePaidSat === null ? html`<span class="muted">—</span>` : coin(t.stakePaidSat)}</td>
                          <td class="r mono">${ago(new Date(t.time * 1000).toISOString())}</td>
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
        </div>
      </section>
    `;
  }
}
customElements.define('dd-page-txs', DdPageTxs);

export class DdPageTx extends LitElement {
  static override properties = { param: {}, _tx: { state: true }, _error: { state: true } };
  param: string | null = null;
  private _tx: TxDetail | null = null;
  private _error = '';

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    pageStyles,
    pagerStyles,
    shared,
    css`
      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 6px 20px;
        margin: 0;
        padding: 12px 14px;
        font-size: var(--fs-sm);
      }
      dt {
        color: var(--ink-3);
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
      }
      dd {
        margin: 0;
        font-family: var(--font-mono);
        word-break: break-all;
      }
    `,
  ];

  /**
   * A detail page polls too: its ChainLock flag can still change under it. And
   * following a link from one of these to another starts a second load while
   * the first is in flight -- without the controller the slower answer wins,
   * and the page settles on the object the reader has just navigated away from.
   */
  private readonly _poll = new PollController(this, {
    intervalMs: REFRESH_MS,
    load: (run) => this._load(run),
  });

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('param')) this._poll.refresh();
  }

  private async _load(run: PollRun): Promise<void> {
    if (!this.param) return;
    try {
      const d = await run.api.tx(this.param);
      if (run.stale) return;
      this._tx = d;
      this._error = '';
    } catch (error) {
      if (run.stale || isAbortError(error)) return;
      this._tx = null;
      this._error = errorMessage(error);
    }
  }

  override render(): TemplateResult {
    const t = this._tx;
    if (this._error) return html`<div class="err">${this._error}</div>`;
    if (!t) return html`<div class="note">Loading…</div>`;

    const kind = t.isCoinbase ? 'coinbase' : t.isCoinstake ? 'coinstake' : 'normal';
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Transaction</div>
          <div class="page-sub mono">${t.txid}</div>
        </div>
      </div>

      <section class="card">
        <div class="card-head"><div class="card-title">${kind}</div></div>
        <dl>
          <dt>block</dt><dd><a href="/block/${t.height}">${num(t.height)}</a></dd>
          <dt>time</dt><dd>${utc(new Date(t.time * 1000).toISOString())}</dd>
          <dt>size</dt><dd>${num(t.size)} bytes</dd>
          <dt>version / type</dt><dd>${t.version} / ${t.type} (${txKindLabel(t.type, t.isCoinbase, t.isCoinstake)})</dd>
          <dt>value out</dt><dd>${coin(t.valueOutSat)} DFCN</dd>
          ${t.isCoinstake
            ? html`<dt>minted reward</dt>
                <dd>${t.stakePaidSat === null ? html`<span class="muted">—</span>` : html`${coin(t.stakePaidSat)} DFCN`}</dd>`
            : nothing}
          <dt>chainlocked</dt><dd>${t.hasChainLock ? 'yes' : 'no'}</dd>
        </dl>
      </section>

      <section class="card">
        <div class="card-head"><div class="card-title">Inputs (${num(t.vin.length)})</div></div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead><tr><th>Source</th><th class="r">Index</th></tr></thead>
              <tbody>
                ${t.vin.map(
                  (i) => html`
                    <tr>
                      <td class="mono">
                        ${i.coinbase
                          ? html`<span class="muted">newly minted</span>`
                          : html`<a href="/tx/${i.txid}">${shortHash(i.txid, 12, 8)}</a>`}
                      </td>
                      <td class="r mono">${i.vout === null ? '—' : num(i.vout)}</td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><div class="card-title">Outputs (${num(t.vout.length)})</div></div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead><tr><th class="r">#</th><th>Address</th><th>Script</th><th class="r">Value</th></tr></thead>
              <tbody>
                ${t.vout.map(
                  (o) => html`
                    <tr>
                      <td class="r mono">${o.n}</td>
                      <td class="mono">
                        ${o.address ?? html`<span class="muted">${o.scriptType === 'nulldata' ? 'burned' : 'no address'}</span>`}
                      </td>
                      <td class="mono muted">${o.scriptType}</td>
                      <td class="r mono">${coin(o.valueSat)}</td>
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
}
customElements.define('dd-page-tx', DdPageTx);
