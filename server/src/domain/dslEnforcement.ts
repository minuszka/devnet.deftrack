/**
 * Is the DSL verdict acting, or only being recorded?
 *
 * The Sentinel Layer has two phases on one chain, and the difference is the
 * whole of what a reader needs to know before interpreting a missed epoch:
 * below the enforcement height a verdict is written and nobody is touched;
 * at and above it `nMissedEpochs` suspends rewards and then sets
 * `nDSLBanHeight`, which `IsBanned()` reads -- consensus, not bookkeeping.
 *
 * This module exists because the summary endpoint reported `enforcement: false`
 * as a hardcoded literal, with a comment calling the layer a shadow. That was
 * true when it was written and stopped being true on 2026-09-05, when
 * enforcement went live on this devnet at height 8304: run
 * `dsl-enforcement-outage-2026-09-05` then measured a reward suspension at 8496
 * and a DSL ban at 8520. For six days the API and the page said the opposite of
 * what the chain was doing, which is the one kind of wrongness this project
 * treats as worse than a missing number.
 *
 * The height is declared in config, never inferred: `-dslenforcementheight` is
 * a devnet startup argument and no RPC reports it, exactly like
 * `-dslactivationheight`.
 *
 * Pure arithmetic, free of config, RPC and database imports.
 */

export interface DslEnforcementState {
  /** The declared gate, or null when this deployment schedules none. */
  height: number | null;
  /** Whether the indexed chain has reached it. */
  active: boolean;
}

/**
 * `enforcementHeight` of 0 or less means unscheduled (the node's default is an
 * unreachable height, so "no gate" and "a gate at 0" must not read alike).
 *
 * `indexedTip` is null before anything is indexed. Then the answer is `false`
 * and not "unknown": a gate that cannot be shown to have been reached has not
 * been reached as far as this record goes, and inventing activity from an empty
 * index would be the same error in the other direction.
 */
export function dslEnforcementState(
  enforcementHeight: number,
  indexedTip: number | null
): DslEnforcementState {
  if (!Number.isFinite(enforcementHeight) || enforcementHeight <= 0) {
    return { height: null, active: false };
  }
  const tip = indexedTip ?? -1;
  return { height: enforcementHeight, active: tip >= enforcementHeight };
}
