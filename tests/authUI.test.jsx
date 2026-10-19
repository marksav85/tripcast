import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AuthContext } from '../src/client/auth/context.js';
import AuthPanel from '../src/client/components/auth/AuthPanel.jsx';
import { captureAuthCallback } from '../src/client/auth/callback.js';
import { deferred } from './fixtures/weather';
function setup(extra = {}) {
  const auth = { signUp: vi.fn(), signInWithPassword: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() };
  const state = { client: { auth }, user: null, loading: false, recoveryStatus: null, completeRecovery: vi.fn(), ...extra };
  const view = render(<AuthContext.Provider value={state}><AuthPanel /></AuthContext.Provider>);
  return { auth, state, ...view };
}
function fill(password = 'secret123') {
  const email = screen.queryByLabelText('Email'); if (email) fireEvent.change(email, { target: { value: 'synthetic@example.test' } });
  fireEvent.change(screen.getByLabelText(/^(New password|Password)$/), { target: { value: password } });
}
function submit(name) { fireEvent.submit(screen.getByRole('form', { name })); }
it('validates email and password without a network call', () => {
  const { auth } = setup(); fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  submit('Create account'); expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  fill('short'); submit('Create account'); expect(screen.getByText('Use at least 6 characters.', { selector: 'output' })).toBeInTheDocument();
  expect(auth.signUp).not.toHaveBeenCalled();
});
it.each([null, { user: { id: 'a' } }])('registers and distinguishes confirmation/session %#', async (session) => {
  const { auth } = setup(); auth.signUp.mockResolvedValue({ data: { session } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' })); fill(); submit('Create account');
  await screen.findByText(session ? 'Account ready. You are signed in.' : /Check your email to confirm/);
  expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({ options: { emailRedirectTo: window.location.origin + '/auth/callback' } }));
  expect(screen.getByLabelText('Password')).toHaveValue('');
});
it('does not enumerate existing registration accounts or expose upstream errors', async () => {
  const { auth } = setup(); auth.signUp.mockResolvedValue({ error: { code: 'user_already_exists', message: 'token-secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' })); fill(); submit('Create account');
  await screen.findByText(/Check your email, or try signing in/); expect(document.body.textContent).not.toContain('token-secret');
});
it.each([false, true])('handles sign-in success/invalid credentials=%s', async (invalid) => {
  const { auth } = setup(); auth.signInWithPassword.mockResolvedValue(invalid ? { error: { code: 'invalid_credentials' } } : { data: {} });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); fill(); submit('Sign in');
  await screen.findByText(invalid ? /Unable to sign in/ : 'You are signed in.');
});
it('blocks duplicate submissions and clears pending state on service failure', async () => {
  const pending = deferred(); const { auth } = setup(); auth.signInWithPassword.mockReturnValue(pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); fill(); submit('Sign in'); submit('Sign in');
  expect(auth.signInWithPassword).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
  await act(async () => pending.reject(new Error('private'))); await screen.findByText(/Authentication service is unavailable/);
});
it('requests recovery with a fixed callback and neutral feedback', async () => {
  const { auth } = setup(); auth.resetPasswordForEmail.mockResolvedValue({});
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'synthetic@example.test' } }); submit('Forgot password');
  await screen.findByText(/If an account can receive recovery email/);
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('synthetic@example.test', { redirectTo: window.location.origin + '/auth/callback' });
});
it('keeps reset view for a recovery session and updates password', async () => {
  const { auth, state } = setup({ user: { id: 'a' }, recoveryStatus: 'ready' }); auth.updateUser.mockResolvedValue({ data: {} });
  expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  fill(); submit('Set new password'); await screen.findByText('Password updated.');
  expect(auth.updateUser).toHaveBeenCalledWith({ password: 'secret123' }); expect(state.completeRecovery).toHaveBeenCalled();
});
it('shows invalid recovery state and permits a new email request', () => {
  const { state } = setup({ recoveryStatus: 'error' });
  expect(screen.getByText(/link is invalid or expired/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Request another/ })); expect(state.completeRecovery).toHaveBeenCalled();
});
it('signs out with explicit local scope', async () => {
  const { auth, state } = setup({ user: { id: 'a', email: 'synthetic@example.test' } }); auth.signOut.mockResolvedValue({});
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); await screen.findByText('Signed out.');
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' }); expect(state.completeRecovery).toHaveBeenCalled();
});
it('scrubs callback credentials and never follows an external next parameter', () => {
  const history = { replaceState: vi.fn() };
  const good = captureAuthCallback({ pathname: '/auth/callback', search: '', hash: '#access_token=synthetic&refresh_token=synthetic&type=recovery' }, history);
  expect(good.kind).toBe('recovery'); expect(history.replaceState).toHaveBeenCalledWith(null, '', '/auth/callback');
  expect(captureAuthCallback({ pathname: '/auth/callback', search: '?next=https://evil.example', hash: '#access_token=x&refresh_token=y&type=recovery' }, history).kind).toBe('invalid');
});
it.each(['#error=access_denied&error_description=secret', '#type=recovery', '#access_token=x&access_token=y&refresh_token=z&type=recovery'])('rejects invalid callbacks %s', (hash) => {
  expect(captureAuthCallback({ pathname: '/auth/callback', search: '', hash }, { replaceState: vi.fn() }).kind).toBe('invalid');
});
it('cleans up pending form responses on view changes', async () => {
  const pending = deferred(); const { auth } = setup(); auth.signInWithPassword.mockReturnValue(pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); fill(); submit('Sign in');
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password' }));
  await act(async () => pending.resolve({ data: {} })); expect(screen.queryByText('You are signed in.')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('form', { name: 'Forgot password' })).toBeInTheDocument());
});

