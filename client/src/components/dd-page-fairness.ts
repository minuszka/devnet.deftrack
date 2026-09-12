import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { LlmqProfileView } from '@devnet-deftrack/shared';
import type { SelectionFairness } from '../lib/api.js';
import { primaryProfile, type PrimaryProfile } from '../lib/primaryProfile.js';
import {
  LLMQ_ALL,
  LLMQ_PATTERN,
  QueryStateController,
  llmqApiName,
  type ParamSpec,
} from '../lib/queryState.js';
import { errorMessage, isAbortError } from '../lib/errors.js';
import { PollController, type PollRun } from '../lib/poll.js';
import { num, ratio } from '../lib/format.js';
import { baseStyles, cardStyles, controlStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';

const REFRESH_MS = 60_000;
const WINDOWS = [20, 50, 100, 250];
/** The explicit "every schedule at once" choice, never a silent default. */
const AGGREGATE = LLMQ_ALL;

/**
 * What this view's URL carries.
 *
 * `llmq` absent is not "every profile" here -- it is "the one signing at the
 * tip", resolved from the chain. That distinction is the whole of F05: a link
 * with no profile means "whatever is current", and `llmq=all` means somebody
 * chose the aggregate. Writing the resolved name into the URL would freeze a
 * link that was meant to follow the tip.
 */
const QUERY: Record<string, ParamSpec> = {
  llmq: { kind: 'optional', pattern: LLMQ_PATTERN },
  rounds: { kind: 'choice', values: WINDOWS, fallback: 50 },
};

export class DdPageFairness extends LitElement {
  static override properties = {
    _d: { state: true },
    _rounds: { state: true },
    _error: { state: true },
    _llmq: { state: true },
    _profiles: { state: true },
    _resolved: { state: true },
  };

  private _d: SelectionFairness | null = null;
  private _rounds = 50;
  private _error = '';
  /**
   * Which profile these figures are about.
   *
   * `null` means the question has not been settled yet -- not "all of them".
   * The page used to ask the server with no profile at all, and the server does
   * not filter without one, so every number here was computed across five
   * interleaved schedules while the screen said nothing about it. Blending
   * interleaved schedules is the one reading this project's own notes forbid.
   */
  private _llmq: string | null = null;
  private _profiles: LlmqProfileView[] = [];
  /** How the current profile was arrived at: resolved, chosen, or not yet. */
  private _resolved: PrimaryProfile | null = null;
  /** The address bar; the only thing that reacts to a filter change. */
  private readonly _query = new QueryStateController(this, QUERY, (values) => {
    this._applyQuery(values);
    this._d = null;
    this._poll.refresh();
  });

  override connectedCallback(): void {
    this._applyQuery(this._query.values);
    super.connectedCallback();
  }

  /**
   * URL -> component state.
   *
   * `null` stays null: it means the profile has not been chosen and is to be
   * resolved from the chain, which is a different state from any choice.
   */
  private _applyQuery(values: Record<string, string | number | null>): void {
    const llmq = values['llmq'];
    this._llmq = typeof llmq === 'string' ? llmq : null;
    const rounds = values['rounds'];
    if (typeof rounds === 'number') this._rounds = rounds;
  }
  /** Interval, visibility, cancellation and the sequence guard, in one place. */
  private readonly _poll = new PollController(this, {
    intervalMs: REFRESH_MS,
    load: (run) => this._load(run),
  });

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    controlStyles,
    pageStyles,
    css`
      .caveat {
        padding: 10px 14px;
        border-top: 1px solid var(--line-soft);
        color: var(--ink-3);
        font-size: var(--fs-sm);
        line-height: 1.55;
      }
      .bar {
        display: inline-block;
        width: 90px;
        height: 8px;
        background: var(--surface-3);
        border: 1px solid var(--line);
        vertical-align: middle;
        margin-right: 8px;
      }
      .bar > i {
        display: block;
        height: 100%;
        background: var(--accent-dim);
      }
      .bar.over > i {
        background: var(--warn);
      }
      .bar.under > i {
        background: var(--info, var(--accent-dim));
      }
      .none {
        color: var(--ink-3);
      }
      .bad {
        color: var(--crit);
        font-weight: 600;
      }
    `,
  ];

  private async _load(run: PollRun): Promise<void> {
    try {
      // The registry, once: it changes with the binary, not with the tip.
      if (this._profiles.length === 0) {
        const profiles = await run.api.llmqProfiles().catch(() => null);
        if (run.stale) return;
        if (profiles) this._profiles = profiles.items.filter((p) => p.tracked);
      }

      /*
       * If the profile cannot be resolved the page asks for an explicit choice
       * rather than quietly aggregating: a number covering five schedules looks
       * like an answer without being one.
       */
      const resolving = this._resolveProfile(run);
      if (this._llmq === null) {
        // Awaited only when its answer decides what to ask for.
        await resolving;
        if (run.stale) return;
      } else {
        // Under an explicit choice it decides nothing but the "at the tip"
        // marker, so the figures do not wait two more round trips for it.
        void resolving;
      }

      if (this._effective() === null) {
        // Undecided, and deliberately not loaded. Nothing is shown rather than
        // something that describes a sample nobody asked for.
        this._d = null;
        this._error = '';
        return;
      }

      const d = await run.api.selectionFairness(this._rounds, llmqApiName(this._effective()));
      if (run.stale) return;
      this._d = d;
      this._error = '';
    } catch (error) {
      if (run.stale || isAbortError(error)) return;
      this._error = errorMessage(error);
    }
  }

  /**
   * Which profile is signing ChainLocks at the tip -- the same rule the front
   * page uses, from the same two reads.
   *
   * Read on every tick, not once. It used to be guarded by
   * `_resolved === null`, and `{ known: false }` is not null either, so BOTH
   * answers latched for the life of the component: one 503 on the ChainLock
   * report meant no fairness figure was ever requested again, and a tip
   * crossing the activation height latched the other way -- the link that
   * exists to follow the tip went on asking about the profile that had stopped
   * signing. A full reload or a manual choice was the only way out of either.
   *
   * The profile registry is still read once, and that cache is the justified
   * one: profiles change with the binary, not with the tip. This pair IS the
   * tip.
   */
  private async _resolveProfile(run: PollRun): Promise<void> {
    const [clocks, health] = await Promise.all([
      run.api.chainlocks(50).catch(() => null),
      run.api.health().catch(() => null),
    ]);
    if (run.stale) return;
    this._resolved = primaryProfile({
      signers: clocks?.signers,
      tipHeight: health?.chainTip,
    });
  }

  /**
   * The profile these figures are about: what the URL asked for, or the one
   * signing at the tip when it asked for nothing.
   *
   * Resolved on every read rather than latched into `_llmq` once. Latching it
   * meant that going Back to a URL with no profile left the page holding the
   * previously resolved name -- or, worse, holding null with the resolution
   * already done, so it asked a question it had already answered.
   */
  private _effective(): string | null {
    if (this._llmq !== null) return this._llmq;
    return this._resolved?.known === true ? this._resolved.llmqName : null;
  }

  private _setWindow(n: number): void {
    this._query.set({ rounds: n });
  }

  private _setProfile(value: string): void {
    this._query.set({ llmq: value });
  }

  override render(): TemplateResult {
    const d = this._d;
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Selection fairness</div>
          <div class="page-sub">
            Who the selection reaches, and who fails once reached — two different questions, and only
            the second is a fault.
          </div>
        </div>
        <div class="seg">
          ${WINDOWS.map(
            (n) => html`
              <button
                class=${this._rounds === n ? 'on' : ''}
                aria-pressed=${this._rounds === n ? 'true' : 'false'}
                @click=${() => this._setWindow(n)}
              >
                ${num(n)}
              </button>
            `
          )}
        </div>
      </div>

      ${this._profileControl()}
      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
      ${this._effective() === null
        ? html`<div class="note" role="status">
            The signing profile could not be determined
            ${this._resolved?.known === false && this._resolved.reason === 'no-signers'
              ? '(no ChainLock report)'
              : '(no chain tip)'},
            so nothing is shown until a profile is chosen above. These figures are about one LLMQ
            schedule; computed across all of them at once they would look like an answer without
            being one.
          </div>`
        : !d
        ? html`<div class="note">Loading…</div>`
        : d.roundsConsidered === 0
          ? html`<div class="note">
              No round has formed yet, so there is no member list to count. Selection can only be
              measured on rounds that produced a commitment.
            </div>`
          : html`${this._tiles(d)} ${this._hosts(d)} ${this._nodes(d)} ${this._missing(d)}`}
    `;
  }

  /**
   * Which schedule these figures describe, said on the page and selectable.
   *
   * The server supports the filter and always did; the page simply never sent
   * it, so the answer was every interleaved schedule at once with nothing
   * saying so. The aggregate is still available -- as a choice somebody makes,
   * under a name that says what it is.
   */
  private _profileControl(): TemplateResult {
    const options = this._profiles.map((p) => p.llmqName);
    const resolvedName = this._resolved?.known === true ? this._resolved.llmqName : null;
    if (!options.includes(AGGREGATE)) options.unshift(AGGREGATE);
    return html`
      <div class="filters">
        <div class="group" role="group" aria-label="LLMQ profile">
          ${options.map(
            (name) => html`
              <button
                aria-pressed=${this._effective() === name ? 'true' : 'false'}
                @click=${() => this._setProfile(name)}
              >
                ${name === AGGREGATE ? 'All profiles · aggregate' : name}
                ${name !== AGGREGATE && name === resolvedName ? ' · at the tip' : ''}
              </button>
            `
          )}
        </div>
      </div>
    `;
  }

  private _tiles(d: SelectionFairness): TemplateResult {
    /*
     * From the server's own total, computed before the node list was truncated
     * to 200 rows. Summing the rows on screen described a slice and printed it
     * as the network's figure. A server that does not send it gets an em dash:
     * the slice is not a fallback, it is a different number.
     */
    const totals = d.totals ?? null;
    const truncated = totals !== null && totals.nodesCounted > d.nodes.length;

    return html`
      <section class="tiles">
        <dd-stat
          label="Formed rounds"
          value=${num(d.roundsConsidered)}
          sub=${`${d.llmqName ?? 'all profiles'}${
            d.heightRange ? ` · heights ${num(d.heightRange.from)}–${num(d.heightRange.to)}` : ''
          }`}
        ></dd-stat>
        <dd-stat
          label="Expected selection"
          value=${d.expectedSelectionRate === null ? '—' : ratio(d.expectedSelectionRate)}
          sub="what chance alone would give each node"
        ></dd-stat>
        <dd-stat
          label="Never selected"
          value=${num(d.neverSelectedCount)}
          sub="masternodes no round ever chose"
          tone=${d.neverSelectedCount > 0 ? 'warn' : 'good'}
        ></dd-stat>
        <dd-stat
          label="Invalid members"
          value=${totals === null ? '—' : num(totals.timesInvalid)}
          sub=${totals === null
            ? 'not reported by this server'
            : totals.worstInvalidRate === null
              ? 'no node met the sample floor'
              : `worst node ${ratio(totals.worstInvalidRate)}${truncated ? `, over all ${num(totals.nodesCounted)}` : ''}`}
          tone=${totals === null ? '' : totals.timesInvalid > 0 ? 'crit' : 'good'}
        ></dd-stat>
      </section>
    `;
  }

  /** Selection rate against chance, as a bar the eye can compare across rows. */
  private _rateBar(rate: number, expected: number | null): TemplateResult {
    const ref = expected && expected > 0 ? expected : 1;
    const relative = Math.min(2, rate / ref);
    const cls = expected === null ? '' : relative > 1.15 ? 'over' : relative < 0.85 ? 'under' : '';
    return html`<span class="bar ${cls}"><i style="width:${(relative / 2) * 100}%"></i></span>`;
  }

  private _hosts(d: SelectionFairness): TemplateResult {
    const maxSelected = Math.max(...d.hosts.map((h) => h.timesSelected), 1);
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">By host</div>
          <div class="page-sub mono">${num(d.hosts.length)} hosts</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">Quorum selection counted by host rather than by masternode.</caption>
              <thead>
                <tr>
                  <th scope="col">Host</th>
                  <!-- Two numbers, because they are two facts. "Masternodes"
                       used to print the count the window happened to select,
                       so a host with seven registered nodes of which five were
                       drawn read as a host with five. -->
                  <th scope="col" class="r">Registered nodes</th>
                  <th scope="col" class="r">Selected nodes</th>
                  <th scope="col" class="r">Selections</th>
                  <th scope="col">Share of the busiest</th>
                  <th scope="col" class="r">Invalid</th>
                  <th scope="col" class="r">Failure rate</th>
                </tr>
              </thead>
              <tbody>
                ${d.hosts.map(
                  (h) => html`
                    <tr>
                      <td class="mono">${h.host}</td>
                      <!-- Undefined on a server built before the field, and
                           null for a host no longer registered. Neither is
                           zero, and neither may be printed as zero. -->
                      <td class="r mono">
                        ${h.currentRegisteredNodes === undefined || h.currentRegisteredNodes === null
                          ? '—'
                          : num(h.currentRegisteredNodes)}
                      </td>
                      <td class="r mono">${num(h.nodes)}</td>
                      <td class="r mono">${num(h.timesSelected)}</td>
                      <td>
                        <span class="bar"
                          ><i style="width:${((h.timesSelected / maxSelected) * 100).toFixed(0)}%"></i
                        ></span>
                        <span class="mono">${ratio(h.timesSelected / maxSelected)}</span>
                      </td>
                      <td class="r mono ${h.timesInvalid > 0 ? 'bad' : ''}">${num(h.timesInvalid)}</td>
                      <td class="r mono">
                        ${h.invalidRate === null
                          ? html`<span class="none">too few</span>`
                          : ratio(h.invalidRate)}
                      </td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          </div>
          <div class="caveat">
            Ten masternodes on one machine are not ten independent participants, so the same rounds
            are counted per host as well as per node. An uneven column here is a property of the
            selection, not a fault of anyone.
          </div>
        </div>
      </section>
    `;
  }

  private _nodes(d: SelectionFairness): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">By masternode</div>
          <div class="page-sub mono">worst first · ${num(d.nodes.length)} shown</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">How often each masternode was selected into a quorum, and how often it was marked invalid.</caption>
              <thead>
                <tr>
                  <th scope="col">proTxHash</th>
                  <th scope="col">Host</th>
                  <th scope="col">Operator</th>
                  <th scope="col" class="r">Selections</th>
                  <th scope="col">Against chance</th>
                  <th scope="col" class="r">Invalid</th>
                  <th scope="col" class="r">Failure rate</th>
                </tr>
              </thead>
              <tbody>
                ${d.nodes.slice(0, 40).map(
                  (n) => html`
                    <tr>
                      <td class="mono">${n.proTxHash}…</td>
                      <td class="mono">${n.host ?? '—'}</td>
                      <td>${n.operatorLabel ?? '—'}</td>
                      <td class="r mono">${num(n.timesSelected)}</td>
                      <td>
                        ${this._rateBar(n.selectionRate, d.expectedSelectionRate)}
                        <span class="mono">${ratio(n.selectionRate)}</span>
                      </td>
                      <td class="r mono ${n.timesInvalid > 0 ? 'bad' : ''}">${num(n.timesInvalid)}</td>
                      <td class="r mono">
                        ${n.invalidRate === null
                          ? html`<span class="none">too few</span>`
                          : ratio(n.invalidRate)}
                      </td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          </div>
          <div class="caveat">
            A failure rate is withheld below ${num(d.minSamples)} selections: one failure out of two
            is two data points, not fifty percent, and printing that beside a node with hundreds of
            selections invites exactly the wrong comparison. The bar compares each node against
            ${d.expectedSelectionRate === null ? 'chance' : ratio(d.expectedSelectionRate)}, the rate
            chance alone would give it.
          </div>
        </div>
      </section>
    `;
  }

  private _missing(d: SelectionFairness): TemplateResult | typeof nothing {
    if (d.neverSelectedCount === 0) return nothing;
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Never selected</div>
          <div class="page-sub mono">${num(d.neverSelectedCount)}</div>
        </div>
        <div class="card-body">
          <div class="mono" style="font-size: var(--fs-sm);line-height:1.9">
            ${d.neverSelected.map((h) => html`${h}… `)}
          </div>
        </div>
        <div class="caveat">
          These masternodes are active but no round in this window chose them. They appear in no
          member list, so any table built only from members would omit them entirely — being passed
          over is the finding, and it is invisible unless stated.
        </div>
      </section>
    `;
  }
}

customElements.define('dd-page-fairness', DdPageFairness);
