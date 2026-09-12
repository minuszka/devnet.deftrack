import type { SimulationControlRun, SimulationPreflight } from './admin-api.js';

/**
 * What the panel is allowed to believe about a simulation run.
 *
 * Three rules, and each of them replaces a guess the panel was making.
 *
 * **A late answer is not a new one.** The server's projection carries its own
 * ordering key, `state.revision`, incremented on every transition. The panel
 * never read it, so two responses in flight resolved in arrival order and the
 * slower one won -- which, for a control surface, means a run that has already
 * aborted can be redrawn as running. Ordering is decided here, on the server's
 * number, not on a counter this file invents.
 *
 * **An answer about another run is not about this one.** Selecting run B while
 * a request for run A is in flight used to let A's answer land on B's panel.
 *
 * **Recovery evidence is unknown until the server sends some.** The control
 * API's run projection selects `runKey`, `metadataFingerprint`, `metadata` and
 * `state` -- the stored recovery result is a separate field on the document and
 * no endpoint returns it. So the honest answer is "not reported", and it is
 * said rather than filled in. A lease countdown reaching zero is not evidence
 * either: it means the deadline passed, not that anything was cleaned up.
 */

export type RunUpdateOutcome =
  | 'accepted'
  /** An answer about a run that is not the selected one. */
  | 'other-run'
  /** An answer describing a state the selected run has already left. */
  | 'stale-revision';

/**
 * May this answer replace what is already held?
 *
 * The one rule, exported so the store and the components that hold a run
 * directly cannot disagree about it. Equal revisions are accepted: an
 * idempotent replay answers with the same one, and taking the newer object
 * costs nothing. Strictly older is refused -- that is the late answer.
 */
export function acceptsRunUpdate(
  held: SimulationControlRun | null | undefined,
  incoming: SimulationControlRun
): boolean {
  if (held === null || held === undefined) return true;
  if (held.runKey !== incoming.runKey) return false;
  return incoming.state.revision >= held.state.revision;
}

export type RecoveryEvidence =
  | { known: false; reason: 'not-reported' }
  | { known: true; allClear: boolean; targetCount: number };

/** The shape a server that DID report recovery would use. Not sent today. */
export interface RecoveryResultView {
  required: boolean;
  allClear: boolean;
  targets: Array<{ targetId: string }>;
}

export function recoveryEvidence(
  recovery: RecoveryResultView | null | undefined
): RecoveryEvidence {
  if (recovery === null || recovery === undefined) return { known: false, reason: 'not-reported' };
  return { known: true, allClear: recovery.allClear, targetCount: recovery.targets.length };
}

/**
 * Whether the lab may still be faulted, said only from what the server reports.
 *
 * `faultMayBeActive` is in the projection and is the safety-relevant bit: it
 * stays true until a successful recovery proves the remote mutation is gone.
 * `allClear` is deliberately three-valued -- a panel that cannot establish the
 * lab is clean must say so, not default to either answer.
 */
export interface RunSafetyView {
  faultMayBeActive: boolean;
  leaseExpiresAtMs: number | null;
  abortRequested: boolean;
  allClear: 'yes' | 'no' | 'unknown';
}

export function runSafety(
  run: SimulationControlRun,
  recovery?: RecoveryResultView | null
): RunSafetyView {
  const evidence = recoveryEvidence(recovery);
  return {
    faultMayBeActive: run.state.faultMayBeActive,
    leaseExpiresAtMs: run.state.faultLeaseExpiresAtMs,
    abortRequested: run.state.abortRequested,
    // Not from the lease, and not from the status alone. Only from evidence.
    allClear: evidence.known ? (evidence.allClear ? 'yes' : 'no') : 'unknown',
  };
}

/** What the panel holds about one selected run. */
export interface SelectedRun {
  runKey: string;
  run: SimulationControlRun | null;
  /** The saved preflight, when one has actually been run. Never assumed. */
  preflight: SimulationPreflight | null;
}

/**
 * The selection, and the rule for what may overwrite it.
 *
 * Deliberately not a Lit controller and deliberately clock-free: what it
 * decides is decidable from the responses alone, which is what makes it
 * testable without a browser.
 */
export class SelectedRunStore {
  private selected: SelectedRun | null = null;

  get current(): SelectedRun | null {
    return this.selected;
  }

  get runKey(): string | null {
    return this.selected?.runKey ?? null;
  }

  /**
   * Point at a run, discarding anything held for a different one.
   *
   * Selecting the same key again keeps what is already loaded: re-selecting is
   * not a reason to blank the screen.
   */
  select(runKey: string): void {
    if (this.selected?.runKey === runKey) return;
    this.selected = { runKey, run: null, preflight: null };
  }

  clear(): void {
    this.selected = null;
  }

  /**
   * Offer a run projection. Returns what was decided, so a caller can tell a
   * dropped answer from an applied one rather than guessing from the state.
   */
  accept(run: SimulationControlRun): RunUpdateOutcome {
    const selected = this.selected;
    if (selected === null || selected.runKey !== run.runKey) return 'other-run';

    if (!acceptsRunUpdate(selected.run, run)) return 'stale-revision';

    this.selected = { ...selected, run };
    return 'accepted';
  }

  /**
   * Offer a preflight result. Tied to the same run, and only stored when the
   * server actually produced one: "not run" and "passed" are different answers
   * and the panel must never turn the first into the second.
   */
  acceptPreflight(runKey: string, preflight: SimulationPreflight): RunUpdateOutcome {
    const selected = this.selected;
    if (selected === null || selected.runKey !== runKey) return 'other-run';
    this.selected = { ...selected, preflight };
    return 'accepted';
  }
}
