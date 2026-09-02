import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type {
  HealthTimeline,
  MasternodeTimelinePoint,
  QuorumRoundListItem,
} from '@devnet-deftrack/shared';
import { api, type ChainLockReport, type ExperimentRow, type HealthSnapshot } from '../lib/api.js';
import { ago, num, ratio, shortHash } from '../lib/format.js';
import { classifyNetwork, type NetworkStatus } from '../lib/networkState.js';
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
    _health: { state: true },
    _clocks: { state: true },
    _running: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  private _timeline: HealthTimeline | null = null;
  private _rounds: QuorumRoundListItem[] = [];
  private _total = 0;
  private _mn: MasternodeTimelinePoint | null = null;
  private _health: HealthSnapshot | null = null;
  private _clocks: ChainLockReport | null = null;
  private _running: ExperimentRow[] = [];
  private _error = '';
  private _loading = true;
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    pageStyles,
    css`
      .q60 {
        display: flex;
        align-items: baseline;
        gap: 10px;
        flex-wrap: wrap;
        margin: 0 0 14px;
        padding: 10px 14px;
        border: 1px solid var(--line-soft);
        border-left: 3px solid var(--warn);
        border-radius: 6px;
        font-size: 13px;
      }
      .q60.live {
        border-left-color: var(--accent);
      }
      .q60 .tag,
      .run .tag {
        font-family: var(--font-mono);
        font-size: 10.5px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-3);
      }
      .q60 .mono,
      .run .mono {
        font-family: var(--font-mono);
      }

      /* A run that is open right now is an intervention in progress: every
         figure below is being measured under it, so it is announced beside
         the Q60 line, and the gear turns for as long as the run is open. */
      .run {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin: 0 0 14px;
        padding: 10px 14px;
        border: 1px solid var(--line-soft);
        border-left: 3px solid var(--warn);
        border-radius: 6px;
        font-size: 13px;
      }
      .run .gear {
        width: 14px;
        height: 14px;
        flex: none;
        color: var(--warn);
        animation: spin 2.4s linear infinite;
      }
      /* The title always starts a line of its own under the tag, and the
         particulars sit under the title in the secondary colour. */
      .run .body {
        flex: 1 1 100%;
        min-width: 0;
      }
      .run .since {
        display: block;
        margin-top: 3px;
        color: var(--ink-2);
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .run .gear {
          animation: none;
        }
      }
      .more {
        padding: 10px 14px;
        border-top: 1px solid var(--line-soft);
        font-family: var(--font-mono);
        font-size: 11.5px;
      }

      /* State bar. One colour per situation, so "cannot form yet" never looks
         like "failed unexpectedly". */
      .state {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-left-width: 3px;
        background: var(--surface);
      }
      .state.bootstrap {
        border-left-color: var(--ink-3);
      }
      .state.healthy {
        border-left-color: var(--good);
      }
      .state.investigate {
        border-left-color: var(--crit);
        background: var(--surface-2);
      }
      .state-chip {
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        padding: 4px 9px;
        border: 1px solid currentColor;
        white-space: nowrap;
      }
      .state.bootstrap .state-chip {
        color: var(--ink-2);
      }
      .state.healthy .state-chip {
        color: var(--good);
      }
      .state.investigate .state-chip {
        color: var(--crit);
      }
      .state-body {
        flex: 1;
        min-width: 0;
      }
      .state-headline {
        font-size: 14px;
        font-weight: 600;
        line-height: 1.4;
      }
      .state-detail {
        color: var(--ink-2);
        font-size: 12.5px;
        margin-top: 3px;
        line-height: 1.5;
      }

      /* Bootstrap progress: how far off a quorum still is, as a quantity
         rather than as a red percentage. */
      .bar {
        margin-top: 9px;
        height: 6px;
        background: var(--surface-3);
        border: 1px solid var(--line);
        overflow: hidden;
      }
      .bar > i {
        display: block;
        height: 100%;
        background: var(--accent-dim);
      }

      /* Compact round timeline, shown while a health-ratio chart would be an
         empty grid with nothing plotted on it. */
      .timeline {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 14px;
        font-family: var(--font-mono);
        font-size: 12px;
      }
      .timeline .step {
        display: inline-flex;
        align-items: baseline;
        gap: 6px;
        padding: 4px 8px;
        border: 1px solid var(--line-strong);
        background: var(--surface-2);
      }
      .timeline .step b {
        font-variant-numeric: tabular-nums;
      }
      .timeline .step .failed {
        color: var(--crit);
      }
      .timeline .step .pending {
        color: var(--ink-3);
      }
      .timeline .step .formed {
        color: var(--good);
      }
      .timeline .arrow {
        color: var(--ink-3);
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
      const [timeline, rounds, mn, health, clocks, running] = await Promise.all([
        api.healthTimeline(24 * 7),
        api.rounds({ limit: RECENT }),
        api.masternodeTimeline(1).catch(() => ({ hours: 1, points: [] })),
        api.health().catch(() => null),
        // Only for the switchover banner; a failure hides the banner rather
        // than the page.
        api.chainlocks(50).catch(() => null),
        // Only for the running-experiment line; a failure hides the line.
        api.experiments({ status: 'running', limit: 5 }).catch(() => null),
      ]);
      this._timeline = timeline;
      this._rounds = rounds.items;
      this._total = rounds.total;
      this._mn = mn.points.at(-1) ?? null;
      this._health = health;
      this._clocks = clocks;
      this._running = running?.items ?? [];
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    } finally {
      this._loading = false;
    }
  }

  private _status(): NetworkStatus {
    const s = this._timeline?.summary;
    return classifyNetwork({
      enabledMasternodes: this._mn?.enabled ?? this._health?.masternodes.enabled ?? null,
      minSize: this._rounds[0]?.minSize ?? null,
      rounds: this._rounds,
      formedRounds: s?.formed ?? 0,
      failedRounds: s?.failed ?? 0,
    });
  }

  override render(): TemplateResult {
    const s = this._timeline?.summary;
    const status = this._status();
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
      ${s ? this._stateBar(status) : nothing} ${this._q60Banner()} ${this._experimentBanner()}
      ${s ? this._tiles(s, status) : nothing}
      ${this._rounds.length > 0 ? this._chartOrTimeline() : nothing} ${this._recent(status)}
    `;
  }

  /**
   * The Q60 switchover, tracked live: the whole project was built to select
   * and then measure this profile, so the moment the ChainLock signer flips
   * from llmq_400_60 to llmq_defcon belongs on the front page. One-way by
   * consensus, so the banner only ever moves forward through its three states.
   */
  private _q60Banner(): TemplateResult | typeof nothing {
    const s = this._clocks?.signers;
    if (!s) return nothing;
    const tip = this._health?.chainTip ?? this._clocks?.points.at(-1)?.height ?? 0;

    if (s.firstV2LockedHeight !== null) {
      return html`<section class="q60 live">
        <span class="tag">Q60 live</span>
        <span
          ><span class="mono">${s.v2}</span> signs the chain since block
          <a class="mono" href="/block/${s.firstV2LockedHeight}">${num(s.firstV2LockedHeight)}</a> —
          ${num(this._clocks?.signers.counts.v2 ?? 0)} lock(s) observed in the current window.</span
        >
      </section>`;
    }
    if (tip >= s.activationHeight) {
      return html`<section class="q60">
        <span class="tag">Q60 activation</span>
        <span
          >Activation height <span class="mono">${num(s.activationHeight)}</span> passed at tip
          <span class="mono">${num(tip)}</span> — waiting for the first
          <span class="mono">${s.v2}</span>-signed ChainLock.</span
        >
      </section>`;
    }
    const blocksLeft = s.activationHeight - tip;
    return html`<section class="q60">
      <span class="tag">Q60 switchover</span>
      <span
        ><span class="mono">${s.v1}</span> signs until block
        <span class="mono">${num(s.activationHeight)}</span>; <span class="mono">${s.v2}</span> takes
        over in ${num(blocksLeft)} block(s) (~${num(Math.round(blocksLeft * 2.5))} min at devnet
        spacing).</span
      >
    </section>`;
  }

  /**
   * The run that is open right now, if any. Every number on this page is
   * being measured under that intervention, so the fact belongs at the top,
   * beside the Q60 line, and not only on the Experiments page. A closed run
   * has nothing to announce here.
   */
  private _experimentBanner(): TemplateResult | typeof nothing {
    if (this._running.length === 0) return nothing;
    return html`${this._running.map(
      (r) => html`<section class="run">
        <svg
          class="gear"
          viewBox="0 0 24 24"
          role="img"
          aria-label="running"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
          />
        </svg>
        <span class="tag">Experiment running</span>
        <span class="body">
          <a href="/experiments/${r.runKey}">${r.title}</a>
          <span class="since">
            since block <span class="mono">${num(r.startHeight)}</span>${r.intervention
              ? html`, ${r.intervention.kind}, ${num(r.intervention.targets.length)} target(s)`
              : nothing}, started ${ago(r.startedAt)}.
          </span>
        </span>
      </section>`
    )}`;
  }

  private _stateBar(status: NetworkStatus): TemplateResult {
    return html`
      <section class="state ${status.state}">
        <span class="state-chip">${status.label}</span>
        <div class="state-body">
          <div class="state-headline">${status.headline}</div>
          <div class="state-detail">${status.detail}</div>
          ${status.state === 'bootstrap' && status.minSize > 0
            ? html`<div class="bar"><i style="width:${(status.progress * 100).toFixed(1)}%"></i></div>`
            : nothing}
        </div>
      </section>
    `;
  }

  /**
   * The four figures worth reading right now.
   *
   * During bootstrap, formation rate and median health have no content -- 0.0%
   * and a dash say nothing except that nothing has happened yet -- so the tiles
   * answer the questions that do have answers: how far off a quorum is, when
   * the next round is due, and whether the chain is still moving at all.
   */
  private _tiles(s: NonNullable<HealthTimeline['summary']>, status: NetworkStatus): TemplateResult {
    const mn = this._mn;
    const stakers = this._health?.stakers.active ?? null;

    if (status.state === 'bootstrap') {
      return html`
        <section class="tiles">
          <dd-stat
            label="Quorum capacity"
            value="${num(status.enabledMasternodes)} / ${num(status.minSize)}"
            sub="enabled masternodes vs profile minimum"
            tone=${status.enabledMasternodes >= status.minSize ? 'good' : ''}
          ></dd-stat>
          <dd-stat
            label="Next DKG"
            value=${status.nextRoundHeight === null ? '—' : `H ${num(status.nextRoundHeight)}`}
            sub=${status.nextRoundHeight === null ? 'none scheduled in window' : 'scheduled height'}
          ></dd-stat>
          <dd-stat
            label="Enabled masternodes"
            value=${mn ? num(mn.enabled) : num(this._health?.masternodes.enabled ?? 0)}
            sub=${mn ? `${num(mn.banned)} banned · ${num(mn.penalised)} penalised` : 'none registered'}
          ></dd-stat>
          <dd-stat
            label="Chain is staking"
            value=${stakers === null ? '—' : stakers > 0 ? 'yes' : 'no'}
            sub=${stakers === null ? 'no sample' : `${num(stakers)} staker(s) producing blocks`}
            tone=${stakers === null ? '' : stakers > 0 ? 'good' : 'crit'}
          ></dd-stat>
        </section>
      `;
    }

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
   * A health-ratio chart needs health ratios. Until at least one round has
   * formed there is nothing to plot, and a full-height empty grid reads as a
   * broken chart rather than as an absence of data.
   */
  private _chartOrTimeline(): TemplateResult {
    const points = this._timeline?.points ?? [];
    const hasSeries = points.some((p) => p.healthRatio !== null);

    if (!hasSeries) {
      // Oldest first: the eye should read the sequence in the direction time runs.
      const steps = [...this._rounds].reverse();
      return html`
        <section class="card">
          <div class="card-head"><div class="card-title">DKG rounds so far</div></div>
          <div class="card-body flush">
            <div class="timeline">
              ${steps.map(
                (r, i) => html`
                  ${i > 0 ? html`<span class="arrow">→</span>` : nothing}
                  <span class="step"><b>${num(r.expectedHeight)}</b
                    ><span class=${r.status}>${r.status}</span></span
                  >
                `
              )}
            </div>
          </div>
        </section>
      `;
    }

    return html`
      <section class="card">
        <div class="card-head"><div class="card-title">Health ratio per round</div></div>
        <div class="card-body flush">
          <dd-health-chart
            .points=${points}
            .minSize=${this._rounds[0]?.minSize ?? null}
          ></dd-health-chart>
        </div>
      </section>
    `;
  }

  /**
   * What the round proves, not who is to blame.
   *
   * With no commitment mined there is no member list, so naming anyone would be
   * an accusation the data cannot support -- during bootstrap the honest answer
   * is that a quorum was arithmetically impossible.
   */
  private _evidence(r: QuorumRoundListItem, status: NetworkStatus): string {
    if (r.failuresByOperator.length > 0) {
      return r.failuresByOperator
        .map((f) => `${f.operatorLabel ?? 'unattributed'} (${f.count})`)
        .join(', ');
    }
    if (r.status === 'formed') return 'all members valid';
    if (r.status === 'pending') return 'still inside its mining window';
    return status.state === 'bootstrap' && status.minSize > 0
      ? `no quorum possible: ${status.enabledMasternodes}/${status.minSize} MN`
      : 'no commitment mined';
  }

  private _recent(status: NetworkStatus): TemplateResult {
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
                  <th>Evidence</th>
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
                          <td>${this._evidence(r, status)}</td>
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
