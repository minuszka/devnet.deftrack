import type { RequestHandler, Response } from 'express';

export type CachePolicyProfile = 'no-store' | 'short' | 'medium' | 'long';

/**
 * Cache windows are chosen against the shape of the data, not guessed:
 *
 *  - short  (10 s)  chain tip and anything derived from it
 *  - medium (60 s)  round listings; a DKG round is 72 blocks ~ 3 hours, so a
 *                   minute of staleness cannot hide a state change
 *  - long   (300 s) aggregates over many rounds
 */
const PROFILES: Record<Exclude<CachePolicyProfile, 'no-store'>, number> = {
  short: 10,
  medium: 60,
  long: 300,
};

export function applyCachePolicy(res: Response, profile: CachePolicyProfile): void {
  res.setHeader('X-Cache-Profile', profile);

  if (profile === 'no-store') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    return;
  }

  const seconds = PROFILES[profile];
  res.setHeader('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${seconds}`);
}

export function withCachePolicy(profile: CachePolicyProfile): RequestHandler {
  return (_req, res, next) => {
    applyCachePolicy(res, profile);
    next();
  };
}
