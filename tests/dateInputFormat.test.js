import { expect, it, vi } from 'vitest';
import {
  dateInputFormat,
  displayInputDate,
  parseInputDate,
} from '../src/client/lib/dateInputFormat';
import { toPickerDate, fromPickerDate } from '../src/client/lib/datePickerDate';

it.each([
  ['en-GB', 'DD/MM/YYYY', '25/10/2026'],
  ['en-US', 'MM/DD/YYYY', '10/25/2026'],
  ['de-DE', 'DD.MM.YYYY', '25.10.2026'],
])('uses the indicated %s format', (locale, placeholder, display) => {
  const format = dateInputFormat(locale);
  expect(format.placeholder).toBe(placeholder);
  expect(displayInputDate('2026-10-25', format)).toBe(display);
  expect(parseInputDate(display, format)).toBe('2026-10-25');
});
it.each([
  ['en-GB', '04/05/2026', '2026-05-04'],
  ['en-US', '04/05/2026', '2026-04-05'],
  ['de-DE', '04.05.2026', '2026-05-04'],
  ['en-GB', '04-05-2026', '2026-05-04'],
  ['en-US', '04-05-2026', '2026-04-05'],
  ['en-US', '25/10/2026', '2026-10-25'],
  ['en-GB', '10/25/2026', '2026-10-25'],
  ['de-DE', '10-25-2026', '2026-10-25'],
  ['en-GB', '2026-10-25', '2026-10-25'],
  ['en-US', '2026-10-25', '2026-10-25'],
  ['en-GB', '31/12/2026', '2026-12-31'],
  ['en-US', '01/01/2027', '2027-01-01'],
  ['en-GB', '29/02/2028', '2028-02-29'],
  ['en-US', '2/29/2028', '2028-02-29'],
])('parses %s input %s without changing its calendar day', (locale, input, iso) => {
  const value = parseInputDate(input, dateInputFormat(locale));
  expect(value).toBe(iso);
  expect(fromPickerDate(toPickerDate(value))).toBe(iso);
});
it.each([
  '31/02/2026',
  '02/31/2026',
  '2026-02-31',
  '29/02/2027',
  '00/10/2026',
  '13/13/2026',
  '25/10-2026',
  '25/10/26',
  '2026-10-',
  '',
])('rejects impossible or incomplete input %s', (input) => {
  expect(parseInputDate(input, dateInputFormat('en-GB'))).toBe('');
});
it('defaults to day-first regardless of browser locale and retains explicit locale support', () => {
  vi.stubGlobal('navigator', { language: 'en-US' });
  expect(dateInputFormat().placeholder).toBe('DD/MM/YYYY');
  expect(dateInputFormat('en-US').placeholder).toBe('MM/DD/YYYY');
  vi.stubGlobal('navigator', undefined);
  expect(dateInputFormat().placeholder).toBe('DD/MM/YYYY');
  expect(dateInputFormat('invalid_locale').placeholder).toBe('DD/MM/YYYY');
  vi.stubGlobal('Intl', undefined);
  expect(dateInputFormat('en-US').placeholder).toBe('DD/MM/YYYY');
});

it.each([
  ['04/05/2026', '2026-05-04'],
  ['04-05-2026', '2026-05-04'],
  ['10/25/2026', '2026-10-25'],
  ['10-25-2026', '2026-10-25'],
  ['2026-10-25', '2026-10-25'],
])('uses the TripCast default to parse %s', (typed, iso) => {
  vi.stubGlobal('navigator', { language: 'en-US' });
  expect(parseInputDate(typed, dateInputFormat())).toBe(iso);
});
