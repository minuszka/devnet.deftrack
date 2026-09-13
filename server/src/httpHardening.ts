import type { Express } from 'express';
import helmet from 'helmet';

/**
 * What every HTTP server in this package does before it mounts a single route.
 *
 * There are two -- the API (`index.ts`) and the lab executor's API
 * (`labServer.ts`) -- and until day 20 each built its own Express app by hand.
 * The API switched Express to the simple query parser to take the `qs`
 * advisories off the reachable path; the lab server never did, so the
 * accepted-risk note that said "not reachable" was true of one server and not
 * the other. One function, called by both, is what keeps that from recurring.
 *
 * Order matters, and not obviously: Express reads `query parser` when the
 * router is first created, which the first `app.use` does. Set after that,
 * the setting is stored and silently ignored.
 */
export function hardenHttpApp(app: Express): void {
  app.disable('x-powered-by');
  // The extended parser is qs, which carries the array-limit and isBuffer
  // advisories and builds arbitrary nested objects from a public query string.
  // Every route here validates with zod and none accepts a nested query, so the
  // simple parser loses nothing and removes the attack surface entirely.
  app.set('query parser', 'simple');
  app.use(
    helmet({
      // One owner for HSTS: whoever terminates TLS, which is nginx. With both,
      // /api/ responses carried two Strict-Transport-Security headers -- this
      // one-year value first, and a browser honours only the first -- so the
      // two years nginx sets never held on the API. HSTS over plain HTTP is
      // ignored by browsers anyway, so a server reached without nginx loses
      // nothing a browser would have kept.
      strictTransportSecurity: false,
    })
  );
}
