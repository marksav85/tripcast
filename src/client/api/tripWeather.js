import { supabase } from './supabase.js';
import { allocateTripDates } from '../../shared/trip.js';

const messages = {
  UNAUTHENTICATED: 'Sign in again to retrieve trip weather.',
  AUTH_UNAVAILABLE: 'Authentication is unavailable. Please try again later.',
  INVALID_INPUT: 'Review and save your trip before requesting weather.',
  RATE_LIMITED: 'Too many weather requests. Please wait before refreshing.',
  SERVICE_UNAVAILABLE: 'Trip weather is unavailable. Please try again later.',
  NETWORK_ERROR: 'Could not connect to trip weather. Check your connection and retry.',
  TIMEOUT: 'Trip weather timed out. Please retry.',
  CANCELLED: 'Weather request cancelled.',
  INVALID_RESPONSE: 'Trip weather returned an unexpected response. Please retry.',
  WEATHER_RETRIEVAL_FAILED: 'Weather could not be retrieved for this date.',
  DATE_UNAVAILABLE: 'This date is outside the provisional weather range.',
  NO_WEATHER_DATA: 'No usable weather data is available for this date.',
};
const failure = (code, retryAfter) => ({
  ok: false,
  data: null,
  error: {
    code,
    message: messages[code],
    ...(retryAfter === undefined ? {} : { retryAfter }),
  },
});
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const measurement = (value) =>
  value === null || (typeof value === 'number' && Number.isFinite(value));
