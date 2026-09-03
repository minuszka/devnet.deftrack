import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config.js';
import {
  clearedSessionCookie,
  hashSessionId,
  isTrustedProxy,
  newSession,
  parseIdentityAllowlist,
  resolveIdentity,
  sessionCookie,
} from '../../domain/adminSession.js';
import { browserSignInEnabled, sessionForRequest } from '../../middleware/adminSession.js';
import { withCachePolicy } from '../../middleware/cachePolicy.js';
import { AdminSession } from '../../models/AdminSession.js';
import { asyncRoute, sendData, sendError } from '../../utils/http.js';

/**
 * Signing a browser in and out of the admin surface.
 *
 * This is the only place the proxy's identity header is read, and it is read
 * only from a listed proxy. Everything after sign-in rides on the session
 * cookie; the header is never consulted again, so a request that reaches the
 * app some other way cannot become someone by naming them.
 *
 * Parsed once at startup: a malformed allowlist stops the server rather than
 * signing nobody in silently -- or worse, everybody.
 */
const allowlist = parseIdentityAllowlist(config.adminBrowser.identities);

const router = Router();

// Sign-in is the one route an unauthenticated peer can hit, so it gets its own,
// tighter budget: a proxy has no reason to sign the same person in ten times a
// minute, and nothing else should be reaching this at all.
router.use(rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false }));
router.use(withCachePolicy('no-store'));

/**
 * Exchange the proxy-asserted identity for a session.
 *
 * Fails closed at every step, and says as little as it can about which one:
 * the door is either open for this peer and this subject, or it is not.
 */
router.post(
  '/',
  asyncRoute(async (req, res) => {
    if (!browserSignInEnabled()) {
      sendError(res, 404, 'browser sign-in is not enabled on this deployment');
      return;
    }
    // The SOCKET peer, never a forwarded header: the forwarded header is what a
    // client would write to claim it is the proxy.
    if (!isTrustedProxy(req.socket.remoteAddress, config.adminBrowser.trustedProxies)) {
      sendError(res, 403, 'sign-in is accepted only from the identity proxy');
      return;
    }
    const asserted = req.get(config.adminBrowser.identityHeader) ?? '';
    const identity = resolveIdentity(allowlist, asserted);
    if (identity === null) {
      sendError(res, 403, 'this identity is not permitted to sign in');
      return;
    }

    const nowMs = Date.now();
    const { id, record } = newSession({ identity, nowMs, ttlMs: config.adminBrowser.sessionTtlMs });
    await AdminSession.create({ ...record, expiresAt: new Date(record.expiresAtMs), revokedAtMs: null });

    res.setHeader('Set-Cookie', sessionCookie({ id, expiresAtMs: record.expiresAtMs, secure: config.adminBrowser.cookieSecure }));
    // The CSRF token is handed over exactly once, here, over the response body
    // of a same-site request. Script on the panel keeps it; the cookie it pairs
    // with is HttpOnly, so neither half is enough on its own.
    sendData(res, { subject: identity.subject, role: identity.role, csrfToken: record.csrfToken, expiresAtMs: record.expiresAtMs });
  })
);

/** Who am I, and what is my CSRF token. A panel calls this on load. */
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const session = await sessionForRequest(req, Date.now());
    if (session === null) {
      sendError(res, 401, 'no live session');
      return;
    }
    sendData(res, { subject: session.identity.subject, role: session.identity.role, csrfToken: session.csrfToken });
  })
);

/**
 * Sign out. Revokes on the server and clears the cookie; the row itself is left
 * for the TTL sweep, revoked, so the id cannot be replayed until then either.
 */
router.delete(
  '/',
  asyncRoute(async (req, res) => {
    const session = await sessionForRequest(req, Date.now());
    if (session !== null) {
      await AdminSession.updateOne({ idHash: hashSessionId(session.id) }, { $set: { revokedAtMs: Date.now() } });
    }
    res.setHeader('Set-Cookie', clearedSessionCookie({ secure: config.adminBrowser.cookieSecure }));
    sendData(res, { signedOut: true });
  })
);

export default router;
