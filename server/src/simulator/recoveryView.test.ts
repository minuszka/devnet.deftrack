import { describe, expect, it } from 'vitest';
import { recoveryView } from './recoveryView.js';

/**
 * The one thing this function exists to do, and the one thing it must never do.
 *
 * It exists so the panel can show recovery evidence at all -- the run
 * projection does not carry it, so the panel had none and the line that
 * pretended to was unreachable code. It must never hand over the prober's
 * `privateDetail`: free text, written per target, and where a host address or a
 * unit name ends up. A type in the browser does not stop anything reaching the
 * browser.
 */
describe('recoveryView', () => {
  const stored = {
    required: true,
    startedAtMs: 1_000,
    finishedAtMs: 2_000,
    allClear: false,
    targets: [
      {
        targetId: 'lab-mn-1',
        faultStateClear: true,
        expectedServiceRunning: false,
        observerFresh: true,
        checkedAtMs: 1_500,
        privateDetail: 'ssh 198.51.100.11: unit defcon-lab-mn@1 is not running',
      },
    ],
  };

  it('is null when nothing was recorded', () => {
    expect(recoveryView(null)).toBeNull();
  });

  it('carries what an operator has to decide with', () => {
    const view = recoveryView(stored);
    expect(view?.allClear).toBe(false);
    expect(view?.required).toBe(true);
    expect(view?.targets).toEqual([
      {
        targetId: 'lab-mn-1',
        faultStateClear: true,
        expectedServiceRunning: false,
        observerFresh: true,
        checkedAtMs: 1_500,
      },
    ]);
  });

  it('drops the private detail, address and all', () => {
    const serialised = JSON.stringify(recoveryView(stored));
    expect(serialised).not.toContain('privateDetail');
    expect(serialised).not.toContain('198.51.100.11');
    expect(serialised).not.toContain('defcon-lab-mn@1');
  });
});
