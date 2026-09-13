import { LitElement, css, html, type TemplateResult } from 'lit';
import { baseStyles } from '../styles/shared.js';

type CopyState = 'idle' | 'copied' | 'failed';

/** How long "copied" stays up. A failure stays until the next attempt. */
const COPIED_MS = 1_500;

/**
 * A copy button that copies the whole identifier and says when it could not.
 *
 * The one copy button this site had swallowed a clipboard failure on the
 * grounds that the full hash was still in the cell's title. A reader who
 * pressed "copy", saw nothing change and pasted whatever was on their
 * clipboard before is the failure that reasoning produces: the button has to
 * say it did not work. The clipboard is refused more often than it sounds --
 * an insecure context, a permission prompt dismissed, a browser that does not
 * expose it at all.
 *
 * The value is copied exactly as given; a shortened hash on screen is never
 * what lands on the clipboard.
 */
export class DdCopy extends LitElement {
  static override properties = {
    value: {},
    label: {},
    _state: { state: true },
  };

  value = '';
  /** The accessible name: what is being copied, e.g. "Copy block hash". */
  label = 'Copy';
  private _state: CopyState = 'idle';
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
        align-items: center;
        font-family: var(--font-mono);
        /* The containing block for the status line below, which is absolutely
           positioned (sr-only). Without this its containing block was outside
           the table's scrolling box, so it was not clipped by it: in a row
           scrolled out of view it sat past the edge of the page and made a
           phone's document 773 px wider -- found by the day-18 layout sweep. */
        position: relative;
      }
      /* The look the overview's copy button had: quiet until pointed at. */
      button {
        font: inherit;
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        background: none;
        color: var(--ink-3);
        border: 1px solid transparent;
        border-radius: var(--radius);
        padding: 2px 6px;
        cursor: pointer;
        white-space: nowrap;
        transition: color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
      }
      button:hover {
        color: var(--accent);
        border-color: var(--line-strong);
      }
      button.copied {
        color: var(--accent);
      }
      button.failed {
        color: var(--crit);
        border-color: color-mix(in srgb, var(--crit) 45%, transparent);
      }
    `,
  ];

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._timer !== null) window.clearTimeout(this._timer);
    this._timer = null;
  }

  override render(): TemplateResult {
    const text = this._state === 'copied' ? 'copied' : this._state === 'failed' ? 'copy failed' : 'copy';
    const said =
      this._state === 'copied'
        ? 'Copied.'
        : this._state === 'failed'
          ? 'Copy failed: the browser refused the clipboard. Select the text and copy it by hand.'
          : '';
    return html`<button
        type="button"
        class=${this._state}
        aria-label=${this.label}
        title=${this._state === 'failed' ? said : this.label}
        @click=${this._copy}
      >
        ${text}</button
      ><span class="sr-only" role="status">${said}</span>`;
  }

  private async _copy(): Promise<void> {
    if (this._timer !== null) window.clearTimeout(this._timer);
    this._timer = null;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard in this context');
      await navigator.clipboard.writeText(this.value);
      this._state = 'copied';
      this._timer = window.setTimeout(() => {
        this._state = 'idle';
        this._timer = null;
      }, COPIED_MS);
    } catch {
      this._state = 'failed';
    }
  }
}

customElements.define('dd-copy', DdCopy);
