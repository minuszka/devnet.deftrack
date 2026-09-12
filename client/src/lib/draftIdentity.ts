/**
 * What makes two draft submissions the same request.
 *
 * The create idempotency key was scoped to the draft's seed and nothing else.
 * So after a Prepare whose outcome was uncertain -- a timeout, a 503, anything
 * that may or may not have been applied -- editing the parameters, the
 * scenario, the network or the mode sent a DIFFERENT body under the SAME key.
 *
 * That is not a near miss. The server binds a key to the fingerprint of the
 * payload it first saw and refuses any other one with `IDEMPOTENCY_CONFLICT`,
 * so the corrected draft could not be created at all until the page was
 * reloaded -- and the panel would have reported the refusal as though the
 * correction itself were wrong.
 *
 * The rule is the one the server already keeps: the same payload is the same
 * request, and any difference is a new one. `canonicalJson` is deliberately the
 * same algorithm the server fingerprints with -- key order included, by code
 * unit rather than by locale, `undefined` members dropped
 * (`server/src/domain/simulationAudit.ts`, `server/src/domain/codeUnitOrder.ts`)
 * -- so the two cannot disagree about what "the same request" means. A client
 * that were stricter would mint a new key where the server would have accepted
 * a replay; a client that were laxer would reuse a key the server refuses.
 */

/** Mirrors the server's canonical form exactly; see the note above. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('a draft cannot carry a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      // Code unit order, not `localeCompare`: a canonical form that depends on
      // the runtime's ICU build is not canonical.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new Error(`a draft cannot carry a ${typeof value}`);
}

const FNV_PRIME = 0x01000193;

/** Four offsets, four independent passes: 128 bits out of a 32-bit hash. */
const OFFSETS = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b] as const;

function fnv1a(text: string, offset: number): number {
  let hash = offset >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    hash = Math.imul(hash ^ (unit & 0xff), FNV_PRIME) >>> 0;
    hash = Math.imul(hash ^ (unit >>> 8), FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A short, stable label for one draft.
 *
 * Not a cryptographic digest and not pretending to be. It names a scope in the
 * panel's own retry table; the authority on whether two requests are the same
 * is the server's SHA-256 over this same canonical form. A collision here would
 * make the server answer `IDEMPOTENCY_CONFLICT` -- visible and refused, unlike
 * the failure it replaces, which was a wrong key sent silently. `crypto.subtle`
 * would be a real digest but is async and absent outside a secure context, and
 * neither is worth paying for a label.
 *
 * Short on purpose: the server takes an 8-200 character key, and this sits
 * inside a longer one.
 */
export function draftFingerprint(request: unknown): string {
  const text = canonicalJson(request);
  return OFFSETS.map((offset) => fnv1a(text, offset).toString(16).padStart(8, '0')).join('');
}

/** The retry scope for a draft: the request itself, never its seed alone. */
export function draftScope(request: unknown): string {
  return `draft:${draftFingerprint(request)}`;
}
