import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { LlmqProfileView, QuorumRoundListItem } from '@devnet-deftrack/shared';
import { errorMessage, isAbortError } from '../lib/errors.js';
import { PollController, type PollRun } from '../lib/poll.js';
import {
  LLMQ_ALL,
  LLMQ_PATTERN,
  QueryStateController,
  llmqApiName,
  pageToOffset,
  type ParamSpec,
} from '../lib/queryState.js';
import { ago, num, ratio, shortHash } from '../lib/format.js';
import { interventionsFor, type InterventionRun } from '../lib/interventions.js';
import { roundVerdict } from '../lib/roundVerdict.js';
import { roundHref } from '../lib/router.js';
import { baseStyles, cardStyles, pageStyles, pagerStyles, tableStyles } from '../styles/shared.js';

const PAGE_SIZE = 50;

/**
 * What this view's URL carries.
 *
 * `llmq` rather than `llmqName`: the reader types the first, the API takes the
 * second, and the translation lives in one place. Absent means every profile,
 * which on this page has always been the default -- unlike Fairness, where
 * absent means "resolve the one signing at the tip".
 */
const QUERY: Record<string, ParamSpec> = {
  status: {
    kind: 'enum',
    values: ['', 'formed', 'failed', 'pending', 'impossible'],
    fallback: '',
  },
  llmq: { kind: 'optional', pattern: LLMQ_PATTERN },
  page: { kind: 'page', limit: PAGE_SIZE },
};
const REFRESH_MS = 60_000;

export class DdPageRounds extends LitElement {
  static override properties = {
    _rounds: { state: true },
    _total: { state: true },
    _offset: { state: true },
    _status: { state: true },
    _llmq: { state: true },
    _types: { state: true },
    _runs: { state: true },
    _revives: { state: true },
    _profiles: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  private _rounds: QuorumRoundListItem[] = [];
  private _total = 0;
  private _offset = 0;
  private _status = '';
  private _llmq = '';
  /**
   * The address bar, and the only thing that reacts to a filter change.
   *
   * The controls write here; this hands the values back once; the poll reloads
   * from that one callback. A control that also refreshed by itself would fetch
   * twice for every click.
   */
  private readonly _query = new QueryStateController(this, QUERY, (values) => {
    this._applyQuery(values);
    this._poll.refresh();
  });
  /**
   * Quorum types discovered in the data rather than listed here, so the filter
   * cannot fall out of step with the profiles the collector tracks. Names are
   * accumulated and never dropped: filtering to one type must not make the
   * others disappear from the control that switches back to them.
   */
  private _types: string[] = [];
  /**
   * What was being done to the network while these rounds were measured. Two
   * cheap extra reads, because a round measured during an intervention is a
   * true number about a network nobody should generalise from -- and the row
   * had no way to say so.
   */
  private _runs: InterventionRun[] = [];
  private _revives: number[] = [];
  /**
   * The server's profile registry, read once: which types form on the v23
   * mainnet and why. The devnet punishes on four profiles and mainnet will
   * punish on two, and a row of the other two carries penalties with no
   * mainnet counterpart -- which the row has to say, in the registry's words.
   */
  private _profiles: LlmqProfileView[] = [];
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
    pagerStyles,
    css`
      /* The punished cell is the incident. It carries weight only when there
         was one; a round that punished nobody says so in words, because a bare
         zero reads as a missing value rather than as an assertion. */
      td.punished {
        font-family: var(--font-mono);
        font-weight: 700;
        color: var(--warn);
      }
      td.muted-cell {
        color: var(--ink-3);
      }
      /* What was being done to the network when this round was measured. Next
         to the round key, because it qualifies the whole row and not one cell. */
      .badges {
        display: inline-flex;
        gap: 4px;
        margin-left: 6px;
        vertical-align: middle;
      }
      .badge {
        padding: 1px 5px;
        border: 1px solid var(--line-strong);
        border-radius: var(--radius);
        color: var(--ink-2);
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        text-decoration: none;
        cursor: help;
      }
      .badge.experiment {
        border-color: var(--accent);
        color: var(--accent);
      }
      /* A type the v23 mainnet never forms. Dashed and dim: it qualifies the
         penalties on the row, not the round's own health. */
      .badge.devnet {
        border-style: dashed;
        color: var(--ink-3);
      }
      a.badge:hover {
        text-decoration: none;
        background: var(--surface-3);
      }

      /* Sits against the punished count, because that is the number a reader
         would otherwise take at face value. */
      .warmup {
        margin-left: 6px;
        padding: 1px 5px;
        border: 1px solid var(--warn);
        border-radius: var(--radius);
        color: var(--warn);
        font-size: var(--fs-xs);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: help;
      }
    `,
  ];

  /**
   * The URL is read before anything loads.
   *
   * Controllers run their `hostConnected` in the order they were registered,
   * and the poll registers first -- so without this the first fetch would go
   * out with the defaults and a second would follow with the URL's values. One
   * fetch, with what the address bar actually says.
   */
  override connectedCallback(): void {
    this._applyQuery(this._query.values);
    super.connectedCallback();
  }

