/**
 * Resolving a coinstake's producing host from immutable, window-scoped
 * stake-script sightings.
 *
 * The question this answers -- "is one machine minting everything?" -- decides
 * whether a measurement is worth anything, so the answer has to be the same
 * every time it is asked of the same evidence. That rules out joining against
 * the current wallet view (`HostStatus.stakeScripts`), which is overwritten on
 * every agent post; the join target has to be append-only sightings, read for
 * exactly the height window the report covers.
 *
 * Pure so the arithmetic can be tested without a chain or a database.
 */
export interface StakeScriptSighting {
  host: string;
  /** Lowercased coinstake payout script the host reported holding. */
  script: string;
  /** The host's chain height when it reported holding the script. */
  height: number;
}

export interface AttributionWindow {
  fromHeight: number;
  toHeight: number;
}

/**
 * Each payout script -> the single host that owns it within the window, or
 * `null` when the sightings are ambiguous.
 *
 * - Exactly one host reported the script in the window -> attributed to it.
 * - Two or more hosts reported it -> `null`. A pay-to-pubkey script is one key,
 *   and two machines claiming one key is shared control, attributable to
 *   neither. This is the same rule the previous read-time join applied to a
 *   cross-host collision.
 * - No host reported it in the window -> absent from the map. The caller reads
 *   an absent script as unattributed and counts it on its own, rather than
 *   crediting whoever posted most recently.
 *
 * Window-scoped and order-independent: the same sightings and window always
 * produce the same map, so the fingerprint it feeds does not drift as the live
 * host view is overwritten.
 */
export function resolveScriptOwners(
  sightings: readonly StakeScriptSighting[],
  window: AttributionWindow
): Map<string, string | null> {
  const hostsByScript = new Map<string, Set<string>>();
  for (const sighting of sightings) {
    if (sighting.height < window.fromHeight || sighting.height > window.toHeight) continue;
    let hosts = hostsByScript.get(sighting.script);
    if (hosts === undefined) {
      hosts = new Set<string>();
      hostsByScript.set(sighting.script, hosts);
    }
    hosts.add(sighting.host);
  }

  const owners = new Map<string, string | null>();
  for (const [script, hosts] of hostsByScript) {
    owners.set(script, hosts.size === 1 ? [...hosts][0]! : null);
  }
  return owners;
}
