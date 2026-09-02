import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { baseStyles } from '../styles/shared.js';

const TONE_WORD: Record<string, string> = {
  good: 'healthy',
  warn: 'warning',
  crit: 'critical',
  accent: 'live',
};

/**
 * A single labelled figure.
 *
 * The value is the point of the tile, so it is the biggest thing on it. Tone
 * colours the value and the tile's edge, and it also says its name in a small
 * chip, so a state is never told by colour alone. When the value changes
 * between polls, the figure -- and only the figure -- lights up for a moment.
 */
export class DdStat extends LitElement {
  static override properties = {
    label: { type: String },
    value: { type: String },
    sub: { type: String },
    tone: { type: String, reflect: true },
    _changed: { state: true },
  };

  label = '';
  value = '';
  sub = '';
  tone: '' | 'good' | 'warn' | 'crit' | 'accent' = '';
  private _changed = false;
  private _seen = false;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        min-width: 0;
        background: var(--surface);
        border: 1px solid var(--line);
        border-left: 3px solid var(--line-strong);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow);
        padding: var(--sp-4) var(--sp-5);
        transition: border-color var(--t-base) var(--ease);
      }
      :host([tone='good']) { border-left-color: var(--good); }
      :host([tone='warn']) { border-left-color: var(--warn); }
      :host([tone='crit']) { border-left-color: var(--crit); }
      :host([tone='accent']) { border-left-color: var(--accent); }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sp-2);
      }
      .label {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-3);
      }
      .state {
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        padding: 3px 7px;
        border: 1px solid currentColor;
        border-radius: var(--radius);
        line-height: 1;
      }
      .state.good { color: var(--good); }
      .state.warn { color: var(--warn); }
      .state.crit { color: var(--crit); }
      .state.accent { color: var(--accent); }

      .value {
        font-family: var(--font-mono);
        font-size: var(--fs-metric);
        font-weight: 700;
        line-height: 1.1;
        letter-spacing: -0.01em;
        font-variant-numeric: tabular-nums;
        border-radius: var(--radius);
        /* Grow left-to-right without moving the neighbours. */
        display: inline-block;
        align-self: flex-start;
      }
      .value.good { color: var(--good); }
      .value.warn { color: var(--warn); }
      .value.crit { color: var(--crit); }
      .value.accent { color: var(--accent); }
      .sub {
        font-size: var(--fs-sm);
        color: var(--ink-2);
        line-height: 1.4;
      }
    `,
  ];

  override updated(changed: PropertyValues): void {
    if (!changed.has('value')) return;
    // The first value is arrival, not change.
    if (!this._seen) {
      this._seen = true;
      return;
    }
    if (changed.get('value') !== undefined && changed.get('value') !== this.value) {
      this._changed = false;
      // Restart the animation even when the previous one is still running.
      void this.updateComplete.then(() => {
        this._changed = true;
      });
    }
  }

  override render(): TemplateResult {
    const word = TONE_WORD[this.tone] ?? '';
    return html`
      <div class="head">
        <div class="label">${this.label}</div>
        ${word ? html`<span class="state ${this.tone}">${word}</span>` : nothing}
      </div>
      <div class="value ${this.tone} ${this._changed ? 'changed' : ''}" @animationend=${() => (this._changed = false)}>
        ${this.value}
      </div>
      ${this.sub ? html`<div class="sub">${this.sub}</div>` : nothing}
    `;
  }
}

customElements.define('dd-stat', DdStat);
