import { afterEach, describe, expect, it, vi } from 'vitest';
import near from './fixtures/paris-near.json';
import midnight from './fixtures/paris-midnight.json';
import far from './fixtures/paris-180.json';
import nextPage from './fixtures/paris-next.json';
import leap from './fixtures/paris-500.json';
import dst from './fixtures/paris-dst.json';
import {
  collectTimeline,
  validateTimelinePage,
  forecastPolicy,
  TIMELINE_PATH,
} from '../../src/worker/timeline';
import { normalizeTimelineDay } from '../../src/worker/normalizeTimeline';
import { createWorker } from '../../src/worker/index';
import { createProvider } from '../../src/worker/provider';
import { env, mockEnv, weather, rawResponse, memoryCache } from './helpers';

const now = Date.parse('2026-10-14T12:00:00Z');
const paris = { lat: 48.8566, lon: 2.3522, date: '2026-10-14' };
const copy = (value) => structuredClone(value);
const seconds = (date) => Date.parse(`${date}T00:00:00Z`) / 1000;
const link = (start, input = paris) =>
  `http://api.openweathermap.org${TIMELINE_PATH}?${new URLSearchParams({ cnt: '10', lat: input.lat, lon: input.lon, start, appid: 'synthetic-pagination-marker', units: 'metric', lang: 'en' })}`;
const page = (date, zone = 'Europe/Paris', record = {}) => ({
  ...paris,
  timezone: zone,
  data: [{ dt: seconds(date), ...record }],
});
const model = async (raw, input = paris, clock = now) =>
  normalizeTimelineDay(await collectTimeline(input, async () => raw), input.date, clock);
const error = async (response) => (await response.json()).error.code;
afterEach(() => vi.useRealTimers());

