import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createWorker } from '../../src/worker/index.js';
import { request, weather, mockEnv } from './helpers.js';

const user = '73b72c22-0014-4bf8-9abe-f42394c52220';
const otherUser = '73b72c22-0014-4bf8-9abe-f42394c52221';
const draft = () => ({
  title: 'European Summer',
  startDate: '2027-06-01',
  endDate: '2027-06-03',
  destinations: [
    {
      position: 0,
      cityName: 'Berlin',
      countryCode: 'DE',
      lat: 52.52,
      lon: 13.405,
      timeZone: 'Europe/Berlin',
      arrivalDate: '2027-06-01',
      departureDate: '2027-06-03',
    },
  ],
});
let env,
  pair,
  jwksFetch,
  upstreamFetch,
  cache,
  handler,
  sequence = 0;
const now = () => Math.floor(Date.now() / 1000);
async function token(claims = {}, signing = pair) {
  return new SignJWT({
    iss: env.SUPABASE_JWT_ISSUER,
    aud: 'authenticated',
    sub: user,
    role: 'authenticated',
    exp: now() + 3600,
    ...claims,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'synthetic' })
    .sign(signing.privateKey);
}
function trip(jwt, body = { draft: draft() }, headers = {}, path = '/api/trip-weather') {
  return request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
async function check(response, status, code) {
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ error: { code } });
}
beforeEach(async () => {
  env = {
    ...mockEnv,
    SUPABASE_JWT_ISSUER: 'http://127.0.0.1:54321/auth/v1',
    SUPABASE_JWKS_URL: `http://127.0.0.1:54321/route-keys-${sequence++}`,
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    SUPABASE_JWT_ALGORITHMS: 'ES256',
  };
  pair = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'synthetic', alg: 'ES256', use: 'sig' };
  jwksFetch = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] })));
  vi.stubGlobal('fetch', jwksFetch);
  upstreamFetch = vi.fn(() => {
    throw new Error('Unexpected provider access');
  });
  cache = { match: vi.fn(), put: vi.fn() };
  handler = createWorker({ upstreamFetch, cache });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('protected trip-weather boundary', () => {
  it('returns authenticated fixture weather without provider access', async () => {
    const jwt = await token();
    const response = await handler.fetch(trip(jwt), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const payload = await response.json();
    expect(payload.meta).toEqual({ partial: false, mock: true });
    expect(payload.data.days).toHaveLength(2);
    expect(payload.data.days.every((day) => day.status === 'available')).toBe(true);
  });
  afterEach(() => {
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    'Basic synthetic',
    'Bearer',
    'Bearer not.a.jwt',
    'Bearer a.b.c extra',
    'Bearer a.b.c, Bearer d.e.f',
  ])('rejects missing or malformed authorization %s', async (authorization) => {
    await check(
      await handler.fetch(
        trip(null, { draft: draft() }, authorization ? { Authorization: authorization } : {}),
        env,
      ),
      401,
      'UNAUTHENTICATED',
    );
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });
  it.each([
    ['expired', () => ({ exp: now() - 1 })],
    ['issuer', () => ({ iss: 'https://evil.example/auth/v1' })],
    ['audience', () => ({ aud: 'anon' })],
    ['role', () => ({ role: 'anon' })],
  ])('rejects invalid %s', async (_label, claims) => {
    await check(await handler.fetch(trip(await token(claims())), env), 401, 'UNAUTHENTICATED');
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });
  it('rejects an invalid signature', async () => {
    await check(
      await handler.fetch(trip(await token({}, await generateKeyPair('ES256'))), env),
      401,
      'UNAUTHENTICATED',
    );
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });
  it('reports unavailable trusted configuration', async () => {
    await check(
      await handler.fetch(trip(await token()), { ...env, SUPABASE_JWT_ISSUER: undefined }),
      503,
      'AUTH_UNAVAILABLE',
    );
  });
  it.each(['network', 'http', 'invalid jwks'])(
    'reports JWKS service failure: %s',
    async (failure) => {
      if (failure === 'network')
        jwksFetch.mockRejectedValue(new Error('private infrastructure detail'));
      else
        jwksFetch.mockResolvedValue(
          failure === 'http'
            ? new Response('secret detail', { status: 503 })
            : new Response('not JSON'),
        );
      await check(await handler.fetch(trip(await token()), env), 503, 'AUTH_UNAVAILABLE');
    },
  );
  it('reports JWKS timeout', async () => {
    jwksFetch.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          });
        }),
    );
    await check(await handler.fetch(trip(await token()), env), 503, 'AUTH_UNAVAILABLE');
  }, 7000);
  it.each([
    null,
    [],
    {},
    { draft: null },
    { draft: draft(), extra: true },
    { draft: { ...draft(), destinations: [] } },
    { draft: { ...draft(), endDate: '2027-08-01' } },
    { draft: { ...draft(), destinations: [{ ...draft().destinations[0], position: 1 }] } },
    { draft: { ...draft(), destinations: [{ ...draft().destinations[0], lat: 91 }] } },
    { draft: { ...draft(), destinations: [{ ...draft().destinations[0], timeZone: '+02:00' }] } },
    {
      draft: {
        ...draft(),
        destinations: [{ ...draft().destinations[0], arrivalDate: '2027-06-02' }],
      },
    },
  ])('rejects invalid trip envelopes %j', async (body) => {
    await check(await handler.fetch(trip(await token(), body), env), 400, 'INVALID_INPUT');
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });
  it('accepts the 42-day and eight-destination contract boundaries', async () => {
    const input = draft();
    input.endDate = '2027-07-13';
    input.destinations = Array.from({ length: 8 }, (_, position) => ({
      ...input.destinations[0],
      position,
      arrivalDate: `2027-06-0${position + 1}`,
      departureDate: position === 7 ? input.endDate : `2027-06-0${position + 2}`,
    }));
    const response = await handler.fetch(trip(await token(), { draft: input }), env);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.days).toHaveLength(42);
    expect(payload.meta.partial).toBe(false);
  });
  it.each(['too many', 'gap', 'overlap', 'zero days', '43 days'])(
    'preserves shared trip constraints: %s',
    async (kind) => {
      const input = draft();
      if (kind === 'too many')
        input.destinations = Array.from({ length: 9 }, (_, position) => ({
          ...input.destinations[0],
          position,
        }));
      if (kind === 'zero days') input.endDate = input.startDate;
      if (kind === '43 days') {
        input.endDate = '2027-07-14';
        input.destinations[0].departureDate = input.endDate;
      }
      if (kind === 'gap' || kind === 'overlap') {
        input.endDate = '2027-06-05';
        input.destinations.push({
          ...input.destinations[0],
          position: 1,
          arrivalDate: kind === 'gap' ? '2027-06-04' : '2027-06-02',
          departureDate: input.endDate,
        });
      }
      await check(
        await handler.fetch(trip(await token(), { draft: input }), env),
        400,
        'INVALID_INPUT',
      );
    },
  );
  it.each([{}, { 'Content-Length': '1' }, { 'Content-Length': '17000' }])(
    'bounds the actual body independently of content length %j',
    async (headers) => {
      const req = trip(await token(), { draft: draft(), padding: ' '.repeat(17000) }, headers);
      await check(await handler.fetch(req, env), 413, 'BODY_TOO_LARGE');
    },
  );
  it('rejects malformed JSON and wrong media types', async () => {
    const jwt = await token();
    const req = request('/api/trip-weather', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: '{',
    });
    await check(await handler.fetch(req, env), 400, 'INVALID_INPUT');
    await check(
      await handler.fetch(trip(jwt, {}, { 'Content-Type': 'text/plain' }), env),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });
  it('bounds slow body consumption after verification', async () => {
    const jwt = await token();
    vi.useFakeTimers();
    const req = request('/api/trip-weather', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: new ReadableStream({ start() {} }),
      duplex: 'half',
    });
    const reading = vi.spyOn(req.body, 'getReader');
    const pending = handler.fetch(req, env);
    await vi.waitFor(() => expect(reading).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(3100);
    await check(await pending, 408, 'BODY_TIMEOUT');
  });
  it('checks authentication before consuming an invalid body', async () => {
    await check(
      await handler.fetch(trip(null, { padding: ' '.repeat(17000) }), env),
      401,
      'UNAUTHENTICATED',
    );
    expect(jwksFetch).not.toHaveBeenCalled();
  });
  it('enforces early default IP limits before JWT verification', async () => {
    for (let i = 0; i < 10; i += 1) expect((await handler.fetch(trip(null), env)).status).toBe(401);
    const response = await handler.fetch(trip(await token()), env);
    expect(response.headers.get('Retry-After')).toBe('60');
    await check(response, 429, 'RATE_LIMITED');
    expect(jwksFetch).not.toHaveBeenCalled();
  });
  it('enforces the default user limit across IPs and tokens, and isolates users', async () => {
    for (let i = 0; i < 3; i += 1)
      expect(
        (
          await handler.fetch(
            trip(await token(), undefined, { 'CF-Connecting-IP': `synthetic-${i}` }),
            env,
          )
        ).status,
      ).toBe(200);
    const response = await handler.fetch(
      trip(await token(), undefined, { 'CF-Connecting-IP': 'different' }),
      env,
    );
    expect(response.headers.get('Retry-After')).toBe('60');
    await check(response, 429, 'RATE_LIMITED');
    expect((await handler.fetch(trip(await token({ sub: otherUser })), env)).status).toBe(200);
  });
  it('does not charge user limits based on forged subject claims', async () => {
    const forged = await token({}, await generateKeyPair('ES256'));
    for (let i = 0; i < 4; i += 1)
      expect((await handler.fetch(trip(forged), env)).status).toBe(401);
    for (let i = 0; i < 3; i += 1)
      expect((await handler.fetch(trip(await token()), env)).status).toBe(200);
  });
  it('supports configured limits and minute resets', async () => {
    let clock = Date.now();
    handler = createWorker({ now: () => clock, upstreamFetch, cache });
    env = { ...env, TRIP_WEATHER_IP_LIMIT: '2', TRIP_WEATHER_USER_LIMIT: '1' };
    const jwt = await token();
    expect((await handler.fetch(trip(jwt), env)).status).toBe(200);
    await check(await handler.fetch(trip(jwt), env), 429, 'RATE_LIMITED');
    clock += 60000;
    expect((await handler.fetch(trip(jwt), env)).status).toBe(200);
    await check(await handler.fetch(trip(null), env), 401, 'UNAUTHENTICATED');
    await check(await handler.fetch(trip(jwt), env), 429, 'RATE_LIMITED');
  });
  it.each([
    { TRIP_WEATHER_IP_LIMIT: '0' },
    { TRIP_WEATHER_USER_LIMIT: 'NaN' },
    { TRIP_WEATHER_IP_LIMIT: '61' },
  ])('fails closed for invalid limits %j', async (patch) => {
    await check(
      await handler.fetch(trip(await token()), { ...env, ...patch }),
      503,
      'SERVICE_UNCONFIGURED',
    );
  });
  it('rejects fixture mode on a non-loopback host after authentication', async () => {
    const req = trip(await token());
    const response = await handler.fetch(
      new Request('https://remote.test/api/trip-weather', req),
      env,
    );
    await check(response, 503, 'MOCK_MODE_DENIED');
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });
  it.each(['GET', 'OPTIONS', 'PUT'])(
    'rejects unsupported method %s before authentication',
    async (method) => {
      const response = await handler.fetch(request('/api/trip-weather', { method }), env);
      expect(response.headers.get('Allow')).toBe('POST');
      await check(response, 405, 'METHOD_NOT_ALLOWED');
      expect(jwksFetch).not.toHaveBeenCalled();
    },
  );
  it('preserves same-origin protection and rejects query parameters', async () => {
    const response = await handler.fetch(trip(null, {}, { Origin: 'https://foreign.test' }), env);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    await check(response, 403, 'ORIGIN_DENIED');
    expect(jwksFetch).not.toHaveBeenCalled();
    await check(
      await handler.fetch(trip(await token(), undefined, {}, '/api/trip-weather?extra=1'), env),
      400,
      'INVALID_INPUT',
    );
  });
});

it('keeps public endpoints anonymous and their buckets separate from protected requests', async () => {
  for (let i = 0; i < 10; i += 1) await handler.fetch(trip(null), env);
  const publicHandler = handler;
  for (let i = 0; i < 10; i += 1) {
    expect((await publicHandler.fetch(request('/api/geocode?q=Berlin'), env)).status).toBe(200);
    expect(
      (await publicHandler.fetch(request('/api/reverse-geocode?lat=52.52&lon=13.405'), env)).status,
    ).toBe(200);
  }
  for (let i = 0; i < 5; i += 1)
    expect((await publicHandler.fetch(weather(), env)).status).toBe(200);
  expect((await publicHandler.fetch(request('/api/geocode?q=Berlin'), env)).status).toBe(429);
  expect(
    (await publicHandler.fetch(request('/api/reverse-geocode?lat=52.52&lon=13.405'), env)).status,
  ).toBe(429);
  expect((await publicHandler.fetch(weather(), env)).status).toBe(429);
  expect(jwksFetch).not.toHaveBeenCalled();
  expect(upstreamFetch).not.toHaveBeenCalled();
});
