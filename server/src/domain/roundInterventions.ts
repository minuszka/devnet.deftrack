/**
 * Which declared interventions cover a DKG round.
 *
 * The overview's "Investigate" state read a failed round as a finding about
 * the network, and on 2026-09-10 it said so about a round the explorer's own
 * Experiments record had already explained: a fleet-wide rolling restart whose
 * window held the round's whole DKG. The explorer knew both facts and never
 * joined them. This is the join, done by height and nothing else: a round's
 * DKG occupies the blocks from its base to the next base, and a run with an
 * intervention covers the round when the run's window meets that span. A run
 * still open reaches the tip. Observation runs (no intervention) never cover
 * anything: watching is not a cause.
 */
export interface InterventionRun {
  runKey: string;
  title: string;
  kind: string;
  status: string;
  startHeight: number;
  endHeight: number | null;
}

export interface RoundIntervention {
  runKey: string;
  title: string;
  kind: string;
  status: string;
}

export function interventionsCovering(
  round: { expectedHeight: number; dkgInterval: number },
  runs: readonly InterventionRun[]
): RoundIntervention[] {
  const from = round.expectedHeight;
  // Half-open: the next cycle's base block belongs to the next round.
  const to = round.expectedHeight + round.dkgInterval - 1;
  return runs
    .filter((run) => run.startHeight <= to && (run.endHeight ?? Number.POSITIVE_INFINITY) >= from)
    .sort((a, b) => a.startHeight - b.startHeight)
    .map(({ runKey, title, kind, status }) => ({ runKey, title, kind, status }));
}
