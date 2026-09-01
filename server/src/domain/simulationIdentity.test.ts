import { describe, expect, it } from 'vitest';
import { simulationActionIdFor, simulationRunKeyFor } from './simulationIdentity.js';

describe('simulation idempotency identities', () => {
  it('returns the same opaque run key for the same idempotency key', () => {
    const first = simulationRunKeyFor('operator-request-42');
    expect(simulationRunKeyFor('operator-request-42')).toBe(first);
    expect(first).toMatch(/^sim_[0-9a-f]{32}$/);
    expect(first).not.toContain('operator-request');
  });

  it('separates different run requests', () => {
    expect(simulationRunKeyFor('request-a')).not.toBe(simulationRunKeyFor('request-b'));
  });

  it('derives action ids from the immutable execution-plan coordinates', () => {
    const input = { runKey: 'sim_a', sequence: 3, kind: 'service-stop', targetId: 'mn-7' };
    const first = simulationActionIdFor(input);
    expect(simulationActionIdFor(input)).toBe(first);
    expect(first).toMatch(/^act_[0-9a-f]{40}$/);

    expect(simulationActionIdFor({ ...input, sequence: 4 })).not.toBe(first);
    expect(simulationActionIdFor({ ...input, kind: 'service-start' })).not.toBe(first);
    expect(simulationActionIdFor({ ...input, targetId: 'mn-8' })).not.toBe(first);
  });

  it('rejects empty or invalid identity components', () => {
    expect(() => simulationRunKeyFor('  ')).toThrow(/idempotencyKey/);
    expect(() =>
      simulationActionIdFor({ runKey: 'sim_a', sequence: -1, kind: 'stop', targetId: 'mn-1' })
    ).toThrow(/sequence/);
    expect(() =>
      simulationActionIdFor({ runKey: 'sim_a', sequence: 0, kind: '', targetId: 'mn-1' })
    ).toThrow(/kind/);
  });
});
