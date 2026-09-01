import { describe, expect, it } from 'vitest';
import { authorizeSimulationApproval } from './simulationApproval.js';

describe('simulation approval policy', () => {
  it('lets an operator approve a medium-risk scenario', () => {
    expect(authorizeSimulationApproval({
      scenarioId: 'mn-stop', acknowledgedRiskClass: 'medium', role: 'operator',
    }).allowed).toBe(true);
  });

  it('requires safety-admin for a high-risk scenario', () => {
    expect(authorizeSimulationApproval({
      scenarioId: 'host-outage', acknowledgedRiskClass: 'high', role: 'operator',
    }).allowed).toBe(false);
    expect(authorizeSimulationApproval({
      scenarioId: 'host-outage', acknowledgedRiskClass: 'high', role: 'safety-admin',
    }).allowed).toBe(true);
  });

  it('rejects a stale or caller-invented risk acknowledgement', () => {
    expect(() => authorizeSimulationApproval({
      scenarioId: 'mn-stop', acknowledgedRiskClass: 'low', role: 'safety-admin',
    })).toThrow('risk acknowledgement');
  });
});
