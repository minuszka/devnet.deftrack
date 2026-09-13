import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { DEVNET_BANNER } from '@devnet-deftrack/shared';
import type { HealthSnapshot } from '../lib/api.js';
import { errorMessage, isAbortError } from '../lib/errors.js';
import { FreshnessTracker, freshnessNote, measuredCount } from '../lib/freshness.js';
import { PollController, type PollRun } from '../lib/poll.js';
import { num } from '../lib/format.js';
import {
  NAV_GROUPS,
  matchRoute,
  installLinkInterceptor,
  navigate,
  navLocation,
  type Match,
  type NavGroupId,
  type NavLocation,
} from '../lib/router.js';
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
import './dd-page-simulations.js';
import './dd-page-search.js';
import './dd-page-methodology.js';
import './dd-page-not-found.js';

const HEALTH_REFRESH_MS = 30_000;

export class DdShell extends LitElement {
  static override properties = {
    _route: { state: true },
    _health: { state: true },
    _menuOpen: { state: true },
    _openGroups: { state: true },
    _searchHint: { state: true },
  };

  private _route: Match = matchRoute(location.pathname);
  private _health: HealthSnapshot | null = null;
  /** The narrow-screen menu. Closed on every navigation. */
  private _menuOpen = false;
  /** Which groups the narrow-screen menu shows expanded: the reader's own group, to begin with. */
  private _openGroups: ReadonlySet<NavGroupId> = new Set();
  /** Said under the search box when a submit had nothing in it. */
  private _searchHint = '';
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
    const before = this._pageIdentity();
    this._route = matchRoute(location.pathname);
    document.title = `devnet.deftrack — ${this._route.route.label}`;
    // A menu left open over the page that was just chosen from it hides that
    // page; and the group to show expanded next time is the one now current.
    this._menuOpen = false;
    const where = navLocation(this._route);
    this._openGroups = new Set(where.group ? [where.group.id] : []);
    this._searchHint = '';
    // A search page opened from its address shows its query in the box, so the
    // reader can correct it rather than retype it.
    if (this._route.route.tag === 'dd-page-search') void this._fillSearchBox(this._searchQuery());
    this.scrollIntoView();
    /*
     * Focus moves only when the page actually changed.
     *
     * The shell scrolled and retitled on navigation and left the focus where it
     * was -- on the link in the nav, or nowhere at all after a browser Back --
     * so a keyboard or screen-reader user arrived at a new page with no signal
     * that anything had happened, and had to tab through the whole header again
     * to reach it.
     *
     * The guard matters as much as the move. This is the only place focus is
     * touched, and it runs on a real navigation: the polls never call it, and a
     * filter writing the query string deliberately does not dispatch popstate,
     * so neither can take the focus out from under somebody mid-sentence.
     */
    if (this._pageIdentity() !== before) void this._focusPage();
  };

  /** The query a search page is showing, from the address. */
  private _searchQuery(): string {
    return new URLSearchParams(location.search).get('q') ?? '';
  }

  private async _fillSearchBox(query: string): Promise<void> {
    await this.updateComplete;
    const input = this.renderRoot.querySelector<HTMLInputElement>('.search input');
    // Not while somebody is typing in it. (document.activeElement would only
    // ever name this shell: the box is inside its shadow root.)
    if (input && this.shadowRoot?.activeElement !== input) input.value = query;
  }

  /**
   * Search on an explicit submit, and only then.
   *
   * Nothing listens to the box as it is typed in: every lookup is several
   * requests against endpoints that read the database, and firing them per
   * keystroke would turn one question into dozens. An empty submit asks
   * nothing and says what the box takes.
   */
  private _onSearch(event: Event): void {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const query = String(new FormData(form).get('q') ?? '').trim();
    if (query === '') {
      this._searchHint = 'Type a block height, a hash, a transaction id or a run key.';
      return;
    }
    this._searchHint = '';
    navigate(`/search?q=${encodeURIComponent(query)}`);
  }

  /** What counts as "a different page" for the purpose of moving focus. */
  private _pageIdentity(): string {
    return `${this._route.route.tag}:${this._route.param ?? ''}:${this._route.status}`;
  }

  /**
   * Put the focus on the new page's own heading.
   *
   * Both renders have to finish first -- this element's, which swaps the page
   * element in, and the page's own, which produces the heading -- or the
   * heading does not exist yet and the focus lands nowhere. `<main>` is the
   * fallback and the skip link's target, so a page whose heading has not
   * arrived still hands the reader the content region rather than the header.
   */
  private async _focusPage(): Promise<void> {
    await this.updateComplete;
    const main = this.renderRoot.querySelector('main');
    const page = main?.firstElementChild;
    if (page instanceof LitElement) await page.updateComplete;
    const heading = page?.shadowRoot?.querySelector('h1');
    (heading ?? main)?.focus();
  }

  /**
   * Skip to the content, across a shadow boundary.
   *
   * `href="#content"` cannot work on its own here: the fragment names an id
   * inside this shadow root and the browser looks for it in the document, so
   * the link would move nothing. The href stays because it is what the link
   * means and what a reader sees in the status bar; the handler is what makes
   * it true. It also has to preventDefault before the router's own link
   * interceptor sees the click, which is why this is handled on the anchor.
   */
  private _skipToContent(event: Event): void {
    event.preventDefault();
    const main = this.renderRoot.querySelector('main');
    main?.focus();
    main?.scrollIntoView();
  }

  static override styles = [
    baseStyles,
    css`
      /*
       * Off screen until it is focused, which is the only time it is for
       * anybody. Not display:none and not visibility:hidden -- either would take
       * it out of the tab order, which is the one thing it needs to be in.
       * (No backticks in here: this is inside a css template literal, and one
       * of them ends it. That cost a build on day 2 as well.)
       */
      .skip {
        position: absolute;
        left: -9999px;
        top: 0;
        z-index: 10;
        padding: 10px 14px;
        background: var(--surface);
        border: 1px solid var(--accent);
        border-radius: var(--radius);
        color: var(--ink);
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
        text-decoration: none;
      }
      .skip:focus {
        left: var(--gutter);
        top: var(--sp-2);
      }
      main:focus {
        /* Focused by script, to move a reader rather than to mark a control.
           The heading inside it is what was asked for; a ring around the whole
           page would say something else. */
        outline: none;
      }
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
        /* Allowed to shrink, so the chips wrap inside it. It was 0 0 auto --
           never narrower than all five chips in a row -- and on a phone that
           made the whole document 152 px wider than the screen. */
        flex: 0 1 auto;
        min-width: 0;
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
      /* Allowed below its content's width. The loading skeleton in here is 520
         px wide, and a flex item may only shrink past its content once its
         container can: without this the loading header alone made a phone's
         page 176 px wider than the screen. */
      .telemetry {
        min-width: 0;
      }
      .brand {
        color: var(--ink);
        text-decoration: none;
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

      /* The search box, between the brand and the telemetry. It takes the row
         to itself on a narrow screen rather than squeezing the input. */
      .tools {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-2) var(--sp-4);
        flex: 1 1 320px;
        max-width: 680px;
        min-width: 0;
      }
      .search {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--sp-2);
        flex: 1 1 260px;
        min-width: 0;
      }
      .search input {
        flex: 1 1 200px;
        min-width: 0;
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
        padding: 7px 10px;
        background: var(--bg-raised);
        color: var(--ink);
        border: 1px solid var(--line-strong);
        border-radius: var(--radius);
      }
      .search input:focus {
        border-color: var(--accent-dim);
        box-shadow: 0 0 0 2px var(--accent-wash-2);
        outline: none;
      }
      .search button {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 8px 12px;
        color: var(--ink);
        background: var(--surface-2);
        border: 1px solid var(--line-strong);
        border-radius: var(--radius);
        cursor: pointer;
      }
      .search button:hover {
        border-color: var(--accent);
        color: var(--accent);
      }
      .search-hint {
        flex-basis: 100%;
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        color: var(--warn);
      }
      .howto {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        letter-spacing: 0.06em;
        white-space: nowrap;
      }

      /*
       * Row three: the sections, in four groups. Sticky, so the way around is
       * never scrolled out of reach.
       *
       * Wide: the groups in one row, and the current group's pages in a second
       * row under it -- so the group and the page are both lit at once, and a
       * page's siblings are one click away. Narrow: one Menu button, which says
       * where the reader is, over a list of groups that open and close.
       *
       * Fourteen equal tabs used to wrap into two rows on a desktop and scroll
       * sideways below 1100 px, with most of them past the edge.
       */
      nav {
        position: sticky;
        top: 0;
        z-index: 5;
        background: var(--bg);
        border-bottom: 1px solid var(--line);
        margin-bottom: var(--sp-5);
      }
      nav ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .groups,
      .pages {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
      }
      .pages {
        border-top: 1px solid var(--line-soft);
      }
      nav a {
        display: block;
        font-family: var(--font-mono);
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-3);
        border-bottom: 2px solid transparent;
        text-decoration: none;
        white-space: nowrap;
        transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease), border-color var(--t-base) var(--ease);
      }
      .groups a {
        font-size: var(--fs-sm);
        padding: 13px 16px 11px;
      }
      .pages a {
        font-size: var(--fs-xs);
        padding: 10px 12px 8px;
      }
      nav a:hover {
        color: var(--ink);
        background: var(--surface-2);
        text-decoration: none;
      }
      /* "page" is this page; "true" is the section a detail page sits in, and
         the group of either. Both are where the reader is, so both are lit. */
      nav a[aria-current] {
        color: var(--accent);
        border-bottom-color: var(--accent);
      }
      .nav-narrow {
        display: none;
      }
      @media (max-width: 959px) {
        .nav-wide {
          display: none;
        }
        .nav-narrow {
          display: block;
        }
      }
      .menu-toggle,
      .group-toggle {
        display: flex;
        align-items: center;
        gap: var(--sp-3);
        width: 100%;
        min-height: 44px;
        padding: 0 var(--sp-3);
        background: none;
        border: none;
        color: var(--ink);
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        text-align: left;
        cursor: pointer;
      }
      .menu-toggle .where {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--accent);
        font-weight: 600;
        text-transform: none;
        letter-spacing: 0.02em;
      }
      .caret {
        margin-left: auto;
        flex: none;
        transition: transform var(--t-fast) var(--ease);
      }
      [aria-expanded='true'] > .caret {
        transform: rotate(180deg);
      }
      .menu {
        border-top: 1px solid var(--line-soft);
        /* A long menu on a short screen scrolls inside itself; the page under
           it stays where the reader left it. */
        max-height: calc(100dvh - 60px);
        overflow-y: auto;
        padding-bottom: var(--sp-2);
      }
      .menu .group-toggle {
        font-size: var(--fs-xs);
        color: var(--ink-2);
      }
      .menu .group-toggle.current {
        color: var(--accent);
      }
      .menu a {
        font-size: var(--fs-sm);
        min-height: 44px;
        display: flex;
        align-items: center;
        padding: 0 var(--sp-3) 0 var(--sp-5);
        border-bottom: none;
        border-left: 2px solid transparent;
        text-transform: none;
        letter-spacing: 0.02em;
      }
      .menu > ul > li > a {
        padding-left: var(--sp-3);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: var(--fs-xs);
        font-weight: 700;
      }
      .menu a[aria-current] {
        border-left-color: var(--accent);
        background: var(--accent-wash);
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
      <a class="skip" href="#content" @click=${this._skipToContent}>Skip to content</a>
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
        <a class="brand" href="/">devnet<span class="dim">.deftrack</span></a>
        <div class="tools">
        <form class="search" role="search" aria-label="Search the chain" @submit=${this._onSearch} novalidate>
          <input
            type="search"
            name="q"
            aria-label="Block height, block hash, transaction id or run key"
            placeholder="Height, hash, txid or run key"
            autocomplete="off"
            spellcheck="false"
            enterkeyhint="search"
            aria-describedby=${this._searchHint ? 'search-hint' : nothing}
            @input=${() => {
              if (this._searchHint) this._searchHint = '';
            }}
          />
          <button type="submit">Search</button>
          ${this._searchHint
            ? html`<span class="search-hint" id="search-hint" role="status">${this._searchHint}</span>`
            : nothing}
        </form>
        <a class="howto" href="/methodology">How we measure</a>
        </div>
        ${h
          ? this._telemetry(h)
          : fresh.state === 'unavailable'
            ? nothing
            : html`<div class="telemetry" aria-hidden="true"
                ><span class="skeleton" style="width:520px;height:36px"></span
              ></div>`}
      </header>

      ${this._nav()}

      <main id="content" tabindex="-1">${this._page()}</main>
    `;
  }

  /**
   * The grouped menu, in its two forms. Both are rendered and the stylesheet
   * shows one: a hidden form is `display: none`, which takes it out of the
   * accessibility tree and the tab order as well as off the screen, so a reader
   * never meets the same link twice.
   */
  private _nav(): TemplateResult {
    const where = navLocation(this._route);
    return html`
      <nav aria-label="Sections" @keydown=${this._onNavKey}>
        <div class="nav-wide">${this._wideNav(where)}</div>
        <div class="nav-narrow">${this._narrowNav(where)}</div>
      </nav>
    `;
  }

  private _wideNav(where: NavLocation): TemplateResult {
    const current = where.group;
    return html`
      <ul class="groups">
        ${NAV_GROUPS.map((group) => {
          const first = group.routes[0];
          if (!first) return nothing;
          const here = current?.id === group.id;
          // The overview is a group of one, so its group link IS the page link.
          const mark = here ? (group.routes.length === 1 && where.exact ? 'page' : 'true') : nothing;
          return html`<li><a href=${first.path} aria-current=${mark}>${group.label}</a></li>`;
        })}
      </ul>
      ${current && current.routes.length > 1
        ? html`<ul class="pages" aria-label="${current.label} pages">
            ${current.routes.map((route) => html`<li>${this._entryLink(route, where)}</li>`)}
          </ul>`
        : nothing}
    `;
  }

  private _narrowNav(where: NavLocation): TemplateResult {
    const here = where.entry
      ? where.group && where.group.routes.length > 1
        ? `${where.group.label} › ${where.entry.label}`
        : where.entry.label
      : '';
    return html`
      <button
        class="menu-toggle"
        type="button"
        aria-expanded=${this._menuOpen ? 'true' : 'false'}
        aria-controls="nav-menu"
        @click=${this._toggleMenu}
      >
        <span>Menu</span>
        ${here ? html`<span class="where">${here}</span>` : nothing}
        <span class="caret" aria-hidden="true">▾</span>
      </button>
      <div class="menu" id="nav-menu" ?hidden=${!this._menuOpen} @click=${this._onMenuClick}>
        <ul>
          ${NAV_GROUPS.map((group) => {
            const only = group.routes.length === 1 ? group.routes[0] : undefined;
            if (only) return html`<li>${this._entryLink(only, where)}</li>`;
            const open = this._openGroups.has(group.id);
            const id = `nav-group-${group.id}`;
            return html`<li>
              <button
                class="group-toggle ${where.group?.id === group.id ? 'current' : ''}"
                type="button"
                aria-expanded=${open ? 'true' : 'false'}
                aria-controls=${id}
                @click=${() => this._toggleGroup(group.id)}
              >
                ${group.label}<span class="caret" aria-hidden="true">▾</span>
              </button>
              <ul id=${id} ?hidden=${!open}>
                ${group.routes.map((route) => html`<li>${this._entryLink(route, where)}</li>`)}
              </ul>
            </li>`;
          })}
        </ul>
      </div>
    `;
  }

  private _entryLink(route: { path: string; label: string }, where: NavLocation): TemplateResult {
    const mark = where.entry?.path === route.path ? (where.exact ? 'page' : 'true') : nothing;
    return html`<a href=${route.path} aria-current=${mark}>${route.label}</a>`;
  }

  private _toggleMenu = (): void => {
    this._menuOpen = !this._menuOpen;
  };

  private _toggleGroup(id: NavGroupId): void {
    const next = new Set(this._openGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._openGroups = next;
  }

  /**
   * A link in the menu closes the menu. A navigation does that on its own, but
   * following the link to the page already on screen is not a navigation --
   * the router ignores it -- and the menu would stay open over the page, with
   * the focus on a link about to be hidden. So the focus goes back to the
   * button that opened it.
   */
  private _onMenuClick = (event: Event): void => {
    const anchor = event
      .composedPath()
      .find((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement);
    if (!anchor) return;
    const samePage = new URL(anchor.href).pathname === location.pathname;
    this._menuOpen = false;
    if (samePage) void this._focusMenuToggle();
  };

  /** Escape closes the menu and hands the focus back to its button. */
  private _onNavKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this._menuOpen) return;
    event.preventDefault();
    this._menuOpen = false;
    void this._focusMenuToggle();
  };

  private async _focusMenuToggle(): Promise<void> {
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>('.menu-toggle')?.focus();
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
      case 'dd-page-simulations':
        return html`<dd-page-simulations .runKey=${id}></dd-page-simulations>`;
      case 'dd-page-search':
        return html`<dd-page-search .query=${this._searchQuery()}></dd-page-search>`;
      case 'dd-page-methodology':
        return html`<dd-page-methodology></dd-page-methodology>`;
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
