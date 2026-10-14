import { useEffect, useState } from 'react';
import { AuthContext } from '../auth/context.js';
import { supabase, authConfigurationError } from '../api/supabase.js';

const safeError = 'Authentication could not be restored. Please try again later.';
export function AuthProvider({ children, client = supabase, configurationError = authConfigurationError }) {
  const [state, setState] = useState({ session: null, loading: Boolean(client), error: client ? null : configurationError });
  useEffect(() => {
    if (!client) return;
    let active = true;
    let changes = 0;
    let subscription;
    const fail = () => { if (active) setState({ session: null, loading: false, error: safeError }); };
    try {
      // Subscribe first. A later getSession result must not overwrite a newer auth event.
      subscription = client.auth.onAuthStateChange((event, session) => {
        if (!active) return;
        if (event !== 'INITIAL_SESSION') changes += 1;
        setState({ session: session ?? null, loading: false, error: null });
      }).data.subscription;
      const initialChanges = changes;
      Promise.resolve(client.auth.getSession()).then(({ data, error }) => {
        if (!active || changes !== initialChanges) return;
        if (error) fail();
        else setState({ session: data?.session ?? null, loading: false, error: null });
      }).catch(() => { if (changes === initialChanges) fail(); });
    } catch { fail(); }
    return () => { active = false; subscription?.unsubscribe(); };
  }, [client]);
  const session = client ? state.session : null;
  return <AuthContext.Provider value={{
    client, session, user: session?.user ?? null, loading: state.loading,
    status: !client ? 'unavailable' : state.loading ? 'loading' : state.error ? 'error' : session ? 'authenticated' : 'unauthenticated',
    isAuthenticated: Boolean(session?.user), error: state.error,
  }}>{children}</AuthContext.Provider>;
}
