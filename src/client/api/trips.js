import { supabase } from './supabase.js';
import { validateTripDraft } from '../../shared/trip.js';

const messages = {
  UNAUTHENTICATED: 'Sign in again to access your trip.',
  SERVICE_UNAVAILABLE: 'Trip storage is unavailable. Please try again later.',
  CONFLICT: 'Your saved trip has changed. Reload it before trying again.',
  INVALID_TRIP: 'Review the trip details before saving.',
  INVALID_REQUEST: 'The trip identity or revision is invalid.',
  DATABASE_ERROR: 'The trip request could not be completed.',
  INVALID_RESPONSE: 'Trip storage returned an unexpected response.',
};
const failure = (code, fields) => ({
  ok: false,
  data: null,
  error: {
    code,
    message: messages[code],
    ...(fields ? { fields } : {}),
  },
});
const success = (data) => ({ ok: true, data, error: null });
const uuid = (value) =>
  typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const revision = (value, minimum = 1) => Number.isSafeInteger(value) && value >= minimum;

function classify(error, status) {
  if (
    status === 401 ||
    error?.name === 'AuthSessionMissingError' ||
    [
      'PGRST301',
      'PGRST302',
      'PGRST303',
      'session_not_found',
      'session_expired',
      'refresh_token_not_found',
      'refresh_token_already_used',
    ].includes(error?.code) ||
    (error?.code === '42501' && error.message === 'AUTH_REQUIRED')
  )
    return failure('UNAUTHENTICATED');
  // P0001 is shared by application exceptions; match the SQL's exact marker too.
  if (error?.code === 'P0001' && error.message === 'TRIP_CONFLICT') return failure('CONFLICT');
  if (error?.code === '22023' && error.message === 'INVALID_TRIP') return failure('INVALID_TRIP');
  if (error?.code === '22023' && error.message === 'INVALID_REVISION')
    return failure('INVALID_REQUEST');
  if (status === 0 || status === 429 || status >= 500 || !error?.code)
    return failure('SERVICE_UNAVAILABLE');
  return failure('DATABASE_ERROR');
}

async function authenticated(operation) {
  if (!supabase) return failure('SERVICE_UNAVAILABLE');
  try {
    const session = await supabase.auth.getSession();
    if (session?.error) return classify(session.error, session.error.status);
    if (!session?.data || !Object.hasOwn(session.data, 'session'))
      return failure('INVALID_RESPONSE');
    if (!session.data.session?.user?.id) return failure('UNAUTHENTICATED');
    return await operation(session.data.session.user.id);
  } catch {
    return failure('SERVICE_UNAVAILABLE');
  }
}

function savedTrip(value, expectedId) {
  if (
    !value ||
    !uuid(value.id) ||
    (expectedId && value.id !== expectedId) ||
    !revision(value.revision)
  )
    return failure('INVALID_RESPONSE');
  const validated = validateTripDraft(value.draft);
  return validated.valid
    ? success({ id: value.id, revision: value.revision, draft: validated.trip })
    : failure('INVALID_RESPONSE');
}

/** Results are {ok,data,error}; a successful load with data:null means no saved trip.
 * SDK session refresh and RLS remain authoritative. No tokens or user state are stored here.
 */
export function loadMyTrip() {
  return authenticated(async (userId) => {
    const response = await supabase
      .from('trips')
      .select(
        'id,revision,title,start_date,end_date,trip_destinations(sort_order,city_name,country_code,region,latitude,longitude,timezone,arrival_date,departure_date)',
      )
      .eq('user_id', userId)
      .maybeSingle();
    if (!response || !Object.hasOwn(response, 'data')) return failure('INVALID_RESPONSE');
    if (response.error) return classify(response.error, response.status);
    if (response.data === null) return success(null);
    const row = response.data;
    if (
      !Array.isArray(row?.trip_destinations) ||
      row.trip_destinations.some((d) => !d || !Number.isInteger(d.sort_order))
    )
      return failure('INVALID_RESPONSE');
    return savedTrip({
      id: row.id,
      revision: row.revision,
      draft: {
        title: row.title,
        startDate: row.start_date,
        endDate: row.end_date,
        destinations: [...row.trip_destinations]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((d) => ({
            position: d.sort_order,
            cityName: d.city_name,
            countryCode: d.country_code,
            region: d.region,
            lat: d.latitude,
            lon: d.longitude,
            timeZone: d.timezone,
            arrivalDate: d.arrival_date,
            departureDate: d.departure_date,
          })),
      },
    });
  });
}

/** Caller supplies a UUID for creation and retains it; expectedRevision is a JSON number, never a string. */
export function saveMyTrip({ tripId, expectedRevision, draft } = {}) {
  return authenticated(async () => {
    if (!uuid(tripId) || !revision(expectedRevision, 0)) return failure('INVALID_REQUEST');
    const validated = validateTripDraft(draft);
    if (!validated.valid) return failure('INVALID_TRIP', validated.errors);
    const response = await supabase.rpc('save_trip', {
      p_trip_id: tripId,
      p_expected_revision: expectedRevision,
      p_draft: validated.trip,
    });
    if (!response) return failure('INVALID_RESPONSE');
    if (response.error) return classify(response.error, response.status);
    return savedTrip(response.data, tripId);
  });
}

export function deleteMyTrip({ tripId, expectedRevision } = {}) {
  return authenticated(async () => {
    if (!uuid(tripId) || !revision(expectedRevision)) return failure('INVALID_REQUEST');
    const response = await supabase.rpc('delete_trip', {
      p_trip_id: tripId,
      p_expected_revision: expectedRevision,
    });
    if (!response) return failure('INVALID_RESPONSE');
    if (response.error) return classify(response.error, response.status);
    return response.data?.id === tripId && response.data.deleted === true
      ? success({ id: tripId, deleted: true })
      : failure('INVALID_RESPONSE');
  });
}
