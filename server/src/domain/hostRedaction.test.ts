import { describe, expect, it } from 'vitest';
import {
  containsHostAddress,
  hostLabel,
  redactService,
  type HostRedactionPolicy,
} from './hostRedaction.js';

const redacting: HostRedactionPolicy = { publishAddresses: false, secret: 'k'.repeat(64) };
const other: HostRedactionPolicy = { publishAddresses: false, secret: 'j'.repeat(64) };
const open: HostRedactionPolicy = { publishAddresses: true, secret: '' };
const keyless: HostRedactionPolicy = { publishAddresses: false, secret: '' };

describe('turning a host address into something publishable', () => {
  it('never returns the address it was given', () => {
    const label = hostLabel('203.0.113.7', redacting);
    expect(label).not.toBeNull();
    expect(label).not.toContain('203.0.113.7');
    expect(containsHostAddress(label)).toBe(false);
  });

  it('gives one host the same label every time, and two hosts different ones', () => {
    // Stability is the point: the views group by this, and a label that moved
    // between requests would split one host into many rows.
    expect(hostLabel('203.0.113.7', redacting)).toBe(hostLabel('203.0.113.7', redacting));
    expect(hostLabel('203.0.113.7', redacting)).not.toBe(hostLabel('203.0.113.8', redacting));
  });

  it('is keyed, so the same address is unrecognisable across deployments', () => {
    // A bare hash of an IPv4 address is not redaction: four billion values is a
    // few seconds of work. Two deployments must not agree on the answer.
    expect(hostLabel('203.0.113.7', redacting)).not.toBe(hostLabel('203.0.113.7', other));
  });

  it('issues nothing at all when the deployment has no key', () => {
    // Fail closed. The failure mode of the alternative is publishing addresses.
    expect(hostLabel('203.0.113.7', keyless)).toBeNull();
    expect(redactService('203.0.113.7:19799', keyless)).toBeNull();
  });

  it('publishes the address unchanged only when the deployment opts in', () => {
    expect(hostLabel('203.0.113.7', open)).toBe('203.0.113.7');
    expect(redactService('203.0.113.7:19799', open)).toBe('203.0.113.7:19799');
  });

  it('passes a missing address through as missing', () => {
    for (const empty of [null, undefined, '']) {
      expect(hostLabel(empty, redacting)).toBeNull();
      expect(redactService(empty, redacting)).toBeNull();
    }
  });
});

describe('redacting a service', () => {
  it('keeps the port and hides the address', () => {
    const service = redactService('203.0.113.7:19799', redacting);
    expect(service).toMatch(/^host-[0-9a-f]{10}:19799$/);
    expect(containsHostAddress(service)).toBe(false);
  });

  it('gives the same host the same label whichever port answered', () => {
    const first = redactService('203.0.113.7:19799', redacting)!.split(':')[0];
    const second = redactService('203.0.113.7:19808', redacting)!.split(':')[0];
    expect(first).toBe(second);
  });

  it('drops anything that is not an address and a port', () => {
    // Guessing at a malformed value is how half an address reaches the page.
    for (const bad of ['203.0.113.7', ':19799', '203.0.113.7:', 'host:notaport', '19799']) {
      expect(redactService(bad, redacting)).toBeNull();
    }
  });
});

describe('the guard the DTO contract test uses', () => {
  it('finds an address at any depth', () => {
    expect(containsHostAddress({ a: [{ b: { c: 'seen at 198.51.100.11:19799' } }] })).toBe(true);
    expect(containsHostAddress({ a: [{ b: { c: 'host-00ff00ff00:19799' } }] })).toBe(false);
  });

  it('ignores values that only look numeric', () => {
    expect(containsHostAddress({ height: 8028, hash: 'a1118849469a1e', version: '22.1.5' })).toBe(false);
  });

  it('sees through a whole redacted masternode row', () => {
    const row = {
      proTxHash: 'a'.repeat(64),
      service: redactService('203.0.113.7:19799', redacting),
      hostLabel: hostLabel('203.0.113.7', redacting),
      operatorLabel: 'op-fullnode-4',
      banned: false,
    };
    expect(containsHostAddress(row)).toBe(false);
  });
});