  /** URL -> component state. One direction; the URL is the source. */
  private _applyQuery(values: Record<string, string | number | null>): void {
    const llmq = values['llmq'];
    this._llmq = typeof llmq === 'string' && llmq !== LLMQ_ALL ? llmq : '';
    const status = values['status'];
    this._status = typeof status === 'string' ? status : '';
    const page = typeof values['page'] === 'number' ? values['page'] : 1;
    this._offset = pageToOffset(page, PAGE_SIZE);
  }

  private async _load(run: PollRun): Promise<void> {
    try {
      const params: { limit: number; offset: number; status?: string; llmqName?: string } = {
        limit: PAGE_SIZE,
        offset: this._offset,
      };
      if (this._status) params.status = this._status;
      if (this._llmq) params.llmqName = this._llmq;
      const [p, runs, revives, profiles] = await Promise.all([
        run.api.rounds(params),
        // Neither is worth an error bar of its own: without them the rows are
        // simply unbadged, which is where they were before.
        run.api.experiments({ limit: 50 }).catch(() => null),
        run.api.masternodeEvents({ hours: 24 * 90, type: 'revived', limit: 500 }).catch(() => null),
        // Once per page: the registry changes with the binary, not the tip.
        this._profiles.length === 0 ? run.api.llmqProfiles().catch(() => null) : Promise.resolve(null),
      ]);
      if (run.stale) return;
      this._rounds = p.items;
      this._total = p.total;
      if (profiles) this._profiles = profiles.items;
      if (runs) {
        this._runs = runs.items.map((r) => ({
          runKey: r.runKey,
          title: r.title,
          startHeight: r.startHeight,
          endHeight: r.endHeight,
        }));
      }
      if (revives) this._revives = revives.items.map((e) => e.height);
      const known = new Set([...this._types, ...p.items.map((r) => r.llmqName)]);
      this._types = [...known].sort();
      this._error = '';
    } catch (error) {
      if (run.stale || isAbortError(error)) return;
      this._error = errorMessage(error);
    } finally {
      if (!run.stale) this._loading = false;
    }
  }

  private _page(): number {
    const page = this._query.values['page'];
    return typeof page === 'number' ? page : 1;
  }

  /*
   * Every control writes the URL and nothing else. The controller hands the new
   * values back, `_applyQuery` sets the fields and the poll refreshes -- once.
   * A filter change also returns to page 1: page 2 of the failed rounds is not
   * page 2 of all of them, and keeping the number lands the reader past the end
   * of a different set.
   */
  private _setStatus(value: string): void {
    this._query.set({ status: value, page: 1 });
  }

  private _setLlmq(value: string): void {
    this._query.set({ llmq: value === '' ? null : value, page: 1 });
  }

  private _move(delta: number): void {
    this._query.set({ page: Math.max(1, this._page() + delta) });
  }

  override render(): TemplateResult {
    const from = this._total === 0 ? 0 : this._offset + 1;
    const to = Math.min(this._offset + PAGE_SIZE, this._total);

    return html`
      <div class="page-head">
        <div>
          <h1 class="page-title" tabindex="-1">DKG Rounds</h1>
          <div class="page-sub">
            Every scheduled round, including the ones that left no trace on the chain. A round with
            no commitment has no quorum hash — it is here because the schedule is reconstructed, not
            read back.
            ${this._profiles.some((p) => p.tracked && !p.formsOnV23Mainnet)
              ? html` Types tagged <span class="badge devnet">devnet-only</span> form on this devnet
                  and not on the v23 mainnet; their penalties have no counterpart there.`
              : nothing}
          </div>
        </div>
        <div class="filters">
          ${this._types.length > 1
            ? html`
                <div class="group">
                  ${['', ...this._types].map(
                    (t) => html`
                      <button
                        aria-pressed=${this._llmq === t ? 'true' : 'false'}
                        @click=${() => this._setLlmq(t)}
                      >
                        ${t === '' ? 'All types' : t}
                      </button>
                    `
                  )}
                </div>
              `
            : nothing}
          <div class="group">
            ${['', 'formed', 'failed', 'pending'].map(
              (s) => html`
                <button
                  aria-pressed=${this._status === s ? 'true' : 'false'}
                  @click=${() => this._setStatus(s)}
                >
                  ${s === '' ? 'All' : s}
                </button>
              `
            )}
          </div>
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}

      <section class="card">
        <div class="card-head">
          <h2 class="card-title">Rounds</h2>
          <div class="page-sub mono">${num(this._total)} recorded</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">Every scheduled DKG round, including the ones that left no trace on the chain, and what each punished.</caption>
              <thead>
                <tr>
                  <th scope="col">Round</th>
                  <th scope="col">Type</th>
                  <th scope="col" class="r">Height</th>
                  <th scope="col" class="c">Formed</th>
                  <th scope="col" class="r">Valid members</th>
                  <th scope="col" class="r">Health</th>
                  <th scope="col" class="r">Punished</th>
                  <th scope="col" class="r">Max possible ban</th>
                  <th scope="col" class="r">Streak</th>
                  <th scope="col">Who failed</th>
                  <th scope="col">Quorum hash</th>
                  <th scope="col" class="r">Seen</th>
                </tr>
              </thead>
              <tbody>
                ${this._loading && this._rounds.length === 0
                  ? html`<tr><td class="empty" colspan="12">Loading…</td></tr>`
                  : this._rounds.length === 0
                    ? html`<tr><td class="empty" colspan="12">No rounds match this filter.</td></tr>`
                    : this._rounds.map((r) => this._row(r))}
              </tbody>
            </table>
          </div>
          <div class="pager">
            <button ?disabled=${this._offset === 0} @click=${() => this._move(-1)}>Newer</button>
            <button ?disabled=${to >= this._total} @click=${() => this._move(1)}>Older</button>
            <span>${num(from)}–${num(to)} of ${num(this._total)}</span>
          </div>
        </div>
      </section>
    `;
  }

