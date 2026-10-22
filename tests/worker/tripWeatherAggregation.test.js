import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import near from './fixtures/paris-near.json';
import { createWorker } from '../../src/worker/index.js';
import { retrieveTripWeather } from '../../src/worker/tripWeather.js';
import { allocateTripDates, addCalendarDays } from '../../src/shared/trip.js';
import {
  memoryCache,
  rawResponse,
  env as providerEnv,
  weather as publicWeather,
} from './helpers.js';

const clock = Date.parse('2026-10-14T12:00:00Z');
const subject = '73b72c22-0014-4bf8-9abe-f42394c52220';
const coords = [
  [48.8566, 2.3522],
  [41.9028, 12.4964],
  [41.3874, 2.1686],
];
function draft(lengths = [3], startDate = '2026-10-14') {
  let date = startDate;
  const destinations = lengths.map((length, position) => {
    const arrivalDate = date;
    date = addCalendarDays(date, length);
    const [lat, lon] = coords[position % coords.length];
    return {
      position,
      cityName: ['Paris', 'Rome', 'Barcelona'][position % 3],
      countryCode: ['FR', 'IT', 'ES'][position % 3],
      lat,
      lon,
      timeZone: 'Europe/Paris',
      arrivalDate,
      departureDate: date,
    };
  });
  return { title: 'Private saved itinerary', startDate, endDate: date, destinations };
}
function page(url, count = 10, extra = {}) {
  const parsed = new URL(url);
  const start = Number(parsed.searchParams.get('start'));
  return {
    lat: Number(parsed.searchParams.get('lat')),
    lon: Number(parsed.searchParams.get('lon')),
    timezone: 'Europe/Paris',
    data: Array.from({ length: count }, (_, i) => ({ ...near.data[0], dt: start + i * 86400 })),
    ...extra,
  };
}
let env,
  jwt,
  fetch,
  cache,
  handler,
  sequence = 0;
