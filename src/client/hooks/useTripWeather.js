import { useEffect, useMemo, useState } from 'react';
import { getTripWeather } from '../api/tripWeather.js';

const empty = () => ({ loading: false, result: null, error: null });

class WeatherSession {
  constructor(saved, ownerId, version) { this.saved = saved; this.ownerId = ownerId; this.version = version; this.active = false; this.controller = null; this.value = empty(); }
  replace(value) { this.value = value; }
  activate(active) { this.active = active; }
  request(controller) { this.controller = controller; }
}

/** Explicit, memory-only weather for one account and canonical saved baseline.
 * Pass useSavedTrip's version to invalidate even a reload returning the same object.
 */
export default function useTripWeather({ saved, ownerId, disabled = false, version = 0 }) {
  const session = useMemo(() => new WeatherSession(saved, ownerId, version), [saved, ownerId, version]);
  const [snapshot, setSnapshot] = useState(null);
  const state = snapshot?.session === session ? snapshot.value : session.value;
  function update(value) {
    session.replace(value); setSnapshot({ session, value });
  }
  useEffect(() => {
    session.activate(true);
    return () => { session.activate(false); session.controller?.abort(); session.request(null); };
  }, [session]);
  async function refresh() {
    if (!saved || !ownerId || disabled || !session.active || session.controller) return;
    const controller = new AbortController(); session.request(controller);
    update({ loading: true, result: null, error: null });
    let result;
    try { result = await getTripWeather({ draft: saved.draft, signal: controller.signal, expectedUserId: ownerId }); }
    catch { result = { ok: false, error: { message: 'Trip weather is unavailable. Please retry.' } }; }
    if (!session.active || controller.signal.aborted || session.controller !== controller) return;
    session.request(null);
    update({ loading: false, result: result.ok ? result : null, error: result.ok ? null : result.error });
  }
  function cancel() {
    if (!session.active) return;
    session.controller?.abort(); session.request(null);
    update({ loading: false, result: null, error: { code: 'CANCELLED', message: 'Weather request cancelled.' } });
  }
  return { ...state, refresh, cancel };
}
