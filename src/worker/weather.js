import { abortable } from './weatherContext.js';
import { ApiError, malformed } from './errors.js';
import { normalizeDaySummary } from './normalize.js';
import { normalizeTimelineDay } from './normalizeTimeline.js';
import { forecastPolicy, timelineDates } from './timeline.js';

const hour = 3600000;
const transient = ['UPSTREAM_FAILURE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_LIMIT', 'SERVICE_BUSY'];
const safeFailure = (error) => error instanceof ApiError ? error : new ApiError('UPSTREAM_FAILURE', 502, 'Weather service failed. Please retry.');

/** Shared meteorology only. Callers must authenticate protected requests before entry. */
export function createWeatherRetrieval({ provider, now = () => Date.now(), inFlight = new Map() }) {
  function key(input, { origin, mock }) {
    const query = new URLSearchParams({ date: input.date, lat: String(input.lat), lon: String(input.lon) });
    return new Request(`${new URL(origin).origin}/__tripcast-cache/${mock ? 'v2/fixture' : 'v3/provider-4'}/weather?${query}&units=metric&lang=en`);
  }
  function near(input, mock, model) {
    return !mock && model?.timeZone ? forecastPolicy(input.date, model.timeZone, now()).near
      : (Date.parse(`${input.date}T00:00:00Z`) - Date.parse(`${new Date(now()).toISOString().slice(0, 10)}T00:00:00Z`)) / (24 * hour) <= 8;
  }
  function refresh(payload, cached, stale) {
    const model = payload.data.model;
    let policy = {};
    if (model.timeZone) { policy = forecastPolicy(model.date, model.timeZone, now()); delete policy.near; }
    return { data: { ...payload.data, model: { ...model, ...policy } }, meta: { ...payload.meta, cached, stale } };
  }
  async function read(input, options) {
    try {
      const stored = await abortable(options.context?.signal, async () => (await options.cache?.match(key(input, options)))?.json());
      return stored?.payload?.data?.model && Number.isFinite(stored.freshUntil) ? stored : null;
    } catch { options.context?.check(); return null; }
  }
  function fresh(input, options, stored) {
    return stored && now() < stored.freshUntil && !(near(input, options.mock, stored.payload.data.model) && !stored.near)
      ? refresh(stored.payload, true, false) : null;
  }
  function stale(input, options, stored, error) {
    if (!stored || !transient.includes(error.code) || !stored.payload.data.available) return null;
    const until = near(input, options.mock, stored.payload.data.model)
      ? Math.min(stored.staleUntil, Date.parse(stored.payload.meta.fetchedAt) + 24 * hour) : stored.staleUntil;
    return now() < until ? refresh(stored.payload, true, true) : null;
  }
  async function store(input, env, options, raw) {
    let normalized;
    try {
      normalized = options.mock ? normalizeDaySummary(raw, { date: input.date, location: { lat: input.lat, lon: input.lon } })
        : normalizeTimelineDay(raw, input.date, now());
    } catch { throw malformed(); }
    const model = { ...normalized.model }; delete model.location;
    const data = { model, available: normalized.available };
    if (env.OPENWEATHER_API_KEY && JSON.stringify(data).includes(JSON.stringify(env.OPENWEATHER_API_KEY).slice(1, -1))) throw malformed();
    const payload = { data, meta: { mock: options.mock, cached: false, stale: false, fetchedAt: new Date(now()).toISOString() } };
    const isNear = near(input, options.mock, model);
    const lifetime = data.available ? (isNear ? 3 : 24) * hour : 15 * 60000;
    const retention = data.available ? (isNear ? 24 : 72) * hour : lifetime;
    const record = { payload, near: isNear, freshUntil: now() + lifetime, staleUntil: now() + retention };
    try { await abortable(options.context?.signal, () => options.cache?.put(key(input, options), new Response(JSON.stringify(record), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${Math.ceil(retention / 1000)}` },
    }))); } catch { /* Best-effort datacenter-local cache. */ }
    return payload;
  }
  async function getCachedDay(input, options) {
    options.context?.check();
    return fresh(input, options, await read(input, options));
  }
  async function getDay(input, env, options) {
    options.context?.check();
    const stored = await read(input, options);
    const hit = fresh(input, options, stored);
    if (hit) return hit;
    const work = async () => store(input, env, options,
      await provider('/api/weather', { lat: input.lat, lon: input.lon, date: input.date }, env, options.mock, { context: options.context }));
    try {
      // Public equivalents may coalesce. Aggregate contexts always own their sends,
      // cancellation, and budget, so never join work owned by another request.
      if (options.context) return await work();
      const id = key(input, options).url;
      if (!inFlight.has(id)) {
        if (inFlight.size >= 32) throw new ApiError('SERVICE_BUSY', 503, 'Weather service is busy. Please retry shortly.', 1);
        const pending = work(); inFlight.set(id, pending);
        void pending.then(() => inFlight.delete(id), () => inFlight.delete(id));
      }
      return refresh(await inFlight.get(id), false, false);
    } catch (error) {
      const safe = safeFailure(error);
      const fallback = stale(input, options, stored, safe);
      if (fallback) return fallback;
      throw safe;
    }
  }
  const outcome = (date, payload) => ({ date, status: payload.data.available ? 'available' : 'unavailable',
    model: payload.data.model, meta: payload.meta });
  const failed = (date, error) => ({ date, status: 'error', model: null, error: { code: error.code, message: error.message } });
  /** One <=10-date range, not itinerary aggregation. Partial outcomes are opt-in here. */
  async function getRange(input, env, options) {
    const dates = timelineDates(input);
    options.context?.check();
    const entries = await Promise.all(dates.map(date => read({ ...input, date }, options)));
    const hits = dates.map((date, i) => fresh({ ...input, date }, options, entries[i]));
    if (hits.every(Boolean)) return hits.map((hit, i) => outcome(dates[i], hit));
    const missing = dates.filter((_date, i) => !hits[i]);
    let raw;
    try {
      raw = await provider('/api/weather', { lat: input.lat, lon: input.lon, date: missing[0], endDate: missing.at(-1) },
        env, options.mock, { context: options.context, partial: true });
    } catch (error) {
      const safe = safeFailure(error);
      raw = { days: missing.map(date => ({ date, record: null, error: safe })) };
    }
    return Promise.all(dates.map(async (date, i) => {
      if (hits[i]) return outcome(date, hits[i]);
      const day = options.mock && raw.mockDays ? raw.mockDays.find(day => day.date === date) : raw.days.find(day => day.date === date);
      try {
        if (day?.error) throw day.error;
        if (!day) throw malformed();
        return outcome(date, await store({ ...input, date }, env, options, options.mock ? day.raw : raw));
      } catch (error) {
        const safe = safeFailure(error);
        const fallback = stale({ ...input, date }, options, entries[i], safe);
        return fallback ? outcome(date, fallback) : failed(date, safe);
      }
    }));
  }
  return { getDay, getCachedDay, getRange };
}
