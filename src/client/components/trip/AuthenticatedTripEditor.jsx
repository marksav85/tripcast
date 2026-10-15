import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/context.js';
import { loadMyTrip, saveMyTrip, deleteMyTrip } from '../../api/trips.js';
import TripEditor from './TripEditor.jsx';

// Account-keyed mounting also hides the previous account's draft during render.
export default function AuthenticatedTripEditor({ onClose }) {
  const auth = useAuth();
  if (!auth.isAuthenticated) return <p>{auth.loading ? 'Restoring session…' : 'Sign in to access your saved trip.'}</p>;
  return <TripSession key={auth.user.id} onClose={onClose} />;
}

function TripSession({ onClose }) {
  const [state, setState] = useState({ loaded: false, saved: null, version: 0 });
  const [busy, setBusy] = useState('loading');
  const [message, setMessage] = useState('Loading saved trip…');
  const [error, setError] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const active = useRef(false);
  const pending = useRef(false);
  const creationId = useRef(null);

  const failed = useCallback((result) => {
    setError(result.error.code);
    if (['CONFLICT', 'UNAUTHENTICATED'].includes(result.error.code)) setBlocked(true);
    setMessage(result.error.message);
  }, []);
  const load = useCallback(async () => {
    if (!active.current || pending.current) return;
    pending.current = true; setBusy('loading'); setMessage('Loading saved trip…');
    try {
      const result = await loadMyTrip();
      if (!active.current) return;
      if (!result.ok) failed(result);
      else {
        creationId.current = null;
        setState(old => ({ loaded: true, saved: result.data, version: old.version + 1 }));
        setBlocked(false); setError(null); setMessage(result.data ? 'Saved trip loaded.' : 'No saved trip. Create your first trip.');
      }
    } catch { if (active.current) { setError('SERVICE_UNAVAILABLE'); setMessage('Trip storage is unavailable. Please try again.'); } }
    finally { if (active.current) { pending.current = false; setBusy(null); } }
  }, [failed]);
  useEffect(() => {
    active.current = true;
    // Defer startup so the initial loading state is rendered before the request.
    Promise.resolve().then(load);
    return () => { active.current = false; };
  }, [load]); // This session mounts once per account/open editor.

  async function save(draft) {
    if (pending.current || blocked) return;
    pending.current = true; setBusy('saving'); setMessage('Saving trip…');
    try {
      if (!state.saved && !creationId.current) creationId.current = crypto.randomUUID();
      const result = await saveMyTrip({ tripId: state.saved?.id ?? creationId.current,
        expectedRevision: state.saved?.revision ?? 0, draft });
      if (!active.current) return;
      if (!result.ok) failed(result);
      else {
        setState(old => ({ loaded: true, saved: result.data, version: old.version + 1 }));
        setBlocked(false); setError(null); setMessage('Trip saved.');
      }
    } catch { if (active.current) { setError('SERVICE_UNAVAILABLE'); setMessage('Could not save your trip. Please try again.'); } }
    finally { if (active.current) { pending.current = false; setBusy(null); } }
  }
  async function remove() {
    if (pending.current || !state.saved || blocked
      || !window.confirm('Delete this saved trip? This also discards local edits.')) return;
    pending.current = true; setBusy('deleting'); setMessage('Deleting trip…');
    try {
      const result = await deleteMyTrip({ tripId: state.saved.id, expectedRevision: state.saved.revision });
      if (!active.current) return;
      if (!result.ok) failed(result);
      else {
        creationId.current = null;
        setState(old => ({ loaded: true, saved: null, version: old.version + 1 }));
        setBlocked(false); setError(null); setMessage('Trip deleted. You can create a new trip.');
      }
    } catch { if (active.current) { setError('SERVICE_UNAVAILABLE'); setMessage('Could not delete your trip. Please try again.'); } }
    finally { if (active.current) { pending.current = false; setBusy(null); } }
  }
  return <section aria-label="Saved trip" className="space-y-3">
    <p>This editor saves trips to your Supabase account.</p>
    <p role={error ? 'alert' : 'status'}>{message}</p>
    {state.loaded && <fieldset disabled={Boolean(busy)} className="min-w-0">
      <TripEditor key={state.version} initialDraft={state.saved?.draft} onSubmit={save}
        submitLabel="Save Trip" submitMessage="" submitDisabled={blocked} />
      {state.saved && <button type="button" disabled={blocked} onClick={remove}>Delete Trip</button>}
    </fieldset>}
    {!busy && (error || !state.loaded) && <button type="button" onClick={() => {
      if (!state.loaded || window.confirm('Reload the saved trip? Your unsaved changes will be discarded.')) load();
    }}>{state.loaded ? 'Reload saved trip' : 'Retry loading trip'}</button>}
    <button type="button" onClick={onClose}>Close editor</button>
  </section>;
}
