import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { txKindLabel, type BlockDetail, type BlockRow } from '@devnet-deftrack/shared';
import { api } from '../lib/api.js';
import { ago, coin, num, shortHash, utc } from '../lib/format.js';
import { baseStyles, cardStyles, pageStyles, tableStyles } from '../styles/shared.js';

const PAGE_SIZE = 25;
const REFRESH_MS = 20_000;

const pagerStyles = css`
  .pager {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-top: 1px solid var(--line-soft);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    color: var(--ink-3);
  }
  button {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: var(--surface-2);
    color: var(--ink-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 5px 11px;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--line-strong);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .tag {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 1px 6px;
    border: 1px solid var(--line-strong);
    color: var(--ink-3);
  }
  .tag.pos {
    color: var(--s2);
    border-color: var(--s2);
  }
  .tag.pow {
    color: var(--s3);
    border-color: var(--s3);
  }
  .tag.cl {
    color: var(--accent);
    border-color: var(--accent);
  }
  .burn {
    color: var(--ink-3);
  }
`;

export class DdPageBlocks extends LitElement {
  static override properties = {
    _rows: { state: true },
    _total: { state: true },
    _offset: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  private _rows: BlockRow[] = [];
  private _total = 0;
  private _offset = 0;
  private _error = '';
  private _loading = true;
  private _timer: number | null = null;

  static override styles = [baseStyles, cardStyles, tableStyles, pageStyles, pagerStyles];

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
      const p = await api.blocks({ limit: PAGE_SIZE, offset: this._offset });
      this._rows = p.items;
      this._total = p.total;
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    } finally {
      this._loading = false;
    }
  }

  private _move(delta: number): void {
    this._offset = Math.max(0, this._offset + delta * PAGE_SIZE);
    void this._load();
  }

  override render(): TemplateResult {
    const to = Math.min(this._offset + PAGE_SIZE, this._total);
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Blocks</div>
          <div class="page-sub">
            Heights up to 1000 are proof-of-work; above that the chain is proof-of-stake, so block
            spacing is not comparable across the boundary.
          </div>
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}

      <section class="card">
        <div class="card-head">
          <div class="card-title">Latest blocks</div>
          <div class="page-sub mono">${num(this._total)} indexed</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr>
                  <th class="r">Height</th>
                  <th>Hash</th>
                  <th class="c">Type</th>
                  <th class="r">Txs</th>
                  <th class="r">MN paid</th>
                  <th class="r">Stake paid</th>
                  <th class="r">Burned</th>
                  <th class="r">Size</th>
                  <th class="r">Age</th>
                </tr>
              </thead>
              <tbody>
                ${this._loading && this._rows.length === 0
                  ? html`<tr><td class="empty" colspan="9">Loading…</td></tr>`
                  : this._rows.map((b) => this._row(b))}
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

  private _row(b: BlockRow): TemplateResult {
    return html`
      <tr>
        <td class="r mono"><a href="/block/${b.height}">${num(b.height)}</a></td>
        <td class="mono"><a href="/block/${b.hash}">${shortHash(b.hash)}</a></td>
        <td class="c">
          <span class="tag ${b.isProofOfStake ? 'pos' : 'pow'}">${b.isProofOfStake ? 'PoS' : 'PoW'}</span>
          ${b.hasChainLock ? html`<span class="tag cl">CL</span>` : nothing}
        </td>
        <td class="r mono">${num(b.nTx)}</td>
        <td class="r mono">${coin(b.masternodePaidSat)}</td>
        <td class="r mono">${b.stakePaidSat === null ? html`<span class="muted">—</span>` : coin(b.stakePaidSat)}</td>
        <td class="r mono burn">${coin(b.burnedSat)}</td>
        <td class="r mono">${num(b.size)}</td>
        <td class="r mono" title=${utc(new Date(b.time * 1000).toISOString())}>
          ${ago(new Date(b.time * 1000).toISOString())}
        </td>
      </tr>
    `;
  }
}
customElements.define('dd-page-blocks', DdPageBlocks);

export class DdPageBlock extends LitElement {
  static override properties = { param: {}, _block: { state: true }, _error: { state: true } };
  param: string | null = null;
  private _block: BlockDetail | null = null;
  private _error = '';

  static override styles = [baseStyles, cardStyles, tableStyles, pageStyles, pagerStyles,
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

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('param')) void this._load();
  }

  private async _load(): Promise<void> {
    if (!this.param) return;
    try {
      this._block = await api.block(this.param);
      this._error = '';
    } catch (error) {
      this._block = null;
      this._error = error instanceof Error ? error.message : String(error);
    }
  }

  override render(): TemplateResult {
    const b = this._block;
    if (this._error) return html`<div class="err">${this._error}</div>`;
    if (!b) return html`<div class="note">Loading…</div>`;

    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Block ${num(b.height)}</div>
          <div class="page-sub mono">${b.hash}</div>
        </div>
      </div>

      <section class="card">
        <div class="card-head"><div class="card-title">Header</div></div>
        <dl>
          <dt>time</dt><dd>${utc(new Date(b.time * 1000).toISOString())}</dd>
          <dt>type</dt><dd>${b.isProofOfStake ? 'proof-of-stake' : 'proof-of-work'}${b.hasChainLock ? ' · chainlocked' : ''}</dd>
          <dt>transactions</dt><dd>${num(b.nTx)}</dd>
          <dt>size</dt><dd>${num(b.size)} bytes</dd>
          <dt>difficulty</dt><dd>${b.difficulty.toPrecision(6)}</dd>
          <dt>masternode paid</dt><dd>${coin(b.masternodePaidSat)} DFCN${b.payee ? html` → <span>${b.payee}</span>` : nothing}</dd>
          <dt>burned</dt><dd>${coin(b.burnedSat)} DFCN</dd>
          <dt>stake reward</dt>
          <dd>${b.stakePaidSat === null ? html`<span class="muted">—</span>` : html`${coin(b.stakePaidSat)} DFCN`}</dd>
          <dt>paid node</dt>
          <dd>
            ${b.paidMasternode
              ? html`${b.paidMasternode.service ?? '—'}
                  <span class="muted">${b.paidMasternode.proTxHash.slice(0, 12)}…</span>`
              : html`<span class="muted">not resolved</span>`}
          </dd>
          <dt>previous</dt>
          <dd>${b.previousblockhash ? html`<a href="/block/${b.previousblockhash}">${shortHash(b.previousblockhash)}</a>` : '—'}</dd>
          <dt>next</dt>
          <dd>${b.nextblockhash ? html`<a href="/block/${b.nextblockhash}">${shortHash(b.nextblockhash)}</a>` : '—'}</dd>
        </dl>
      </section>

      <section class="card">
        <div class="card-head"><div class="card-title">Transactions</div></div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr><th>Txid</th><th class="c">Kind</th><th class="r">In</th><th class="r">Out</th><th class="r">Value out</th></tr>
              </thead>
              <tbody>
                ${b.txs.map(
                  (t) => html`
                    <tr>
                      <td class="mono"><a href="/tx/${t.txid}">${shortHash(t.txid, 12, 8)}</a></td>
                      <td class="c">${txKindLabel(t.type, t.isCoinbase, t.isCoinstake)}</td>
                      <td class="r mono">${num(t.vinCount)}</td>
                      <td class="r mono">${num(t.voutCount)}</td>
                      <td class="r mono">${coin(t.valueOutSat)}</td>
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
customElements.define('dd-page-block', DdPageBlock);
