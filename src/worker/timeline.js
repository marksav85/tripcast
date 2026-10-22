import { isCalendarDate, todayDate } from '../shared/calendar.js';
import { validCoordinates } from '../shared/locations.js';
import { malformed, ApiError } from './errors.js';

export const TIMELINE_PATH = '/data/4.0/onecall/timeline/1day';
export const MAX_WEATHER_CALLS = 4;
export const MAX_TIMELINE_PAGES = 2;
const dayMs = 86400000;
const stamp = (date) => Date.parse(`${date}T00:00:00Z`);

export function forecastPolicy(date, timeZone, now) {
  const today = todayDate(new Date(now), timeZone);
  const distance = (stamp(date) - stamp(today)) / dayMs;
  const forecastType = distance < 0 ? 'historical' : distance < 8 ? 'standard' : 'long-range';
  return {
    forecastType,
    forecastLabel:
      forecastType === 'standard'
        ? 'Standard forecast'
        : forecastType === 'long-range'
          ? 'Long-range estimate'
          : 'Historical weather',
    forecastPolicy: 'TripCast provisional eight-day policy',
    near: distance < 8,
  };
}

// Provider links are untrusted metadata. Extract approved parameters only;
// never fetch the link, even when its scheme is HTTPS.
export function paginationStart(link, input) {
  if (typeof link !== 'string' || link.length > 2048) throw malformed();
  let url;
  try {
    url = new URL(link);
  } catch {
    throw malformed();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.hostname !== 'api.openweathermap.org' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== TIMELINE_PATH
  )
    throw malformed();
  const allowed = ['cnt', 'lat', 'lon', 'start', 'appid', 'units', 'lang'];
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw malformed();
  }
  const numeric = (key) => {
    const value = url.searchParams.get(key);
    if (!value || !/^-?\d+(\.\d+)?$/.test(value)) throw malformed();
    return Number(value);
  };
  if (
    Math.abs(numeric('lat') - input.lat) > 0.00011 ||
    Math.abs(numeric('lon') - input.lon) > 0.00011 ||
    url.searchParams.get('cnt') !== '10' ||
    (url.searchParams.has('units') && url.searchParams.get('units') !== 'metric') ||
    (url.searchParams.has('lang') && url.searchParams.get('lang') !== 'en')
  )
    throw malformed();
  const start = numeric('start');
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isFinite(new Date(start * 1000).getTime())
  )
    throw malformed();
  return start;
}

export function validateTimelinePage(raw, input) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    !validCoordinates(raw.lat, raw.lon) ||
    Math.abs(raw.lat - input.lat) > 0.00011 ||
    Math.abs(raw.lon - input.lon) > 0.00011 ||
    typeof raw.timezone !== 'string' ||
    raw.timezone.length > 100 ||
    !Array.isArray(raw.data) ||
    raw.data.length > 10
  )
    throw malformed();
  try {
    todayDate(new Date(0), raw.timezone);
  } catch {
    throw malformed();
  }
  let previous = -1;
  const days = raw.data.map((record) => {
    if (
      !record ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      !Number.isSafeInteger(record.dt) ||
      record.dt < 0 ||
      record.dt < previous ||
      !Number.isFinite(new Date(record.dt * 1000).getTime())
    )
      throw malformed();
    previous = record.dt;
    return { date: todayDate(new Date(record.dt * 1000), raw.timezone), record };
  });
  const next = raw.next == null ? null : paginationStart(raw.next, input);
  const prev = raw.prev == null ? null : paginationStart(raw.prev, input);
  return { timeZone: raw.timezone, days, next, prev };
}

// Internal bounded range collector, not an expanded public API. At most ten
// requested dates, two pages. Retries share the provider's four-call budget.
export function timelineDates(input) {
  const endDate = input.endDate ?? input.date;
  const count = (stamp(endDate) - stamp(input.date)) / dayMs + 1;
  if (!isCalendarDate(input.date) || !isCalendarDate(endDate) || count < 1 || count > 10)
    throw malformed();
  return Array.from({ length: count }, (_, i) =>
    new Date(stamp(input.date) + i * dayMs).toISOString().slice(0, 10),
  );
}

export async function collectTimeline(input, fetchPage, { partial = false } = {}) {
  const wanted = timelineDates(input);
  const endDate = wanted.at(-1);
  const selected = new Map();
  let start = stamp(input.date) / 1000;
  let timeZone;
  let failure;
  try {
    for (let page = 0; page < MAX_TIMELINE_PAGES; page += 1) {
      const parsed = validateTimelinePage(await fetchPage(start), input);
      if (timeZone && parsed.timeZone !== timeZone) throw malformed();
      timeZone = parsed.timeZone;
      for (const { date, record } of parsed.days) {
        if (date >= input.date && date <= endDate && !selected.has(date))
          selected.set(date, record);
      }
      if (wanted.every((date) => selected.has(date))) break;
      if (parsed.next === null) break;
      // Advance only within a small window around the requested interval. Guard
      // looping, backwards, empty and arbitrary distant continuation pages.
      if (
        !parsed.days.length ||
        parsed.next <= start ||
        parsed.next > stamp(endDate) / 1000 + 11 * 86400
      )
        throw malformed();
      if (page + 1 === MAX_TIMELINE_PAGES)
        throw new ApiError('UPSTREAM_INVALID', 502, 'Weather coverage exceeded the request limit.');
      start = parsed.next;
    }
  } catch (error) {
    if (!partial) throw error;
    failure =
      error instanceof ApiError
        ? error
        : new ApiError('UPSTREAM_FAILURE', 502, 'Weather service failed. Please retry.');
  }
  const result = {
    timezone: timeZone,
    days: wanted.map((date) => ({
      date,
      record: selected.get(date) ?? null,
      ...(partial && failure && !selected.has(date) ? { error: failure } : {}),
    })),
  };
  return partial ? { ...result, complete: !failure, error: failure ?? null } : result;
}
