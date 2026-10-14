import tzLookup from '@photostructure/tz-lookup';
import { validCoordinates } from '../../shared/locations.js';
import { isTripTimeZone } from '../../shared/trip.js';

/** Approximate, editable suggestion only; identifier validity does not prove geographic accuracy. */
export function resolveTimeZone(lat, lon) {
  if (!validCoordinates(lat, lon)) return { status: 'unresolved', timeZone: null, reason: 'invalidCoordinates' };
  try {
    const timeZone = tzLookup(lat, lon);
    if (!isTripTimeZone(timeZone)) return { status: 'unresolved', timeZone: null, reason: 'unsupportedTimeZone' };
    return { status: 'suggested', timeZone, reason: null };
  } catch {
    return { status: 'unresolved', timeZone: null, reason: 'lookupFailed' };
  }
}
