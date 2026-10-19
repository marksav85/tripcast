import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { conditionIcon } from '../../lib/weatherPresentation.js';
import { allocateTripDates, addCalendarDays, coveredDayCount } from '../../../shared/trip.js';
import { formatCalendarDate } from '../../../shared/calendar.js';

const number = value => typeof value === 'number' && Number.isFinite(value);
const measurement = (value, unit) => number(value) ? `${value}${unit}` : '—';
const temperature = value => measurement(value, ' °C');

export function TripWeatherActions({ weather, disabled }) {
  return <>
    <button type="button" className="trip-button trip-button-primary" disabled={disabled || weather.loading} onClick={weather.refresh}>
      {weather.result || weather.error ? 'Refresh Weather' : 'Get Weather'}
    </button>
    {weather.loading && <button type="button" className="trip-button" onClick={weather.cancel}>Cancel weather request</button>}
  </>;
}

function ForecastCategory({ model }) {
  const type = model.forecastType;
  const label = model.forecastLabel ?? (type === 'standard' ? 'Standard forecast' : type === 'long-range' ? 'Long-range estimate' : 'Classification unavailable');
  return <span className={`trip-category ${type === 'long-range' ? 'trip-category-long' : type === 'standard' ? 'trip-category-standard' : ''}`}>{label}</span>;
}

function WeatherDetails({ model }) {
  const periods = [['morning', 'Morning'], ['day', 'Daytime'], ['evening', 'Evening'], ['night', 'Night']];
  const hasTemperatures = periods.some(([key]) => number(model.temperatureC?.[key]) || number(model.feelsLikeC?.[key]));
  const metrics = [['Wind speed', model.windSpeedMs, ' m/s'], ['Wind direction', model.windDirectionDeg, '°'],
    ['Humidity', model.humidityPercent, '%'], ['Cloud coverage', model.cloudPercent, '%'], ['UV index', model.uvIndex, '']];
  const hasMetrics = metrics.some(([, value]) => number(value));
  if (!hasTemperatures && !hasMetrics) return <p className="trip-detail-empty">Additional measurements are unavailable.</p>;
  return <div className="trip-details">
    {hasTemperatures && <div className="trip-periods">{periods.map(([key, label]) => <div key={key}>
      <h5>{label}</h5><p>{temperature(model.temperatureC?.[key])}</p><p className="trip-muted">Feels like {temperature(model.feelsLikeC?.[key])}</p>
    </div>)}</div>}
    {hasMetrics && <dl className="trip-metrics">{metrics.map(([label, value, unit]) => <div key={label}><dt>{label}</dt><dd>{measurement(value, unit)}</dd></div>)}</dl>}
    <p className="trip-muted">— means unavailable. Missing measurements are not zero.</p>
  </div>;
}

function WeatherDay({ date, day, requested }) {
  const dateLabel = formatCalendarDate(date);
  if (day?.status !== 'available') return <div className="trip-day trip-day-message">
    <h4>{dateLabel}</h4>
    <p>{day?.status === 'unavailable' ? `Unavailable: ${day.reason.message}` : day?.status === 'error'
      ? `Retrieval error: ${day.error.message}` : requested ? 'Weather was not returned for this date.' : 'Weather not requested.'}</p>
  </div>;
  const model = day.model;
  return <details className="trip-day">
    <summary className="trip-day-summary">
      <span className="trip-day-date">{dateLabel}</span>
      <span className="trip-condition">
        {model.condition && <FontAwesomeIcon icon={conditionIcon(model.condition)} aria-hidden="true" className="trip-condition-icon" />}
        <span><span className="trip-condition-name">{model.condition?.description ?? model.condition?.main ?? 'Condition unavailable'}</span>
          {number(model.precipitationProbability) && <span className="trip-rain">{Math.round(model.precipitationProbability * 100)}% precipitation chance</span>}</span>
      </span>
      <span className="trip-temperature"><span className="sr-only">Maximum </span>{temperature(model.highC)}<span className="trip-low"> / <span className="sr-only">Minimum </span>{temperature(model.lowC)}</span></span>
      <span className="trip-day-labels"><ForecastCategory model={model} />{day.meta?.stale && <span className="trip-stale">Older cached weather</span>}</span>
      <span aria-hidden="true" className="trip-chevron">⌄</span>
    </summary>
    <WeatherDetails model={model} />
  </details>;
}

/** Only presentation: allocations and provider values come from the established contracts. */
export default function TripWeatherResults({ saved, weather }) {
  const { loading, result, error } = weather;
  const allocation = allocateTripDates(saved.draft);
  return <section aria-label="Trip weather" aria-busy={loading} className="trip-itinerary">
    <h3 className="sr-only">Trip weather</h3>
    {loading && <output className="trip-notice">Loading trip weather…</output>}
    {error && <p className="trip-notice" role={error.code === 'CANCELLED' ? 'status' : 'alert'}>{error.message}{error.retryAfter !== undefined && ` Try again in ${error.retryAfter} seconds.`}</p>}
    {result && <output className="trip-notice">{result.meta.partial ? 'Some dates could not be assessed. Refresh to retry.' : 'Weather assessment complete.'}{result.meta.mock && ' Local fixture weather.'}</output>}
    {saved.draft.destinations.map((destination, index) => <section key={destination.position} className={`trip-destination trip-destination-${index % 3}`} aria-label={`${destination.cityName}, ${destination.countryCode} — Leg ${index + 1}`}>
      <header className="trip-destination-header">
        <div><h3>{destination.cityName}, {destination.countryCode}</h3>
          <p>Weather dates: {formatCalendarDate(destination.arrivalDate)} – {formatCalendarDate(addCalendarDays(destination.departureDate, -1))}</p>
          <p>{coveredDayCount(destination.arrivalDate, destination.departureDate)} covered {coveredDayCount(destination.arrivalDate, destination.departureDate) === 1 ? 'day' : 'days'}</p>
        </div><span className="trip-leg">Leg {index + 1} of {saved.draft.destinations.length}</span>
      </header>
      {allocation.allocations.filter(day => day.position === destination.position).map(({ date }) => <WeatherDay key={date} date={date}
        day={result?.data.days.find(day => day.position === destination.position && day.date === date)} requested={Boolean(result)} />)}
    </section>)}
  </section>;
}
