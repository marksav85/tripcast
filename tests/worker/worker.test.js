import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorker } from '../../src/worker/index';
import {
  memoryCache,
  env,
  mockEnv,
  request,
  weather,
  rawResponse,
  city,
  daily,
  missingDaily,
} from './helpers';

afterEach(() => vi.useRealTimers());
const errorCode = async (response) => (await response.json()).error.code;
function worker(options = {}) {
  const upstreamFetch = options.upstreamFetch ?? vi.fn(async () => rawResponse([city]));
  return {
    upstreamFetch,
    handler: createWorker({
      upstreamFetch,
      cache: memoryCache(),
      sleep: async () => {},
      ...options,
    }),
  };
}

describe('Worker routes and validation', () => {
  it.each(['/api', '/api/missing', '/api/geocode/'])(
    'returns JSON 404 for %s, never SPA HTML',
    async (path) => {
      const { handler, upstreamFetch } = worker();
      const response = await handler.fetch(request(path), env);
      expect(response.status).toBe(404);
      expect(await errorCode(response)).toBe('NOT_FOUND');
      expect(upstreamFetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['/api/geocode?q=Berlin', 'POST', 'GET'],
    ['/api/reverse-geocode?lat=1&lon=2', 'HEAD', 'GET'],
    ['/api/weather', 'GET', 'POST'],
  ])('rejects wrong methods %s/%s', async (path, method, allow) => {
    const { handler } = worker();
    const response = await handler.fetch(request(path, { method }), env);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe(allow);
    expect(await errorCode(response)).toBe('METHOD_NOT_ALLOWED');
  });
  it.each([
    '/api/geocode',
    '/api/geocode?q=A',
    '/api/geocode?q=%20%20',
    '/api/geocode?q=Berlin&q=Paris',
    '/api/geocode?q=Paris%00France',
    '/api/geocode?q=Berlin&appid=bad',
    '/api/geocode?q=Berlin&url=https://evil.test',
    '/api/geocode?q=' + 'a'.repeat(101),
    '/api/reverse-geocode?lat=NaN&lon=0',
    '/api/reverse-geocode?lat=91&lon=0',
    '/api/reverse-geocode?lat=1&lon=-181',
    '/api/reverse-geocode?lat=&lon=2',
    '/api/reverse-geocode?lat=1&lon=2&key=x',
  ])('validates query %s', async (path) => {
    const { handler, upstreamFetch } = worker();
    const response = await handler.fetch(request(path), env);
    expect(response.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
  it.each([
    { lat: '52', lon: 13, date: daily.date },
    { lat: null, lon: 0, date: daily.date },
    { lat: 90.1, lon: 0, date: daily.date },
    { lat: 0, lon: 0, date: '2100-02-29' },
    { lat: 0, lon: 0, date: daily.date, url: 'https://evil.test' },
    { lat: 0, lon: 0, date: daily.date, appid: 'bad' },
    [],
    null,
  ])('rejects invalid JSON input %j', async (input) => {
    const { handler, upstreamFetch } = worker();
    const response = await handler.fetch(weather(input), env);
    expect(response.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
  it('accepts coordinate boundaries and Unicode without parameter injection', async () => {
    const { handler, upstreamFetch } = worker();
    await handler.fetch(request('/api/reverse-geocode?lat=-90&lon=180'), env);
    await handler.fetch(request('/api/geocode?q=S%C3%A3o%20Paulo%20%26appid%3Dbad'), env);
    const url = new URL(upstreamFetch.mock.calls[1][0]);
    expect(url.origin).toBe('https://api.openweathermap.org');
    expect(url.searchParams.get('q')).toBe('São Paulo &appid=bad');
    expect(url.searchParams.getAll('appid')).toEqual([env.OPENWEATHER_API_KEY]);
    expect(upstreamFetch.mock.calls[0][1].redirect).toBe('manual');
  });
  it('rejects malformed JSON, wrong content type and unapproved dates', async () => {
    const { handler, upstreamFetch } = worker();
    expect(await errorCode(await handler.fetch(weather({}, { body: '{' }), env))).toBe(
      'INVALID_INPUT',
    );
    expect((await handler.fetch(weather({}, { headers: {} }), env)).status).toBe(415);
    expect(
      await errorCode(await handler.fetch(weather({ lat: 0, lon: 0, date: '1970-01-01' }), env)),
    ).toBe('DATE_UNAVAILABLE');
    expect(
      await errorCode(await handler.fetch(weather({ lat: 0, lon: 0, date: '9999-12-31' }), env)),
    ).toBe('DATE_UNAVAILABLE');
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
  it.each([{}, { 'Content-Length': '1' }, { 'Content-Length': '20000' }])(
    'bounds actual request size despite headers %j',
    async (headers) => {
      const { handler, upstreamFetch } = worker();
      const response = await handler.fetch(
        weather(
          {},
          { body: ' '.repeat(17000), headers: { 'Content-Type': 'application/json', ...headers } },
        ),
        env,
      );
      expect(response.status).toBe(413);
      expect(upstreamFetch).not.toHaveBeenCalled();
    },
  );
  it('times out a body that never finishes', async () => {
    vi.useFakeTimers();
    const { handler } = worker();
    const body = new ReadableStream({ start() {} });
    const result = handler.fetch(
      request('/api/weather', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        duplex: 'half',
      }),
      env,
    );
    await vi.advanceTimersByTimeAsync(3001);
    expect((await result).status).toBe(408);
  });
  it('rejects foreign browser origins without advertising CORS', async () => {
    const { handler, upstreamFetch } = worker();
    const response = await handler.fetch(
      request('/api/geocode?q=Berlin', { headers: { Origin: 'https://foreign.test' } }),
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe('Provider safety and normalization', () => {
  it('normalizes weather server-side and uses fixed metric parameters', async () => {
    const { handler, upstreamFetch } = worker({
      upstreamFetch: vi.fn(async () => rawResponse(daily)),
    });
    const result = await (await handler.fetch(weather(), env)).json();
    expect(result.data).toMatchObject({
      available: true,
      model: { lowC: 0, highC: 15, precipitationMm: null, cloudPercent: null, condition: null },
    });
    expect(result.data.model).not.toHaveProperty('location');
    const url = new URL(upstreamFetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/data/4.0/onecall/timeline/1day');
    expect(url.searchParams.get('units')).toBe('metric');
  });
  it('marks valid all-missing days unavailable', async () => {
    const { handler } = worker({ upstreamFetch: vi.fn(async () => rawResponse(missingDaily)) });
    expect((await (await handler.fetch(weather(), env)).json()).data.available).toBe(false);
  });
  it.each([{}, [null], [{ ...city, lat: '52' }]])('rejects malformed geocode %j', async (data) => {
    const { handler } = worker({ upstreamFetch: vi.fn(async () => rawResponse(data)) });
    expect(await errorCode(await handler.fetch(request(), env))).toBe('UPSTREAM_INVALID');
  });
  it('returns a real empty candidate result', async () => {
    const { handler } = worker({ upstreamFetch: vi.fn(async () => rawResponse([])) });
    expect((await (await handler.fetch(request(), env)).json()).data).toEqual([]);
  });
  it.each([401, 403, 429, 400])(
    'does not retry upstream HTTP %i or expose raw errors',
    async (status) => {
      const upstreamFetch = vi.fn(async () =>
        rawResponse({ message: env.OPENWEATHER_API_KEY }, status),
      );
      const { handler } = worker({ upstreamFetch });
      const response = await handler.fetch(request(), env);
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(await response.text()).not.toContain(env.OPENWEATHER_API_KEY);
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects upstream HTTP 302 without following it, with one bounded retry and sanitized errors', async () => {
    const sleep = vi.fn(async () => {});
    const upstreamFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: env.OPENWEATHER_API_KEY }), {
          status: 302,
          headers: { Location: 'https://other.invalid/', 'Content-Type': 'application/json' },
        }),
    );
    const { handler } = worker({ upstreamFetch, sleep });
    const response = await handler.fetch(request(), env);
    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: { code: 'UPSTREAM_FAILURE', message: 'Weather service failed. Please retry.' },
    });
    expect(JSON.stringify(payload)).not.toContain(env.OPENWEATHER_API_KEY);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(250);
    for (const [url, options] of upstreamFetch.mock.calls) {
      expect(new URL(url).origin).toBe('https://api.openweathermap.org');
      expect(options.redirect).toBe('manual');
    }
    expect(upstreamFetch.mock.calls[1][0]).toBe(upstreamFetch.mock.calls[0][0]);
  });
  it('retries one transient 5xx only, then succeeds', async () => {
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(rawResponse({}, 500))
      .mockResolvedValueOnce(rawResponse([city]));
    const { handler } = worker({ upstreamFetch });
    expect((await handler.fetch(request(), env)).status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });
  it('caps failing network requests at two and never logs exceptions', async () => {
    const log = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'log');
    try {
      const upstreamFetch = vi.fn(async () => {
        throw new Error(`https://provider?appid=${env.OPENWEATHER_API_KEY}`);
      });
      const { handler } = worker({ upstreamFetch });
      const response = await handler.fetch(request(), env);
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain('appid');
      expect(upstreamFetch).toHaveBeenCalledTimes(2);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });
  it('enforces the upstream timeout even if a stub ignores abort', async () => {
    vi.useFakeTimers();
    const upstreamFetch = vi.fn(() => new Promise(() => {}));
    const { handler } = worker({ upstreamFetch, timeoutMs: 10 });
    const result = handler.fetch(request(), env);
    await vi.advanceTimersByTimeAsync(11);
    const response = await result;
    expect(response.status).toBe(504);
    expect(upstreamFetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    () => new Response('not-json', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response(' '.repeat(262145), { headers: { 'Content-Type': 'application/json' } }),
  ])('rejects invalid/oversized provider bodies', async (makeResponse) => {
    const upstreamFetch = vi.fn(async () => makeResponse());
    const { handler } = worker({ upstreamFetch });
    expect(await errorCode(await handler.fetch(request(), env))).toBe('UPSTREAM_INVALID');
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });
  it('redacts a secret accidentally present in a normalized provider field', async () => {
    const { handler } = worker({
      upstreamFetch: vi.fn(async () => rawResponse([{ ...city, name: env.OPENWEATHER_API_KEY }])),
    });
    const response = await handler.fetch(request(), env);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(env.OPENWEATHER_API_KEY);
  });
  it('does not call upstream without a server secret', async () => {
    const { handler, upstreamFetch } = worker();
    const response = await handler.fetch(request(), {});
    expect(await errorCode(response)).toBe('SERVICE_UNCONFIGURED');
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
  it('guards synthetic mode outside explicit localhost/local configuration', async () => {
    const { handler, upstreamFetch } = worker();
    expect((await handler.fetch(request(), mockEnv)).status).toBe(200);
    expect(
      (await handler.fetch(new Request('https://production.test/api/geocode?q=Berlin'), mockEnv))
        .status,
    ).toBe(503);
    expect((await handler.fetch(request(), { ...mockEnv, STAGE: 'production' })).status).toBe(503);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe('cache, limits and headers', () => {
  it('caches normalized candidates seven days with no secret-bearing keys or values', async () => {
    let clock = Date.now();
    const cache = memoryCache();
    const { handler, upstreamFetch } = worker({ cache, now: () => clock });
    await handler.fetch(request(), env);
    expect((await (await handler.fetch(request(), env)).json()).meta.cached).toBe(true);
    for (const [key, value] of cache.entries) {
      expect(key).not.toContain(env.OPENWEATHER_API_KEY);
      expect(key).not.toContain('appid');
      expect(await value.clone().text()).not.toContain(env.OPENWEATHER_API_KEY);
    }
    clock += 7 * 86400000 + 1;
    await handler.fetch(request(), env);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });
  it('briefly caches empty geocoding but not failures', async () => {
    let clock = Date.now();
    const upstreamFetch = vi.fn(async () => rawResponse([]));
    const { handler } = worker({ upstreamFetch, now: () => clock });
    await handler.fetch(request(), env);
    await handler.fetch(request(), env);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    clock += 15 * 60000 + 1;
    await handler.fetch(request(), env);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });
  it('uses stale weather within its limit and displays stale metadata', async () => {
    let clock = Date.parse(`${daily.date}T00:00:00Z`);
    const cache = memoryCache();
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(rawResponse(daily))
      .mockImplementation(async () => rawResponse({}, 500));
    const { handler } = worker({ cache, upstreamFetch, now: () => clock });
    await handler.fetch(weather(), env);
    clock += 4 * 3600000;
    const stale = await (await handler.fetch(weather(), env)).json();
    expect(stale.meta).toMatchObject({ stale: true, cached: true });
    clock += 21 * 3600000;
    expect((await handler.fetch(weather(), env)).status).toBe(502);
  });
  it('coalesces simultaneous identical misses within the isolate', async () => {
    let resolve;
    const upstreamFetch = vi.fn(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const { handler } = worker({ upstreamFetch });
    const calls = [handler.fetch(request(), env), handler.fetch(request(), env)];
    await vi.waitFor(() => expect(upstreamFetch).toHaveBeenCalledTimes(1));
    resolve(rawResponse([city]));
    expect((await Promise.all(calls)).map((response) => response.status)).toEqual([200, 200]);
  });
  it('caps concurrent upstream work at three instead of an unbounded queue', async () => {
    const releases = [];
    const upstreamFetch = vi.fn(() => new Promise((resolve) => releases.push(resolve)));
    const { handler } = worker({ upstreamFetch });
    const pending = ['One', 'Two', 'Three'].map((q) =>
      handler.fetch(request(`/api/geocode?q=${q}`), env),
    );
    await vi.waitFor(() => expect(upstreamFetch).toHaveBeenCalledTimes(3));
    expect((await handler.fetch(request('/api/geocode?q=Four'), env)).status).toBe(503);
    releases.forEach((resolve) => resolve(rawResponse([city])));
    await Promise.all(pending);
  });
  it('rate-limits cached requests too and resets its minute bucket', async () => {
    let clock = Date.now();
    const { handler, upstreamFetch } = worker({ now: () => clock });
    for (let i = 0; i < 10; i += 1) expect((await handler.fetch(request(), env)).status).toBe(200);
    const blocked = await handler.fetch(request(), env);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
    clock += 60000;
    expect((await handler.fetch(request(), env)).status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });
  it('enforces five weather requests per minute', async () => {
    const { handler } = worker({ upstreamFetch: vi.fn(async () => rawResponse(daily)) });
    for (let i = 0; i < 5; i += 1) expect((await handler.fetch(weather(), env)).status).toBe(200);
    expect((await handler.fetch(weather(), env)).status).toBe(429);
  });
  it('backs off upstream quota errors before additional cold misses', async () => {
    const upstreamFetch = vi.fn(async () => rawResponse({}, 429));
    const { handler } = worker({ upstreamFetch });
    await handler.fetch(request('/api/geocode?q=One'), env);
    await handler.fetch(request('/api/geocode?q=Two'), env);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });
  it('sets no-store, CSP and security headers on JSON errors and asset fallback', async () => {
    const { handler } = worker();
    const response = await handler.fetch(request('/api/unknown'), env);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(response.headers.get('Content-Security-Policy')).not.toContain('unsafe-eval');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const asset = await handler.fetch(request('/route'), {
      ASSETS: { fetch: async () => new Response('<html></html>') },
    });
    expect(asset.headers.get('Permissions-Policy')).toBe('geolocation=(self)');
  });
});

it('rejects a configured secret in user query text before constructing a cache key', async () => {
  const cache = memoryCache();
  const { handler, upstreamFetch } = worker({ cache });
  const response = await handler.fetch(request(`/api/geocode?q=${env.OPENWEATHER_API_KEY}`), env);
  expect(response.status).toBe(400);
  expect(upstreamFetch).not.toHaveBeenCalled();
  expect(cache.entries.size).toBe(0);
});
it('uses a 24-hour distant freshness and refreshes on near-term boundary transition', async () => {
  let clock = Date.parse('2026-10-01T12:00:00Z');
  const upstreamFetch = vi.fn(async () => rawResponse(daily));
  const { handler } = worker({ now: () => clock, upstreamFetch });
  await handler.fetch(weather(), env);
  clock += 23 * 3600000;
  expect((await (await handler.fetch(weather(), env)).json()).meta.cached).toBe(true);
  clock = Date.parse('2026-10-05T23:30:00Z');
  await handler.fetch(weather(), env);
  clock = Date.parse('2026-10-06T00:00:00Z');
  await handler.fetch(weather(), env);
  expect(upstreamFetch).toHaveBeenCalledTimes(3);
});
it('tolerates a failed cache without caching an upstream failure', async () => {
  const cache = {
    match: async () => {
      throw new Error('cache failed');
    },
    put: async () => {
      throw new Error('cache failed');
    },
  };
  const { handler } = worker({ cache });
  expect((await handler.fetch(request(), env)).status).toBe(200);
  const upstreamFetch = vi.fn(async () => rawResponse({}, 503));
  const failed = worker({ upstreamFetch });
  await failed.handler.fetch(request(), env);
  await failed.handler.fetch(request(), env);
  expect(upstreamFetch).toHaveBeenCalledTimes(4);
});
it('keeps later weather stale at most 72 hours and unavailable weather fresh only 15 minutes', async () => {
  let clock = Date.parse('2026-10-01T00:00:00Z');
  const upstreamFetch = vi
    .fn()
    .mockResolvedValueOnce(rawResponse(daily))
    .mockImplementation(async () => rawResponse({}, 500));
  const { handler } = worker({ now: () => clock, upstreamFetch });
  await handler.fetch(weather(), env);
  clock += 25 * 3600000;
  expect((await (await handler.fetch(weather(), env)).json()).meta.stale).toBe(true);
  clock += 48 * 3600000;
  expect((await handler.fetch(weather(), env)).status).toBe(502);
  const missingFetch = vi.fn(async () => rawResponse(missingDaily));
  const missing = worker({ now: () => clock, upstreamFetch: missingFetch });
  await missing.handler.fetch(weather(), env);
  await missing.handler.fetch(weather(), env);
  expect(missingFetch).toHaveBeenCalledTimes(1);
  clock += 15 * 60000 + 1;
  await missing.handler.fetch(weather(), env);
  expect(missingFetch).toHaveBeenCalledTimes(2);
});
it('bounds a stalled upstream response body separately from the connection timeout', async () => {
  vi.useFakeTimers();
  const upstreamFetch = vi.fn(
    async () =>
      new Response(new ReadableStream({ start() {} }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  const { handler } = worker({ upstreamFetch });
  const result = handler.fetch(request(), env);
  await vi.advanceTimersByTimeAsync(3001);
  expect(await errorCode(await result)).toBe('UPSTREAM_TIMEOUT');
  expect(upstreamFetch).toHaveBeenCalledTimes(1);
});

describe('geocoding query isolation', () => {
  const cities = [
    city,
    { name: 'Hamburg', country: 'DE', lat: 53.5511, lon: 9.9937 },
    { name: 'Munich', country: 'DE', lat: 48.1351, lon: 11.582 },
  ];
  it('intentionally returns the Berlin fallback for these queries in local fixture mode', async () => {
    const { handler, upstreamFetch } = worker();
    for (const candidate of cities) {
      const response = await handler.fetch(request(`/api/geocode?q=${candidate.name}`), mockEnv);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: [city], meta: { mock: true } });
    }
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
  it('forwards distinct queries and keeps provider results separate, including cached results', async () => {
    const upstreamFetch = vi.fn(async (url) => {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe('/geo/1.0/direct');
      const candidate = cities.find((item) => item.name === parsed.searchParams.get('q'));
      expect(candidate).toBeDefined();
      return rawResponse([candidate]);
    });
    const { handler } = worker({ upstreamFetch });
    for (const candidate of [...cities, ...cities]) {
      const response = await handler.fetch(request(`/api/geocode?q=${candidate.name}`), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: [candidate], meta: { mock: false } });
    }
    expect(upstreamFetch).toHaveBeenCalledTimes(3);
  });
});
