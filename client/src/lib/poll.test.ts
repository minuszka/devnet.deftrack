import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { PollController, type PollRun, type VisibilitySource } from './poll.js';

/** Enough of a Lit host for a controller: it only ever registers itself. */
function fakeHost(): ReactiveControllerHost & { controllers: ReactiveController[] } {
  const controllers: ReactiveController[] = [];
  return {
    controllers,
    addController: (c: ReactiveController) => void controllers.push(c),
    removeController: () => undefined,
    requestUpdate: () => undefined,
    updateComplete: Promise.resolve(true),
  };
}

class FakeVisibility implements VisibilitySource {
  hidden = false;
  private listeners: Array<() => void> = [];

  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  set(hidden: boolean): void {
    this.hidden = hidden;
    for (const l of [...this.listeners]) l();
  }

  get listenerCount(): number {
    return this.listeners.length;
  }
}

describe('PollController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('loads once on start and again on every interval', () => {
    const host = fakeHost();
    let runs = 0;
    const poll = new PollController(host, {
      intervalMs: 1000,
      visibility: null,
      load: () => void runs++,
    });

    poll.start();
    expect(runs).toBe(1);

    vi.advanceTimersByTime(3000);
    expect(runs).toBe(4);

    poll.stop();
    vi.advanceTimersByTime(5000);
    expect(runs).toBe(4);
  });

  // The race this controller exists for: without the sequence guard the slow
  // first answer lands last and overwrites the newer one.
  it('marks a superseded run stale and aborts its signal', () => {
    const host = fakeHost();
    const seen: PollRun[] = [];
    const poll = new PollController(host, {
      intervalMs: 1000,
      visibility: null,
      load: (run) => void seen.push(run),
    });

    poll.start();
    poll.refresh();

    expect(seen).toHaveLength(2);
    const [first, second] = seen as [PollRun, PollRun];
    expect(first.stale).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(second.stale).toBe(false);
    expect(second.signal.aborted).toBe(false);
  });

  it('leaves nothing able to write into the page after stop', () => {
    const host = fakeHost();
    const seen: PollRun[] = [];
    const poll = new PollController(host, {
      intervalMs: 1000,
      visibility: null,
      load: (run) => void seen.push(run),
    });

    poll.start();
    poll.stop();

    expect(seen[0]!.stale).toBe(true);
    expect(seen[0]!.signal.aborted).toBe(true);
  });

  it('stops polling while the tab is hidden and reloads when it comes back', () => {
    const host = fakeHost();
    const visibility = new FakeVisibility();
    let runs = 0;
    const poll = new PollController(host, {
      intervalMs: 1000,
      visibility,
      load: () => void runs++,
    });

    poll.start();
    expect(runs).toBe(1);

    visibility.set(true);
    vi.advanceTimersByTime(10_000);
    expect(runs).toBe(1);

    visibility.set(false);
    expect(runs).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(runs).toBe(4);

    poll.stop();
    expect(visibility.listenerCount).toBe(0);
  });

  it('does not restart the clock twice when started while already running', () => {
    const host = fakeHost();
    let runs = 0;
    const poll = new PollController(host, {
      intervalMs: 1000,
      visibility: null,
      load: () => void runs++,
    });

    poll.start();
    poll.start();
    vi.advanceTimersByTime(1000);
    expect(runs).toBe(2);
  });

  it('reports a genuine failure but stays silent on an abort', async () => {
    const host = fakeHost();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const aborting = new PollController(host, {
      intervalMs: 1000,
      visibility: null,
      load: () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    });
    aborting.start();
    await vi.runOnlyPendingTimersAsync();
    expect(spy).not.toHaveBeenCalled();
    aborting.stop();

    const failing = new PollController(fakeHost(), {
      intervalMs: 1000,
      visibility: null,
      load: () => Promise.reject(new Error('boom')),
    });
    failing.start();
    await vi.runOnlyPendingTimersAsync();
    expect(spy).toHaveBeenCalled();
    failing.stop();

    spy.mockRestore();
  });

  it('registers itself with the host, so a page needs no lifecycle code', () => {
    const host = fakeHost();
    const poll = new PollController(host, { intervalMs: 1000, visibility: null, load: () => undefined });
    expect(host.controllers).toContain(poll);
  });
});
