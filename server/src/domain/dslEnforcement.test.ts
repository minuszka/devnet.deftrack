import { describe, expect, it } from 'vitest';
import { dslEnforcementState } from './dslEnforcement.js';

/**
 * Pinned against what this devnet actually did, not against the implementation.
 * The numbers are the closed run `dsl-enforcement-outage-2026-09-05`: the gate
 * is 8304, the first reward suspension landed at 8496 and the first DSL ban at
 * 8520. Every case below is a height this chain has really been at.
 */
describe('DSL enforcement state', () => {
  const gate = 8304; // -dslenforcementheight on this devnet

  it('is not active below the gate -- the shadow phase', () => {
    expect(dslEnforcementState(gate, 8303)).toEqual({ height: gate, active: false });
    expect(dslEnforcementState(gate, 5496)).toEqual({ height: gate, active: false });
  });

  it('is active at the gate and above it', () => {
    // The boundary itself counts: IsBanned reads nDSLBanHeight from the gate on.
    expect(dslEnforcementState(gate, gate)).toEqual({ height: gate, active: true });
    // 8496 and 8520 are the measured suspension and ban heights.
    expect(dslEnforcementState(gate, 8496)).toEqual({ height: gate, active: true });
    expect(dslEnforcementState(gate, 8520)).toEqual({ height: gate, active: true });
  });

  it('reports the live devnet honestly -- the case the hardcoded false got wrong', () => {
    // Tip on 2026-09-11, when the literal still said the layer was a shadow.
    expect(dslEnforcementState(gate, 11546)).toEqual({ height: gate, active: true });
  });

  it('says "unscheduled" rather than "at height 0" when no gate is declared', () => {
    expect(dslEnforcementState(0, 11546)).toEqual({ height: null, active: false });
    expect(dslEnforcementState(-1, 11546)).toEqual({ height: null, active: false });
    expect(dslEnforcementState(Number.NaN, 11546)).toEqual({ height: null, active: false });
  });

  it('does not invent activity from an empty index', () => {
    // Nothing indexed yet: the gate is declared, but nothing has reached it.
    expect(dslEnforcementState(gate, null)).toEqual({ height: gate, active: false });
    expect(dslEnforcementState(gate, 0)).toEqual({ height: gate, active: false });
  });
});