it('switches account modes with keyboard controls and focuses the new form', async () => {
  const user = userEvent.setup();
  setup(); await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(screen.getByLabelText('Email')).toHaveFocus();
  const modes = screen.getByRole('group', { name: 'Account mode' });
  const register = within(modes).getByRole('button', { name: 'Create account' });
  register.focus(); await user.keyboard('{Enter}');
  expect(screen.getByRole('form', { name: 'Create account' })).toBeVisible();
  expect(register).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Email')).toHaveFocus();
});
it('toggles password visibility with the keyboard without submitting or clearing it', async () => {
  const user = userEvent.setup();
  const { auth } = setup(); await user.click(screen.getByRole('button', { name: 'Sign in' })); fill();
  const password = screen.getByLabelText('Password'); expect(password).toHaveAttribute('type', 'password');
  const toggle = screen.getByRole('button', { name: 'Show password' }); toggle.focus();
  await user.keyboard('{Enter}');
  expect(password).toHaveAttribute('type', 'text'); expect(password).toHaveValue('secret123');
  expect(screen.getByRole('button', { name: 'Hide password' })).toHaveFocus();
  await user.keyboard(' ');
  expect(password).toHaveAttribute('type', 'password'); expect(password).toHaveValue('secret123');
  expect(auth.signInWithPassword).not.toHaveBeenCalled();
});
it('provides Send Reset Link and a focused return to sign-in', async () => {
  const user = userEvent.setup();
  setup(); await user.click(screen.getByRole('button', { name: 'Forgot password' }));
  expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeVisible();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back to Sign In' }));
  expect(screen.getByRole('form', { name: 'Sign in' })).toBeVisible(); expect(screen.getByLabelText('Email')).toHaveFocus();
});
it('associates local validation with its field and disables all form controls while submitting', async () => {
  const { auth } = setup(); fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); submit('Sign in');
  const email = screen.getByLabelText('Email');
  expect(email).toHaveFocus(); expect(email).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Enter a valid email address.')).toHaveAttribute('id', email.getAttribute('aria-describedby'));
  const pending = deferred(); auth.signInWithPassword.mockReturnValue(pending.promise); fill(); submit('Sign in');
  expect(screen.getByRole('form', { name: 'Sign in' })).toHaveAttribute('aria-busy', 'true');
  expect(email).toBeDisabled(); expect(screen.getByLabelText('Password')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled();
  await act(async () => pending.resolve({ data: {} }));
  expect(screen.getByLabelText('Password')).toHaveValue(''); expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
});
it('lets public weather remain accessible during recovery without completing or discarding recovery', async () => {
  const user = userEvent.setup();
  const { state } = setup({ user: { id: 'a' }, recoveryStatus: 'ready' });
  await user.click(screen.getByRole('button', { name: 'Weather Search' }));
  expect(screen.queryByRole('form', { name: 'Set new password' })).not.toBeInTheDocument();
  expect(state.completeRecovery).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Continue account recovery' }));
  expect(screen.getByRole('form', { name: 'Set new password' })).toBeVisible();
  expect(screen.getByLabelText('New password')).toHaveFocus();
});
