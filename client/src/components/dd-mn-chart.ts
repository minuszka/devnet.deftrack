import { LitElement, css, html, svg, type TemplateResult } from 'lit';
import type { MasternodeTimelinePoint } from '@devnet-deftrack/shared';

/**
 * Masternode state over time.
 *
 * Three series on one axis: enabled masternodes, how many carry a penalty, and
 * the ceiling a single round could punish. The ceiling is drawn because a wave
 * only means something next to what was structurally possible -- 59 bans looks
 * different against a ceiling of 76 than against one of 16.
 */
export class DdMnChart extends LitElement {
  static override properties = { points: { attribute: false } };
  points: MasternodeTimelinePoint[] = [];

  static override styles = css`
    :host {
      display: block;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
    }
    .grid {
      stroke: var(--grid);
      stroke-width: 1;
    }
    .axis-label {
      fill: var(--ink-3);
      font-family: var(--font-mono);
      font-size: 9px;
    }
    .enabled {
      fill: none;
      stroke: var(--s1);
      stroke-width: 1.6;
    }
    .penalised {
      fill: none;
      stroke: var(--warn);
      stroke-width: 1.4;
    }
    .ceiling {
      fill: none;
      stroke: var(--ink-3);
      stroke-width: 1;
      stroke-dasharray: 3 3;
    }
    .banned-area {
      fill: var(--crit-wash);
      stroke: none;
    }
    .legend {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      padding: 8px 14px 12px;
      font-family: var(--font-mono);
      font-size: 10.5px;
      color: var(--ink-3);
    }
    .swatch {
      display: inline-block;
      width: 14px;
      height: 2px;
      vertical-align: middle;
      margin-right: 6px;
    }
    .empty {
      padding: 26px 14px;
      color: var(--ink-3);
      font-size: 13px;
    }
  `;

  override render(): TemplateResult {
    const pts = this.points;
    if (pts.length === 0) {
      return html`<div class="empty">No samples yet. The collector writes one when a count changes.</div>`;
    }

    const W = 900;
    const H = 240;
    const padL = 42;
    const padR = 14;
    const padT = 14;
    const padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxY = Math.max(
      1,
      ...pts.map((p) => Math.max(p.total, p.enabled, p.penalised, p.maxPossibleBan ?? 0))
    );
    const x = (i: number): number => padL + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
    const y = (v: number): number => padT + plotH - (v / maxY) * plotH;

    const line = (pick: (p: MasternodeTimelinePoint) => number | null): string =>
      pts
        .map((p, i) => {
          const v = pick(p);
          return v === null ? null : `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        })
        .filter(Boolean)
        .join(' ');

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f));

    return html`
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Masternode state over time">
        ${ticks.map(
          (t) => svg`
            <line class="grid" x1=${padL} x2=${W - padR} y1=${y(t)} y2=${y(t)}></line>
            <text class="axis-label" x=${padL - 6} y=${y(t) + 3} text-anchor="end">${t}</text>`
        )}
        <path class="ceiling" d=${line((p) => p.maxPossibleBan)}></path>
        <path class="penalised" d=${line((p) => p.penalised)}></path>
        <path class="enabled" d=${line((p) => p.enabled)}></path>
        <text class="axis-label" x=${padL} y=${H - 8}>${new Date(pts[0]!.at).toISOString().slice(11, 16)}</text>
        <text class="axis-label" x=${W - padR} y=${H - 8} text-anchor="end">
          ${new Date(pts.at(-1)!.at).toISOString().slice(11, 16)} UTC
        </text>
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
