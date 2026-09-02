import { LitElement, css, html, nothing, svg, type TemplateResult } from 'lit';
import { api, type DslEpochRow, type DslSummary } from '../lib/api.js';
import { num } from '../lib/format.js';
import { baseStyles, cardStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';

const REFRESH_MS = 30_000;

/**
 * The Sentinel Layer's shadow phase, watched.
 *
 * One question decides whether DSL can ever enforce: does the network converge
 * -- the quorum on one report set, and the block producer's pool on the exact
 * hash the quorum signed. The chain answers it once per epoch, at the boundary:
 * a commitment is in that block or it is nowhere. So this page's headline is a
 * pair, committed and absent together, the same discipline as formationRate
 * next to the health ratio -- either number alone flatters the network.
 */
export class DdPageDsl extends LitElement {
  static override properties = { _s: { state: true }, _epochs: { state: true }, _error: { state: true } };

  private _s: DslSummary | null = null;
  private _epochs: DslEpochRow[] = [];
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
        font-size: var(--fs-xs);
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
      .pill {
        display: inline-block;
        padding: 1px 8px;
        border-radius: 999px;
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
      }
      .pill.committed {
        background: color-mix(in srgb, var(--accent) 18%, transparent);
        color: var(--accent);
      }
      .pill.absent {
        background: color-mix(in srgb, var(--crit) 18%, transparent);
        color: var(--crit);
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
      const [summary, epochs] = await Promise.all([api.dslSummary(), api.dslEpochs({ limit: 200 })]);
      this._s = summary;
      this._epochs = epochs.items;
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    }
  }

  override render(): TemplateResult {
    const s = this._s;
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Sentinel Layer</div>
          <div class="page-sub">
            Service-liveness in shadow: every epoch the masternodes probe each other, the ChainLock
            quorum signs a verdict bitfield, and the boundary block carries it — or does not. An
            absent epoch punishes nobody; it is the convergence measurement itself, which is why
            committed and absent are always shown together.
          </div>
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
      ${!s ? html`<div class="note">Loading…</div>` : html`${this._tiles(s)} ${this._strip(s)} ${this._table()}`}
    `;
  }

  private _tiles(s: DslSummary): TemplateResult {
    const judged = s.epochsJudged;
    const rate = s.convergenceRate;
    return html`
      <section class="tiles">
        ${judged === 0
          ? html`<dd-stat
              label="Status"
              value="armed"
              sub=${s.firstCommittableBoundary === null
                ? 'collector disabled'
                : `first verdict at block ${num(s.firstCommittableBoundary)}`}
            ></dd-stat>`
          : html`<dd-stat
              label="Convergence"
              value=${rate === null ? '—' : `${(rate * 100).toFixed(1)}%`}
              sub="${num(s.committed)} committed · ${num(s.absent)} absent"
              tone=${rate === null ? '' : rate >= 0.95 ? 'good' : rate >= 0.8 ? 'warn' : 'crit'}
            ></dd-stat>`}
        <dd-stat
          label="Epochs judged"
          value=${num(judged)}
          sub="one per ${s.epochInterval} blocks (~hourly)"
        ></dd-stat>
        <dd-stat
          label="Missed bits"
          value=${num(s.totalMissedBits)}
          sub="masternode-epochs observed missing"
          tone=${s.totalMissedBits === 0 && judged > 0 ? 'good' : ''}
        ></dd-stat>
        <dd-stat
          label="Mode"
          value="shadow"
          sub="records only — activation ${num(s.activationHeight)}, enforcement off"
        ></dd-stat>
      </section>

      <div class="note caveat">
        A commitment appears only when the quorum converged on one report set <em>and</em> the block
        producer's own pool reproduced the exact hash it signed — the design fails open, so a
        missing commitment is a datum, never a penalty. Enforcement stays off until this page's
        convergence number has earned it.
      </div>
    `;
  }

  /** One tick per judged epoch, oldest to newest. */
  private _strip(s: DslSummary): TemplateResult {
    if (this._epochs.length === 0) {
      return html`
        <section class="card">
          <div class="card-head">
            <div class="card-title">Per epoch, oldest to newest</div>
          </div>
          <div class="card-body">
            <div class="note">
              No epoch has been judged yet${s.firstCommittableBoundary === null
                ? '.'
                : html` — the first boundary that can carry a commitment is block
                  <a href="/block/${s.firstCommittableBoundary}">${num(s.firstCommittableBoundary)}</a>.`}
            </div>
          </div>
        </section>
      `;
    }

    const pts = [...this._epochs].reverse(); // API is newest-first; draw oldest-first
    const W = 900;
    const H = 64;
    const w = W / pts.length;

    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Per epoch, oldest to newest</div>
          <div class="page-sub mono">${num(pts.length)} epochs</div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Service commitment presence per epoch">
          ${pts.map((p, i) =>
            svg`<rect
              x=${(i * w).toFixed(2)} y="10" width=${Math.max(1, w - 0.6).toFixed(2)} height="34"
              fill=${p.status === 'committed' ? (p.missedCount ? 'var(--warn)' : 'var(--accent)') : 'var(--crit)'}
            ><title>epoch ${p.epoch} · block ${p.boundaryHeight}${
              p.status === 'committed'
                ? ` · committed · ${p.missedCount ?? 0} of ${p.listSize ?? '?'} missed`
                : ' · no commitment (non-convergence)'
            }</title></rect>`
          )}
        </svg>
        <div class="legend">
          <span><i class="swatch" style="background: var(--accent)"></i>committed, nobody missed</span>
          <span><i class="swatch" style="background: var(--warn)"></i>committed, bits set</span>
          <span><i class="swatch" style="background: var(--crit)"></i>absent — did not converge</span>
        </div>
      </section>
    `;
  }

  private _table(): TemplateResult {
    const rows = this._epochs.slice(0, 50);
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Recent epochs</div>
          <div class="page-sub mono">newest first</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr>
                  <th class="r">Epoch</th>
                  <th class="r">Boundary</th>
                  <th>Verdict</th>
                  <th class="r">Missed</th>
                  <th>Commitment</th>
                </tr>
              </thead>
              <tbody>
                ${rows.length === 0
                  ? html`<tr><td class="empty" colspan="5">Nothing judged yet.</td></tr>`
                  : rows.map(
                      (e) => html`
                        <tr>
                          <td class="r mono">${num(e.epoch)}</td>
                          <td class="r mono">
                            <a href="/block/${e.boundaryHeight}">${num(e.boundaryHeight)}</a>
                          </td>
                          <td><span class="pill ${e.status}">${e.status}</span></td>
                          <td class="r mono">
                            ${e.status === 'committed' ? `${e.missedCount ?? 0} / ${e.listSize ?? '—'}` : '—'}
                          </td>
                          <td class="mono">
                            ${e.txid
                              ? html`<a href="/tx/${e.txid}">${e.txid.slice(0, 16)}…</a>`
                              : html`<span class="caveat">none mined</span>`}
                          </td>
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

customElements.define('dd-page-dsl', DdPageDsl);
