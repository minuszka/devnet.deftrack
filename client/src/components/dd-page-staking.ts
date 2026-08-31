import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { api, type StakingHealth } from '../lib/api.js';
import { num, ratio } from '../lib/format.js';
import { baseStyles, cardStyles, controlStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';

const REFRESH_MS = 30_000;
const WINDOWS = [200, 500, 1000, 5000];

/** Anything past this is production faltering rather than varying. */
const STALL_SEC = 600;

type LeaderView = 'machines' | 'keys';

export class DdPageStaking extends LitElement {
  static override properties = {
    _d: { state: true },
    _blocks: { state: true },
    _view: { state: true },
    _error: { state: true },
  };

  private _d: StakingHealth | null = null;
  private _blocks = 500;
  private _view: LeaderView = 'machines';
  private _error = '';
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    controlStyles,
    pageStyles,
    css`
      /* ── hero: who produced the blocks, at a glance ─────────────── */
      .hero {
        border: 1px solid var(--line);
        background: var(--surface);
        border-radius: var(--radius);
        margin-bottom: 20px;
      }
      .hero-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        padding: 13px 16px 4px;
      }
      .eyebrow {
        font-family: var(--font-mono);
        font-size: 10.5px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ink-3);
        font-weight: 600;
      }
      .verdict {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--ink-2);
      }
      .tag {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 8px;
        border-radius: 999px;
        font-size: 10.5px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-weight: 600;
      }
      .tag.good {
        background: color-mix(in srgb, var(--good) 20%, transparent);
        color: var(--good);
      }
      .tag.warn {
        background: color-mix(in srgb, var(--warn) 20%, transparent);
        color: var(--warn);
      }
      .tag.crit {
        background: color-mix(in srgb, var(--crit) 20%, transparent);
        color: var(--crit);
      }

      .barwrap {
        position: relative;
        margin: 12px 16px 6px;
      }
      .dombar {
        display: flex;
        height: 44px;
        border: 1px solid var(--line-strong);
        border-radius: var(--radius);
        overflow: hidden;
      }
      .dombar > span {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        border-left: 1px solid var(--bg);
        overflow: hidden;
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        color: #0b0e0c;
        white-space: nowrap;
        transition: filter 0.15s;
      }
      .dombar > span:first-child {
        border-left: 0;
      }
      .dombar > span:hover {
        filter: brightness(1.12);
      }
      /* every segment carries the accent; the busiest leans amber so "one
         machine" reads instantly, without reading a single number */
      .seg-c {
        background: var(--accent-dim);
      }
      .seg-lead {
        background: var(--warn);
      }
      .seg-un {
        background: var(--surface-3);
        color: var(--ink-3) !important;
      }
      /* the "even share" reference: where each machine would sit if production
         were perfectly flat. A segment reaching past it carries more than its
         share -- the concentration story, drawn instead of indexed. */
      .fair {
        position: absolute;
        top: -5px;
        bottom: -5px;
        width: 0;
        border-left: 1px dashed var(--ink-2);
        pointer-events: none;
      }
      .fair::after {
        content: 'even';
        position: absolute;
        top: -13px;
        left: -12px;
        font-family: var(--font-mono);
        font-size: 8.5px;
        letter-spacing: 0.08em;
        color: var(--ink-3);
      }
      .fair-note {
        padding: 8px 16px 14px;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--ink-3);
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }
      .fair-note b {
        color: var(--ink-2);
      }
      .swatch {
        display: inline-block;
        width: 9px;
        height: 9px;
        vertical-align: -1px;
        margin-right: 5px;
      }

      /* ── leaderboard ────────────────────────────────────────────── */
      .lead {
        padding: 6px 8px;
      }
      .lrow {
        display: grid;
        grid-template-columns: 22px 140px 1fr 116px;
        align-items: center;
        gap: 12px;
        padding: 7px 8px;
        border-radius: var(--radius);
        font-family: var(--font-mono);
        font-size: 12px;
      }
      .lrow:hover {
        background: var(--accent-wash);
      }
      .rank {
        color: var(--ink-3);
        font-size: 11px;
        text-align: right;
      }
      .who {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .who .un {
        color: var(--ink-3);
        font-weight: 400;
      }
      .track {
        height: 9px;
        background: var(--surface-3);
        border: 1px solid var(--line);
        overflow: hidden;
      }
      .track > i {
        display: block;
        height: 100%;
        background: var(--accent-dim);
      }
      .lrow.top .track > i {
        background: var(--warn);
      }
      .metric {
        text-align: right;
        color: var(--ink-2);
      }
      .metric b {
        color: var(--ink);
      }

      .toggle {
        display: inline-flex;
        gap: 4px;
        font-size: 11px;
      }
      .toggle button {
        font-family: var(--font-mono);
        font-size: 11px;
        background: none;
        border: 0;
        padding: 2px 4px;
        color: var(--ink-3);
        cursor: pointer;
      }
      .toggle button.on {
        color: var(--accent);
        font-weight: 700;
      }

      .foot {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--ink-3);
        padding: 10px 16px 14px;
        border-top: 1px solid var(--line);
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

  private _setView(v: LeaderView): void {
    this._view = v;
  }

  override render(): TemplateResult {
    const d = this._d;
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Staking health</div>
          <div class="page-sub">
            Whether the chain is moving — and whether it is moving because of one machine. The
            second question decides whether anything else here means anything.
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
      ${!d
        ? html`<div class="note">Loading…</div>`
        : html`${this._hero(d)} ${this._tiles(d)} ${this._leaderboard(d)}`}
    `;
  }

  /**
   * The page's first question, drawn: one bar, each machine a segment sized by
   * its block share, busiest first. One machine producing everything is not a
   * mild concentration figure -- it is a different kind of result -- so it reads
   * at a glance rather than being left to an index nobody checks.
   *
   * A coinstake pays the key of the output it spent, so one machine staking
   * several outputs shows as several payout keys. The bar counts machines, the
   * number that would make a chain carried by one look distributed if counted
   * by key.
   */
  private _hero(d: StakingHealth): TemplateResult {
    const hosts = d.byHost.hosts;
    const machines = d.byHost.distinctHosts;
    const hhi = d.byHost.hhi;

    if (machines <= 1) {
      return html`
        <section class="hero">
          <div class="hero-head">
            <span class="eyebrow">Who produced the last ${num(d.blocks)} blocks</span>
            <span class="verdict">Single point of failure<span class="tag crit">one machine</span></span>
          </div>
          <div class="note" style="margin: 6px 16px 16px">
            <strong>One wallet produced every block in this window.</strong> The chain is advancing,
            but block production has a single point of failure, and nothing else measured here can be
            attributed to network behaviour — a pause would mean that one machine paused.
          </div>
        </section>
      `;
    }

    const [tag, word] =
      hhi === null
        ? (['', '—'] as const)
        : hhi > 0.5
          ? (['crit', 'concentrated'] as const)
          : hhi > 0.25
            ? (['warn', 'leaning to a few'] as const)
            : (['good', 'distributed'] as const);
    const evenPct = 100 / machines;

    return html`
      <section class="hero">
        <div class="hero-head">
          <span class="eyebrow">Who produced the last ${num(d.blocks)} blocks</span>
          <span class="verdict"
            >Production is spread across ${num(machines)} machines<span class="tag ${tag}">${word}</span></span
          >
        </div>

        <div class="barwrap">
          <div class="dombar" role="img" aria-label="Block share per machine, busiest first">
            ${hosts.map(
              (h, i) => html`
                <span
                  class=${i === 0 ? 'seg-lead' : 'seg-c'}
                  style="flex:${(h.share * 100).toFixed(3)}"
                  title="${h.host ?? 'unattributed'} · ${num(h.blocks)} blocks · ${ratio(h.share)}"
                  >${h.host ?? '?'}</span
                >
              `
            )}
            ${d.byHost.unattributedBlocks > 0
              ? html`<span
                  class="seg-un"
                  style="flex:${((d.byHost.unattributedBlocks / d.blocks) * 100).toFixed(3)}"
                  title="${num(d.byHost.unattributedBlocks)} block(s) unattributed"
                  >?</span
                >`
              : nothing}
          </div>
          <i class="fair" style="left:${evenPct.toFixed(2)}%"></i>
        </div>

        <div class="fair-note">
          <span
            ><span class="swatch" style="background:var(--warn)"></span>busiest
            <b>${hosts[0]?.host ?? '—'} · ${hosts[0] ? ratio(hosts[0].share) : '—'}</b></span
          >
          <span
            ><span class="swatch" style="background:var(--ink-2)"></span>dashed line = even share
            <b>(${ratio(1 / machines)} each)</b></span
          >
          <span
            >concentration <b>HHI ${hhi === null ? '—' : hhi.toFixed(2)}</b> ·
            <b>${num(machines)} machines</b> · ${num(d.distinctStakers)} payout keys</span
          >
        </div>
      </section>
    `;
  }

  /** The pulse: is the chain moving, and moving steadily. */
  private _tiles(d: StakingHealth): TemplateResult {
    const spacing = d.medianIntervalSec;
    return html`
      <section class="tiles">
        <dd-stat
          label="Median block interval"
          value=${spacing === null ? '—' : `${Math.round(spacing)}s`}
          sub=${d.meanIntervalSec === null ? 'no interval yet' : `mean ${Math.round(d.meanIntervalSec)}s`}
        ></dd-stat>
        <dd-stat
          label="Longest gap"
          value=${d.longestGapSec === null ? '—' : `${Math.round(d.longestGapSec / 60)}m`}
          sub="${num(d.stallCount)} interval(s) over ${STALL_SEC / 60}m"
          tone=${d.stallCount > 0 ? 'warn' : 'good'}
        ></dd-stat>
        <dd-stat
          label="Stalls"
          value=${num(d.stallCount)}
          sub="intervals over ${STALL_SEC / 60}m"
          tone=${d.stallCount > 0 ? 'warn' : 'good'}
        ></dd-stat>
        <dd-stat
          label="Payout keys"
          value=${num(d.distinctStakers)}
          sub="across ${num(d.byHost.distinctHosts)} machine(s)"
        ></dd-stat>
      </section>
    `;
  }

  /**
   * The ranked detail behind the bar. Machines by default -- the honest
   * producer count -- with the raw payout-key breakdown one click away, since a
   * key is what a coinstake actually pays and the gini is measured over them.
   */
  private _leaderboard(d: StakingHealth): TemplateResult {
    const machines = this._view === 'machines';
    const rows = machines
      ? d.byHost.hosts.map((h) => ({ name: h.host, blocks: h.blocks, share: h.share }))
      : d.stakers.map((s) => ({ name: `${s.payee}…`, blocks: s.blocks, share: s.share }));
    const top = rows[0]?.blocks ?? 1;

    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Blocks per ${machines ? 'machine' : 'payout key'}</div>
          <div class="page-sub mono" style="display:flex; gap:12px; align-items:center">
            <span
              >${num(d.fromHeight)}–${num(d.toHeight)}${machines
                ? d.byHost.hhi === null
                  ? ''
                  : ` · hhi ${d.byHost.hhi.toFixed(2)}`
                : d.gini === null
                  ? ''
                  : ` · gini ${d.gini.toFixed(2)}`}</span
            >
            <span class="toggle">
              <button class=${machines ? 'on' : ''} @click=${() => this._setView('machines')}>
                machines
              </button>
              <span>/</span>
              <button class=${!machines ? 'on' : ''} @click=${() => this._setView('keys')}>
                payout keys
              </button>
            </span>
          </div>
        </div>
        <div class="card-body flush">
          ${rows.length === 0
            ? html`<div class="empty">No proof-of-stake blocks in this window.</div>`
            : html`
                <div class="lead">
                  ${rows.map(
                    (r, i) => html`
                      <div class="lrow ${i === 0 ? 'top' : ''}">
                        <span class="rank">${i + 1}</span>
                        <span class="who">${r.name ?? html`<span class="un">unattributed</span>`}</span>
                        <span class="track"><i style="width:${((r.blocks / top) * 100).toFixed(1)}%"></i></span>
                        <span class="metric"><b>${num(r.blocks)}</b> · ${ratio(r.share)}</span>
                      </div>
                    `
                  )}
                </div>
              `}
        </div>
        ${machines
          ? html`<div class="foot">
              A coinstake pays the key of the output it spent, so one machine staking several outputs
              shows as several payout keys — counting machines, not keys, is the honest producer count.
            </div>`
          : nothing}
      </section>
    `;
  }
}

customElements.define('dd-page-staking', DdPageStaking);
