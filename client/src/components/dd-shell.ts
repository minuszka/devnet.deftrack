import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { DEVNET_BANNER } from '@devnet-deftrack/shared';
import { api, type HealthSnapshot } from '../lib/api.js';
import { num } from '../lib/format.js';
import { ROUTES, matchRoute, installLinkInterceptor, type Match } from '../lib/router.js';
import { baseStyles } from '../styles/shared.js';
import './dd-page-overview.js';
import './dd-page-rounds.js';
import './dd-page-pose.js';
import './dd-page-masternodes.js';
import './dd-page-operators.js';
import './dd-page-blocks.js';
import './dd-page-txs.js';
import './dd-page-chainlocks.js';
import './dd-page-dsl.js';
import './dd-page-staking.js';
import './dd-page-experiments.js';
import './dd-page-peers.js';
import './dd-page-fairness.js';

const HEALTH_REFRESH_MS = 30_000;

export class DdShell extends LitElement {
  static override properties = {
    _route: { state: true },
    _health: { state: true },
  };

  private _route: Match = matchRoute(location.pathname);
  private _health: HealthSnapshot | null = null;
  private _timer: number | null = null;
  private _onPop = (): void => {
    this._route = matchRoute(location.pathname);
    document.title = `devnet.deftrack — ${this._route.route.label}`;
    this.scrollIntoView();
  };

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        max-width: var(--content-max);
        margin: 0 auto;
        padding: 0 var(--gutter) var(--sp-7);
      }

      /* Row one: the warning this network exists under, and the live counters.
         Obvious, because every number below it is test-network arithmetic;
         quiet, because it is on every page. */
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sp-3) var(--sp-4);
        flex-wrap: wrap;
        padding: var(--sp-2) 0;
        border-bottom: 1px solid var(--line-soft);
      }
      .devnet {
        /*
         * Its own full-width, centred row inside the topbar rather than a badge
         * beside the telemetry. The warning is long by design -- it has to name
         * both "not mainnet" and "may reset" to be worth reading -- and set
         * against the telemetry chips it would either overlap them or be
         * squeezed until it wrapped mid-phrase. A row of its own is the only
         * placement that stays centred and legible at every width.
         */
        flex: 1 0 100%;
        justify-content: center;
        text-align: center;
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        padding: 5px 10px;
        border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
        background: var(--accent-wash);
        color: var(--accent);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        border-radius: var(--radius);
      }
      .monitor {
        display: flex;
        gap: var(--sp-2);
        flex-wrap: wrap;
        /* The warning takes the whole first row, so the telemetry is alone on
           the second one, where space-between would pull it to the left. */
        margin-left: auto;
      }
      .monitor > span {
        display: inline-flex;
        align-items: baseline;
        gap: 6px;
        padding: 5px 10px;
        border: 1px solid var(--line-strong);
        border-radius: var(--radius);
        background: var(--bg-raised);
        color: var(--ink-2);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        letter-spacing: 0.04em;
      }
      .monitor b {
        color: var(--ink);
        font-weight: 700;
        font-size: var(--fs-sm);
        font-variant-numeric: tabular-nums;
      }
      .monitor .ok { color: var(--accent); }
      .monitor .bad { color: var(--crit); }

      /* Row two: who we are, and where the chain is. The telemetry is a row of
         labelled figures rather than one grey sentence, because tip, indexed
         height and the round tally are things an operator reads at a glance. */
      header.site {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--sp-3) var(--sp-5);
        padding: var(--sp-4) 0 var(--sp-3);
      }
      .brand {
        font-family: var(--font-mono);
        font-size: var(--fs-xl);
        font-weight: 700;
        letter-spacing: 0.01em;
        line-height: 1;
      }
      .brand .dim {
        color: var(--ink-3);
        font-weight: 400;
      }
      .telemetry {
        display: flex;
        gap: var(--sp-5);
        flex-wrap: wrap;
      }
      .telemetry > span {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .telemetry i {
        font-style: normal;
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-3);
      }
      .telemetry b {
        font-family: var(--font-mono);
        font-size: var(--fs-md);
        font-weight: 700;
        color: var(--ink);
        font-variant-numeric: tabular-nums;
        line-height: 1.2;
      }
      .telemetry .dimb { color: var(--ink-2); font-weight: 600; }
      .telemetry .lag b { color: var(--warn); }

      /* Row three: the sections. Sticky, so the way around is never scrolled
         out of reach; tabs with room to hit. */
      nav {
        position: sticky;
        top: 0;
        z-index: 5;
        display: flex;
        gap: 2px;
        flex-wrap: wrap;
        background: var(--bg);
        border-bottom: 1px solid var(--line);
        margin-bottom: var(--sp-5);
      }
      nav a {
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-3);
        padding: 13px 16px;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        text-decoration: none;
        white-space: nowrap;
        transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease), border-color var(--t-base) var(--ease);
      }
      nav a:hover {
        color: var(--ink);
        background: var(--surface-2);
        text-decoration: none;
      }
      nav a[aria-current='page'] {
        color: var(--accent);
        border-bottom-color: var(--accent);
      }
      @media (max-width: 1100px) {
        nav {
          flex-wrap: nowrap;
          overflow-x: auto;
          scrollbar-width: thin;
        }
      }

      main > * {
        animation: enter var(--t-slow) var(--ease) both;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    installLinkInterceptor();
    window.addEventListener('popstate', this._onPop);
    this._onPop();
    void this._loadHealth();
    this._timer = window.setInterval(() => void this._loadHealth(), HEALTH_REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('popstate', this._onPop);
    if (this._timer !== null) clearInterval(this._timer);
  }

  private async _loadHealth(): Promise<void> {
    try {
      this._health = await api.health();
    } catch {
      // The chain line is decoration; a page's own error surface is the one
      // that matters, so a failed health poll stays quiet.
    }
  }

  override render(): TemplateResult {
    const h = this._health;
    return html`
      <div class="topbar">
        <span class="devnet"><span class="live-dot" aria-hidden="true"></span>${DEVNET_BANNER}</span>
        ${h ? this._monitor(h) : html`<span class="monitor" aria-hidden="true"><span class="skeleton" style="width:380px;height:28px"></span></span>`}
      </div>

      <header class="site">
        <div class="brand">devnet<span class="dim">.deftrack</span></div>
        ${h ? this._telemetry(h) : html`<div class="telemetry" aria-hidden="true"><span class="skeleton" style="width:520px;height:36px"></span></div>`}
      </header>

      <nav aria-label="Sections">
        ${ROUTES.filter((r) => !r.hidden).map(
          (r) => html`
            <a href=${r.path} aria-current=${r.path === this._route.route.path ? 'page' : nothing}>
              ${r.label}
            </a>
          `
        )}
      </nav>

      <main>${this._page()}</main>
    `;
  }

  /**
   * Wallet version, masternode counts and how many wallets are actually
   * producing blocks. The staker count is measured from coinstake payees over
   * a block window, because no RPC reports who is staking network-wide --
   * getstakinginfo speaks only for the node you ask.
   */
  private _monitor(h: HealthSnapshot): TemplateResult {
    const allUp = h.masternodes.total > 0 && h.masternodes.enabled === h.masternodes.total;
    return html`
      <span class="monitor" role="status" aria-label="Network counters">
        <span>wallet <b>v${h.nodeVersion}</b></span>
        <span>mn <b>${num(h.masternodes.total)}</b></span>
        <span>
          active
          <b class=${h.masternodes.total > 0 ? (allUp ? 'ok' : 'bad') : ''}>
            ${num(h.masternodes.enabled)}
          </b>
        </span>
        <span>staking <b>${num(h.stakers.active)}</b></span>
        ${h.failing?.length
          ? html`<span>status <b class="bad">${h.status}: ${h.failing.join(', ')}</b></span>`
          : html`<span>status <b class="ok">${h.status}</b></span>`}
      </span>
    `;
  }

  private _telemetry(h: HealthSnapshot): TemplateResult {
    return html`
      <div class="telemetry" role="status" aria-label="Chain position">
        <span><i>chain</i><b class="dimb">${h.devnet}</b></span>
        <span><i>tip</i><b>${num(h.chainTip)}</b></span>
        <!-- "indexed through" and not a bare count: a height and a block count
             differ by one, and side by side that read as an off-by-one bug
             rather than as two different things. -->
        <span><i>indexed through</i><b>${num(h.indexedHeight)}</b></span>
        ${h.behind > 0 ? html`<span class="lag"><i>behind</i><b>${num(h.behind)}</b></span>` : nothing}
        <span
          ><i>DKG rounds</i
          ><b>${num(h.rounds.formed)} <span class="dimb">formed</span> / ${num(h.rounds.failed)} <span class="dimb">failed</span></b></span
        >
      </div>
    `;
  }

  private _page(): TemplateResult {
    const id = this._route.param;
    switch (this._route.route.tag) {
      case 'dd-page-rounds':
        return html`<dd-page-rounds></dd-page-rounds>`;
      case 'dd-page-pose':
        return html`<dd-page-pose></dd-page-pose>`;
      case 'dd-page-masternodes':
        return html`<dd-page-masternodes></dd-page-masternodes>`;
      case 'dd-page-operators':
        return html`<dd-page-operators></dd-page-operators>`;
      case 'dd-page-chainlocks':
        return html`<dd-page-chainlocks></dd-page-chainlocks>`;
      case 'dd-page-dsl':
        return html`<dd-page-dsl></dd-page-dsl>`;
      case 'dd-page-staking':
        return html`<dd-page-staking></dd-page-staking>`;
      case 'dd-page-fairness':
        return html`<dd-page-fairness></dd-page-fairness>`;
      case 'dd-page-peers':
        return html`<dd-page-peers></dd-page-peers>`;
      case 'dd-page-experiments':
        return html`<dd-page-experiments .runKey=${id}></dd-page-experiments>`;
      case 'dd-page-blocks':
        return html`<dd-page-blocks></dd-page-blocks>`;
      case 'dd-page-txs':
        return html`<dd-page-txs></dd-page-txs>`;
      case 'dd-page-block':
        return html`<dd-page-block .param=${id}></dd-page-block>`;
      case 'dd-page-tx':
        return html`<dd-page-tx .param=${id}></dd-page-tx>`;
      default:
        return html`<dd-page-overview></dd-page-overview>`;
    }
  }
}

customElements.define('dd-shell', DdShell);
