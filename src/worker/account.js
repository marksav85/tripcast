import { createClient } from '@supabase/supabase-js';
import { verifySupabaseAccessToken } from './auth.js';
import { ApiError, invalid } from './errors.js';
import { readLimitedJSON } from './validation.js';

const project = 'https://oowesugpxxzvyvfqqxlu.supabase.co';
const unavailable = () => new ApiError('ACCOUNT_DELETE_FAILED', 503, 'Could not delete your account. Please try again later.');

export async function deleteAccount(request, env, { verify = verifySupabaseAccessToken, makeClient = createClient } = {}) {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i);
  if (!bearer || bearer[1].length > 16384) throw new ApiError('UNAUTHENTICATED', 401, 'Sign in again before deleting your account.');
  const identity = await verify(bearer[1], env);
  if (new URL(request.url).search || !request.headers.get('content-type')?.startsWith('application/json')) throw invalid();
  const body = await readLimitedJSON(request.body, 1024, invalid());
  if (!body || Object.keys(body).length !== 1 || body.confirmation !== 'DELETE') throw invalid();
  // Pin the administrative destination: never send a privileged key to a configurable URL.
  if (env.SUPABASE_JWT_ISSUER !== `${project}/auth/v1`
    || !/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(env.SUPABASE_SECRET_KEY ?? '')) throw unavailable();
  try {
    const admin = makeClient(project, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, options) => fetch(input, { ...options, redirect: 'manual', signal: AbortSignal.timeout(10000) }) },
    });
    // JWT verification alone doesn't establish that the Auth user still exists.
    const current = await admin.auth.getUser(bearer[1]);
    if (current.error || current.data?.user?.id !== identity.userId) throw unavailable();
    // Hard delete once. Existing database FKs cascade to trips and destinations atomically.
    const deleted = await admin.auth.admin.deleteUser(identity.userId, false);
    if (deleted.error || deleted.data?.user?.id !== identity.userId) throw unavailable();
    return { deleted: true };
  } catch { throw unavailable(); } // Never return SDK errors, credentials or response bodies.
}
