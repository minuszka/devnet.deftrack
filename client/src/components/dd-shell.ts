import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { DEVNET_BANNER } from '@devnet-deftrack/shared';
import type { HealthSnapshot } from '../lib/api.js';
import { errorMessage, isAbortError } from '../lib/errors.js';
import { FreshnessTracker, freshnessNote, measuredCount } from '../lib/freshness.js';
import { PollController, type PollRun } from '../lib/poll.js';
import { num } from '../lib/format.js';
import { ROUTES, matchRoute, installLinkInterceptor, type Match } from '../lib/router.js';
import { baseStyles } from '../styles/shared.js';
import './dd-page-overview.js';
import './dd-page-rounds.js';
import './dd-page-round.js';
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
import './dd-page-not-found.js';

const HEALTH_REFRESH_MS = 30_000;

export class DdShell extends LitElement {
  static override properties = {
    _route: { state: true },
    _health: { state: true },
  };

  private _route: Match = matchRoute(location.pathname);
  private _health: HealthSnapshot | null = null;
  /** The header's own poll: stops with the tab, cancels what it supersedes. */
  private readonly _poll = new PollController(this, {
    intervalMs: HEALTH_REFRESH_MS,
    load: (run) => this._loadHealth(run),
  });
  /** How old the counters are, and whether the last attempt to renew them worked. */
  private readonly _freshness = new FreshnessTracker();
  /**
   * Redraws the age, nothing else. Without it the header would claim "updated
   * 2s ago" for the whole thirty seconds between polls -- a wrong number where
   * the entire point of the line is to be right about time.
   */
  private _ageTimer: number | null = null;
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
         * Left, with the counters on the right: one strip of status, read the
         * way the rest of the page is read. The warning is long by design -- it
         * has to name both "not mainnet" and "may reset" to be worth reading --
         * so it may shrink and wrap inside its own box, but it neither pushes
         * the counters off the strip nor takes a centred row of its own, which
         * read as a headline rather than as a standing warning.
         */
        flex: 0 1 auto;
        min-width: 0;
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
        /* Hard right, on the same row as the warning, and still right when the
           row is too narrow to hold both and the counters wrap below it. */
        flex: 0 0 auto;
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

