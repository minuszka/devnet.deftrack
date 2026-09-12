import { describe, expect, it } from 'vitest';
import { eligibility, type EligibleTarget } from './targetEligibility.js';

function target(overrides: Partial<EligibleTarget> = {}): EligibleTarget {
  return {
    targetId: 'lab-mn-1',
    role: 'masternode',
    network: 'regtest',
    enabled: true,
    maintenance: false,
    capabilities: ['service-control', 'netem-p2p', 'partition-p2p', 'dsl-test-hook'],
    ...overrides,
  };
}

const draft = (params: Record<string, unknown> = {}) => ({ network: 'regtest' as const, params });

describe('target eligibility', () => {
  it('admits a target that meets every rule', () => {
    expect(eligibility(target(), { role: 'masternode', capability: 'service-control' }, draft())).toEqual({ ok: true });
  });

  it('names the network first, because nothing else matters on the wrong one', () => {
    // Wrong network AND wrong role: the network is the reason given.
    const result = eligibility(target({ network: 'devnet', role: 'staker' }), { role: 'masternode' }, draft());
    expect(result).toEqual({ ok: false, reason: 'on devnet; this draft is for regtest' });
  });

  it('refuses a disabled target and a target in maintenance, as the resolver does', () => {
    expect(eligibility(target({ enabled: false }), {}, draft())).toEqual({ ok: false, reason: 'disabled in the registry' });
    expect(eligibility(target({ maintenance: true }), {}, draft())).toEqual({ ok: false, reason: 'in maintenance' });
  });

  it('applies the resolver rules even with no scenario requirement', () => {
    // host-outage's anchor and clear-recover carry no role: the resolver still
    // filters them, so the chooser must too.
    expect(eligibility(target({ enabled: false }), undefined, draft()).ok).toBe(false);
  });

  it('reads a fixed role from the registry, never from the name', () => {
    // Named like a masternode, registered as a staker. The registry wins.
    const misleading = target({ targetId: 'lab-mn-11', role: 'staker' });
    expect(eligibility(misleading, { role: 'masternode' }, draft())).toEqual({
      ok: false,
      reason: 'a staker; this needs a masternode',
    });
  });

  it('takes the role from another parameter when the scenario says so', () => {
    const req = { roleFrom: 'role', capability: 'netem-p2p' as const };
    expect(eligibility(target({ role: 'staker' }), req, draft({ role: 'staker' }))).toEqual({ ok: true });
    expect(eligibility(target({ role: 'masternode' }), req, draft({ role: 'staker' }))).toEqual({
      ok: false,
      reason: 'a masternode; this needs a staker',
    });
  });

  it('refuses a missing capability', () => {
    const noNetem = target({ capabilities: ['service-control'] });
    expect(eligibility(noNetem, { capability: 'netem-p2p' }, draft())).toEqual({ ok: false, reason: 'has no netem-p2p' });
  });

  it('does not refuse on capabilities a server never reported', () => {
    const unknown = target({ capabilities: undefined });
    expect(eligibility(unknown, { capability: 'netem-p2p' }, draft())).toEqual({ ok: true });
  });

  it('never makes a seed eligible for a role it is not', () => {
    for (const role of ['masternode', 'staker'] as const) {
      expect(eligibility(target({ role: 'seed' }), { role }, draft()).ok).toBe(false);
    }
  });
});
