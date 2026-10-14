import { afterEach, expect, it, vi } from 'vitest';
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn(() => ({ auth: {} })) }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); createClient.mockClear(); });
it('initializes one persistent refreshing client across repeated imports', async () => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_synthetic_test_public_value');
  const first = await import('../src/client/api/supabase.js');
  const second = await import('../src/client/api/supabase.js');
  expect(first.supabase).toBe(second.supabase);
  expect(createClient).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:54321', 'sb_publishable_synthetic_test_public_value', {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
});
it('does not create a client with missing configuration', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  const module = await import('../src/client/api/supabase.js');
  expect(module.supabase).toBeNull(); expect(createClient).not.toHaveBeenCalled();
});
it('sanitizes client initialization failures', async () => {
  vi.stubEnv('DEV', true); vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_synthetic_test_public_value');
  createClient.mockImplementationOnce(() => { throw new Error('privileged-details'); });
  const module = await import('../src/client/api/supabase.js');
  expect(module.supabase).toBeNull(); expect(module.authConfigurationError).not.toContain('privileged-details');
});
