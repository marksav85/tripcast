import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifySupabaseAccessToken } from '../../src/worker/auth.js';

const subject = '73b72c22-0014-4bf8-9abe-f42394c52220';
let env, pair, keys, upstream, sequence = 0;
const now = () => Math.floor(Date.now() / 1000);
async function key(kid) {
  const generated = await generateKeyPair('ES256');
  return { ...generated, jwk: { ...await exportJWK(generated.publicKey), kid, alg: 'ES256', use: 'sig' }, kid };
}
async function token(claims = {}, header = {}, signing = pair) {
  return new SignJWT({ iss: env.SUPABASE_JWT_ISSUER, aud: 'authenticated', sub: subject,
    role: 'authenticated', exp: now() + 3600, ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: signing.kid, ...header }).sign(signing.privateKey);
}
async function denied(jwt, config = env) {
  await expect(verifySupabaseAccessToken(jwt, config)).rejects.toMatchObject({
    code: 'UNAUTHENTICATED', status: 401, message: 'A valid authenticated session is required.',
  });
}
beforeEach(async () => {
  env = { STAGE: 'local', SUPABASE_JWT_ISSUER: 'http://127.0.0.1:54321/auth/v1',
    SUPABASE_JWKS_URL: `http://127.0.0.1:54321/keys-${sequence++}`,
    SUPABASE_JWT_AUDIENCE: 'authenticated', SUPABASE_JWT_ALGORITHMS: 'ES256' };
  pair = await key('first'); keys = [pair.jwk];
  upstream = vi.fn(async () => new Response(JSON.stringify({ keys }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', upstream);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('isolated Supabase JWT verifier', () => {
  it('returns only verified identity and caches public keys', async () => {
    const jwt = await token({ email: 'synthetic@example.test' });
    expect(await verifySupabaseAccessToken(jwt, env)).toEqual({ userId: subject, role: 'authenticated', expiresAt: now() + 3600 });
    await verifySupabaseAccessToken(jwt, env);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(String(upstream.mock.calls[0][0])).toBe(env.SUPABASE_JWKS_URL);
  });
  it('rejects a signature from another key and modified content', async () => {
    await denied(await token({}, {}, await key('first')));
    const jwt = await token();
    const parts = jwt.split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: subject, role: 'authenticated', exp: now() + 1000 })).toString('base64url');
    await denied(parts.join('.'));
  });
  it.each([
    ['expired', () => ({ exp: now() - 1 })],
    ['missing expiration', () => ({ exp: undefined })],
    ['invalid expiration', () => ({ exp: 'tomorrow' })],
    ['future nbf', () => ({ nbf: now() + 120 })],
    ['invalid nbf', () => ({ nbf: 'later' })],
    ['issuer', () => ({ iss: 'https://untrusted.example/auth/v1' })],
    ['audience', () => ({ aud: 'anon' })],
    ['role', () => ({ role: 'service_role' })],
    ['missing role', () => ({ role: undefined })],
    ['missing subject', () => ({ sub: undefined })],
    ['malformed subject', () => ({ sub: 'not-a-user-id' })],
  ])('rejects %s', async (_label, claims) => { await denied(await token(claims())); });
  it.each([null, '', 'not.a.jwt', 42])('rejects malformed input %s', async (jwt) => { await denied(jwt); });
  it('rejects HS256 without fetching keys', async () => {
    const jwt = await new SignJWT({ sub: subject, exp: now() + 100 }).setProtectedHeader({ alg: 'HS256' }).sign(new Uint8Array(32));
    await denied(jwt); expect(upstream).not.toHaveBeenCalled();
  });
  it('requires a signing key ID', async () => { await denied(await token({}, { kid: undefined })); });
  it('bounds unknown-key refreshes and accepts rotation after cooldown', async () => {
    vi.useFakeTimers();
    await verifySupabaseAccessToken(await token(), env);
    const rotated = await key('rotated'); keys = [pair.jwk, rotated.jwk];
    const jwt = await token({}, {}, rotated);
    await denied(jwt); await denied(jwt);
    expect(upstream).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 31000);
    await expect(verifySupabaseAccessToken(jwt, env)).resolves.toMatchObject({ userId: subject });
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it('refreshes keys at bounded cache expiry and fails safely during an outage', async () => {
    vi.useFakeTimers(); const jwt = await token();
    await verifySupabaseAccessToken(jwt, env);
    upstream.mockRejectedValue(new Error('private upstream details'));
    await expect(verifySupabaseAccessToken(jwt, env)).resolves.toMatchObject({ userId: subject });
    vi.setSystemTime(Date.now() + 600001);
    await denied(jwt); expect(upstream).toHaveBeenCalledTimes(2);
  });
  it('sanitizes a JWKS fetch failure', async () => {
    upstream.mockRejectedValue(new Error('private upstream details'));
    await denied(await token());
  });
  it('times out a stalled JWKS request', async () => {
    upstream.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }));
    await denied(await token());
  }, 7000);
  it('accepts explicit HTTPS production configuration', async () => {
    env = { ...env, STAGE: 'production', SUPABASE_JWT_ISSUER: 'https://synthetic.example/auth/v1',
      SUPABASE_JWKS_URL: 'https://synthetic.example/auth/v1/.well-known/jwks.json' };
    await expect(verifySupabaseAccessToken(await token({ nbf: now() - 1 }), env)).resolves.toMatchObject({ userId: subject });
  });
  it('fails closed when the entire environment is missing', async () => {
    await expect(verifySupabaseAccessToken('invalid')).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', status: 503 });
  });
  it.each([new Response('not json'), new Response(JSON.stringify({ keys: [] })),
    new Response(null, { status: 302, headers: { Location: 'https://evil.example/keys' } })])('rejects unusable or redirected JWKS', async (response) => {
    upstream.mockResolvedValue(response);
    await denied(await token());
    expect(upstream.mock.calls[0][1].redirect).toBe('manual');
  });
  it('rejects an HTTP error response', async () => {
    upstream.mockResolvedValue(new Response('unavailable', { status: 503 }));
    await denied(await token());
  });
  it('ignores token headers pointing at untrusted key sources', async () => {
    const evil = await key('first');
    await denied(await token({}, { jku: 'https://evil.example/jwks', x5u: 'https://evil.example/cert', jwk: evil.jwk }, evil));
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(String(upstream.mock.calls[0][0])).toBe(env.SUPABASE_JWKS_URL);
  });
  it('does not bypass authentication in weather mock mode', async () => {
    await denied('invalid', { ...env, MOCK_PROVIDER: 'true' });
  });
  it.each([
    { SUPABASE_JWT_ISSUER: undefined }, { SUPABASE_JWKS_URL: undefined },
    { SUPABASE_JWT_AUDIENCE: undefined }, { SUPABASE_JWT_ALGORITHMS: undefined },
    { SUPABASE_JWT_ISSUER: 'garbage' }, { SUPABASE_JWKS_URL: 'http://remote.example/keys' },
    { STAGE: 'production' }, { SUPABASE_JWT_AUDIENCE: ' ' },
    { SUPABASE_JWT_ALGORITHMS: 'HS256' }, { SUPABASE_JWT_ALGORITHMS: 'ES256,HS256' },
    { SUPABASE_JWKS_URL: 'https://user:password@example.test/keys' },
    { SUPABASE_JWKS_URL: 'https://example.test/keys#fragment' },
  ])('fails closed for invalid configuration %j', async (patch) => {
    await expect(verifySupabaseAccessToken(await token(), { ...env, ...patch })).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', status: 503 });
    expect(upstream).not.toHaveBeenCalled();
  });
});
