import type { QuorumRoundListItem } from '@devnet-deftrack/shared';

/**
 * Which of three situations the devnet is actually in.
 *
 * A wall of failed rounds means one of two opposite things, and the page was
 * showing them identically: with too few masternodes a DKG *cannot* form, which
 * is arithmetic rather than an incident; with enough masternodes a failed DKG
 * is the finding this whole project exists to catch. Reading 0.0% in red during
 * bootstrap trains the eye to ignore the number that matters later.
 */
export type NetworkState = 'bootstrap' | 'healthy' | 'investigate' | 'intervened';

export interface NetworkStatus {
  state: NetworkState;
  /** Short label for the state chip. */
  label: string;
  /** One sentence: what is true right now. */
  headline: string;
  /** One sentence: what it means, or what to look at next. */
  detail: string;

  enabledMasternodes: number;
  /** Fewest members a quorum of this profile can be built from. */
  minSize: number;
  /** enabledMasternodes / minSize, clamped to 1 -- the bootstrap progress bar. */
  progress: number;
  /** Height of the next round still inside its window, if one is scheduled. */
  nextRoundHeight: number | null;
  /** The declared intervention whose window covers the latest failed round, if any. */
  intervention: { runKey: string; title: string } | null;
}

export interface NetworkStateInput {
  enabledMasternodes: number | null;
  /** Profile minSize; null until a round has been recorded to read it from. */
  minSize: number | null;
  rounds: QuorumRoundListItem[];
  formedRounds: number;
  failedRounds: number;
}

export function classifyNetwork(input: NetworkStateInput): NetworkStatus {
  const enabled = input.enabledMasternodes ?? 0;
  const minSize = input.minSize ?? 0;
  const pending = input.rounds.find((r) => r.status === 'pending') ?? null;
  const nextRoundHeight = pending?.expectedHeight ?? null;
  const progress = minSize > 0 ? Math.min(1, enabled / minSize) : 0;

  // The latest failed round and, if a declared intervention covers its DKG
  // window, that run. Looked up first because every state carries it: a
  // failure explained by a rollout is not a finding about the network, and
  // the page said "inspect quorum connectivity" about exactly such a round
  // while its own Experiments record already held the explanation.
  const lastFailed = input.rounds.find((r) => r.status === 'failed') ?? null;
  const cover = lastFailed?.interventions?.[0] ?? null;
  const intervention = cover ? { runKey: cover.runKey, title: cover.title } : null;

  const base = { enabledMasternodes: enabled, minSize, progress, nextRoundHeight, intervention };

  // Not enough masternodes for a quorum to exist at all. Nothing here is a
  // fault, and a failed round in this state carries no evidence about anyone.
  if (minSize === 0 || enabled < minSize) {
    return {
      ...base,
      state: 'bootstrap',
      label: 'Bootstrap',
      headline:
        minSize === 0
          ? 'Waiting for the first DKG round to be recorded'
          : `${enabled} / ${minSize} minimum masternodes — a quorum is not yet possible`,
      detail:
        'Scheduled rounds are recorded as did not form. A failed DKG mines no commitment, so nobody is PoSe-punished.',
    };
  }

  // Enough masternodes exist, so a round that failed to form is a real finding
  // and not arithmetic.
  if (lastFailed && cover) {
    return {
      ...base,
      state: 'intervened',
      label: 'Explained',
      headline: `DKG failed at height ${lastFailed.expectedHeight} inside a declared intervention`,
      detail:
        'A restart inside a DKG window fails the round by construction and mines no commitment, so nobody is punished. The next round says whether the network is healthy. Covered by:',
    };
  }
  if (lastFailed) {
    return {
      ...base,
      state: 'investigate',
      label: 'Investigate',
      headline: `DKG failed at height ${lastFailed.expectedHeight} despite ${enabled} eligible masternodes`,
      detail: 'Enough members were available, so the failure is not a capacity limit — inspect quorum connectivity.',
    };
  }

  if (input.formedRounds === 0) {
    return {
      ...base,
      state: 'bootstrap',
      label: 'Bootstrap',
      headline: `${enabled} masternodes registered — waiting for the first DKG round to resolve`,
      detail:
        nextRoundHeight === null
          ? 'No round is scheduled inside the current window yet.'
          : `The next round is at height ${nextRoundHeight}.`,
    };
  }

  return {
    ...base,
    state: 'healthy',
    label: 'Healthy',
    headline: `Quorums are forming — ${input.formedRounds} formed, ${input.failedRounds} failed`,
    detail: 'Member failures, if any, are attributed by operator in the table below.',
  };
}
