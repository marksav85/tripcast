import { isCalendarDate } from './calendar.js';

export function validCoordinates(lat, lon) {
  return typeof lat === 'number' && typeof lon === 'number'
    && Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

export function validateLookup(city, date) {
  const errors = {};
  const query = typeof city === 'string' ? city.trim() : '';
  if (query.length < 2 || query.length > 100 || Array.from(query).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    errors.city = 'Enter a city between 2 and 100 characters.';
  }
  if (!isCalendarDate(date)) errors.date = 'Choose a valid calendar date.';
  return { query, errors };
}

export function normalizeCandidates(data) {
  if (!Array.isArray(data)) throw new Error('The city service returned an invalid response. Please retry.');
  const candidates = [];
  const seen = new Set();
  for (const item of data) {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100
      || typeof item.country !== 'string' || !/^[A-Z]{2}$/.test(item.country)
      || !validCoordinates(item.lat, item.lon)) continue;
    const key = `${item.lat},${item.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      id: key, name: item.name.trim(), country: item.country,
      region: typeof item.state === 'string' ? item.state.trim() : typeof item.region === 'string' ? item.region.trim() : '',
      lat: item.lat, lon: item.lon,
    });
    if (candidates.length === 5) break;
  }
  if (data.length && !candidates.length) throw new Error('The city service returned no usable locations. Please retry.');
  return candidates;
}

export function locationLabel(location) {
  return [location.name, location.region, location.country].filter(Boolean).join(', ');
}
