import { describe, expect, it } from 'vitest';
import { registryUpdateFrom, simulationTargetRegistrationSchema } from './targetRegistration.js';

const HEX = 'a'.repeat(64);
const base = {
  displayLabel: 'mn01', hostRef: 'mn01', unitRef: 'defcon-lab-mn@1',
  p2pPort: 19799, role: 'masternode', network: 'regtest',
  capabilities: ['netem-p2p', 'service-control'],
};
const parse = (over: Record<string, unknown> = {}) =>
  simulationTargetRegistrationSchema.parse({ targetId: 'mn-1', ...base, ...over });

describe('simulationTargetRegistrationSchema', () => {
  it('cannot enable a target at all -- that is a separate, privileged act', () => {
    // The two-step model is enforced, not merely intended: the first version
    // defaulted enabled to false and then accepted enabled:true in the very same
    // request, so the model existed only in the comment.
    const t = parse();
    expect('enabled' in t).toBe(false);
    expect(() => parse({ enabled: true })).toThrow();
    expect(t.maintenance).toBe(false);
    expect(t.operatorId).toBeNull();
    expect(t.proTxHash).toBeNull();
    expect(t.expectedBuild).toBeNull();
    expect(t.labels).toEqual([]);
  });

  it('accepts the identity pins in their exact shapes', () => {
    expect(parse({ proTxHash: HEX, expectedBuild: HEX }).proTxHash).toBe(HEX);
    expect(() => parse({ proTxHash: 'A'.repeat(64) })).toThrow(); // uppercase is not the on-chain form
    expect(() => parse({ proTxHash: 'abc' })).toThrow();
    expect(() => parse({ expectedBuild: 'z'.repeat(64) })).toThrow();
  });

  it('refuses anything it was not told to accept', () => {
    expect(() => simulationTargetRegistrationSchema.parse({ targetId: 'mn-1', ...base, surprise: 1 })).toThrow();
    expect(() => parse({ network: 'mainnet' })).toThrow(); // mainnet is not expressible
    expect(() => parse({ role: 'wallet' })).toThrow();
    expect(() => parse({ capabilities: ['root-shell'] })).toThrow();
    expect(() => parse({ p2pPort: 0 })).toThrow();
    expect(() => parse({ p2pPort: 70_000 })).toThrow();
    expect(() => parse({ hostRef: '' })).toThrow();
  });

  it('constrains the target id to a stable, lowercase form', () => {
    expect(parse({ targetId: 'mn-01.a_b' }).targetId).toBe('mn-01.a_b');
    expect(() => parse({ targetId: 'MN-1' })).toThrow();
    expect(() => parse({ targetId: 'x' })).toThrow();
    expect(() => parse({ targetId: '-leading' })).toThrow();
  });

  it('rejects duplicate capabilities and labels', () => {
    expect(() => parse({ capabilities: ['netem-p2p', 'netem-p2p'] })).toThrow(/unique/);
    expect(() => parse({ labels: ['lab', 'lab'] })).toThrow(/unique/);
  });
});

describe('registryUpdateFrom', () => {
  it('never carries targetId into the update, because it is immutable once declared', () => {
    const update = registryUpdateFrom(parse());
    expect('targetId' in update).toBe(false);
    expect(update.hostRef).toBe('mn01');
  });
});