describe('Batch 4A representative records', () => {
  it('normalizes validated near-term fields without interpreting scalar rain totals', async () => {
    const result = await model(near);
    expect(result.available).toBe(true);
    expect(result.model).toMatchObject({
      date: paris.date,
      timeZone: 'Europe/Paris',
      lowC: 12.95,
      highC: 20.84,
      condition: { id: 804, description: 'overcast clouds', icon: '04d' },
      humidityPercent: 63,
      cloudPercent: 93,
      windSpeedMs: 2.75,
      windDirectionDeg: 312,
      uvIndex: 2.37,
      precipitationProbability: 0,
      precipitationMm: null,
      forecastType: 'standard',
    });
  });
  it('normalizes the real long-range structure and missing UV/probability', async () => {
    const result = await model(far, { ...paris, date: '2027-04-12' });
    expect(result.model).toMatchObject({
      lowC: 2.64,
      highC: 15.53,
      windSpeedMs: 6.61,
      condition: { id: 500 },
      precipitationMm: null,
      precipitationProbability: null,
      uvIndex: null,
      forecastType: 'long-range',
      forecastLabel: 'Long-range estimate',
    });
    expect(result.model).not.toHaveProperty('rain');
  });
  it.each([
    ['near-term', near, '2026-10-14'],
    ['long-range', far, '2027-04-12'],
    ['retained previous-day probe', midnight, '2026-10-13'],
  ])('preserves exact provider measurements from %s', async (_label, fixture, date) => {
    const raw = fixture.data[0];
    const result = await model(fixture, { ...paris, date });
    expect(result.model.temperatureC).toEqual({
      morning: raw.temp.morn,
      day: raw.temp.day,
      evening: raw.temp.eve,
      night: raw.temp.night,
      min: raw.temp.min,
      max: raw.temp.max,
    });
    expect(result.model.feelsLikeC).toEqual({
      morning: raw.feels_like.morn,
      day: raw.feels_like.day,
      evening: raw.feels_like.eve,
      night: raw.feels_like.night,
    });
    expect(result.model.lowC).toBe(raw.temp.min);
    expect(result.model.highC).toBe(raw.temp.max);
    expect(result.model.pressureHpa).toBe(raw.pressure);
    expect(result.model.dewPointC).toBe(raw.dew_point);
    expect(result.model.providerRainValue).toBe(raw.rain ?? null);
    expect(result.model.precipitationMm).toBeNull();
  });
  it('retains long-range rain independently of unavailable UV and probability', async () => {
    const { model: result } = await model(far, { ...paris, date: '2027-04-12' });
    expect(result).toMatchObject({
      providerRainValue: 0.19,
      uvIndex: null,
      precipitationProbability: null,
      precipitationMm: null,
    });
  });
  it('keeps missing optional measurements explicit without inferring temperatures', async () => {
    const { model: result, available } = await model(
      page(paris.date, 'UTC', { temp: { min: 2, max: 8 } }),
    );
    expect(available).toBe(true);
    expect(result.temperatureC).toEqual({
      morning: null,
      day: null,
      evening: null,
      night: null,
      min: 2,
      max: 8,
    });
    expect(result.feelsLikeC).toEqual({ morning: null, day: null, evening: null, night: null });
    expect(result.pressureHpa).toBeNull();
    expect(result.dewPointC).toBeNull();
    expect(result.providerRainValue).toBeNull();
    const missing = await model({ ...page(paris.date), data: [] });
    expect(Object.values(missing.model.temperatureC).every((value) => value === null)).toBe(true);
    expect(missing.available).toBe(false);
  });
  it('preserves zeros in all additional measurements', async () => {
    const { model: result } = await model(
      page(paris.date, 'UTC', {
        temp: { morn: 0, day: 0, eve: 0, night: 0, min: 0, max: 0 },
        feels_like: { morn: 0, day: 0, eve: 0, night: 0 },
        pressure: 0,
        dew_point: 0,
        rain: 0,
      }),
    );
    expect(Object.values(result.temperatureC)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Object.values(result.feelsLikeC)).toEqual([0, 0, 0, 0]);
    expect(result).toMatchObject({
      pressureHpa: 0,
      dewPointC: 0,
      providerRainValue: 0,
      precipitationMm: null,
    });
  });
  it.each([undefined, null, '12', false, {}, [], NaN, Infinity, -Infinity, -274, 1001])(
    'nulls invalid temperatures without throwing (%#)',
    async (value) => {
      const { model: result } = await model(
        page(paris.date, 'UTC', {
          temp: { morn: value, day: value, eve: value, night: value, min: value, max: value },
          feels_like: { morn: value, day: value, eve: value, night: value },
          dew_point: value,
        }),
      );
      expect(Object.values(result.temperatureC).every((item) => item === null)).toBe(true);
      expect(Object.values(result.feelsLikeC).every((item) => item === null)).toBe(true);
      expect(result.dewPointC).toBeNull();
    },
  );
  it.each(['1', NaN, Infinity, -1, null, {}, []])(
    'nulls invalid pressure and rain (%#)',
    async (value) => {
      const { model: result } = await model(
        page(paris.date, 'UTC', { pressure: value, rain: value }),
      );
      expect(result.pressureHpa).toBeNull();
      expect(result.providerRainValue).toBeNull();
    },
  );
  it('keeps the existing availability rule and reversed-extrema handling', async () => {
    const { model: result, available } = await model(
      page(paris.date, 'UTC', {
        temp: { min: 20, max: 5, morn: 10 },
        feels_like: { day: 11 },
        pressure: 1010,
        dew_point: 3,
        rain: 1,
      }),
    );
    expect(result.temperatureC).toEqual({
      morning: 10,
      day: null,
      evening: null,
      night: null,
      min: null,
      max: null,
    });
    expect(result.lowC).toBeNull();
    expect(result.highC).toBeNull();
    expect(available).toBe(false);
  });
  it('retains valid zeros for every optional measurement', async () => {
    const result = await model(
      page(paris.date, 'UTC', {
        temp: { min: 0, max: 0 },
        clouds: 0,
        humidity: 0,
        wind_speed: 0,
        wind_deg: 0,
        pop: 0,
        uvi: 0,
        rain: 0,
      }),
    );
    expect(result.model).toMatchObject({
      lowC: 0,
      highC: 0,
      cloudPercent: 0,
      humidityPercent: 0,
      windSpeedMs: 0,
      windDirectionDeg: 0,
      precipitationProbability: 0,
      uvIndex: 0,
      precipitationMm: null,
    });
  });
  it('returns nullable invalid fields, rejects reversed extrema and does not invent conditions', async () => {
    const result = await model(
      page(paris.date, 'UTC', {
        temp: { min: 20, max: 5 },
        clouds: 101,
        humidity: '0',
        wind_speed: -1,
        wind_deg: NaN,
        pop: 2,
        uvi: Infinity,
        weather: [{ id: 800, main: 'Clear', description: 'https://bad.test', icon: 'url' }],
      }),
    );
    expect(result.available).toBe(false);
    for (const key of [
      'lowC',
      'highC',
      'cloudPercent',
      'humidityPercent',
      'windSpeedMs',
      'windDirectionDeg',
      'precipitationProbability',
      'uvIndex',
      'condition',
      'precipitationMm',
    ])
      expect(result.model[key]).toBeNull();
  });
  it('supports sparse and missing days as unavailable with requested date retained', async () => {
    expect((await model(page(paris.date))).available).toBe(false);
    const result = await model({ ...page(paris.date), data: [] });
    expect(result).toMatchObject({
      available: false,
      model: { date: paris.date, timeZone: 'Europe/Paris' },
    });
  });
  it('matches the real leap-day record', async () => {
    const result = await model(leap, { ...paris, date: '2028-02-29' });
    expect(result.available).toBe(true);
    expect(result.model.date).toBe('2028-02-29');
  });
});

