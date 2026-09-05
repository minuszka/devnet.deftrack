import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The receive loop used to end for good.
 *
 * It logged and returned; `sock` stayed non-null, so `stats().connected` went on
 * reporting a live listener, and ChainLock timing silently dropped to whatever
 * the reconcile poll could see -- five-minute resolution presented as event
 * time. Nothing said so, because the one field that would have said so was the
 * field that was wrong.
 */
const state = vi.hoisted(() => ({
  logs: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  /** Sockets handed out, newest last. */
  sockets: [] as { closed: boolean; fail: boolean }[],
}));

vi.mock('../config.js', () => ({
  config: { zmq: { endpoint: 'tcp://127.0.0.1:28332' } },
}));
vi.mock('../utils/logger.js', () => ({ logger: state.logs }));
vi.mock('../models/NodeObservation.js', () => ({ NodeObservation: { updateOne: async () => ({}) } }));
vi.mock('../models/ObservationGap.js', () => ({ ObservationGap: { updateOne: async () => ({}) } }));

vi.mock('zeromq', () => ({
  Subscriber: class {
    private readonly record: { closed: boolean; fail: boolean };
    constructor() {
      this.record = { closed: false, fail: true };
      state.sockets.push(this.record);
    }
    subscribe(): void {}
    connect(): void {}
    close(): void {
      this.record.closed = true;
    }
    async *[Symbol.asyncIterator](): AsyncGenerator<Buffer[]> {
      // Ends immediately, the way a dropped connection does.
      if (this.record.fail) throw new Error('connection reset');
    }
  },
}));

import { ZmqService } from './zmq.service.js';

beforeEach(() => {
  for (const fn of Object.values(state.logs)) fn.mockReset();
  state.sockets = [];
  vi.useFakeTimers();
});

describe('a receive loop that ends', () => {
  it('stops claiming to be connected', async () => {
    const service = new ZmqService();
    service.start();
    // Let the loop run and throw.
    await vi.advanceTimersByTimeAsync(0);

    expect(service.stats().connected).toBe(false);
    expect(state.sockets[0]?.closed).toBe(true);
    await service.stop();
    vi.useRealTimers();
  });

  it('reconnects, and backs off rather than spinning', async () => {
    const service = new ZmqService();
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.sockets).toHaveLength(1);

    // The first retry lands, fails again, and the next wait is longer.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(state.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(state.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(state.sockets).toHaveLength(3);

    await service.stop();
    vi.useRealTimers();
  });

  it('stops retrying once it has been stopped', async () => {
    const service = new ZmqService();
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    await service.stop();

    await vi.advanceTimersByTimeAsync(120_000);

    expect(state.sockets).toHaveLength(1);
    vi.useRealTimers();
  });
});
