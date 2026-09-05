import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { BanWaveReport, MasternodeEventRow, MasternodeTimelinePoint } from '@devnet-deftrack/shared';
import { errorMessage, isAbortError } from '../lib/errors.js';
import { PollController, type PollRun } from '../lib/poll.js';
import { ago, num } from '../lib/format.js';
import { baseStyles, cardStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';
import './dd-mn-chart.js';

const REFRESH_MS = 30_000;

/**
 * PoSe Watch.
 *
 * The page that did not exist when 59 of 80 masternodes were banned inside an
 * hour. Its job is to make a wave visible while it is still climbing, not only
 * once it has landed -- so penalty count leads, and the ban count follows.
 */
export class DdPagePose extends LitElement {
  static override properties = {
    _points: { state: true },
    _waves: { state: true },
    _events: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  private _points: MasternodeTimelinePoint[] = [];
  private _waves: BanWaveReport | null = null;
  private _events: MasternodeEventRow[] = [];
  private _error = '';
  private _loading = true;
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
      .kind {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 2px 7px;
        border: 1px solid var(--line-strong);
        color: var(--ink-2);
      }
      .kind.banned {
        color: var(--crit);
        border-color: var(--crit);
      }
      .kind.revived {
        color: var(--good);
        border-color: var(--good);
      }
      .kind.penalty_up {
        color: var(--warn);
        border-color: var(--warn);
      }
      .ceiling {
        color: var(--ink-3);
      }
    `,
  ];

  private async _load(run: PollRun): Promise<void> {
    try {
      const [timeline, waves, events] = await Promise.all([
        run.api.masternodeTimeline(24),
        run.api.banWaves(24 * 7),
        run.api.masternodeEvents({ hours: 24 * 7, limit: 40 }),
      ]);
      if (run.stale) return;
      this._points = timeline.points;
      this._waves = waves;
      this._events = events.items;
      this._error = '';
    } catch (error) {
      if (run.stale || isAbortError(error)) return;
      this._error = errorMessage(error);
    } finally {
      if (!run.stale) this._loading = false;
    }
  }

  override render(): TemplateResult {
    const latest = this._points.at(-1);
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">PoSe Watch</div>
          <div class="page-sub">
            Masternode punishment over time, and how large a single episode grew against the
            ceiling the profile allows.
          </div>
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
      ${this._loading && this._points.length === 0 ? html`<div class="note">Loading…</div>` : nothing}

      ${latest ? this._tiles(latest) : nothing}
      ${this._chart()}
      ${this._waveTable()}
      ${this._eventTable()}
    `;
  }

  private _tiles(p: MasternodeTimelinePoint): TemplateResult {
    const w = this._waves;
    return html`
      <section class="tiles">
        <dd-stat
          label="Enabled masternodes"
          value=${num(p.enabled)}
          sub="${num(p.banned)} banned of ${num(p.total)}"
          tone=${p.banned === 0 ? 'good' : 'crit'}
        ></dd-stat>
        <dd-stat
          label="Carrying a penalty"
          value=${num(p.penalised)}
          sub="highest ${num(p.penaltyMax)}"
          tone=${p.penalised === 0 ? 'good' : 'warn'}
        ></dd-stat>
        <dd-stat
          label="Max possible ban"
          value=${num(p.maxPossibleBan)}
          sub="effective size ${num(p.effectiveQuorumSize)} − minSize"
        ></dd-stat>
        <dd-stat
          label="Largest wave (7d)"
          value=${num(w?.largestWave ?? 0)}
          sub="${num(w?.totalBans ?? 0)} bans in ${num(w?.waves.length ?? 0)} episode(s)"
          tone=${(w?.largestWave ?? 0) > 0 ? 'crit' : 'good'}
        ></dd-stat>
      </section>
    `;
  }

  private _chart(): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Masternode state, last 24 h</div>
        </div>
        <div class="card-body flush">
          <dd-mn-chart .points=${this._points}></dd-mn-chart>
        </div>
      </section>
    `;
  }

  private _waveTable(): TemplateResult {
    const waves = this._waves?.waves ?? [];
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Ban waves</div>
          <div class="page-sub mono">7 days · bans within 30 min grouped</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">Episodes in which several masternodes were PoSe-banned close together.</caption>
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col" class="r">Duration</th>
                  <th scope="col" class="r">Size</th>
                  <th scope="col" class="r">Ceiling then</th>
                  <th scope="col" class="r">Heights</th>
                  <th scope="col">By host</th>
                  <th scope="col">By operator</th>
                </tr>
              </thead>
              <tbody>
                ${waves.length === 0
                  ? html`<tr>
                      <td class="empty" colspan="7">
                        No bans recorded in this window. The collector only reports what it observed —
                        episodes from before it started are deliberately absent rather than reconstructed.
                      </td>
                    </tr>`
                  : waves.map(
                      (w) => html`
                        <tr>
                          <td class="mono">${ago(w.startedAt)}</td>
                          <td class="r mono">${num(w.durationMinutes)} min</td>
                          <td class="r mono"><strong>${num(w.size)}</strong></td>
                          <td class="r mono ceiling">${num(w.maxPossibleBanAtStart)}</td>
                          <td class="r mono">${num(w.firstHeight)}–${num(w.lastHeight)}</td>
                          <td>${w.byHost.map((h) => `${h.hostLabel} (${h.count})`).join(', ')}</td>
                          <td>${w.byOperator.map((o) => `${o.operatorLabel} (${o.count})`).join(', ')}</td>
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

  private _eventTable(): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Recent transitions</div>
          <div class="page-sub mono">${num(this._events.length)} shown</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">Recent masternode state transitions: bans, revivals and penalty increases.</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Event</th>
                  <th scope="col" class="r">Height</th>
                  <th scope="col">Masternode</th>
                  <th scope="col">Host</th>
                  <th scope="col" class="r">Penalty</th>
                </tr>
              </thead>
              <tbody>
                ${this._events.length === 0
                  ? html`<tr><td class="empty" colspan="6">No transitions recorded yet.</td></tr>`
                  : this._events.map(
                      (e) => html`
                        <tr>
                          <td class="mono">${ago(e.detectedAt)}</td>
                          <td><span class="kind ${e.type}">${e.type.replace('_', ' ')}</span></td>
                          <td class="r mono">${num(e.height)}</td>
                          <td class="mono">${e.proTxHash.slice(0, 12)}…</td>
                          <td class="mono">${e.hostLabel ?? '—'}</td>
                          <td class="r mono">
                            ${e.penaltyBefore === null && e.penaltyAfter === null
                              ? '—'
                              : `${num(e.penaltyBefore ?? 0)} → ${num(e.penaltyAfter ?? 0)}`}
                          </td>
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
}

customElements.define('dd-page-pose', DdPagePose);