describe('provider-local calendar days and provisional policy', () => {
  it.each([
    ['America/Los_Angeles', '2026-10-15', '2026-10-14'],
    ['Pacific/Kiritimati', '2026-10-14', '2026-10-14'],
    ['Pacific/Pago_Pago', '2026-10-15', '2026-10-14'],
  ])(
    'maps timestamps in %s without borrowing the envelope offset',
    async (zone, utcDate, localDate) => {
      const raw = { ...page(utcDate, zone, { temp: { min: 0, max: 10 } }), timezone_offset: 0 };
      const result = await model(raw, { ...paris, date: localDate });
      expect(result.model).toMatchObject({ date: localDate, highC: 10, timeZone: zone });
    },
  );
  it('handles real Paris DST page with a single stale offset', async () => {
    const input = { ...paris, date: '2026-10-24', endDate: '2026-10-27' };
    const result = await collectTimeline(input, async () => dst);
    expect(result.days.map((day) => day.date)).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
    ]);
    expect(result.days.every((day) => day.record)).toBe(true);
  });
  it('uses local today across UTC midnight and exactly today through +7 as standard', () => {
    const clock = Date.parse('2026-10-14T00:30:00Z');
    expect(forecastPolicy('2026-10-21', 'America/Los_Angeles', clock).forecastType).toBe(
      'long-range',
    );
    expect(forecastPolicy('2026-10-21', 'Pacific/Kiritimati', clock).forecastType).toBe('standard');
    expect(forecastPolicy('2026-10-22', 'Pacific/Kiritimati', clock).forecastType).toBe(
      'long-range',
    );
    expect(forecastPolicy('2026-10-12', 'America/Los_Angeles', clock).forecastType).toBe(
      'historical',
    );
  });
  it('handles US spring DST per record, rather than adding a constant offset', async () => {
    const raw = {
      ...page('2027-03-14', 'America/New_York'),
      data: [
        { dt: Date.parse('2027-03-14T04:30:00Z') / 1000 },
        { dt: Date.parse('2027-03-15T04:30:00Z') / 1000 },
      ],
    };
    const result = await collectTimeline(
      { ...paris, date: '2027-03-13', endDate: '2027-03-15' },
      async () => raw,
    );
    expect(result.days.map((day) => Boolean(day.record))).toEqual([true, false, true]);
  });
});

