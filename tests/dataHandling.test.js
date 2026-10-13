import { describe, expect, it } from 'vitest';
import { isCalendarDate, todayDate, formatCalendarDate } from '../src/client/lib/calendar';
import { normalizeCandidates, validCoordinates, validateLookup } from '../src/client/lib/locations';
import { normalizeDaySummary } from '../src/worker/normalize';
import { berlin, daySummary } from './fixtures/weather';

const query = { date: daySummary.date, location: { ...berlin } };
describe('calendar-only dates', () => {
  it.each(['2000-02-29', '2024-02-29', '2026-12-31', '0001-01-01'])('accepts real date %s', (date) => expect(isCalendarDate(date)).toBe(true));
  it.each(['2100-02-29', '2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '0000-01-01', '2026-1-01', '2026-10-13T00:00:00Z', '', null])('rejects invalid date %s', (date) => expect(isCalendarDate(date)).toBe(false));
  it('formats date-only strings without local-timezone shifting', () => {
    expect(formatCalendarDate('2026-10-13')).toBe('13 October 2026');
    expect(formatCalendarDate('2026-02-30')).toBe('Date unavailable');
  });
  it('uses the browser local calendar for Today, not a UTC ISO slice', () => {
    expect(todayDate(new Date(2026, 9, 13, 0, 15))).toBe('2026-10-13');
    expect(todayDate(new Date(2026, 9, 13, 23, 45))).toBe('2026-10-13');
  });
  it('supports destination timezone boundaries without guessing offsets', () => {
    const instant = new Date('2026-10-13T00:30:00Z');
    expect(todayDate(instant, 'America/Los_Angeles')).toBe('2026-10-12');
    expect(todayDate(instant, 'Pacific/Kiritimati')).toBe('2026-10-13');
    expect(todayDate(new Date('2026-10-13T23:30:00Z'), 'Pacific/Kiritimati')).toBe('2026-10-14');
  });
  it('handles DST using IANA zone rules', () => {
    for (const time of ['2026-03-08T09:30:00Z', '2026-03-08T10:30:00Z']) {
      expect(todayDate(new Date(time), 'America/Los_Angeles')).toBe('2026-03-08');
    }
    expect(() => todayDate(new Date(), 'not-a-zone')).toThrow();
  });
});

describe('location validation', () => {
  it.each(['', ' ', 'A', 'a'.repeat(101), 'Paris\nFrance'])('rejects invalid city %s', (city) => {
    expect(validateLookup(city, daySummary.date).errors.city).toBeTruthy();
  });
  it('preserves Unicode/punctuation and validates the date independently', () => {
    expect(validateLookup('  São Paulo, BR  ', daySummary.date)).toEqual({ query: 'São Paulo, BR', errors: {} });
    expect(validateLookup('Berlin', '2100-02-29').errors.date).toBeTruthy();
  });
  it('allows coordinate boundaries and rejects nonfinite/coerced values', () => {
    expect(validCoordinates(-90, 180)).toBe(true);
    expect(validCoordinates(90, -180)).toBe(true);
    for (const lat of [NaN, Infinity, '52', null, 91]) expect(validCoordinates(lat, 0)).toBe(false);
    expect(validCoordinates(0, -181)).toBe(false);
  });
  it('deduplicates valid candidates and discards invalid members', () => {
    expect(normalizeCandidates([null, berlin, berlin, { ...berlin, lat: Infinity }])).toHaveLength(1);
    expect(normalizeCandidates([])).toEqual([]);
  });
});

describe('existing day-summary adapter / reusable model', () => {
  it('preserves zero values, Celsius units and explicit missing conditions', () => {
    const { model, available } = normalizeDaySummary(daySummary, query);
    expect(available).toBe(true);
    expect(model).toMatchObject({ lowC: 0, highC: 15, precipitationMm: 0, cloudPercent: 20, condition: null, timeZone: null });
    expect(model).not.toHaveProperty('averageTemperature');
    expect(model).not.toHaveProperty('rainMm');
  });
  it('can explicitly convert Kelvin once, never implicitly', () => {
    const data = { ...daySummary, temperature: { min: 273.15, max: 283.15 } };
    expect(normalizeDaySummary(data, query, 'standard').model).toMatchObject({ lowC: 0, highC: 10 });
    expect(() => normalizeDaySummary(data, query, 'imperial')).toThrow();
  });
  it('keeps missing and invalid measurements null, not zero', () => {
    const { model, available } = normalizeDaySummary({ date: daySummary.date,
      temperature: { min: null, max: '15' }, cloud_cover: { afternoon: 101 }, precipitation: { total: -1 },
    }, query);
    expect(available).toBe(false);
    expect(model).toMatchObject({ lowC: null, highC: null, cloudPercent: null, precipitationMm: null });
  });
  it('handles incomplete nested objects and nonfinite values safely', () => {
    expect(normalizeDaySummary({ date: daySummary.date, temperature: { min: -5 }, precipitation: null }, query).model)
      .toMatchObject({ lowC: -5, highC: null, precipitationMm: null });
    expect(normalizeDaySummary({ date: daySummary.date, temperature: { min: NaN, max: Infinity } }, query).available).toBe(false);
  });
  it('marks all-missing days unavailable and rejects swapped high/low', () => {
    expect(normalizeDaySummary({ date: daySummary.date }, query).available).toBe(false);
    expect(normalizeDaySummary({ date: daySummary.date, temperature: { min: 20, max: 5 } }, query).model)
      .toMatchObject({ lowC: null, highC: null });
  });
  it.each([null, [], {}, { date: '2026-02-30' }, { date: '2026-10-14' }])('rejects unusable weather envelopes %j', (data) => {
    expect(() => normalizeDaySummary(data, query)).toThrow(/invalid date or response/);
  });
});
