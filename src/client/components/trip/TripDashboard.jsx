import { useEffect, useRef, useState } from 'react';
import useSavedTrip from '../../hooks/useSavedTrip.js';
import useTripWeather from '../../hooks/useTripWeather.js';
import { addCalendarDays, coveredDayCount } from '../../../shared/trip.js';
import { formatCalendarDate } from '../../../shared/calendar.js';
import TripEditor from './TripEditor.jsx';
import TripWeatherResults from './TripWeatherResults.jsx';

const buttonClass = 'border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 disabled:opacity-50';

/** Mount only for an authenticated account, keyed by ownerId. Both lifecycles outlive view changes. */
export default function TripDashboard({ ownerId, publicWeather }) {
  const trip = useSavedTrip(ownerId);
  const { loaded, saved, version, busy, message, error, blocked, load, save, remove } = trip;
  const weather = useTripWeather({ saved, ownerId, version, disabled: Boolean(busy) || blocked });
  const [view, setView] = useState('public');
  const heading = useRef(null);
  const publicRegion = useRef(null);
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (view === 'public') publicRegion.current?.focus(); else heading.current?.focus();
  }, [view]);

  function navigate(next) {
    if (next === view || busy === 'saving' || busy === 'deleting') return;
    if (view === 'editor' && !window.confirm('Leave the editor without saving your changes?')) return;
    setView(next);
  }
  async function submit(draft) {
    const result = await save(draft);
    if (active.current && result?.ok) setView('dashboard');
  }
  function reload() {
    if (!loaded || window.confirm('Reload the saved trip? Your unsaved changes will be discarded.')) void load();
  }
  const mutationPending = busy === 'saving' || busy === 'deleting';
  return <>
    <nav aria-label="Weather and trip" className="flex flex-wrap gap-3 p-4 border-b bg-white">
      <button type="button" className={buttonClass} aria-current={view === 'public' ? 'page' : undefined} disabled={mutationPending} onClick={() => navigate('public')}>Single-city weather</button>
      <button type="button" className={buttonClass} aria-current={view !== 'public' ? 'page' : undefined} disabled={mutationPending} onClick={() => navigate('dashboard')}>My Trip</button>
    </nav>
    <div hidden={view !== 'public'} ref={publicRegion} tabIndex={-1} aria-label="Single-city weather">{publicWeather}</div>
    <main hidden={view === 'public'} className="w-full max-w-5xl mx-auto p-4 md:p-6 space-y-4 break-words">
      <h2 ref={heading} tabIndex={-1} className="text-2xl font-bold">{view === 'editor' ? saved ? 'Edit Trip' : 'Create Trip' : 'My Trip'}</h2>
      <p role={error ? 'alert' : 'status'}>{message}</p>
      {!busy && (error || !loaded) && <button type="button" className={buttonClass} onClick={reload}>{loaded ? 'Reload saved trip' : 'Retry loading trip'}</button>}
      {loaded && view === 'editor' && <>
        <fieldset disabled={Boolean(busy)} className="min-w-0">
          <TripEditor key={version} initialDraft={saved?.draft} onSubmit={submit} onCancel={() => setView('dashboard')}
            submitLabel="Save Trip" submitMessage="" submitDisabled={blocked} />
        </fieldset>
        <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => navigate('dashboard')}>Back to My Trip</button>
      </>}
      {loaded && view === 'dashboard' && (!saved ? <section aria-label="No saved trip" className="space-y-3">
        <h3 className="text-xl font-semibold">Plan your first trip</h3>
        <p>You can save one trip at a time, with up to eight destinations and 42 weather days.</p>
        <button type="button" className={buttonClass} disabled={Boolean(busy) || blocked} onClick={() => setView('editor')}>Create Trip</button>
      </section> : <>
        <section aria-label="Saved trip overview" className="space-y-3">
          <h3 className="text-xl font-semibold">{saved.draft.title}</h3>
          <p>Arrival: {formatCalendarDate(saved.draft.startDate)} · Departure: {formatCalendarDate(saved.draft.endDate)}</p>
          <p>{coveredDayCount(saved.draft.startDate, saved.draft.endDate)} covered days · {saved.draft.destinations.length} destinations. Departure is excluded from weather days.</p>
          <ol className="list-decimal pl-6 space-y-2">{saved.draft.destinations.map(destination => <li key={destination.position}>
            <span className="font-semibold">{destination.cityName}, {destination.countryCode}</span>
            <p>Weather dates: {formatCalendarDate(destination.arrivalDate)} – {formatCalendarDate(addCalendarDays(destination.departureDate, -1))}</p>
          </li>)}</ol>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => setView('editor')}>Edit Trip</button>
            <button type="button" className={buttonClass} disabled={Boolean(busy) || blocked} onClick={() => {
              if (window.confirm('Delete this saved trip? This also discards local edits.')) void remove();
            }}>Delete Trip</button>
          </div>
        </section>
        <TripWeatherResults saved={saved} weather={weather} disabled={Boolean(busy) || blocked} />
      </>)}
    </main>
  </>;
}
