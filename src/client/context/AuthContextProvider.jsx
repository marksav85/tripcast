import { useEffect, useState } from 'react';
import { AuthContext } from '../auth/context.js';
import { supabase, authConfigurationError } from '../api/supabase.js';

import { initialCallbackKind, handleAuthCallback } from '../auth/callback.js';

const safeError = 'Authentication could not be restored. Please try again later.';
export function AuthProvider({ children, client = supabase, configurationError = authConfigurationError }) {
  const [recoveryStatus, setRecoveryStatus] = useState(initialCallbackKind === 'recovery' ? 'pending' : initialCallbackKind === 'invalid' ? 'error' : null);
  const [callbackError, setCallbackError] = useState(null);
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
      handleAuthCallback(client).then((result) => {
        if (!active || !result) return;
        if (!result.ok) {
          changes += 1;
          setState({ session: null, loading: false, error: null });
          setCallbackError('This link is invalid or expired. Request a new email.');
          setRecoveryStatus('error');
        } else if (result.kind === 'recovery') setRecoveryStatus('ready');
      });
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
    recoveryStatus, callbackError, completeRecovery: () => setRecoveryStatus(null),
    client, session, user: session?.user ?? null, loading: state.loading,
    status: !client ? 'unavailable' : recoveryStatus ? 'recovery' : state.loading ? 'loading' : state.error ? 'error' : session ? 'authenticated' : 'unauthenticated',
    isAuthenticated: Boolean(session?.user) && !recoveryStatus, error: state.error,
  }}>{children}</AuthContext.Provider>;
}
