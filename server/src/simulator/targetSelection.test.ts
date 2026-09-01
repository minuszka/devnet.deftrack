import { describe, expect, it } from 'vitest';
import type { SimulationTargetSnapshot } from '../models/SimulationRun.js';
import { selectSimulationTargets } from './targetSelection.js';

function target(targetId: string): SimulationTargetSnapshot {
  return {
    targetId,
    displayLabel: targetId,
    operatorId: null,
    proTxHash: null,
    hostRef: `host-${targetId}`,
    unitRef: `unit-${targetId}`,
    p2pPort: 19_799,
    role: 'masternode',
    network: 'devnet',
    capabilities: ['service-control'],
    expectedBuild: null,
    capturedAtMs: 1,
    capturedAtHeight: 1,
  };
}

describe('deterministic simulation target selection', () => {
  const candidates = Array.from({ length: 20 }, (_, index) => target(`mn-${index}`));

  it('is stable across input ordering and repeated calls', () => {
    const input = { candidates, count: 5, seed: 'repeatable', namespace: 'mn-stop' };
    const first = selectSimulationTargets(input).map((item) => item.targetId);
    expect(selectSimulationTargets(input).map((item) => item.targetId)).toEqual(first);
    expect(
      selectSimulationTargets({ ...input, candidates: [...candidates].reverse() }).map((item) => item.targetId)
    ).toEqual(first);
  });

  it('changes the deterministic sample when the seed changes', () => {
    const first = selectSimulationTargets({ candidates, count: 5, seed: 'a', namespace: 'x' });
    const second = selectSimulationTargets({ candidates, count: 5, seed: 'b', namespace: 'x' });
    expect(second.map((item) => item.targetId)).not.toEqual(first.map((item) => item.targetId));
  });

  it('sorts explicit targets and rejects ineligible or duplicate targets', () => {
    expect(
      selectSimulationTargets({
        candidates,
        count: 2,
        seed: 'x',
        namespace: 'x',
        explicitTargetIds: ['mn-7', 'mn-2'],
      }).map((item) => item.targetId)
    ).toEqual(['mn-2', 'mn-7']);
    expect(() =>
      selectSimulationTargets({
        candidates,
        count: 1,
        seed: 'x',
        namespace: 'x',
        explicitTargetIds: ['missing'],
      })
    ).toThrow(/not eligible/);
    expect(() =>
      selectSimulationTargets({ candidates: [candidates[0]!, candidates[0]!], count: 1, seed: 'x', namespace: 'x' })
    ).toThrow(/duplicate targetId/);
  });
});
