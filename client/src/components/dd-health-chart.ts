import { LitElement, css, html, svg, nothing, type TemplateResult } from 'lit';
import type { HealthTimelinePoint } from '@devnet-deftrack/shared';
import { ago, num, ratio } from '../lib/format.js';
import { roundVerdict } from '../lib/roundVerdict.js';
import { baseStyles } from '../styles/shared.js';

/**
 * Health ratio across DKG rounds.
 *
 * The distribution of this series over 50-100 rounds is the acceptance
 * criterion for the profile, so it is the most important chart on the site.
 *
 * A round that did not form has no health ratio. It is drawn as a tick on the
 * failure rail below the plot, never as a point at zero -- a zero would assert
 * that the quorum formed with no valid members, which is a different and
 * untrue statement.
 *
 * Colour follows the same rule as every table here: the incident is a round
 * that formed and punished members, so that is the amber one. A round that did
 * not form is muted, because it punished nobody -- it used to be the loudest
 * mark on the chart.
 *
 * Drawn at the element's real width in real pixels rather than scaled from a
 * fixed viewBox, so the labels are the same size on a laptop and on a wall,
 * and the height is the height an operator can read across a room.
 */
const PAD_L = 62;
const PAD_R = 26;
const PAD_T = 26;
/** Below the plot: the failure rail, then the height labels. */
const BELOW = 136;

/** Taller on a wider screen: a wall display gets a chart it can read across a room. */
function heightFor(width: number): number {
  return width >= 2000 ? 460 : width >= 1400 ? 390 : 340;
}

export class DdHealthChart extends LitElement {
  static override properties = {
    points: { attribute: false },
    minSize: { attribute: false },
    _width: { state: true },
    _hover: { state: true },
  };

