import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import type { PeerPropagation } from '../lib/api.js';
import { errorMessage, isAbortError } from '../lib/errors.js';
import { PollController, type PollRun } from '../lib/poll.js';
import { ago, num } from '../lib/format.js';
import { baseStyles, cardStyles, controlStyles, pageStyles, tableStyles } from '../styles/shared.js';
import './dd-stat.js';

const REFRESH_MS = 30_000;

const ms = (v: number | null): string => (v === null ? '—' : `${Math.round(v)} ms`);

export class DdPagePeers extends LitElement {
  static override properties = {
    _d: { state: true },
    _topic: { state: true },
    _error: { state: true },
  };

  private _d: PeerPropagation | null = null;
  private _topic: 'block' | 'chainlock' = 'block';
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
    controlStyles,
    pageStyles,
    css`
      .bad {
        color: var(--crit);
        font-weight: 600;
      }
      .noise {
        color: var(--ink-3);
      }
      .real {
        color: var(--warn);
        font-weight: 600;
      }
      .miss {
        color: var(--crit);
        font-weight: 600;
      }
      .caveat {
        padding: 10px 14px;
        border-top: 1px solid var(--line-soft);
        color: var(--ink-3);
        font-size: var(--fs-sm);
        line-height: 1.5;
      }
    `,
  ];

  private async _load(run: PollRun): Promise<void> {
    try {
      const d = await run.api.peerPropagation(this._topic, 30);
      if (run.stale) return;
      this._d = d;
      this._error = '';
    } catch (error) {
      if (run.stale || isAbortError(error)) return;
      this._error = errorMessage(error);
    }
  }

  private _setTopic(t: 'block' | 'chainlock'): void {
    this._topic = t;
    this._poll.refresh();
  }

  /** The build most hosts agree on; anything else is drift worth seeing. */
  private _commonBuild(d: PeerPropagation): string {
    const counts = new Map<string, number>();
    for (const h of d.hosts) {
      if (h.nodeBuild) counts.set(h.nodeBuild, (counts.get(h.nodeBuild) ?? 0) + 1);
    }
    let best = '';
    let bestCount = 0;
    for (const [build, n] of counts) {
      if (n > bestCount) [best, bestCount] = [build, n];
    }
    return best;
  }

  override render(): TemplateResult {
    const d = this._d;
    return html`
      <div class="page-head">
        <div>
          <div class="page-title">Vantage points</div>
          <div class="page-sub">
            The same event, seen from every host. One node cannot tell a network problem from its
            own — this is what makes that difference visible.
          </div>
        </div>
        <div class="seg">
          <button
            class=${this._topic === 'block' ? 'on' : ''}
            aria-pressed=${this._topic === 'block' ? 'true' : 'false'}
            @click=${() => this._setTopic('block')}
          >
            Blocks
          </button>
          <button
            class=${this._topic === 'chainlock' ? 'on' : ''}
            aria-pressed=${this._topic === 'chainlock' ? 'true' : 'false'}
            @click=${() => this._setTopic('chainlock')}
          >
            ChainLocks
          </button>
        </div>
      </div>

      ${this._error ? html`<div class="err">${this._error}</div>` : nothing}
      ${!d
        ? html`<div class="note">Loading…</div>`
        : html`${this._tiles(d)} ${this._hosts(d)} ${this._laggards(d)} ${this._events(d)}`}
    `;
  }

  private _tiles(d: PeerPropagation): TemplateResult {
    const real = d.events.filter((e) => !e.withinNoise);
    const spreads = real.map((e) => e.spreadMs ?? 0).sort((a, b) => a - b);
    const median = spreads.length ? spreads[Math.floor(spreads.length / 2)]! : null;
    const incomplete = d.events.filter((e) => e.missingHosts.length > 0).length;

    return html`
      <section class="tiles">
        <dd-stat
          label="Reporting hosts"
          value=${num(d.hostsReporting.length)}
          sub="vantage points comparing the same events"
          tone=${d.hostsReporting.length > 1 ? 'good' : 'warn'}
        ></dd-stat>
        <dd-stat
          label="Median spread"
          value=${median === null ? '—' : ms(median)}
          sub="${num(real.length)} of ${num(d.events.length)} above the error bar"
        ></dd-stat>
        <dd-stat
          label="Incomplete events"
          value=${num(incomplete)}
          sub="some host never reported them"
          tone=${incomplete > 0 ? 'crit' : 'good'}
        ></dd-stat>
        <dd-stat
          label="Consistently late"
          value=${d.laggards.length === 0 ? '—' : (d.laggards[0]?.host ?? '—')}
          sub=${d.laggards.length === 0
            ? 'not enough samples yet'
            : `mean ${ms(d.laggards[0]!.meanDelayMs)} behind`}
          tone=${d.laggards.length > 0 && d.laggards[0]!.lastPlaceShare > 0.5 ? 'warn' : ''}
        ></dd-stat>
      </section>
    `;
  }

  private _hosts(d: PeerPropagation): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head"><div class="card-title">Host connectivity</div></div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">Each vantage point: peers, height, ping and the daemon build it reports.</caption>
              <thead>
                <tr>
                  <th scope="col">Host</th>
                  <th scope="col" class="r">Peers</th>
                  <th scope="col" class="r">Inbound</th>
                  <th scope="col" class="r">MNAUTH</th>
                  <th scope="col" class="r">Median ping</th>
                  <th scope="col" class="r">Height</th>
                  <th scope="col" class="r">Clock</th>
                  <th scope="col">Build</th>
                  <th scope="col" class="r">Reported</th>
                </tr>
              </thead>
              <tbody>
                ${d.hosts.length === 0
                  ? html`<tr><td class="empty" colspan="9">No host has reported connectivity yet.</td></tr>`
                  : d.hosts.map(
                      (h) => html`
                        <tr>
                          <td class="mono">${h.host}</td>
                          <td class="r mono">${num(h.peers)}</td>
                          <td class="r mono">${num(h.inbound)}</td>
                          <td class="r mono">${num(h.verifiedMasternodes)}</td>
                          <td class="r mono">${ms(h.medianPingMs)}</td>
                          <td class="r mono">${h.height === null ? '—' : num(h.height)}</td>
                          <td class="r mono">${h.clockOffsetMs === null ? 'unknown' : ms(h.clockOffsetMs)}</td>
                          <td class="mono ${h.nodeBuild && h.nodeBuild !== this._commonBuild(d) ? 'bad' : ''}">
                            ${h.nodeBuild || 'unknown'}
                          </td>
                          <td class="r mono">${ago(h.reportedAt)}</td>
                        </tr>
                      `
                    )}
              </tbody>
            </table>
          </div>
          <div class="caveat">
            <strong>Build</strong> fingerprints the daemon binary each host is running. The version
            string cannot answer that question — two builds carrying different consensus code report
            the same one, which is how the fleet once ran a binary three days older than the seed's
            with nothing on any screen to say so. A host disagreeing with the majority is marked.
            <br /><br />
            <strong>MNAUTH</strong> counts peers authenticated as masternodes — the quorum mesh, as
            distinct from ordinary connections. A quorum member with none of these is isolated from
            exactly the peers a DKG needs.
          </div>
        </div>
      </section>
    `;
  }

  private _laggards(d: PeerPropagation): TemplateResult | typeof nothing {
    if (d.laggards.length === 0) return nothing;
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Consistently behind</div>
          <div class="page-sub mono">min 5 samples</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">Hosts that repeatedly see an event last.</caption>
              <thead>
                <tr><th scope="col">Host</th><th scope="col" class="r">Samples</th><th scope="col" class="r">Mean delay</th><th scope="col" class="r">Last place</th></tr>
              </thead>
              <tbody>
                ${d.laggards.map(
                  (l) => html`
                    <tr>
                      <td class="mono">${l.host}</td>
                      <td class="r mono">${num(l.samples)}</td>
                      <td class="r mono">${ms(l.meanDelayMs)}</td>
                      <td class="r mono ${l.lastPlaceShare > 0.5 ? 'real' : ''}">
                        ${Math.round(l.lastPlaceShare * 100)}%
                      </td>
                    </tr>
                  `
                )}
              </tbody>
            </table>
          </div>
          <div class="caveat">
            One late event is weather. The same host last on most of them is the finding — and it is
            invisible from a single vantage point.
          </div>
        </div>
      </section>
    `;
  }

  private _events(d: PeerPropagation): TemplateResult {
    return html`
      <section class="card">
        <div class="card-head">
          <div class="card-title">Recent ${this._topic === 'block' ? 'blocks' : 'ChainLocks'}</div>
          <div class="page-sub mono">${num(d.events.length)} compared</div>
        </div>
        <div class="card-body flush">
          <div class="twrap">
            <table>
              <caption class="sr-only">Recent propagation events and how long each took to reach every reporting host.</caption>
              <thead>
                <tr>
                  <th scope="col" class="r">Height</th>
                  <th scope="col" class="r">Hosts</th>
                  <th scope="col" class="r">Spread</th>
                  <th scope="col" class="r">Median delay</th>
                  <th scope="col" class="r">Error bar</th>
                  <th scope="col">First</th>
                  <th scope="col">Last</th>
                  <th scope="col">Missing</th>
                </tr>
              </thead>
              <tbody>
                ${d.events.length === 0
                  ? html`<tr><td class="empty" colspan="8">Nothing compared yet.</td></tr>`
                  : d.events.map(
                      (e) => html`
                        <tr>
                          <td class="r mono">${e.height === null ? '—' : num(e.height)}</td>
                          <td class="r mono">${num(e.hosts)}/${num(d.hostsReporting.length)}</td>
                          <td class="r mono ${e.withinNoise ? 'noise' : 'real'}">
                            ${ms(e.spreadMs)}${e.withinNoise ? ' (noise)' : ''}
                          </td>
                          <td class="r mono">${ms(e.medianDelayMs)}</td>
                          <td class="r mono">
                            ${e.uncertaintyIsLowerBound ? '≥' : '±'}${ms(e.uncertaintyMs)}
                          </td>
                          <td class="mono">${e.firstHost ?? '—'}</td>
                          <td class="mono">${e.lastHost ?? '—'}</td>
                          <td class="mono ${e.missingHosts.length > 0 ? 'miss' : ''}">
                            ${e.missingHosts.length === 0 ? '—' : e.missingHosts.join(', ')}
                          </td>
                        </tr>
                      `
                    )}
              </tbody>
            </table>
          </div>
          <div class="caveat">
            A spread below the error bar is reported as <em>noise</em>, not as a result: it cannot be
            told apart from clock offset and poll resolution. Clock offsets are recorded, never
            subtracted — correcting for them would claim a precision NTP does not guarantee, and
            <span class="mono">≥</span> marks an event where some host could not read its own clock
            at all.
          </div>
        </div>
      </section>
    `;
  }
}

customElements.define('dd-page-peers', DdPagePeers);
