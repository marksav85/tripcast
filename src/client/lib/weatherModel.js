import { isCalendarDate } from './calendar';
import { validCoordinates } from './locations';

const numberIn = (value, min, max) => typeof value === 'number'
  && Number.isFinite(value) && value >= min && value <= max ? value : null;

// Adapter for the existing 3.0 day_summary only. 4.0 needs a separately
// validated adapter producing this presentation model, not a guessed schema.
export function normalizeDaySummary(data, query, units = 'metric') {
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || !isCalendarDate(data.date) || data.date !== query.date
    || !validCoordinates(query.location?.lat, query.location?.lon)) {
    throw new Error('The weather service returned an invalid date or response. Please retry.');
  }
  if (units !== 'metric' && units !== 'standard') throw new Error('Unsupported temperature units.');
  const temperature = (value) => {
    const numeric = numberIn(value, units === 'standard' ? 0 : -273.15, 1000);
    return numeric === null ? null : units === 'standard' ? numeric - 273.15 : numeric;
  };
  let lowC = temperature(data.temperature?.min);
  let highC = temperature(data.temperature?.max);
  if (lowC !== null && highC !== null && lowC > highC) { lowC = null; highC = null; }
  const model = {
    date: data.date,
    location: { ...query.location },
    source: 'OpenWeather daily summary',
    timeZone: null, // Do not infer an IANA zone from coordinates or a fixed offset.
    lowC, highC,
    cloudPercent: numberIn(data.cloud_cover?.afternoon, 0, 100),
    precipitationMm: numberIn(data.precipitation?.total, 0, Number.MAX_SAFE_INTEGER),
    condition: null, // This endpoint does not provide a validated condition code.
    semantics: { cloud: 'provider snapshot', precipitation: 'daily liquid-water equivalent' },
  };
  return { model, available: [lowC, highC, model.cloudPercent, model.precipitationMm].some((value) => value !== null) };
}
