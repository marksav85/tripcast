import { useEffect, useRef, useState } from 'react';
import { getTripWeather } from '../../api/tripWeather.js';

const temperature = value => typeof value === 'number' ? `${value} °C` : '—';

// Mounted only by the development editor, keyed to its saved version and account.
export default function TripWeatherPreview({ saved, ownerId, disabled }) {
  const [state, setState] = useState({ loading: false, result: null, error: null });
  const current = useRef(null);
  useEffect(() => () => { current.current?.abort(); current.current = null; }, []);
  async function refresh() {
    if (disabled || current.current) return;
    const controller = new AbortController(); current.current = controller;
    setState({ loading: true, result: null, error: null });
    let result;
    try { result = await getTripWeather({ draft: saved.draft, signal: controller.signal, expectedUserId: ownerId }); }
    catch { result = { ok: false, error: { message: 'Trip weather is unavailable. Please retry.' } }; }
    if (controller.signal.aborted || current.current !== controller) return;
    current.current = null;
    setState({ loading: false, result: result.ok ? result : null, error: result.ok ? null : result.error });
  }
  function cancel() {
    current.current?.abort(); current.current = null;
    setState({ loading: false, result: null, error: { code: 'CANCELLED', message: 'Weather request cancelled.' } });
  }
  return <section aria-label="Saved trip weather preview" className="space-y-2 border-t py-3">
    <h2>Saved trip weather: {saved.draft.title}</h2>
    <p>Weather uses the last saved trip. Unsaved edits are excluded.</p>
    <button type="button" disabled={disabled || state.loading} onClick={refresh}>Refresh weather</button>
    {state.loading && <><output className="block">Loading trip weather…</output><button type="button" onClick={cancel}>Cancel weather request</button></>}
    {state.error && (state.error.code === 'CANCELLED' ? <output className="block">{state.error.message}</output>
      : <p role="alert">{state.error.message}{state.error.retryAfter !== undefined && ` Try again in ${state.error.retryAfter} seconds.`}</p>)}
    {state.result && <>
      <p>{state.result.meta.partial ? 'Some dates could not be assessed. Refresh to retry.' : 'Weather assessment complete.'}
        {state.result.meta.mock && ' Local fixture weather.'}</p>
      <ol>{state.result.data.days.map(day => <li key={`${day.position}:${day.date}`} className="py-2">
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
