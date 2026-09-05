import { Subscriber } from 'zeromq';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { NodeObservation } from '../models/NodeObservation.js';
import { ObservationGap } from '../models/ObservationGap.js';
import { ZMQ_TOPICS, detectGap, parseMessage, type ZmqTopic } from '../domain/zmqTopics.js';

export type ZmqObservationListener = (topic: ZmqTopic) => void | Promise<void>;

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
/** First retry after the receive loop ends, then doubling. */
const RECONNECT_INITIAL_MS = 2_000;
/** The ceiling; a node down for an hour is retried every minute, not never. */
const RECONNECT_MAX_MS = 60_000;

export class ZmqService {
  private sock: Subscriber | null = null;
  private closing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = RECONNECT_INITIAL_MS;
  /** Last sequence number seen per topic, for gap detection. */
  private lastSeq = new Map<ZmqTopic, number>();
  private received = 0;
  private missed = 0;
  private readonly observationListeners = new Set<ZmqObservationListener>();

  get enabled(): boolean {
    return config.zmq.endpoint.length > 0;
  }

  /** What the data-quality view needs: how much arrived, how much was lost. */
  stats(): { enabled: boolean; connected: boolean; received: number; missed: number } {
    return { enabled: this.enabled, connected: this.sock !== null, received: this.received, missed: this.missed };
  }

  /**
   * Signals consumers after an observation is durably stored. The listener is
   * deliberately fire-and-forget: a slow Mongo derivation must never hold up
   * the ZMQ receive loop and cause the very gaps we are trying to measure.
   */
  onObservation(listener: ZmqObservationListener): () => void {
    this.observationListeners.add(listener);
    return () => this.observationListeners.delete(listener);
  }

  start(): void {
    if (!this.enabled) {
      logger.info('ZMQ listener disabled (no ZMQ_ENDPOINT); ChainLock timing falls back to polling');
      return;
    }
    this.closing = false;
    this.connect();
  }

  private connect(): void {
    const sock = new Subscriber();
    for (const topic of ZMQ_TOPICS) sock.subscribe(topic);
    sock.connect(config.zmq.endpoint);
    this.sock = sock;

    logger.info(`ZMQ listener connected to ${config.zmq.endpoint} (${ZMQ_TOPICS.join(', ')})`);
    void this.loop(sock);
  }

  /**
   * Come back after the receive loop ends.
   *
   * It used to end for good. The loop logged and returned, `sock` stayed
   * non-null so `stats().connected` went on reporting a live listener, and
   * ChainLock timing silently dropped to whatever the reconcile poll could see
   * -- five-minute resolution reported as if it were event-time. Nothing said
   * so, because the one field that would have said so was wrong.
   */
  private scheduleReconnect(): void {
    if (this.closing || !this.enabled || this.reconnectTimer !== null) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(RECONNECT_MAX_MS, this.reconnectDelayMs * 2);
    logger.warn(`ZMQ listener disconnected; retrying in ${delay} ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closing) this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
      if (!this.closing) {
        logger.error(`ZMQ listener stopped: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      // The iterator has ended, so this socket delivers nothing more -- whether
      // it threw or was closed. Clearing it is what makes `connected` honest.
      if (this.sock === sock) this.sock = null;
      try {
        sock.close();
      } catch {
        // Already closed; the point was to stop using it.
      }
      this.scheduleReconnect();
    }
  }

  private async handle(frames: Buffer[], receivedAt: Date): Promise<void> {
    const msg = parseMessage(frames);
    if (!msg) return;

    this.received++;
    // A message arrived, so whatever the last outage was, it is over.
    this.reconnectDelayMs = RECONNECT_INITIAL_MS;

    const gap = detectGap(msg.topic, this.lastSeq.get(msg.topic), msg.sequence);
    // Only a sequence that was actually read. A malformed frame parses as -1,
    // and storing that made the NEXT message incomparable too -- one bad frame
    // blinded the gap detector for the message after it.
    if (msg.sequence >= 0) this.lastSeq.set(msg.topic, msg.sequence);
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

    // A hash identifies its notification uniquely. A sequence number does not:
    // the node's per-topic counter restarts with the node, so `sequence:seq-5`
    // would collide with an older row and $setOnInsert would silently drop the
    // new observation -- the exact class of invisible gap this collector exists
    // to make visible. Sequence rows are keyed by arrival instead.
    const observationKey = msg.hash
      ? `${msg.topic}:${msg.hash}`
      : `${msg.topic}:${receivedAt.toISOString()}:${msg.sequence}`;
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

    for (const listener of this.observationListeners) {
      Promise.resolve().then(() => listener(msg.topic)).catch((error: unknown) => {
        logger.error(
          `ZMQ observation listener failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }
  }
}

export const zmqService = new ZmqService();
