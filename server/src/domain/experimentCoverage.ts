import { trackedProfiles } from '../config/llmq.js';
import type { UnobservedObservation } from '../models/ExperimentRun.js';
import { isSchedulable, observationFloor, resolvedByHeight, retiredObservationHeight, roundKeyFor } from './dkgSchedule.js';
import { firstCommittableBoundary } from './dslSchedule.js';

/** Evidence that is still on its way. The close waits for it. */
export class IncompleteExperimentWindow extends Error {}

/**
 * Evidence that no collector will ever write. Waiting cannot fill the gap, so
 * the close publishes the window only when the operator accepts the gaps, and
 * the frozen outcome names each one.
 */
export class UnobservableExperimentWindow extends Error {
  constructor(readonly unobserved: readonly UnobservedObservation[]) {
    const shown = unobserved.slice(0, 5).map(describeUnobserved).join('; ');
    super(
      `${unobserved.length} scheduled observation(s) in the window can no longer be collected: ` +
        `${shown}${unobserved.length > 5 ? '; ...' : ''}`
    );
  }
}

export function describeUnobserved(u: UnobservedObservation): string {
  if (u.kind === 'sentinel-epoch') {
    return u.reason === 'missing'
      ? `Missing Sentinel epoch at height ${u.height}`
      : `Missing Sentinel missed count at height ${u.height}`;
  }
  if (u.reason === 'missing') return `Missing quorum round ${u.roundKey}`;
  if (u.reason === 'undecided') return `Quorum round ${u.roundKey} was never decided`;
  return `Missing member details for quorum round ${u.roundKey}`;
}

interface RoundObservation {
  roundKey: string;
  status: string;
  detailsComplete?: boolean;
}

/**
 * Validate the very rows used for the frozen outcome, including gaps inside the window.
 *
 * A gap the collectors can still fill throws IncompleteExperimentWindow. A gap
 * they cannot fill throws UnobservableExperimentWindow unless the operator has
 * accepted it; then it is returned for the outcome to carry. Which one a gap is
 * follows from how each collector works, measured at the node's tip:
 *
 * - A Sentinel epoch is written in the same pass that indexes its boundary
 *   block, before the block cursor moves, and the close has already required
 *   the cursor to reach the window's end. A missing epoch or missed count
 *   therefore stays missing.
 * - The quorum collector plans no round below `observationFloor` and stops
 *   refreshing a decided round there, so a round missing there, or formed
 *   without member details, stays that way.
 * - A pending round is asked about on every poll, but it can only be decided
 *   while `quorum listextended` still reports its height. Below the floor it
 *   stays pending. A retired profile reads that RPC at its last formation
 *   height, so its floor is taken there.
 */
export function assertScheduledObservations(
  from: number,
  to: number,
  dsl: { activationHeight: number; epochInterval: number },
  epochs: ReadonlyArray<{ boundaryHeight: number; status: string; missedCount: number | null }>,
  rounds: readonly RoundObservation[],
  reach: { nodeTip: number; acceptUnobserved: boolean }
): UnobservedObservation[] {
  const unobserved: UnobservedObservation[] = [];

  if (dsl.activationHeight > 0 && dsl.epochInterval > 0) {
    const interval = dsl.epochInterval;
    const first = Math.max(firstCommittableBoundary(dsl.activationHeight, interval), Math.ceil(from / interval) * interval);
    const observed = new Map(epochs.map((epoch) => [epoch.boundaryHeight, epoch]));
    for (let height = first; height <= to; height += interval) {
      const epoch = observed.get(height);
      if (!epoch) unobserved.push({ kind: 'sentinel-epoch', height, reason: 'missing' });
      else if (epoch.status === 'committed' && epoch.missedCount == null) {
        unobserved.push({ kind: 'sentinel-epoch', height, reason: 'missed-count' });
      }
    }
  }

  const byKey = new Map(rounds.map((round) => [round.roundKey, round]));
  for (const profile of trackedProfiles()) {
    const floor = observationFloor(reach.nodeTip, profile.dkgInterval, profile.signingActiveQuorumCount);
    const readAt = retiredObservationHeight(reach.nodeTip, profile.formationEndHeight) ?? reach.nodeTip;
    const pendingFloor = observationFloor(readAt, profile.dkgInterval, profile.signingActiveQuorumCount);
    const first = Math.ceil(from / profile.dkgInterval) * profile.dkgInterval;
    for (let height = first; height <= to; height += profile.dkgInterval) {
      if (!isSchedulable(height, profile.formationGateHeight, profile.formationEndHeight)) continue;
      const key = roundKeyFor(profile.llmqType, height, 0);
      const round = byKey.get(key);
      if (!round) {
        if (height >= floor) throw new IncompleteExperimentWindow(`Missing quorum round ${key}`);
        unobserved.push({ kind: 'quorum-round', height, roundKey: key, reason: 'missing' });
        continue;
      }
      // A round still inside its mining window at the cutoff may legitimately be pending.
      if (round.status === 'pending' && resolvedByHeight(height, profile.dkgMiningWindowEnd) <= to) {
        if (height >= pendingFloor) throw new IncompleteExperimentWindow(`Awaiting the result of quorum round ${key}`);
        unobserved.push({ kind: 'quorum-round', height, roundKey: key, reason: 'undecided' });
      }
      if (round.status === 'formed' && !round.detailsComplete) {
        if (height >= floor) throw new IncompleteExperimentWindow(`Awaiting member details for quorum round ${key}`);
        unobserved.push({ kind: 'quorum-round', height, roundKey: key, reason: 'member-details' });
      }
    }
  }

  if (unobserved.length > 0 && !reach.acceptUnobserved) throw new UnobservableExperimentWindow(unobserved);
  return unobserved;
}
