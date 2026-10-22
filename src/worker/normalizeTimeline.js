import { forecastPolicy } from './timeline.js';

const numberIn = (value, min, max) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
const text = (value) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 120 &&
  !value.split('').some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
  !value.includes('://')
    ? value.trim()
    : null;

/**
 * Normalize one date from a validated, metric timeline into the shared weather model.
 * Missing or invalid measurements stay null; availability requires a usable display signal.
 * @param {object} timeline Collected records with a validated provider IANA timezone.
 * @param {string} date Requested YYYY-MM-DD date in the provider's timezone.
 * @param {number} now Current Unix time in milliseconds, used for forecast classification.
 * @returns {{model: object, available: boolean}} Includes provisional forecast metadata.
 */
export function normalizeTimelineDay(timeline, date, now) {
  const raw = timeline.days.find((day) => day.date === date)?.record ?? {};
  let lowC = numberIn(raw.temp?.min, -273.15, 1000);
  let highC = numberIn(raw.temp?.max, -273.15, 1000);
  if (lowC !== null && highC !== null && lowC > highC) {
    lowC = null;
    highC = null;
  }
  const candidate = Array.isArray(raw.weather) ? raw.weather[0] : null;
  const condition =
    candidate &&
    Number.isInteger(candidate.id) &&
    candidate.id >= 200 &&
    candidate.id <= 804 &&
    text(candidate.main) &&
    text(candidate.description)
      ? {
          id: candidate.id,
          main: text(candidate.main),
          description: text(candidate.description),
          icon:
            typeof candidate.icon === 'string' && /^\d{2}[dn]$/.test(candidate.icon)
              ? candidate.icon
              : null,
        }
      : null;
  const policy = forecastPolicy(date, timeline.timezone, now);
  delete policy.near;
  const model = {
    date,
    source: 'OpenWeather One Call 4.0',
    timeZone: timeline.timezone,
    ...policy,
    lowC,
    highC,
    condition,
    temperatureC: {
      morning: numberIn(raw.temp?.morn, -273.15, 1000),
      day: numberIn(raw.temp?.day, -273.15, 1000),
      evening: numberIn(raw.temp?.eve, -273.15, 1000),
      night: numberIn(raw.temp?.night, -273.15, 1000),
      min: lowC,
      max: highC,
    },
    feelsLikeC: {
      morning: numberIn(raw.feels_like?.morn, -273.15, 1000),
      day: numberIn(raw.feels_like?.day, -273.15, 1000),
      evening: numberIn(raw.feels_like?.eve, -273.15, 1000),
      night: numberIn(raw.feels_like?.night, -273.15, 1000),
    },
    pressureHpa: numberIn(raw.pressure, 0, 2000),
    dewPointC: numberIn(raw.dew_point, -273.15, 1000),
    providerRainValue: numberIn(raw.rain, 0, Number.MAX_SAFE_INTEGER),
    cloudPercent: numberIn(raw.clouds, 0, 100),
    humidityPercent: numberIn(raw.humidity, 0, 100),
    windSpeedMs: numberIn(raw.wind_speed, 0, 1000),
    windDirectionDeg: numberIn(raw.wind_deg, 0, 360),
    uvIndex: numberIn(raw.uvi, 0, 1000),
    precipitationProbability: numberIn(raw.pop, 0, 1),
    precipitationMm: null, // Scalar rain/snow aggregation is unverified; never a daily total.
    semantics: {
      cloud: 'provider daily value',
      precipitation: 'daily aggregation unverified',
      providerRainValue: 'provider scalar; units and aggregation window unverified',
      precipitationProbability: 'fraction 0–1',
      wind: 'metres per second',
      forecast: policy.forecastPolicy,
    },
  };
  return {
    model,
    available:
      condition !== null ||
      [
        lowC,
        highC,
        model.cloudPercent,
        model.humidityPercent,
        model.windSpeedMs,
        model.windDirectionDeg,
        model.uvIndex,
        model.precipitationProbability,
      ].some((value) => value !== null),
  };
}
