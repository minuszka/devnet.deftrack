import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '../config.js';
import {
  CSRF_HEADER,
  hashSessionId,
  isMutatingMethod,
  isSessionLive,
  sessionIdFromCookieHeader,
  tokensMatch,
  type AdminIdentity,
} from '../domain/adminSession.js';
import { AdminSession } from '../models/AdminSession.js';
import { requireAdminApiKey } from './requireAdminApiKey.js';
import { sendError } from '../utils/http.js';
import { cloudflareAccessJwtEnabled } from './cloudflareAccessJwt.js';

/**
 * Who a request is acting as, once it has been let in by either door.
 *
 * Set on every authenticated request so a route has ONE place to read identity
 * and role from, whichever way the caller came in. The key path yields the
 * server-configured actor, as it always did; a session yields the subject the
 * proxy asserted and the role this deployment gave it.
 */
export interface AuthenticatedAdmin extends AdminIdentity {
  via: 'api-key' | 'session';
  /** Present on a session; the token a mutating request must echo. */
  csrfToken: string | null;
}

declare module 'express-serve-static-core' {
  interface Locals {
    admin?: AuthenticatedAdmin;
  }
}

export function browserSignInEnabled(): boolean {
  const browser = config.adminBrowser;
  const hasIdentitySource = cloudflareAccessJwtEnabled() || browser.identityHeader !== '';
  // A production browser door accepts only a signed Cloudflare Access assertion.
  // Development keeps the narrow local-proxy/header route so the lab can prove
  // sessions without a public Access tenant.
  const hasRequiredProductionProof = config.env !== 'production' || cloudflareAccessJwtEnabled();
  return hasIdentitySource && hasRequiredProductionProof && browser.trustedProxies.length > 0 && browser.identities.trim() !== '';
}

/**
 * The live session behind a request's cookie, or null.
 *
 * Null for a missing cookie, an unknown id, an expired session and a revoked
 * one alike. The caller does not learn which -- there is nothing a browser
 * should do differently, and the distinction would only help someone probing.
 */
export async function sessionForRequest(
  req: Request,
  nowMs: number
): Promise<{ id: string; identity: AdminIdentity; csrfToken: string } | null> {
  const id = sessionIdFromCookieHeader(req.get('cookie'));
  if (id === null) return null;
  const record = await AdminSession.findOne({ idHash: hashSessionId(id) })
    .select('subject role csrfToken expiresAtMs revokedAtMs')
    .lean();
  if (record === null || record.revokedAtMs !== null || !isSessionLive(record, nowMs)) return null;
  return { id, identity: { subject: record.subject, role: record.role }, csrfToken: record.csrfToken };
}

/**
 * Either door, never both.
 *
 * A request that carries a session cookie is judged by the session: it must be
 * live, and if it changes anything it must echo the session's CSRF token. A
 * request without one is judged by the API key exactly as before -- including
 * the refusal of any cookie or Origin on that path, which is what keeps the key
 * out of browsers.
 *
 * A request carrying BOTH a session cookie and an API key is refused outright.
 * There is no honest reason for one caller to hold both, and a request built
 * that way is most likely one credential being used to launder the other.
 */
export const requireAdminAuth: RequestHandler = (req, res, next) => {
  void authenticate(req, res, next);
};

async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const hasKey = (req.get('x-admin-api-key') ?? '') !== '';
  const hasSessionCookie = sessionIdFromCookieHeader(req.get('cookie')) !== null;

  if (hasKey && hasSessionCookie) {
    sendError(res, 400, 'a request may carry an API key or a session, not both');
    return;
  }

  if (!hasSessionCookie) {
    // The key path, unchanged: the key must never sit in a browser, so anything
    // that looks like one is turned away before the key is even checked.
    if (req.get('origin') || req.get('cookie')) {
      sendError(res, 403, 'browser credentials are not accepted on the API-key path; sign in for a session');
      return;
    }
    requireAdminApiKey(req, res, () => {
      res.locals.admin = {
        via: 'api-key',
        subject: config.simulator.adminActorId,
        role: config.simulator.adminRole,
        csrfToken: null,
      };
      next();
    });
    return;
  }

  if (!browserSignInEnabled()) {
    // A cookie arrived at a deployment that never issued one. Not an error to
    // explain in detail; the door is simply not there.
    sendError(res, 401, 'browser sign-in is not enabled on this deployment');
    return;
  }

  let session: Awaited<ReturnType<typeof sessionForRequest>>;
  try {
    session = await sessionForRequest(req, Date.now());
  } catch (error) {
    next(error);
    return;
  }
  if (session === null) {
    sendError(res, 401, 'session is missing, expired or revoked; sign in again');
    return;
  }
  if (isMutatingMethod(req.method) && !tokensMatch(req.get(CSRF_HEADER), session.csrfToken)) {
    // SameSite=Strict already keeps a cross-site request from carrying the
    // cookie. This is the second lock on the same door, for the day the first
    // is loosened for some reason nobody has thought of yet.
    sendError(res, 403, `mutating requests must carry the session CSRF token in ${CSRF_HEADER}`);
    return;
  }
  res.locals.admin = { via: 'session', ...session.identity, csrfToken: session.csrfToken };
  next();
}

/** The identity a route may act as. Only meaningful after requireAdminAuth. */
export function adminOf(res: Response): AuthenticatedAdmin {
  const admin = res.locals.admin;
  if (admin === undefined) {
    // A route reached without the guard is a wiring mistake, not a user error,
    // and it must not be answered as though nobody was there.
    throw new Error('admin identity read on a route that was not guarded by requireAdminAuth');
  }
  return admin;
}
