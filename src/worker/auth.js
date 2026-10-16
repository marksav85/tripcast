import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { ApiError } from './errors.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// One trusted configuration per isolate; changing configuration replaces its resolver.
let cached;

function trustedUrl(value, local) {
  if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error();
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error();
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && loopback && url.protocol === 'http:')) throw new Error();
  return url;
}

function configuration(env) {
  try {
    const issuer = trustedUrl(env.SUPABASE_JWT_ISSUER, env.STAGE === 'local');
    const jwks = trustedUrl(env.SUPABASE_JWKS_URL, env.STAGE === 'local');
    if (typeof env.SUPABASE_JWT_AUDIENCE !== 'string' || !env.SUPABASE_JWT_AUDIENCE.trim()
      || env.SUPABASE_JWT_AUDIENCE.trim() !== env.SUPABASE_JWT_AUDIENCE) throw new Error();
    // Only the locally confirmed signing algorithm is enabled in this batch.
    if (env.SUPABASE_JWT_ALGORITHMS !== 'ES256') throw new Error();
    return { issuer: env.SUPABASE_JWT_ISSUER, audience: env.SUPABASE_JWT_AUDIENCE,
      algorithms: ['ES256'], jwks, key: JSON.stringify([issuer.href, jwks.href, env.SUPABASE_JWT_AUDIENCE, env.SUPABASE_JWT_ALGORITHMS]) };
  } catch {
    throw new ApiError('AUTH_UNAVAILABLE', 503, 'Authentication is unavailable. Please try again later.');
  }
}

/** Verify a raw access token. No request routing, provider mode, or decoded-claim fallback. */
export async function verifySupabaseAccessToken(token, env = {}) {
  const config = configuration(env);
  if (!cached || cached.key !== config.key) {
    cached = { key: config.key, resolver: createRemoteJWKSet(config.jwks, {
      cacheMaxAge: 600000, cooldownDuration: 30000, timeoutDuration: 5000,
    }) };
  }
  try {
    if (typeof token !== 'string' || !token || token.length > 16384) throw new Error();
    const resolver = cached.resolver;
    const { payload, protectedHeader } = await jwtVerify(token, async (...args) => {
      try { return await resolver(...args); } catch (error) {
        if (error instanceof errors.JWKSNoMatchingKey) throw error;
        throw new ApiError('AUTH_UNAVAILABLE', 503, 'Authentication is unavailable. Please try again later.');
      }
    }, {
      issuer: config.issuer, audience: config.audience, algorithms: config.algorithms,
      requiredClaims: ['exp', 'sub', 'role'],
    });
    if (typeof protectedHeader.kid !== 'string' || !protectedHeader.kid.trim()
      || typeof payload.sub !== 'string' || !uuid.test(payload.sub)
      || payload.role !== 'authenticated' || !Number.isFinite(payload.exp)) throw new Error();
    return { userId: payload.sub, role: 'authenticated', expiresAt: payload.exp };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'AUTH_UNAVAILABLE') throw error;
    throw new ApiError('UNAUTHENTICATED', 401, 'A valid authenticated session is required.');
  }
}
