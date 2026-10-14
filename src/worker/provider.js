import { ApiError, malformed } from './errors.js';
import { readLimitedJSON } from './validation.js';
import { mockProvider } from './fixtures.js';
import { collectTimeline, TIMELINE_PATH, MAX_WEATHER_CALLS } from './timeline.js';

const paths = {
  '/api/geocode': 'geo/1.0/direct',
  '/api/reverse-geocode': 'geo/1.0/reverse',
  '/api/weather': TIMELINE_PATH.slice(1),
};
export function providerURL(route, input) {
  const url = new URL(paths[route], 'https://api.openweathermap.org/');
  const params = route === '/api/weather' ? { lat: input.lat, lon: input.lon, start: Date.parse(`${input.date}T00:00:00Z`) / 1000, units: 'metric', lang: 'en' }
    : { ...input, limit: route === '/api/geocode' ? 5 : 1 };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url;
}

export function createProvider({ upstreamFetch, sleep, timeoutMs, now }) {
  let active = 0;
  let cooldownUntil = 0;
  return async (route, input, env, mock) => {
    if (mock) {
      const url = providerURL(route, input);
      if (route === '/api/weather') url.searchParams.set('date', input.date);
      return mockProvider(url);
    }
    if (typeof env.OPENWEATHER_API_KEY !== 'string' || !env.OPENWEATHER_API_KEY.trim()) {
      throw new ApiError('SERVICE_UNCONFIGURED', 503, 'Weather service is not configured.');
    }
    if (now() < cooldownUntil) throw new ApiError('UPSTREAM_LIMIT', 503, 'Weather service quota is temporarily unavailable.', 60);
    if (active >= 3) throw new ApiError('SERVICE_BUSY', 503, 'Weather service is busy. Please retry shortly.', 1);
    active += 1;
    try {
      let calls = 0;
      const deadline = Date.now() + 18000;
      async function fetchPage(start) {
        const url = providerURL(route, input);
        if (start !== undefined) url.searchParams.set('start', String(start));
        url.searchParams.set('appid', env.OPENWEATHER_API_KEY);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (calls >= (route === '/api/weather' ? MAX_WEATHER_CALLS : 2)) throw malformed();
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new ApiError('UPSTREAM_TIMEOUT', 504, 'Weather service timed out. Please retry.');
          calls += 1;
          const controller = new AbortController();
          let timer;
          let timedOut = false;
          try {
            const work = (async () => {
              const response = await upstreamFetch(url.toString(), { redirect: 'error', signal: controller.signal });
              if (response.status === 429) {
                const seconds = Math.min(300, Math.max(60, Number(response.headers.get('retry-after')) || 60));
                cooldownUntil = now() + seconds * 1000;
                throw new ApiError('UPSTREAM_LIMIT', 503, 'Weather service quota is temporarily unavailable.', seconds);
              }
              if ([401, 403].includes(response.status)) throw new ApiError('UPSTREAM_ACCESS', 503, 'Weather service access is unavailable.');
              if (response.status >= 500) throw new ApiError('UPSTREAM_FAILURE', 502, 'Weather service failed. Please retry.');
              if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw malformed();
              return readLimitedJSON(response.body, 262144, malformed(), { timeoutError: new ApiError('UPSTREAM_TIMEOUT', 504, 'Weather service timed out. Please retry.') });
            })();
            const timeout = new Promise((resolve, reject) => {
              timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
                reject(new ApiError('UPSTREAM_TIMEOUT', 504, 'Weather service timed out. Please retry.'));
              }, Math.min(timeoutMs, remaining));
            });
            return await Promise.race([work, timeout]);
          } catch (error) {
            // Abort a rejected/oversized response too; never return raw exceptions.
            controller.abort();
            const safe = timedOut ? new ApiError('UPSTREAM_TIMEOUT', 504, 'Weather service timed out. Please retry.')
              : error instanceof ApiError ? error : new ApiError('UPSTREAM_FAILURE', 502, 'Weather service failed. Please retry.');
            if (attempt === 0 && safe.code === 'UPSTREAM_FAILURE') { await sleep(250); continue; }
            throw safe;
          } finally { clearTimeout(timer); }
        }
      }
      return route === '/api/weather' ? await collectTimeline(input, fetchPage) : await fetchPage();
    } finally { active -= 1; }
  };
}
