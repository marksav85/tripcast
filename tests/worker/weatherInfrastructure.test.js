import { afterEach, describe, expect, it, vi } from 'vitest';
import near from './fixtures/paris-near.json';
import { createWeatherContext } from '../../src/worker/weatherContext.js';
import { createWeatherRetrieval } from '../../src/worker/weather.js';
import { createProvider } from '../../src/worker/provider.js';
import { collectTimeline, TIMELINE_PATH } from '../../src/worker/timeline.js';
import { createWorker } from '../../src/worker/index.js';
import { ApiError } from '../../src/worker/errors.js';
import { env, mockEnv, memoryCache, rawResponse, weather } from './helpers.js';

const clock = Date.parse('2026-10-14T12:00:00Z');
const input = { lat: 48.8566, lon: 2.3522, date: '2026-10-14' };
const contexts = [];
const context = (options) => { const value = createWeatherContext(options); contexts.push(value); return value; };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const provider = (upstreamFetch, options = {}) => createProvider({ upstreamFetch, now: () => Date.now(), sleep: async () => {}, timeoutMs: 8000, ...options });
const firstPage = () => ({ ...near, data: near.data.slice(0, 1),
  next: `http://api.openweathermap.org${TIMELINE_PATH}?cnt=10&lat=48.8566&lon=2.3522&start=${Date.parse('2026-10-15') / 1000}` });
afterEach(() => { contexts.splice(0).forEach(c => c.dispose()); vi.useRealTimers(); });

