import type { SimulationRecoveryResult } from '../models/SimulationRun.js';

/**
 * The recovery result as the control panel may see it.
 *
 * The stored result carries a `privateDetail` per target -- free text written
 * by the prober, which is where a host address or a unit name ends up. The
 * panel needs none of it: what an operator has to know is whether each target
 * came back clear, and whether the run as a whole did. So the field is dropped
 * here rather than typed away in the client, because a type in the browser does
 * not stop anything reaching the browser.
 *
 * This exists at all because the run projection does not carry recovery: the
 * repository builds `{runKey, metadataFingerprint, metadata, state}` field by
 * field, and the stored result is a separate field on the document. The panel
 * therefore had no way to show recovery evidence, and the line that pretended
 * to was unreachable code. One endpoint, one shape, no widening of the six
 * responses that embed a run.
 */
export interface RecoveryTargetView {
  targetId: string;
  faultStateClear: boolean;
  expectedServiceRunning: boolean;
  observerFresh: boolean;
  checkedAtMs: number;
}

export interface RecoveryView {
  required: boolean;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  allClear: boolean;
  targets: RecoveryTargetView[];
}

export function recoveryView(recovery: SimulationRecoveryResult | null): RecoveryView | null {
  if (recovery === null) return null;
  return {
    required: recovery.required,
    startedAtMs: recovery.startedAtMs,
    finishedAtMs: recovery.finishedAtMs,
    allClear: recovery.allClear,
    targets: recovery.targets.map((target) => ({
      targetId: target.targetId,
      faultStateClear: target.faultStateClear,
      expectedServiceRunning: target.expectedServiceRunning,
      observerFresh: target.observerFresh,
      checkedAtMs: target.checkedAtMs,
    })),
  };
}
