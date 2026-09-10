import { LitElement, css, html, nothing, svg, type TemplateResult } from 'lit';
import type { BlockArrivalReport, ChainLockReport } from '../lib/api.js';
import { errorMessage, isAbortError } from '../lib/errors.js';
import { PollController, type PollRun } from '../lib/poll.js';
import { num } from '../lib/format.js';
import { baseStyles, cardStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';

const REFRESH_MS = 20_000;

export class DdPageChainLocks extends LitElement {
  static override properties = { _d: { state: true }, _arrival: { state: true }, _error: { state: true } };

  private _d: ChainLockReport | null = null;
  private _arrival: BlockArrivalReport | null = null;
  private _error = '';
  /** Interval, visibility, cancellation and the sequence guard, in one place. */
  private readonly _poll = new PollController(this, {
    intervalMs: REFRESH_MS,
    load: (run) => this._load(run),
  });

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    pageStyles,
    css`
      svg {
        display: block;
        width: 100%;
        height: auto;
      }
      .legend {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        padding: 8px 14px 12px;
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        color: var(--ink-3);
      }
      .swatch {
        display: inline-block;
        width: 10px;
        height: 10px;
        vertical-align: -1px;
        margin-right: 6px;
      }
      .caveat {
        color: var(--ink-3);
      }
    `,
  ];

  private async _load(run: PollRun): Promise<void> {
    try {
      // Same window for both, so the latency figures and the calibration
      // underneath them describe the same blocks.
      const [d, arrival] = await Promise.all([run.api.chainlocks(500), run.api.blockArrival(500)]);
      if (run.stale) return;
      this._d = d;
      this._arrival = arrival;
      this._error = '';
    } catch (error) {
      if (run.stale || isAbortError(error)) return;
      this._error = errorMessage(error);
    }
  }

  override render(): TemplateResult {
    const d = this._d;
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">ChainLocks</div>
          <div class="page-sub">
            Coverage counted from the first lock ever seen, not from the start of the chain: a
            ChainLock cannot exist before a quorum does, and counting the pre-masternode era as
            missed locks reported 88% where the truthful figure was 99%.
          </div>
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
      ${!d
        ? html`<div class="note">Loading…</div>`
        : html`${this._tiles(d)} ${this._strip(d)} ${this._gaps(d)} ${this._arrivalCard()}`}
    `;
  }

  private _tiles(d: ChainLockReport): TemplateResult {
    const cov = d.coverage;
    const fmtLatency = (ms: number | null): string =>
      ms === null ? '—' : ms < 1_000 ? `${Math.round(ms)}ms` : `${(ms / 1_000).toFixed(2)}s`;
    const exact = d.eventLatencyMs.p50 !== null;
    return html`
      <section class="tiles">
        <dd-stat
          label="Coverage"
          value=${cov === null ? '—' : `${(cov * 100).toFixed(1)}%`}
          sub="${num(d.locked)} of ${num(d.eligible)} eligible blocks"
          tone=${cov === null ? '' : cov >= 0.99 ? 'good' : cov >= 0.9 ? 'warn' : 'crit'}
        ></dd-stat>
        <dd-stat
          label="Unlocked"
          value=${num(d.unlocked)}
          sub="${num(d.gaps.length)} gap(s)"
          tone=${d.unlocked === 0 ? 'good' : 'warn'}
        ></dd-stat>
        <dd-stat
          label="Median latency"
          value=${exact ? fmtLatency(d.eventLatencyMs.p50) : d.latencySec.p50 === null ? '—' : `${d.latencySec.p50}s`}
          sub=${exact
            ? `ZMQ p90 ${fmtLatency(d.eventLatencyMs.p90)} · max ${fmtLatency(d.eventLatencyMs.max)}`
            : `poll estimate · p90 ${d.latencySec.p90 ?? '—'}s`}
        ></dd-stat>
        <dd-stat
          label="Locking began"
          value=${d.firstLockedHeight === null ? '—' : num(d.firstLockedHeight)}
          sub="first block ever locked"
        ></dd-stat>
        ${this._signerTile(d)}
      </section>

      <div class="note caveat">
        ${exact
          ? html`Latency is measured from the ZMQ block arrival to the ZMQ CLSIG arrival on the
              same host clock. <strong>${num(d.eventLatencyMeasured)}</strong> locks have exact timing;
              <strong>${num(d.sourceCounts.poll)}</strong> were recovered by polling. RPC reconciliation
              runs every <span class="mono">${d.reconciliationIntervalSec}s</span>.`
          : html`ZMQ event timing is not available yet. The displayed latency is a polling estimate
              with <span class="mono">${d.resolutionSec}s</span> resolution. Covered-but-unwatched locks
              are excluded rather than given an invented latency.`}
      </div>
    `;
  }

  /**
   * Which profile signs the locks right now, and where the switchover stands.
   *
   * Three states, strictly ordered: before activation the legacy profile
   * signs; past activation the first Q60 lock is still pending (the resolver
   * has flipped but no lock proves it yet); once one is observed, Q60 is live
   * from that height on -- one-way, so this tile never goes back.
   */
  private _signerTile(d: ChainLockReport): TemplateResult {
    const s = d.signers;
    const tipHeight = d.points.at(-1)?.height ?? 0;

    if (s.firstV2LockedHeight !== null) {
      return html`<dd-stat
        label="Signing quorum"
        value=${s.v2}
        sub="live since block ${num(s.firstV2LockedHeight)}"
        tone="good"
      ></dd-stat>`;
    }
    if (tipHeight >= s.activationHeight) {
      return html`<dd-stat
        label="Signing quorum"
        value="${s.v1} → ${s.v2}"
        sub="activation at ${num(s.activationHeight)} passed · first ${s.v2} lock pending"
        tone="warn"
      ></dd-stat>`;
    }
    return html`<dd-stat
      label="Signing quorum"
      value=${s.v1}
      sub="switches to ${s.v2} at block ${num(s.activationHeight)} · ${num(
        Math.max(0, s.activationHeight - tipHeight)
      )} blocks away"
    ></dd-stat>`;
  }

  /** One tick per block: present, missing, or present-but-untimed. */
  private _strip(d: ChainLockReport): TemplateResult {
    const pts = d.points;
    if (pts.length === 0) return html``;

    const W = 900;
    const H = 64;
    const w = W / pts.length;

    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Per block, oldest to newest</div>
          <div class="page-sub mono">${num(pts.length)} blocks</div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ChainLock presence per block">
          ${pts.map((p, i) =>
            svg`<rect
              x=${(i * w).toFixed(2)} y="10" width=${Math.max(1, w - 0.6).toFixed(2)} height="34"
              fill=${p.locked ? (p.latencyMs === null ? 'var(--accent-dim)' : 'var(--accent)') : 'var(--crit)'}
            ><title>${p.height}${p.locked ? (p.latencyMs === null ? ` · locked (${p.source ?? 'untimed'})` : ` · ${p.latencyMs}ms · ZMQ`) : ' · no lock'}${p.signer ? ` · signed by ${p.signer}` : ''}</title></rect>`
          )}
          ${this._activationLine(d, pts, w, H)}
        </svg>
        <div class="legend">
          <span><i class="swatch" style="background: var(--accent)"></i>locked, latency measured</span>
          <span><i class="swatch" style="background: var(--accent-dim)"></i>locked before we watched</span>
          <span><i class="swatch" style="background: var(--crit)"></i>no lock</span>
          ${this._activationVisible(d, pts)
            ? html`<span><i class="swatch" style="background: var(--warn)"></i>${d.signers.v2} activation
                (${num(d.signers.activationHeight)})</span>`
            : nothing}
        </div>
      </section>
    `;
  }

  private _activationVisible(d: ChainLockReport, pts: ChainLockReport['points']): boolean {
    const act = d.signers.activationHeight;
    return pts.length > 0 && pts[0]!.height <= act && pts.at(-1)!.height >= act;
  }

  /**
   * A vertical marker on the boundary between the last legacy-signed block and
   * the first Q60-signed one, drawn only while that boundary is in the window.
   */
  private _activationLine(
    d: ChainLockReport,
    pts: ChainLockReport['points'],
    w: number,
    h: number
  ): ReturnType<typeof svg> | typeof nothing {
    if (!this._activationVisible(d, pts)) return nothing;
    const idx = pts.findIndex((p) => p.height >= d.signers.activationHeight);
    if (idx < 0) return nothing;
    const x = (idx * w).toFixed(2);
    return svg`<line x1=${x} y1="4" x2=${x} y2=${h - 4} stroke="var(--warn)" stroke-width="2"
      ><title>${d.signers.v2} activation at ${d.signers.activationHeight}</title></line>`;
  }

  private _gaps(d: ChainLockReport): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Gaps</div>
          <div class="page-sub mono">runs of consecutive unlocked blocks</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">Runs of blocks in the window that carry no ChainLock.</caption>
              <thead>
                <tr><th scope="col" class="r">From</th><th scope="col" class="r">To</th><th scope="col" class="r">Blocks</th></tr>
              </thead>
              <tbody>
                ${d.gaps.length === 0
                  ? html`<tr><td class="empty" colspan="3">
                      Every eligible block since height ${num(d.firstLockedHeight ?? 0)} carries a ChainLock.
                    </td></tr>`
                  : d.gaps.map(
                      (g) => html`
                        <tr>
                          <td class="r mono"><a href="/block/${g.from}">${num(g.from)}</a></td>
                          <td class="r mono"><a href="/block/${g.to}">${num(g.to)}</a></td>
                          <td class="r mono">${num(g.blocks)}</td>
                        </tr>
                      `
                    )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * How late this node's own view of a block is -- the calibration of the
   * instrument every latency above was measured with.
   *
   * It sits on this page because the ChainLock numbers are the ones it
   * qualifies: a lock that "arrived slowly" may be a block that arrived
   * slowly. Two of sixty InstantSend transactions measured on 2026-09-10 read
   * as a quorum failure and were exactly that.
   */
  private _arrivalCard(): TemplateResult | typeof nothing {
    const a = this._arrival;
    if (!a) return nothing;

    const fmt = (s: number | null): string => {
      if (s === null) return '—';
      if (Math.abs(s) < 60) return `${s.toFixed(1)}s`;
      const m = Math.floor(Math.abs(s) / 60);
      const rest = Math.round(Math.abs(s) % 60);
      return `${s < 0 ? '−' : ''}${m}m ${rest}s`;
    };
    const late = (thresholdSec: number) => a.late.find((l) => l.thresholdSec === thresholdSec);
    const worst = late(120);

    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Block arrival at this node</div>
          <div class="page-sub mono">
            ${a.measured === 0 ? 'nothing measured' : `p50 ${fmt(a.lagSec.p50)} · max ${fmt(a.lagSec.max)}`}
          </div>
        </div>
        <div class="card-body">
          ${!a.zmqEnabled
            ? html`<div class="note caveat">
                The live feed is switched off, so no block has an arrival time. The polling
                fallback measures the poll interval, not the arrival, and is deliberately not
                shown here as if it were one.
              </div>`
            : a.measured === 0
              ? html`<div class="note caveat">
                  None of the ${num(a.blocksConsidered)} blocks in this window was seen arriving —
                  they were indexed before the watcher ran. That is a gap in the record, not a set
                  of instant arrivals, so no distribution is shown.
                </div>`
              : html`
                  <div class="note">
                    Each block's own timestamp against the moment this node handed it to us:
                    <span class="mono">p50 ${fmt(a.lagSec.p50)}</span>,
                    <span class="mono">p90 ${fmt(a.lagSec.p90)}</span>,
                    <span class="mono">p99 ${fmt(a.lagSec.p99)}</span>,
                    <span class="mono">max ${fmt(a.lagSec.max)}</span> over
                    <strong>${num(a.measured)}</strong> measured blocks.
                    ${late(30) && late(30)!.blocks > 0
                      ? html`<span class="mono"
                          >${num(late(30)!.blocks)} over 30s (${(late(30)!.share! * 100).toFixed(1)}%)</span
                        >, `
                      : html`None over 30s. `}
                    ${worst && worst.blocks > 0
                      ? html`<span class="mono"
                          >${num(worst.blocks)} over 120s (${(worst.share! * 100).toFixed(1)}%)</span
                        >.`
                      : html`None over 120s.`}
                  </div>
                  <div class="note caveat">
                    The timestamp is the producing node's clock and the sighting is ours, so a
                    negative value means the two disagree rather than that a block arrived early;
                    it is kept rather than clamped. Shares are over the ${num(a.measured)} measured
                    blocks, never over the ${num(a.blocksConsidered)} in the window
                    (${num(a.unmeasured)} were never seen arriving). The tail is the whole story:
                    on this devnet the median is a couple of seconds while a few per cent of blocks
                    land minutes late, and while that lasts nothing in RPC says so.
                  </div>
                `}
        </div>
        ${a.slowest.length === 0
          ? nothing
          : html`
              <div class="card-body flush">
                <div class="twrap">
                  <table>
                    <caption class="sr-only">
                      The blocks in this window that reached this node latest.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" class="r">Height</th>
                        <th scope="col" class="r">Late by</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${a.slowest.slice(0, 8).map(
                        (p) => html`
                          <tr>
                            <td class="r mono"><a href="/block/${p.height}">${num(p.height)}</a></td>
                            <td class="r mono">${fmt(p.lagSec)}</td>
                          </tr>
                        `
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            `}
      </section>
    `;
  }
}

customElements.define('dd-page-chainlocks', DdPageChainLocks);
