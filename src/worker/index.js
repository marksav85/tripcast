import { normalizeCandidates } from '../shared/locations.js';
import { normalizeDaySummary } from './normalize.js';
import { normalizeTimelineDay } from './normalizeTimeline.js';
import { forecastPolicy } from './timeline.js';
import { verifySupabaseAccessToken } from './auth.js';
import { validateInput, validateTripWeatherInput } from './validation.js';
import { ApiError, malformed } from './errors.js';
import { createProvider } from './provider.js';
import { jsonResponse, SECURITY_HEADERS } from './security.js';

const routes = { '/api/geocode': 'GET', '/api/reverse-geocode': 'GET', '/api/weather': 'POST', '/api/trip-weather': 'POST' };
const hour = 3600000;

// Maps/concurrency controls are per isolate, bounded, and deliberately not a
// worldwide allowance or persistent provider-account budget.
function refreshLabels(payload, now) {
  const model = payload.data?.model;
  if (!model?.timeZone) return payload;
  const policy = forecastPolicy(model.date, model.timeZone, now);
  delete policy.near;
  return { ...payload, data: { ...payload.data, model: { ...model, ...policy } } };
}

// Conservative stub request limits, independent of future provider-work budgets.
function tripLimit(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > 60) {
    throw new ApiError('SERVICE_UNCONFIGURED', 503, 'Trip weather is unavailable. Please try again later.');
  }
  return Number(value);
}