beforeEach(async () => {
  env = {
    ...providerEnv,
    STAGE: 'local',
    SUPABASE_JWT_ISSUER: 'http://127.0.0.1:54321/auth/v1',
    SUPABASE_JWKS_URL: `http://127.0.0.1:54321/aggregate-keys-${sequence++}`,
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    SUPABASE_JWT_ALGORITHMS: 'ES256',
  };
  const pair = await generateKeyPair('ES256');
  jwt = await new SignJWT({
    iss: env.SUPABASE_JWT_ISSUER,
    aud: 'authenticated',
    sub: subject,
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .sign(pair.privateKey);
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'ES256', use: 'sig' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => rawResponse({ keys: [jwk] })),
  );
  fetch = vi.fn(async (url) => rawResponse(page(url)));
  cache = memoryCache();
  handler = createWorker({ upstreamFetch: fetch, cache, now: () => clock, sleep: async () => {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function request(input = draft(), { token = jwt, signal } = {}) {
  return new Request('http://localhost/api/trip-weather', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ draft: input }),
    signal,
  });
}
async function assess(input = draft(), options) {
  const response = await handler.fetch(request(input, options), env);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  return response.json();
}
function exactAllocation(result, input) {
  expect(result.data.days.map(({ position, date }) => ({ position, date }))).toEqual(
    allocateTripDates(input).allocations,
  );
  expect(new Set(result.data.days.map((day) => day.date)).size).toBe(result.data.days.length);
}

describe('authenticated itinerary aggregation', () => {
  it('returns each covered day and the retained normalized measurements', async () => {
    const input = draft();
    const result = await assess(input);
    exactAllocation(result, input);
    expect(result.meta).toEqual({ partial: false, mock: false });
    expect(result.data.days.every((day) => day.status === 'available')).toBe(true);
    expect(result.data.days[0]).toMatchObject({
      position: 0,
      date: input.startDate,
      model: {
        lowC: 12.95,
        highC: 20.84,
        temperatureC: { morning: 13.34, day: 17.1 },
        feelsLikeC: { day: 17.1 },
      },
      meta: { cached: false, stale: false },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('assigns transfer dates to the arriving destination', async () => {
    const input = draft([2, 2]);
    const result = await assess(input);
    exactAllocation(result, input);
    expect(result.data.days.map((day) => day.position)).toEqual([0, 0, 1, 1]);
    expect(result.data.days[2].date).toBe(input.destinations[0].departureDate);
    expect(fetch.mock.calls.map(([url]) => Number(new URL(url).searchParams.get('lat')))).toEqual(
      coords.slice(0, 2).map((item) => item[0]),
    );
  });
  it('retrieves the 21-day Paris/Rome/Barcelona itinerary in three operations', async () => {
    const input = draft([7, 7, 7], '2027-06-01');
    const result = await assess(input);
    exactAllocation(result, input);
    expect(result.data.days).toHaveLength(21);
    expect(result.meta.partial).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      fetch.mock.calls.map(([url]) =>
        new Date(Number(new URL(url).searchParams.get('start')) * 1000).toISOString().slice(0, 10),
      ),
    ).toEqual(['2027-06-01', '2027-06-08', '2027-06-15']);
  });
  it.each([
    [6, 6, 5, 5, 5, 5, 5, 5],
    [11, 11, 11, 5, 1, 1, 1, 1],
  ])('covers 42 dates across eight destinations (%j)', async (...lengths) => {
    const input = draft(lengths);
    const result = await assess(input);
    exactAllocation(result, input);
    expect(result.data.days).toHaveLength(42);
    expect(result.meta.partial).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(
      lengths.reduce((sum, count) => sum + Math.ceil(count / 10), 0),
    );
  });
  it('shares exactly one disposed context and uses chunks of at most ten allocated dates', async () => {
    const input = draft([11, 11, 11, 5, 1, 1, 1, 1]);
    const seen = [];
    const weather = {
      getRange: vi.fn(async (range, _env, options) => {
        seen.push(options.context);
        options.context.beginOperation();
        const allocations = allocateTripDates(input).allocations.filter(
          (day) => day.date >= range.date && day.date <= range.endDate,
        );
        expect(allocations.length).toBeLessThanOrEqual(10);
        expect(new Set(allocations.map((day) => day.position)).size).toBe(1);
        return allocations.map(({ date }) => ({ date, status: 'unavailable', model: null }));
      }),
    };
    const result = await retrieveTripWeather(input, env, {
      weather,
      now: () => clock,
      origin: 'http://localhost',
      mock: false,
    });
    exactAllocation(result, input);
    expect(new Set(seen).size).toBe(1);
    expect(seen).toHaveLength(11);
    expect(seen[0].usage.operations).toBe(11);
    expect(seen[0].signal.aborted).toBe(true);
  });
  it('uses the original request start time rather than resetting the deadline at retrieval', async () => {
    const weather = { getRange: vi.fn() };
    const input = draft([2, 2]);
    const result = await retrieveTripWeather(input, env, {
      weather,
      startedAt: Date.now() - 30001,
      now: () => clock,
      origin: 'http://localhost',
      mock: false,
    });
    exactAllocation(result, input);
    expect(result.meta.partial).toBe(true);
    expect(result.data.days.every((day) => day.error.code === 'REQUEST_DEADLINE')).toBe(true);
    expect(weather.getRange).not.toHaveBeenCalled();
  });
  it('reuses per-date public caches and avoids a separate operation for isolated misses', async () => {
    const input = draft([7]);
    for (const date of ['2026-10-14', '2026-10-16', '2026-10-18', '2026-10-20']) {
      const response = await handler.fetch(
        publicWeather({ lat: coords[0][0], lon: coords[0][1], date }),
        env,
      );
      expect(response.status).toBe(200);
    }
    fetch.mockClear();
    const result = await assess(input);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.meta.partial).toBe(false);
    const again = await assess(input);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(again.data.days.every((day) => day.meta.cached)).toBe(true);
    for (const [key, value] of cache.entries) {
      const stored = key + (await value.clone().text());
      for (const text of [
        subject,
        jwt,
        input.title,
        'destinations',
        'revision',
        env.OPENWEATHER_API_KEY,
      ])
        expect(stored).not.toContain(text);
      expect(key).toContain('/v3/provider-4/weather?');
    }
  });
  it('returns unavailable records after completed empty coverage without marking partial', async () => {
    fetch.mockImplementation(async (url) => rawResponse(page(url, 0)));
    const result = await assess();
    expect(result.meta.partial).toBe(false);
    expect(
      result.data.days.every(
        (day) => day.status === 'unavailable' && day.reason.code === 'NO_WEATHER_DATA',
      ),
    ).toBe(true);
  });
  it.each(['1979-01-01', '2028-04-06'])(
    'skips unsupported dates while retrieving remaining dates near %s',
    async (start) => {
      const input = draft([4], start);
      const result = await assess(input);
      exactAllocation(result, input);
      expect(result.meta.partial).toBe(false);
      expect(
        result.data.days.some(
          (day) => day.status === 'unavailable' && day.reason.code === 'DATE_UNAVAILABLE',
        ),
      ).toBe(true);
      expect(result.data.days.some((day) => day.status === 'available')).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('returns a fully out-of-horizon itinerary without cache or provider access', async () => {
    const match = vi.spyOn(cache, 'match');
    const result = await assess(draft([3], '9999-01-01'));
    expect(result.data.days.every((day) => day.status === 'unavailable')).toBe(true);
    expect(result.meta.partial).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
  });
  it('preserves other destinations and sanitizes failed retrieval details', async () => {
    fetch.mockImplementation(async (url) => {
      if (Number(new URL(url).searchParams.get('lat')) === coords[1][0])
        throw new Error(`private ${jwt} ${env.OPENWEATHER_API_KEY}`);
      return rawResponse(page(url));
    });
    const result = await assess(draft([2, 2, 2]));
    expect(result.meta.partial).toBe(true);
    expect(result.data.days.map((day) => day.status)).toEqual([
      'available',
      'available',
      'error',
      'error',
      'available',
      'available',
    ]);
    expect(JSON.stringify(result)).not.toContain(jwt);
    expect(JSON.stringify(result)).not.toContain(env.OPENWEATHER_API_KEY);
  });
  it('retains first-page results and marks incomplete coverage as error', async () => {
    fetch.mockImplementation(async (url) => {
      const start = Number(new URL(url).searchParams.get('start'));
      if (start === Date.parse('2026-10-15') / 1000) return rawResponse({}, 500);
      const next = new URL(url);
      next.searchParams.set('start', String(start + 86400));
      next.searchParams.set('cnt', '10');
      return rawResponse(page(url, 1, { next: next.href }));
    });
    const result = await assess(draft([3]));
    expect(result.data.days.map((day) => day.status)).toEqual(['available', 'error', 'error']);
    expect(result.meta.partial).toBe(true);
    expect(cache.entries.size).toBe(1);
  });
  it('counts retries across the whole trip and never sends attempt 25', async () => {
    const pageCounts = new Map();
    const starts = new Set(
      allocateTripDates(draft([6, 6, 5, 5, 5, 5, 5, 5])).trip.destinations.map(
        (d) => Date.parse(d.arrivalDate) / 1000,
      ),
    );
    fetch.mockImplementation(async (url) => {
      const count = (pageCounts.get(url) ?? 0) + 1;
      pageCounts.set(url, count);
      if (count === 1) return rawResponse({}, 500);
      const start = Number(new URL(url).searchParams.get('start'));
      if (starts.has(start)) {
        const next = new URL(url);
        next.searchParams.set('start', String(start + 86400));
        next.searchParams.set('cnt', '10');
        return rawResponse(page(url, 1, { next: next.href }));
      }
      return rawResponse(page(url));
    });
    const result = await assess(draft([6, 6, 5, 5, 5, 5, 5, 5]));
    expect(fetch).toHaveBeenCalledTimes(24);
    expect(result.meta.partial).toBe(true);
    expect(result.data.days.some((day) => day.error?.code === 'REQUEST_BUDGET_EXHAUSTED')).toBe(
      true,
    );
    expect(result.data.days.some((day) => day.status === 'available')).toBe(true);
  });
  it('does not exceed two concurrent HTTP requests', async () => {
    let active = 0;
    let peak = 0;
    fetch.mockImplementation(async (url) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return rawResponse(page(url));
    });
    const result = await assess(draft([3, 3, 3]));
    expect(result.meta.partial).toBe(false);
    expect(peak).toBe(2);
  });
  it('propagates cancellation and fills every unassessed date with an error', async () => {
    const parent = new AbortController();
    fetch.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          }),
        ),
    );
    const pending = assess(draft([3, 3, 3]), { signal: parent.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    parent.abort(new Error('private cancellation'));
    const result = await pending;
    expect(result.meta.partial).toBe(true);
    expect(result.data.days).toHaveLength(9);
    expect(result.data.days.every((day) => day.error.code === 'REQUEST_CANCELLED')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
  });
  it('shares the 30-second deadline across chunks and disposes timers', async () => {
    vi.useFakeTimers();
    fetch.mockImplementation(async (url) => {
      await new Promise((resolve) => setTimeout(resolve, 6000));
      return rawResponse(page(url));
    });
    const pending = assess(draft([11, 11, 11, 5, 1, 1, 1, 1]));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(31000);
    const result = await pending;
    expect(result.meta.partial).toBe(true);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(10);
    expect(result.data.days).toHaveLength(42);
    expect(result.data.days.some((day) => day.status === 'available')).toBe(true);
    expect(result.data.days.some((day) => day.error?.code === 'REQUEST_DEADLINE')).toBe(true);
    const sends = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(sends);
    expect(vi.getTimerCount()).toBe(0);
  });
});
