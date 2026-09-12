import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { ExperimentDetail, ExperimentOutcome, ExperimentRow } from '../lib/api.js';
import { errorMessage, isAbortError } from '../lib/errors.js';
import { PollController, type PollRun } from '../lib/poll.js';
import { QueryStateController, pageToOffset, type ParamSpec } from '../lib/queryState.js';
import { ago, num, ratio } from '../lib/format.js';
import { baseStyles, cardStyles, pageStyles, pagerStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';

const REFRESH_MS = 60_000;
/**
 * One page, and the same number the server defaults to.
 *
 * The page used to ask for the list with no arguments at all and render
 * whatever came back -- which was the server's default page, 25 rows, under a
 * heading that said "Recorded runs". At 34 records that is nine experiments
 * this project has no other index of, absent from the only screen that lists
 * them, with nothing on the page suggesting there were more.
 */
const PAGE_SIZE = 25;

type StatusFilter = '' | 'running' | 'closed';

/** What this view's URL carries. Defaults are absent, so `/experiments` is plain. */
const QUERY: Record<string, ParamSpec> = {
  status: { kind: 'enum', values: ['', 'running', 'closed'], fallback: '' },
  page: { kind: 'page', limit: PAGE_SIZE },
};

export class DdPageExperiments extends LitElement {
  static override properties = {
    runKey: { type: String },
    _rows: { state: true },
    _total: { state: true },
    _offset: { state: true },
    _status: { state: true },
    _loading: { state: true },
    _detail: { state: true },
    _error: { state: true },
  };

  runKey: string | null = null;
  private _rows: ExperimentRow[] = [];
  /** The true match count, not the size of the page on screen. */
  private _total = 0;
  private _offset = 0;
  private _status: StatusFilter = '';
  /** Loading is not empty: the two look identical and mean opposite things. */
  private _loading = true;
  /** The address bar; the only thing that reacts to a filter change. */
  private readonly _query = new QueryStateController(this, QUERY, (values) => {
    this._applyQuery(values);
    this._poll.refresh();
  });
  private _detail: ExperimentDetail | null = null;
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
    pagerStyles,
    css`
      .kv {
        display: grid;
        grid-template-columns: 170px 1fr;
        gap: 6px 14px;
        padding: 14px;
        font-size: var(--fs-sm);
      }
      .kv dt {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ink-3);
        margin: 0;
      }
      .kv dd {
        margin: 0;
      }
      .prose {
        white-space: pre-wrap;
        line-height: 1.55;
      }
      .delta.up {
        color: var(--good);
      }
      .delta.down {
        color: var(--crit);
      }
      .delta.flat {
        color: var(--ink-3);
      }
      .caveat {
        padding: 10px 14px;
        border-top: 1px solid var(--line-soft);
        color: var(--ink-3);
        font-size: var(--fs-sm);
        line-height: 1.55;
      }
      .bad {
        color: var(--crit);
        font-weight: 600;
      }
      /* A type the v23 mainnet never forms, beside its name in every table
         that counts its penalties. */
      .badge {
        margin-left: 6px;
        padding: 1px 5px;
        border: 1px dashed var(--line-strong);
        border-radius: var(--radius);
        color: var(--ink-3);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        vertical-align: middle;
        cursor: help;
      }
    `,
  ];

  override updated(changed: Map<string, unknown>): void {
    // Only a real change. On the first update every initialised property is
    // in the map, and the controller has already loaded once on connect --
    // reloading here made every detail page fetch itself twice.
    if (changed.has('runKey') && changed.get('runKey') !== undefined) {
      // Whatever is held belongs to the run that was on screen a moment ago.
      // Leaving it there means one run's result is rendered under another
      // run's URL until the new answer lands -- briefly, and wrongly.
      this._detail = null;
      this._rows = [];
      this._total = 0;
      this._error = '';
      this._poll.refresh();
    }
  }

  /** See dd-page-rounds: the URL is read before the first fetch goes out. */
  override connectedCallback(): void {
    this._applyQuery(this._query.values);
    super.connectedCallback();
  }

  private _applyQuery(values: Record<string, string | number | null>): void {
    const status = values['status'];
    this._status = status === 'running' || status === 'closed' ? status : '';
    const page = typeof values['page'] === 'number' ? values['page'] : 1;
    this._offset = pageToOffset(page, PAGE_SIZE);
  }

  private _page(): number {
    const page = this._query.values['page'];
    return typeof page === 'number' ? page : 1;
  }

  private async _load(run: PollRun): Promise<void> {
    this._loading = true;
    try {
      if (this.runKey) {
        const detail = await run.api.experiment(this.runKey);
        if (run.stale) return;
        this._detail = detail;
      } else {
        const result = await run.api.experiments({
          limit: PAGE_SIZE,
          offset: this._offset,
          status: this._status === '' ? undefined : this._status,
        });
        if (run.stale) return;
        this._rows = result.items;
        // The count of everything that matches, which is the number the pager
        // and the "of N" both need. The page on screen is a sample of it.
        this._total = result.total;
      }
      this._error = '';
    } catch (error) {
      if (run.stale || isAbortError(error)) return;
      this._error = errorMessage(error);
    } finally {
      if (!run.stale) this._loading = false;
    }
  }

  private _setStatus(value: StatusFilter): void {
    // A filter change makes the old page number meaningless: page 2 of the
    // closed runs is not page 2 of all runs.
    this._query.set({ status: value, page: 1 });
  }

  private _move(delta: number): void {
    this._query.set({ page: Math.max(1, this._page() + delta) });
  }

  override render(): TemplateResult {
    return html`
      <div class="page-head">
        <div>
          <h1 class="page-title" tabindex="-1">${this.runKey ? 'Experiment' : 'Experiments'}</h1>
          <div class="page-sub">
            What was done to the network, what was expected, and what actually happened — a result
            nobody can repeat is an anecdote.
          </div>
        </div>
      </div>
      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
      ${this.runKey ? this._detailView() : this._list()}
    `;
  }

  private _list(): TemplateResult {
    const from = this._total === 0 ? 0 : this._offset + 1;
    const to = Math.min(this._offset + PAGE_SIZE, this._total);
    return html`
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">Recorded runs</h2>
          <!-- What is on screen, against what exists. The heading alone used to
               say "Recorded runs" over a page of 25 out of 34. -->
          <div class="page-sub mono">
            ${this._total === 0 ? 'none' : `${num(from)}–${num(to)} of ${num(this._total)}`}
          </div>
        </div>
        <div class="filters">
          <div class="group">
            ${(['', 'running', 'closed'] as StatusFilter[]).map(
              (value) => html`
                <button
                  aria-pressed=${this._status === value ? 'true' : 'false'}
                  @click=${() => this._setStatus(value)}
                >
                  ${value === '' ? 'All runs' : value}
                </button>
              `
            )}
          </div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">Every recorded experiment run, its status and the height range it covers.</caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Title</th>
                  <th scope="col" class="c">Status</th>
                  <th scope="col" class="r">Heights</th>
                  <th scope="col" class="r">MN</th>
                  <th scope="col">Intervention</th>
                  <th scope="col" class="r">Started</th>
                </tr>
              </thead>
              <tbody>
                ${this._rows.length === 0
                  ? html`<tr>
                      <td class="empty" colspan="7">${this._emptyReason()}</td>
                    </tr>`
                  : this._rows.map(
                      (r) => html`
                        <tr>
                          <td class="mono"><a href="/experiments/${r.runKey}">${r.runKey}</a></td>
                          <td>${r.title}</td>
                          <td class="c"><span class="pill ${r.status}">${r.status}</span></td>
                          <td class="r mono">
                            ${num(r.startHeight)}${r.endHeight === null ? '→' : `–${num(r.endHeight)}`}
                          </td>
                          <td class="r mono">${num(r.participants.masternodes)}</td>
                          <td>${r.intervention?.kind ?? '—'}</td>
                          <td class="r mono">${ago(r.startedAt)}</td>
                        </tr>
                      `
                    )}
              </tbody>
            </table>
          </div>
        </div>
        <div class="pager">
          <button ?disabled=${this._offset === 0 || this._loading} @click=${() => this._move(-1)}>
            Newer
          </button>
          <button ?disabled=${to >= this._total || this._loading} @click=${() => this._move(1)}>
            Older
          </button>
          <span>${this._total === 0 ? 'nothing to page through' : `${num(from)}–${num(to)} of ${num(this._total)}`}</span>
        </div>
      </section>
    `;
  }

  /**
   * Why the table is empty, which is three different things.
   *
   * "No experiment recorded yet" was printed for all of them, including while
   * the first request was still in flight and including when a request had
   * just failed. On a page whose subject is the record of what was done to the
   * network, "nothing was done" is the one answer that must never be guessed.
   */
  private _emptyReason(): string {
    if (this._loading) return 'Loading…';
    if (this._error !== '') return 'The list could not be loaded, so what exists is unknown.';
    if (this._status !== '') return `No ${this._status} run matches. Other runs may exist.`;
    return 'No experiment recorded yet. Open one through the admin API before changing anything on the network.';
  }

  private _detailView(): TemplateResult {
    const d = this._detail;
    if (!d) return html`<div class="note">Loading…</div>`;
    const o = d.outcome;

    return html`
      ${o
        ? html`
            <section class="tiles">
              <dd-stat
                label="Formation rate"
                value=${o.formationRate === null ? '—' : ratio(o.formationRate)}
                sub="${num(o.rounds.formed)} formed · ${num(o.rounds.failed)} failed"
              ></dd-stat>
              <dd-stat
                label="Median health"
                value=${o.medianHealthRatio === null ? '—' : ratio(o.medianHealthRatio)}
                sub=${o.worstHealthRatio === null ? 'no formed round' : `worst ${ratio(o.worstHealthRatio)}`}
              ></dd-stat>
              <dd-stat
                label="Masternodes punished"
                value=${num(o.masternodesPunished)}
                sub="${num(o.banEvents)} ban · ${num(o.penaltyIncreases)} penalty"
                tone=${o.masternodesPunished > 0 ? 'warn' : 'good'}
              ></dd-stat>
              <dd-stat
                label="ChainLock coverage"
                value=${o.chainLockCoverage === null ? '—' : ratio(o.chainLockCoverage)}
                sub="${num(o.chainLockedBlocks)} of ${num(o.blocks)} blocks"
              ></dd-stat>
              <dd-stat
                label="Sentinel epochs"
                value=${o.dsl == null ? '—' : `${num(o.dsl.committed)} of ${num(o.dsl.epochs)}`}
                sub=${o.dsl == null ? 'none judged in the window' : `${num(o.dsl.absent)} absent · ${num(o.dsl.missedBits)} missed bits`}
                tone=${o.dsl != null && o.dsl.absent > 0 ? 'warn' : 'good'}
              ></dd-stat>
              <dd-stat
                label="Block interval"
                value=${o.meanBlockIntervalSec == null ? '—' : `${num(Math.round(o.meanBlockIntervalSec))} s`}
                sub=${intervalNote(o)}
              ></dd-stat>
              <dd-stat
                label="Block producers"
                value=${num(o.distinctStakers)}
                sub=${concentrationNote(o)}
              ></dd-stat>
            </section>
          `
        : nothing}
      ${this._found(d)} ${this._byProfile(d)} ${this._mainnetView(d)} ${this._declared(d)}
      ${d.comparison ? this._comparison(d) : nothing}
    `;
  }

  /** The tag a profile the v23 mainnet never forms carries wherever it is named. */
  private _devnetTag(formsOnV23Mainnet: boolean | undefined): TemplateResult | typeof nothing {
    if (formsOnV23Mainnet !== false) return nothing;
    return html`<span
      class="badge"
      title="Forms on this devnet and not on the v23 mainnet: the node admits this profile on testnet and devnet only. Its exclusions carry the same PoSe penalty here, and none on mainnet."
      >devnet-only</span
    >`;
  }

  /**
   * The same window with the profiles the v23 mainnet never forms held out.
   *
   * The devnet punishes on four profiles; mainnet will punish on two. So a
   * roll that "punished three" here may have punished nobody as mainnet would
   * count it -- which is exactly what the 2026-09-10 roll did, all three in
   * one llmq_50_60 round. Without this row every devnet figure is quoted for
   * mainnet pessimistically, by an amount the reader cannot see.
   */
  private _mainnetView(d: ExperimentDetail): TemplateResult | typeof nothing {
    const o = d.outcome;
    const m = o?.mainnetRelevant;
    if (!o || m == null) return nothing;
    const devnetOnly = (o.byProfile ?? []).filter((p) => p.formsOnV23Mainnet === false);
    const heldOut = devnetOnly.map((p) => `${p.llmqName} ${num(p.membersPunished)}`).join(', ');

    return html`
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">As the v23 mainnet would count it</h2>
          <div class="page-sub mono">
            ${m.profiles.length === 0 ? 'no mainnet-forming round in the window' : m.profiles.join(' · ')}
          </div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">This run's rounds with the profiles the v23 mainnet never forms held out.</caption>
              <thead>
                <tr>
                  <th scope="col" class="r">Formed</th>
                  <th scope="col" class="r">Failed</th>
                  <th scope="col" class="r">Pending</th>
                  <th scope="col" class="r">Impossible</th>
                  <th scope="col" class="r">Formation</th>
                  <th scope="col" class="r">Median health</th>
                  <th scope="col" class="r">Worst</th>
                  <th scope="col" class="r">Longest streak</th>
                  <th scope="col" class="r">Members punished</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="r mono">${num(m.rounds.formed)}</td>
                  <td class="r mono ${m.rounds.failed > 0 ? 'bad' : ''}">${num(m.rounds.failed)}</td>
                  <td class="r mono">${num(m.rounds.pending)}</td>
                  <td class="r mono muted">${num(m.rounds.impossible)}</td>
                  <td class="r mono">${m.formationRate === null ? '—' : ratio(m.formationRate)}</td>
                  <td class="r mono">${m.medianHealthRatio === null ? '—' : ratio(m.medianHealthRatio)}</td>
                  <td class="r mono ${(m.worstHealthRatio ?? 1) < 0.5 ? 'bad' : ''}">
                    ${m.worstHealthRatio === null ? '—' : ratio(m.worstHealthRatio)}
                  </td>
                  <td class="r mono ${m.longestFailureStreak > 0 ? 'bad' : ''}">${num(m.longestFailureStreak)}</td>
                  <td class="r mono ${m.membersPunished > 0 ? 'bad' : ''}">${num(m.membersPunished)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="caveat">
            The devnet forms four punishing quorum types; the v23 mainnet will form two of them.
            Every figure at the top of this page counts all four. This row counts only the types
            mainnet runs${devnetOnly.length > 0
              ? html` — the devnet-only types marked invalid, in this window: ${heldOut}, penalties
                  mainnet would never have handed out`
              : nothing}.
            Ban and penalty <em>events</em> are network-wide and are not split: a masternode banned
            by two llmq_50_60 exclusions still counts in “Masternodes punished” above.
          </div>
        </div>
      </section>
    `;
  }

  /**
   * What the run concluded, in prose.
   *
   * Placed above the declaration on purpose: a reader who scrolls no further
   * should still get the finding rather than the intention, and the two must
   * never be confused for one another.
   */
  private _found(d: ExperimentDetail): TemplateResult | typeof nothing {
    if (!d.notes) return nothing;
    return html`
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">What it found</h2>
          <div class="page-sub mono">recorded after the numbers froze</div>
        </div>
        <div class="card-body">
          <div class="prose">${d.notes}</div>
        </div>
      </section>
    `;
  }

  /**
   * The same window, per quorum type.
   *
   * Blending them hides the finding: the profiles close rounds at different
   * rates, so the frequent one dominates every total while the type that
   * actually degraded disappears into the average.
   */
  private _byProfile(d: ExperimentDetail): TemplateResult | typeof nothing {
    const rows = d.outcome?.byProfile ?? [];
    if (rows.length === 0) return nothing;

    return html`
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">By quorum type</h2>
          <div class="page-sub mono">${num(rows.length)} tracked</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">This run broken down by quorum type, because the schedules interleave and must never be blended.</caption>
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col" class="r">Every</th>
                  <th scope="col" class="r">Formed</th>
                  <th scope="col" class="r">Failed</th>
                  <th scope="col" class="r">Pending</th>
                  <th scope="col" class="r">Impossible</th>
                  <th scope="col" class="r">Formation</th>
                  <th scope="col" class="r">Median health</th>
                  <th scope="col" class="r">Worst</th>
                  <th scope="col" class="r">Members punished</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(
                  (p) => html`
                    <tr>
                      <td class="mono">${p.llmqName}${this._devnetTag(p.formsOnV23Mainnet)}</td>
                      <td class="r mono">${num(p.dkgInterval)} blk</td>
                      <td class="r mono">${num(p.rounds.formed)}</td>
                      <td class="r mono ${p.rounds.failed > 0 ? 'bad' : ''}">
                        ${num(p.rounds.failed)}
                      </td>
                      <td class="r mono">${num(p.rounds.pending)}</td>
                      <td class="r mono ${p.rounds.impossible > 0 ? 'muted' : ''}">
                        ${num(p.rounds.impossible)}
                      </td>
                      <td class="r mono">
                        ${p.formationRate === null ? '—' : ratio(p.formationRate)}
                      </td>
                      <td class="r mono">
                        ${p.medianHealthRatio === null ? '—' : ratio(p.medianHealthRatio)}
                      </td>
                      <td class="r mono ${(p.worstHealthRatio ?? 1) < 0.5 ? 'bad' : ''}">
                        ${p.worstHealthRatio === null ? '—' : ratio(p.worstHealthRatio)}
                      </td>
                      <td class="r mono ${p.membersPunished > 0 ? 'bad' : ''}">
                        ${num(p.membersPunished)}
                      </td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          </div>
          <div class="caveat">
            A failed round mines no commitment, so only the reconstructed schedule shows it was
            ever due — and that reconstruction runs per type. Rounds are counted separately
            because the intervals differ: one type can hold a perfect record while another
            degrades, and a single blended rate would report neither.
            <br /><br />
            <strong>Impossible</strong> is not a softer word for failed. A profile needing more
            members than the network has cannot form however well every masternode behaves —
            llmq_400_85 asks for 350 against a devnet of at most 80 — so those rounds are held
            out of the formation rate rather than counted against it.
            <br /><br />
            <strong>devnet-only</strong> marks a type the v23 mainnet never forms: the node admits
            llmq_50_60 and llmq_60_75 on testnet and devnet only. Their exclusions carry the same
            penalty here and none on mainnet — the next card counts this window as mainnet would.
          </div>
        </div>
      </section>
    `;
  }

  private _declared(d: ExperimentDetail): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">Declared before the run</h2>
          <div class="page-sub mono">${d.status}</div>
        </div>
        <div class="card-body flush">
          <dl class="kv">
            <dt>Title</dt><dd>${d.title}</dd>
            <dt>Hypothesis</dt><dd class="prose">${d.hypothesis || '—'}</dd>
            <dt>Expected</dt><dd class="prose">${d.expected || '—'}</dd>
            <dt>Intervention</dt>
            <dd class="prose">
              ${d.intervention
                ? `${d.intervention.kind}: ${d.intervention.description} (${d.intervention.targets.length} target(s))`
                : 'none — observation only'}
            </dd>
            <dt>Node</dt>
            <dd class="mono">v${d.nodeVersion}${d.nodeGitSha ? ` @ ${d.nodeGitSha.slice(0, 10)}` : ''}</dd>
            <dt>Profile</dt>
            <dd class="mono">
              ${d.profile.llmqName}${this._devnetTag(d.profile.formsOnV23Mainnet)} · size ${num(d.profile.size)} / min ${num(d.profile.minSize)} /
              threshold ${num(d.profile.threshold)} · dkgInterval ${num(d.profile.dkgInterval)}
            </dd>
            <dt>Participants</dt>
            <dd class="mono">
              ${num(d.participants.masternodes)} masternodes on ${num(d.participants.hosts)} hosts ·
              ${num(d.participants.stakers)} staker(s)
              <span class="muted">at open</span>
            </dd>
            ${d.currentParticipants
              ? html`
                  <dt>Right now</dt>
                  <dd class="mono">
                    ${num(d.currentParticipants.masternodes)} masternodes on
                    ${num(d.currentParticipants.hosts)} hosts ·
                    ${num(d.currentParticipants.stakers)} staker(s)
                    <span class="muted">height ${num(d.tipHeight)}</span>
                  </dd>
                `
              : nothing}
            <dt>Window</dt>
            <dd class="mono">
              height ${num(d.startHeight)}${d.endHeight === null
                ? ' → open'
                : `–${num(d.endHeight)}`}
            </dd>
          </dl>
        </div>
      </section>
    `;
  }

  /** A difference is only worth showing next to what it is a difference from. */
  private _comparison(d: ExperimentDetail): TemplateResult {
    const c = d.comparison!;
    const o = d.outcome;
    const b = c.baseline;
    const rows: ComparisonRow[] = [
      { label: 'Formation rate', run: o?.formationRate ?? null, base: b.formationRate, delta: c.delta.formationRate, kind: 'ratio', higherIsBetter: true },
      { label: 'Median health', run: o?.medianHealthRatio ?? null, base: b.medianHealthRatio, delta: c.delta.medianHealthRatio, kind: 'ratio', higherIsBetter: true },
      { label: 'ChainLock coverage', run: o?.chainLockCoverage ?? null, base: b.chainLockCoverage, delta: c.delta.chainLockCoverage, kind: 'ratio', higherIsBetter: true },
      { label: 'Masternodes punished', run: o?.masternodesPunished ?? null, base: b.masternodesPunished, delta: c.delta.masternodesPunished, kind: 'number', higherIsBetter: false },
      // The same two figures as the v23 mainnet would count them: the devnet
      // punishes on four profiles, mainnet will punish on two, and a roll that
      // "punished three" here punished nobody by mainnet's count (2026-09-10).
      { label: 'Formation rate (v23 mainnet types)', run: o?.mainnetRelevant?.formationRate ?? null, base: b.mainnetRelevant?.formationRate ?? null, delta: c.delta.mainnetFormationRate, kind: 'ratio', higherIsBetter: true },
      { label: 'Members punished (v23 mainnet types)', run: o?.mainnetRelevant?.membersPunished ?? null, base: b.mainnetRelevant?.membersPunished ?? null, delta: c.delta.mainnetMembersPunished, kind: 'number', higherIsBetter: false },
      // The spacing target governs the MEAN. Intervals are exponentially
      // distributed, so the median sits at 0.693 of the mean and reads 30%
      // fast against the target; both are shown so neither is read as the
      // other. A run whose expected outcome named the median read as a miss
      // on a chain that was within 8% of target.
      { label: 'Mean block interval (s)', run: o?.meanBlockIntervalSec ?? null, base: b.meanBlockIntervalSec ?? null, delta: c.delta.meanBlockIntervalSec, kind: 'number', higherIsBetter: false },
      { label: 'Median block interval (s)', run: o?.medianBlockIntervalSec ?? null, base: b.medianBlockIntervalSec, delta: c.delta.medianBlockIntervalSec, kind: 'number', higherIsBetter: false },
      // Concentration beside the count. Lower is better, and a change here is
      // what a fairness intervention exists to move: the producer count barely
      // moves when the dominant staker stops, because the others were already
      // there.
      { label: 'Top staker share', run: o?.topStakerShare ?? null, base: b.topStakerShare ?? null, delta: c.delta.topStakerShare, kind: 'ratio', higherIsBetter: false },
      { label: 'Staker HHI', run: o?.stakerHhi ?? null, base: b.stakerHhi ?? null, delta: c.delta.stakerHhi, kind: 'index', higherIsBetter: false },
      { label: 'Staker Gini', run: o?.stakerGini ?? null, base: b.stakerGini ?? null, delta: c.delta.stakerGini, kind: 'index', higherIsBetter: false },
      // The share of Sentinel epochs that produced a record. A DSL run is
      // about this number and nothing else; until it was carried the table
      // compared everything but the question asked.
      { label: 'Sentinel convergence', run: o?.dsl?.convergenceRate ?? null, base: b.dsl?.convergenceRate ?? null, delta: c.delta.dslConvergenceRate, kind: 'ratio', higherIsBetter: true },
    ];

    return html`
      <section class="card">
        <div class="card-head">
          <h2 class="card-title">Against baseline</h2>
          <div class="page-sub mono">${c.baselineRunKey}</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">This run measured against its baseline run, figure by figure.</caption>
              <thead>
                <tr><th scope="col">Measure</th><th scope="col" class="r">This run</th><th scope="col" class="r">Baseline</th><th scope="col" class="r">Δ</th></tr>
              </thead>
              <tbody>
                ${rows.map(({ label, run, base, delta, kind, higherIsBetter }) => {
                  // The sign alone cannot pick the colour: a rise is good for a
                  // formation rate and bad for punishments, spacing or concentration.
                  const better = delta === null || delta === 0 ? 'flat' : (delta > 0) === higherIsBetter ? 'up' : 'down';
                  const fmt = (v: number | null): string =>
                    v === null ? '—' : kind === 'ratio' ? ratio(v) : kind === 'index' ? v.toFixed(3) : num(Math.round(v * 100) / 100);
                  return html`
                    <tr>
                      <td>${label}</td>
                      <td class="r mono">${fmt(run)}</td>
                      <td class="r mono">${fmt(base)}</td>
                      <td class="r mono delta ${better}">
                        ${delta === null ? '—' : `${delta > 0 ? '+' : ''}${fmt(delta)}`}
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </div>
          <div class="note">
            Block intervals are exponentially distributed, so the median sits at 0.693 of the
            mean; the spacing target governs the mean. A dash means the figure was not recorded
            on that side, not that it was zero.
          </div>
        </div>
      </section>
    `;
  }
}

interface ComparisonRow {
  label: string;
  run: number | null;
  base: number | null;
  delta: number | null;
  /** How the figure is printed: a percentage, a plain number, or a 0..1 index. */
  kind: 'ratio' | 'number' | 'index';
  higherIsBetter: boolean;
}

/** The median beside the mean, and which is which; the mean is the target's figure. */
function intervalNote(o: ExperimentOutcome): string {
  if (o.medianBlockIntervalSec === null) return 'no interval in the window';
  const median = `median ${num(Math.round(o.medianBlockIntervalSec))} s`;
  return o.meanBlockIntervalSec == null ? `${median} · mean not recorded` : `mean · ${median}`;
}

/** Concentration beside the count, or the honest absence of it. */
function concentrationNote(o: ExperimentOutcome): string {
  if (o.topStakerShare == null) return 'concentration not recorded';
  const gini = o.stakerGini == null ? '—' : o.stakerGini.toFixed(2);
  return `top share ${ratio(o.topStakerShare)} · Gini ${gini}`;
}

customElements.define('dd-page-experiments', DdPageExperiments);
