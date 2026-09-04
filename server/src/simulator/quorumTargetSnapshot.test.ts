import { describe, expect, it } from 'vitest';
import type { SimulationTargetSnapshot } from '../models/SimulationRun.js';
import {
  freezeQuorumTargetSnapshot,
  sameQuorumTargetSnapshot,
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