const text = (value) => typeof value === 'string' && value.length <= 200;
function model(value, date) {
  if (
    !object(value) ||
    value.date !== date ||
    !['lowC', 'highC'].every((key) => measurement(value[key]))
  )
    throw new Error();
  const result = { date, lowC: value.lowC, highC: value.highC };
  for (const key of ['timeZone', 'source', 'forecastType', 'forecastLabel', 'forecastPolicy']) {
    if (value[key] != null && !text(value[key])) throw new Error();
    if (Object.hasOwn(value, key)) result[key] = value[key];
  }
  for (const key of [
    'cloudPercent',
    'humidityPercent',
    'windSpeedMs',
    'windDirectionDeg',
    'uvIndex',
    'precipitationProbability',
    'precipitationMm',
    'pressureHpa',
    'dewPointC',
    'providerRainValue',
  ]) {
    if (Object.hasOwn(value, key)) {
      if (!measurement(value[key])) throw new Error();
      result[key] = value[key];
    }
  }
  for (const [key, names] of [
    ['temperatureC', ['morning', 'day', 'evening', 'night', 'min', 'max']],
    ['feelsLikeC', ['morning', 'day', 'evening', 'night']],
  ]) {
    if (value[key] === undefined) continue;
    if (!object(value[key]) || !names.every((name) => measurement(value[key][name])))
      throw new Error();
    result[key] = Object.fromEntries(names.map((name) => [name, value[key][name]]));
  }
  if (value.condition != null) {
    if (
      !object(value.condition) ||
      !Number.isInteger(value.condition.id) ||
      !text(value.condition.main) ||
      !text(value.condition.description)
    )
      throw new Error();
    result.condition = {
      id: value.condition.id,
      main: value.condition.main,
      description: value.condition.description,
      icon:
        typeof value.condition.icon === 'string' && /^\d{2}[dn]$/.test(value.condition.icon)
          ? value.condition.icon
          : null,
    };
  } else result.condition = null;
  return result;
}
function envelope(value, draft) {
  const allocation = allocateTripDates(draft);
  if (
    !allocation.valid ||
    !Array.isArray(value?.data?.days) ||
    value.data.days.length !== allocation.allocations.length ||
    typeof value.meta?.partial !== 'boolean' ||
    typeof value.meta?.mock !== 'boolean'
  )
    throw new Error();
  const days = value.data.days.map((day, index) => {
    const expected = allocation.allocations[index];
    if (
      !object(day) ||
      day.position !== expected.position ||
      day.date !== expected.date ||
      !['available', 'unavailable', 'error'].includes(day.status)
    )
      throw new Error();
    const result = { ...expected, status: day.status, model: null };
    if (day.status === 'available') result.model = model(day.model, day.date);
    if (day.status === 'unavailable') {
      if (day.model != null) result.model = model(day.model, day.date);
      const code = day.reason?.code === 'DATE_UNAVAILABLE' ? 'DATE_UNAVAILABLE' : 'NO_WEATHER_DATA';
      result.reason = { code, message: messages[code] };
    }
    if (day.status === 'error') {
      if (!object(day.error) || typeof day.error.code !== 'string') throw new Error();
      // Never render server error messages or arbitrary codes, even in HTTP 200 responses.
      result.error = {
        code: 'WEATHER_RETRIEVAL_FAILED',
        message: messages.WEATHER_RETRIEVAL_FAILED,
      };
    }
    if (day.meta !== undefined) {
      if (
        !object(day.meta) ||
        typeof day.meta.cached !== 'boolean' ||
        typeof day.meta.stale !== 'boolean'
      )
        throw new Error();
      result.meta = { cached: day.meta.cached, stale: day.meta.stale };
    }
    return result;
  });
  if (value.meta.partial !== days.some((day) => day.status === 'error')) throw new Error();
  return { data: { days }, meta: { partial: value.meta.partial, mock: value.meta.mock } };
}
function retryAfter(value) {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

/** No caching/persistence. expectedUserId binds a saved snapshot to its mounted account. */
export async function getTripWeather({ draft, signal, expectedUserId } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort('CANCELLED');
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort('TIMEOUT'), 40000);
  let stop;
  const stopped = new Promise((resolve) => {
    stop = () => resolve(failure(controller.signal.reason));
    if (controller.signal.aborted) stop();
    else controller.signal.addEventListener('abort', stop, { once: true });
  });
  const work = async () => {
    if (controller.signal.aborted) return failure(controller.signal.reason);
    if (!supabase) return failure('AUTH_UNAVAILABLE');
    let restored;
    try {
      restored = await supabase.auth.getSession();
    } catch {
      return failure('AUTH_UNAVAILABLE');
    }
    if (controller.signal.aborted) return failure(controller.signal.reason);
    if (restored?.error)
      return failure(
        restored.error.status === 401 ||
          [
            'session_expired',
            'session_not_found',
            'refresh_token_not_found',
            'refresh_token_already_used',
          ].includes(restored.error.code)
          ? 'UNAUTHENTICATED'
          : 'AUTH_UNAVAILABLE',
      );
    const session = restored?.data?.session;
    if (
      !session?.user?.id ||
      typeof session.access_token !== 'string' ||
      !session.access_token ||
      (session.expires_at !== undefined &&
        (!Number.isFinite(session.expires_at) || session.expires_at <= Date.now() / 1000)) ||
      (expectedUserId !== undefined && session.user.id !== expectedUserId)
    )
      return failure('UNAUTHENTICATED');
    try {
      const response = await fetch('/api/trip-weather', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ draft }),
        signal: controller.signal,
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
      });
      if (controller.signal.aborted) return failure(controller.signal.reason);
      if (!response.ok) {
        if (response.status === 503) {
          let code;
          try {
            code = (await response.json())?.error?.code;
          } catch {
            /* Never expose raw error bodies. */
          }
          return failure(code === 'AUTH_UNAVAILABLE' ? 'AUTH_UNAVAILABLE' : 'SERVICE_UNAVAILABLE');
        }
        const code =
          response.status === 401
            ? 'UNAUTHENTICATED'
            : response.status === 429
              ? 'RATE_LIMITED'
              : [400, 413, 415].includes(response.status)
                ? 'INVALID_INPUT'
                : response.status === 408
                  ? 'TIMEOUT'
                  : 'SERVICE_UNAVAILABLE';
        return failure(
          code,
          code === 'RATE_LIMITED' ? retryAfter(response.headers.get('Retry-After')) : undefined,
        );
      }
      if (response.status !== 200) return failure('INVALID_RESPONSE');
      try {
        return { ok: true, ...envelope(await response.json(), draft), error: null };
      } catch {
        return failure('INVALID_RESPONSE');
      }
    } catch {
      return failure('NETWORK_ERROR');
    }
  };
  try {
    return await Promise.race([work(), stopped]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', stop);
  }
}
