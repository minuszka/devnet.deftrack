import { LitElement, html, nothing, type TemplateResult } from 'lit';
import type { OperatorReliabilityRow } from '@devnet-deftrack/shared';
import { api } from '../lib/api.js';
import { num, ratio } from '../lib/format.js';
import { baseStyles, cardStyles, pageStyles, tableStyles } from '../styles/shared.js';

const REFRESH_MS = 60_000;

export class DdPageOperators extends LitElement {
  static override properties = {
    _rows: { state: true },
    _rounds: { state: true },
    _error: { state: true },
    _loading: { state: true },
  };

  private _rows: OperatorReliabilityRow[] = [];
  private _rounds = 0;
  private _error = '';
  private _loading = true;
  private _timer: number | null = null;

  static override styles = [baseStyles, cardStyles, tableStyles, pageStyles];

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
      const d = await api.operatorReliability(24 * 7);
      this._rows = d.operators;
      this._rounds = d.roundsConsidered;
      this._error = '';
    } catch (error) {
      this._error = error instanceof Error ? error.message : String(error);
    } finally {
      this._loading = false;
    }
  }

  override render(): TemplateResult {
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Operator reliability</div>
          <div class="page-sub">
            What separates a protocol problem from an infrastructure one. Computed over formed
            rounds only: a round that never formed has no member list, so nobody can be held to
            account for it.
          </div>
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}

      <section class="card">
        <div class="card-head">
          <div class="card-title">Operators</div>
          <div class="page-sub mono">7 days · ${num(this._rounds)} formed rounds</div>
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
                ${this._loading && this._rows.length === 0
                  ? html`<tr><td class="empty" colspan="8">Loading…</td></tr>`
                  : this._rows.length === 0
                    ? html`<tr>
                        <td class="empty" colspan="8">
                          No operator mapping loaded yet. Attribution needs proTxHash → operator;
                          without it the data cannot tell a failing protocol from one operator's
                          machine, and every failure reads as <span class="mono">unattributed</span>.
                        </td>
                      </tr>`
                    : this._rows.map(
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

customElements.define('dd-page-operators', DdPageOperators);
