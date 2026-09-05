import { describe, expect, it } from 'vitest';
import type { QuorumRoundListItem } from '@devnet-deftrack/shared';
import { classifyNetwork, type NetworkStateInput } from './networkState.js';

function round(
  status: QuorumRoundListItem['status'],
  expectedHeight: number
): QuorumRoundListItem {
  return {
    roundKey: `7:${expectedHeight}:0`,
    llmqName: 'llmq_defcon',
    llmqType: 7,
    quorumIndex: 0,
    expectedHeight,
    status,
    formed: status === 'formed',
    quorumHash: status === 'formed' ? 'abc' : null,
    minedBlockHash: null,
    size: 60,
    minSize: 44,
    threshold: 41,
    dkgInterval: 24,
    effectiveSize: status === 'formed' ? 60 : null,
    numValidMembers: status === 'formed' ? 60 : null,
    healthRatio: status === 'formed' ? 1 : null,
    punishedCount: 0,
    maxPossibleBan: status === 'formed' ? 16 : null,
    consecutiveFailures: 0,
    membershipChurn: {
      previousExpectedHeight: expectedHeight - 24,
      previousEffectiveSize: 60,
      membershipDelta: 0,
      joined: 0,
      left: 0,
      punishedJoiners: 0,
      punishmentExplainedByJoiners: false,
    },
    invalidMemberCount: 0,
    failuresByOperator: [],
    detectedAt: new Date().toISOString(),
  };
}

function input(over: Partial<NetworkStateInput> = {}): NetworkStateInput {
  return {
    enabledMasternodes: 152,
    minSize: 44,
    rounds: [],
    formedRounds: 10,
    failedRounds: 0,
    ...over,
  };
}

/**
 * The decision table. The reason this function exists at all: a wall of failed
 * rounds means two opposite things, and the page showed them identically. Below
 * minSize a quorum *cannot* form and no failure carries evidence about anyone;
 * above it, a failure is the finding this project exists to catch.
 */
describe('classifyNetwork', () => {
  it('calls it bootstrap while no quorum is arithmetically possible', () => {
    const s = classifyNetwork(input({ enabledMasternodes: 43, minSize: 44, rounds: [round('failed', 100)] }));
    expect(s.state).toBe('bootstrap');
    expect(s.detail).toContain('nobody is PoSe-punished');
    expect(s.progress).toBeCloseTo(43 / 44, 5);
  });

  it('is still bootstrap when no round has been recorded to read minSize from', () => {
    const s = classifyNetwork(input({ minSize: null, enabledMasternodes: 152 }));
    expect(s.state).toBe('bootstrap');
    expect(s.progress).toBe(0);
    expect(s.headline).toContain('first DKG round');
  });

  // The boundary, both sides of it.
  it('turns a failure into a finding the moment enough members exist', () => {
    const below = classifyNetwork(
      input({ enabledMasternodes: 43, minSize: 44, rounds: [round('failed', 100)] })
    );
    const at = classifyNetwork(
      input({ enabledMasternodes: 44, minSize: 44, rounds: [round('failed', 100)] })
    );
    expect(below.state).toBe('bootstrap');
    expect(at.state).toBe('investigate');
    expect(at.headline).toContain('100');
  });

  it('reports healthy when rounds are forming and none failed', () => {
    const s = classifyNetwork(input({ rounds: [round('formed', 200)], formedRounds: 4 }));
    expect(s.state).toBe('healthy');
    expect(s.label).toBe('Healthy');
  });

  it('waits rather than declaring health before the first round resolves', () => {
    const s = classifyNetwork(input({ formedRounds: 0, rounds: [round('pending', 300)] }));
    expect(s.state).toBe('bootstrap');
    expect(s.nextRoundHeight).toBe(300);
    expect(s.detail).toContain('300');
  });

  it('names the next scheduled round when one is inside the window', () => {
    const s = classifyNetwork(input({ rounds: [round('pending', 7464), round('formed', 7440)] }));
    expect(s.nextRoundHeight).toBe(7464);
  });

  it('treats a missing masternode count as zero rather than as unknown health', () => {
    const s = classifyNetwork(input({ enabledMasternodes: null }));
    expect(s.state).toBe('bootstrap');
    expect(s.enabledMasternodes).toBe(0);
  });

  it('clamps the bootstrap progress bar at full', () => {
    expect(classifyNetwork(input({ enabledMasternodes: 152, minSize: 44 })).progress).toBe(1);
  });
});
