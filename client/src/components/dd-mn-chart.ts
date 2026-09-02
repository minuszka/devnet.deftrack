import { LitElement, css, html, svg, type TemplateResult } from 'lit';
import type { MasternodeTimelinePoint } from '@devnet-deftrack/shared';
import { baseStyles } from '../styles/shared.js';

/**
 * Masternode state over time.
 *
 * Three series on one axis: enabled masternodes, how many carry a penalty, and
 * the ceiling a single round could punish. The ceiling is drawn because a wave
 * only means something next to what was structurally possible -- 59 bans looks
 * different against a ceiling of 76 than against one of 16.
 *
 * Drawn at the element's real width in real pixels, like the health chart, so
 * the labels stay one size whatever the screen.
 */
const H = 300;
const PAD_L = 56;
const PAD_R = 24;
const PAD_T = 20;
const PAD_B = 40;

export class DdMnChart extends LitElement {
  static override properties = { points: { attribute: false }, _width: { state: true } };
  points: MasternodeTimelinePoint[] = [];
  private _width = 900;
  private _ro: ResizeObserver | null = null;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      svg {
        display: block;
        width: 100%;
        height: ${H}px;
      }
      .grid {
        stroke: var(--grid);
        stroke-width: 1;
      }
      .axis-label {
        fill: var(--ink-3);
        font-family: var(--font-mono);
        font-size: 12px;
      }
      .enabled {
        fill: none;
        stroke: var(--s1);
        stroke-width: 2;
        stroke-linejoin: round;
      }
      .penalised {
        fill: none;
        stroke: var(--warn);
        stroke-width: 1.8;
        stroke-linejoin: round;
      }
      .ceiling {
        fill: none;
        stroke: var(--ink-3);
        stroke-width: 1.2;
        stroke-dasharray: 4 4;
      }
      .legend {
        display: flex;
        gap: var(--sp-5);
        flex-wrap: wrap;
        padding: var(--sp-2) var(--sp-4) var(--sp-3);
        border-top: 1px solid var(--line-soft);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        color: var(--ink-3);
      }
      .swatch {
        display: inline-block;
        width: 14px;
        height: 2px;
        vertical-align: middle;
        margin-right: 8px;
      }
      .empty {
        padding: var(--sp-6) var(--sp-4);
        color: var(--ink-3);
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
        text-align: center;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    this._width = Math.max(600, this.clientWidth || 900);
    this._ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0 && w !== this._width) this._width = Math.max(600, w);
    });
    this._ro.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._ro?.disconnect();
    this._ro = null;
  }

  override render(): TemplateResult {
    const pts = this.points;
    if (pts.length === 0) {
      return html`<div class="empty">No samples yet. The collector writes one when a count changes.</div>`;
    }

    const W = this._width;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const maxY = Math.max(
      1,
      ...pts.map((p) => Math.max(p.total, p.enabled, p.penalised, p.maxPossibleBan ?? 0))
    );
    const x = (i: number): number => PAD_L + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
    const y = (v: number): number => PAD_T + plotH - (v / maxY) * plotH;

    const line = (pick: (p: MasternodeTimelinePoint) => number | null): string =>
      pts
        .map((p, i) => {
          const v = pick(p);
          return v === null ? null : `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        })
        .filter(Boolean)
        .join(' ');

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f));
    const stamp = (p: MasternodeTimelinePoint): string => new Date(p.at).toISOString().slice(11, 16);
    const mid = pts[Math.floor((pts.length - 1) / 2)];

    return html`
      <svg viewBox="0 0 ${W} ${H}" width=${W} height=${H} role="img" aria-label="Masternode state over time">
        ${ticks.map(
          (t) => svg`
            <line class="grid" x1=${PAD_L} x2=${W - PAD_R} y1=${y(t)} y2=${y(t)}></line>
            <text class="axis-label" x=${PAD_L - 10} y=${y(t) + 4} text-anchor="end">${t}</text>`
        )}
        <line x1=${PAD_L} x2=${PAD_L} y1=${PAD_T} y2=${PAD_T + plotH} stroke="var(--axis)" stroke-width="1" />
        <path class="ceiling" d=${line((p) => p.maxPossibleBan)}></path>
        <path class="penalised" d=${line((p) => p.penalised)}></path>
        <path class="enabled" d=${line((p) => p.enabled)}></path>
        <text class="axis-label" x=${PAD_L} y=${H - 12}>${stamp(pts[0]!)} UTC</text>
        ${pts.length > 2 && mid
          ? svg`<text class="axis-label" x=${x(Math.floor((pts.length - 1) / 2))} y=${H - 12} text-anchor="middle">${stamp(mid)}</text>`
          : ''}
        <text class="axis-label" x=${W - PAD_R} y=${H - 12} text-anchor="end">${stamp(pts.at(-1)!)} UTC</text>
      </svg>
      <div class="legend">
        <span><i class="swatch" style="background: var(--s1)"></i>enabled</span>
        <span><i class="swatch" style="background: var(--warn)"></i>carrying a penalty</span>
        <span><i class="swatch" style="background: var(--ink-3)"></i>max possible ban</span>
      </div>
    `;
  }
}

customElements.define('dd-mn-chart', DdMnChart);
