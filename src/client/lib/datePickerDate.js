import { isCalendarDate, todayDate } from './calendar';

// DayPicker needs Date objects; application state remains a calendar-day string.
// Local noon avoids midnight/DST boundaries. Never parse date-only strings as UTC.
export function toPickerDate(value) {
  if (!isCalendarDate(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return todayDate(date) === value ? date : undefined;
}

export function fromPickerDate(date) {
  return date instanceof Date && Number.isFinite(date.getTime()) ? todayDate(date) : '';
}
