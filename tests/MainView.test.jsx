import userEvent from '@testing-library/user-event';
import { AuthContext } from '../src/client/auth/context.js';
import { fetchMock, apiResponse } from './fixtures/api';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from '../src/client/App';
import { WeatherProvider } from '../src/client/context/WeatherContextProvider';
import { berlin, daySummary, deferred } from './fixtures/weather';

it.each([false, true])('scrolls on successful result with reduced motion=%s', async (reduced) => {
  vi.stubGlobal('matchMedia', () => ({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const scroll = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    fetchMock
      .mockResolvedValueOnce(apiResponse([berlin]))
      .mockResolvedValueOnce(apiResponse(daySummary));
    render(
      <AuthContext.Provider value={{ isAuthenticated: false }}>
        <WeatherProvider>
          <App />
        </WeatherProvider>
      </AuthContext.Provider>,
    );
    fireEvent.change(screen.getByLabelText('City:'), { target: { value: 'Berlin' } });
    fireEvent.change(screen.getByLabelText('Date of travel:'), {
      target: { value: daySummary.date },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search Weather' }));
    await screen.findByText('Weather loaded.');
    expect(screen.getByRole('heading', { name: 'Berlin, DE' })).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ behavior: reduced ? 'auto' : 'smooth' });
  } finally {
    if (original) HTMLElement.prototype.scrollIntoView = original;
    else delete HTMLElement.prototype.scrollIntoView;
  }
});

it('reacts to a reduced-motion preference change during loading', async () => {
  const listeners = new Set();
  const remove = vi.fn((callback) => listeners.delete(callback));
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: (type, callback) => listeners.add(callback),
    removeEventListener: (type, callback) => remove(callback),
  }));
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise);
  const app = render(
    <AuthContext.Provider value={{ isAuthenticated: false }}>
      <WeatherProvider>
        <App />
      </WeatherProvider>
    </AuthContext.Provider>,
  );
  fireEvent.change(screen.getByLabelText('City:'), { target: { value: 'Berlin' } });
  fireEvent.change(screen.getByLabelText('Date of travel:'), {
    target: { value: daySummary.date },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search Weather' }));
  expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
  act(() => listeners.forEach((callback) => callback({ matches: true })));
  expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
  app.unmount();
  expect(remove).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(apiResponse([berlin])));
});

it('opens the shared sign-in form from the anonymous trip promotion without requesting weather', async () => {
  const user = userEvent.setup();
  const auth = {
    isAuthenticated: false,
    user: null,
    loading: false,
    client: { auth: {} },
    completeRecovery: vi.fn(),
  };
  render(
    <AuthContext.Provider value={auth}>
      <WeatherProvider>
        <App />
      </WeatherProvider>
    </AuthContext.Provider>,
  );
  expect(
    screen.getByRole('heading', { level: 1, name: 'Your journey, your weather.' }),
  ).toBeVisible();
  expect(
    screen.getByText('Your daily weather summary will appear here after a search.'),
  ).toBeVisible();
  expect(screen.queryByText(/°C/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Plan a Trip' }));
  expect(screen.getAllByRole('form', { name: 'Sign in' })).toHaveLength(1);
  expect(screen.getByLabelText('Email')).toHaveFocus();
  expect(screen.getAllByRole('banner')).toHaveLength(1);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('keeps the public weather draft mounted while the authentication card is open', async () => {
  const user = userEvent.setup();
  const auth = {
    isAuthenticated: false,
    user: null,
    loading: false,
    client: { auth: {} },
    completeRecovery: vi.fn(),
  };
  render(
    <AuthContext.Provider value={auth}>
      <WeatherProvider>
        <App />
      </WeatherProvider>
    </AuthContext.Provider>,
  );
  const city = screen.getByLabelText('City:');
  fireEvent.change(city, { target: { value: 'Unsubmitted public city' } });
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(city).toBeInTheDocument();
  expect(city).not.toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(city).toBeVisible();
  expect(city).toHaveValue('Unsubmitted public city');
  expect(fetchMock).not.toHaveBeenCalled();
});
