import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type {
  HealthTimeline,
  MasternodeTimelinePoint,
  QuorumRoundListItem,
} from '@devnet-deftrack/shared';
import { api } from '../lib/api.js';
import { ago, num, ratio, shortHash } from '../lib/format.js';
import { baseStyles, cardStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';
import './dd-health-chart.js';

const REFRESH_MS = 30_000;
const RECENT = 10;

export class DdPageOverview extends LitElement {
  static override properties = {
    _timeline: { state: true },
    _rounds: { state: true },
    _total: { state: true },
    _mn: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  private _timeline: HealthTimeline | null = null;
  private _rounds: QuorumRoundListItem[] = [];
  private _total = 0;
  private _mn: MasternodeTimelinePoint | null = null;
  private _error = '';
  private _loading = true;
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    pageStyles,
    css`
      .more {
        padding: 10px 14px;
        border-top: 1px solid var(--line-soft);
        font-family: var(--font-mono);
        font-size: 11.5px;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
    this._timer = window.setInterval(() => void this._load(), REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._timer !== null) clearInterval(this._timer);
  }

  private async _load(): Promise<void> {
    try {
      const [timeline, rounds, mn] = await Promise.all([
        api.healthTimeline(24 * 7),
        api.rounds({ limit: RECENT }),
        api.masternodeTimeline(1).catch(() => ({ hours: 1, points: [] })),
      ]);
      this._timeline = timeline;
      this._rounds = rounds.items;
      this._total = rounds.total;
      this._mn = mn.points.at(-1) ?? null;
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    } finally {
      this._loading = false;
    }
  }

  override render(): TemplateResult {
    const s = this._timeline?.summary;
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Overview</div>
          <div class="page-sub">
            Did the last rounds form, was anybody punished, and who failed — the three questions this
            devnet exists to answer.
          </div>
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
      ${this._loading && !s ? html`<div class="note">Loading…</div>` : nothing}
      ${s ? this._tiles(s) : nothing} ${this._noQuorumNote()} ${this._chart()} ${this._recent()}
    `;
  }

  private _tiles(s: NonNullable<HealthTimeline['summary']>): TemplateResult {
    const mn = this._mn;
    return html`
      <section class="tiles">
        <dd-stat
          label="Formation rate (7d)"
          value=${s.formationRate === null ? '—' : ratio(s.formationRate)}
          sub="${num(s.formed)} formed · ${num(s.failed)} failed · pending excluded"
          tone=${s.formationRate === null
            ? ''
            : s.formationRate >= 0.95
              ? 'good'
              : s.formationRate >= 0.5
                ? 'warn'
                : 'crit'}
        ></dd-stat>
        <dd-stat
          label="Median health"
          value=${ratio(s.medianHealthRatio)}
          sub=${s.worstHealthRatio === null ? 'no formed round yet' : `worst ${ratio(s.worstHealthRatio)}`}
        ></dd-stat>
        <dd-stat
          label="Masternodes"
          value=${mn ? num(mn.enabled) : '—'}
          sub=${mn ? `${num(mn.banned)} banned · ${num(mn.penalised)} penalised` : 'no sample yet'}
          tone=${mn ? (mn.banned === 0 ? 'good' : 'crit') : ''}
        ></dd-stat>
        <dd-stat
          label="Max possible ban"
          value=${mn ? num(mn.maxPossibleBan) : '—'}
          sub="what one round could punish"
        ></dd-stat>
      </section>
    `;
  }

  /**
   * With no masternodes registered, every round legitimately fails. Say so,
   * rather than letting a wall of red read as a broken site.
   */
  private _noQuorumNote(): TemplateResult | typeof nothing {
    const s = this._timeline?.summary;
    if (!s || s.formed > 0) return nothing;
    if ((this._rounds[0]?.effectiveSize ?? 0) > 0) return nothing;

    return html`
      <section>
        <div class="note">
          <strong>No masternodes are registered yet</strong>, so no quorum can form and every
          scheduled round is recorded as <em>did not form</em>. That is the expected state, not a
          fault: a failed DKG mines no commitment, so <strong>nobody is PoSe-punished</strong> —
          every row shows <span class="mono">punished = 0</span>.
        </div>
      </section>
    `;
  }

  private _chart(): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head"><div class="card-title">Health ratio per round</div></div>
        <div class="card-body flush">
          <dd-health-chart
            .points=${this._timeline?.points ?? []}
            .minSize=${this._rounds[0]?.minSize ?? null}
          ></dd-health-chart>
        </div>
      </section>
    `;
  }

  private _recent(): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Latest DKG rounds</div>
          <div class="page-sub mono">${num(this._total)} recorded</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr>
                  <th>Round</th>
                  <th class="r">Height</th>
                  <th class="c">Formed</th>
                  <th class="r">Valid members</th>
                  <th class="r">Health</th>
                  <th class="r">Punished</th>
                  <th>Who failed</th>
                  <th>Quorum hash</th>
                  <th class="r">Seen</th>
                </tr>
              </thead>
              <tbody>
                ${this._rounds.length === 0
                  ? html`<tr><td class="empty" colspan="9">No rounds recorded yet.</td></tr>`
                  : this._rounds.map(
                      (r) => html`
                        <tr>
                          <td class="mono">${r.roundKey}</td>
                          <td class="r mono">${num(r.expectedHeight)}</td>
                          <td class="c"><span class="pill ${r.status}">${r.status}</span></td>
                          <td class="r mono">
                            ${r.numValidMembers === null
                              ? '—'
                              : `${num(r.numValidMembers)}/${num(r.effectiveSize)}`}
                          </td>
                          <td class="r mono">${ratio(r.healthRatio)}</td>
                          <td class="r mono">${num(r.punishedCount)}</td>
                          <td>
                            ${r.failuresByOperator.length === 0
                              ? r.status === 'failed'
                                ? 'no commitment mined'
                                : '—'
                              : r.failuresByOperator
                                  .map((f) => `${f.operatorLabel ?? 'unattributed'} (${f.count})`)
                                  .join(', ')}
                          </td>
                          <td class="mono">${shortHash(r.quorumHash)}</td>
                          <td class="r mono">${ago(r.detectedAt)}</td>
                        </tr>
                      `
                    )}
              </tbody>
            </table>
          </div>
          <div class="more"><a href="/rounds">All rounds →</a></div>
        </div>
      </section>
    `;
  }
}

customElements.define('dd-page-overview', DdPageOverview);