export function createWorker(options = {}) {
  const now = options.now ?? (() => Date.now());
  const provider = createProvider({
    upstreamFetch: options.upstreamFetch ?? ((...args) => fetch(...args)),
    now, timeoutMs: options.timeoutMs ?? 8000,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  });
  const limits = new Map();
  const tripLimits = new Map();
  const inFlight = new Map();

  function rateLimit(request, route, maximum = route === '/api/weather' ? 5 : 10,
    identity = request.headers.get('CF-Connecting-IP') ?? 'local', buckets = limits) {
    const key = `${route}:${identity}`;
    const minute = Math.floor(now() / 60000);
    let entry = buckets.get(key);
    if (!entry || entry.minute !== minute) {
      if (!entry && buckets.size >= 2048) {
        for (const [oldKey, old] of buckets) if (old.minute !== minute) buckets.delete(oldKey);
        if (buckets.size >= 2048) throw new ApiError('RATE_LIMITED', 429, 'Too many requests. Please wait before retrying.', 60);
      }
      entry = { minute, count: 0 };
      buckets.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > maximum) throw new ApiError('RATE_LIMITED', 429, 'Too many requests. Please wait before retrying.', 60);
  }

  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/api') {
        if (!env.ASSETS) return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
        const response = await env.ASSETS.fetch(request);
        const secured = new Response(response.body, response);
        for (const [key, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(key, value);
        return secured;
      }
      try {
        if (!routes[url.pathname]) throw new ApiError('NOT_FOUND', 404, 'API route not found.');
        if (request.method !== routes[url.pathname]) return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } }, 405, { Allow: routes[url.pathname] });
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) throw new ApiError('ORIGIN_DENIED', 403, 'Cross-origin API requests are not allowed.');
        if (url.pathname === '/api/trip-weather') {
          const ipLimit = tripLimit(env.TRIP_WEATHER_IP_LIMIT, 10);
          rateLimit(request, '/api/trip-weather:ip', ipLimit, undefined, tripLimits);
          const authorization = request.headers.get('Authorization');
          const bearer = authorization?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i);
          if (!bearer || bearer[1].length > 16384) {
            throw new ApiError('UNAUTHENTICATED', 401, 'A valid authenticated session is required.');
          }
          const identity = await verifySupabaseAccessToken(bearer[1], env);
          rateLimit(request, '/api/trip-weather:user', tripLimit(env.TRIP_WEATHER_USER_LIMIT, 3), identity.userId, tripLimits);
          await validateTripWeatherInput(request, url);
          throw new ApiError('TRIP_WEATHER_NOT_IMPLEMENTED', 501, 'Trip weather aggregation is not available yet.');
        }
        rateLimit(request, url.pathname);
        const input = await validateInput(request, url.pathname, url);
        if (env.OPENWEATHER_API_KEY && Object.values(input).some((value) => typeof value === 'string' && value.includes(env.OPENWEATHER_API_KEY))) {
          throw new ApiError('INVALID_INPUT', 400, 'Check the location and date inputs.');
        }
        const mock = env.STAGE === 'local' && env.MOCK_PROVIDER === 'true'
          && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (env.MOCK_PROVIDER === 'true' && !mock) throw new ApiError('MOCK_MODE_DENIED', 503, 'Local fixture mode is unavailable here.');
        const cache = options.cache ?? globalThis.caches?.default;
        const cacheKey = new Request(`${url.origin}/__tripcast-cache/v2/${mock ? 'fixture' : 'provider-4'}/${url.pathname.slice(5)}?${new URLSearchParams(Object.entries(input).map(([key, value]) => [key, String(value)]).sort())}&units=metric&lang=en`);
        const today = new Date(now()).toISOString().slice(0, 10);
        const dayDistance = input.date ? (Date.parse(`${input.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (24 * hour) : 0;
        let near = dayDistance <= 8;
        let stored;
        try { stored = await (await cache?.match(cacheKey))?.json(); } catch { /* Cache failure must not break a lookup. */ }
        if (stored?.payload?.data?.model?.timeZone) near = forecastPolicy(input.date, stored.payload.data.model.timeZone, now()).near;
        if (stored && (!stored.payload || !Number.isFinite(stored.freshUntil))) stored = undefined;
        if (stored && now() < stored.freshUntil && !(url.pathname === '/api/weather' && near && !stored.near)) return jsonResponse(refreshLabels({ ...stored.payload, meta: { ...stored.payload.meta, cached: true, stale: false } }, now()));
        const key = cacheKey.url;
        try {
          if (!inFlight.has(key)) {
            if (inFlight.size >= 32) throw new ApiError('SERVICE_BUSY', 503, 'Weather service is busy. Please retry shortly.', 1);
            const work = (async () => {
              const raw = await provider(url.pathname, input, env, mock);
              let data;
              try {
                if (url.pathname === '/api/weather') {
                  const normalized = mock
                    ? normalizeDaySummary(raw, { date: input.date, location: { lat: input.lat, lon: input.lon } })
                    : normalizeTimelineDay(raw, input.date, now());
                  if (!mock) near = forecastPolicy(input.date, normalized.model.timeZone, now()).near;
                  // Cache contains meteorology only, never user-submitted labels/GPS metadata.
                  const model = { ...normalized.model };
                  delete model.location;
                  data = { model, available: normalized.available };
                } else {
                  data = normalizeCandidates(raw);
                  if (url.pathname === '/api/reverse-geocode') data = data.slice(0, 1).map((item) => ({ ...item, lat: input.lat, lon: input.lon }));
                }
              } catch { throw malformed(); }
              if (env.OPENWEATHER_API_KEY && JSON.stringify(data).includes(JSON.stringify(env.OPENWEATHER_API_KEY).slice(1, -1))) throw malformed();
              const payload = { data, meta: { mock, cached: false, stale: false, fetchedAt: new Date(now()).toISOString() } };
              // Live freshness uses destination-local policy; demo fixtures retain
              // the conservative UTC boundary without inventing a timezone.
              const unavailable = url.pathname === '/api/weather' ? !data.available : !data.length;
              const fresh = unavailable ? 15 * 60000 : url.pathname === '/api/weather' ? (near ? 3 : 24) * hour : 7 * 24 * hour;
              const retention = unavailable ? fresh : url.pathname === '/api/weather' ? (near ? 24 : 72) * hour : fresh;
              const record = { payload, near, freshUntil: now() + fresh, staleUntil: now() + retention };
              try { await cache?.put(cacheKey, new Response(JSON.stringify(record), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${Math.ceil(retention / 1000)}` } })); } catch { /* Best-effort datacenter-local cache. */ }
              return payload;
            })();
            inFlight.set(key, work);
            // Do not leave a rejected cleanup promise unhandled.
            void work.then(() => inFlight.delete(key), () => inFlight.delete(key));
          }
          return jsonResponse(refreshLabels(await inFlight.get(key), now()));
        } catch (error) {
          if (stored && now() < Math.min(stored.staleUntil, url.pathname === '/api/weather' && near ? Date.parse(stored.payload.meta.fetchedAt) + 24 * hour : stored.staleUntil) && stored.payload?.data?.available
            && error instanceof ApiError && ['UPSTREAM_FAILURE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_LIMIT', 'SERVICE_BUSY'].includes(error.code)) {
            return jsonResponse(refreshLabels({ ...stored.payload, meta: { ...stored.payload.meta, cached: true, stale: true } }, now()));
          }
          throw error;
        }
      } catch (error) {
        const safe = error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR', 500, 'Request could not be completed.');
        return jsonResponse({ error: { code: safe.code, message: safe.message } }, safe.status,
          safe.retryAfter ? { 'Retry-After': String(safe.retryAfter) } : {});
      }
    },
  };
}
export default createWorker();