describe('bounded range pagination', () => {
  it('reconstructs provider HTTP metadata on fixed HTTPS and never reuses its credential', async () => {
    const input = { ...paris, date: '2027-04-20', endDate: '2027-04-24' };
    const first = { ...copy(far), next: link(seconds('2027-04-22'), input) };
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(rawResponse(first))
      .mockResolvedValueOnce(rawResponse(nextPage));
    const provider = createProvider({
      upstreamFetch,
      now: () => now,
      sleep: async () => {},
      timeoutMs: 8000,
    });
    const result = await provider('/api/weather', input, env, false);
    expect(result.days.map((day) => day.date)).toEqual([
      '2027-04-20',
      '2027-04-21',
      '2027-04-22',
      '2027-04-23',
      '2027-04-24',
    ]);
    expect(result.days.every((day) => day.record)).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of upstreamFetch.mock.calls) {
      const u = new URL(url);
      expect(u.origin).toBe('https://api.openweathermap.org');
      expect(u.pathname).toBe(TIMELINE_PATH);
      expect(u.searchParams.get('appid')).toBe(env.OPENWEATHER_API_KEY);
      expect(u.searchParams.get('units')).toBe('metric');
      expect(options.redirect).toBe('manual');
      expect(url).not.toContain('synthetic-pagination-marker');
    }
  });
  it('filters out-of-range rows and deduplicates overlapping pages, keeping the first record', async () => {
    const first = {
      ...page('2026-10-14', 'UTC', { temp: { min: 1 } }),
      next: link(seconds('2026-10-15')),
    };
    const second = {
      ...page('2026-10-14', 'UTC'),
      data: [
        { dt: seconds('2026-10-14'), temp: { min: 99 } },
        { dt: seconds('2026-10-15') },
        { dt: seconds('2026-10-16') },
      ],
    };
    const fetch = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const result = await collectTimeline({ ...paris, endDate: '2026-10-15' }, fetch);
    expect(result.days).toHaveLength(2);
    expect(result.days[0].record.temp.min).toBe(1);
  });
  it('stops at requested coverage even when next metadata exists', async () => {
    const fetch = vi.fn(async () => ({ ...near, next: link(seconds('2026-10-24')) }));
    await collectTimeline(paris, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('accounts for retries across two pages within four weather sends', async () => {
    const first = { ...page('2026-10-13'), next: link(seconds('2026-10-15')) };
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(rawResponse({}, 500))
      .mockResolvedValueOnce(rawResponse(first))
      .mockResolvedValueOnce(rawResponse({}, 500))
      .mockResolvedValueOnce(rawResponse(near));
    const provider = createProvider({
      upstreamFetch,
      now: () => now,
      sleep: async () => {},
      timeoutMs: 8000,
    });
    expect((await provider('/api/weather', paris, env, false)).days[0].record).toBeTruthy();
    expect(upstreamFetch).toHaveBeenCalledTimes(4);
  });
  it('stops after two non-covering pages instead of following a third', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ...page('2026-10-12', 'UTC'), next: link(seconds('2026-10-15')) })
      .mockResolvedValueOnce({ ...page('2026-10-13', 'UTC'), next: link(seconds('2026-10-16')) });
    await expect(collectTimeline(paris, fetch)).rejects.toMatchObject({ code: 'UPSTREAM_INVALID' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(['2026-10-13', '2026-10-25', 'invalid'])(
    'rejects unapproved internal range end %s',
    async (endDate) => {
      const fetch = vi.fn();
      await expect(collectTimeline({ ...paris, endDate }, fetch)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    'https://evil.test/path',
    `https://api.openweathermap.org/other?cnt=10`,
    `${link(seconds('2026-10-15'))}&start=1`,
    `${link(seconds('2026-10-15'))}&callback=x`,
    link(seconds('2026-10-15')).replace('cnt=10', 'cnt=100'),
    link(seconds('2026-10-15')).replace('units=metric', 'units=standard'),
    link(seconds('2026-10-15')).replace('lang=en', 'lang=de'),
    link(seconds('2026-10-15')).replace('48.8566', '0'),
    link(seconds('2026-10-15')).replace('api.openweathermap.org', 'user@api.openweathermap.org'),
    link(seconds('2026-10-15')).replace('api.openweathermap.org', 'api.openweathermap.org:444'),
    link(seconds('2026-10-15')) + '#fragment',
  ])('rejects hostile pagination metadata without a second fetch (%#)', async (next) => {
    const fetch = vi.fn(async () => ({ ...near, next }));
    await expect(collectTimeline(paris, fetch)).rejects.toMatchObject({ code: 'UPSTREAM_INVALID' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['2026-10-14', '2026-10-13', '2027-01-01'])(
    'rejects looping/backward/distant continuation %s',
    async (date) => {
      const fetch = vi.fn(async () => ({
        ...page('2026-10-13', 'UTC'),
        next: link(seconds(date)),
      }));
      await expect(collectTimeline(paris, fetch)).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});

describe('malformed envelopes, cache and safety', () => {
  it.each([
    null,
    [],
    {},
    { ...near, lat: 0 },
    { ...near, timezone: 'Invalid/Zone' },
    { ...near, data: Array(11).fill(near.data[0]) },
    { ...near, data: [null] },
    { ...near, data: [{ dt: '1791936000' }] },
    { ...near, data: [{ dt: Infinity }] },
    { ...near, data: [...near.data].reverse() },
  ])('rejects malformed timeline (%#)', (raw) => {
    expect(() => validateTimelinePage(raw, paris)).toThrow();
  });
  it('rejects timezone changes across pages', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ...page('2026-10-13'), next: link(seconds('2026-10-15')) })
      .mockResolvedValueOnce(page('2026-10-15', 'UTC'));
    await expect(collectTimeline(paris, fetch)).rejects.toThrow();
  });
  it('preserves secret isolation in weather responses, normalized cache and cache keys', async () => {
    const cache = memoryCache();
    const upstreamFetch = vi.fn(async () => rawResponse(near));
    const handler = createWorker({ now: () => now, cache, upstreamFetch });
    const response = await handler.fetch(weather(paris), env);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(env.OPENWEATHER_API_KEY);
    expect((await (await handler.fetch(weather(paris), env)).json()).meta.cached).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    for (const [key, value] of cache.entries) {
      expect(key).toContain('provider-4');
      expect(key).not.toContain('appid');
      expect(await value.clone().text()).not.toContain(env.OPENWEATHER_API_KEY);
      const stored = await value.clone().json();
      expect(stored.payload.data.model).not.toHaveProperty('rain');
      expect(stored.payload.data.model).toHaveProperty('providerRainValue');
    }
  });
  it('ignores older live models while preserving fixture and geocoding namespaces', async () => {
    const cache = memoryCache();
    const oldKey = new Request(
      'http://localhost/__tripcast-cache/v2/provider-4/weather?date=2026-10-14&lat=48.8566&lon=2.3522&units=metric&lang=en',
    );
    await cache.put(
      oldKey,
      rawResponse({
        payload: {
          data: {
            available: true,
            model: { date: paris.date, timeZone: 'Europe/Paris', lowC: -99 },
          },
          meta: { fetchedAt: new Date(now).toISOString() },
        },
        near: true,
        freshUntil: now + 3600000,
        staleUntil: now + 86400000,
      }),
    );
    const upstreamFetch = vi.fn(async () => rawResponse(near));
    const handler = createWorker({ now: () => now, cache, upstreamFetch });
    const first = await (await handler.fetch(weather(paris), env)).json();
    expect(first).toMatchObject({
      data: {
        available: true,
        model: {
          lowC: 12.95,
          highC: 20.84,
          temperatureC: { morning: 13.34 },
          feelsLikeC: { day: 17.1 },
        },
      },
      meta: { cached: false },
    });
    const second = await (await handler.fetch(weather(paris), env)).json();
    expect(second.data).toEqual(first.data);
    expect(second.meta.cached).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    await handler.fetch(weather(paris), mockEnv);
    await handler.fetch(new Request('http://localhost/api/geocode?q=Paris'), mockEnv);
    const keys = [...cache.entries.keys()];
    expect(keys).toContain(oldKey.url);
    expect(keys).toContain(oldKey.url.replace('/v2/', '/v3/'));
    expect(keys.some((key) => key.includes('/v2/fixture/weather?'))).toBe(true);
    expect(keys.some((key) => key.includes('/v2/fixture/geocode?'))).toBe(true);
    const stored = await cache.entries.get(oldKey.url.replace('/v2/', '/v3/')).clone().json();
    expect(stored.freshUntil).toBe(now + 3 * 3600000);
    expect(stored.staleUntil).toBe(now + 24 * 3600000);
  });
  it('rejects a secret in weather condition text before caching', async () => {
    const raw = copy(near);
    raw.data[0].weather[0].description = env.OPENWEATHER_API_KEY;
    const cache = memoryCache();
    const handler = createWorker({
      now: () => now,
      cache,
      upstreamFetch: async () => rawResponse(raw),
    });
    const response = await handler.fetch(weather(paris), env);
    expect(await error(response)).toBe('UPSTREAM_INVALID');
    expect(cache.entries.size).toBe(0);
  });
  it('refreshes on destination-local near-term transition and updates stale labels honestly', async () => {
    let clock = Date.parse('2026-10-14T09:59:00Z');
    const target = { ...paris, date: '2026-10-23' };
    const raw = page(target.date, 'Pacific/Kiritimati', { temp: { min: 0, max: 10 } });
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(rawResponse(raw))
      .mockImplementation(async () => rawResponse({}, 500));
    const handler = createWorker({
      now: () => clock,
      cache: memoryCache(),
      upstreamFetch,
      sleep: async () => {},
    });
    expect((await (await handler.fetch(weather(target), env)).json()).data.model.forecastType).toBe(
      'long-range',
    );
    // Oct 16 local midnight moves Oct 23 into the provisional eight-day window.
    clock = Date.parse('2026-10-15T10:00:00Z');
    const response = await handler.fetch(weather(target), env);
    // Older than 24h: cannot serve stale near-term data originally fetched as an estimate.
    expect(response.status).toBe(502);
  });
  it('bounds a second-page timeout without retry and does not cache partial coverage', async () => {
    vi.useFakeTimers();
    const first = { ...page('2026-10-13'), next: link(seconds('2026-10-15')) };
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(rawResponse(first))
      .mockImplementation(() => new Promise(() => {}));
    const cache = memoryCache();
    const handler = createWorker({ cache, now: () => now, upstreamFetch, timeoutMs: 20 });
    const pending = handler.fetch(weather(paris), env);
    await vi.advanceTimersByTimeAsync(21);
    expect(await error(await pending)).toBe('UPSTREAM_TIMEOUT');
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    expect(cache.entries.size).toBe(0);
  });
  it('enforces an aggregate 18-second deadline across page retries', async () => {
    vi.useFakeTimers();
    const first = { ...page('2026-10-13'), next: link(seconds('2026-10-15')) };
    const upstreamFetch = vi.fn(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, upstreamFetch.mock.calls.length === 3 ? 7000 : 6000),
      );
      return rawResponse(
        upstreamFetch.mock.calls.length === 1 ? {} : first,
        upstreamFetch.mock.calls.length === 1 ? 500 : 200,
      );
    });
    const provider = createProvider({
      upstreamFetch,
      now: () => now,
      sleep: async () => {},
      timeoutMs: 8000,
    });
    const pending = provider('/api/weather', paris, env, false);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(18001);
    await assertion;
    expect(upstreamFetch).toHaveBeenCalledTimes(3);
  });

  it('refreshes a still-fresh estimate at local midnight and relabels eligible stale data by policy', async () => {
    let clock = Date.parse('2026-10-14T09:59:00Z');
    const target = { ...paris, date: '2026-10-22' };
    const raw = page(target.date, 'Pacific/Kiritimati', { temp: { min: 0, max: 10 } });
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(rawResponse(raw))
      .mockImplementation(async () => rawResponse({}, 500));
    const handler = createWorker({
      now: () => clock,
      cache: memoryCache(),
      upstreamFetch,
      sleep: async () => {},
    });
    expect((await (await handler.fetch(weather(target), env)).json()).data.model.forecastType).toBe(
      'long-range',
    );
    clock += 60000;
    const result = await (await handler.fetch(weather(target), env)).json();
    expect(result.meta).toMatchObject({ cached: true, stale: true });
    expect(result.data.model.forecastType).toBe('standard');
    expect(upstreamFetch).toHaveBeenCalledTimes(3);
  });
  it('does not retry authentication or quota errors on a continuation page', async () => {
    for (const status of [401, 403, 429]) {
      const first = { ...page('2026-10-13'), next: link(seconds('2026-10-15')) };
      const upstreamFetch = vi
        .fn()
        .mockResolvedValueOnce(rawResponse(first))
        .mockResolvedValueOnce(rawResponse({}, status));
      const handler = createWorker({ now: () => now, cache: memoryCache(), upstreamFetch });
      const response = await handler.fetch(weather(paris), env);
      expect(response.status).toBe(503);
      expect(upstreamFetch).toHaveBeenCalledTimes(2);
      expect(await response.text()).not.toContain(env.OPENWEATHER_API_KEY);
    }
  });
  it('runs local fixture weather without credentials or upstream requests', async () => {
    const upstreamFetch = vi.fn();
    const handler = createWorker({ cache: memoryCache(), upstreamFetch, now: () => now });
    const result = await (await handler.fetch(weather(paris), mockEnv)).json();
    expect(result).toMatchObject({
      data: { available: true, model: { lowC: 0, highC: 15 } },
      meta: { mock: true },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
