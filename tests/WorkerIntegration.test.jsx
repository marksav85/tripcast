import { AuthContext } from '../src/client/auth/context.js';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from '../src/client/App';
import { WeatherProvider } from '../src/client/context/WeatherContextProvider';
import { createWorker } from '../src/worker/index';
import { fetchMock } from './fixtures/api';
import { deferred } from './fixtures/weather';
import nearTimeline from './worker/fixtures/paris-near.json';

function wireWorker(options = {}, env = { STAGE: 'local', MOCK_PROVIDER: 'true' }) {
  const upstreamFetch =
    options.upstreamFetch ??
    vi.fn(() => {
      throw new Error('Unexpected real provider request');
    });
  const handler = createWorker({ upstreamFetch, ...options });
  fetchMock.mockImplementation((url, init) =>
    handler.fetch(new Request(`http://localhost${url}`, init), env),
  );
  render(
    <AuthContext.Provider value={{ isAuthenticated: false }}>
      <WeatherProvider>
        <App />
      </WeatherProvider>
    </AuthContext.Provider>,
  );
  return upstreamFetch;
}
function lookup(city = 'Berlin') {
  fireEvent.change(screen.getByLabelText('City:'), { target: { value: city } });
  fireEvent.change(screen.getByLabelText('Date of travel:'), { target: { value: '2026-10-13' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search Weather' }));
}

it('runs the real React fetch client through Worker validation and synthetic normalization', async () => {
  const upstreamFetch = wireWorker();
  lookup();
  await screen.findByText('Weather loaded.');
  expect(screen.getByText('0 mm')).toBeVisible();
  expect(screen.getByText(/Local demonstration data/)).toBeVisible();
  expect(fetchMock.mock.calls.map(([url]) => url.split('?')[0])).toEqual([
    '/api/geocode',
    '/api/weather',
  ]);
  expect(upstreamFetch).not.toHaveBeenCalled();
});
it('selects ambiguous Worker candidates and then loads weather', async () => {
  wireWorker();
  lookup('London');
  fireEvent.click(await screen.findByRole('button', { name: 'London, Ontario, CA' }));
  await screen.findByText('Weather loaded.');
  expect(screen.getByRole('heading', { name: 'London, Ontario, CA' })).toBeVisible();
});
it('displays empty results from the Worker instead of submitting weather', async () => {
  wireWorker();
  lookup('Missing City');
  await screen.findByText(/No matching city/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('displays an unconfigured server safely without browser credentials', async () => {
  wireWorker({}, {});
  lookup();
  expect(await screen.findByRole('alert')).toHaveTextContent(/access is unavailable/);
});
it('continues to ignore late Worker responses after Reset', async () => {
  const pending = deferred();
  wireWorker(
    { upstreamFetch: vi.fn(() => pending.promise) },
    { OPENWEATHER_API_KEY: 'synthetic-marker' },
  );
  lookup();
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  await act(async () =>
    pending.resolve(
      new Response(JSON.stringify([{ name: 'Berlin', country: 'DE', lat: 52.52, lon: 13.405 }]), {
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  expect(screen.getByText('Enter a city and date to see weather.')).toBeVisible();
  expect(screen.getByLabelText('City:')).toHaveValue('');
});

it('renders a real 4.0 fixture through the Worker without exposing daily rain totals or credentials', async () => {
  const key = 'integration-synthetic-marker';
  wireWorker(
    {
      now: () => Date.parse('2026-10-14T12:00:00Z'),
      upstreamFetch: vi.fn(async (url) => {
        const data = new URL(url).pathname.endsWith('/direct')
          ? [{ name: 'Paris', country: 'FR', lat: 48.8566, lon: 2.3522 }]
          : nearTimeline;
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    },
    { OPENWEATHER_API_KEY: key },
  );
  fireEvent.change(screen.getByLabelText('City:'), { target: { value: 'Paris' } });
  fireEvent.change(screen.getByLabelText('Date of travel:'), { target: { value: '2026-10-14' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search Weather' }));
  await screen.findByText('Weather loaded.');
  expect(screen.getByText('Weather conditions: overcast clouds.')).toBeVisible();
  expect(screen.getByText('Precipitation probability: 0%')).toBeVisible();
  expect(screen.getByText(/Standard forecast — TripCast provisional/)).toBeVisible();
  expect(screen.queryByText('0 mm')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain(key);
});
