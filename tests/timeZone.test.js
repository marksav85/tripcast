import { describe, expect, it } from 'vitest';
import tzLookup from '@photostructure/tz-lookup';
import { resolveTimeZone } from '../src/client/lib/timeZone.js';
import { isTripTimeZone } from '../src/shared/trip.js';

describe('actual installed lookup and resolver', () => {
  it.each([
    ['Paris', 48.8566, 2.3522, 'Europe/Paris'],
    ['Rome', 41.9028, 12.4964, 'Europe/Rome'],
    ['Barcelona', 41.3851, 2.1734, 'Europe/Madrid'],
    ['New York', 40.7092, -74.0151, 'America/New_York'],
    ['Arizona test point', 36.9147, -111.4558, 'America/Phoenix'],
    ['Kiritimati', 1.8721, -157.4278, 'Pacific/Kiritimati'],
  ])('%s returns the reviewed identifier', (_name, lat, lon, expected) => {
    const actual = tzLookup(lat, lon);
    expect(actual).toBe(expected);
    expect(isTripTimeZone(actual)).toBe(true);
    expect(resolveTimeZone(lat, lon)).toEqual({ status: 'suggested', timeZone: expected, reason: null });
  });
  it.each([[NaN, 0], [0, Infinity], [-Infinity, 0], [91, 0], [-91, 0], [0, 181], [0, -181], ['48', 2], [null, 0], [0, undefined]])('rejects invalid/coerced coordinates %#', (lat, lon) => {
    expect(resolveTimeZone(lat, lon)).toEqual({ status: 'unresolved', timeZone: null, reason: 'invalidCoordinates' });
  });
  it.each([[0, 0], [90, 180], [-90, -180]])('keeps zeros and geographic boundaries valid %#', (lat, lon) => {
    const result = resolveTimeZone(lat, lon);
    expect(result.status).toBe('suggested'); expect(isTripTimeZone(result.timeZone)).toBe(true);
  });
});
