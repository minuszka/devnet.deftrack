import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import type { ApiEnvelope, Page } from '@devnet-deftrack/shared';
import { logger } from './logger.js';

export function sendData<T>(res: Response, data: T): void {
  const body: ApiEnvelope<T> = { success: true, data };
  res.json(body);
}

export function sendError(res: Response, status: number, message: string): void {
  const body: ApiEnvelope<never> = { success: false, error: message };
  res.status(status).json(body);
}

/**
 * Always report the true match count next to the page.
 *
 * The production `/events` endpoint silently truncates at its limit, so a
 * caller cannot tell a complete answer from a clipped one. Every paged
 * response here carries `total`.
 */
export function page<T>(items: T[], total: number, limit: number, offset: number): Page<T> {
  return { items, total, limit, offset };
}

/**
 * Validate `req.query` against a schema, answering 400 with the reason.
 *
 * Typed on the schema rather than its output, because `.default()` and
 * `.coerce` make a schema's input and output types differ.
 */
export function validateQuery<S extends ZodTypeAny>(schema: S): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`)
        .join('; ');
      sendError(res, 400, detail);
      return;
    }
    // Stash the parsed value; req.query itself is not writable in Express 5.
    res.locals.query = parsed.data as ZodInfer<S>;
    next();
  };
}

export function parsedQuery<T>(res: Response): T {
  return res.locals.query as T;
}

/** Wrap an async handler so a rejected promise becomes a 500, not a hang. */
export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch((error: unknown) => {
      logger.error(`${req.method} ${req.originalUrl} failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) sendError(res, 500, 'internal error');
      else next(error);
    });
  };
}
