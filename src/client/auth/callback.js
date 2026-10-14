// Capture once and scrub before SDK/session initialization or rendering.
export function captureAuthCallback(location, history) {
  if (location.pathname !== '/auth/callback') return null;
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  history.replaceState(null, '', '/auth/callback');
  const type = hash.get('type');
  const allowed = ['access_token', 'refresh_token', 'type', 'expires_in', 'expires_at', 'token_type', 'sb'];
  if (query.size || hash.has('error') || !['recovery', 'signup'].includes(type)
    || [...hash.keys()].some((key) => !allowed.includes(key) || hash.getAll(key).length !== 1)
    || !hash.get('access_token') || !hash.get('refresh_token')) return { kind: 'invalid' };
  return { kind: type, access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token') };
}
const callback = typeof window === 'undefined' ? null : captureAuthCallback(window.location, window.history);
const runs = new WeakMap();
export const initialCallbackKind = callback?.kind ?? null;
export function handleAuthCallback(client) {
  if (!callback) return Promise.resolve(null);
  if (!runs.has(client)) runs.set(client, (async () => {
    if (callback.kind === 'invalid') return { kind: 'invalid', ok: false };
    const failed = async () => {
      try { await client.auth.signOut({ scope: 'local' }); } catch { /* Remain in the error view. */ }
      return { kind: callback.kind, ok: false };
    };
    try {
      const { data, error } = await client.auth.setSession({ access_token: callback.access_token, refresh_token: callback.refresh_token });
      // setSession refreshes expired access tokens; user verification rejects invalid tokens.
      if (error || !data?.session) return await failed();
      const verified = await client.auth.getUser();
      if (verified.error || !verified.data?.user) return await failed();
      return { kind: callback.kind, ok: true };
    } catch { return await failed(); }
    finally { delete callback.access_token; delete callback.refresh_token; }
  })());
  return runs.get(client);
}
export function authRedirectUrl() {
  // Fixed same-origin path; never use URL-provided next/redirect parameters.
  return new URL('/auth/callback', window.location.origin).href;
}
