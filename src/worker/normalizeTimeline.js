import { forecastPolicy } from './timeline.js';

const numberIn = (value, min, max) => typeof value === 'number' && Number.isFinite(value)
  && value >= min && value <= max ? value : null;
const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 120
  && !value.split('').some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  && !value.includes('://') ? value.trim() : null;

export function normalizeTimelineDay(timeline, date, now) {
  const raw = timeline.days.find((day) => day.date === date)?.record ?? {};
  let lowC = numberIn(raw.temp?.min, -273.15, 1000);
  let highC = numberIn(raw.temp?.max, -273.15, 1000);
  if (lowC !== null && highC !== null && lowC > highC) { lowC = null; highC = null; }
  const candidate = Array.isArray(raw.weather) ? raw.weather[0] : null;
  const condition = candidate && Number.isInteger(candidate.id) && candidate.id >= 200 && candidate.id <= 804
    && text(candidate.main) && text(candidate.description) ? {
      id: candidate.id, main: text(candidate.main), description: text(candidate.description),
      icon: typeof candidate.icon === 'string' && /^\d{2}[dn]$/.test(candidate.icon) ? candidate.icon : null,
    } : null;
  const policy = forecastPolicy(date, timeline.timezone, now);
  delete policy.near;
  const model = {
    date, source: 'OpenWeather One Call 4.0', timeZone: timeline.timezone, ...policy,
    lowC, highC, condition,
    cloudPercent: numberIn(raw.clouds, 0, 100), humidityPercent: numberIn(raw.humidity, 0, 100),
    windSpeedMs: numberIn(raw.wind_speed, 0, 1000), windDirectionDeg: numberIn(raw.wind_deg, 0, 360),
    uvIndex: numberIn(raw.uvi, 0, 1000), precipitationProbability: numberIn(raw.pop, 0, 1),
    precipitationMm: null, // Scalar rain/snow aggregation is unverified; never a daily total.
    semantics: { cloud: 'provider daily value', precipitation: 'daily aggregation unverified',
      precipitationProbability: 'fraction 0–1', wind: 'metres per second', forecast: policy.forecastPolicy },
  };
  return { model, available: condition !== null || [lowC, highC, model.cloudPercent, model.humidityPercent,
    model.windSpeedMs, model.windDirectionDeg, model.uvIndex, model.precipitationProbability].some((value) => value !== null) };
}
