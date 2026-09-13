import { LitElement, css, html, type TemplateResult } from 'lit';
import { baseStyles, cardStyles, pageStyles } from '../styles/shared.js';

/**
 * How the figures are measured -- short, and only what the code does.
 *
 * Every definition here was read from where the number is computed, and the
 * comment beside each section says where, so it can be re-checked when that
 * code changes. A glossary that drifts from the arithmetic is worse than none:
 * it is believed.
 *
 * Each section says three things: what the number is, what sample it is taken
 * over, and what it cannot tell you. The third is the one that stops a true
 * number from answering a question nobody asked.
 */
export class DdPageMethodology extends LitElement {
  static override styles = [
    baseStyles,
    cardStyles,
    pageStyles,
    css`
      .sections {
        display: grid;
        gap: var(--sp-4);
        max-width: 78ch;
      }
      .card-body p {
        margin: 0 0 var(--sp-3);
        line-height: 1.6;
      }
      .card-body p:last-child {
        margin-bottom: 0;
      }
      dl {
        display: grid;
        gap: var(--sp-2);
        margin: 0;
      }
      dt {
        font-family: var(--font-mono);
        font-size: var(--fs-xs);
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ink-3);
        margin-top: var(--sp-2);
      }
      dd {
        margin: 0;
        line-height: 1.6;
      }
      code {
        font-family: var(--font-mono);
        font-size: 0.95em;
      }
    `,
  ];

  override render(): TemplateResult {
    return html`
      <div class="page">
        <div class="page-head">
          <div>
            <h1 class="page-title" tabindex="-1">How we measure</h1>
            <div class="page-sub">
              What each headline figure is, what it is taken over, and what it cannot tell you. A devnet number
              read without its sample is easy to misread.
            </div>
          </div>
        </div>

        <div class="sections">
          ${this._dkg()} ${this._pose()} ${this._dsl()} ${this._hhi()} ${this._gini()}
        </div>
      </div>
    `;
  }

  // server/src/domain/roundStats.ts (formationRate, medianHealthRatio);
  // server/src/services/quorumRound.service.ts (punishedCount);
  // Core src/rpc/quorums.cpp (healthRatio, two decimals).
  private _dkg(): TemplateResult {
    return html`<section class="card" id="dkg">
      <div class="card-head"><h2 class="card-title">DKG rounds</h2></div>
      <div class="card-body">
        <dl>
          <dt>What it is</dt>
          <dd>
            Every round the schedule says should have happened, for each quorum profile — including rounds that
            left no trace on the chain. A failed DKG mines no commitment, so those rounds are reconstructed from
            the schedule rather than read back.
          </dd>
          <dd>
            <b>Formation rate</b> is formed ÷ (formed + failed). Rounds still inside their mining window
            (<i>pending</i>) and rounds that could not form for lack of masternodes (<i>impossible</i>) are left
            out of both sides.
          </dd>
          <dd>
            <b>Health ratio</b> is reported by the node for each formed quorum: valid members ÷ the quorum's
            actual member count, rounded to two decimals. <b>Median health</b> is the median of those ratios over
            the formed rounds in the window.
          </dd>
          <dd>
            <b>Punished</b> is the members of a formed quorum that were not counted valid. A failed round punishes
            nobody: with no commitment mined there is nothing to punish from.
          </dd>
          <dt>Sample</dt>
          <dd>
            The rounds of one profile inside the window shown — on the front page, the last 7 days of the profile
            signing ChainLocks at the tip. Never blended across profiles: several schedules interleave on this
            devnet, and a figure over all of them describes none.
          </dd>
          <dt>What it cannot tell you</dt>
          <dd>
            A formation rate says nothing about health, and health says nothing about how many rounds formed —
            read the two together. A round older than the node could still describe when its profile was first
            collected is left out rather than counted as failed.
          </dd>
        </dl>
      </div>
    </section>`;
  }

