import axios from 'axios';
import { normalizeCandidates, validCoordinates } from '../lib/locations';
import { normalizeDaySummary } from '../lib/weatherModel';

// Temporary existing browser integration. No key values/logs are introduced.
// Replace this adapter with the same-origin Worker client in the security batch.
function request(path, params, signal) {
  return axios.get(`https://api.openweathermap.org/${path}`, {
    params: { ...params, appid: import.meta.env.VITE_API_KEY },
    signal, timeout: 8000,
  });
}

export async function lookupCities(city, signal) {
  const response = await request('geo/1.0/direct', { q: city, limit: 5 }, signal);
  return normalizeCandidates(response.data);
}

export async function reverseLookup(lat, lon, signal) {
  if (!validCoordinates(lat, lon)) throw new Error('Your location coordinates are invalid.');
  const response = await request('geo/1.0/reverse', { lat, lon, limit: 1 }, signal);
  const locations = normalizeCandidates(response.data);
  return locations[0] ? { ...locations[0], lat, lon } : null;
}

export async function lookupWeather(query, signal) {
  const { lat, lon } = query.location;
  const response = await request('data/3.0/onecall/day_summary', {
    lat, lon, date: query.date, units: 'metric',
  }, signal);
  return normalizeDaySummary(response.data, query);
}

export function requestError(error, service) {
  if (error?.response?.status === 429) return 'The weather service is busy. Please wait before retrying.';
  if ([401, 403].includes(error?.response?.status)) return 'Weather service access is unavailable. Please try again later.';
  if (error?.code === 'ECONNABORTED') return `${service} timed out. Please retry.`;
  // Never render Axios messages, which can contain key-bearing URLs.
  if (error?.name === 'Error' && !error?.isAxiosError && !error?.response && !error?.code
    && /^(The city service|The weather service|Your location coordinates)/.test(error.message)) return error.message;
  return `${service} failed. Check your connection and retry.`;
}
