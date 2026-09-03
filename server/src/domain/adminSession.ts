import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SimulationControlRole } from '../models/SimulationControlRequest.js';

/**
 * The pure half of browser sign-in for the admin surface.
 *
 * The control API is deliberately non-browser: it takes an API key in a header
 * and refuses any request that carries a cookie or an Origin, so that the key
 * can never end up in a browser. A panel needs a browser, so it needs a second
 * door -- and the whole point of this module is that the second door must not
 * weaken the first. Nothing here touches the key path; it stands beside it.
 *
 * Everything that can be decided without a request or a database is decided
 * here, so the rules are testable on their own: who may sign in and as what,
 * what a session id and a CSRF token look like, how the cookie is written and
 * read, and when a session has expired.
 */

export const SESSION_COOKIE = 'deftrack_admin_session';
export const CSRF_HEADER = 'x-csrf-token';

/** What a signed-in browser is allowed to be. */
export interface AdminIdentity {
  /** The identity the proxy asserted -- an email, typically. Never trusted from the client. */
  subject: string;
  role: SimulationControlRole;
}

export interface AdminSessionRecord {
  /** sha256 of the id the cookie carries. The raw id is never stored. */
  idHash: string;
  subject: string;
  role: SimulationControlRole;
  csrfToken: string;
  createdAtMs: number;
  expiresAtMs: number;
}

/**
 * Who may sign in, and with which role.
 *
 * Declared server-side as `ADMIN_IDENTITIES`, JSON of subject to role:
 *
 *   {"alice@example.org": "safety-admin", "bob@example.org": "operator"}
 *
 * A subject the proxy asserts but this list does not name is refused. The proxy
 * says WHO someone is; only this deployment says what they may do, and it is
 * not something a header gets to claim.
 */
export function parseIdentityAllowlist(raw: string): ReadonlyMap<string, SimulationControlRole> {
  const allowed = new Map<string, SimulationControlRole>();
  if (raw.trim() === '') return allowed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`ADMIN_IDENTITIES is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('ADMIN_IDENTITIES must be an object of subject to role');
  }
  for (const [subject, role] of Object.entries(parsed as Record<string, unknown>)) {
    if (subject.trim() === '') throw new Error('ADMIN_IDENTITIES has an empty subject');
    if (role !== 'operator' && role !== 'safety-admin') {
      throw new Error(`ADMIN_IDENTITIES["${subject}"] must be operator or safety-admin, got ${JSON.stringify(role)}`);
    }
    // Subjects are compared case-insensitively: proxies disagree about the case
    // of an email, and "Alice@" being a stranger while "alice@" is an admin is
    // not a distinction anyone intends.
    allowed.set(subject.trim().toLowerCase(), role);
  }
  return allowed;
}

export function resolveIdentity(
  allowlist: ReadonlyMap<string, SimulationControlRole>,
  assertedSubject: string
): AdminIdentity | null {
  const subject = assertedSubject.trim().toLowerCase();
  if (subject === '') return null;
  const role = allowlist.get(subject);
  return role === undefined ? null : { subject, role };
}

/**
 * Whether the peer that delivered this request is one that may assert identity.
 *
 * Compared against the SOCKET address, never against X-Forwarded-For. The
 * forwarded header is written by whoever sent the request, so trusting it here
 * would let any client claim to be the proxy and then assert any identity. The
 * socket address is the one fact the client cannot write.
 *
 * IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is normalised, because that is how Node
 * reports a loopback peer on a dual-stack listener and an allowlist written as
 * `127.0.0.1` should match it.
 */
export function isTrustedProxy(remoteAddress: string | undefined, trusted: readonly string[]): boolean {
  if (remoteAddress === undefined || trusted.length === 0) return false;
  const normalised = remoteAddress.startsWith('::ffff:') ? remoteAddress.slice('::ffff:'.length) : remoteAddress;
  return trusted.includes(normalised) || trusted.includes(remoteAddress);
}

/** 256 bits of randomness, URL-safe. Guessing one is not a strategy. */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * What is stored for a session id. The raw id lives only in the cookie, so a
 * copy of the sessions collection does not sign anyone in.
 */
export function hashSessionId(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

export function newSession(input: {
  identity: AdminIdentity;
  nowMs: number;
  ttlMs: number;
}): { id: string; record: AdminSessionRecord } {
  if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0) {
    throw new Error('session ttl must be a positive integer');
  }
  const id = newSessionId();
  return {
    id,
    record: {
      idHash: hashSessionId(id),
      subject: input.identity.subject,
      role: input.identity.role,
      csrfToken: newCsrfToken(),
      createdAtMs: input.nowMs,
      expiresAtMs: input.nowMs + input.ttlMs,
    },
  };
}

export function isSessionLive(record: Pick<AdminSessionRecord, 'expiresAtMs'>, nowMs: number): boolean {
  return record.expiresAtMs > nowMs;
}

/** Constant-time, and false rather than thrown on a length mismatch. */
export function tokensMatch(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Methods that change something, and so must carry the CSRF token. */
export function isMutatingMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper !== 'GET' && upper !== 'HEAD' && upper !== 'OPTIONS';
}

/**
 * The Set-Cookie value for a session.
 *
 * HttpOnly: script cannot read it, so the id cannot be exfiltrated by XSS.
 * SameSite=Strict: a cross-site request does not carry it at all, which is the
 * first line against CSRF; the token is the second. Path-scoped to the admin
 * API so it is never sent to the public explorer. Secure is on by default and
 * can only be turned off explicitly, for a lab served over plain http on
 * loopback -- and that is the one place it may be.
 */
export function sessionCookie(input: {
  id: string;
  expiresAtMs: number;
  secure: boolean;
  path?: string;
}): string {
  const parts = [
    `${SESSION_COOKIE}=${input.id}`,
    `Path=${input.path ?? '/api/v1/admin'}`,
    `Expires=${new Date(input.expiresAtMs).toUTCString()}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (input.secure) parts.push('Secure');
  return parts.join('; ');
}

/** The Set-Cookie value that removes the session cookie. */
export function clearedSessionCookie(input: { secure: boolean; path?: string }): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    `Path=${input.path ?? '/api/v1/admin'}`,
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (input.secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * The session id a Cookie header carries, or null.
 *
 * Deliberately minimal: it looks for one named cookie and nothing else. A
 * general cookie parser would be more code in the one place where every byte
 * is attacker-supplied.
 */
export function sessionIdFromCookieHeader(header: string | undefined): string | null {
  if (header === undefined || header === '') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    // The id is base64url from newSessionId; anything else is not ours.
    return /^[A-Za-z0-9_-]{32,64}$/.test(value) ? value : null;
  }
  return null;
}
