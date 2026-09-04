import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Request } from 'express';
import { config } from '../config.js';

/** The signed assertion Cloudflare Access sends to an origin. */
export const CLOUDFLARE_ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';

export interface CloudflareAccessJwtSettings {
  /** `https://<team>.cloudflareaccess.com`, never a caller-provided URL. */
  teamDomain: string;
  /** The immutable Application Audience (AUD) tag of this Access application. */
  audience: string;
}

/**
 * Pull only the identity claim the sign-in route needs from a *verified* token.
 * Claim parsing is kept separate so the cryptographic gate stays impossible to
 * bypass accidentally by treating a decoded, unverified JWT as an identity.
 */
export function accessSubject(payload: JWTPayload): string | null {
  return typeof payload.email === 'string' && payload.email.trim() !== '' ? payload.email : null;
}

/**
 * Create one verifier for one Access application. `createRemoteJWKSet` caches
 * signing keys and refreshes on a new `kid`, which is necessary because Access
 * rotates its signing key. The configured issuer and audience bind a valid
 * Cloudflare token to this team and this application, not merely to any Access
 * application the account happens to host.
 */
export function createCloudflareAccessJwtVerifier(settings: CloudflareAccessJwtSettings) {
  const jwks = createRemoteJWKSet(new URL(`${settings.teamDomain}/cdn-cgi/access/certs`));
  return async (token: string | undefined): Promise<string | null> => {
    if (token === undefined || token.trim() === '') return null;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: settings.teamDomain,
        audience: settings.audience,
        // Cloudflare Access application tokens are RS256. Pinning it avoids
        // accepting another asymmetric algorithm merely because a key advertises it.
        algorithms: ['RS256'],
      });
      return accessSubject(payload);
    } catch {
      // Verification failures are deliberately indistinguishable to callers:
      // malformed, expired, wrong-audience and bad-signature tokens all fail shut.
      return null;
    }
  };
}

function configuredSettings(): CloudflareAccessJwtSettings | null {
  const access = config.adminBrowser.accessJwt;
  return access.teamDomain === '' || access.audience === ''
    ? null
    : { teamDomain: access.teamDomain, audience: access.audience };
}

const settings = configuredSettings();
const verifyConfiguredAccessJwt = settings === null ? null : createCloudflareAccessJwtVerifier(settings);

/** Whether this process is configured to verify a Cloudflare Access assertion. */
export function cloudflareAccessJwtEnabled(): boolean {
  return verifyConfiguredAccessJwt !== null;
}

/** The verified Access subject, or null when the assertion is absent or invalid. */
export async function verifiedCloudflareAccessSubject(req: Request): Promise<string | null> {
  return verifyConfiguredAccessJwt === null
    ? null
    : verifyConfiguredAccessJwt(req.get(CLOUDFLARE_ACCESS_JWT_HEADER));
}
