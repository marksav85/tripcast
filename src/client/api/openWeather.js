import { normalizeCandidates, validCoordinates } from '../lib/locations';

const messages = {
  RATE_LIMITED: 'Too many requests. Please wait before retrying.',
  UPSTREAM_LIMIT: 'The weather service is busy. Please wait before retrying.',
  SERVICE_BUSY: 'The weather service is busy. Please retry shortly.',
  SERVICE_UNCONFIGURED: 'Weather service access is unavailable. Please try again later.',
  UPSTREAM_ACCESS: 'Weather service access is unavailable. Please try again later.',
  DATE_UNAVAILABLE: 'This date is outside the supported weather range.',
};
class ClientError extends Error {
  constructor(code) { super(code); this.code = code; }
}
async function request(url, options, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, credentials: 'same-origin', redirect: 'error' });
    const envelope = await response.json();
    if (!response.ok) throw new ClientError(envelope?.error?.code ?? 'API_FAILURE');
    if (!envelope || !Object.hasOwn(envelope, 'data')) throw new ClientError('UPSTREAM_INVALID');
    return envelope;
  } catch (error) {
    if (timedOut) throw new ClientError('UPSTREAM_TIMEOUT');
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    throw error instanceof ClientError ? error : new ClientError('API_FAILURE');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function lookupCities(city, signal) {
  const { data } = await request(`/api/geocode?${new URLSearchParams({ q: city })}`, { method: 'GET' }, signal);
  try { return normalizeCandidates(data); } catch { throw new ClientError('CITY_INVALID'); }
}
export async function reverseLookup(lat, lon, signal) {
  if (!validCoordinates(lat, lon)) throw new ClientError('INVALID_INPUT');
  const { data } = await request(`/api/reverse-geocode?${new URLSearchParams({ lat, lon })}`, { method: 'GET' }, signal);
  try {
    const candidates = normalizeCandidates(data);
    return candidates[0] ? { ...candidates[0], lat, lon } : null;
  } catch { throw new ClientError('CITY_INVALID'); }
}
export async function lookupWeather(query, signal) {
  const { lat, lon } = query.location;
  const { data, meta } = await request('/api/weather', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lon, date: query.date }),
  }, signal);
  const model = data?.model;
  if (!model || model.date !== query.date || typeof data.available !== 'boolean'
    || !['lowC', 'highC', 'cloudPercent', 'precipitationMm'].every((key) => model[key] === null || (typeof model[key] === 'number' && Number.isFinite(model[key])))) {
    throw new ClientError('UPSTREAM_INVALID');
  }
  return { model: { ...model, location: { ...query.location }, freshness: meta }, available: data.available };
}
export function requestError(error, service) {
  if (messages[error?.code]) return messages[error.code];
  if (error?.code === 'UPSTREAM_TIMEOUT') return `${service} timed out. Please retry.`;
  if (error?.code === 'CITY_INVALID') return 'The city service returned an invalid response. Please retry.';
  if (error?.code === 'UPSTREAM_INVALID') return 'The weather service returned an invalid date or response. Please retry.';
  return `${service} failed. Check your connection and retry.`;
}