describe('shared provider accounting', () => {
  it('admits eleven operations and rejects the twelfth before sending', async () => {
    const budget = context(); const fetch = vi.fn(async () => rawResponse(near)); const run = provider(fetch);
    for (let i = 0; i < 11; i += 1) await run('/api/weather', input, env, false, { context: budget });
    await expect(run('/api/weather', input, env, false, { context: budget })).rejects.toMatchObject({ code: 'COLLECTOR_BUDGET_EXHAUSTED' });
    expect(fetch).toHaveBeenCalledTimes(11); expect(budget.usage).toMatchObject({ operations: 11, attempts: 11, active: 0 });
  });
  it('counts page retries across operations and stops at 24 sends', async () => {
    const budget = context();
    const fetch = vi.fn(async () => {
      const count = fetch.mock.calls.length;
      if (count % 2) return rawResponse({}, 500);
      return rawResponse(count % 4 === 2 ? firstPage() : { ...near, data: near.data.slice(1, 2) });
    });
    const run = provider(fetch); const range = { ...input, endDate: '2026-10-15' };
    for (let i = 0; i < 6; i += 1) await run('/api/weather', range, env, false, { context: budget });
    await expect(run('/api/weather', range, env, false, { context: budget })).rejects.toMatchObject({ code: 'REQUEST_BUDGET_EXHAUSTED' });
    expect(fetch).toHaveBeenCalledTimes(24); expect(budget.usage).toMatchObject({ operations: 6, attempts: 24, active: 0 });
  });
  it('shares the two-request semaphore across independent provider instances', async () => {
    const budget = context(); const gates = []; let active = 0; let peak = 0;
    const fetch = vi.fn(async () => { active += 1; peak = Math.max(peak, active); const gate = deferred(); gates.push(gate); await gate.promise; active -= 1; return rawResponse(near); });
    const run = provider(fetch); const another = provider(fetch);
    const work = [run('/api/weather', input, env, false, { context: budget }),
      run('/api/weather', input, env, false, { context: budget }), another('/api/weather', input, env, false, { context: budget })];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(budget.usage.queued).toBe(1); gates[0].resolve();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    gates.forEach(gate => gate.resolve()); await Promise.all(work);
    expect(peak).toBe(2); expect(budget.usage).toMatchObject({ active: 0, queued: 0, attempts: 3 });
  });
  it('preserves the provider-instance ceiling of three collector operations', async () => {
    const budget = context(); const gate = deferred(); const fetch = vi.fn(async () => { await gate.promise; return rawResponse(near); });
    const run = provider(fetch);
    const work = Array.from({ length: 3 }, () => run('/api/weather', input, env, false, { context: budget }));
    await expect(run('/api/weather', input, env, false, { context: budget })).rejects.toMatchObject({ code: 'SERVICE_BUSY' });
    gate.resolve(); await Promise.all(work); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('releases failed HTTP slots so queued operations can proceed', async () => {
    const budget = context(); const gate = deferred();
    const fetch = vi.fn(async () => { if (fetch.mock.calls.length <= 2) { await gate.promise; return rawResponse({}, 400); } return rawResponse(near); });
    const run = provider(fetch);
    const work = Array.from({ length: 3 }, () => run('/api/weather', input, env, false, { context: budget }));
    const settled = Promise.allSettled(work); await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    gate.resolve(); const results = await settled;
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected', 'fulfilled']);
    expect(budget.usage).toMatchObject({ active: 0, queued: 0 });
  });
});

describe('cancellation and deadlines', () => {
  it('cancels queued and active work and cannot send again after abort', async () => {
    const parent = new AbortController(); const budget = context({ signal: parent.signal });
    const fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })));
    const run = provider(fetch);
    const work = Array.from({ length: 3 }, () => run('/api/weather', input, env, false, { context: budget }));
    const settled = Promise.allSettled(work); await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    parent.abort(new Error('sensitive parent reason'));
    const results = await settled;
    expect(results.every(result => result.reason.code === 'REQUEST_CANCELLED')).toBe(true);
    expect(fetch.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
    await expect(run('/api/weather', input, env, false, { context: budget })).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    expect(fetch).toHaveBeenCalledTimes(2); expect(budget.usage).toMatchObject({ active: 0, queued: 0 });
    // Provider capacity is released for an independent request as well.
    fetch.mockImplementation(async () => rawResponse(near));
    await expect(run('/api/weather', input, env, false)).resolves.toHaveProperty('days');
  });
  it('rejects an already aborted request without sending', async () => {
    const parent = new AbortController(); parent.abort(); const budget = context({ signal: parent.signal });
    const fetch = vi.fn(); await expect(provider(fetch)('/api/weather', input, env, false, { context: budget })).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('aborts retry waits and never starts the retry', async () => {
    const parent = new AbortController(); const budget = context({ signal: parent.signal });
    const fetch = vi.fn(async () => rawResponse({}, 500)); const sleeping = vi.fn(() => new Promise(() => {}));
    const pending = provider(fetch, { sleep: sleeping })('/api/weather', input, env, false, { context: budget });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    await vi.waitFor(() => expect(sleeping).toHaveBeenCalledTimes(1)); parent.abort(); await assertion;
    expect(fetch).toHaveBeenCalledTimes(1); expect(budget.usage.active).toBe(0);
  });
  it('retains the 18-second operation deadline even when a retry wait stalls', async () => {
    vi.useFakeTimers(); const budget = context(); const fetch = vi.fn(async () => rawResponse({}, 500));
    const sleeping = vi.fn(() => new Promise(() => {}));
    const pending = provider(fetch, { sleep: sleeping })('/api/weather', input, env, false, { context: budget });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(18001); await assertion;
    expect(fetch).toHaveBeenCalledTimes(1); expect(budget.usage.active).toBe(0);
  });
  it('bounds later operations by the remaining 30-second overall deadline', async () => {
    vi.useFakeTimers(); const budget = context(); await vi.advanceTimersByTimeAsync(25000);
    const fetch = vi.fn(() => new Promise(() => {})); const run = provider(fetch);
    const pending = run('/api/weather', input, env, false, { context: budget });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'REQUEST_DEADLINE' });
    await vi.advanceTimersByTimeAsync(5001); await assertion;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    await expect(run('/api/weather', input, env, false, { context: budget })).rejects.toMatchObject({ code: 'REQUEST_DEADLINE' });
    expect(fetch).toHaveBeenCalledTimes(1); expect(budget.usage.active).toBe(0);
  });
  it('expires queued operations without sending them', async () => {
    vi.useFakeTimers(); const budget = context(); await vi.advanceTimersByTimeAsync(25000);
    const fetch = vi.fn(() => new Promise(() => {})); const run = provider(fetch);
    const work = Array.from({ length: 3 }, () => run('/api/weather', input, env, false, { context: budget }));
    const settled = Promise.allSettled(work);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2);
    expect(budget.usage.queued).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await settled).every(result => result.reason.code === 'REQUEST_DEADLINE')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2); expect(budget.usage).toMatchObject({ active: 0, queued: 0 });
    budget.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts an active fetch at the shorter operation deadline', async () => {
    vi.useFakeTimers(); const budget = context();
    const fetch = vi.fn(() => new Promise(() => {}));
    const pending = provider(fetch, { timeoutMs: 25000 })('/api/weather', input, env, false, { context: budget });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(18001); await assertion;
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(budget.usage.active).toBe(0);
  });
  it('cancels a stalled response reader, not only the fetch promise', async () => {
    const parent = new AbortController(); const budget = context({ signal: parent.signal }); const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ start() {}, cancel }), { headers: { 'Content-Type': 'application/json' } }));
    const pending = provider(fetch)('/api/weather', input, env, false, { context: budget });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); parent.abort(); await assertion;
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1)); expect(budget.usage.active).toBe(0);
  });
});

