import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.resetModules();
});
async function callback(hash) {
  vi.resetModules();
  window.history.replaceState(null, '', '/auth/callback' + hash);
  return import('../src/client/auth/callback.js');
}
it('verifies a recovery session once, scrubs URL and retains recovery kind', async () => {
  const module = await callback(
    '#access_token=synthetic&refresh_token=synthetic&type=recovery&sb=discarded',
  );
  const client = {
    auth: {
      setSession: vi.fn().mockResolvedValue({ data: { session: {} } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'a' } } }),
    },
  };
  expect(window.location.hash).toBe('');
  expect(module.initialCallbackKind).toBe('recovery');
  const [a, b] = await Promise.all([
    module.handleAuthCallback(client),
    module.handleAuthCallback(client),
  ]);
  expect(a).toEqual({ kind: 'recovery', ok: true });
  expect(b).toEqual(a);
  expect(client.auth.setSession).toHaveBeenCalledOnce();
});
it('clears a failed callback session without returning token errors', async () => {
  const module = await callback('#access_token=synthetic&refresh_token=synthetic&type=recovery');
  const client = {
    auth: {
      setSession: vi.fn().mockResolvedValue({ error: new Error('secret-token') }),
      signOut: vi.fn().mockResolvedValue({}),
    },
  };
  expect(await module.handleAuthCallback(client)).toEqual({ kind: 'recovery', ok: false });
  expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});
it('supports confirmation callbacks and rejects expired links before SDK calls', async () => {
  const module = await callback('#error=access_denied&error_code=otp_expired');
  const client = { auth: { setSession: vi.fn() } };
  expect(await module.handleAuthCallback(client)).toEqual({ kind: 'invalid', ok: false });
  expect(client.auth.setSession).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('');
});
