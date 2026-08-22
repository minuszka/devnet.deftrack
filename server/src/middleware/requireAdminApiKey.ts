import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { config } from '../config.js';
import { sendError } from '../utils/http.js';

/**
 * Guards the operator-onboarding routes.
 *
 * If no key is configured the routes are refused outright rather than left
 * open: an unset secret must fail closed, not silently disable the check.
 */
export const requireAdminApiKey: RequestHandler = (req, res, next) => {
  const expected = config.adminApiKey;
  if (!expected) {
    sendError(res, 503, 'admin API is disabled: ADMIN_API_KEY is not configured');
    return;
  }

  const header = req.get('x-admin-api-key') ?? '';
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // Compare in constant time, and only when the lengths already match --
  // timingSafeEqual throws on a length mismatch.
  const ok = a.length === b.length && timingSafeEqual(a, b);

  if (!ok) {
    sendError(res, 401, 'invalid or missing X-Admin-Api-Key');
    return;
  }
  next();
};
