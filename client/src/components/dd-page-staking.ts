import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { api, type StakingHealth } from '../lib/api.js';
import { num, ratio } from '../lib/format.js';
import { baseStyles, cardStyles, controlStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';

const REFRESH_MS = 30_000;
const WINDOWS = [200, 500, 1000, 5000];

/** Anything past this is production faltering rather than varying. */
const STALL_SEC = 600;

export class DdPageStaking extends LitElement {
  static override properties = {
    _d: { state: true },
    _blocks: { state: true },
    _error: { state: true },
  };

  private _d: StakingHealth | null = null;
  private _blocks = 500;
  private _error = '';
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    controlStyles,
    pageStyles,
    css`
      .bars {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 14px;
      }
      .row {
        display: grid;
        grid-template-columns: 130px 1fr 90px;
        align-items: center;
        gap: 10px;
        font-family: var(--font-mono);
        font-size: 12px;
      }
      .track {
        height: 10px;
        background: var(--surface-3);
        border: 1px solid var(--line);
      }
      .track > i {
        display: block;
        height: 100%;
        background: var(--accent-dim);
      }
      .row.top .track > i {
        background: var(--warn);
      }
      .r {
        text-align: right;
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
      this._d = await api.stakingHealth(this._blocks);
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    }
  }

  private _setWindow(n: number): void {
    this._blocks = n;
    void this._load();
  }

  override render(): TemplateResult {
    const d = this._d;
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Staking health</div>
          <div class="page-sub">
            Whether the chain is moving, and whether it is moving because of one machine — the
            second question decides whether anything measured here means anything.
          </div>
        </div>
        <div class="seg">
          ${WINDOWS.map(
            (n) => html`
              <button class=${this._blocks === n ? 'on' : ''} @click=${() => this._setWindow(n)}>
                ${num(n)}
              </button>
            `
          )}
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
      ${!d ? html`<div class="note">Loading…</div>` : html`${this._tiles(d)} ${this._note(d)} ${this._table(d)}`}
    `;
  }

  private _tiles(d: StakingHealth): TemplateResult {
    const spacing = d.medianIntervalSec;
    return html`
      <section class="tiles">
        <dd-stat
          label="Distinct stakers"
          value=${num(d.distinctStakers)}
          sub="over ${num(d.blocks)} proof-of-stake blocks"
          tone=${d.distinctStakers > 1 ? (d.distinctStakers >= 4 ? 'good' : 'warn') : 'crit'}
        ></dd-stat>
        <dd-stat
          label="Median block interval"
          value=${spacing === null ? '—' : `${Math.round(spacing)}s`}
          sub=${d.meanIntervalSec === null ? 'no interval yet' : `mean ${Math.round(d.meanIntervalSec)}s`}
        ></dd-stat>
        <dd-stat
          label="Concentration (HHI)"
          value=${d.hhi === null ? '—' : d.hhi.toFixed(2)}
          sub=${d.topStakerShare === null
            ? 'no producer yet'
            : `busiest staker ${ratio(d.topStakerShare)}`}
          tone=${d.hhi === null ? '' : d.hhi > 0.5 ? 'crit' : d.hhi > 0.25 ? 'warn' : 'good'}
        ></dd-stat>
        <dd-stat
          label="Longest gap"
          value=${d.longestGapSec === null ? '—' : `${Math.round(d.longestGapSec / 60)}m`}
          sub="${num(d.stallCount)} interval(s) over ${STALL_SEC / 60}m"
          tone=${d.stallCount > 0 ? 'warn' : 'good'}
        ></dd-stat>
      </section>
    `;
  }

  /**
   * One producer is not a mild concentration figure, it is a different kind of
   * result -- so it gets said in words rather than left to an index nobody
   * reads carefully.
   */
  private _note(d: StakingHealth): TemplateResult | typeof nothing {
    if (d.distinctStakers > 1) return nothing;
    return html`
      <section>
        <div class="note">
          <strong>One wallet produced every block in this window.</strong> The chain is advancing,
          but block production has a single point of failure, and nothing measured here can be
          attributed to network behaviour — a pause would mean that one machine paused.
        </div>
      </section>
    `;
  }

  private _table(d: StakingHealth): TemplateResult {
    const top = d.stakers[0]?.blocks ?? 1;
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Blocks per staker</div>
          <div class="page-sub mono">
            ${num(d.fromHeight)}–${num(d.toHeight)}${d.gini === null
              ? ''
              : ` · gini ${d.gini.toFixed(2)}`}
          </div>
        </div>
        <div class="card-body flush">
          ${d.stakers.length === 0
            ? html`<div class="empty">No proof-of-stake blocks in this window.</div>`
            : html`
                <div class="bars">
                  ${d.stakers.map(
                    (s, i) => html`
                      <div class="row ${i === 0 ? 'top' : ''}">
                        <span class="muted">${s.payee}…</span>
                        <span class="track"
                          ><i style="width:${((s.blocks / top) * 100).toFixed(1)}%"></i
                        ></span>
                        <span class="r">${num(s.blocks)} · ${ratio(s.share)}</span>
                      </div>
                    `
                  )}
                </div>
              `}
        </div>
      </section>
    `;
  }
}

customElements.define('dd-page-staking', DdPageStaking);