      /* Row one and a half: how old the row above it is.
         Its own line rather than a chip inside the counters, because it
         qualifies all of them at once -- and because when there are no counters
         at all it is the only thing left to say. */
      .datastate {
        display: flex;
        align-items: center;
        gap: var(--sp-2) var(--sp-3);
        flex-wrap: wrap;
        padding: var(--sp-2) 0 0;
      }
      .freshness {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        letter-spacing: 0.04em;
        color: var(--ink-3);
      }
      .freshness.ok { color: var(--ink-2); }
      .freshness.warn { color: var(--warn); }
      .freshness.bad { color: var(--crit); }
      /* The dot is a claim about freshness, so it must stop breathing when the
         data stops arriving: a pulsing green dot beside two-minute-old numbers
         is the exact lie this row exists to remove. */
      .live-dot.warn { background: var(--warn); animation: none; box-shadow: none; }
      .live-dot.bad { background: var(--crit); animation: none; box-shadow: none; }
      .live-dot.muted { background: var(--ink-3); animation: none; box-shadow: none; }
      .why {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        color: var(--crit);
        overflow-wrap: anywhere;
      }
      .retry {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink);
        background: var(--bg-raised);
        border: 1px solid var(--line-strong);
        border-radius: var(--radius);
        padding: 4px 10px;
        cursor: pointer;
      }
      .retry:hover { border-color: var(--accent); color: var(--accent); }

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
    this._ageTimer = window.setInterval(() => this.requestUpdate(), 1000);
    this._onPop();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('popstate', this._onPop);
    if (this._ageTimer !== null) window.clearInterval(this._ageTimer);
    this._ageTimer = null;
  }

  private async _loadHealth(run: PollRun): Promise<void> {
    try {
      const health = await run.api.health();
      // A 503 with `success: true` is a degraded network described correctly,
      // not a broken request: the API client decides on the envelope rather
      // than on `response.ok`, and this page must keep it that way.
      if (run.stale) return;
      this._health = health;
      this._freshness.succeeded(Date.now());
      this.requestUpdate();
    } catch (error) {
      // An abort is not a failure, and neither is an answer to a request this
      // header has already superseded -- accepting either would let a late
      // reply mark the page fresh.
      if (isAbortError(error) || run.stale) return;
      // This used to be swallowed, on the grounds that the chain line is
      // decoration. It is not: it is the only place that says whether the
      // numbers beside it are current.
      this._freshness.failed(errorMessage(error), Date.now());
      // The tracker is not a reactive property, and a failure changes nothing
      // else on the page -- without this the reader would not see it until the
      // next redraw a second later. "Immediately" is the requirement.
      this.requestUpdate();
    }
  }

  override render(): TemplateResult {
    const h = this._health;
    const fresh = this._freshness.read(Date.now(), HEALTH_REFRESH_MS);
    const note = freshnessNote(fresh, HEALTH_REFRESH_MS);
    return html`
      <div class="topbar">
        <span class="devnet"><span class="live-dot" aria-hidden="true"></span>${DEVNET_BANNER}</span>
        ${h
          ? this._monitor(h)
          : fresh.state === 'unavailable'
            ? nothing
            : html`<span class="monitor" aria-hidden="true"
                ><span class="skeleton" style="width:380px;height:28px"></span
              ></span>`}
      </div>

      <div class="datastate">
        <span class="freshness ${note.tone}" role="status" title=${note.detail ?? nothing}>
          <span class="live-dot ${note.tone}" aria-hidden="true"></span>${note.text}
        </span>
        ${note.detail
          ? html`<span class="why" role="alert">${note.detail}</span>`
          : nothing}
        ${fresh.state === 'failing' || fresh.state === 'unavailable'
          ? html`<button class="retry" type="button" @click=${() => this._poll.refresh()}>
              Retry
            </button>`
          : nothing}
      </div>

      <header class="site">
        <div class="brand">devnet<span class="dim">.deftrack</span></div>
        ${h
          ? this._telemetry(h)
          : fresh.state === 'unavailable'
            ? nothing
            : html`<div class="telemetry" aria-hidden="true"
                ><span class="skeleton" style="width:520px;height:36px"></span
              ></div>`}
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
    // -1 is the endpoint's "could not be measured", not a count. Printed as a
    // number it read as a network of minus one masternode; printed as an em
    // dash it reads as what it is.
    const total = measuredCount(h.masternodes.total);
    const enabled = measuredCount(h.masternodes.enabled);
    const allUp = total !== null && enabled !== null && total > 0 && enabled === total;
    return html`
      <span class="monitor" role="status" aria-label="Network counters">
        <span>wallet <b>v${h.nodeVersion}</b></span>
        <span>mn <b>${num(total)}</b></span>
        <span>
          active
          <b class=${total !== null && total > 0 ? (allUp ? 'ok' : 'bad') : ''}>
            ${num(enabled)}
          </b>
        </span>
        <span>staking <b>${num(measuredCount(h.stakers.active))}</b></span>
        ${h.failing?.length
          ? html`<span>status <b class="bad">${h.status}: ${h.failing.join(', ')}</b></span>`
          : html`<span>status <b class="ok">${h.status}</b></span>`}
      </span>
    `;
  }

  private _telemetry(h: HealthSnapshot): TemplateResult {
    // Same sentinel, same treatment. The round tally is a sum, so one
    // unmeasured part makes the whole figure meaningless rather than smaller.
    const parts = [h.rounds.formed, h.rounds.failed, h.rounds.pending, h.rounds.impossible].map(
      measuredCount
    );
    const recorded = parts.some((p) => p === null)
      ? null
      : parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
    return html`
      <div class="telemetry" role="status" aria-label="Chain position">
        <span><i>chain</i><b class="dimb">${h.devnet}</b></span>
        <span><i>tip</i><b>${num(measuredCount(h.chainTip))}</b></span>
        <!-- "indexed through" and not a bare count: a height and a block count
             differ by one, and side by side that read as an off-by-one bug
             rather than as two different things. -->
        <span><i>indexed through</i><b>${num(measuredCount(h.indexedHeight))}</b></span>
        <!-- The endpoint answers minus one when the tip could not be read.
             Hiding the chip then said "not behind", which is a claim about the
             chain; "unknown" is the truth about the reading. -->
        ${h.behind < 0
          ? html`<span class="lag"><i>behind</i><b class="dimb">unknown</b></span>`
          : h.behind > 0
            ? html`<span class="lag"><i>behind</i><b>${num(h.behind)}</b></span>`
            : nothing}
        <!--
          A count, not a scoreboard. This figure is every profile at once --
          five interleaved schedules -- and it carried no health beside it, so
          "900 formed / 12 failed" on every page read as a formation rate for a
          network that has none: the two numbers may only be shown together, and
          only within one profile. The front page does that properly; the header
          says how much has been recorded and stops there.
        -->
        <span
          ><i>DKG rounds</i
          ><b>${num(recorded)}
            <span class="dimb">recorded, all profiles</span></b
          ></span
        >
      </div>
    `;
  }

  private _page(): TemplateResult {
    const id = this._route.param;
    switch (this._route.route.tag) {
      case 'dd-page-rounds':
        return html`<dd-page-rounds></dd-page-rounds>`;
      case 'dd-page-round':
        return html`<dd-page-round .param=${id}></dd-page-round>`;
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
      case 'dd-page-overview':
        return html`<dd-page-overview></dd-page-overview>`;
      // Not a fallback: every route above names its own page, and a tag with no
      // case here is a route somebody added without wiring it up. Rendering the
      // overview for it is the same silent substitution this page exists to
      // stop -- the reader would be looking at the front page believing it was
      // the one they asked for.
      default:
        return html`<dd-page-not-found
          .status=${this._route.status}
          .path=${this._route.path}
        ></dd-page-not-found>`;
    }
  }
}

customElements.define('dd-shell', DdShell);
