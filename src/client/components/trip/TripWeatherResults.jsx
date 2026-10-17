const temperature = value => typeof value === 'number' ? `${value} °C` : 'Unavailable';

/** Functional dashboard presentation; the account container owns all request state. */
export default function TripWeatherResults({ saved, weather, disabled }) {
  const { loading, result, error, refresh, cancel } = weather;
  return <section aria-label="Trip weather" aria-busy={loading} className="space-y-3 border-t pt-4">
    <h3 className="text-xl font-semibold">Trip weather</h3>
    <p>Weather uses your saved trip. Retrieve or refresh it when you are ready.</p>
    <button type="button" className="border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 disabled:opacity-50" disabled={disabled || loading} onClick={refresh}>
      {result || error ? 'Refresh Weather' : 'Get Weather'}
    </button>
    {loading && <><output className="block">Loading trip weather…</output><button type="button" className="underline focus:ring-2 focus:ring-blue-500" onClick={cancel}>Cancel weather request</button></>}
    {error && <p role={error.code === 'CANCELLED' ? 'status' : 'alert'}>{error.message}{error.retryAfter !== undefined && ` Try again in ${error.retryAfter} seconds.`}</p>}
    {result && <>
      <output className="block">{result.meta.partial ? 'Some dates could not be assessed. Refresh to retry.' : 'Weather assessment complete.'}{result.meta.mock && ' Local fixture weather.'}</output>
      <ol className="space-y-3">{result.data.days.map(day => <li key={`${day.position}:${day.date}`}>
        <h4 className="font-semibold">{saved.draft.destinations[day.position].cityName} — {day.date}</h4>
        {day.status === 'available' && <p>{day.model.condition?.main ?? 'Condition unavailable'} · Minimum {temperature(day.model.lowC)} · Maximum {temperature(day.model.highC)}</p>}
        {day.status === 'unavailable' && <p>Unavailable: {day.reason.message}</p>}
        {day.status === 'error' && <p>Retrieval error: {day.error.message}</p>}
        {day.meta?.stale && <p>Showing older cached weather.</p>}
      </li>)}</ol>
    </>}
  </section>;
}
