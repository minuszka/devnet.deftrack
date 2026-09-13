import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { apiWith } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import {
  classifyFailure,
  lookUp,
  parseSearch,
  soleMatch,
  TARGET_LABELS,
  type Outcome,
  type ParsedSearch,
  type SearchTarget,
} from '../lib/search.js';
import { baseStyles, cardStyles, controlStyles, pageStyles } from '../styles/shared.js';
import './dd-copy.js';

/** A lookup with no answer in this long is reported as unchecked, not as absent. */
export const SEARCH_TIMEOUT_MS = 8_000;

const KIND_TITLES: Record<SearchTarget, string> = {
  block: 'Block',
  tx: 'Transaction',
  experiment: 'Experiment',
  simulation: 'Simulation',
};

/**
 * Search results.
 *
 * The query comes from the address (`/search?q=`), put there by the header's
 * form on an explicit submit -- never by typing. Every endpoint that could hold
 * the identifier is asked at once, and each answer is kept as what it was:
 * found, not found, or could not be checked. A single complete match forwards
 * to the item; anything else is shown.
 *
 * Two guards keep an older search from overwriting a newer one: starting a
 * search aborts the previous one's requests, and an answer is accepted only by
 * the search that asked for it. Measured: the browser test fails with both
 * removed and passes with either one alone, so each covers the ordinary case
 * for the other. The second is also meant for an answer already in hand when
 * the abort came -- a window no test here can open on demand, so that part is
 * reasoning, not evidence.
 */
export class DdPageSearch extends LitElement {
  static override properties = {
    query: {},
    _parsed: { state: true },
    _outcomes: { state: true },
    _pending: { state: true },
  };

