import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The decision table of the two-door guard. Each row is a claim about what a
 * request is judged by, and the wrong answer on any of them is a way for the
 * API key to reach a browser or for a browser to act as someone else.
 */

const state = vi.hoisted(() => ({
  config: {
    adminApiKey: 'the-key',
    simulator: { adminActorId: 'admin-api-key', adminRole: 'operator' as 'operator' | 'safety-admin' },
    adminBrowser: {
      identityHeader: 'x-identity',
      trustedProxies: ['127.0.0.1'],
      identities: '{"alice@example.org":"safety-admin"}',
      sessionTtlMs: 60_000,
      cookieSecure: false,
      accessJwt: { teamDomain: '', audience: '' },
    },
  },
  sessions: new Map<string, { subject: string; role: string; csrfToken: string; expiresAtMs: number; revokedAtMs: number | null }>(),
}));

vi.mock('../config.js', () => ({ config: state.config }));
vi.mock('../models/AdminSession.js', () => ({
  AdminSession: {
    findOne: (filter: { idHash: string }) => ({
      select: () => ({ lean: async () => state.sessions.get(filter.idHash) ?? null }),
    }),
  },
}));

import { hashSessionId, newSessionId } from '../domain/adminSession.js';
import { requireAdminAuth } from './adminSession.js';

interface Sent {
  status: number | null;
  body: unknown;
  locals: Record<string, unknown>;
}

function run(input: { method?: string; headers?: Record<string, string> }): Promise<{ sent: Sent; next: boolean }> {
  const headers = Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const sent: Sent = { status: null, body: null, locals: {} };
  const req = {
    method: input.method ?? 'GET',
    get: (name: string) => headers[name.toLowerCase()],
  };
  const res = {
    locals: sent.locals,
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
    setHeader() {
      return this;
    },
  };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (next: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ sent, next });
    };
    // sendError writes status+json synchronously; a passed request calls next.
    const origJson = res.json.bind(res);
    res.json = (body: unknown) => {
      origJson(body);
      finish(false);
      return res;
    };
    requireAdminAuth(req as never, res as never, () => finish(true));
  });
}

function liveSession(overrides: Partial<{ role: string; expiresAtMs: number; revokedAtMs: number | null }> = {}) {
  const id = newSessionId();
  state.sessions.set(hashSessionId(id), {
    subject: 'alice@example.org',
    role: overrides.role ?? 'safety-admin',
    csrfToken: 'csrf-token',
    expiresAtMs: overrides.expiresAtMs ?? Date.now() + 60_000,
    revokedAtMs: overrides.revokedAtMs ?? null,
  });
  return id;
}

beforeEach(() => {
  state.sessions.clear();
  state.config.adminBrowser.identityHeader = 'x-identity';
  state.config.adminBrowser.trustedProxies = ['127.0.0.1'];
  state.config.adminBrowser.identities = '{"alice@example.org":"safety-admin"}';
});

describe('the API-key door, unchanged', () => {
  it('admits the key and names the configured actor', async () => {
    const { sent, next } = await run({ headers: { 'x-admin-api-key': 'the-key' } });
    expect(next).toBe(true);
    expect(sent.locals.admin).toMatchObject({ via: 'api-key', subject: 'admin-api-key', role: 'operator' });
  });

  it('still refuses anything that looks like a browser on the key path', async () => {
    // This is the rule that keeps the key out of browsers, and the whole point
    // of the second door is that it must not loosen this one.
    const withOrigin = await run({ headers: { 'x-admin-api-key': 'the-key', origin: 'https://evil.example' } });
    expect(withOrigin.sent.status).toBe(403);
    const withForeignCookie = await run({ headers: { 'x-admin-api-key': 'the-key', cookie: 'other=1' } });
    expect(withForeignCookie.sent.status).toBe(403);
  });

  it('refuses a bad or missing key exactly as before', async () => {
    expect((await run({ headers: { 'x-admin-api-key': 'wrong' } })).sent.status).toBe(401);
    expect((await run({})).sent.status).toBe(401);
  });
});

describe('the session door', () => {
  it('admits a live session and names the subject', async () => {
    const id = liveSession();
    const { sent, next } = await run({ headers: { cookie: `deftrack_admin_session=${id}` } });
    expect(next).toBe(true);
    expect(sent.locals.admin).toMatchObject({ via: 'session', subject: 'alice@example.org', role: 'safety-admin' });
  });

  it('refuses an unknown, expired or revoked session alike, without saying which', async () => {
    const unknown = await run({ headers: { cookie: `deftrack_admin_session=${newSessionId()}` } });
    const expired = await run({ headers: { cookie: `deftrack_admin_session=${liveSession({ expiresAtMs: Date.now() - 1 })}` } });
    const revoked = await run({ headers: { cookie: `deftrack_admin_session=${liveSession({ revokedAtMs: 1 })}` } });
    for (const r of [unknown, expired, revoked]) {
      expect(r.sent.status).toBe(401);
      expect(r.next).toBe(false);
    }
    expect(JSON.stringify(unknown.sent.body)).toBe(JSON.stringify(expired.sent.body));
  });

  it('demands the CSRF token on anything that changes state, and only then', async () => {
    const id = liveSession();
    const cookie = `deftrack_admin_session=${id}`;
    expect((await run({ method: 'POST', headers: { cookie } })).sent.status).toBe(403);
    expect((await run({ method: 'POST', headers: { cookie, 'x-csrf-token': 'wrong' } })).sent.status).toBe(403);
    expect((await run({ method: 'POST', headers: { cookie, 'x-csrf-token': 'csrf-token' } })).next).toBe(true);
    // A read carries the cookie alone.
    expect((await run({ method: 'GET', headers: { cookie } })).next).toBe(true);
  });

  it('is simply not there when the deployment never enabled it', async () => {
    state.config.adminBrowser.identityHeader = '';
    const id = liveSession();
    const { sent } = await run({ headers: { cookie: `deftrack_admin_session=${id}` } });
    expect(sent.status).toBe(401);
  });
});

describe('both doors at once', () => {
  it('refuses a request that carries a session and an API key together', async () => {
    // No honest caller holds both; a request built that way is most likely one
    // credential being used to launder the other.
    const id = liveSession();
    const { sent, next } = await run({
      headers: { cookie: `deftrack_admin_session=${id}`, 'x-admin-api-key': 'the-key' },
    });
    expect(next).toBe(false);
    expect(sent.status).toBe(400);
  });
});
