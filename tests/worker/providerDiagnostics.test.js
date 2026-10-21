import { afterEach, expect, it, vi } from 'vitest';
import { createProvider } from '../../src/worker/provider.js';

afterEach(() => vi.restoreAllMocks());

it.each([300, 301, 302, 303, 304, 307, 308, 399])('rejects redirect status %s without following it', async status => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const upstreamFetch = vi.fn(async (value, options) => {
    // Enforce the supported Workers option; do not include request values in assertions.
    expect(options.redirect).toBe('manual');
    expect(new URL(value).hostname === 'api.openweathermap.org').toBe(true);
    return new Response(null, { status, headers: { Location: 'https://other.invalid/' } });
  });
  const sleep = vi.fn(async () => {});
  const provider = createProvider({ upstreamFetch, sleep, timeoutMs: 1000, now: Date.now });
  await expect(provider('/api/reverse-geocode', { lat: 52, lon: 11 },
    { OPENWEATHER_API_KEY: 'synthetic-private-key' }, false)).rejects.toMatchObject({
    code: 'UPSTREAM_FAILURE', status: 502, message: 'Weather service failed. Please retry.',
  });
  expect(upstreamFetch).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledExactlyOnceWith(250);
});

it.each(['/api/geocode', '/api/reverse-geocode'])(
  'logs only safe fields for HTTP errors and preserves retries on %s', async route => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetch = vi.fn(async () => new Response('sensitive upstream body', { status: 500 }));
    const provider = createProvider({ upstreamFetch: fetch, sleep: async () => {}, timeoutMs: 1000, now: Date.now });
    await expect(provider(route, { lat: 52, lon: 11, q: 'private query' },
      { OPENWEATHER_API_KEY: 'synthetic-private-key' }, false)).rejects.toMatchObject({
      code: 'UPSTREAM_FAILURE', status: 502, message: 'Weather service failed. Please retry.',
    });
    expect(log.mock.calls).toEqual([
      [{ status: 500, attempt: 1, category: 'upstream_response' }],
      [{ status: 500, attempt: 2, category: 'upstream_response' }],
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);

it('never logs fetch exception messages or credentials', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const provider = createProvider({
    upstreamFetch: async () => { throw new Error('https://provider.invalid/?appid=synthetic-private-key'); },
    sleep: async () => {}, timeoutMs: 1000, now: Date.now,
  });
  await expect(provider('/api/reverse-geocode', { lat: 52, lon: 11 },
    { OPENWEATHER_API_KEY: 'synthetic-private-key' }, false)).rejects.toMatchObject({ code: 'UPSTREAM_FAILURE' });
  expect(log.mock.calls).toEqual([
    [{ status: null, attempt: 1, category: 'fetch_exception' }],
    [{ status: null, attempt: 2, category: 'fetch_exception' }],
  ]);
});

it('logs successful status without changing response data, even if logging throws', async () => {
  vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('logger unavailable'); });
  const data = [{ name: 'Test', country: 'DE', lat: 52, lon: 11 }];
  const provider = createProvider({ upstreamFetch: async () => Response.json(data),
    sleep: async () => {}, timeoutMs: 1000, now: Date.now });
  await expect(provider('/api/reverse-geocode', { lat: 52, lon: 11 },
    { OPENWEATHER_API_KEY: 'synthetic-private-key' }, false)).resolves.toEqual(data);
});