  // CLAUDE.md "The masternode count is a consensus input" (deterministicmns.cpp:328-340, :810/:815, :1131)
  // and "PoSe penalty decay is not an event".
  private _pose(): TemplateResult {
    return html`<section class="card" id="pose">
      <div class="card-head"><h2 class="card-title">PoSe</h2></div>
      <div class="card-body">
        <dl>
          <dt>What it is</dt>
          <dd>
            Proof-of-Service penalties from DKG rounds, as the node applies them. A masternode left out of a formed
            quorum's valid members is penalised; penalties fall by one every block; a masternode is banned when its penalty
            reaches the ceiling, <code>max(100, registered masternodes)</code>. The penalty for one exclusion is
            66 % of that ceiling, rounded down — so one exclusion never bans on its own, and two bans only if the
            second lands before the first has decayed far enough (within 48 blocks at 152 registered).
          </dd>
          <dd>The Sentinel Layer's own reward suspension and ban are separate from this, and shown on its page.</dd>
          <dt>Sample</dt>
          <dd>
            Every change the node reports between consecutive blocks. Only increases are recorded as events: the
            decay touches every penalised masternode on every block, and recording it would bury the rest.
          </dd>
          <dt>What it cannot tell you</dt>
          <dd>
            Why a member was excluded — an outage, a lost connection and a slow machine all look the same from
            here. And a devnet count is pessimistic for mainnet: this devnet punishes on quorum profiles that never
            form on mainnet, so read a devnet penalty count together with the profile it came from.
          </dd>
        </dl>
      </div>
    </section>`;
  }

  // server/src/routes/v1/dsl.v1.routes.ts (convergenceRate, totalMissedBits, totalUnobservedBits);
  // CLAUDE.md "A Sentinel epoch is decided by one announcement at its start".
  private _dsl(): TemplateResult {
    return html`<section class="card" id="dsl">
      <div class="card-head"><h2 class="card-title">Sentinel Layer (DSL)</h2></div>
      <div class="card-body">
        <dl>
          <dt>What it is</dt>
          <dd>
            At each epoch boundary the masternode pool commits a verdict on the masternodes: heard from, or missed
            — and, since commitment format version 2, no verdict either way. An epoch is
            <i>committed</i> when that commitment is on the chain and <i>absent</i> when none was recorded.
            <b>Convergence rate</b> is committed ÷ (committed + absent). <b>Missed</b> counts the masternodes a
            committed epoch marked as missed; <b>unobserved</b> counts those it reached no verdict on — which is
            not the same as "online".
          </dd>
          <dt>Sample</dt>
          <dd>Every epoch boundary the explorer has indexed, since the layer activated.</dd>
          <dt>What it cannot tell you</dt>
          <dd>
            Whether a masternode stayed up through the epoch. A masternode announces itself once, at the start of
            an epoch, and the verdict is set by that one announcement — an outage that begins after it is not
            seen in that epoch at all.
          </dd>
        </dl>
      </div>
    </section>`;
  }

  // server/src/domain/stakingHealth.ts (hhi, byHost.hhi); server/src/routes/v1/staking.v1.routes.ts (default window 500).
  private _hhi(): TemplateResult {
    return html`<section class="card" id="hhi">
      <div class="card-head"><h2 class="card-title">Staking concentration: HHI</h2></div>
      <div class="card-body">
        <dl>
          <dt>What it is</dt>
          <dd>
            The Herfindahl–Hirschman index of block production: the share of the window's blocks each staker
            produced, squared, and summed (a block that names no payout is left out of the shares). With <i>n</i> stakers producing equally it is 1 ÷ <i>n</i>; with one producer it is
            1. A staker here is a payout script. The by-machine figure is the same sum over hosts, and it is withheld
            while any block's payout script belongs to no known host.
          </dd>
          <dt>Sample</dt>
          <dd>The most recent blocks, 500 unless the Staking page is set to another window.</dd>
          <dt>What it cannot tell you</dt>
          <dd>
            Who is behind a script. One operator with several payout scripts counts as several stakers, and a low
            index over scripts can hide a high one over people.
          </dd>
        </dl>
      </div>
    </section>`;
  }

  // server/src/domain/stakingHealth.ts (gini).
  private _gini(): TemplateResult {
    return html`<section class="card" id="gini">
      <div class="card-head"><h2 class="card-title">Staking inequality: Gini</h2></div>
      <div class="card-body">
        <dl>
          <dt>What it is</dt>
          <dd>
            The Gini coefficient of blocks produced per staker in the same window: 0 when every staker produced the
            same number, approaching 1 as one staker produces nearly all of them. It is not shown when only one
            staker produced anything — there is no distribution to measure, and 0 would claim perfect equality.
          </dd>
          <dt>Sample</dt>
          <dd>The same window as the HHI, over the stakers that produced at least one block in it.</dd>
          <dt>What it cannot tell you</dt>
          <dd>
            How many stakers there are. Two equal stakers and two hundred equal stakers both have a Gini of 0 — read
            it with the staker count and the HHI.
          </dd>
        </dl>
      </div>
    </section>`;
  }
}

customElements.define('dd-page-methodology', DdPageMethodology);
