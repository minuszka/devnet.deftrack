import { LitElement, css, html, nothing, svg, type TemplateResult } from 'lit';
import { api, type ChainLockReport } from '../lib/api.js';
import { num } from '../lib/format.js';
import { baseStyles, cardStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';

const REFRESH_MS = 20_000;

export class DdPageChainLocks extends LitElement {
  static override properties = { _d: { state: true }, _error: { state: true } };

  private _d: ChainLockReport | null = null;
  private _error = '';
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    pageStyles,
    css`
      svg {
        display: block;
        width: 100%;
        height: auto;
      }
      .legend {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        padding: 8px 14px 12px;
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: var(--ink-3);
      }
      .swatch {
        display: inline-block;
        width: 10px;
        height: 10px;
        vertical-align: -1px;
        margin-right: 6px;
      }
      .caveat {
        color: var(--ink-3);
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
      this._d = await api.chainlocks(500);
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    }
  }

  override render(): TemplateResult {
    const d = this._d;
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">ChainLocks</div>
          <div class="page-sub">
            Coverage counted from the first lock ever seen, not from the start of the chain: a
            ChainLock cannot exist before a quorum does, and counting the pre-masternode era as
            missed locks reported 88% where the truthful figure was 99%.
          </div>
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
      ${!d ? html`<div class="note">Loading…</div>` : html`${this._tiles(d)} ${this._strip(d)} ${this._gaps(d)}`}
    `;
  }

  private _tiles(d: ChainLockReport): TemplateResult {
    const cov = d.coverage;
    return html`
      <section class="tiles">
        <dd-stat
          label="Coverage"
          value=${cov === null ? '—' : `${(cov * 100).toFixed(1)}%`}
          sub="${num(d.locked)} of ${num(d.eligible)} eligible blocks"
          tone=${cov === null ? '' : cov >= 0.99 ? 'good' : cov >= 0.9 ? 'warn' : 'crit'}
        ></dd-stat>
        <dd-stat
          label="Unlocked"
          value=${num(d.unlocked)}
          sub="${num(d.gaps.length)} gap(s)"
          tone=${d.unlocked === 0 ? 'good' : 'warn'}
        ></dd-stat>
        <dd-stat
          label="Median latency"
          value=${d.latencySec.p50 === null ? '—' : `${d.latencySec.p50}s`}
          sub="p90 ${d.latencySec.p90 ?? '—'}s · max ${d.latencySec.max ?? '—'}s"
        ></dd-stat>
        <dd-stat
          label="Locking began"
          value=${d.firstLockedHeight === null ? '—' : num(d.firstLockedHeight)}
          sub="first block ever locked"
        ></dd-stat>
      </section>

      <div class="note caveat">
        Latency is an observation, not a chain fact: the node reports whether a block is locked,
        never when the CLSIG arrived. Resolution is the poll interval,
        <span class="mono">${d.resolutionSec}s</span>. Only
        <strong>${num(d.latencyMeasured)}</strong> of ${num(d.locked)} locks were watched from the
        block onward; the rest count as covered but are left out of the timings rather than given
        an invented one.
      </div>
    `;
  }

  /** One tick per block: present, missing, or present-but-untimed. */
  private _strip(d: ChainLockReport): TemplateResult {
    const pts = d.points;
    if (pts.length === 0) return html``;

    const W = 900;
    const H = 64;
    const w = W / pts.length;

    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Per block, oldest to newest</div>
          <div class="page-sub mono">${num(pts.length)} blocks</div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ChainLock presence per block">
          ${pts.map((p, i) =>
            svg`<rect
              x=${(i * w).toFixed(2)} y="10" width=${Math.max(1, w - 0.6).toFixed(2)} height="34"
              fill=${p.locked ? (p.latencySec === null ? 'var(--accent-dim)' : 'var(--accent)') : 'var(--crit)'}
            ><title>${p.height}${p.locked ? (p.latencySec === null ? ' · locked (untimed)' : ` · ${p.latencySec}s`) : ' · no lock'}</title></rect>`
          )}
        </svg>
        <div class="legend">
          <span><i class="swatch" style="background: var(--accent)"></i>locked, latency measured</span>
          <span><i class="swatch" style="background: var(--accent-dim)"></i>locked before we watched</span>
          <span><i class="swatch" style="background: var(--crit)"></i>no lock</span>
        </div>
      </section>
    `;
  }

  private _gaps(d: ChainLockReport): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Gaps</div>
          <div class="page-sub mono">runs of consecutive unlocked blocks</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr><th class="r">From</th><th class="r">To</th><th class="r">Blocks</th></tr>
              </thead>
              <tbody>
                ${d.gaps.length === 0
                  ? html`<tr><td class="empty" colspan="3">
                      Every eligible block since height ${num(d.firstLockedHeight ?? 0)} carries a ChainLock.
                    </td></tr>`
                  : d.gaps.map(
                      (g) => html`
                        <tr>
                          <td class="r mono"><a href="/block/${g.from}">${num(g.from)}</a></td>
                          <td class="r mono"><a href="/block/${g.to}">${num(g.to)}</a></td>
                          <td class="r mono">${num(g.blocks)}</td>
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

customElements.define('dd-page-chainlocks', DdPageChainLocks);
