import { normalizeCandidates } from '../shared/locations.js';
import { normalizeDaySummary } from './normalize.js';
import { validateInput } from './validation.js';
import { ApiError, malformed } from './errors.js';
import { createProvider } from './provider.js';
import { jsonResponse, SECURITY_HEADERS } from './security.js';

const routes = { '/api/geocode': 'GET', '/api/reverse-geocode': 'GET', '/api/weather': 'POST' };
const hour = 3600000;

// Maps/concurrency controls are per isolate, bounded, and deliberately not a
// worldwide allowance or persistent provider-account budget.
export function createWorker(options = {}) {
  const now = options.now ?? (() => Date.now());
  const provider = createProvider({
    upstreamFetch: options.upstreamFetch ?? ((...args) => fetch(...args)),
    now, timeoutMs: options.timeoutMs ?? 8000,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  });
  const limits = new Map();
  const inFlight = new Map();

  function rateLimit(request, route) {
    const identity = request.headers.get('CF-Connecting-IP') ?? 'local';
    const key = `${route}:${identity}`;
    const minute = Math.floor(now() / 60000);
    let entry = limits.get(key);
    if (!entry || entry.minute !== minute) {
      if (!entry && limits.size >= 2048) {
        for (const [oldKey, old] of limits) if (old.minute !== minute) limits.delete(oldKey);
        if (limits.size >= 2048) throw new ApiError('RATE_LIMITED', 429, 'Too many requests. Please wait before retrying.', 60);
      }
      entry = { minute, count: 0 };
      limits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > (route === '/api/weather' ? 5 : 10)) throw new ApiError('RATE_LIMITED', 429, 'Too many requests. Please wait before retrying.', 60);
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
        rateLimit(request, url.pathname);
        const input = await validateInput(request, url.pathname, url);
        if (env.OPENWEATHER_API_KEY && Object.values(input).some((value) => typeof value === 'string' && value.includes(env.OPENWEATHER_API_KEY))) {
          throw new ApiError('INVALID_INPUT', 400, 'Check the location and date inputs.');
        }
        const mock = env.STAGE === 'local' && env.MOCK_PROVIDER === 'true'
          && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (env.MOCK_PROVIDER === 'true' && !mock) throw new ApiError('MOCK_MODE_DENIED', 503, 'Local fixture mode is unavailable here.');
        const cache = options.cache ?? globalThis.caches?.default;
        const cacheKey = new Request(`${url.origin}/__tripcast-cache/v1/${mock ? 'fixture' : 'provider-3'}/${url.pathname.slice(5)}?${new URLSearchParams(Object.entries(input).map(([key, value]) => [key, String(value)]).sort())}&units=metric&lang=en`);
        const today = new Date(now()).toISOString().slice(0, 10);
        const dayDistance = input.date ? (Date.parse(`${input.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (24 * hour) : 0;
        const near = dayDistance <= 8;
        let stored;
        try { stored = await (await cache?.match(cacheKey))?.json(); } catch { /* Cache failure must not break a lookup. */ }
        if (stored && (!stored.payload || !Number.isFinite(stored.freshUntil))) stored = undefined;
        if (stored && now() < stored.freshUntil && !(url.pathname === '/api/weather' && near && !stored.near)) return jsonResponse({ ...stored.payload, meta: { ...stored.payload.meta, cached: true, stale: false } });
        const key = cacheKey.url;
        try {
          if (!inFlight.has(key)) {
            if (inFlight.size >= 32) throw new ApiError('SERVICE_BUSY', 503, 'Weather service is busy. Please retry shortly.', 1);
            const work = (async () => {
              const raw = await provider(url.pathname, input, env, mock);
              let data;
              try {
                if (url.pathname === '/api/weather') {
                  const normalized = normalizeDaySummary(raw, { date: input.date, location: { lat: input.lat, lon: input.lon } });
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
              // No IANA timezone in the 3.0 adapter: UTC +7/+8 edge is conservative
              // (short freshness); definitive destination-day policy awaits 4.0.
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
          return jsonResponse(await inFlight.get(key));
        } catch (error) {
          if (stored && now() < Math.min(stored.staleUntil, url.pathname === '/api/weather' && near ? Date.parse(stored.payload.meta.fetchedAt) + 24 * hour : stored.staleUntil) && stored.payload?.data?.available
            && error instanceof ApiError && ['UPSTREAM_FAILURE', 'UPSTREAM_TIMEOUT', 'UPSTREAM_LIMIT', 'SERVICE_BUSY'].includes(error.code)) {
            return jsonResponse({ ...stored.payload, meta: { ...stored.payload.meta, cached: true, stale: true } });
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
