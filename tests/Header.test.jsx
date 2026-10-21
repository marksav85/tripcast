import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AuthContext } from '../src/client/auth/context.js';
import Header from '../src/client/components/Header';

function setup(extra = {}, props = {}) {
  const auth = { client: { auth: { signOut: vi.fn().mockResolvedValue({}) } }, user: null, isAuthenticated: false, loading: false, completeRecovery: vi.fn(), ...extra };
  const renderHeader = (state, headerProps = props) => <AuthContext.Provider value={state}><Header {...headerProps} /></AuthContext.Provider>;
  return { auth, renderHeader, ...render(renderHeader(auth)) };
}
it('provides one public header and keyboard access to the existing sign-in form through My Trip', async () => {
  setup(); const user = userEvent.setup();
  expect(screen.getAllByRole('banner')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Weather Search', exact: true })).toHaveAttribute('aria-current', 'page');
  await user.tab(); expect(screen.getByRole('button', { name: /TripCast/ })).toHaveFocus();
  await user.tab(); await user.tab(); expect(screen.getByRole('button', { name: 'My Trip' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('form', { name: 'Sign in' })).toBeVisible();
  expect(screen.getByLabelText('Email')).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByRole('button', { name: 'My Trip' })).toHaveFocus();
});
it('keeps sign-in and registration controls in the header with focus returned on close', async () => {
  setup(); const user = userEvent.setup();
  const controls = screen.getByRole('navigation', { name: 'Authentication' });
  await user.click(within(controls).getByRole('button', { name: 'Create account' }));
  expect(screen.getByRole('form', { name: 'Create account' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(within(controls).getByRole('button', { name: 'Create account' })).toHaveFocus();
});
it('shows compact account actions, active trip navigation, and signs out once', async () => {
  const onNavigate = vi.fn();
  const { auth } = setup({ user: { id: 'a', email: 'a@example.test' }, isAuthenticated: true }, { view: 'editor', onNavigate });
  const user = userEvent.setup();
  expect(screen.getByRole('button', { name: 'My Trip' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('navigation', { name: 'Authentication' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Weather Search', exact: true }));
  expect(onNavigate).toHaveBeenCalledWith('public');
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(auth.client.auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
});
it('keeps weather accessible during restoration and disables navigation during mutations', () => {
  const { rerender, renderHeader, auth } = setup({ loading: true });
  expect(screen.getByText('Restoring session…')).toBeVisible();
  expect(screen.getByRole('button', { name: 'My Trip' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Weather Search', exact: true })).toBeEnabled();
  rerender(renderHeader({ ...auth, loading: false }, { disabled: true }));
  for (const button of within(screen.getByRole('navigation', { name: 'Weather and trip' })).getAllByRole('button')) expect(button).toBeDisabled();
});

it('renders the card outside the shared header without duplicate header auth actions', async () => {
  setup(); const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  const header = screen.getByRole('banner');
  expect(within(header).queryByRole('navigation', { name: 'Authentication' })).not.toBeInTheDocument();
  expect(within(header).queryByRole('form')).not.toBeInTheDocument();
  expect(screen.getAllByRole('banner')).toHaveLength(1);
  expect(screen.getByRole('form', { name: 'Sign in' })).toBeVisible();
  const publicAccess = screen.getByRole('complementary', { name: 'Public weather access' });
  await user.click(within(publicAccess).getByRole('button', { name: 'Weather Search' }));
  expect(screen.queryByRole('form', { name: 'Sign in' })).not.toBeInTheDocument();
  expect(within(header).getByRole('button', { name: 'Weather Search', exact: true })).toHaveFocus();
});
it('places account deletion directly after sign out without an account settings page', async () => {
  setup({ user: { id: 'a', email: 'a@example.test' }, isAuthenticated: true });
  const signOut = screen.getByRole('button', { name: 'Sign out' });
  const remove = screen.getByRole('button', { name: 'Delete account', exact: true });
  expect(signOut.nextElementSibling).toBe(remove);
  await userEvent.click(remove);
  expect(screen.getByRole('alertdialog')).toBeVisible();
  expect(screen.getByText(/account and saved trip will be permanently removed/)).toBeVisible();
});
