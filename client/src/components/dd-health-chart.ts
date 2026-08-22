import { LitElement, css, html, svg, nothing, type TemplateResult } from 'lit';
import type { HealthTimelinePoint } from '@devnet-deftrack/shared';
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
 */
export class DdHealthChart extends LitElement {
  static override properties = {
    points: { attribute: false },
    minSize: { attribute: false },
  };

  points: HealthTimelinePoint[] = [];
  /** Draws the "cannot form below this" reference line when derivable. */
  minSize: number | null = null;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      svg {
        width: 100%;
        height: auto;
        display: block;
      }
      .axis-label {
        font-family: var(--font-mono);
        font-size: 9px;
        fill: var(--ink-3);
      }
      .rail-label {
        font-family: var(--font-mono);
        font-size: 9px;
        fill: var(--crit);
      }
      .empty {
        padding: 32px 16px;
        text-align: center;
        color: var(--ink-3);
        font-family: var(--font-mono);
        font-size: 12.5px;
      }
      .legend {
        display: flex;
        gap: 16px;
        padding: 8px 12px 0;
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: var(--ink-3);
        flex-wrap: wrap;
      }
      .key {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .swatch {
        width: 10px;
        height: 2px;
        background: var(--s1);
      }
      .swatch.fail {
        height: 8px;
        width: 2px;
        background: var(--crit);
      }
      .swatch.thr {
        background: var(--warn);
        height: 0;
        border-top: 1px dashed var(--warn);
      }
    `,
  ];

  override render(): TemplateResult {
    if (this.points.length === 0) {
      return html`<div class="empty">No rounds in this window.</div>`;
    }

    const W = 900;
    const H = 260;
    const padL = 44;
    const padR = 14;
    const padT = 14;
    const plotH = 176;
    const railY = padT + plotH + 26;

    const n = this.points.length;
    const x = (i: number): number =>
      n === 1 ? padL + (W - padL - padR) / 2 : padL + (i * (W - padL - padR)) / (n - 1);
    const y = (v: number): number => padT + plotH - v * plotH;

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

    return html`
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Health ratio per DKG round">
        ${[0, 0.25, 0.5, 0.75, 1].map(
          (t) => svg`
            <line x1=${padL} x2=${W - padR} y1=${y(t)} y2=${y(t)} stroke="var(--grid)" stroke-width="1" />
            <text class="axis-label" x=${padL - 8} y=${y(t) + 3} text-anchor="end">${(t * 100).toFixed(0)}%</text>
          `
        )}
        ${threshold !== null && threshold <= 1
          ? svg`
            <line x1=${padL} x2=${W - padR} y1=${y(threshold)} y2=${y(threshold)}
                  stroke="var(--warn)" stroke-width="1" stroke-dasharray="4 3" />
            <text class="axis-label" x=${W - padR} y=${y(threshold) - 4} text-anchor="end"
                  fill="var(--warn)">minSize</text>
          `
          : nothing}
        ${segments.map(
          (seg) => svg`
            <polyline fill="none" stroke="var(--s1)" stroke-width="1.5"
                      points=${seg.map((pt) => `${pt.x},${pt.y}`).join(' ')} />
          `
        )}
        ${formed.map(({ p, i }) => svg`<circle cx=${x(i)} cy=${y(p.healthRatio)} r="2.5" fill="var(--s1)" />`)}

        <line x1=${padL} x2=${W - padR} y1=${railY} y2=${railY} stroke="var(--line)" stroke-width="1" />
        ${failed.map(({ i }) => svg`<line x1=${x(i)} x2=${x(i)} y1=${railY - 7} y2=${railY + 7}
                                          stroke="var(--crit)" stroke-width="2" />`)}
        <text class="rail-label" x=${padL} y=${railY - 11} text-anchor="start">did not form</text>
      </svg>

      <div class="legend">
        <span class="key"><span class="swatch"></span> health ratio (formed)</span>
        <span class="key"><span class="swatch fail"></span> round did not form</span>
        ${threshold !== null ? html`<span class="key"><span class="swatch thr"></span> minSize floor</span>` : nothing}
      </div>
    `;
  }
}

customElements.define('dd-health-chart', DdHealthChart);
