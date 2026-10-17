import { AuthContext } from '../src/client/auth/context.js';
import { fetchMock, apiResponse } from './fixtures/api';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from '../src/client/App';
import { WeatherProvider } from '../src/client/context/WeatherContextProvider';
import { berlin, daySummary, deferred } from './fixtures/weather';

it.each([false, true])('scrolls on successful result with reduced motion=%s', async (reduced) => {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const scroll = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scroll;
  try {
    fetchMock.mockResolvedValueOnce(apiResponse([berlin])).mockResolvedValueOnce(apiResponse(daySummary));
    render(<AuthContext.Provider value={{ isAuthenticated: false }}><WeatherProvider><App /></WeatherProvider></AuthContext.Provider>);
    fireEvent.change(screen.getByLabelText('City:'), { target: { value: 'Berlin' } });
    fireEvent.change(screen.getByLabelText('Date of travel:'), { target: { value: daySummary.date } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
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
  const pending = deferred(); fetchMock.mockReturnValueOnce(pending.promise);
  const app = render(<AuthContext.Provider value={{ isAuthenticated: false }}><WeatherProvider><App /></WeatherProvider></AuthContext.Provider>);
  fireEvent.change(screen.getByLabelText('City:'), { target: { value: 'Berlin' } });
  fireEvent.change(screen.getByLabelText('Date of travel:'), { target: { value: daySummary.date } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(screen.getByTestId('loading-animation')).toBeInTheDocument();
  act(() => listeners.forEach((callback) => callback({ matches: true })));
  expect(screen.queryByTestId('loading-animation')).not.toBeInTheDocument();
  app.unmount();
  expect(remove).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(apiResponse([berlin])));
});
