import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../../auth/context.js';
import { authRedirectUrl } from '../../auth/callback.js';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faEye,
  faEyeSlash,
  faSun,
  faCloudSun,
  faLocationDot,
  faArrowRight,
} from '@fortawesome/free-solid-svg-icons';
import DeleteAccountDialog from './DeleteAccountDialog.jsx';
import AuthAvailability from '../AuthAvailability.jsx';

const headings = {
  signin: 'Sign in',
  register: 'Create account',
  forgot: 'Forgot password',
  reset: 'Set new password',
};
const titles = {
  signin: 'Welcome back.',
  register: 'Your next journey starts here.',
  forgot: 'Reset your password.',
  reset: 'Choose a new password.',
};
const descriptions = {
  signin: 'Sign in to manage your trips and explore the weather along your journey.',
  register: 'Create an account to save your itinerary and check the weather along the way.',
  forgot: 'Enter your email and we’ll send a link to reset your password.',
  reset: 'Set a new password to complete your account recovery.',
};
const serviceError = 'Authentication service is unavailable. Please try again.';
function AuthForm({ mode, client, finish }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [invalidField, setInvalidField] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState('error');
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  const formRef = useRef(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function submit(event) {
    event.preventDefault();
    if (busy.current) return;
    setFeedback('error');
    setFeedbackTitle('Please try again');
    if (mode !== 'reset' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setInvalidField('email');
      setMessage('Enter a valid email address.');
      formRef.current?.querySelector('input[type="email"]')?.focus();
      return;
    }
    // Local Auth minimum is six characters, without additional composition rules.
    if (mode !== 'forgot' && password.length < (mode === 'signin' ? 1 : 6)) {
      setInvalidField('password');
      setMessage(mode === 'signin' ? 'Enter your password.' : 'Use at least 6 characters.');
      formRef.current?.querySelector('[name="password"]')?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    setMessage('');
    setInvalidField(null);
    try {
      let result;
      if (mode === 'signin')
        result = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (mode === 'register')
        result = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: authRedirectUrl() },
        });
      if (mode === 'forgot')
        result = await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: authRedirectUrl(),
        });
      if (mode === 'reset') result = await client.auth.updateUser({ password });
      if (!active.current) return;
      if (result.error) {
        const code = result.error.code;
        if (code === 'over_email_send_rate_limit' || result.error.status === 429) {
          setMessage(
            mode === 'register' || mode === 'forgot'
              ? 'Too many confirmation emails have been requested. Please try again later.'
              : 'Too many attempts. Please try again later.',
          );
        } else if (mode === 'register' && ['user_already_exists', 'email_exists'].includes(code)) {
          setFeedback('info');
          setFeedbackTitle('Check your account options');
          setMessage(
            'Registration could not be completed. Try signing in or requesting a password reset.',
          );
        } else if (mode === 'forgot' && ['user_not_found', 'email_not_found'].includes(code)) {
          setFeedback('info');
          setFeedbackTitle('Recovery request');
          setMessage('If an account can receive recovery email, check your inbox.');
        } else
          setMessage(
            ['email_address_invalid', 'email_address_not_authorized', 'validation_failed'].includes(
              code,
            )
              ? 'Check your email address and try again.'
              : ['weak_password', 'same_password'].includes(code)
                ? 'Choose a different password that meets the requirements.'
                : mode === 'signin' && ['invalid_credentials', 'email_not_confirmed'].includes(code)
                  ? 'Unable to sign in. Check your credentials and confirmation email.'
                  : result.error.name === 'AuthRetryableFetchError' || result.error.status === 0
                    ? 'Could not connect to authentication. Check your connection and try again.'
                    : serviceError,
          );
      } else {
        setPassword('');
        setVisible(false);
        setFeedback('success');
        if (mode === 'reset') finish('Password updated.');
        else {
          const inbox = mode === 'forgot' || (mode === 'register' && !result.data?.session);
          setFeedbackTitle(
            inbox ? 'Check your inbox' : mode === 'register' ? 'Account ready' : 'Signed in',
          );
          setMessage(
            mode === 'forgot'
              ? 'If an account can receive recovery email, follow the link in your inbox to reset your password.'
              : mode === 'register' && !result.data?.session
                ? "We've received your registration request. If a confirmation email is required, follow the link in your inbox to activate your account."
                : mode === 'register'
                  ? 'Account ready. You are signed in.'
                  : 'You are signed in.',
          );
        }
      }
    } catch {
      if (active.current) {
        setFeedback('error');
        setFeedbackTitle('Please try again');
        setMessage('Could not connect to authentication. Check your connection and try again.');
      }
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  useEffect(() => {
    formRef.current?.querySelector('input')?.focus();
  }, []);
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      className="auth-form"
      aria-label={headings[mode]}
      aria-busy={pending}
    >
      {mode !== 'reset' && (
        <div className="auth-field">
          <label htmlFor={id + '-email'}>Email</label>
          <input
            id={id + '-email'}
            className="auth-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (invalidField === 'email') setInvalidField(null);
            }}
            disabled={pending}
            required
            aria-invalid={invalidField === 'email'}
            aria-describedby={invalidField === 'email' ? id + '-message' : undefined}
          />
        </div>
      )}
      {mode !== 'forgot' && (
        <div className="auth-field">
          <label htmlFor={id + '-password'}>{mode === 'reset' ? 'New password' : 'Password'}</label>
          <div className="auth-password">
            <input
              id={id + '-password'}
              name="password"
              className="auth-input"
              type={visible ? 'text' : 'password'}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (invalidField === 'password') setInvalidField(null);
              }}
              disabled={pending}
              required
              aria-invalid={invalidField === 'password'}
              aria-describedby={
                [
                  mode !== 'signin' ? id + '-password-hint' : null,
                  invalidField === 'password' ? id + '-message' : null,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            />
            <button
              type="button"
              className="auth-password-toggle"
              aria-label={visible ? 'Hide password' : 'Show password'}
              aria-controls={id + '-password'}
              onClick={() => setVisible((value) => !value)}
              disabled={pending}
            >
              <FontAwesomeIcon icon={visible ? faEyeSlash : faEye} aria-hidden="true" />
            </button>
          </div>
          {mode !== 'signin' && (
            <p id={id + '-password-hint'} className="auth-field-hint">
              Use at least 6 characters.
            </p>
          )}
        </div>
      )}
      <button className="auth-button auth-button-primary" disabled={pending}>
        {pending ? 'Please wait…' : mode === 'forgot' ? 'Send Reset Link' : headings[mode]}
        <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
      </button>
      {message && (
        <output
          id={id + '-message'}
          className={`auth-feedback auth-feedback-${feedback}`}
          role={feedback === 'error' ? 'alert' : 'status'}
          aria-live={feedback === 'error' ? 'assertive' : 'polite'}
        >
          <strong className="auth-feedback-title">{feedbackTitle}</strong>
          <span>{message}</span>
          {feedback === 'success' && feedbackTitle === 'Check your inbox' && (
            <span className="auth-feedback-hint">
              If you don’t see an email, check your spam or junk folder.
            </span>
          )}
        </output>
      )}
    </form>
  );
}

