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
    const fmtLatency = (ms: number | null): string =>
      ms === null ? '—' : ms < 1_000 ? `${Math.round(ms)}ms` : `${(ms / 1_000).toFixed(2)}s`;
    const exact = d.eventLatencyMs.p50 !== null;
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
          value=${exact ? fmtLatency(d.eventLatencyMs.p50) : d.latencySec.p50 === null ? '—' : `${d.latencySec.p50}s`}
          sub=${exact
            ? `ZMQ p90 ${fmtLatency(d.eventLatencyMs.p90)} · max ${fmtLatency(d.eventLatencyMs.max)}`
            : `poll estimate · p90 ${d.latencySec.p90 ?? '—'}s`}
        ></dd-stat>
        <dd-stat
          label="Locking began"
          value=${d.firstLockedHeight === null ? '—' : num(d.firstLockedHeight)}
          sub="first block ever locked"
        ></dd-stat>
      </section>

      <div class="note caveat">
        ${exact
          ? html`Latency is measured from the ZMQ block arrival to the ZMQ CLSIG arrival on the
              same host clock. <strong>${num(d.eventLatencyMeasured)}</strong> locks have exact timing;
              <strong>${num(d.sourceCounts.poll)}</strong> were recovered by polling. RPC reconciliation
              runs every <span class="mono">${d.reconciliationIntervalSec}s</span>.`
          : html`ZMQ event timing is not available yet. The displayed latency is a polling estimate
              with <span class="mono">${d.resolutionSec}s</span> resolution. Covered-but-unwatched locks
              are excluded rather than given an invented latency.`}
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
              fill=${p.locked ? (p.latencyMs === null ? 'var(--accent-dim)' : 'var(--accent)') : 'var(--crit)'}
            ><title>${p.height}${p.locked ? (p.latencyMs === null ? ` · locked (${p.source ?? 'untimed'})` : ` · ${p.latencyMs}ms · ZMQ`) : ' · no lock'}</title></rect>`
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
