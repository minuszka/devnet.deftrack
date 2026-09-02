import { describe, expect, it } from 'vitest';
import { OperatorIndex, hostOf } from './operatorIndex.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('operator attribution', () => {
  it('claims every masternode on a host from one line', () => {
    const idx = new OperatorIndex([
      { operatorLabel: 'op-6', proTxHashes: [], hostIps: ['198.51.100.10'] },
    ]);
    expect(idx.resolve(HASH_A, '198.51.100.10')).toBe('op-6');
    expect(idx.resolve(HASH_B, '198.51.100.10')).toBe('op-6');
  });

  it('lets an explicit proTxHash override the host it runs on', () => {
    const idx = new OperatorIndex([
      { operatorLabel: 'op-host', proTxHashes: [], hostIps: ['10.0.0.1'] },
      { operatorLabel: 'op-guest', proTxHashes: [HASH_B], hostIps: [] },
    ]);
    expect(idx.resolve(HASH_A, '10.0.0.1')).toBe('op-host');
    expect(idx.resolve(HASH_B, '10.0.0.1')).toBe('op-guest');
  });

  it('returns null rather than guessing', () => {
    const idx = new OperatorIndex([
      { operatorLabel: 'op-6', proTxHashes: [], hostIps: ['198.51.100.10'] },
    ]);
    expect(idx.resolve(HASH_A, '203.0.113.7')).toBeNull();
    expect(idx.resolve(HASH_A, null)).toBeNull();
  });

  it('takes the host out of a service string', () => {
    expect(hostOf('198.51.100.10:19799')).toBe('198.51.100.10');
    expect(hostOf('[2001:db8::1]:19799')).toBe('[2001:db8::1]');
    expect(hostOf(null)).toBeNull();
    expect(hostOf('')).toBeNull();
  });
});
