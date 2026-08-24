/**
 * What arrives on the node's ZMQ socket, and how a lost message is noticed.
 *
 * Every published message carries three frames: the topic, the payload, and a
 * little-endian uint32 sequence number that counts *per topic*. That counter is
 * the only reason ZMQ is trustworthy here -- the PUB socket drops silently once
 * the high-water mark is reached, so without it a missing ChainLock and a
 * ChainLock that never happened look identical. With it, a gap is a fact we can
 * record and reconcile against RPC.
 *
 * Pure so the framing and the gap arithmetic can be tested without a node.
 */
export const ZMQ_TOPICS = ['hashblock', 'hashchainlock', 'hashtx', 'sequence'] as const;
export type ZmqTopic = (typeof ZMQ_TOPICS)[number];

export function isTrackedTopic(topic: string): topic is ZmqTopic {
  return (ZMQ_TOPICS as readonly string[]).includes(topic);
}

export interface ZmqMessage {
  topic: ZmqTopic;
  /** Block or transaction hash, big-endian hex as the RPC reports it. */
  hash: string | null;
  sequence: number;
  /** Raw payload, kept verbatim for topics whose body is not a bare hash. */
  payloadHex: string;
}

/**
 * The hash frames are published in internal byte order -- the reverse of what
 * every RPC and every explorer URL uses. Publishing them unreversed would
 * produce hashes that match nothing, and the mismatch would look like missing
 * data rather than a byte-order mistake.
 */
export function toRpcHash(payload: Uint8Array): string {
  const hex: string[] = [];
  for (let i = payload.length - 1; i >= 0; i--) {
    hex.push(payload[i]!.toString(16).padStart(2, '0'));
  }
  return hex.join('');
}

export function parseMessage(frames: Uint8Array[]): ZmqMessage | null {
  const [topicFrame, body, seqFrame] = frames;
  if (!topicFrame || !body) return null;

  const topic = Buffer.from(topicFrame).toString('utf8');
  if (!isTrackedTopic(topic)) return null;

  // Absent or short sequence frame: treat as unknown rather than as zero, or a
  // single malformed message would report a gap of every message so far.
  const sequence = seqFrame && seqFrame.length >= 4 ? Buffer.from(seqFrame).readUInt32LE(0) : -1;

  // Only the hash topics carry a bare 32-byte hash; `sequence` carries a hash
  // plus a one-character label and a mempool counter, so it is kept raw.
  const hash = topic !== 'sequence' && body.length === 32 ? toRpcHash(body) : null;

  return { topic, hash, sequence, payloadHex: Buffer.from(body).toString('hex') };
}

export interface SequenceGap {
  topic: ZmqTopic;
  /** First sequence number that was never delivered. */
  from: number;
  /** Last sequence number that was never delivered. */
  to: number;
  missed: number;
}

/**
 * Compares a topic's new sequence number against the last one seen.
 *
 * Returns null for the first message of a topic (nothing to compare against),
 * for an unknown sequence, and for replays or restarts where the counter moves
 * backwards -- a negative gap is not a loss and must not be recorded as one.
 */
export function detectGap(topic: ZmqTopic, previous: number | undefined, current: number): SequenceGap | null {
  if (previous === undefined || previous < 0 || current < 0) return null;
  if (current <= previous + 1) return null;
  return { topic, from: previous + 1, to: current - 1, missed: current - previous - 1 };
}
