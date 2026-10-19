import { useEffect, useRef, useState } from 'react';
import useSavedTrip from '../../hooks/useSavedTrip.js';
import useTripWeather from '../../hooks/useTripWeather.js';
import { coveredDayCount } from '../../../shared/trip.js';
import { formatCalendarDate } from '../../../shared/calendar.js';
import Header from '../Header.jsx';
import TripEmptyState from './TripEmptyState.jsx';
import TripEditor from './TripEditor.jsx';
import TripWeatherResults, { TripWeatherActions } from './TripWeatherResults.jsx';

const buttonClass = 'border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 disabled:opacity-50';

/** Mount only for an authenticated account, keyed by ownerId. Both lifecycles outlive view changes. */
export default function TripDashboard({ ownerId, publicWeather, myTripRef }) {
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
  const showEmpty = view === 'dashboard' && loaded && !saved && !busy && !error;
  const mutationPending = busy === 'saving' || busy === 'deleting';
  return <>
    <Header myTripRef={myTripRef} view={view} onNavigate={navigate} disabled={mutationPending} />
    <div hidden={view !== 'public'} ref={publicRegion} tabIndex={-1} aria-label="Single-city weather">{publicWeather}</div>
    <main hidden={view === 'public'} className={view === 'dashboard' ? `trip-dashboard${showEmpty ? ' trip-dashboard-empty' : ''}` : 'w-full max-w-5xl mx-auto p-4 md:p-6 space-y-4 break-words'}>
      {showEmpty && <p className="trip-empty-eyebrow">Personal itinerary · Your workspace</p>}
      <h2 ref={heading} tabIndex={-1} className="text-2xl font-bold">{view === 'editor' ? saved ? 'Edit Trip' : 'Create Trip' : 'My Trip'}</h2>
      {showEmpty && <p className="trip-empty-intro">Your saved multi-destination itinerary and weather throughout your journey.</p>}
      <p className={showEmpty ? 'sr-only' : undefined} role={error ? 'alert' : 'status'}>{message}</p>
      {!busy && (error || !loaded) && <button type="button" className={buttonClass} onClick={reload}>{loaded ? 'Reload saved trip' : 'Retry loading trip'}</button>}
      {loaded && view === 'editor' && <>
        <fieldset disabled={Boolean(busy)} className="min-w-0">
          <TripEditor key={version} initialDraft={saved?.draft} onSubmit={submit} onCancel={() => setView('dashboard')}
            submitLabel="Save Trip" submitMessage="" submitDisabled={blocked} />
        </fieldset>
        <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => navigate('dashboard')}>Back to My Trip</button>
      </>}
      {loaded && view === 'dashboard' && (!saved ? showEmpty && <TripEmptyState disabled={blocked} onCreate={() => setView('editor')} onWeatherSearch={() => navigate('public')} /> : <>
        <section aria-label="Saved trip overview" className="trip-overview">
          <p className="trip-eyebrow">Travel itinerary weather</p>
          <h3 className="trip-title">{saved.draft.title}</h3>
          <p>Arrival: {formatCalendarDate(saved.draft.startDate)} · Departure: {formatCalendarDate(saved.draft.endDate)}</p>
          <p>{coveredDayCount(saved.draft.startDate, saved.draft.endDate)} covered days · {saved.draft.destinations.length} destinations. Departure is excluded from weather days.</p>
          <div className="trip-actions">
            <button type="button" className="trip-button" disabled={Boolean(busy)} onClick={() => setView('editor')}>Edit Trip</button>
            <button type="button" className="trip-button trip-button-delete" disabled={Boolean(busy) || blocked} onClick={() => {
              if (window.confirm('Delete this saved trip? This also discards local edits.')) void remove();
            }}>Delete Trip</button>
            <TripWeatherActions weather={weather} disabled={Boolean(busy) || blocked} />
          </div>
        </section>
        <div className="trip-legend" aria-label="Forecast categories">
          <span className="trip-category trip-category-standard">Standard forecast</span>
          <span className="trip-category trip-category-long">Long-range estimate</span>
          <p>TripCast’s provisional eight-day policy; long-range estimates are less certain. These labels are not provider confidence ratings.</p>
        </div>
        <TripWeatherResults saved={saved} weather={weather} />
      </>)}
    </main>
  </>;
}
