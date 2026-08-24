import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { sendError } from '../utils/http.js';

/**
 * Guards the agent ingest endpoint.
 *
 * Separate from the admin key on purpose: eight agents hold this token, so it
 * is the one most likely to leak, and it must never be able to do anything but
 * add observations. Compared in constant time so a wrong token cannot be
 * discovered a character at a time.
 */
export function requireIngestToken(req: Request, res: Response, next: NextFunction): void {
  const expected = config.ingest.token;
  if (expected.length === 0) {
    sendError(res, 503, 'ingest is not configured');
    return;
  }

  const provided = req.get('x-ingest-token') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    sendError(res, 401, 'invalid or missing X-Ingest-Token');
    return;
  }

  next();
}
