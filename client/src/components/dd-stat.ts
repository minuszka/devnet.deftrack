import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { baseStyles } from '../styles/shared.js';

/** A single labelled figure. Tone colours the value, never the whole tile. */
export class DdStat extends LitElement {
  static override properties = {
    label: { type: String },
    value: { type: String },
    sub: { type: String },
    tone: { type: String },
  };

  label = '';
  value = '';
  sub = '';
  tone: '' | 'good' | 'warn' | 'crit' | 'accent' = '';

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        background: var(--surface);
        border: 1px solid var(--line);
        padding: 12px 14px;
      }
      .label {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--ink-3);
      }
      .value {
        font-family: var(--font-mono);
        font-size: 22px;
        font-weight: 700;
        line-height: 1.25;
        margin-top: 6px;
        font-variant-numeric: tabular-nums;
      }
      .value.good {
        color: var(--good);
      }
      .value.warn {
        color: var(--warn);
      }
      .value.crit {
        color: var(--crit);
      }
      .value.accent {
        color: var(--accent);
      }
      .sub {
        font-size: 12px;
        color: var(--ink-3);
        margin-top: 2px;
      }
    `,
  ];

  override render(): TemplateResult {
    return html`
      <div class="label">${this.label}</div>
      <div class="value ${this.tone}">${this.value}</div>
      ${this.sub ? html`<div class="sub">${this.sub}</div>` : nothing}
    `;
  }
}

customElements.define('dd-stat', DdStat);
