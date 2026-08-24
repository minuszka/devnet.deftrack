import { describe, expect, it } from 'vitest';
import { detectGap, parseMessage, toRpcHash } from './zmqTopics.js';

const seq = (n: number): Uint8Array => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
};
const hash32 = (fill: number): Uint8Array => Uint8Array.from(Buffer.alloc(32, fill));

describe('ZMQ message framing', () => {
  it('takes the hash verbatim, because the node publishes display order', () => {
    // Reversing it -- the usual internal-vs-display convention -- was tried
    // first and matched no indexed block. Pinned so it is not "corrected" back.
    const payload = Uint8Array.from([1, 2, 3, 4]);
    expect(toRpcHash(payload)).toBe('01020304');
  });

  it('parses a block hash notification', () => {
    const msg = parseMessage([Buffer.from('hashblock'), hash32(0xab), seq(7)]);
    expect(msg).toEqual({
      topic: 'hashblock',
      hash: 'ab'.repeat(32),
      sequence: 7,
      payloadHex: 'ab'.repeat(32),
    });
  });

  it('ignores topics we did not subscribe to', () => {
    expect(parseMessage([Buffer.from('rawtx'), hash32(1), seq(1)])).toBeNull();
  });

  it('keeps the sequence topic raw, because its body is not a bare hash', () => {
    const body = Buffer.concat([Buffer.alloc(32, 5), Buffer.from('C')]);
    const msg = parseMessage([Buffer.from('sequence'), body, seq(3)]);
    expect(msg?.hash).toBeNull();
    expect(msg?.payloadHex).toBe(body.toString('hex'));
  });

  it('reports an unknown sequence as -1 rather than as 0', () => {
    // Zero is a real sequence number; conflating the two would invent a gap
    // covering every message published so far.
    const msg = parseMessage([Buffer.from('hashtx'), hash32(2)]);
    expect(msg?.sequence).toBe(-1);
  });
});

describe('dropped-message detection', () => {
  it('says nothing on the first message of a topic', () => {
    expect(detectGap('hashblock', undefined, 42)).toBeNull();
  });

  it('says nothing when the sequence advances by one', () => {
    expect(detectGap('hashblock', 41, 42)).toBeNull();
  });

  it('reports exactly which sequence numbers never arrived', () => {
    expect(detectGap('hashchainlock', 10, 14)).toEqual({
      topic: 'hashchainlock',
      from: 11,
      to: 13,
      missed: 3,
    });
  });

  it('does not treat a restart or a replay as a loss', () => {
    // The node restarting resets the counter; that is not a dropped message.
    expect(detectGap('hashblock', 900, 3)).toBeNull();
    expect(detectGap('hashblock', 900, 900)).toBeNull();
  });

  it('does not compare against an unknown sequence', () => {
    expect(detectGap('hashtx', -1, 5)).toBeNull();
    expect(detectGap('hashtx', 5, -1)).toBeNull();
  });
});
