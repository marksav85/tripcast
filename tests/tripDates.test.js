import { describe, expect, it } from 'vitest';
import { calendarDayNumber, addCalendarDays, coveredDayCount, coveredCalendarDates,
  validateTripDraft, allocateTripDates, isTripTimeZone } from '../src/shared/trip';

const destination = (position, arrivalDate, departureDate, overrides = {}) => ({ position, arrivalDate, departureDate,
  cityName: 'Paris', countryCode: 'FR', lat: 48.8566, lon: 2.3522, timeZone: 'Europe/Paris', ...overrides });
const draft = (startDate = '2027-06-01', endDate = '2027-06-02', destinations = [destination(0, startDate, endDate)]) => ({ title: 'Trip', startDate, endDate, destinations });
const invalid = (input) => { const r = allocateTripDates(input); expect(r.valid).toBe(false); expect(r.trip).toBeNull(); expect(r.allocations).toEqual([]); expect(Object.keys(r.errors).length).toBeGreaterThan(0); return r; };

describe('Gregorian calendar arithmetic without timestamps', () => {
  it.each([
    ['0001-01-01', 0, '0001-01-01'], ['0001-02-28', 1, '0001-03-01'],
    ['0099-12-31', 1, '0100-01-01'], ['1900-02-28', 1, '1900-03-01'],
    ['2000-02-28', 1, '2000-02-29'], ['2000-02-29', 1, '2000-03-01'],
    ['2100-02-28', 1, '2100-03-01'], ['2028-02-28', 2, '2028-03-01'],
    ['2026-12-31', 1, '2027-01-01'], ['9999-12-30', 1, '9999-12-31'],
    ['2000-03-01', -1, '2000-02-29'], ['2027-01-01', -1, '2026-12-31'],
  ])('adds calendar days: %s %+d = %s', (date, days, expected) => {
    expect(addCalendarDays(date, days)).toBe(expected);
    expect(calendarDayNumber(expected) - calendarDayNumber(date)).toBe(days);
  });
  it('covers the full supported ordinal interval without year-0/99 Date coercion', () => {
    expect(calendarDayNumber('0001-01-01')).toBe(0);
    expect(calendarDayNumber('9999-12-31')).toBe(3652058);
    expect(addCalendarDays('0001-01-01', 3652058)).toBe('9999-12-31');
  });
  it.each(['0000-01-01', '10000-01-01', '2027-02-29', '1900-02-29', '2100-02-29', '2027-04-31', '2027-1-01', '2027-01-01T00:00:00Z', null, 20270101])('rejects invalid date %j', (date) => {
    expect(() => calendarDayNumber(date)).toThrow(RangeError);
  });
  it.each([['0001-01-01', -1], ['9999-12-31', 1], ['2027-01-01', 1.5], ['2027-01-01', Infinity], ['2027-01-01', NaN]])('rejects overflow/nonintegral offsets %s %s', (date, days) => expect(() => addCalendarDays(date, days)).toThrow(RangeError));
  it('rejects reversed/zero/oversized allocation without allocating a huge range', () => {
    expect(() => coveredDayCount('2027-06-01', '2027-06-01')).toThrow();
    expect(() => coveredCalendarDates('2027-06-02', '2027-06-01')).toThrow();
    expect(() => coveredCalendarDates('0001-01-01', '9999-12-31')).toThrow();
  });
  it.each([['2027-03-13', '2027-03-16'], ['2026-10-24', '2026-10-27'], ['0001-01-01', '0001-01-04']])('returns exactly three labels despite DST/host zone (%s)', (start, end) => {
    expect(coveredCalendarDates(start, end)).toEqual([start, addCalendarDays(start, 1), addCalendarDays(start, 2)]);
  });
});

