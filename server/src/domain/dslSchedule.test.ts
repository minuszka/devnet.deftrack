import { describe, expect, it } from 'vitest';
import {
  boundaryOf,
  closedEpochAt,
  epochKeyFor,
  epochOf,
  firstCommittableBoundary,
  isBoundary,
  isCommittable,
} from './dslSchedule.js';

/**
 * Pinned against the consensus rules in evo/pose_service.cpp
 * (CheckPoSeServiceCommitmentTx), not against the implementation: a commitment
 * only at a boundary, closing the epoch that ended there, and only once a
 * whole epoch has been observed after activation.
 */
describe('DSL commitment schedule', () => {
  const interval = 24; // nDSLEpochInterval on this devnet
  const activation = 6240; // dslactivationheight, epoch-aligned (260 * 24)

  it('assigns heights to epochs the way the node does', () => {
    expect(epochOf(6240, interval)).toBe(260);
    expect(epochOf(6263, interval)).toBe(260);
    expect(epochOf(6264, interval)).toBe(261);
  });

  it('recognises boundaries and only boundaries', () => {
    expect(isBoundary(6240, interval)).toBe(true);
    expect(isBoundary(6264, interval)).toBe(true);
    expect(isBoundary(6265, interval)).toBe(false);
    expect(isBoundary(0, interval)).toBe(false); // genesis is not a boundary
  });

  it('a commitment closes the epoch that ended at its boundary', () => {
    // the node: nEpoch == height / interval - 1
    expect(closedEpochAt(6264, interval)).toBe(260);
    expect(boundaryOf(260, interval)).toBe(6264);
    // round-trip across a range
    for (let epoch = 260; epoch < 270; epoch++) {
      expect(closedEpochAt(boundaryOf(epoch, interval), interval)).toBe(epoch);
    }
  });

  it('the first committable boundary needs a whole observed epoch', () => {
    // epoch-aligned activation: exactly one interval later
    expect(firstCommittableBoundary(activation, interval)).toBe(6264);
    // a non-aligned activation rounds up to the next boundary with a full
    // epoch behind it
    expect(firstCommittableBoundary(6241, interval)).toBe(6288);
  });

  it('below the first committable boundary, absence is not evidence', () => {
    expect(isCommittable(6240, activation, interval)).toBe(false); // activation itself
    expect(isCommittable(6264, activation, interval)).toBe(true); // first legal slot
    expect(isCommittable(6265, activation, interval)).toBe(false); // not a boundary
    expect(isCommittable(6288, activation, interval)).toBe(true);
  });

  it('a zero activation height disables the collector', () => {
    expect(isCommittable(6264, 0, interval)).toBe(false);
  });

  it('keys are per observation epoch', () => {
    expect(epochKeyFor(260)).toBe('dsl:260');
  });
});
