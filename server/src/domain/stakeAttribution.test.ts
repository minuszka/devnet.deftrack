import { describe, expect, it } from 'vitest';
import { resolveScriptOwners, type StakeScriptSighting } from './stakeAttribution.js';

const WINDOW = { fromHeight: 100, toHeight: 200 };

describe('resolveScriptOwners', () => {
  it('attributes a script reported by exactly one host in the window', () => {
    const sightings: StakeScriptSighting[] = [
      { host: 'seed', script: 'aa', height: 120 },
      { host: 'seed', script: 'aa', height: 160 },
    ];
    expect(resolveScriptOwners(sightings, WINDOW).get('aa')).toBe('seed');
  });

  it('maps a script two hosts both reported to null -- shared key is not attributable', () => {
    const sightings: StakeScriptSighting[] = [
      { host: 'seed', script: 'aa', height: 120 },
      { host: 'fleet-1', script: 'aa', height: 130 },
    ];
    expect(resolveScriptOwners(sightings, WINDOW).get('aa')).toBeNull();
  });

  it('leaves a script no host reported in the window absent, not attributed', () => {
    const sightings: StakeScriptSighting[] = [{ host: 'seed', script: 'bb', height: 120 }];
    const owners = resolveScriptOwners(sightings, WINDOW);
    expect(owners.has('aa')).toBe(false);
    expect(owners.get('aa') ?? null).toBeNull();
  });

  it('ignores sightings outside the height window', () => {
    const sightings: StakeScriptSighting[] = [
      { host: 'seed', script: 'aa', height: 99 },
      { host: 'fleet-1', script: 'aa', height: 201 },
    ];
    // Both are out of [100,200], so the script is never seen in-window.
    expect(resolveScriptOwners(sightings, WINDOW).has('aa')).toBe(false);
  });

  it('is deterministic under reordering and repeated sightings -- the reproducibility guarantee', () => {
    const a: StakeScriptSighting[] = [
      { host: 'seed', script: 'aa', height: 120 },
      { host: 'fleet-1', script: 'bb', height: 130 },
      { host: 'seed', script: 'aa', height: 180 },
    ];
    const b = [...a].reverse();
    const owners = resolveScriptOwners(a, WINDOW);
    const reversed = resolveScriptOwners(b, WINDOW);
    expect([...owners.entries()].sort()).toEqual([...reversed.entries()].sort());
    expect(owners.get('aa')).toBe('seed');
    expect(owners.get('bb')).toBe('fleet-1');
  });

  it('respects inclusive window boundaries', () => {
    const sightings: StakeScriptSighting[] = [
      { host: 'seed', script: 'lo', height: 100 },
      { host: 'seed', script: 'hi', height: 200 },
    ];
    const owners = resolveScriptOwners(sightings, WINDOW);
    expect(owners.get('lo')).toBe('seed');
    expect(owners.get('hi')).toBe('seed');
  });
});
