import { Subscriber } from 'zeromq';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { NodeObservation } from '../models/NodeObservation.js';
import { ObservationGap } from '../models/ObservationGap.js';
import { ZMQ_TOPICS, detectGap, parseMessage, type ZmqTopic } from '../domain/zmqTopics.js';

/**
 * Event-time observation from the node's ZMQ socket.
 *
 * The RPC can only ever answer "is this block locked *now*", so a poller
 * measures its own interval and calls it latency. These notifications carry the
 * moment the node processed the event, which is a different and much sharper
 * measurement -- but a lossy one, because a PUB socket drops silently under
 * pressure. Both are therefore kept: this listener records event times, the
 * poller reconciles, and every row says which one it came from.
 *
 * The socket must stay on localhost. It has no authentication of any kind.
 */
export class ZmqService {
  private sock: Subscriber | null = null;
  private closing = false;
  /** Last sequence number seen per topic, for gap detection. */
  private lastSeq = new Map<ZmqTopic, number>();
  private received = 0;
  private missed = 0;

  get enabled(): boolean {
    return config.zmq.endpoint.length > 0;
  }

  /** What the data-quality view needs: how much arrived, how much was lost. */
  stats(): { enabled: boolean; connected: boolean; received: number; missed: number } {
    return { enabled: this.enabled, connected: this.sock !== null, received: this.received, missed: this.missed };
  }

  start(): void {
    if (!this.enabled) {
      logger.info('ZMQ listener disabled (no ZMQ_ENDPOINT); ChainLock timing falls back to polling');
      return;
    }

    const sock = new Subscriber();
    for (const topic of ZMQ_TOPICS) sock.subscribe(topic);
    sock.connect(config.zmq.endpoint);
    this.sock = sock;

    logger.info(`ZMQ listener connected to ${config.zmq.endpoint} (${ZMQ_TOPICS.join(', ')})`);
    void this.loop(sock);
  }

  async stop(): Promise<void> {
    this.closing = true;
    this.sock?.close();
    this.sock = null;
  }

  private async loop(sock: Subscriber): Promise<void> {
    try {
      for await (const frames of sock) {
        // Timestamp first, before any await: this value is the measurement.
        const receivedAt = new Date();
        try {
          await this.handle(frames, receivedAt);
        } catch (error) {
          logger.error(`ZMQ message failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      if (this.closing) return;
      logger.error(`ZMQ listener stopped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handle(frames: Buffer[], receivedAt: Date): Promise<void> {
    const msg = parseMessage(frames);
    if (!msg) return;

    this.received++;

    const gap = detectGap(msg.topic, this.lastSeq.get(msg.topic), msg.sequence);
    this.lastSeq.set(msg.topic, msg.sequence);
    if (gap) {
      this.missed += gap.missed;
      // A gap is data, not an error to swallow: it states exactly what this
      // collection cannot answer, and the poller is what fills it in.
      await ObservationGap.updateOne(
        { topic: gap.topic, from: gap.from, to: gap.to },
        { $setOnInsert: { ...gap, detectedAt: receivedAt } },
        { upsert: true }
      ).catch(() => undefined);
      logger.warn(`ZMQ gap on ${gap.topic}: missed ${gap.missed} message(s) (${gap.from}-${gap.to})`);
    }

    const observationKey = `${msg.topic}:${msg.hash ?? `seq-${msg.sequence}`}`;
    await NodeObservation.updateOne(
      { observationKey },
      {
        // $setOnInsert only: an arrival time is a fact about a moment. A
        // reconnect that replays a notification must not move it.
        $setOnInsert: {
          observationKey,
          topic: msg.topic,
          hash: msg.hash,
          sequence: msg.sequence,
          payloadHex: msg.payloadHex,
          receivedAt,
          appliedAt: null,
        },
      },
      { upsert: true }
    );
  }
}

export const zmqService = new ZmqService();
