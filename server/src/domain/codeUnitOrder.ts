/**
 * String ordering that does not depend on the machine.
 *
 * `localeCompare` uses the runtime's default locale and ICU build, so two hosts
 * can order the same strings differently. Anywhere that ordering decides a
 * fingerprint, a canonical form or a report that must recompute byte for byte,
 * that is a defect waiting for a host with a different locale -- and the
 * divergence is real, not theoretical: over the alphabet a targetId is allowed
 * to use, 9,033 of 200,000 random pairs sort differently under the two rules
 * (`a_0b0` against `a-zz`, for one).
 *
 * `domain/dslCanonicalOrder` already said this for the DSL bitfield -- "a
 * collation that varies with the runtime's ICU build has no business deciding a
 * consensus reading". The same is true of every plan, snapshot and measurement
 * that has to reproduce exactly; this is that rule, in one place, so the next
 * sort does not have to rediscover it.
 *
 * Display-only ordering may still use collation: sorting metric names for a
 * human reader is not a reproducibility claim.
 */
export function compareByCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
