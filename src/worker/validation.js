import { isCalendarDate } from '../shared/calendar.js';
import { validCoordinates, validateLookup } from '../shared/locations.js';
import { ApiError, invalid } from './errors.js';

export async function readLimitedJSON(stream, limit, error, options = {}) {
  if (!stream) throw error;
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(options.timeoutError ?? error), 3000);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      length += value.byteLength;
      if (length > limit) { void reader.cancel().catch(() => {}); throw error; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (caught) { throw caught instanceof ApiError ? caught : options.parseError ?? error; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function queryKeys(url, allowed) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw invalid();
  }
}
function coordinate(value) {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value) || value.length > 24) throw invalid();
  return Number(value);
}

export async function validateInput(request, route, url) {
  if (url.href.length > 2048) throw invalid();
  if (route === '/api/geocode') {
    queryKeys(url, ['q']);
    const { query, errors } = validateLookup(url.searchParams.get('q'), '2000-01-01');
    if (errors.city) throw invalid();
    return { q: query };
  }
  if (route === '/api/reverse-geocode') {
    queryKeys(url, ['lat', 'lon']);
    const lat = coordinate(url.searchParams.get('lat'));
    const lon = coordinate(url.searchParams.get('lon'));
    if (!validCoordinates(lat, lon)) throw invalid();
    return { lat, lon };
  }
  queryKeys(url, []);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 415, 'Use application/json.');
  }
  const large = new ApiError('BODY_TOO_LARGE', 413, 'Request body is too large or invalid.');
  const size = request.headers.get('content-length');
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > 16384)) throw large;
  // Bound both body size and slow body consumption; do not trust Content-Length.
  const input = await readLimitedJSON(request.body, 16384, large, { parseError: invalid(), timeoutError: new ApiError('BODY_TIMEOUT', 408, 'Request body timed out.') });
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !['lat', 'lon', 'date'].every((key) => Object.hasOwn(input, key))
    || Object.keys(input).some((key) => !['lat', 'lon', 'date'].includes(key))
    || !validCoordinates(input.lat, input.lon) || !isCalendarDate(input.date)) throw invalid();
  // Provisional existing adapter bounds; 4.0 coverage must be validated separately.
  if (input.date < '1979-01-02') throw new ApiError('DATE_UNAVAILABLE', 400, 'This date is outside the supported weather range.');
  const max = new Date();
  max.setUTCDate(max.getUTCDate() + 540);
  if (input.date > max.toISOString().slice(0, 10)) throw new ApiError('DATE_UNAVAILABLE', 400, 'This date is outside the provisional weather range.');
  return input;
}
