import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: { auth: { getSession: vi.fn() } } }));
vi.mock('../src/client/api/supabase.js', () => ({
  get supabase() {
    return mocks.client;
  },
}));
import { getTripWeather } from '../src/client/api/tripWeather.js';
import { fetchMock } from './fixtures/api.js';
import { tripDraft as draft, weatherEnvelope } from './fixtures/tripWeather.js';
const client = mocks.client;
const token = 'synthetic-private-access-token';
const session = () => ({
  user: { id: 'owner' },
  access_token: token,
  expires_at: Date.now() / 1000 + 3600,
});
const response = (body = weatherEnvelope(), status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
beforeEach(() => {
  mocks.client = client;
  client.auth.getSession.mockReset();
  client.auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  fetchMock.mockResolvedValue(response());
});
afterEach(() => vi.useRealTimers());
it('sends a same-origin authenticated POST and returns ordered mixed outcomes', async () => {
  const result = await getTripWeather({ draft, expectedUserId: 'owner' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/trip-weather');
  expect(options).toMatchObject({
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  expect(JSON.parse(options.body)).toEqual({ draft });
  expect(result).toMatchObject({ ok: true, meta: { partial: true, mock: false } });
  expect(result.data.days.map((day) => day.status)).toEqual(['available', 'unavailable', 'error']);
  expect(result.data.days[0].model.temperatureC.morning).toBe(0);
  expect(JSON.stringify(result)).not.toContain(token);
  expect(JSON.stringify(result)).not.toContain('raw server');
});
it.each([null, {}, { user: { id: 'owner' } }, { ...session(), expires_at: 1 }])(
  'rejects missing or expired sessions %#',
  async (value) => {
    client.auth.getSession.mockResolvedValue({ data: { session: value } });
    expect(await getTripWeather({ draft })).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
it('does not send a previous account’s saved draft under a new session', async () => {
  expect(await getTripWeather({ draft, expectedUserId: 'another-owner' })).toMatchObject({
    ok: false,
    error: { code: 'UNAUTHENTICATED' },
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it('handles unavailable configuration and session restoration failures', async () => {
  mocks.client = null;
  expect(await getTripWeather({ draft })).toMatchObject({ error: { code: 'AUTH_UNAVAILABLE' } });
  mocks.client = client;
  client.auth.getSession.mockRejectedValue(new Error(token));
  const result = await getTripWeather({ draft });
  expect(result.error.code).toBe('AUTH_UNAVAILABLE');
  expect(JSON.stringify(result)).not.toContain(token);
});
it.each([
  [401, 'UNAUTHENTICATED'],
  [503, 'SERVICE_UNAVAILABLE'],
  [400, 'INVALID_INPUT'],
  [408, 'TIMEOUT'],
])('sanitizes HTTP %s', async (status, code) => {
  fetchMock.mockResolvedValue(response({ error: { code: token, message: token } }, status));
  const result = await getTripWeather({ draft });
  expect(result).toMatchObject({ ok: false, error: { code } });
  expect(JSON.stringify(result)).not.toContain(token);
});
it('distinguishes authentication-service unavailability without exposing server messages', async () => {
  fetchMock.mockResolvedValue(
    response({ error: { code: 'AUTH_UNAVAILABLE', message: token } }, 503),
  );
  const result = await getTripWeather({ draft });
  expect(result.error.code).toBe('AUTH_UNAVAILABLE');
  expect(JSON.stringify(result)).not.toContain(token);
});
it.each(['60', new Date(Date.now() + 60000).toUTCString()])(
  'reports rate-limit retry information %s',
  async (value) => {
    fetchMock.mockResolvedValue(response({}, 429, { 'Retry-After': value }));
    const result = await getTripWeather({ draft });
    expect(result.error.code).toBe('RATE_LIMITED');
    expect(result.error.retryAfter).toBeGreaterThan(0);
  },
);
it('sanitizes network failure without public fallback', async () => {
  fetchMock.mockRejectedValue(new Error(token));
  const result = await getTripWeather({ draft });
  expect(result.error.code).toBe('NETWORK_ERROR');
  expect(JSON.stringify(result)).not.toContain(token);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('enforces 40 seconds even when fetch ignores abort', async () => {
  vi.useFakeTimers();
  fetchMock.mockReturnValue(new Promise(() => {}));
  const pending = getTripWeather({ draft });
  await vi.advanceTimersByTimeAsync(40000);
  expect(await pending).toMatchObject({ error: { code: 'TIMEOUT' } });
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('bounds session restoration and prevents a late session from initiating fetch', async () => {
  vi.useFakeTimers();
  let restore;
  client.auth.getSession.mockReturnValue(
    new Promise((resolve) => {
      restore = resolve;
    }),
  );
  const pending = getTripWeather({ draft });
  await vi.advanceTimersByTimeAsync(40000);
  expect((await pending).error.code).toBe('TIMEOUT');
  restore({ data: { session: session() } });
  await Promise.resolve();
  expect(fetchMock).not.toHaveBeenCalled();
});
it('distinguishes explicit cancellation and pre-aborted input', async () => {
  fetchMock.mockReturnValue(new Promise(() => {}));
  const controller = new AbortController();
  const pending = getTripWeather({ draft, signal: controller.signal });
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  controller.abort(new Error(token));
  expect((await pending).error.code).toBe('CANCELLED');
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  fetchMock.mockClear();
  expect((await getTripWeather({ draft, signal: controller.signal })).error.code).toBe('CANCELLED');
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each([
  null,
  {},
  { data: { days: [] }, meta: { partial: false, mock: false } },
  { ...weatherEnvelope(), meta: { partial: false, mock: false } },
  { ...weatherEnvelope(), data: { days: [...weatherEnvelope().data.days].reverse() } },
  {
    ...weatherEnvelope(),
    data: { days: weatherEnvelope().data.days.map((day) => ({ ...day, position: 7 })) },
  },
])('rejects malformed response %#', async (value) => {
  fetchMock.mockResolvedValue(response(value));
  expect((await getTripWeather({ draft })).error.code).toBe('INVALID_RESPONSE');
});
it('handles non-JSON responses and malformed weather measurements', async () => {
  fetchMock.mockResolvedValueOnce(new Response('private body'));
  expect((await getTripWeather({ draft })).error.code).toBe('INVALID_RESPONSE');
  const value = weatherEnvelope();
  value.data.days[0].model.lowC = '0';
  fetchMock.mockResolvedValue(response(value));
  expect((await getTripWeather({ draft })).error.code).toBe('INVALID_RESPONSE');
});
