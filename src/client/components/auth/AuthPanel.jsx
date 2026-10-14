import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/context.js';
import { authRedirectUrl } from '../../auth/callback.js';
import AuthAvailability from '../AuthAvailability.jsx';

const headings = { signin: 'Sign in', register: 'Create account', forgot: 'Forgot password', reset: 'Set new password' };
const serviceError = 'Authentication service is unavailable. Please try again.';
function AuthForm({ mode, client, finish }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [message, setMessage] = useState(''); const [pending, setPending] = useState(false);
  const busy = useRef(false); const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function submit(event) {
    event.preventDefault(); if (busy.current) return;
    if (mode !== 'reset' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setMessage('Enter a valid email address.'); return; }
    // Local Auth minimum is six characters, without additional composition rules.
    if (mode !== 'forgot' && password.length < (mode === 'signin' ? 1 : 6)) { setMessage(mode === 'signin' ? 'Enter your password.' : 'Use at least 6 characters.'); return; }
    busy.current = true; setPending(true); setMessage('');
    try {
      let result;
      if (mode === 'signin') result = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (mode === 'register') result = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirectUrl() } });
      if (mode === 'forgot') result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirectUrl() });
      if (mode === 'reset') result = await client.auth.updateUser({ password });
      if (!active.current) return;
      if (result.error) {
        const code = result.error.code;
        setMessage(mode === 'forgot' && ['user_not_found', 'email_not_found'].includes(code) ? 'If an account can receive recovery email, check your inbox.'
          : mode === 'signin' && ['invalid_credentials', 'email_not_confirmed'].includes(code) ? 'Unable to sign in. Check your credentials and confirmation email.'
          : mode === 'register' && ['user_already_exists', 'email_exists'].includes(code) ? 'Check your email, or try signing in or resetting your password.'
          : mode === 'reset' && ['same_password', 'weak_password'].includes(code) ? 'Choose a different password that meets the requirements.' : serviceError);
      } else {
        setPassword('');
        if (mode === 'reset') finish('Password updated.');
        else setMessage(mode === 'forgot' ? 'If an account can receive recovery email, check your inbox.'
          : mode === 'register' && !result.data?.session ? 'Check your email to confirm your account, or try signing in.'
          : mode === 'register' ? 'Account ready. You are signed in.' : 'You are signed in.');
      }
    } catch { if (active.current) setMessage(serviceError); }
    finally { busy.current = false; if (active.current) setPending(false); }
  }
  return <form onSubmit={submit} noValidate className="space-y-3" aria-label={headings[mode]}>
    {mode !== 'reset' && <div><label htmlFor="auth-email">Email</label><input id="auth-email" className="border rounded p-2 w-full" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} required /></div>}
    {mode !== 'forgot' && <div><label htmlFor="auth-password">{mode === 'reset' ? 'New password' : 'Password'}</label><input id="auth-password" className="border rounded p-2 w-full" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} disabled={pending} required />{mode !== 'signin' && <p>Use at least 6 characters.</p>}</div>}
    <button className="bg-blue-600 text-white rounded px-4 py-2" disabled={pending}>{pending ? 'Please wait…' : headings[mode]}</button>
    <output className="block" aria-live="polite">{message}</output>
  </form>;
}
export default function AuthPanel() {
  const { client, user, loading, recoveryStatus, callbackError, completeRecovery } = useAuth();
  const [view, setView] = useState(null); const [message, setMessage] = useState('');
  const [signingOut, setSigningOut] = useState(false); const logoutBusy = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function signOut() {
    if (logoutBusy.current) return; logoutBusy.current = true; setSigningOut(true); setMessage('');
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (active.current) { setMessage(error ? serviceError : 'Signed out.'); if (!error) { completeRecovery(); setView(null); } }
    } catch { if (active.current) setMessage(serviceError); }
    finally { logoutBusy.current = false; if (active.current) setSigningOut(false); }
  }
  if (!client) return <AuthAvailability />;
  const mode = recoveryStatus === 'ready' ? 'reset' : view;
  return <section aria-label="Account" className="p-4 bg-white border-b">
    {recoveryStatus === 'pending' ? <output>Checking recovery link…</output>
      : recoveryStatus === 'error' ? <><output>{callbackError ?? 'This link is invalid or expired. Request a new email.'}</output><button className="ml-3 underline" onClick={() => { completeRecovery(); setView('forgot'); }}>Request another recovery email</button></>
      : <>
        {user && !recoveryStatus ? <div>Signed in as {user.email ?? 'your account'}. <button className="underline" onClick={signOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button></div>
          : !loading && <nav aria-label="Authentication"><button className="mr-4 underline" onClick={() => setView('signin')}>Sign in</button><button className="mr-4 underline" onClick={() => setView('register')}>Create account</button><button className="underline" onClick={() => setView('forgot')}>Forgot password</button></nav>}
        {loading && !recoveryStatus && <output>Restoring session…</output>}
        {mode && (!user || mode === 'reset') && <div className="max-w-md mx-auto my-4"><h2 className="text-xl font-bold mb-3">{headings[mode]}</h2><AuthForm key={mode + (user?.id ?? '')} mode={mode} client={client} finish={(text) => { completeRecovery(); setView(null); setMessage(text); }} />{mode !== 'reset' && <button className="mt-3 underline" onClick={() => setView(null)}>Close</button>}</div>}
      </>}
    <output className="block">{message}</output>
  </section>;
}
