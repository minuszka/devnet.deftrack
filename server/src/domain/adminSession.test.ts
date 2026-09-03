import { describe, expect, it } from 'vitest';
import {
  clearedSessionCookie,
  hashSessionId,
  isMutatingMethod,
  isSessionLive,
  isTrustedProxy,
  newSession,
  parseIdentityAllowlist,
  resolveIdentity,
  sessionCookie,
  sessionIdFromCookieHeader,
  tokensMatch,
} from './adminSession.js';

describe('who may sign in', () => {
  it('names subjects and roles, case-insensitively', () => {
    const list = parseIdentityAllowlist('{"Alice@Example.org":"safety-admin","bob@example.org":"operator"}');
    expect(resolveIdentity(list, 'alice@example.org')).toEqual({ subject: 'alice@example.org', role: 'safety-admin' });
    expect(resolveIdentity(list, '  BOB@example.org ')).toEqual({ subject: 'bob@example.org', role: 'operator' });
  });

  it('refuses a subject the proxy asserts but the deployment never named', () => {
    // The proxy says WHO someone is; only this deployment says what they may do.
    const list = parseIdentityAllowlist('{"alice@example.org":"operator"}');
    expect(resolveIdentity(list, 'mallory@example.org')).toBeNull();
    expect(resolveIdentity(list, '')).toBeNull();
  });

  it('refuses nobody at all when nothing is declared', () => {
    expect(resolveIdentity(parseIdentityAllowlist(''), 'alice@example.org')).toBeNull();
  });

  it('throws on a declaration it cannot honour, rather than defaulting', () => {
    expect(() => parseIdentityAllowlist('nope')).toThrow(/not valid JSON/);
    expect(() => parseIdentityAllowlist('[]')).toThrow(/object of subject to role/);
    expect(() => parseIdentityAllowlist('{"a@b":"root"}')).toThrow(/operator or safety-admin/);
    expect(() => parseIdentityAllowlist('{"":"operator"}')).toThrow(/empty subject/);
  });
});

describe('who may assert an identity', () => {
  it('trusts only the socket peer, and only if listed', () => {
    expect(isTrustedProxy('127.0.0.1', ['127.0.0.1'])).toBe(true);
    expect(isTrustedProxy('10.0.0.9', ['127.0.0.1'])).toBe(false);
    expect(isTrustedProxy(undefined, ['127.0.0.1'])).toBe(false);
  });

  it('trusts nobody when nothing is listed', () => {
    // An empty allowlist must mean "browser sign-in is off", not "anyone".
    expect(isTrustedProxy('127.0.0.1', [])).toBe(false);
  });

  it('matches a loopback peer reported as IPv4-mapped IPv6', () => {
    expect(isTrustedProxy('::ffff:127.0.0.1', ['127.0.0.1'])).toBe(true);
  });
});

describe('a session', () => {
  const identity = { subject: 'alice@example.org', role: 'operator' as const };

  it('stores a hash of the id, never the id', () => {
    const { id, record } = newSession({ identity, nowMs: 1_000, ttlMs: 60_000 });
    expect(record.idHash).toBe(hashSessionId(id));
    expect(record.idHash).not.toBe(id);
    expect(JSON.stringify(record)).not.toContain(id);
  });

  it('is unguessable and never repeats', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSession({ identity, nowMs: 0, ttlMs: 1 }).id));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('expires exactly when it says', () => {
    const { record } = newSession({ identity, nowMs: 1_000, ttlMs: 60_000 });
    expect(isSessionLive(record, 60_999)).toBe(true);
    expect(isSessionLive(record, 61_000)).toBe(false);
  });

  it('refuses a ttl that is not a positive integer', () => {
    expect(() => newSession({ identity, nowMs: 0, ttlMs: 0 })).toThrow(/positive integer/);
    expect(() => newSession({ identity, nowMs: 0, ttlMs: 1.5 })).toThrow(/positive integer/);
  });
});

describe('the CSRF token', () => {
  it('is compared in constant time and never throws on a mismatched length', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abd', 'abc')).toBe(false);
    expect(tokensMatch('ab', 'abc')).toBe(false);
    expect(tokensMatch(undefined, 'abc')).toBe(false);
  });

  it('is demanded on anything that changes state', () => {
    for (const method of ['POST', 'put', 'Delete', 'PATCH']) expect(isMutatingMethod(method)).toBe(true);
    for (const method of ['GET', 'head', 'OPTIONS']) expect(isMutatingMethod(method)).toBe(false);
  });
});

describe('the cookie', () => {
  it('cannot be read by script, is never sent cross-site, and stays on the admin path', () => {
    const cookie = sessionCookie({ id: 'abc', expiresAtMs: 0, secure: true });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/api/v1/admin');
    expect(cookie.startsWith('deftrack_admin_session=abc;')).toBe(true);
  });

  it('drops Secure only when told to, for a lab on plain loopback http', () => {
    expect(sessionCookie({ id: 'abc', expiresAtMs: 0, secure: false })).not.toContain('Secure');
    expect(clearedSessionCookie({ secure: false })).toContain('Max-Age=0');
  });

  it('reads back exactly one named cookie and nothing else', () => {
    expect(sessionIdFromCookieHeader('a=1; deftrack_admin_session=' + 'x'.repeat(43) + '; b=2')).toBe(
      'x'.repeat(43)
    );
    expect(sessionIdFromCookieHeader('other=abc')).toBeNull();
    expect(sessionIdFromCookieHeader(undefined)).toBeNull();
    // Not the shape we mint: refused rather than looked up.
    expect(sessionIdFromCookieHeader('deftrack_admin_session=not valid!')).toBeNull();
    expect(sessionIdFromCookieHeader('deftrack_admin_session=short')).toBeNull();
  });
});
