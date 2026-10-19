import { isCalendarDate } from './calendar';

// TripCast defaults to day-first. Other formats require an explicit locale.
const fallback = { order: ['day', 'month', 'year'], separator: '/', placeholder: 'DD/MM/YYYY' };
export function dateInputFormat(locale) {
  try {
    if (!locale) return fallback;
    const activeLocale = locale;
    const parts = new Intl.DateTimeFormat(activeLocale, { day: '2-digit', month: '2-digit', year: 'numeric' })
      .formatToParts(new Date(2026, 9, 25, 12));
    const order = parts.filter(({ type }) => ['day', 'month', 'year'].includes(type)).map(({ type }) => type);
    const separator = parts.find(({ type }) => type === 'literal')?.value.trim();
    if (order.length !== 3 || !['/', '.', '-'].includes(separator)) return fallback;
    const names = { day: 'DD', month: 'MM', year: 'YYYY' };
    return { order, separator, placeholder: order.map((part) => names[part]).join(separator) };
  } catch { return fallback; }
}

export function displayInputDate(value, format) {
  if (!isCalendarDate(value)) return '';
  const [year, month, day] = value.split('-');
  const fields = { year, month, day };
  return format.order.map((part) => fields[part]).join(format.separator);
}

export function parseInputDate(text, format) {
  const value = text.trim();
  const yearFirst = /^(\d{4})([/.-])(\d{1,2})\2(\d{1,2})$/.exec(value);
  if (yearFirst) {
    const candidate = `${yearFirst[1]}-${yearFirst[3].padStart(2, '0')}-${yearFirst[4].padStart(2, '0')}`;
    return isCalendarDate(candidate) ? candidate : '';
  }
  const match = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/.exec(value);
  if (!match) return '';
  const [, first, , second, year] = match;
  if (format.order[0] === 'year' && Number(first) <= 12 && Number(second) <= 12) return '';
  const monthFirst = format.order[0] === 'month';
  const day = monthFirst ? second : first;
  const month = monthFirst ? first : second;
  const candidate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (isCalendarDate(candidate)) return candidate;
  // Only try the alternative when a field >12 makes its interpretation unambiguous.
  if (Number(first) <= 12 && Number(second) <= 12) return '';
  const alternative = `${year}-${day.padStart(2, '0')}-${month.padStart(2, '0')}`;
  return isCalendarDate(alternative) ? alternative : '';
}