  /**
   * A round that punished only members who had just joined is measuring a mesh
   * that has not formed yet, not the profile. Without this the table reports it
   * as the profile's worst round on record.
   */
  private _warmup(r: QuorumRoundListItem) {
    const c = r.membershipChurn;
    if (!c.punishmentExplainedByJoiners) return nothing;
    const size =
      c.previousEffectiveSize !== null && c.previousEffectiveSize !== r.effectiveSize
        ? `, ${num(c.previousEffectiveSize)} → ${num(r.effectiveSize)} members`
        : '';
    return html`<span
      class="warmup"
      title=${`All ${num(c.punishedJoiners)} punished members joined since round ${num(
        c.previousExpectedHeight
      )}${size}. A member in its first session has no DKG mesh yet, so peers that never reached it vote it bad. This health is not comparable with the rounds before it.`}
      >mesh</span
    >`;
  }

  /** Experiment window and post-revive settling, from the row's own height. */
  private _badges(r: QuorumRoundListItem) {
    const badges = interventionsFor(
      { expectedHeight: r.expectedHeight, dkgInterval: r.dkgInterval },
      { runs: this._runs, reviveHeights: this._revives }
    );
    if (badges.length === 0) return nothing;
    return html`<span class="badges"
      >${badges.map((b) =>
        b.href === null
          ? html`<span class="badge ${b.kind}" title=${b.detail}>${b.label}</span>`
          : html`<a class="badge ${b.kind}" href=${b.href} title=${b.detail}>${b.label}</a>`
      )}</span
    >`;
  }

  /**
   * A type the v23 mainnet never forms, said beside its name. The reason is
   * the server registry's own sentence, so the tag cannot drift from the node.
   */
  private _devnetTag(r: QuorumRoundListItem) {
    if (r.formsOnV23Mainnet !== false) return nothing;
    const note = this._profiles.find((p) => p.llmqName === r.llmqName)?.mainnetNote;
    return html`<span
      class="badge devnet"
      title=${note ?? 'Forms on this devnet and not on the v23 mainnet.'}
      >devnet-only</span
    >`;
  }

  private _row(r: QuorumRoundListItem): TemplateResult {
    const who =
      r.failuresByOperator.length === 0
        ? r.status === 'failed'
          ? 'no commitment mined'
          : '—'
        : r.failuresByOperator
            .map((f) => `${f.operatorLabel ?? 'unattributed'} (${f.count})`)
            .join(', ');

    // The one distinction this site exists to make. See lib/roundVerdict.
    const verdict = roundVerdict({ status: r.status, punishedCount: r.punishedCount });

    return html`
      <tr>
        <td class="mono">
          <a href=${roundHref(r.roundKey)}>${r.roundKey}</a>${this._badges(r)}
        </td>
        <td class="mono">${r.llmqName}${this._devnetTag(r)}</td>
        <td class="r mono">${num(r.expectedHeight)}</td>
        <td class="c"><span class="pill ${verdict.tone}">${verdict.label}</span></td>
        <td class="r mono">
          ${r.numValidMembers === null ? '—' : `${num(r.numValidMembers)}/${num(r.effectiveSize)}`}
        </td>
        <td class="r mono">${ratio(r.healthRatio)}</td>
        <td class="r ${verdict.incident ? 'punished' : 'muted-cell'}">${verdict.punished}${this._warmup(r)}</td>
        <td class="r mono">${num(r.maxPossibleBan)}</td>
        <td class="r mono">${r.consecutiveFailures > 0 ? num(r.consecutiveFailures) : '—'}</td>
        <td>${who}</td>
        <td class="mono">${shortHash(r.quorumHash)}</td>
        <td class="r mono">${ago(r.detectedAt)}</td>
      </tr>
    `;
  }
}

customElements.define('dd-page-rounds', DdPageRounds);