describe('complete trip validation and ownership', () => {
  it.each([1, 42])('accepts %i covered dates, excludes departure', (days) => {
    const d = draft('2027-06-01', addCalendarDays('2027-06-01', days));
    const r = allocateTripDates(d); expect(r.valid).toBe(true); expect(r.dayCount).toBe(days);
    expect(r.allocations).toHaveLength(days); expect(r.allocations.at(-1).date).toBe(addCalendarDays(d.endDate, -1));
  });
  it('rejects 43 days', () => invalid(draft('2027-06-01', '2027-07-14')));
  it.each([1, 8])('accepts %i consecutive destinations', (count) => {
    const start = '2027-06-01'; const items = Array.from({ length: count }, (_, i) => destination(i, addCalendarDays(start, i), addCalendarDays(start, i + 1)));
    expect(allocateTripDates(draft(start, addCalendarDays(start, count), items)).allocations.map((r) => r.position)).toEqual(Array.from({ length: count }, (_, i) => i));
  });
  it.each([0, 9])('rejects %i destinations', (count) => invalid(draft('2027-06-01', addCalendarDays('2027-06-01', Math.max(1, count)), Array.from({ length: count }, (_, i) => destination(i, addCalendarDays('2027-06-01', i), addCalendarDays('2027-06-01', i + 1))))));
  it('assigns transfer date only to arriving city and permits repeated cities', () => {
    const r = allocateTripDates(draft('2027-06-01', '2027-06-05', [destination(0, '2027-06-01', '2027-06-03'), destination(1, '2027-06-03', '2027-06-05')]));
    expect(r.allocations).toEqual([{ date: '2027-06-01', position: 0 }, { date: '2027-06-02', position: 0 }, { date: '2027-06-03', position: 1 }, { date: '2027-06-04', position: 1 }]);
    expect(new Set(r.allocations.map((r) => r.date)).size).toBe(4);
  });
  it.each(['2027-06-02', '2027-06-04'])('rejects overlap/gap at %s', (arrival) => invalid(draft('2027-06-01', '2027-06-05', [destination(0, '2027-06-01', '2027-06-03'), destination(1, arrival, '2027-06-05')])));
  it('rejects mismatched first and last bounds and zero-length destination', () => {
    invalid(draft('2027-06-01', '2027-06-05', [destination(0, '2027-06-02', '2027-06-04')]));
    invalid(draft('2027-06-01', '2027-06-03', [destination(0, '2027-06-01', '2027-06-01'), destination(1, '2027-06-01', '2027-06-03')]));
  });
  it.each([undefined, 1, -1, 0.5, NaN, '0'])('rejects missing/nonconsecutive position %j', (position) => invalid(draft(undefined, undefined, [destination(position, '2027-06-01', '2027-06-02')])));
  it('rejects duplicate and reordered positions; does not sort or adjust dates', () => {
    const items = [destination(0, '2027-06-01', '2027-06-02'), destination(1, '2027-06-02', '2027-06-03')];
    invalid(draft('2027-06-01', '2027-06-03', items.map((d) => ({ ...d, position: 0 }))));
    const reversed = [...items].reverse(); const before = structuredClone(reversed);
    invalid(draft('2027-06-01', '2027-06-03', reversed)); expect(reversed).toEqual(before);
    invalid(draft('2027-06-01', '2027-06-03', reversed.map((d, i) => ({ ...d, position: i }))));
  });
  it.each([['lat', NaN], ['lon', Infinity], ['lat', -Infinity], ['lat', 90.1], ['lon', -180.1], ['lat', '48'], ['lon', null]])('rejects bad coordinates %s=%j', (field, value) => invalid(draft(undefined, undefined, [destination(0, '2027-06-01', '2027-06-02', { [field]: value })])));
  it('accepts numeric zero and coordinate boundaries', () => {
    for (const [lat, lon] of [[0, 0], [90, 180], [-90, -180]]) expect(validateTripDraft(draft(undefined, undefined, [destination(0, '2027-06-01', '2027-06-02', { lat, lon })])).valid).toBe(true);
  });
  it.each([['cityName', ''], ['cityName', 'x'.repeat(101)], ['cityName', 'A\nB'], ['countryCode', 'fr'], ['countryCode', 'FRA'], ['countryCode', 'FR\n'], ['region', 12], ['region', ''], ['region', 'x'.repeat(101)], ['timeZone', '+02:00'], ['timeZone', 'PST'], ['timeZone', 'Invalid/Zone']])('rejects malformed metadata %s', (field, value) => invalid(draft(undefined, undefined, [destination(0, '2027-06-01', '2027-06-02', { [field]: value })])));
  it.each(['', ' '.repeat(5), 'x'.repeat(101), 'A\0B', 12])('rejects invalid title %j', (title) => invalid({ ...draft(), title }));
  it('normalizes copied labels without mutation, with stable field-error result', () => {
    const d = draft(); d.title = '  Summer  '; d.destinations[0].cityName = ' Paris '; d.destinations[0].region = ' Île-de-France ';
    const before = structuredClone(d); const r = validateTripDraft(d);
    expect(r).toMatchObject({ valid: true, dayCount: 1, errors: {}, trip: { title: 'Summer', destinations: [{ cityName: 'Paris', region: 'Île-de-France' }] } });
    expect(d).toEqual(before);
    expect(validateTripDraft({ ...d, title: '' }).errors).toHaveProperty('title');
  });
  it.each([null, [], {}, { ...draft(), user_id: 'not-accepted' }, { ...draft(), destinations: 'Paris' }, { ...draft(), destinations: [null] }, { ...draft(), destinations: [destination(0, '2027-06-01', '2027-06-02', { url: 'not-accepted' })] }])('rejects invalid shapes/unexpected fields (%#)', invalid);
  it('rejects missing own fields and sparse arrays', () => {
    const d = draft(); delete d.destinations[0].position; invalid(d);
    invalid({ ...draft(), destinations: Array(1) });
    const incomplete = draft(); delete incomplete.endDate; invalid(incomplete);
  });
  it('supports the earliest year and upper exclusive end without rollover', () => {
    expect(allocateTripDates(draft('0001-01-01', '0001-01-02')).allocations).toEqual([{ date: '0001-01-01', position: 0 }]);
    expect(allocateTripDates(draft('9999-12-30', '9999-12-31')).allocations).toEqual([{ date: '9999-12-30', position: 0 }]);
    invalid(draft('9999-12-31', '10000-01-01'));
  });
  it.each(['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Etc/GMT+11'])('validates IANA names %s without resolving coordinates', (zone) => expect(isTripTimeZone(zone)).toBe(true));
});
