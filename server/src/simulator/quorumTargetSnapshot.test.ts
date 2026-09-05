import { describe, expect, it } from 'vitest';
import type { SimulationTargetSnapshot } from '../models/SimulationRun.js';
import {
  formingQuorumForTargets,
  freezeQuorumTargetSnapshot,
  sameQuorumTargetSnapshot,
  unresolvableQuorumMembers,
  type QuorumMembershipObservation,
} from './quorumTargetSnapshot.js';

const HASH = (value: string) => value.padStart(64, '0');

function target(id: string): SimulationTargetSnapshot {
  return {
    targetId: `mn-${id}`,
    displayLabel: `MN ${id}`,
    operatorId: null,
    proTxHash: HASH(id),
    hostRef: `private-${id}`,
    unitRef: `defcond-${id}`,
    p2pPort: 19_800 + Number(id),
    role: 'masternode',
    network: 'devnet',
    capabilities: ['service-control'],
    expectedBuild: 'a'.repeat(64),
    capturedAtMs: 1_000,
    capturedAtHeight: 500,
  };
}

function observation(members: readonly string[]): QuorumMembershipObservation {
  return {
    llmqType: 100,
    llmqName: 'llmq_test',
    quorumHash: 'f'.repeat(64),
    expectedHeight: 480,
    quorumIndex: 0,
    capturedAtHeight: 500,
    memberProTxHashes: members,
  };
}

describe('identified quorum target snapshots', () => {
  it('resolves the same quorum identically when observers order its members differently', () => {
    const targets = [target('1'), target('2'), target('3')];
    const first = freezeQuorumTargetSnapshot({
      targets,
      current: observation([HASH('3'), HASH('1'), HASH('2')]),
      nextUnavailableReason: 'The next quorum has not formed.',
    });
    const second = freezeQuorumTargetSnapshot({
      targets: [...targets].reverse(),
      current: observation([HASH('2'), HASH('3'), HASH('1')]),
      nextUnavailableReason: 'The next quorum has not formed.',
    });

    expect(first.current?.memberProTxHashes).toEqual([HASH('1'), HASH('2'), HASH('3')]);
    expect(first.current?.memberTargetIds).toEqual(['mn-1', 'mn-2', 'mn-3']);
    expect(first.current?.resolutionFingerprint).toBe(second.current?.resolutionFingerprint);
    expect(sameQuorumTargetSnapshot(first, second)).toBe(true);

    const laterObservation = freezeQuorumTargetSnapshot({
      targets,
      current: { ...observation([HASH('1'), HASH('2'), HASH('3')]), capturedAtHeight: 501 },
      nextUnavailableReason: 'The next quorum has not formed.',
    });
    expect(laterObservation.current?.resolutionFingerprint).toBe(first.current?.resolutionFingerprint);
    expect(sameQuorumTargetSnapshot(first, laterObservation)).toBe(true);
  });

  it('can carry a separately observed next quorum but never substitutes a prediction', () => {
    const targets = [target('1'), target('2'), target('3')];
    const current = observation([HASH('1'), HASH('2')]);
    const next = { ...observation([HASH('2'), HASH('3')]), quorumHash: 'e'.repeat(64), expectedHeight: 504 };
    const frozen = freezeQuorumTargetSnapshot({ targets, current, next });
    expect(frozen.next).toMatchObject({ quorumHash: 'e'.repeat(64), memberTargetIds: ['mn-2', 'mn-3'] });
    expect(frozen.nextUnavailableReason).toBeNull();
    expect(() => freezeQuorumTargetSnapshot({
      targets, current, next, nextUnavailableReason: 'guessed',
    })).toThrow(/both resolved and unavailable/);
  });

  it('fails closed for a duplicate, malformed or unmapped member identity', () => {
    const targets = [target('1'), target('2')];
    expect(() => freezeQuorumTargetSnapshot({
      targets, current: observation([HASH('1'), HASH('1')]),
    })).toThrow(/duplicates/);
    expect(() => freezeQuorumTargetSnapshot({
      targets, current: observation([HASH('9')]),
    })).toThrow(/no unambiguous target mapping/);
    expect(() => freezeQuorumTargetSnapshot({
      targets, current: observation(['not-a-protx']),
    })).toThrow(/proTxHash is invalid/);
  });
});

describe('provenance of a next quorum', () => {
  const targets = [target('1'), target('2'), target('3')];
  const current = observation([HASH('1'), HASH('2')]);
  const forming = { ...observation([HASH('2'), HASH('3')]), quorumHash: 'e'.repeat(64), expectedHeight: 504 };

  it('carries where a member list came from without letting it into the identity', () => {
    const observed = freezeQuorumTargetSnapshot({ targets, current, next: forming });
    const computed = freezeQuorumTargetSnapshot({
      targets, current,
      next: { ...forming, provenance: 'computed', verifiedAgainstQuorumHash: 'F'.repeat(64) },
    });
    expect(observed.next).toMatchObject({ provenance: 'observed', verifiedAgainstQuorumHash: null });
    expect(computed.next).toMatchObject({ provenance: 'computed', verifiedAgainstQuorumHash: 'f'.repeat(64) });
    // Same quorum, same members: the fingerprint must not know how they were obtained.
    expect(computed.next?.resolutionFingerprint).toBe(observed.next?.resolutionFingerprint);
  });

  it('refuses a computed list that does not name the formed quorum it was checked against', () => {
    expect(() => freezeQuorumTargetSnapshot({
      targets, current, next: { ...forming, provenance: 'computed' },
    })).toThrow(/verified against/);
    expect(() => freezeQuorumTargetSnapshot({
      targets, current, next: { ...forming, provenance: 'computed', verifiedAgainstQuorumHash: 'short' },
    })).toThrow(/verification reference is invalid/);
  });

  it('compares snapshots by the current quorum only: the forming one changes by rule every cycle', () => {
    const drafted = freezeQuorumTargetSnapshot({ targets, current, next: forming });
    const oneCycleLater = freezeQuorumTargetSnapshot({
      targets, current, nextUnavailableReason: 'The next base block 528 is 3 block(s) away.',
    });
    expect(sameQuorumTargetSnapshot(drafted, oneCycleLater)).toBe(true);
    const differentCurrent = freezeQuorumTargetSnapshot({ targets, current: observation([HASH('1'), HASH('3')]), next: forming });
    expect(sameQuorumTargetSnapshot(drafted, differentCurrent)).toBe(false);
    expect(sameQuorumTargetSnapshot(drafted, null)).toBe(false);
  });

  it('turns a forming quorum with an unregistered member into an unavailable one, with the gap counted', () => {
    expect(unresolvableQuorumMembers(targets, [HASH('2'), HASH('9'), 'bad'])).toEqual([HASH('9'), 'bad']);
    const outside = { ...forming, memberProTxHashes: [HASH('2'), HASH('9')] };
    expect(formingQuorumForTargets(targets, outside, null)).toEqual({
      next: null,
      nextUnavailableReason: 'The forming llmq_test quorum at 504 has 1 member(s) outside the registered target population.',
    });
    expect(formingQuorumForTargets(targets, forming, null)).toEqual({ next: forming, nextUnavailableReason: null });
    expect(formingQuorumForTargets(targets, null, 'why')).toEqual({ next: null, nextUnavailableReason: 'why' });
    // and the frozen result of that degrade is a snapshot, not an exception
    const degraded = formingQuorumForTargets(targets, outside, null);
    expect(freezeQuorumTargetSnapshot({ targets, current, ...degraded }).next).toBeNull();
  });
});
