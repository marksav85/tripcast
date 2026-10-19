import { useRef } from 'react';
import DeleteTripDialog from './DeleteTripDialog.jsx';
import { useAuth } from '../../auth/context.js';
import useSavedTrip from '../../hooks/useSavedTrip.js';
import TripEditor from './TripEditor.jsx';
import { TripWeatherPreviewView } from './TripWeatherPreview.jsx';
import useTripWeather from '../../hooks/useTripWeather.js';

// Account-keyed mounting also hides the previous account's draft during render.
export default function AuthenticatedTripEditor({ onClose }) {
  const auth = useAuth();
  if (!auth.isAuthenticated) return <p>{auth.loading ? 'Restoring session…' : 'Sign in to access your saved trip.'}</p>;
  return <TripSession key={auth.user.id} onClose={onClose} />;
}

function TripSession({ onClose }) {
  const region = useRef(null);
  const auth = useAuth();
  const { loaded, saved, version, busy, message, error, blocked, load, save, remove } = useSavedTrip(auth.user.id);
  const weather = useTripWeather({ saved, ownerId: auth.user.id, version, disabled: Boolean(busy) || blocked });
  return <section ref={region} aria-label="Saved trip" className="space-y-3">
    <p>This editor saves trips to your Supabase account.</p>
    <p role={error ? 'alert' : 'status'}>{message}</p>
    {loaded && <fieldset disabled={Boolean(busy)} className="min-w-0">
      <TripEditor disabled={Boolean(busy)} key={version} initialDraft={saved?.draft} onSubmit={save}
        submitLabel="Save Trip" submitMessage="" submitDisabled={blocked} />
      {saved && <DeleteTripDialog title={saved.draft.title} disabled={Boolean(busy) || blocked} onConfirm={remove}
        errorMessage={error ? message : null} onDeletedFocus={() => region.current?.querySelector('input')?.focus()} />}
    </fieldset>}
    {saved && <TripWeatherPreviewView saved={saved} weather={weather} disabled={Boolean(busy) || blocked} />}
    {!busy && (error || !loaded) && <button type="button" onClick={() => {
      if (!loaded || window.confirm('Reload the saved trip? Your unsaved changes will be discarded.')) load();
    }}>{loaded ? 'Reload saved trip' : 'Retry loading trip'}</button>}
    <button type="button" onClick={onClose}>Close editor</button>
  </section>;
}
