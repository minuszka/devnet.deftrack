import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { QuorumRoundDetail } from '@devnet-deftrack/shared';
import { errorMessage, isAbortError } from '../lib/errors.js';
import { ago, num, ratio, shortHash, utc } from '../lib/format.js';
import { PollController, type PollRun } from '../lib/poll.js';
import { groupByOperator } from '../lib/roundMembers.js';
import { roundSentence, roundVerdict } from '../lib/roundVerdict.js';
import { roundHref } from '../lib/router.js';
import { baseStyles, cardStyles, pageStyles, pagerStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';

const REFRESH_MS = 60_000;

/**
 * One DKG round, in full.
 *
 * The server has served `/quorum-rounds/:id` -- members, `valid` flags, churn
 * and the profile parameters as they stood -- since the collector was written,
 * and nothing on the site linked to it. So a round row could say that six
 * members failed with no way to ask which six, which is the only question that
 * follows from the row: this project attributes member failures to operators,
 * and an aggregate the reader cannot open is not attribution.
 */
export class DdPageRound extends LitElement {
  static override properties = {
    param: {},
    _round: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  param: string | null = null;
  private _round: QuorumRoundDetail | null = null;
  private _error = '';
  private _loading = true;

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
      /* The verdict, in words, above everything numeric. A reader who does not
         know the palette is told by the sentence, not by the colour. */
      .verdict {
        padding: var(--sp-3) var(--sp-4);
        border-radius: var(--radius-md);
        border: 1px solid var(--line);
        background: var(--surface-2);
        font-size: var(--fs-md);
        line-height: 1.5;
        margin: 0 0 var(--sp-4);
      }
      .verdict.incident {
        border-color: color-mix(in srgb, var(--warn) 45%, transparent);
        background: var(--warn-wash);
        color: var(--warn);
      }
      .verdict.quiet {
        color: var(--ink-2);
      }

      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 6px 20px;
        margin: 0;
        padding: 12px 14px;
        font-size: var(--fs-sm);
      }
      dt {
        color: var(--ink-3);
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
      }
      dd {
        margin: 0;
        font-family: var(--font-mono);
        word-break: break-all;
      }

      .opgroup {
        font-weight: 700;
        background: var(--surface-2);
      }
      .opgroup td,
      .opgroup th {
        border-top: 1px solid var(--line);
      }
      /* The group header is a row header, not a column one: left, with the
         column it names. */
      .opgroup th {
        text-align: left;
        font-weight: 700;
      }
      td.invalid {
        color: var(--warn);
        font-weight: 700;
      }
      td.ok {
        color: var(--ink-3);
      }
      .stack {
        margin-top: var(--sp-4);
      }
      .back {
        font-family: var(--font-mono);
        font-size: var(--fs-sm);
        margin-top: var(--sp-4);
      }
    `,
  ];

  override updated(changed: Map<string, unknown>): void {
    if (changed.has('param') && changed.get('param') !== undefined) this._poll.refresh();
  }

  private async _load(run: PollRun): Promise<void> {
    if (!this.param) return;
    try {
      const round = await run.api.round(this.param);
      if (run.stale) return;
      this._round = round;
      this._error = '';
    } catch (error) {
      if (run.stale || isAbortError(error)) return;
      this._round = null;
      this._error = errorMessage(error);
    } finally {
      if (!run.stale) this._loading = false;
    }
  }

  override render(): TemplateResult {
    if (this._error) {
      return html`
        <div class="page-head"><div class="page-title">Round</div></div>
        <div class="err">${this._error}</div>
        <p class="back"><a href="/rounds">&larr; All rounds</a></p>
      `;
    }

    const r = this._round;
    if (!r) return html`<div class="note">${this._loading ? 'Loading…' : 'No such round.'}</div>`;

    const verdict = roundVerdict({ status: r.status, punishedCount: r.punishedCount });

    return html`
      <div class="page-head">
        <div>
          <div class="page-title">
            Round ${num(r.expectedHeight)} <span class="dim">${r.llmqName}</span>
          </div>
          <div class="page-sub mono">${r.roundKey}</div>
        </div>
        <span class="pill ${verdict.tone}">${verdict.label}</span>
      </div>

      <p class="verdict ${verdict.incident ? 'incident' : 'quiet'}">
        ${roundSentence({
          status: r.status,
          punishedCount: r.punishedCount,
          effectiveSize: r.effectiveSize,
          maxPossibleBan: r.maxPossibleBan,
        })}
      </p>

      <div class="tiles">
        <dd-stat
          label="Valid members"
          .value=${r.numValidMembers === null
            ? '—'
            : `${num(r.numValidMembers)}/${num(r.effectiveSize)}`}
          sub="counted good by the mined commitment"
        ></dd-stat>
        <dd-stat
          label="Health"
          .value=${ratio(r.healthRatio)}
          sub="valid members over the drawn size"
        ></dd-stat>
        <dd-stat
          label="Punished"
          .value=${verdict.punished}
          tone=${verdict.incident ? 'warn' : ''}
          sub=${r.formed
            ? 'members the mined commitment left out'
            : 'no commitment was mined, so nobody was punished'}
        ></dd-stat>
        <dd-stat
          label="Max possible ban"
          .value=${num(r.maxPossibleBan)}
          sub="drawn size − minSize: the ceiling for one round"
        ></dd-stat>
      </div>

      <div class="grid cols-2 stack">${this._identity(r)} ${this._profile(r)}</div>

      ${this._churn(r)} ${this._members(r)}

      <p class="back"><a href="/rounds">&larr; All rounds</a></p>
    `;
  }

  private _identity(r: QuorumRoundDetail): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head"><div class="card-title">Round</div></div>
        <div class="card-body flush">
          <dl>
            <dt>type</dt>
            <dd>${r.llmqName} <span class="subtle">(${num(r.llmqType)})</span></dd>
            <dt>index</dt>
            <dd>${num(r.quorumIndex)}</dd>
            <dt>expected height</dt>
            <dd>${num(r.expectedHeight)}</dd>
            <dt>quorum hash</dt>
            <dd>
              ${r.quorumHash
                ? html`<span title=${r.quorumHash}>${r.quorumHash}</span>`
                : html`<span class="subtle">
                    none — a round that did not form mines no commitment
                  </span>`}
            </dd>
            <dt>mined in</dt>
            <dd>
              ${r.minedBlockHash
                ? html`<a href=${`/block/${r.minedBlockHash}`}
                    >${shortHash(r.minedBlockHash, 12, 10)}</a
                  >`
                : html`<span class="subtle">—</span>`}
            </dd>
            <dt>recorded</dt>
            <dd>${utc(r.detectedAt)} <span class="subtle">(${ago(r.detectedAt)})</span></dd>
          </dl>
        </div>
      </section>
    `;
  }

  /**
   * The profile as it stood for this round, snapshotted onto the document
   * rather than read from today's config: this devnet has already changed these
   * numbers under a running chain, and a round read against the wrong ones is a
   * round judged by a rule the node was not applying.
   */
  private _profile(r: QuorumRoundDetail): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head"><div class="card-title">Profile at this round</div></div>
        <div class="card-body flush">
          <dl>
            <dt>size</dt>
            <dd>${num(r.size)}</dd>
            <dt>drawn at</dt>
            <dd>
              ${num(r.effectiveSize)}
              ${r.effectiveSize !== null && r.effectiveSize < r.size
                ? html`<span class="subtle">
                    — fewer masternodes existed than the profile asks for
                  </span>`
                : nothing}
            </dd>
            <dt>minSize</dt>
            <dd>${num(r.minSize)}</dd>
            <dt>threshold</dt>
            <dd>${num(r.threshold)}</dd>
            <dt>interval</dt>
            <dd>${num(r.dkgInterval)} blocks</dd>
            <dt>failure streak</dt>
            <dd>
              ${r.consecutiveFailures > 0
                ? html`${num(r.consecutiveFailures)}
                    <span class="subtle">consecutive, this profile</span>`
                : html`<span class="subtle">none</span>`}
            </dd>
          </dl>
        </div>
      </section>
    `;
  }

  private _churn(r: QuorumRoundDetail): TemplateResult {
    const c = r.membershipChurn;
    const previousKey = `${r.llmqType}:${c.previousExpectedHeight}:${r.quorumIndex}`;

    return html`
      <section class="card stack">
        <div class="card-head">
          <div class="card-title">Membership since the round before</div>
          <div class="page-sub mono">
            <a href=${roundHref(previousKey)}>round ${num(c.previousExpectedHeight)} &rarr;</a>
          </div>
        </div>
        <div class="card-body">
          ${c.punishmentExplainedByJoiners
            ? html`<div class="note" style="margin-bottom: var(--sp-3)">
                Every member this round punished had joined since round
                ${num(c.previousExpectedHeight)}. A member in its first session has no DKG mesh
                yet, so peers that never reached it vote it bad — this round's health is not
                comparable with the rounds before it.
              </div>`
            : nothing}
          <dl style="padding: 0">
            <dt>previous size</dt>
            <dd>${num(c.previousEffectiveSize)}</dd>
            <dt>change</dt>
            <dd>
              ${c.membershipDelta === null
                ? '—'
                : `${c.membershipDelta > 0 ? '+' : ''}${num(c.membershipDelta)}`}
            </dd>
            <dt>joined</dt>
            <dd>${num(c.joined)}</dd>
            <dt>left</dt>
            <dd>${num(c.left)}</dd>
            <dt>punished joiners</dt>
            <dd>${num(c.punishedJoiners)}</dd>
          </dl>
          ${c.previousEffectiveSize === null
            ? html`<p class="page-sub">
                No member list survives for the preceding round — a round that does not form mines
                no commitment, so there is nothing to compare against.
              </p>`
            : nothing}
        </div>
      </section>
    `;
  }

  private _members(r: QuorumRoundDetail): TemplateResult {
    if (r.members.length === 0) {
      return html`
        <section class="card stack">
          <div class="card-head"><div class="card-title">Members</div></div>
          <div class="card-body">
            <p class="page-sub">
              This round has no member list. Membership is read from the mined commitment, and a
              round that did not form has none — which is also why it punished nobody.
            </p>
          </div>
        </section>
      `;
    }

    const groups = groupByOperator(r.members);

    return html`
      <section class="card stack">
        <div class="card-head">
          <div class="card-title">Members by operator</div>
          <div class="page-sub mono">
            ${num(r.members.length)} members · ${num(groups.length)} operators
          </div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">
                Every member of round ${num(r.expectedHeight)}, grouped by operator, with the
                members the commitment marked invalid listed first.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Operator</th>
                  <th scope="col">Host</th>
                  <th scope="col">proTxHash</th>
                  <th scope="col" class="c">Verdict</th>
                </tr>
              </thead>
              <tbody>
                ${groups.map(
                  (g) => html`
                    <tr class="opgroup">
                      <th scope="rowgroup">
                        ${g.operatorLabel ?? html`<span class="subtle">unattributed</span>`}
                      </th>
                      <td colspan="2" class="subtle">${num(g.total)} members in this round</td>
                      <td class="c ${g.invalid > 0 ? 'invalid' : 'ok'}">
                        ${g.invalid > 0 ? `${num(g.invalid)} failed` : 'all valid'}
                      </td>
                    </tr>
                    ${g.members.map(
                      (m) => html`
                        <tr>
                          <td></td>
                          <td class="mono">${m.service ?? '—'}</td>
                          <td class="mono" title=${m.proTxHash}>${shortHash(m.proTxHash, 10, 8)}</td>
                          <td class="c ${m.valid ? 'ok' : 'invalid'}">
                            ${m.valid ? 'valid' : 'invalid'}
                          </td>
                        </tr>
                      `
                    )}
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

customElements.define('dd-page-round', DdPageRound);