  query = '';
  private _parsed: ParsedSearch = { kind: 'empty' };
  private _outcomes: Outcome[] = [];
  private _pending = false;
  private _generation = 0;
  private _controller: AbortController | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    pageStyles,
    controlStyles,
    css`
      .q {
        font-family: var(--font-mono);
        color: var(--ink);
        overflow-wrap: anywhere;
      }
      .results {
        display: grid;
        gap: var(--sp-3);
      }
      .result .card-body {
        display: grid;
        gap: var(--sp-2);
      }
      .result a.title {
        font-size: var(--fs-base);
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .ident {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-2);
        flex-wrap: wrap;
      }
      .ident code {
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
        color: var(--ink-2);
        overflow-wrap: anywhere;
        min-width: 0;
      }
      .detail {
        font-size: var(--fs-sm);
        color: var(--ink-3);
      }
      .unchecked {
        padding: var(--sp-3) var(--sp-4);
        border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
        background: var(--warn-wash);
        color: var(--ink);
        border-radius: var(--radius-md);
        font-size: var(--fs-sm);
        overflow-wrap: anywhere;
      }
      .unchecked ul {
        margin: var(--sp-2) 0;
        padding-left: var(--sp-5);
      }
      .unchecked b {
        color: var(--warn);
      }
    `,
  ];

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('query')) this._start();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._generation += 1;
    this._controller?.abort();
    this._controller = null;
  }

  private _start(): void {
    this._controller?.abort();
    this._controller = null;
    const generation = ++this._generation;
    const parsed = parseSearch(this.query);
    this._parsed = parsed;
    this._outcomes = [];
    if (parsed.kind !== 'lookup') {
      this._pending = false;
      return;
    }

    this._pending = true;
    const controller = new AbortController();
    this._controller = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SEARCH_TIMEOUT_MS);
    const api = apiWith(controller.signal);

    void Promise.all(
      parsed.candidates.map(async (candidate): Promise<Outcome | null> => {
        try {
          return { status: 'found', candidate, found: await lookUp(api, candidate) };
        } catch (error) {
          const outcome = classifyFailure(candidate, error);
          if (outcome !== null) return outcome;
          // An abort: ours, because the answer took too long -- or a newer
          // search's, in which case nobody will read this.
          return timedOut
            ? { status: 'unverified', candidate, reason: `no answer within ${SEARCH_TIMEOUT_MS / 1000} s` }
            : null;
        }
      })
    ).then((results) => {
      window.clearTimeout(timer);
      if (generation !== this._generation) return;
      this._controller = null;
      this._outcomes = results.filter((outcome): outcome is Outcome => outcome !== null);
      this._pending = false;
      const sole = soleMatch(this._outcomes);
      if (sole) navigate(sole.href, { replace: true });
    });
  }

  override render(): TemplateResult {
    const parsed = this._parsed;
    return html`
      <div class="page">
        <div class="page-head">
          <div>
            <h1 class="page-title" tabindex="-1">Search</h1>
            ${parsed.kind === 'empty' ? nothing : html`<div class="page-sub">for <span class="q">${parsed.query}</span></div>`}
          </div>
        </div>
        ${this._body(parsed)}
      </div>
    `;
  }

  private _body(parsed: ParsedSearch): TemplateResult {
    if (parsed.kind === 'empty') {
      return html`<div class="note">
        Type a block height, a block hash, a transaction id, or an experiment or simulation run key into the search
        box, and press Enter.
      </div>`;
    }
    if (parsed.kind === 'unsupported') {
      return html`<div class="note" role="status">
        This is not something the search can look up. It takes a block height, a block hash or a transaction id
        (64 hex characters), or an experiment or simulation run key.
      </div>`;
    }
    const asked = parsed.candidates.map((c) => TARGET_LABELS[c.target]).join(', ');
    if (this._pending) {
      return html`<div class="note" role="status" aria-busy="true">Looking in ${asked}…</div>`;
    }

    const found = this._outcomes.filter((o): o is Extract<Outcome, { status: 'found' }> => o.status === 'found');
    const unchecked = this._outcomes.filter((o): o is Extract<Outcome, { status: 'unverified' }> => o.status === 'unverified');
    const absent = this._outcomes.filter((o) => o.status === 'not-found');

    return html`
      ${found.length > 1
        ? html`<div class="note" role="status">
            This identifier matched ${found.length} different things. Each is listed on its own.
          </div>`
        : nothing}
      ${found.length > 0
        ? html`<div class="results">${found.map((o) => this._result(o))}</div>`
        : nothing}
      ${unchecked.length > 0 ? this._unchecked(unchecked, found.length === 0, absent.length) : nothing}
      ${found.length === 0 && unchecked.length === 0
        ? html`<div class="note" role="status">
            <b>No match.</b> Nothing in ${asked} has this identifier.
            ${parsed.couldBeProTxHash
              ? html`A masternode's proTxHash is also 64 hex characters, and masternode search is not available
                  yet.`
              : nothing}
          </div>`
        : nothing}
    `;
  }

  private _result(outcome: Extract<Outcome, { status: 'found' }>): TemplateResult {
    const item = outcome.found;
    return html`<section class="card result" data-target=${item.target}>
      <div class="card-head"><h2 class="card-title">${KIND_TITLES[item.target]}</h2></div>
      <div class="card-body">
        <a class="title" href=${item.href}>${item.title}</a>
        <div class="ident">
          <code>${item.identifier}</code>
          <dd-copy .value=${item.identifier} label="Copy ${KIND_TITLES[item.target].toLowerCase()} identifier"></dd-copy>
        </div>
        <div class="detail">${item.detail}</div>
      </div>
    </section>`;
  }

  /**
   * The lookups that could not be completed. When nothing was found this is
   * the whole answer, and it must not read as "no match": a 503 says nothing
   * about whether the item exists.
   */
  private _unchecked(
    unchecked: Array<Extract<Outcome, { status: 'unverified' }>>,
    nothingFound: boolean,
    absentCount: number
  ): TemplateResult {
    return html`<div class="unchecked" role="status">
      <b>${nothingFound ? 'Not a “no match”: ' : ''}some lookups could not be completed.</b>
      <ul>
        ${unchecked.map((o) => html`<li>${TARGET_LABELS[o.candidate.target]}: ${o.reason}</li>`)}
      </ul>
      ${nothingFound && absentCount > 0
        ? html`<div>
            Checked and not found in:
            ${this._outcomes
              .filter((o) => o.status === 'not-found')
              .map((o) => TARGET_LABELS[o.candidate.target])
              .join(', ')}.
          </div>`
        : nothing}
      <button class="btn" type="button" @click=${() => this._start()}>Search again</button>
    </div>`;
  }
}

customElements.define('dd-page-search', DdPageSearch);