export default function AuthPanel({
  view: controlledView,
  onViewChange,
  onWeatherSearch,
  renderHeader,
  children,
}) {
  const {
    client,
    user,
    loading,
    recoveryStatus,
    callbackError,
    completeRecovery,
    clearDeletedAccount,
  } = useAuth();
  const [localView, setLocalView] = useState(null);
  const view = controlledView === undefined ? localView : controlledView;
  const setView = onViewChange ?? setLocalView;
  const [message, setMessage] = useState('');
  const [recoveryHidden, setRecoveryHidden] = useState(false);
  const stageHeading = useRef(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const logoutBusy = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function signOut() {
    if (logoutBusy.current) return;
    logoutBusy.current = true;
    setSigningOut(true);
    setMessage('');
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (active.current) {
        setMessage(error ? serviceError : 'Signed out.');
        if (!error) {
          completeRecovery();
          setView(null);
        }
      }
    } catch {
      if (active.current) setMessage(serviceError);
    } finally {
      logoutBusy.current = false;
      if (active.current) setSigningOut(false);
    }
  }
  const mode = recoveryStatus === 'ready' ? 'reset' : view;
  const showCard = Boolean(client) && (recoveryStatus ? !recoveryHidden : Boolean(mode) && !user);
  useEffect(() => {
    if (showCard && ['pending', 'error'].includes(recoveryStatus)) stageHeading.current?.focus();
  }, [showCard, recoveryStatus]);
  function weatherSearch() {
    if (recoveryStatus) setRecoveryHidden(true);
    if (onWeatherSearch) onWeatherSearch();
    else setView(null);
  }
  const controls = (
    <section aria-label="Account" className="shell-account">
      {!client ? (
        <AuthAvailability />
      ) : recoveryStatus ? (
        !showCard && (
          <button type="button" className="shell-action" onClick={() => setRecoveryHidden(false)}>
            Continue account recovery
          </button>
        )
      ) : user ? (
        <div className="shell-account-controls">
          <span className="shell-account-name" title={user.email}>
            Signed in as {user.email ?? 'your account'}
          </span>
          <button
            className="shell-action"
            onClick={signOut}
            disabled={signingOut || deletingAccount}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : loading ? (
        <output>Restoring session…</output>
      ) : (
        <nav hidden={showCard} aria-label="Authentication" className="shell-auth-actions">
          <button className="shell-action" onClick={(event) => setView('signin', event)}>
            Sign in
          </button>
          <button className="shell-action" onClick={(event) => setView('register', event)}>
            Create account
          </button>
          <button className="shell-recovery-action" onClick={(event) => setView('forgot', event)}>
            Forgot password
          </button>
        </nav>
      )}
      <output hidden={!message} className="shell-account-message" aria-live="polite">
        {message}
      </output>
    </section>
  );
  return (
    <>
      {renderHeader ? renderHeader(controls) : controls}
      {showCard && (
        <main className="auth-stage" aria-label="Authentication">
          <div className="auth-journey" aria-hidden="true">
            <span>
              <FontAwesomeIcon icon={faSun} />
              <span>Departure</span>
            </span>
            <span className="auth-journey-track">······</span>
            <span>
              <FontAwesomeIcon icon={faCloudSun} />
              <span>En route</span>
            </span>
            <span className="auth-journey-track">······</span>
            <span>
              <FontAwesomeIcon icon={faLocationDot} />
              <span>Arrival</span>
            </span>
          </div>
          <div className="auth-card">
            {!recoveryStatus && ['signin', 'register'].includes(mode) && (
              <fieldset className="auth-mode-switch" aria-label="Account mode">
                <button
                  type="button"
                  aria-pressed={mode === 'signin'}
                  onClick={() => setView('signin')}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'register'}
                  onClick={() => setView('register')}
                >
                  Create account
                </button>
              </fieldset>
            )}
            <p className="auth-eyebrow">Personal trips · TripCast account</p>
            <h2 ref={stageHeading} tabIndex={-1}>
              {recoveryStatus === 'pending'
                ? 'Checking your recovery link.'
                : recoveryStatus === 'error'
                  ? 'Let’s get you a new link.'
                  : titles[mode]}
            </h2>
            {recoveryStatus === 'pending' ? (
              <output className="auth-recovery-message" aria-live="polite">
                Checking recovery link…
              </output>
            ) : recoveryStatus === 'error' ? (
              <>
                <output className="auth-recovery-message" aria-live="polite">
                  {callbackError ?? 'This link is invalid or expired. Request a new email.'}
                </output>
                <p className="auth-description">
                  If you have already verified your account, you can return home and sign in
                  normally.
                </p>
                <a className="auth-button" href="/">
                  Back to home
                </a>
                <button
                  className="auth-button auth-button-primary"
                  onClick={() => {
                    completeRecovery();
                    setView('forgot');
                  }}
                >
                  Request another recovery email
                </button>
              </>
            ) : (
              <>
                <p className="auth-description">{descriptions[mode]}</p>
                <AuthForm
                  key={mode + (user?.id ?? '')}
                  mode={mode}
                  client={client}
                  finish={(text) => {
                    completeRecovery();
                    setView(null);
                    setMessage(text);
                  }}
                />
                <div className="auth-secondary-actions">
                  {mode === 'signin' && (
                    <button
                      type="button"
                      className="auth-text-button"
                      onClick={() => setView('forgot')}
                    >
                      Forgot password
                    </button>
                  )}
                  {mode === 'forgot' && (
                    <button
                      type="button"
                      className="auth-text-button"
                      onClick={() => setView('signin')}
                    >
                      Back to Sign In
                    </button>
                  )}
                  {mode !== 'reset' && (
                    <button
                      type="button"
                      className="auth-text-button"
                      onClick={() => setView(null)}
                    >
                      Close
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          <aside className="auth-weather-access" aria-label="Public weather access">
            <div>
              <h3>Just checking the weather?</h3>
              <p>Search a city without signing in.</p>
            </div>
            <button type="button" className="auth-button" onClick={weatherSearch}>
              Weather Search <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
            </button>
          </aside>
        </main>
      )}
      {children && <div hidden={showCard}>{children}</div>}
      {client && user && !recoveryStatus && !showCard && (
        <section className="account-management" aria-labelledby="account-management-title">
          <h2 id="account-management-title">Account management</h2>
          <p>Permanently delete your account and saved trip data.</p>
          <DeleteAccountDialog
            clearState={clearDeletedAccount}
            client={client}
            disabled={signingOut}
            onBusyChange={setDeletingAccount}
          />
        </section>
      )}
    </>
  );
}