const retrieval = (fetch, options = {}) => {
  const cache = options.cache ?? memoryCache(); const run = provider(fetch, { now: () => clock });
  const service = createWeatherRetrieval({ provider: run, now: () => clock });
  return { ...service, cache, settings: { origin: 'http://localhost', mock: false, cache, ...options } };
};
describe('partial date outcomes', () => {
  it('retains validated first-page measurements while unresolved dates become errors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(rawResponse(firstPage())).mockResolvedValue(rawResponse({}, 503));
    const service = retrieval(fetch); const budget = context();
    const results = await service.getRange({ ...input, endDate: '2026-10-15' }, env, { ...service.settings, context: budget });
    expect(results.map(day => [day.date, day.status])).toEqual([['2026-10-14', 'available'], ['2026-10-15', 'error']]);
    expect(results[0].model.temperatureC.morning).toBe(13.34);
    expect(results[1].error.code).toBe('UPSTREAM_FAILURE'); expect(service.cache.entries.size).toBe(1);
  });
  it('distinguishes a fully assessed missing record from incomplete pagination', async () => {
    const service = retrieval(vi.fn(async () => rawResponse({ ...near, data: [] })));
    const [day] = await service.getRange(input, env, service.settings);
    expect(day.status).toBe('unavailable'); expect(day.error).toBeUndefined(); expect(day.model.lowC).toBeNull();
  });
  it('preserves first-page success after shared budget exhaustion', async () => {
    const budget = context(); for (let i = 0; i < 23; i += 1) budget.startAttempt();
    const fetch = vi.fn(async () => rawResponse(firstPage())); const service = retrieval(fetch);
    const results = await service.getRange({ ...input, endDate: '2026-10-15' }, env, { ...service.settings, context: budget });
    expect(results.map(day => day.status)).toEqual(['available', 'error']);
    expect(results[1].error.code).toBe('REQUEST_BUDGET_EXHAUSTED'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['timeout', 'cancel', 'malformed'])('retains first-page successes after a later %s', async (failure) => {
    const parent = new AbortController(); const budget = context({ signal: parent.signal });
    const fetch = vi.fn().mockResolvedValueOnce(rawResponse(firstPage()));
    if (failure === 'timeout') fetch.mockImplementation(() => new Promise(() => {}));
    if (failure === 'cancel') fetch.mockImplementation(() => { parent.abort(); return new Promise(() => {}); });
    if (failure === 'malformed') fetch.mockResolvedValue(rawResponse({ ...near, timezone: 'UTC' }));
    const run = provider(fetch, { now: () => clock, timeoutMs: 10 });
    const service = createWeatherRetrieval({ provider: run, now: () => clock });
    const results = await service.getRange({ ...input, endDate: '2026-10-15' }, env, { origin: 'http://localhost', mock: false, cache: memoryCache(), context: budget });
    expect(results[0]).toMatchObject({ status: 'available', model: { lowC: 12.95 } });
    expect(results[1]).toMatchObject({ status: 'error', error: { code: failure === 'timeout' ? 'UPSTREAM_TIMEOUT' : failure === 'cancel' ? 'REQUEST_CANCELLED' : 'UPSTREAM_INVALID' } });
  });
  it('keeps public collection all-or-error unless partial mode is requested', async () => {
    const failure = new ApiError('UPSTREAM_TIMEOUT', 504, 'Weather service timed out. Please retry.');
    const pages = () => vi.fn().mockResolvedValueOnce(firstPage()).mockRejectedValue(failure);
    await expect(collectTimeline({ ...input, endDate: '2026-10-15' }, pages())).rejects.toBe(failure);
    const result = await collectTimeline({ ...input, endDate: '2026-10-15' }, pages(), { partial: true });
    expect(result.complete).toBe(false); expect(result.days[0].record).toEqual(near.data[0]);
    expect(result.days[1]).toMatchObject({ record: null, error: { code: 'UPSTREAM_TIMEOUT' } });
  });
});

describe('shared per-date cache', () => {
  it('reuses public v3 weather in an aggregate context without charging operations or attempts', async () => {
    const cache = memoryCache(); const fetch = vi.fn(async () => rawResponse(near));
    const handler = createWorker({ cache, now: () => clock, upstreamFetch: fetch });
    expect((await handler.fetch(weather(input), env)).status).toBe(200);
    const service = retrieval(fetch, { cache }); const budget = context();
    const results = await service.getRange(input, env, { ...service.settings, context: budget });
    expect(results[0]).toMatchObject({ status: 'available', meta: { cached: true }, model: { lowC: 12.95, temperatureC: { morning: 13.34 } } });
    expect(budget.usage).toMatchObject({ operations: 0, attempts: 0 }); expect(fetch).toHaveBeenCalledTimes(1);
    const cached = await service.getCachedDay(input, service.settings); expect(cached.meta.cached).toBe(true);
  });
  it('writes range results under existing public day keys, never the caller envelope', async () => {
    const fetch = vi.fn(async () => rawResponse(near)); const service = retrieval(fetch); const budget = context();
    await service.getRange({ ...input, endDate: '2026-10-15', title: 'private-trip', userId: 'private-user', token: 'private-token' }, env, { ...service.settings, context: budget });
    expect(budget.usage).toMatchObject({ operations: 1, attempts: 1 });
    for (const [key, response] of service.cache.entries) {
      expect(key).toContain('/v3/provider-4/weather?'); expect(key).toContain('units=metric&lang=en');
      const text = key + await response.clone().text();
      for (const sensitive of ['private-trip', 'private-user', 'private-token', env.OPENWEATHER_API_KEY, 'endDate']) expect(text).not.toContain(sensitive);
    }
    const handler = createWorker({ cache: service.cache, now: () => clock, upstreamFetch: fetch });
    expect((await (await handler.fetch(weather({ ...input, date: '2026-10-15' }), env)).json()).meta.cached).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('isolates fixture results from live normalized models', async () => {
    const fetch = vi.fn(async () => rawResponse(near)); const service = retrieval(fetch);
    await service.getDay(input, mockEnv, { ...service.settings, mock: true });
    await service.getDay(input, env, service.settings);
    const keys = [...service.cache.entries.keys()];
    expect(keys.some(key => key.includes('/v2/fixture/weather?'))).toBe(true);
    expect(keys.some(key => key.includes('/v3/provider-4/weather?'))).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not coalesce sends owned by different aggregate contexts', async () => {
    const gate = deferred(); const fetch = vi.fn(async () => { await gate.promise; return rawResponse(near); });
    const service = retrieval(fetch); const a = context(); const b = context();
    const work = [service.getDay(input, env, { ...service.settings, context: a }), service.getDay(input, env, { ...service.settings, context: b })];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); gate.resolve(); await Promise.all(work);
    expect(a.usage.attempts).toBe(1); expect(b.usage.attempts).toBe(1);
  });
  it('keeps stale policy for range results and does not cache retrieval errors', async () => {
    let time = clock; const cache = memoryCache(); const fetch = vi.fn(async () => rawResponse(near));
    const service = createWeatherRetrieval({ provider: provider(fetch), now: () => time });
    const settings = { origin: 'http://localhost', mock: false, cache };
    await service.getDay(input, env, settings); time += 4 * 3600000;
    fetch.mockRejectedValue(new Error('sensitive network details'));
    const [day] = await service.getRange(input, env, settings);
    expect(day).toMatchObject({ status: 'available', meta: { cached: true, stale: true } });
    time += 21 * 3600000;
    const [expired] = await service.getRange(input, env, settings);
    expect(expired).toMatchObject({ status: 'error', error: { code: 'UPSTREAM_FAILURE' } });
    expect(JSON.stringify(expired)).not.toContain('sensitive'); expect(cache.entries.size).toBe(1);
  });
  it('leaves distant and unavailable cache lifetimes unchanged', async () => {
    const distant = { ...input, date: '2026-10-23' };
    const fetch = vi.fn(async () => rawResponse(near)); const service = retrieval(fetch);
    await service.getDay(distant, env, service.settings);
    let stored = await [...service.cache.entries.values()][0].clone().json();
    expect(stored.freshUntil).toBe(clock + 24 * 3600000); expect(stored.staleUntil).toBe(clock + 72 * 3600000);
    const unavailable = retrieval(vi.fn(async () => rawResponse({ ...near, data: [] })));
    await unavailable.getDay(input, env, unavailable.settings);
    stored = await [...unavailable.cache.entries.values()][0].clone().json();
    expect(stored.freshUntil).toBe(clock + 15 * 60000); expect(stored.staleUntil).toBe(stored.freshUntil);
  });
  it('does not join public in-flight work from an aggregate context', async () => {
    const gate = deferred(); const fetch = vi.fn(async () => { await gate.promise; return rawResponse(near); });
    const service = retrieval(fetch); const budget = context();
    const publicWork = service.getDay(input, env, service.settings);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const protectedWork = service.getDay(input, env, { ...service.settings, context: budget });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    budget.dispose(); const assertion = expect(protectedWork).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' });
    gate.resolve(); await assertion; await publicWork;
    expect(budget.usage.attempts).toBe(1);
  });
  it('still coalesces equivalent public single-date misses', async () => {
    const gate = deferred(); const fetch = vi.fn(async () => { await gate.promise; return rawResponse(near); });
    const service = retrieval(fetch);
    const work = [service.getDay(input, env, service.settings), service.getDay(input, env, service.settings)];
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1)); gate.resolve(); await Promise.all(work);
  });
});
