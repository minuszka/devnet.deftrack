import { trackedProfiles } from '../config/llmq.js';
import { isSchedulable, resolvedByHeight, roundKeyFor } from './dkgSchedule.js';
import { firstCommittableBoundary } from './dslSchedule.js';

export class IncompleteExperimentWindow extends Error {}

interface RoundObservation {
  roundKey: string;
  status: string;
  detailsComplete?: boolean;
}

/** Validate the very rows used for the frozen outcome, including gaps inside the window. */
export function assertScheduledObservations(
  from: number,
  to: number,
  dsl: { activationHeight: number; epochInterval: number },
  epochs: ReadonlyArray<{ boundaryHeight: number; status: string; missedCount: number | null }>,
  rounds: readonly RoundObservation[]
): void {
  if (dsl.activationHeight > 0 && dsl.epochInterval > 0) {
    const interval = dsl.epochInterval;
    const first = Math.max(firstCommittableBoundary(dsl.activationHeight, interval), Math.ceil(from / interval) * interval);
    const observed = new Map(epochs.map((epoch) => [epoch.boundaryHeight, epoch]));
    for (let height = first; height <= to; height += interval) {
      const epoch = observed.get(height);
      if (!epoch) throw new IncompleteExperimentWindow(`Missing Sentinel epoch at height ${height}`);
      if (epoch.status === 'committed' && epoch.missedCount == null) {
        throw new IncompleteExperimentWindow(`Missing Sentinel missed count at height ${height}`);
      }
    }
  }

  const byKey = new Map(rounds.map((round) => [round.roundKey, round]));
  for (const profile of trackedProfiles()) {
    const first = Math.ceil(from / profile.dkgInterval) * profile.dkgInterval;
    for (let height = first; height <= to; height += profile.dkgInterval) {
      if (!isSchedulable(height, profile.formationGateHeight, profile.formationEndHeight)) continue;
      const key = roundKeyFor(profile.llmqType, height, 0);
      const round = byKey.get(key);
      if (!round) throw new IncompleteExperimentWindow(`Missing quorum round ${key}`);
      // A round still inside its mining window at the cutoff may legitimately be pending.
      if (round.status === 'pending' && resolvedByHeight(height, profile.dkgMiningWindowEnd) <= to) {
        throw new IncompleteExperimentWindow(`Awaiting the result of quorum round ${key}`);
      }
      if (round.status === 'formed' && !round.detailsComplete) {
        throw new IncompleteExperimentWindow(`Awaiting member details for quorum round ${key}`);
      }
    }
  }
}
