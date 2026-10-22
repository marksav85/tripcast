import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  client: { auth: { getSession: vi.fn() }, from: vi.fn(), rpc: vi.fn() },
}));
vi.mock('../src/client/api/supabase.js', () => ({
  get supabase() {
    return mocks.client;
  },
}));
import { loadMyTrip, saveMyTrip, deleteMyTrip } from '../src/client/api/trips.js';
const client = mocks.client;
const id = '11111111-1111-4111-8111-111111111111';
const draft = () => ({
  title: 'Summer',
  startDate: '2027-06-01',
  endDate: '2027-06-05',
  destinations: [
    {
      position: 0,
      cityName: 'Paris',
      countryCode: 'FR',
      region: null,
      lat: 48.8566,
      lon: 2.3522,
      timeZone: 'Europe/Paris',
      arrivalDate: '2027-06-01',
      departureDate: '2027-06-03',
    },
    {
      position: 1,
      cityName: 'Rome',
      countryCode: 'IT',
      region: 'Lazio',
      lat: 41.9028,
      lon: 12.4964,
      timeZone: 'Europe/Rome',
      arrivalDate: '2027-06-03',
      departureDate: '2027-06-05',
    },
  ],
});
const args = (expectedRevision = 0) => ({ tripId: id, expectedRevision, draft: draft() });
const saved = () => ({ id, revision: 1, draft: draft() });
let query;
beforeEach(() => {
  mocks.client = client;
  vi.resetAllMocks();
  client.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'owner' } } },
    error: null,
  });
  query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn() };
  client.from.mockReturnValue(query);
});
it('represents no trip as a successful null result using one owner-filtered read', async () => {
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  expect(await loadMyTrip()).toEqual({ ok: true, data: null, error: null });
  expect(client.from).toHaveBeenCalledExactlyOnceWith('trips');
  expect(query.select).toHaveBeenCalledExactlyOnceWith(
    'id,revision,title,start_date,end_date,trip_destinations(sort_order,city_name,country_code,region,latitude,longitude,timezone,arrival_date,departure_date)',
  );
  expect(query.eq).toHaveBeenCalledExactlyOnceWith('user_id', 'owner');
});
it('maps database columns into an ordered editor draft without mutating the rows', async () => {
  const value = draft();
  const rows = value.destinations
    .map((d) => ({
      sort_order: d.position,
      city_name: d.cityName,
      country_code: d.countryCode,
      region: d.region,
      latitude: d.lat,
      longitude: d.lon,
      timezone: d.timeZone,
      arrival_date: d.arrivalDate,
      departure_date: d.departureDate,
    }))
    .reverse();
  query.maybeSingle.mockResolvedValue({
    data: {
      id,
      revision: 7,
      title: value.title,
      start_date: value.startDate,
      end_date: value.endDate,
      trip_destinations: rows,
    },
    error: null,
  });
  expect(await loadMyTrip()).toEqual({
    ok: true,
    data: { id, revision: 7, draft: value },
    error: null,
  });
  expect(rows[0].sort_order).toBe(1);
});
it.each([0, 4])(
  'saves creation/update with numeric expected revision %s and returns canonical state',
  async (expectedRevision) => {
    const result = { ...saved(), revision: expectedRevision + 1 };
    client.rpc.mockResolvedValue({ data: result, error: null });
    const input = args(expectedRevision);
    input.draft.title = '  Summer  ';
    expect(await saveMyTrip(input)).toEqual({ ok: true, data: result, error: null });
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('save_trip', {
      p_trip_id: id,
      p_expected_revision: expectedRevision,
      p_draft: draft(),
    });
    expect(input.draft.title).toBe('  Summer  ');
  },
);
it('deletes through the RPC with a numeric positive revision', async () => {
  client.rpc.mockResolvedValue({ data: { id, deleted: true }, error: null });
  expect(await deleteMyTrip(args(3))).toEqual({
    ok: true,
    data: { id, deleted: true },
    error: null,
  });
  expect(client.rpc).toHaveBeenCalledExactlyOnceWith('delete_trip', {
    p_trip_id: id,
    p_expected_revision: 3,
  });
});
it.each([saveMyTrip, deleteMyTrip])('surfaces conflicts without retrying', async (operation) => {
  client.rpc.mockResolvedValue({
    data: null,
    error: { code: 'P0001', message: 'TRIP_CONFLICT' },
    status: 400,
  });
  expect(await operation(args(1))).toMatchObject({
    ok: false,
    data: null,
    error: { code: 'CONFLICT' },
  });
  expect(client.rpc).toHaveBeenCalledTimes(1);
});
it('rejects an invalid draft locally without RPC writes', async () => {
  const input = args();
  input.draft.destinations[1].arrivalDate = '2027-06-04';
  expect(await saveMyTrip(input)).toMatchObject({
    ok: false,
    error: { code: 'INVALID_TRIP', fields: { 'destinations.1.arrivalDate': expect.any(String) } },
  });
  expect(client.rpc).not.toHaveBeenCalled();
});
it.each([
  ['22023', 'INVALID_TRIP', 'INVALID_TRIP'],
  ['22023', 'INVALID_REVISION', 'INVALID_REQUEST'],
  ['42501', 'AUTH_REQUIRED', 'UNAUTHENTICATED'],
  ['PGRST301', 'expired', 'UNAUTHENTICATED'],
  ['P0001', 'OTHER_EXCEPTION', 'DATABASE_ERROR'],
  ['23505', 'private SQL details', 'DATABASE_ERROR'],
])('classifies SQL/PostgREST %s/%s as %s', async (code, message, expected) => {
  client.rpc.mockResolvedValue({ data: null, error: { code, message }, status: 400 });
  const result = await saveMyTrip(args());
  expect(result).toMatchObject({ ok: false, data: null, error: { code: expected } });
  expect(JSON.stringify(result)).not.toContain('private SQL details');
});
it.each([loadMyTrip, saveMyTrip, deleteMyTrip])(
  'does not access tables or RPCs when signed out',
  async (operation) => {
    client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    expect(await operation(args())).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  },
);
it('handles an unavailable configured client', async () => {
  mocks.client = null;
  expect(await loadMyTrip()).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
});
it('handles session refresh network failure without treating it as no trip', async () => {
  client.auth.getSession.mockRejectedValue(new Error('private network details'));
  expect(await loadMyTrip()).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
});
it.each([0, 503])('handles service/network response status %s', async (status) => {
  query.maybeSingle.mockResolvedValue({
    data: null,
    error: { message: 'private details' },
    status,
  });
  expect(await loadMyTrip()).toMatchObject({ ok: false, error: { code: 'SERVICE_UNAVAILABLE' } });
});
it('sanitizes thrown RPC network failures', async () => {
  client.rpc.mockRejectedValue(new Error('private details'));
  expect(await deleteMyTrip(args(1))).toMatchObject({
    ok: false,
    error: { code: 'SERVICE_UNAVAILABLE' },
  });
});
it.each(['1', -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid revision %s without coercion',
  async (expectedRevision) => {
    expect(await saveMyTrip(args(expectedRevision))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(client.rpc).not.toHaveBeenCalled();
  },
);
it('rejects zero delete revision and invalid UUID', async () => {
  expect(await deleteMyTrip(args())).toMatchObject({
    ok: false,
    error: { code: 'INVALID_REQUEST' },
  });
  expect(await saveMyTrip({ ...args(), tripId: 'bad' })).toMatchObject({
    ok: false,
    error: { code: 'INVALID_REQUEST' },
  });
  expect(client.rpc).not.toHaveBeenCalled();
});
it.each([
  undefined,
  {},
  { id, revision: '1', draft: draft() },
  { ...saved(), draft: {} },
  { ...saved(), id: 'bad' },
])('rejects malformed save responses %#', async (data) => {
  client.rpc.mockResolvedValue({ data, error: null });
  expect(await saveMyTrip(args())).toMatchObject({
    ok: false,
    error: { code: 'INVALID_RESPONSE' },
  });
});
it.each([{}, { data: undefined }, { data: { id, revision: 1, trip_destinations: null } }])(
  'rejects malformed load responses %#',
  async (response) => {
    query.maybeSingle.mockResolvedValue(response);
    expect(await loadMyTrip()).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } });
  },
);
it('rejects malformed deletion acknowledgement', async () => {
  client.rpc.mockResolvedValue({ data: { id, deleted: false }, error: null });
  expect(await deleteMyTrip(args(1))).toMatchObject({
    ok: false,
    error: { code: 'INVALID_RESPONSE' },
  });
});

it.each([
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
  'refresh_token_already_used',
])('classifies expired SDK sessions: %s', async (code) => {
  client.auth.getSession.mockResolvedValue({
    data: { session: null },
    error: { code, status: 400 },
  });
  expect(await loadMyTrip()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  expect(client.from).not.toHaveBeenCalled();
});
it('does not convert a server-rejected expired session into an empty trip', async () => {
  query.maybeSingle.mockResolvedValue({ data: null, error: { code: 'PGRST301' }, status: 401 });
  expect(await loadMyTrip()).toMatchObject({
    ok: false,
    data: null,
    error: { code: 'UNAUTHENTICATED' },
  });
});
it('preserves the server revision for an identical save retry', async () => {
  client.rpc.mockResolvedValue({ data: saved(), error: null });
  expect(await saveMyTrip(args(1))).toMatchObject({ ok: true, data: { revision: 1 } });
  expect(client.rpc).toHaveBeenCalledTimes(1);
});
