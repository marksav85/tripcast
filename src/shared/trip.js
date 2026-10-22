import { isCalendarDate } from './calendar.js';
import { validCoordinates } from './locations.js';

export const MAX_TRIP_DAYS = 42;
export const MAX_DESTINATIONS = 8;
const leap = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const monthLengths = (year) => [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const beforeYear = (year) => {
  const y = year - 1;
  return 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
};

/** Zero-based Gregorian day number, restricted to ISO years 0001–9999. No timestamps. */
export function calendarDayNumber(date) {
  if (!isCalendarDate(date)) throw new RangeError('Use a real YYYY-MM-DD date in years 0001–9999.');
  const [year, month, day] = date.split('-').map(Number);
  return (
    beforeYear(year) +
    monthLengths(year)
      .slice(0, month - 1)
      .reduce((sum, days) => sum + days, 0) +
    day -
    1
  );
}

/** Add whole calendar days, throwing rather than wrapping outside supported years. */
export function addCalendarDays(date, amount) {
  if (!Number.isSafeInteger(amount))
    throw new RangeError('Calendar day offset must be a safe integer.');
  const ordinal = calendarDayNumber(date) + amount;
  if (ordinal < 0 || ordinal >= beforeYear(10000))
    throw new RangeError('Date is outside years 0001–9999.');
  let low = 1;
  let high = 9999;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (beforeYear(mid) <= ordinal) low = mid;
    else high = mid - 1;
  }
  const year = low;
  let remaining = ordinal - beforeYear(year);
  let month = 1;
  for (const days of monthLengths(year)) {
    if (remaining < days) break;
    remaining -= days;
    month += 1;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(remaining + 1).padStart(2, '0')}`;
}

/**
 * Count [startDate, endDate); invalid or nonpositive ranges throw.
 * Departure belongs to the next stay, so adjacent destinations never own the same weather date.
 * Calendar ordinals avoid DST-dependent elapsed-hour arithmetic.
 */
export function coveredDayCount(startDate, endDate) {
  const count = calendarDayNumber(endDate) - calendarDayNumber(startDate);
  if (count < 1) throw new RangeError('Departure must be after arrival.');
  return count;
}

/** Bounded weather-date allocation; departure is excluded, max 42 entries. */
export function coveredCalendarDates(startDate, endDate) {
  const count = coveredDayCount(startDate, endDate);
  if (count > MAX_TRIP_DAYS) throw new RangeError('Trips may cover at most 42 calendar dates.');
  return Array.from({ length: count }, (_, offset) => addCalendarDays(startDate, offset));
}

const object = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const label = (value) =>
  typeof value === 'string' &&
  Array.from(value).length <= 100 &&
  value.trim().length > 0 &&
  !Array.from(value).some(
    (char) =>
      char.charCodeAt(0) < 32 ||
      char.charCodeAt(0) === 127 ||
      (char.codePointAt(0) >= 0xd800 && char.codePointAt(0) <= 0xdfff),
  );

/** Validate a named IANA zone, not a fixed offset/abbreviation. No coordinate resolution. */
export function isTripTimeZone(value) {
  if (
    typeof value !== 'string' ||
    value.length > 100 ||
    (value !== 'UTC' && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) ||
    value.startsWith('posix/') ||
    value.startsWith('right/')
  )
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Complete transport-neutral draft: title/startDate/endDate/destinations.
 * Destination: position/cityName/countryCode/region?/lat/lon/timeZone/arrivalDate/departureDate.
 * Returns {valid, trip, dayCount, errors}; errors use stable dot/index field paths.
 * Invalid input never yields a partially normalized trip. No sorting or date repair.
 * IDs, revisions and UI row keys belong to separate caller envelopes, not this draft.
 */
export function validateTripDraft(input) {
  const errors = {};
  let dayCount = null;
  const fail = (path, message) => {
    if (!errors[path]) errors[path] = message;
  };
  const shape = (value, allowed, required, path) => {
    if (!object(value)) {
      fail(path, 'Use an object with the required trip fields.');
      return false;
    }
    if (Object.keys(value).some((key) => !allowed.includes(key)))
      fail(path, 'Unexpected fields are not allowed.');
    for (const key of required)
      if (!Object.hasOwn(value, key))
        fail(path ? `${path}.${key}` : key, 'This field is required.');
    return true;
  };
  const tripFields = ['title', 'startDate', 'endDate', 'destinations'];
  if (!shape(input, tripFields, tripFields, 'trip'))
    return { valid: false, trip: null, dayCount, errors };
  if (!label(input.title))
    fail('title', 'Use a title between 1 and 100 characters without control characters.');
  for (const field of ['startDate', 'endDate'])
    if (!isCalendarDate(input[field])) fail(field, 'Use a real YYYY-MM-DD calendar date.');
  if (!errors.startDate && !errors.endDate) {
    dayCount = calendarDayNumber(input.endDate) - calendarDayNumber(input.startDate);
    if (dayCount < 1 || dayCount > MAX_TRIP_DAYS)
      fail('endDate', 'A trip must cover 1–42 calendar dates; departure is excluded.');
  }
  if (
    !Array.isArray(input.destinations) ||
    input.destinations.length < 1 ||
    input.destinations.length > MAX_DESTINATIONS
  ) {
    fail('destinations', 'Use between 1 and 8 destinations.');
    return { valid: false, trip: null, dayCount, errors };
  }
  const fields = [
    'position',
    'cityName',
    'countryCode',
    'region',
    'lat',
    'lon',
    'timeZone',
    'arrivalDate',
    'departureDate',
  ];
  const required = fields.filter((field) => field !== 'region');
  const positions = new Set();
  const destinations = [];
  for (let index = 0; index < input.destinations.length; index += 1) {
    const item = input.destinations[index];
    const path = `destinations.${index}`;
    if (!shape(item, fields, required, path)) continue;
    if (!Number.isInteger(item.position) || item.position !== index || positions.has(item.position))
      fail(
        `${path}.position`,
        'Positions must be unique and consecutive in array order, starting at zero.',
      );
    positions.add(item.position);
    if (!label(item.cityName))
      fail(
        `${path}.cityName`,
        'Use a city label between 1 and 100 characters without control characters.',
      );
    if (
      typeof item.countryCode !== 'string' ||
      item.countryCode.length !== 2 ||
      !/^[A-Z]{2}$/.test(item.countryCode)
    )
      fail(`${path}.countryCode`, 'Use an uppercase two-letter country code.');
    if (item.region != null && !label(item.region))
      fail(`${path}.region`, 'Region must be null or a label between 1 and 100 characters.');
    if (!validCoordinates(item.lat, item.lon))
      fail(
        `${path}.coordinates`,
        'Use finite numeric latitude/longitude within their supported ranges.',
      );
    if (!isTripTimeZone(item.timeZone))
      fail(`${path}.timeZone`, 'Use a supported named IANA timezone.');
    for (const field of ['arrivalDate', 'departureDate'])
      if (!isCalendarDate(item[field]))
        fail(`${path}.${field}`, 'Use a real YYYY-MM-DD calendar date.');
    if (
      isCalendarDate(item.arrivalDate) &&
      isCalendarDate(item.departureDate) &&
      item.departureDate <= item.arrivalDate
    )
      fail(
        `${path}.departureDate`,
        'Departure must be after arrival; every destination covers at least one date.',
      );
    if (index === 0 && item.arrivalDate !== input.startDate)
      fail(`${path}.arrivalDate`, 'First arrival must equal trip start.');
    if (index === input.destinations.length - 1 && item.departureDate !== input.endDate)
      fail(`${path}.departureDate`, 'Final departure must equal trip end.');
    if (index > 0 && item.arrivalDate !== input.destinations[index - 1]?.departureDate)
      fail(
        `${path}.arrivalDate`,
        'Arrival must equal the previous departure; no gaps or overlaps.',
      );
    destinations.push({
      position: item.position,
      cityName: typeof item.cityName === 'string' ? item.cityName.trim() : '',
      countryCode: item.countryCode,
      region:
        item.region == null ? null : typeof item.region === 'string' ? item.region.trim() : null,
      lat: item.lat,
      lon: item.lon,
      timeZone: item.timeZone,
      arrivalDate: item.arrivalDate,
      departureDate: item.departureDate,
    });
  }
  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    trip: valid
      ? {
          title: input.title.trim(),
          startDate: input.startDate,
          endDate: input.endDate,
          destinations,
        }
      : null,
    dayCount,
    errors,
  };
}

/** Complete validation plus exactly one owner per covered date; no partial allocation on error. */
export function allocateTripDates(input) {
  const result = validateTripDraft(input);
  if (!result.valid) return { ...result, allocations: [] };
  return {
    ...result,
    allocations: result.trip.destinations.flatMap((destination) =>
      coveredCalendarDates(destination.arrivalDate, destination.departureDate).map((date) => ({
        date,
        position: destination.position,
      })),
    ),
  };
}
