import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/client/auth/context.js';
import App from '../src/client/App.jsx';
vi.mock('../src/client/components/MainView', () => ({ default: () => <p>Public weather</p> }));
vi.mock('../src/client/components/Header', () => ({ default: ({ children }) => <>{children}</> }));
vi.mock('../src/client/components/trip/TripDashboard.jsx', () => ({ default: () => <p>Saved trip state</p> }));
afterEach(() => window.history.replaceState(null, '', '/'));
it('removes saved-trip UI on sign-out and displays deletion confirmation on the public homepage', () => {
  const view = render(<AuthContext.Provider value={{ isAuthenticated: true, user: { id: 'owner' } }}><App /></AuthContext.Provider>);
  expect(screen.getByText('Saved trip state')).toBeVisible();
  act(() => window.history.replaceState(null, '', '/?account=deleted'));
  view.rerender(<AuthContext.Provider value={{ isAuthenticated: false, user: null }}><App /></AuthContext.Provider>);
  expect(screen.queryByText('Saved trip state')).not.toBeInTheDocument();
  expect(screen.getByText('Public weather')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Account deleted.');
});
