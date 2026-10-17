import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadMyTrip, saveMyTrip, deleteMyTrip } from '../api/trips.js';

const initial = () => ({ loaded: false, saved: null, version: 0, busy: 'loading',
  message: 'Loading saved trip…', error: null, blocked: false });

// Mutable request bookkeeping stays outside React's immutable state snapshots.
class TripSession {
  constructor(ownerId) { this.ownerId = ownerId; this.active = false; this.pending = false; this.creationId = null; this.value = initial(); }
  patch(value) { this.value = { ...this.value, ...value }; }
  activate(active) { this.active = active; }
  lock(pending) { this.pending = pending; }
  creation(id) { this.creationId = id; }
}

/** Account-scoped persistence. Confirmation belongs to the caller; successful actions return API results. */
export default function useSavedTrip(ownerId) {
  const session = useMemo(() => new TripSession(ownerId), [ownerId]);
  const [snapshot, setSnapshot] = useState(null);
  const state = snapshot?.session === session ? snapshot.value : session.value;
  const update = useCallback(patch => {
    session.patch(patch);
    setSnapshot({ session, value: session.value });
  }, [session]);
  const failed = useCallback(result => update({ error: result.error.code, message: result.error.message,
    blocked: session.value.blocked || ['CONFLICT', 'UNAUTHENTICATED'].includes(result.error.code) }), [session, update]);
  const load = useCallback(async () => {
    if (!ownerId || !session.active || session.pending) return;
    session.lock(true); update({ busy: 'loading', message: 'Loading saved trip…' });
    try {
      const result = await loadMyTrip();
      if (!session.active) return;
      if (!result.ok) failed(result);
      else {
        session.creation(null);
        update({ loaded: true, saved: result.data, version: session.value.version + 1, blocked: false, error: null,
          message: result.data ? 'Saved trip loaded.' : 'No saved trip. Create your first trip.' });
      }
      return result;
    } catch { if (session.active) update({ error: 'SERVICE_UNAVAILABLE', message: 'Trip storage is unavailable. Please try again.' }); }
    finally { if (session.active) { session.lock(false); update({ busy: null }); } }
  }, [ownerId, session, update, failed]);
  useEffect(() => {
    session.activate(true);
    Promise.resolve().then(load);
    return () => { session.activate(false); };
  }, [session, load]);

  async function save(draft) {
    if (!ownerId || !session.active || session.pending || session.value.blocked) return;
    session.lock(true); update({ busy: 'saving', message: 'Saving trip…' });
    try {
      const saved = session.value.saved;
      if (!saved && !session.creationId) session.creation(crypto.randomUUID());
      const result = await saveMyTrip({ tripId: saved?.id ?? session.creationId, expectedRevision: saved?.revision ?? 0, draft });
      if (!session.active) return;
      if (!result.ok) failed(result);
      else update({ loaded: true, saved: result.data, version: session.value.version + 1, blocked: false, error: null, message: 'Trip saved.' });
      return result;
    } catch { if (session.active) update({ error: 'SERVICE_UNAVAILABLE', message: 'Could not save your trip. Please try again.' }); }
    finally { if (session.active) { session.lock(false); update({ busy: null }); } }
  }
  async function remove() {
    if (!ownerId || !session.active || session.pending || !session.value.saved || session.value.blocked) return;
    session.lock(true); update({ busy: 'deleting', message: 'Deleting trip…' });
    try {
      const saved = session.value.saved;
      const result = await deleteMyTrip({ tripId: saved.id, expectedRevision: saved.revision });
      if (!session.active) return;
      if (!result.ok) failed(result);
      else {
        session.creation(null);
        update({ loaded: true, saved: null, version: session.value.version + 1, blocked: false, error: null,
          message: 'Trip deleted. You can create a new trip.' });
      }
      return result;
    } catch { if (session.active) update({ error: 'SERVICE_UNAVAILABLE', message: 'Could not delete your trip. Please try again.' }); }
    finally { if (session.active) { session.lock(false); update({ busy: null }); } }
  }
  return { ...state, load, save, remove };
}
