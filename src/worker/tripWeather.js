import { allocateTripDates } from '../shared/trip.js';
import { ApiError } from './errors.js';
import { weatherDateError } from './validation.js';
import { createWeatherContext } from './weatherContext.js';

const failed = (date, error) => ({ date, status: 'error', model: null, error: error instanceof ApiError
  ? { code: error.code, message: error.message }
  : { code: 'WEATHER_RETRIEVAL_FAILED', message: 'Weather could not be retrieved.' } });

/** Authenticated caller supplies a validated snapshot; no persistence or HTTP recursion. */
export async function retrieveTripWeather(draft, env, { weather, signal, startedAt, now = () => Date.now(), ...settings }) {
  const allocation = allocateTripDates(draft);
  if (!allocation.valid) throw new ApiError('INVALID_INPUT', 400, 'Check the trip draft.');
  const context = createWeatherContext({ signal, startedAt });
  try {
    const days = allocation.allocations.map(({ position, date }) => {
      const error = weatherDateError(date, now());
      return error ? { position, date, status: 'unavailable', model: null, reason: { code: error.code, message: error.message } } : null;
    });
    const chunks = [];
    for (const destination of allocation.trip.destinations) {
      const assigned = allocation.allocations.map((day, index) => ({ ...day, index }))
        .filter(day => day.position === destination.position && !days[day.index]);
      for (let offset = 0; offset < assigned.length; offset += 10) chunks.push({ destination, dates: assigned.slice(offset, offset + 10) });
    }
    let next = 0;
    async function run() {
      while (next < chunks.length) {
        const { destination, dates } = chunks[next++];
        let outcomes;
        try {
          context.check();
          outcomes = await weather.getRange({ lat: destination.lat, lon: destination.lon,
            date: dates[0].date, endDate: dates.at(-1).date }, env, { ...settings, context });
        } catch (error) { outcomes = dates.map(({ date }) => failed(date, error)); }
        for (const { date, position, index } of dates) {
          const outcome = outcomes.find(day => day.date === date) ?? failed(date);
          days[index] = { ...outcome, position, date };
          if (outcome.status === 'unavailable') days[index].reason = { code: 'NO_WEATHER_DATA', message: 'No usable weather data was returned for this date.' };
        }
      }
    }
    await Promise.all([run(), run()]);
    return { data: { days }, meta: { partial: days.some(day => day.status === 'error'), mock: settings.mock } };
  } finally { context.dispose(); }
}