  points: HealthTimelinePoint[] = [];
  /** Draws the "cannot form below this" reference line when derivable. */
  minSize: number | null = null;
  private _width = 900;
  private _hover: number | null = null;
  private _ro: ResizeObserver | null = null;
  private _raf = 0;
  private _pendingHover: number | null = null;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        position: relative;
      }
      svg {
        width: 100%;
        height: auto;
        display: block;
        cursor: crosshair;
      }
      .axis-label {
        font-family: var(--font-mono);
        font-size: 12px;
        fill: var(--ink-3);
      }
      .axis-label.thr {
        fill: var(--warn);
      }
      .rail-label {
        font-family: var(--font-mono);
        font-size: 12px;
        /* Muted, not critical. A round that did not form is a non-event for
           PoSe: no commitment is mined, so nobody is punished. Painting it the
           alarm colour put the loudest mark on the chart under the one thing
           that harmed nobody. */
        fill: var(--ink-3);
        letter-spacing: 0.04em;
      }
      .pt {
        transition: r var(--t-fast) var(--ease);
      }
      /* Focus has to be visible on a shape too, and SVG will not take a
         border: the ring is drawn as a stroke. */
      svg :focus-visible {
        outline: none;
        stroke: var(--accent);
        stroke-width: 3;
      }
      .empty {
        padding: var(--sp-6) var(--sp-4);
        text-align: center;
        color: var(--ink-3);
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
      }
      .legend {
        display: flex;
        gap: var(--sp-5);
        padding: var(--sp-2) var(--sp-4) var(--sp-3);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        color: var(--ink-3);
        flex-wrap: wrap;
        border-top: 1px solid var(--line-soft);
      }
      .key {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .swatch {
        width: 14px;
        height: 2px;
        background: var(--s1);
      }
      .swatch.fail {
        height: 12px;
        width: 3px;
        background: var(--ink-3);
      }
      /* The incident: a round that formed and punished members. */
      .swatch.punish {
        height: 8px;
        width: 8px;
        border-radius: 50%;
        background: var(--warn);
      }
      .swatch.thr {
        background: none;
        height: 0;
        border-top: 2px dashed var(--warn);
      }
      /* The tooltip follows the nearest round; it never takes the pointer. */
      .tip {
        position: absolute;
        transform: translate(-50%, calc(-100% - 14px));
        pointer-events: none;
        z-index: 2;
        min-width: 180px;
        padding: var(--sp-2) var(--sp-3);
        background: var(--surface-3);
        border: 1px solid var(--line-strong);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-2);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        color: var(--ink-2);
        white-space: nowrap;
        line-height: 1.5;
      }
      .tip b {
        color: var(--ink);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .tip .st {
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 700;
      }
      .tip .st.formed { color: var(--good); }
      .tip .st.failed { color: var(--ink-3); }
      .tip .st.pending { color: var(--warn); }
      .tip .st.impossible { color: var(--ink-3); }
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
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  private _x(i: number): number {
    const n = this.points.length;
    const W = this._width;
    return n === 1 ? PAD_L + (W - PAD_L - PAD_R) / 2 : PAD_L + (i * (W - PAD_L - PAD_R)) / (n - 1);
  }

  private _plotH(): number {
    return heightFor(this._width) - BELOW - PAD_T;
  }

  private _y(v: number): number {
    const plotH = this._plotH();
    return PAD_T + plotH - v * plotH;
  }

  /** Nearest round to the pointer, one state write per animation frame. */
  private _onMove(e: MouseEvent): void {
    const n = this.points.length;
    if (n === 0) return;
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const step = n === 1 ? 1 : (this._width - PAD_L - PAD_R) / (n - 1);
    const i = Math.max(0, Math.min(n - 1, Math.round((x - PAD_L) / step)));
    this._pendingHover = i;
    if (!this._raf) {
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        if (this._pendingHover !== this._hover) this._hover = this._pendingHover;
      });
    }
  }

  private _onLeave = (): void => {
    this._pendingHover = null;
    this._hover = null;
  };

  /**
   * Keyboard focus reads a round the same way the pointer does. Without this
   * the numbers behind the chart were reachable with a mouse and by no other
   * means -- the tooltip was the only place they existed.
   */
  private _focusPoint(i: number): void {
    this._pendingHover = i;
    this._hover = i;
  }

  private _pointLabel(p: HealthTimelinePoint): string {
    const verdict = roundVerdict({ status: p.status, punishedCount: p.punishedCount });
    const health =
      typeof p.healthRatio === 'number'
        ? `health ${ratio(p.healthRatio)}, ${num(p.numValidMembers)} of ${num(p.effectiveSize)} members valid`
        : 'no commitment mined';
    return `Round at height ${num(p.expectedHeight)}: ${verdict.label}, ${health}, punished ${verdict.punished}.`;
  }

  override render(): TemplateResult {
    if (this.points.length === 0) {
      return html`<div class="empty">No rounds in this window.</div>`;
    }

    const W = this._width;
    const H = heightFor(W);
    const PLOT_H = this._plotH();
    const RAIL_Y = PAD_T + PLOT_H + 40;
    const XLABEL_Y = RAIL_Y + 34;
    const n = this.points.length;
    const x = (i: number): number => this._x(i);
    const y = (v: number): number => this._y(v);

    const formed = this.points
      .map((p, i) => ({ p, i }))
      .filter((d): d is { p: HealthTimelinePoint & { healthRatio: number }; i: number } =>
        typeof d.p.healthRatio === 'number'
      );

    // Break the line wherever a round did not form, so the eye is not led
    // across a gap that never had data.
    const segments: Array<Array<{ x: number; y: number }>> = [];
    let current: Array<{ x: number; y: number }> = [];
    for (const { p, i } of this.points.map((p, i) => ({ p, i }))) {
      if (typeof p.healthRatio === 'number') {
        current.push({ x: x(i), y: y(p.healthRatio) });
      } else if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    }
    if (current.length > 0) segments.push(current);

    const failed = this.points.map((p, i) => ({ p, i })).filter((d) => d.p.status === 'failed');

    const threshold =
      this.minSize !== null && this.points[0]?.effectiveSize
        ? this.minSize / this.points[0].effectiveSize
        : null;

    // A handful of height labels along the bottom, evenly spaced in index.
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - PAD_L - PAD_R) / 160))));
    const xTicks: number[] = [];
    for (let i = 0; i < n; i += every) xTicks.push(i);
    if (xTicks[xTicks.length - 1] !== n - 1 && n - 1 - (xTicks[xTicks.length - 1] ?? 0) > every / 2) xTicks.push(n - 1);

    const hi = this._hover;
    const hover: HealthTimelinePoint | null = hi !== null ? (this.points[hi] ?? null) : null;
    const summary = `${n} rounds: ${formed.length} formed, ${failed.length} did not form`;

    return html`
      <svg
        viewBox="0 0 ${W} ${H}"
        width=${W}
        height=${H}
        role="group"
        aria-label="Health ratio per DKG round. ${summary}."
        @mousemove=${this._onMove}
        @mouseleave=${this._onLeave}
      >
        ${[0, 0.25, 0.5, 0.75, 1].map(
          (t) => svg`
            <line x1=${PAD_L} x2=${W - PAD_R} y1=${y(t)} y2=${y(t)} stroke="var(--grid)" stroke-width="1" />
            <text class="axis-label" x=${PAD_L - 12} y=${y(t) + 4} text-anchor="end">${(t * 100).toFixed(0)}%</text>
          `
        )}
        <line x1=${PAD_L} x2=${PAD_L} y1=${PAD_T} y2=${PAD_T + PLOT_H} stroke="var(--axis)" stroke-width="1" />
        ${threshold !== null && threshold <= 1
          ? svg`
            <line x1=${PAD_L} x2=${W - PAD_R} y1=${y(threshold)} y2=${y(threshold)}
                  stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="6 4" />
            <text class="axis-label thr" x=${W - PAD_R} y=${y(threshold) + 16} text-anchor="end">minSize floor · ${ratio(threshold)}</text>
          `
          : nothing}
        ${hi !== null
          ? svg`<line x1=${x(hi)} x2=${x(hi)} y1=${PAD_T} y2=${RAIL_Y + 12} stroke="var(--axis)" stroke-width="1" stroke-dasharray="3 3" />`
          : nothing}
        ${segments.map(
          (seg) => svg`
            <polyline fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round"
                      points=${seg.map((pt) => `${pt.x},${pt.y}`).join(' ')} />
          `
        )}
        ${formed.map(
          ({ p, i }) =>
            svg`<circle class="pt" cx=${x(i)} cy=${y(p.healthRatio)} r=${i === hi ? 6 : p.punishedCount > 0 ? 4.5 : 3}
                        fill=${p.punishedCount > 0 ? 'var(--warn)' : 'var(--s1)'}
                        stroke=${i === hi ? 'var(--bg)' : 'none'} stroke-width="2"
                        tabindex="0" role="img" aria-label=${this._pointLabel(p)}
                        @focus=${() => this._focusPoint(i)} @blur=${this._onLeave} />`
        )}

        <line x1=${PAD_L} x2=${W - PAD_R} y1=${RAIL_Y} y2=${RAIL_Y} stroke="var(--line)" stroke-width="1" />
        ${failed.map(
          ({ p, i }) => svg`<line x1=${x(i)} x2=${x(i)} y1=${RAIL_Y - (i === hi ? 13 : 9)} y2=${RAIL_Y + (i === hi ? 13 : 9)}
                                stroke="var(--ink-3)" stroke-width=${i === hi ? 4 : 2.5}
                                tabindex="0" role="img" aria-label=${this._pointLabel(p)}
                                @focus=${() => this._focusPoint(i)} @blur=${this._onLeave} />`
        )}
        <text class="rail-label" x=${PAD_L} y=${RAIL_Y - 18} text-anchor="start">did not form</text>

        ${xTicks.map(
          (i) => svg`<text class="axis-label" x=${x(i)} y=${XLABEL_Y}
                           text-anchor=${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>${num(this.points[i]?.expectedHeight ?? 0)}</text>`
        )}
      </svg>

      ${hover !== null && hi !== null ? this._tooltip(hover, x(hi), typeof hover.healthRatio === 'number' ? y(hover.healthRatio) : RAIL_Y - 12) : nothing}

      <div class="legend">
        <span class="key"><span class="swatch"></span> health ratio (formed)</span>
        <span class="key"><span class="swatch punish"></span> round punished members</span>
        <span class="key"><span class="swatch fail"></span> round did not form (nobody punished)</span>
        ${threshold !== null ? html`<span class="key"><span class="swatch thr"></span> minSize floor</span>` : nothing}
        <span class="key subtle">hover a round for its numbers</span>
      </div>
    `;
  }

  private _tooltip(p: HealthTimelinePoint, px: number, py: number): TemplateResult {
    const left = Math.max(100, Math.min(this._width - 100, px));
    // The same reading as every table on the site, from the same function.
    const verdict = roundVerdict({ status: p.status, punishedCount: p.punishedCount });
    return html`
      <div class="tip" style="left:${left}px;top:${py}px" role="status">
        <div>
          <b>H ${num(p.expectedHeight)}</b> ·
          <span class="st ${p.status}">${verdict.label}</span>
        </div>
        ${typeof p.healthRatio === 'number'
          ? html`<div>health <b>${ratio(p.healthRatio)}</b> · valid <b>${num(p.numValidMembers)}/${num(p.effectiveSize)}</b></div>`
          : html`<div>no commitment mined</div>`}
        <div>punished <b>${verdict.punished}</b> · ${ago(p.detectedAt)}</div>
      </div>
    `;
  }
}

customElements.define('dd-health-chart', DdHealthChart);
