export function memoryCache() {
  const entries = new Map();
  return {
    entries,
    match: async (request) => entries.get(request.url)?.clone(),
    put: async (request, response) => { entries.set(request.url, response.clone()); },
  };
}
export const env = { STAGE: 'production', MOCK_PROVIDER: 'false', OPENWEATHER_API_KEY: 'synthetic-test-marker' };
export const mockEnv = { STAGE: 'local', MOCK_PROVIDER: 'true' };
export function request(path = '/api/geocode?q=Berlin', options = {}) {
  return new Request(`http://localhost${path}`, options);
}
export function weather(body = { lat: 52.52, lon: 13.405, date: '2026-10-13' }, extra = {}) {
  return request('/api/weather', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...extra });
}
export function rawResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
export const city = { name: 'Berlin', country: 'DE', lat: 52.52, lon: 13.405 };
export const daily = { date: '2026-10-13', temperature: { min: 0, max: 15 }, precipitation: { total: 0 } };
