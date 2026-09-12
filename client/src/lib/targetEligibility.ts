/**
 * Whether a registered target can be chosen for one field of one draft, and if
 * not, why -- in words an operator can act on.
 *
 * DISPLAY ONLY. The server decides, in two places, and this mirrors both so a
 * chooser can mark a target it will refuse instead of letting somebody pick it
 * and learn the reason from an error:
 *
 *   - the resolver's candidate filter -- same network, enabled, not in
 *     maintenance -- applied before any scenario sees a target at all;
 *   - the executor's eligibility for the scenario -- a role and a capability --
 *     which the server serves on the field (`target`), and proves against
 *     `generateDryRunPlan` in `scenarioFields.test.ts`.
 *
 * The role is read from the registry's `role` field and from nothing else. A
 * target's NAME is never evidence of what it is: on this fleet one host's
 * `mn11` is a masternode where every other host's instance 11 is a staker, and
 * reading the name nearly took that masternode off the network once.
 */

export type TargetRole = 'masternode' | 'staker' | 'seed';
export type TargetCapability = 'service-control' | 'netem-p2p' | 'partition-p2p' | 'dsl-test-hook';

export interface EligibleTarget {
  targetId: string;
  role: TargetRole;
  network: 'regtest' | 'devnet';
  enabled: boolean;
  maintenance: boolean;
  /** Absent on a server that does not send it; treated as unknown, not as none. */
  capabilities?: TargetCapability[];
}

export interface TargetRequirement {
  role?: TargetRole;
  /** The parameter whose value is the required role. */
  roleFrom?: string;
  capability?: TargetCapability;
}

export type Eligibility = { ok: true } | { ok: false; reason: string };

/**
 * The first reason a target cannot be chosen, or `ok`.
 *
 * Ordered from the most fundamental to the most specific: a target on the
 * wrong network is wrong whatever its role, and saying "wrong role" first would
 * send somebody looking in the wrong place.
 */
export function eligibility(
  target: EligibleTarget,
  requirement: TargetRequirement | undefined,
  draft: { network: 'regtest' | 'devnet'; params: Record<string, unknown> }
): Eligibility {
  if (target.network !== draft.network) {
    return { ok: false, reason: `on ${target.network}; this draft is for ${draft.network}` };
  }
  if (!target.enabled) return { ok: false, reason: 'disabled in the registry' };
  if (target.maintenance) return { ok: false, reason: 'in maintenance' };

  const req = requirement ?? {};
  const role =
    req.role ?? (req.roleFrom !== undefined ? (draft.params[req.roleFrom] as TargetRole | undefined) : undefined);
  if (role !== undefined && target.role !== role) {
    return { ok: false, reason: `a ${target.role}; this needs a ${role}` };
  }
  if (req.capability !== undefined) {
    // A server that does not report capabilities cannot be second-guessed from
    // here. Refusing would block every target on an older server; accepting is
    // safe because the executor still refuses the wrong one.
    if (target.capabilities !== undefined && !target.capabilities.includes(req.capability)) {
      return { ok: false, reason: `has no ${req.capability}` };
    }
  }
  return { ok: true };
}
