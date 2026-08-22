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
        max-width: var(--max-w);
        margin: 0 auto;
        padding: 18px 20px 48px;
      }
      .banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
        border: 1px solid var(--accent);
        color: var(--accent);
        background: var(--accent-wash);
        padding: 7px 12px;
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      /* Live counters share the banner strip rather than taking a row of their
         own: they are status, not content. */
      .monitor {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        letter-spacing: 0.08em;
        color: var(--ink-2);
        font-weight: 500;
      }
      .monitor b {
        color: var(--ink);
        font-weight: 700;
      }
      .monitor .ok {
        color: var(--accent);
      }
      .monitor .bad {
        color: var(--crit);
      }
      header.site {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
        margin: 18px 0 10px;
      }
      .brand {
        font-family: var(--font-mono);
        font-size: 20px;
        font-weight: 700;
      }
      .brand .dim {
        color: var(--ink-3);
        font-weight: 400;
      }
      .chainline {
        font-family: var(--font-mono);
        font-size: 11.5px;
        color: var(--ink-3);
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
      }
      .chainline b {
        color: var(--ink-2);
        font-weight: 600;
      }
      nav {
        display: flex;
        gap: 2px;
        flex-wrap: wrap;
        border-bottom: 1px solid var(--line);
        margin-bottom: 18px;
      }
      nav a {
        font-family: var(--font-mono);
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-3);
        padding: 9px 13px;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        text-decoration: none;
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
      .lag {
        color: var(--warn);
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
      <div class="banner">
        <span>${DEVNET_BANNER}</span>
        ${h ? this._monitor(h) : nothing}
      </div>

      <header class="site">
        <div class="brand">devnet<span class="dim">.deftrack</span></div>
        ${h
          ? html`
              <div class="chainline">
                <span>chain <b>${h.devnet}</b></span>
                <span>height <b>${num(h.chainTip)}</b></span>
                <span>indexed <b>${num(h.indexedBlocks)}</b></span>
                ${h.behind > 0
                  ? html`<span class="lag">behind <b>${num(h.behind)}</b></span>`
                  : nothing}
                <span>rounds <b>${num(h.rounds.formed)}</b> formed / <b>${num(h.rounds.failed)}</b> failed</span>
              </div>
            `
          : nothing}
      </header>

      <nav>
        ${ROUTES.filter((r) => !r.hidden).map(
          (r) => html`
            <a href=${r.path} aria-current=${r.path === this._route.route.path ? 'page' : nothing}>
              ${r.label}
            </a>
          `
        )}
      </nav>

      ${this._page()}
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
      <span class="monitor">
        <span>wallet <b>v${h.nodeVersion}</b></span>
        <span>mn <b>${num(h.masternodes.total)}</b></span>
        <span>
          active
          <b class=${h.masternodes.total > 0 ? (allUp ? 'ok' : 'bad') : ''}>
            ${num(h.masternodes.enabled)}
          </b>
        </span>
        <span>staking <b>${num(h.stakers.active)}</b></span>
      </span>
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
