import useTripWeather from '../../hooks/useTripWeather.js';

const temperature = value => typeof value === 'number' ? `${value} °C` : '—';

// Standalone adapter retains the existing development-preview props.
export default function TripWeatherPreview({ saved, ownerId, disabled }) {
  const weather = useTripWeather({ saved, ownerId, disabled });
  return <TripWeatherPreviewView saved={saved} disabled={disabled} weather={weather} />;
}

export function TripWeatherPreviewView({ saved, disabled, weather }) {
  const { loading, result, error, refresh, cancel } = weather;
  return <section aria-label="Saved trip weather preview" className="space-y-2 border-t py-3">
    <h2>Saved trip weather: {saved.draft.title}</h2>
    <p>Weather uses the last saved trip. Unsaved edits are excluded.</p>
    <button type="button" disabled={disabled || loading} onClick={refresh}>Refresh weather</button>
    {loading && <><output className="block">Loading trip weather…</output><button type="button" onClick={cancel}>Cancel weather request</button></>}
    {error && (error.code === 'CANCELLED' ? <output className="block">{error.message}</output>
      : <p role="alert">{error.message}{error.retryAfter !== undefined && ` Try again in ${error.retryAfter} seconds.`}</p>)}
    {result && <>
      <p>{result.meta.partial ? 'Some dates could not be assessed. Refresh to retry.' : 'Weather assessment complete.'}
        {result.meta.mock && ' Local fixture weather.'}</p>
      <ol>{result.data.days.map(day => <li key={`${day.position}:${day.date}`} className="py-2">
        <h3>{saved.draft.destinations[day.position].cityName} — {day.date}</h3>
        <p>Status: {day.status}{day.meta?.stale ? ' (stale cached weather)' : day.meta?.cached ? ' (cached)' : ''}</p>
        {day.status === 'available' && <>
          <p>{day.model.condition?.main ?? 'Condition unavailable'} · Minimum {temperature(day.model.lowC)} · Maximum {temperature(day.model.highC)}</p>
          {day.model.temperatureC && <p>Morning {temperature(day.model.temperatureC.morning)} · Day {temperature(day.model.temperatureC.day)} · Evening {temperature(day.model.temperatureC.evening)} · Night {temperature(day.model.temperatureC.night)}</p>}
        </>}
        {day.status === 'unavailable' && <p>{day.reason.message}</p>}
        {day.status === 'error' && <p>{day.error.message}</p>}
      </li>)}</ol>
    </>}
  </section>;
}
