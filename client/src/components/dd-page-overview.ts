import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type {
  HealthTimeline,
  MasternodeTimelinePoint,
  QuorumRoundListItem,
} from '@devnet-deftrack/shared';
import { api, type ChainLockReport, type ExperimentRow, type HealthSnapshot } from '../lib/api.js';
import { ago, num, ratio, shortHash } from '../lib/format.js';
import { classifyNetwork, type NetworkStatus } from '../lib/networkState.js';
import { primaryProfile, type PrimaryProfile } from '../lib/primaryProfile.js';
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
    _profile: { state: true },
    _running: { state: true },
    _error: { state: true },
    _loading: { state: true },
    _copied: { state: true },
  };

  private _timeline: HealthTimeline | null = null;
  private _rounds: QuorumRoundListItem[] = [];
  private _total = 0;
  private _mn: MasternodeTimelinePoint | null = null;
  private _health: HealthSnapshot | null = null;
  private _clocks: ChainLockReport | null = null;
  /** Which profile every figure on this page is about, or why that is unknown. */
  private _profile: PrimaryProfile = { known: false, reason: 'no-signers' };
  private _running: ExperimentRow[] = [];
  private _error = '';
  private _loading = true;
  private _copied: string | null = null;
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    pageStyles,
    css`
      .page > .page-head {
        margin-bottom: 0;
      }
      .refresh {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        color: var(--ink-3);
        letter-spacing: 0.06em;
      }

      /* The operational summary: one alert, then the strips that qualify it.
         Stacked tight, because together they are one reading; the tiles below
         are a different one. */
      .summary {
        display: grid;
        gap: var(--sp-2);
      }

      /* The alert. Severity on the edge and in the chip's word, the finding as
         a title, what it means as a sentence, the numbers it rests on as facts. */
      .alert {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--sp-2) var(--sp-4);
        align-items: start;
        padding: var(--sp-4) var(--sp-5);
        border: 1px solid var(--line);
        border-left: 4px solid var(--ink-3);
        border-radius: var(--radius-md);
        background: var(--surface);
        box-shadow: var(--shadow);
      }
      .alert.healthy {
        border-left-color: var(--good);
      }
      .alert.investigate {
        border-left-color: var(--crit);
        background: color-mix(in srgb, var(--crit) 6%, var(--surface));
      }
      .alert-chip {
        margin-top: 3px;
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        padding: 5px 10px;
        border: 1px solid currentColor;
        border-radius: var(--radius);
        white-space: nowrap;
        line-height: 1;
        color: var(--ink-2);
      }
      .alert.healthy .alert-chip {
        color: var(--good);
      }
      .alert.investigate .alert-chip {
        color: var(--crit);
      }
      .alert-body {
        min-width: 0;
      }
      .alert-title {
        font-size: var(--fs-lg);
        font-weight: 600;
        line-height: 1.3;
      }
      .alert-detail {
        color: var(--ink-2);
        font-size: var(--fs-sm);
        line-height: 1.5;
        margin-top: var(--sp-1);
      }
      .alert-meta {
        display: flex;
        gap: var(--sp-4);
        flex-wrap: wrap;
        margin-top: var(--sp-3);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        color: var(--ink-3);
        letter-spacing: 0.03em;
      }
      .alert-meta b {
        color: var(--ink-2);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }

      /* Bootstrap progress: how far off a quorum still is, as a quantity
         rather than as a red percentage. */
      .bar {
        margin-top: var(--sp-3);
        height: 6px;
        background: var(--surface-3);
        border: 1px solid var(--line);
        overflow: hidden;
      }
      .bar > i {
        display: block;
        height: 100%;
        background: var(--accent-dim);
        transition: width var(--t-slow) var(--ease);
      }

      /* Strips: the Q60 line and a running experiment share one shape. */
      .strip {
        display: flex;
        align-items: center;
        gap: var(--sp-3) var(--sp-4);
        flex-wrap: wrap;
        padding: var(--sp-3) var(--sp-5);
        border: 1px solid var(--line);
        border-left: 4px solid var(--warn);
        border-radius: var(--radius-md);
        background: var(--surface);
        font-size: var(--fs-sm);
      }
      .strip .tag {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-2);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-3);
        white-space: nowrap;
      }
      .strip .mono {
        font-family: var(--font-mono);
      }
      /* The healthy state, said loudly: the profile this project was built to
         test is signing, and the line breathes to say it is still doing so. */
      .strip.live {
        border-left-color: var(--accent);
        background: color-mix(in srgb, var(--accent) 5%, var(--surface));
      }
      .strip.live .tag {
        color: var(--accent);
      }
      .strip.live .line {
        font-size: var(--fs-base);
      }
      /* A run that is open right now is an intervention in progress: every
         figure below is being measured under it, so it reads as a live task,
         with the gear turning for as long as the run is open. */
      .strip.task {
        align-items: flex-start;
      }
      .strip.task .tag {
        color: var(--warn);
        padding-top: 3px;
      }
      .strip.task .gear {
        width: 15px;
        height: 15px;
        flex: none;
        animation: spin 2.4s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      .task-body {
        flex: 1 1 320px;
        min-width: 0;
        display: grid;
        gap: var(--sp-2);
      }
      .task-title {
        font-size: var(--fs-base);
        font-weight: 600;
        line-height: 1.35;
      }
      .chips {
        display: flex;
        gap: var(--sp-2);
        flex-wrap: wrap;
      }
      .chip {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        padding: 3px 8px;
        border: 1px solid var(--line-strong);
        border-radius: var(--radius);
        color: var(--ink-2);
        background: var(--bg-raised);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      .more {
        padding: var(--sp-3) var(--sp-4);
        border-top: 1px solid var(--line-soft);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        letter-spacing: 0.04em;
      }

      /* Table emphasis: the two numbers a reader is here for. */
      td.health {
        font-weight: 700;
        color: var(--ink);
      }
      td.health.low {
        color: var(--warn);
      }
      td.health.bad {
        color: var(--crit);
      }
      td.punished.some {
        color: var(--crit);
        font-weight: 700;
      }
      td.evidence {
        color: var(--ink-2);
        white-space: normal;
        min-width: 220px;
      }
      .hashcell {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
      }
      .copy {
        font: inherit;
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        background: none;
        color: var(--ink-3);
        border: 1px solid transparent;
        border-radius: var(--radius);
        padding: 2px 6px;
        cursor: pointer;
        transition: color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
      }
      .copy:hover {
        color: var(--accent);
        border-color: var(--line-strong);
      }
      .copy.done {
        color: var(--accent);
      }

      /* Compact round timeline, shown while a health-ratio chart would be an
         empty grid with nothing plotted on it. */
      .timeline {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        flex-wrap: wrap;
        padding: var(--sp-4);
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
      }
      .timeline .step {
        display: inline-flex;
        align-items: baseline;
        gap: 6px;
        padding: 5px 9px;
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

      /* Loading: the shapes of what is coming, so nothing jumps when it does. */
      .sk-alert {
        height: 92px;
      }
      .sk-strip {
        height: 46px;
      }
      .sk-tile {
        height: 118px;
      }
      .sk-chart {
        height: 380px;
      }
      .err {
        padding: var(--sp-3) var(--sp-4);
        border: 1px solid color-mix(in srgb, var(--crit) 45%, transparent);
        background: var(--crit-wash);
        color: var(--crit);
        border-radius: var(--radius-md);
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
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
      // Two phases on purpose. Which profile the figures are about has to be
      // settled BEFORE they are asked for: without a profile the server does
      // not filter, and the formation rate, the medians and the failure streak
      // come back computed across every interleaved schedule this devnet runs
      // -- llmq_50_60 every 24 blocks, llmq_60_75 every 48, llmq_400_60 every
      // 72, llmq_400_85 every 576 which can never form here, and llmq_defcon.
      // Blending them invents streaks no type ever had.
      const [clocks, health] = await Promise.all([
        // Both feed the profile decision, so neither failing may be swallowed
        // into a blended answer; `primaryProfile` reports what it could not do.
        api.chainlocks(50).catch(() => null),
        api.health().catch(() => null),
      ]);
      const profile = primaryProfile({
        signers: clocks?.signers,
        tipHeight: health?.chainTip,
      });
      this._profile = profile;

      const llmqName = profile.known ? profile.llmqName : undefined;
      const [timeline, rounds, mn, running] = await Promise.all([
        api.healthTimeline(24 * 7, llmqName),
        api.rounds({ limit: RECENT, llmqName }),
        api.masternodeTimeline(1).catch(() => ({ hours: 1, points: [] })),
        // Only for the running-experiment line; a failure hides the line.
        api.experiments({ status: 'running', limit: 5 }).catch(() => null),
      ]);
      this._timeline = profile.known ? timeline : null;
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

  /**
   * Which profile these figures describe, said out loud.
   *
   * Every number on this page -- formation rate, medians, the failure streak --
   * is about one LLMQ schedule. It used to be about all of them at once, which
   * is the one reading this project's notes forbid: blending interleaved
   * schedules invents streaks no type ever had. Saying which one is part of the
   * fix, not decoration.
   */
  private _profileNote(): TemplateResult {
    if (!this._profile.known) {
      return html`<div class="note" role="status">
        The signing profile could not be determined
        ${this._profile.reason === 'no-signers' ? '(no ChainLock report)' : '(no chain tip)'}, so no
        round figures are shown. A number covering every schedule at once would look like an answer
        without being one.
      </div>`;
    }
    return html`<div class="page-sub">
      Round figures below are for
      <b class="mono">${this._profile.llmqName}</b> only — the profile signing ChainLocks at the tip.
    </div>`;
  }

  override render(): TemplateResult {
    const s = this._timeline?.summary;
    const status = this._status();
    return html`
      <div class="page">
        <div class="page-head">
          <div>
            <div class="page-title">Overview</div>
            <div class="page-sub">
              Did the last rounds form, was anybody punished, and who failed — the three questions this
              devnet exists to answer.
            </div>
            ${this._profileNote()}
          </div>
          <span class="refresh"><span class="live-dot" aria-hidden="true"></span>live · refreshes every 30 s</span>
        </div>

        ${this._error ? html`<div class="err" role="alert">${this._error}</div>` : nothing}
        ${this._loading && !s ? this._skeleton() : nothing}
        ${s || this._clocks || this._running.length > 0
          ? html`<div class="summary">
              ${s ? this._alert(status) : nothing} ${this._q60Banner()} ${this._experimentBanner()}
            </div>`
          : nothing}
        ${s ? this._tiles(s, status) : nothing}
        ${this._rounds.length > 0 ? this._chartOrTimeline() : nothing}
        ${this._loading && this._rounds.length === 0 ? nothing : this._recent(status)}
      </div>
    `;
  }

  private _skeleton(): TemplateResult {
    return html`
      <div class="summary" aria-busy="true" aria-label="Loading the overview">
        <span class="skeleton sk-alert"></span>
        <span class="skeleton sk-strip"></span>
      </div>
      <section class="tiles">
        ${[0, 1, 2, 3].map(() => html`<span class="skeleton sk-tile"></span>`)}
      </section>
      <span class="skeleton sk-chart"></span>
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
      return html`<section class="strip live" role="status">
        <span class="tag"><span class="live-dot" aria-hidden="true"></span>Q60 live</span>
        <span class="line"
          ><span class="mono">${s.v2}</span> signs the chain since block
          <a class="mono" href="/block/${s.firstV2LockedHeight}">${num(s.firstV2LockedHeight)}</a> —
          <b class="mono">${num(this._clocks?.signers.counts.v2 ?? 0)}</b> lock(s) observed in the current window.</span
        >
      </section>`;
    }
    if (tip >= s.activationHeight) {
      return html`<section class="strip" role="status">
        <span class="tag">Q60 activation</span>
        <span
          >Activation height <span class="mono">${num(s.activationHeight)}</span> passed at tip
          <span class="mono">${num(tip)}</span> — waiting for the first
          <span class="mono">${s.v2}</span>-signed ChainLock.</span
        >
      </section>`;
    }
    const blocksLeft = s.activationHeight - tip;
    return html`<section class="strip" role="status">
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
      (r) => html`<section class="strip task" role="status">
        <span class="tag">
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
          Experiment running
        </span>
        <span class="task-body">
          <a class="task-title" href="/experiments/${r.runKey}">${r.title}</a>
          <span class="chips">
            <span class="chip">since block ${num(r.startHeight)}</span>
            ${r.intervention
              ? html`<span class="chip">${r.intervention.kind}</span>
                  <span class="chip">${num(r.intervention.targets.length)} target(s)</span>`
              : nothing}
            <span class="chip">started ${ago(r.startedAt)}</span>
            <span class="chip mono">${r.runKey}</span>
          </span>
        </span>
      </section>`
    )}`;
  }

  private _alert(status: NetworkStatus): TemplateResult {
    const s = this._timeline?.summary;
    return html`
      <section class="alert ${status.state}" role=${status.state === 'investigate' ? 'alert' : 'status'}>
        <span class="alert-chip">${status.label}</span>
        <div class="alert-body">
          <div class="alert-title">${status.headline}</div>
          <div class="alert-detail">${status.detail}</div>
          <div class="alert-meta">
            <span>eligible masternodes <b>${num(status.enabledMasternodes)}</b></span>
            ${status.minSize > 0 ? html`<span>profile minimum <b>${num(status.minSize)}</b></span>` : nothing}
            ${s ? html`<span>7d formed <b>${num(s.formed)}</b> · failed <b>${num(s.failed)}</b></span>` : nothing}
            ${status.nextRoundHeight !== null
              ? html`<span>next round <b>H ${num(status.nextRoundHeight)}</b></span>`
              : nothing}
          </div>
          ${status.state === 'bootstrap' && status.minSize > 0
            ? html`<div class="bar" role="progressbar" aria-valuenow=${Math.round(status.progress * 100)} aria-valuemin="0" aria-valuemax="100">
                <i style="width:${(status.progress * 100).toFixed(1)}%"></i>
              </div>`
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

    const median = s.medianHealthRatio;
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
          value=${ratio(median)}
          sub=${s.worstHealthRatio === null ? 'no formed round yet' : `worst ${ratio(s.worstHealthRatio)}`}
          tone=${median === null ? '' : median >= 0.95 ? 'good' : median >= 0.8 ? 'warn' : 'crit'}
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
        <div class="card-head">
          <div class="card-title">Health ratio per round</div>
          <div class="page-sub mono">${num(points.length)} rounds · 7 days</div>
        </div>
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

  private async _copy(hash: string, key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(hash);
      this._copied = key;
      window.setTimeout(() => {
        if (this._copied === key) this._copied = null;
      }, 1200);
    } catch {
      // No clipboard here; the full hash is still in the cell's title.
    }
  }

  private _healthClass(r: QuorumRoundListItem): string {
    if (r.healthRatio === null) return 'health';
    const size = r.effectiveSize ?? 0;
    const floor = size > 0 ? r.minSize / size : 0;
    if (r.healthRatio < floor) return 'health bad';
    if (r.healthRatio < 0.9) return 'health low';
    return 'health';
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
                  <th scope="col">Round</th>
                  <th scope="col" class="r">Height</th>
                  <th scope="col" class="c">Formed</th>
                  <th scope="col" class="r">Valid members</th>
                  <th scope="col" class="r">Health</th>
                  <th scope="col" class="r">Punished</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Quorum hash</th>
                  <th scope="col" class="r">Seen</th>
                </tr>
              </thead>
              <tbody>
                ${this._rounds.length === 0
                  ? html`<tr><td class="empty" colspan="9">No rounds recorded yet.</td></tr>`
                  : this._rounds.map(
                      (r) => html`
                        <tr>
                          <td class="mono strong">${r.roundKey}</td>
                          <td class="r mono">${num(r.expectedHeight)}</td>
                          <td class="c"><span class="pill ${r.status}">${r.status}</span></td>
                          <td class="r mono">
                            ${r.numValidMembers === null
                              ? '—'
                              : `${num(r.numValidMembers)}/${num(r.effectiveSize)}`}
                          </td>
                          <td class="r mono ${this._healthClass(r)}">${ratio(r.healthRatio)}</td>
                          <td class="r mono punished ${r.punishedCount > 0 ? 'some' : ''}">${num(r.punishedCount)}</td>
                          <td class="evidence">${this._evidence(r, status)}</td>
                          <td>
                            ${r.quorumHash
                              ? html`<span class="hashcell">
                                  <span class="hash" title=${r.quorumHash}>${shortHash(r.quorumHash, 10, 8)}</span>
                                  <button
                                    class="copy ${this._copied === r.roundKey ? 'done' : ''}"
                                    type="button"
                                    aria-label="Copy quorum hash ${r.quorumHash}"
                                    @click=${() => void this._copy(r.quorumHash ?? '', r.roundKey)}
                                  >
                                    ${this._copied === r.roundKey ? 'copied' : 'copy'}
                                  </button>
                                </span>`
                              : html`<span class="subtle">—</span>`}
                          </td>
                          <td class="r mono subtle">${ago(r.detectedAt)}</td>
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
