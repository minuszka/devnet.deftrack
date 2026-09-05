import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { QuorumRoundListItem } from '@devnet-deftrack/shared';
import { api } from '../lib/api.js';
import { ago, num, ratio, shortHash } from '../lib/format.js';
import { roundVerdict } from '../lib/roundVerdict.js';
import { baseStyles, cardStyles, pageStyles, tableStyles } from '../styles/shared.js';

const PAGE_SIZE = 50;
const REFRESH_MS = 60_000;

export class DdPageRounds extends LitElement {
  static override properties = {
    _rounds: { state: true },
    _total: { state: true },
    _offset: { state: true },
    _status: { state: true },
    _llmq: { state: true },
    _types: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  private _rounds: QuorumRoundListItem[] = [];
  private _total = 0;
  private _offset = 0;
  private _status = '';
  private _llmq = '';
  /**
   * Quorum types discovered in the data rather than listed here, so the filter
   * cannot fall out of step with the profiles the collector tracks. Names are
   * accumulated and never dropped: filtering to one type must not make the
   * others disappear from the control that switches back to them.
   */
  private _types: string[] = [];
  private _error = '';
  private _loading = true;
  private _timer: number | null = null;

  static override styles = [
    baseStyles,
    cardStyles,
    tableStyles,
    pageStyles,
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
      .filters {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
      }
      .group {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      button {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        background: var(--surface-2);
        color: var(--ink-2);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: 5px 11px;
        cursor: pointer;
      }
      button:hover:not(:disabled) {
        color: var(--ink);
        border-color: var(--line-strong);
      }
      button[aria-pressed='true'] {
        color: var(--accent);
        border-color: var(--accent);
        background: var(--accent-wash);
      }
      button:disabled {
        opacity: 0.4;
        cursor: default;
      }
      .pager {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border-top: 1px solid var(--line-soft);
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
        color: var(--ink-3);
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
      const params: { limit: number; offset: number; status?: string; llmqName?: string } = {
        limit: PAGE_SIZE,
        offset: this._offset,
      };
      if (this._status) params.status = this._status;
      if (this._llmq) params.llmqName = this._llmq;
      const p = await api.rounds(params);
      this._rounds = p.items;
      this._total = p.total;
      const known = new Set([...this._types, ...p.items.map((r) => r.llmqName)]);
      this._types = [...known].sort();
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    } finally {
      this._loading = false;
    }
  }

  private _setStatus(value: string): void {
    this._status = value;
    this._offset = 0;
    void this._load();
  }

  private _setLlmq(value: string): void {
    this._llmq = value;
    this._offset = 0;
    void this._load();
  }

  private _move(delta: number): void {
    this._offset = Math.max(0, this._offset + delta * PAGE_SIZE);
    void this._load();
  }

  override render(): TemplateResult {
    const from = this._total === 0 ? 0 : this._offset + 1;
    const to = Math.min(this._offset + PAGE_SIZE, this._total);

    return html`
      <div class="page-head">
        <div>
          <div class="page-title">DKG Rounds</div>
          <div class="page-sub">
            Every scheduled round, including the ones that left no trace on the chain. A round with
            no commitment has no quorum hash — it is here because the schedule is reconstructed, not
            read back.
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
          <div class="card-title">Rounds</div>
          <div class="page-sub mono">${num(this._total)} recorded</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <thead>
                <tr>
                  <th>Round</th>
                  <th>Type</th>
                  <th class="r">Height</th>
                  <th class="c">Formed</th>
                  <th class="r">Valid members</th>
                  <th class="r">Health</th>
                  <th class="r">Punished</th>
                  <th class="r">Max possible ban</th>
                  <th class="r">Streak</th>
                  <th>Who failed</th>
                  <th>Quorum hash</th>
                  <th class="r">Seen</th>
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
        <td class="mono">${r.roundKey}</td>
        <td class="mono">${r.llmqName}</td>
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
