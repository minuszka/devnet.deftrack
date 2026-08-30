/**
 * The DSL service-commitment schedule.
 *
 * The same load-bearing idea as the DKG schedule, applied to the Sentinel
 * Layer: the shadow phase's one open question is pool convergence, and the
 * measurement of it is the fraction of epoch boundaries that carry a
 * commitment. A boundary with no commitment is therefore the datum this
 * collector exists to record -- but unlike a DKG round, the verdict is
 * decidable the moment the boundary block is indexed: the commitment is a
 * transaction in that block or it is nowhere, with no RPC observation window
 * to age out of.
 *
 * The consensus rules this mirrors (evo/pose_service.cpp,
 * CheckPoSeServiceCommitmentTx): a commitment may appear only at a height
 * divisible by the epoch interval, it closes the observation epoch that ended
 * there (`nEpoch = height / interval - 1`), and the first one needs a whole
 * epoch observed after activation (`height - interval >= activationHeight`).
 *
 * Pure arithmetic, free of config, RPC and database imports.
 */

/** The epoch a height belongs to. */
export function epochOf(height: number, epochInterval: number): number {
  return Math.floor(height / epochInterval);
}

/** Whether a height is an epoch boundary -- the only place a commitment may be mined. */
export function isBoundary(height: number, epochInterval: number): boolean {
  return epochInterval > 0 && height % epochInterval === 0 && height > 0;
}

/** The observation epoch a commitment mined at `boundaryHeight` closes. */
export function closedEpochAt(boundaryHeight: number, epochInterval: number): number {
  return Math.floor(boundaryHeight / epochInterval) - 1;
}

/** The boundary at which observation epoch `epoch` closes. */
export function boundaryOf(epoch: number, epochInterval: number): number {
  return (epoch + 1) * epochInterval;
}

/**
 * The first boundary that may legally carry a commitment: the smallest
 * boundary height with a whole observed epoch behind it after activation.
 * With an epoch-aligned activation this is exactly one interval later.
 */
export function firstCommittableBoundary(activationHeight: number, epochInterval: number): number {
  const earliest = activationHeight + epochInterval;
  return Math.ceil(earliest / epochInterval) * epochInterval;
}

/**
 * Whether a boundary is one the chain could have committed at. Below the
 * first committable boundary a missing commitment is not evidence of
 * non-convergence -- no commitment could exist there, by rule. The same
 * distinction as the DKG schedule's formation gate: recording those as absent
 * would manufacture failures the rules made impossible.
 */
export function isCommittable(
  boundaryHeight: number,
  activationHeight: number,
  epochInterval: number
): boolean {
  if (activationHeight <= 0) return false; // collector disabled
  return (
    isBoundary(boundaryHeight, epochInterval) &&
    boundaryHeight >= firstCommittableBoundary(activationHeight, epochInterval)
  );
}

/**
 * Synthetic idempotency key, per observation epoch. The commitment's own txid
 * cannot serve: an epoch that never converged has no transaction, and those
 * rows are the point.
 */
export function epochKeyFor(epoch: number): string {
  return `dsl:${epoch}`;
}
