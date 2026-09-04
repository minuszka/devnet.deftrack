import { beforeEach, describe, expect, it, vi } from 'vitest';

const jose = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(() => 'remote-jwks'),
  jwtVerify: vi.fn(),
}));

vi.mock('jose', () => jose);
vi.mock('../config.js', () => ({
  config: { adminBrowser: { accessJwt: { teamDomain: '', audience: '' } } },
}));

import { accessSubject, createCloudflareAccessJwtVerifier } from './cloudflareAccessJwt.js';

const settings = {
  teamDomain: 'https://deftrack.cloudflareaccess.com',
  audience: 'a'.repeat(64),
};

describe('Cloudflare Access JWT identity proof', () => {
  beforeEach(() => {
    jose.createRemoteJWKSet.mockClear();
    jose.jwtVerify.mockReset();
  });

  it('does not turn a missing assertion into an identity', async () => {
    const verify = createCloudflareAccessJwtVerifier(settings);
    await expect(verify(undefined)).resolves.toBeNull();
    expect(jose.jwtVerify).not.toHaveBeenCalled();
  });

  it('accepts only the verified email claim and pins the Access issuer, AUD and RS256', async () => {
    jose.jwtVerify.mockResolvedValue({ payload: { email: 'admin@example.test' } });
    const verify = createCloudflareAccessJwtVerifier(settings);

    await expect(verify('signed-token')).resolves.toBe('admin@example.test');
    expect(jose.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL('https://deftrack.cloudflareaccess.com/cdn-cgi/access/certs')
    );
    expect(jose.jwtVerify).toHaveBeenCalledWith('signed-token', 'remote-jwks', {
      issuer: settings.teamDomain,
      audience: settings.audience,
      algorithms: ['RS256'],
    });
  });

  it('rejects a bad signature and a verified token with no usable email', async () => {
    jose.jwtVerify.mockRejectedValueOnce(new Error('signature invalid'));
    const verify = createCloudflareAccessJwtVerifier(settings);
    await expect(verify('forged-token')).resolves.toBeNull();

    jose.jwtVerify.mockResolvedValueOnce({ payload: { sub: 'not-an-email' } });
    await expect(verify('signed-without-email')).resolves.toBeNull();
  });

  it('does not accept a blank email claim', () => {
    expect(accessSubject({ email: '   ' })).toBeNull();
  });
});
