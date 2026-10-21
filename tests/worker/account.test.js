import { expect, it, vi } from 'vitest';
import { deleteAccount } from '../../src/worker/account.js';
const owner = '73b72c22-0014-4bf8-9abe-f42394c52220';
const env = { SUPABASE_JWT_ISSUER: 'https://oowesugpxxzvyvfqqxlu.supabase.co/auth/v1', SUPABASE_SECRET_KEY: 'sb_secret_synthetic_test_only' };
const request = (body = { confirmation: 'DELETE' }) => new Request('https://tripcast.test/api/account', {
  method: 'DELETE', headers: { Authorization: 'Bearer a.b.c', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
function setup() {
  const remove = vi.fn().mockResolvedValue({ data: { user: { id: owner } } });
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: owner } } });
  const makeClient = vi.fn(() => ({ auth: { getUser, admin: { deleteUser: remove } } }));
  const verify = vi.fn().mockResolvedValue({ userId: owner });
  return { remove, getUser, makeClient, verify };
}
it('verifies JWT and live Auth user, then hard deletes only the verified identity once', async () => {
  const deps = setup();
  expect(await deleteAccount(request(), env, deps)).toEqual({ deleted: true });
  expect(deps.verify).toHaveBeenCalledWith('a.b.c', env);
  expect(deps.getUser).toHaveBeenCalledWith('a.b.c');
  expect(deps.remove).toHaveBeenCalledExactlyOnceWith(owner, false);
});
it('rejects browser-supplied identity and missing confirmation without administrative calls', async () => {
  for (const body of [{ confirmation: 'DELETE', userId: 'other' }, {}, { confirmation: 'delete' }]) {
    const deps = setup();
    await expect(deleteAccount(request(body), env, deps)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(deps.makeClient).not.toHaveBeenCalled();
  }
});
it('fails closed for missing authorization, invalid JWT, missing secret and wrong project', async () => {
  const deps = setup();
  const noAuth = request(); noAuth.headers.delete('Authorization');
  await expect(deleteAccount(noAuth, env, deps)).rejects.toMatchObject({ status: 401 });
  deps.verify.mockRejectedValueOnce(new Error('invalid token'));
  await expect(deleteAccount(request(), env, deps)).rejects.toThrow();
  for (const config of [{ ...env, SUPABASE_SECRET_KEY: '' }, { ...env, SUPABASE_JWT_ISSUER: 'https://other.test/auth/v1' }]) {
    await expect(deleteAccount(request(), config, deps)).rejects.toMatchObject({ code: 'ACCOUNT_DELETE_FAILED' });
  }
  expect(deps.makeClient).not.toHaveBeenCalled();
});
it('never deletes mismatched/stale users or exposes administrative errors', async () => {
  const deps = setup();
  deps.getUser.mockResolvedValueOnce({ data: { user: { id: 'other' } } });
  await expect(deleteAccount(request(), env, deps)).rejects.toMatchObject({ code: 'ACCOUNT_DELETE_FAILED' });
  expect(deps.remove).not.toHaveBeenCalled();
  deps.remove.mockResolvedValueOnce({ error: new Error('private upstream details') });
  await expect(deleteAccount(request(), env, deps)).rejects.toMatchObject({ message: 'Could not delete your account. Please try again later.' });
  expect(deps.remove).toHaveBeenCalledTimes(1);
});
it('rejects oversized confirmation bodies before creating the privileged client', async () => {
  const deps = setup();
  await expect(deleteAccount(request({ confirmation: 'x'.repeat(2048) }), env, deps)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(deps.makeClient).not.toHaveBeenCalled();
});
it('keeps route method, origin and bearer guards ahead of administrative work', async () => {
  const { createWorker } = await import('../../src/worker/index.js');
  const worker = createWorker();
  for (const [method, headers, status] of [
    ['POST', {}, 405], ['DELETE', { Origin: 'https://foreign.test' }, 403], ['DELETE', {}, 401],
  ]) {
    const response = await worker.fetch(new Request('https://tripcast.test/api/account', { method, headers }), env);
    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).not.toContain(env.SUPABASE_SECRET_KEY);
  }
});
it('confirms successful deletion even when Auth does not echo the deleted user', async () => {
  const deps = setup();
  deps.remove.mockResolvedValue({ data: { user: {} }, error: null });
  await expect(deleteAccount(request(), env, deps)).resolves.toEqual({ deleted: true });
  expect(deps.remove).toHaveBeenCalledExactlyOnceWith(owner, false);
});
it('accepts the real SDK transform of an empty successful Auth DELETE response', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const upstream = vi.fn(async (input, options) => {
    if (options.method === 'GET') return Response.json({ id: owner });
    expect(options.method).toBe('DELETE');
    return Response.json({});
  });
  const deps = setup();
  deps.makeClient = (url, key, options) => createClient(url, key, { ...options, global: { fetch: upstream } });
  await expect(deleteAccount(request(), env, deps)).resolves.toEqual({ deleted: true });
  expect(upstream).toHaveBeenCalledTimes(2);
});
