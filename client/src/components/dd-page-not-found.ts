import { LitElement, css, html, type TemplateResult } from 'lit';
import type { MatchStatus } from '../lib/router.js';
import { baseStyles, cardStyles, pageStyles } from '../styles/shared.js';

/**
 * What the reader sees when a URL cannot be served.
 *
 * Two different situations, said differently, because the next step differs. A
 * path nobody routes is a page that is gone or was never there; a path whose
 * identifier will not decode is a link that was damaged somewhere between being
 * written and being clicked, and the identifier is worth showing so the reader
 * can see what arrived.
 *
 * Neither rewrites the address bar. A URL silently replaced is a URL that
 * cannot be pasted into a bug report.
 */
export class DdPageNotFound extends LitElement {
  static override properties = {
    status: {},
    path: {},
  };

  /** 'not-found' unless the path matched a detail route with a broken escape. */
  status: MatchStatus = 'not-found';
  path = '';

  static override styles = [
    baseStyles,
    cardStyles,
    pageStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--sp-4);
        align-items: flex-start;
      }
      .what {
        display: block;
        max-width: 100%;
        overflow-wrap: anywhere;
        padding: var(--sp-2) var(--sp-3);
        border: 1px solid var(--line-strong);
        border-radius: var(--radius);
        background: var(--bg-raised);
        color: var(--ink-2);
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
      }
      .ways {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-2) var(--sp-4);
      }
    `,
  ];

  override render(): TemplateResult {
    const malformed = this.status === 'malformed';
    return html`
      <div class="page">
        <div class="page-head">
          <div>
            <h1 class="page-title" tabindex="-1">${malformed ? 'That link could not be read' : 'Page not found'}</h1>
            <div class="page-sub">
              ${malformed
                ? html`The address has a damaged percent-escape, so the identifier in it cannot be
                    decoded. Nothing was looked up -- this is about the link, not about the network.`
                : html`No section or record is served at this address. It may be a typo, or a link
                    from before this explorer had the page.`}
            </div>
          </div>
        </div>

        <section class="card">
          <div class="card-head"><h2 class="card-title">What arrived</h2></div>
          <div class="card-body body">
            <code class="what">${this.path}</code>
            <div class="ways">
              <a href="/">Go to the overview</a>
              <a href="/rounds">DKG rounds</a>
              <a href="/experiments">Experiments</a>
            </div>
          </div>
        </section>
      </div>
    `;
  }
}

customElements.define('dd-page-not-found', DdPageNotFound);
