import { useContext, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLocationDot, faMagnifyingGlass, faTemperatureHalf } from '@fortawesome/free-solid-svg-icons';
import WeatherContext from '../../context/WeatherContextProvider';
import useReducedMotion from '../../hooks/useReducedMotion';
import { formatCalendarDate } from '../../lib/calendar';
import { locationLabel } from '../../lib/locations';
import { conditionIcon } from '../../lib/weatherPresentation';

const number = (value) => typeof value === 'number' && Number.isFinite(value);
const measurement = (value, unit = '') => number(value) ? `${value}${unit}` : 'Unavailable';
const temperature = (value) => number(value) ? `${Math.round(value)}°C` : 'Unavailable';
const periods = [['morning', 'Morning'], ['day', 'Daytime'], ['evening', 'Evening'], ['night', 'Night']];

export default function Weather() {
  const { weather, retry } = useContext(WeatherContext);
  const reducedMotion = useReducedMotion();
  const { status, message, result } = weather;
  const headingRef = useRef(null);
  useEffect(() => {
    if (status === 'success' || status === 'unavailable') headingRef.current?.focus({ preventScroll: true });
  }, [status, result]);
  const metrics = result ? [
    [`Cloud cover (${result.semantics?.cloud ?? 'provider snapshot'})`, result.cloudPercent, '%'],
    ['Total precipitation (liquid-water equivalent)', result.precipitationMm, ' mm'],
    ['Wind speed', result.windSpeedMs, ' m/s'], ['Wind direction', result.windDirectionDeg, '°'],
    ['Humidity', result.humidityPercent, '%'], ['UV index', result.uvIndex, ''],
    ['Pressure', result.pressureHpa, ' hPa'], ['Dew point', result.dewPointC, '°C'],
  ].filter(([, value], index) => index < 2 || number(value)) : [];
  const hasPeriods = result && periods.some(([key]) => number(result.temperatureC?.[key]) || number(result.feelsLikeC?.[key]));

  return <section aria-label="Weather result" aria-busy={status === 'loading'} className="home-weather">
    <div className="home-result-heading">
      <span className="home-result-marker" aria-hidden="true"><FontAwesomeIcon icon={result ? faLocationDot : faMagnifyingGlass} /></span>
      <div><h2 ref={headingRef} tabIndex={-1}>{result ? locationLabel(result.location) : 'Weather'}</h2>
        {result && <p>{formatCalendarDate(result.date)} · Daily weather</p>}
      </div>
    </div>
    <p role={status === 'error' ? 'alert' : 'status'} className={`home-weather-status${status === 'error' ? ' home-weather-error' : ''}`}>
      {status === 'idle' ? 'Enter a city and date to see weather.' : message}
    </p>
    {!result && <div className="home-weather-state">
      {status === 'loading' && !reducedMotion && <span className="home-loading-indicator" data-testid="loading-indicator" aria-hidden="true" />}
      <h3>{status === 'idle' ? 'Where will your next journey take you?' : status === 'loading' ? 'Checking your destination'
        : status === 'selecting' ? 'Choose your destination' : status === 'empty' ? 'Try another city' : 'Let’s try that again'}</h3>
      <p>{status === 'idle' ? 'Your daily weather summary will appear here after a search.' : status === 'selecting'
        ? 'Select a matching city in the search card to continue.' : status === 'loading'
          ? 'You can reset the search or edit your destination to cancel.' : 'Check your search details and retry when you’re ready.'}</p>
    </div>}
    {['error', 'empty', 'unavailable'].includes(status) && <button type="button" onClick={retry} className="home-button home-button-primary home-retry">Retry last lookup</button>}
    {result && <div id="weather-details" className="home-weather-card">
      <div className="home-weather-summary">
        <div><p className="home-eyebrow">Daily summary</p><h3>{formatCalendarDate(result.date)}</h3>
          <p className="home-condition">{result.condition ? `Weather conditions: ${result.condition.description}.`
            : 'Weather conditions: unavailable from this daily summary.'}</p>
          {result.forecastLabel && <p className="home-forecast-note">{result.forecastLabel} — TripCast provisional eight-day policy. Long-range estimates are less certain.</p>}
        </div>
        <div className="home-temperature-summary">
          <FontAwesomeIcon icon={result.condition ? conditionIcon(result.condition) : faTemperatureHalf} aria-hidden="true" />
          <dl><dt>High temperature</dt><dd className="home-temperature-high">{temperature(result.highC)}</dd>
            <dt>Low temperature</dt><dd className="home-temperature-low">{temperature(result.lowC)}</dd></dl>
        </div>
      </div>
      <dl className="home-weather-metrics">{metrics.map(([label, value, unit]) => <div key={label}><dt>{label}</dt><dd>{measurement(value, unit)}</dd></div>)}</dl>
      {number(result.precipitationProbability) && <p className="home-probability">Precipitation probability: {Math.round(result.precipitationProbability * 100)}%</p>}
      {hasPeriods && <section className="home-day-periods" aria-label="Temperatures through the day">
        <h4>Through the day</h4>
        <dl>{periods.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{temperature(result.temperatureC?.[key])}</dd>
          <dd>Feels like {temperature(result.feelsLikeC?.[key])}</dd></div>)}</dl>
      </section>}
      <div className="home-weather-source">
        <p>{result.source}. Missing measurements are unavailable.</p>
        <p>High/low temperatures and total precipitation are daily values. Cloud cover is a {result.semantics?.cloud ?? 'provider snapshot'}.</p>
        {result.freshness?.mock && <p>Local demonstration data — not a live forecast.</p>}
        {result.freshness?.stale && <p role="alert">Showing older cached weather while the service is unavailable.</p>}
      </div>
    </div>}
  </section>;
}
