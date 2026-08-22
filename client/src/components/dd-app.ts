import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { DEVNET_BANNER } from '@devnet-deftrack/shared';
import type { HealthTimeline, OperatorReliabilityRow, QuorumRoundListItem } from '@devnet-deftrack/shared';
import { api, type HealthSnapshot } from '../lib/api.js';
import { ago, duration, num, ratio, shortHash } from '../lib/format.js';
import { baseStyles, cardStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';
import './dd-health-chart.js';

const REFRESH_MS = 30_000;

export class DdApp extends LitElement {
  static override properties = {
    _health: { state: true },
    _rounds: { state: true },
    _total: { state: true },
    _timeline: { state: true },
    _operators: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  private _health: HealthSnapshot | null = null;
  private _rounds: QuorumRoundListItem[] = [];
  private _total = 0;
  private _timeline: HealthTimeline | null = null;
  private _operators: OperatorReliabilityRow[] = [];
  private _error = '';
  private _loading = true;
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    pageStyles,
    css`
      :host {
        display: block;
        max-width: var(--max-w);
        margin: 0 auto;
        padding: 18px 20px 48px;
      }
      .banner {
        border: 1px solid var(--accent);
        color: var(--accent);
        background: var(--accent-wash);
        padding: 7px 12px;
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin-bottom: 18px;
      }
      header.site {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 18px;
      }
      .brand {
        font-family: var(--font-mono);
        font-size: 20px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      .brand .dim {
        color: var(--ink-3);
        font-weight: 400;
      }
      .chainline {
        font-family: var(--font-mono);
        font-size: 11.5px;
        color: var(--ink-3);
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
      }
      .dot {
        display: inline-block;
        width: 7px;
        height: 7px;
        background: var(--good);
        margin-right: 6px;
      }
      .dot.bad {
        background: var(--crit);
      }
      section {
        margin-bottom: 18px;
      }
      .tiles {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
      }
      .mono {
        font-family: var(--font-mono);
      }
      .pill {
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 2px 7px;
        border: 1px solid;
      }
      .pill.formed {
        color: var(--good);
        border-color: var(--good);
        background: var(--good-wash);
      }
      .pill.failed {
        color: var(--crit);
        border-color: var(--crit);
        background: var(--crit-wash);
      }
      .pill.pending {
        color: var(--ink-3);
        border-color: var(--line-strong);
      }
      .note {
        border-left: 2px solid var(--accent);
        background: var(--surface-2);
        padding: 10px 14px;
        font-size: 13px;
        color: var(--ink-2);
        line-height: 1.6;
      }
      .note strong {
        color: var(--ink);
      }
      .err {
        border: 1px solid var(--crit);
        background: var(--crit-wash);
        color: var(--crit);
        padding: 10px 14px;
        font-family: var(--font-mono);
        font-size: 12.5px;
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
    this._timer = window.setInterval(() => void this._load(), REFRESH_MS);
  }

  override disconnectedCallback(): void {
    if (this._timer !== null) window.clearInterval(this._timer);
    super.disconnectedCallback();
  }

  private async _load(): Promise<void> {
    try {
      const [health, rounds, timeline, operators] = await Promise.all([
        api.health(),
        api.rounds({ limit: 25 }),
        api.healthTimeline(24 * 7),
        api.operatorReliability(24 * 7),
      ]);
      this._health = health;
      this._rounds = rounds.items;
      this._total = rounds.total;
      this._timeline = timeline;
      this._operators = operators.operators;
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    } finally {
      this._loading = false;
    }
  }

  override render(): TemplateResult {
    const h = this._health;
    const s = this._timeline?.summary;

    return html`
      <div class="banner">${DEVNET_BANNER}</div>

      <header class="site">
        <div>
          <div class="brand">devnet<span class="dim">.deftrack</span></div>
          <div class="page-sub">LLMQ quorum formation and PoSe behaviour on a DeFCoN devnet</div>
        </div>
        ${h
          ? html`
              <div class="chainline">
                <span><span class="dot ${h.behind > 5 ? 'bad' : ''}"></span>${h.devnet}</span>
                <span>tip ${num(h.chainTip)}</span>
                <span>indexed ${num(h.indexedHeight)}${h.behind > 0 ? ` (−${h.behind})` : ''}</span>
                <span>up ${duration(h.uptimeSeconds)}</span>
              </div>
            `
          : nothing}
      </header>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
      ${this._loading && !h ? html`<div class="note">Loading…</div>` : nothing}

      ${s ? this._tiles(s) : nothing}
      ${this._noQuorumNote()}
      ${this._chart()}
      ${this._roundsTable()}
      ${this._operatorTable()}
    `;
  }

  private _tiles(s: NonNullable<HealthTimeline['summary']>): TemplateResult {
    return html`
      <section class="tiles">
        <dd-stat
          label="Rounds (7d)"
          value=${num(s.rounds)}
          sub="${num(s.formed)} formed · ${num(s.failed)} failed · ${num(s.pending)} pending"
        ></dd-stat>
        <dd-stat
          label="Formation rate"
          value=${s.formationRate === null ? '—' : ratio(s.formationRate)}
          sub="pending rounds excluded"
          tone=${s.formationRate === null ? '' : s.formationRate >= 0.95 ? 'good' : s.formationRate >= 0.5 ? 'warn' : 'crit'}
        ></dd-stat>
        <dd-stat
          label="Median health"
          value=${ratio(s.medianHealthRatio)}
          sub=${s.worstHealthRatio === null ? 'no formed round yet' : `worst ${ratio(s.worstHealthRatio)}`}
        ></dd-stat>
        <dd-stat
          label="Longest failure streak"
          value=${num(s.longestFailureStreak)}
          sub="consecutive rounds"
          tone=${s.longestFailureStreak > 0 ? 'crit' : 'good'}
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
    const size = this._rounds[0]?.effectiveSize ?? 0;
    if (size > 0) return nothing;

    return html`
      <section>
        <div class="note">
          <strong>No masternodes are registered yet</strong>, so no quorum can form and every scheduled
          round is recorded as <em>did not form</em>. That is the expected state, not a fault: a failed
          DKG mines no commitment, so <strong>nobody is PoSe-punished</strong> — every row below shows
          <span class="mono">punished = 0</span>. These rows exist because the schedule is reconstructed
          from the chain, not read from a commitment that was never mined.
        </div>
      </section>
    `;
  }

  private _chart(): TemplateResult {
    const points = this._timeline?.points ?? [];
    const minSize = this._rounds[0]?.minSize ?? null;
    return html`
      <section class="card">
        <div class="card-head"><div class="card-title">Health ratio per round</div></div>
        <div class="card-body flush">
          <dd-health-chart .points=${points} .minSize=${minSize}></dd-health-chart>
        </div>
      </section>
    `;
  }

  private _roundsTable(): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">DKG rounds</div>
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
                  <th class="r">Max possible ban</th>
                  <th>Who failed</th>
                  <th>Quorum hash</th>
                  <th class="r">Seen</th>
                </tr>
              </thead>
              <tbody>
                ${this._rounds.length === 0
                  ? html`<tr><td class="empty" colspan="10">No rounds recorded yet.</td></tr>`
                  : this._rounds.map((r) => this._roundRow(r))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  private _roundRow(r: QuorumRoundListItem): TemplateResult {
    const who =
      r.failuresByOperator.length === 0
        ? r.status === 'failed'
          ? 'no commitment mined'
          : '—'
        : r.failuresByOperator.map((f) => `${f.operatorLabel ?? 'unattributed'} (${f.count})`).join(', ');

    return html`
      <tr>
        <td class="mono">${r.roundKey}</td>
        <td class="r mono">${num(r.expectedHeight)}</td>
        <td class="c"><span class="pill ${r.status}">${r.status}</span></td>
        <td class="r mono">
          ${r.numValidMembers === null ? '—' : `${num(r.numValidMembers)}/${num(r.effectiveSize)}`}
        </td>
        <td class="r mono">${ratio(r.healthRatio)}</td>
        <td class="r mono">${num(r.punishedCount)}</td>
        <td class="r mono">${num(r.maxPossibleBan)}</td>
        <td>${who}</td>
        <td class="mono">${shortHash(r.quorumHash)}</td>
        <td class="r mono">${ago(r.detectedAt)}</td>
      </tr>
    `;
  }

  private _operatorTable(): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Operator reliability</div>
          <div class="page-sub mono">7 days · formed rounds only</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr>
                  <th>Operator</th>
                  <th>Provider</th>
                  <th>Country</th>
                  <th class="r">Masternodes</th>
                  <th class="r">Rounds</th>
                  <th class="r">Member slots</th>
                  <th class="r">Invalid</th>
                  <th class="r">Failure rate</th>
                </tr>
              </thead>
              <tbody>
                ${this._operators.length === 0
                  ? html`<tr>
                      <td class="empty" colspan="8">
                        No operators onboarded yet. Attribution needs the proTxHash → operator mapping;
                        without it the data cannot separate a protocol problem from one operator's VPS.
                      </td>
                    </tr>`
                  : this._operators.map(
                      (o) => html`
                        <tr>
                          <td class="mono">${o.operatorLabel}</td>
                          <td>${o.vpsProvider ?? '—'}</td>
                          <td>${o.country ?? '—'}</td>
                          <td class="r mono">${num(o.masternodeCount)}</td>
                          <td class="r mono">${num(o.roundsSelected)}</td>
                          <td class="r mono">${num(o.memberSlots)}</td>
                          <td class="r mono">${num(o.invalidSlots)}</td>
                          <td class="r mono">${ratio(o.failureRate)}</td>
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

customElements.define('dd-app', DdApp);
