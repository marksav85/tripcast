import { afterEach, expect, it, vi } from 'vitest';
import {
  clearDeletedAccountStorage,
  finishAccountDeletion,
} from '../src/client/auth/deletedAccount.js';
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});
it.each(['reject', 'error'])(
  'clears persistence and navigates after confirmed deletion despite signOut %s',
  async (mode) => {
    const key = 'sb-test-auth-token';
    for (const suffix of ['', '-user', '-code-verifier'])
      localStorage.setItem(key + suffix, 'synthetic');
    localStorage.setItem('unrelated', 'keep');
    const client = {
      auth: {
        signOut: vi.fn(() =>
          mode === 'reject'
            ? Promise.reject(new Error('private'))
            : Promise.resolve({ error: new Error('private') }),
        ),
        stopAutoRefresh: vi.fn(),
      },
    };
    const clearState = vi.fn();
    const navigate = vi.fn(() => {
      expect(localStorage.getItem(key)).toBeNull();
    });
    await finishAccountDeletion(client, {
      clearState,
      navigate,
      clearStorage: () => clearDeletedAccountStorage(key),
    });
    expect(clearState).toHaveBeenCalledOnce();
    expect(client.auth.stopAutoRefresh).toHaveBeenCalledOnce();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(navigate).toHaveBeenCalledOnce();
    expect(localStorage.getItem('unrelated')).toBe('keep');
    expect(localStorage.getItem(key + '-user')).toBeNull();
    expect(localStorage.getItem(key + '-code-verifier')).toBeNull();
  },
);
it('does not wait indefinitely for authenticated SDK cleanup', async () => {
  vi.useFakeTimers();
  const navigate = vi.fn();
  const clearStorage = vi.fn();
  const client = { auth: { signOut: () => new Promise(() => {}) } };
  const work = finishAccountDeletion(client, { navigate, clearStorage });
  await vi.advanceTimersByTimeAsync(1000);
  await work;
  expect(clearStorage).toHaveBeenCalledTimes(2);
  expect(navigate).toHaveBeenCalledOnce();
});
