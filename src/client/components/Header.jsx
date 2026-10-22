import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/context.js';
import AuthPanel from './auth/AuthPanel.jsx';

export default function Header({
  view = 'public',
  onNavigate = () => {},
  disabled = false,
  myTripRef,
  children,
}) {
  const { isAuthenticated, loading } = useAuth();
  const [authView, setAuthView] = useState(null);
  const trigger = useRef(null);
  const weatherButton = useRef(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!authView && restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [authView]);
  function changeAuthView(next, event) {
    if (next && event) trigger.current = event.currentTarget;
    setAuthView(next);
    if (!next) restoreFocus.current = true;
  }
  function navigate(next, event) {
    if (next === 'dashboard' && !isAuthenticated) {
      trigger.current = event.currentTarget;
      setAuthView('signin');
    } else {
      onNavigate(next);
      setAuthView(null);
    }
  }
  return (
    <AuthPanel
      view={authView}
      onViewChange={changeAuthView}
      onWeatherSearch={() => {
        navigate('public');
        weatherButton.current?.focus();
      }}
      renderHeader={(accountControls) => (
        <header className="shell-header">
          <div className="shell-bar">
            <a
              href="/"
              className="shell-brand"
              onClick={(event) => {
                if (
                  isAuthenticated &&
                  window.location.pathname === '/' &&
                  !window.location.search &&
                  !window.location.hash &&
                  event.button === 0 &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  if (!disabled) navigate('public', event);
                }
              }}
              aria-label="TripCast — Home"
            >
              <img
                className="shell-brand-logo"
                src="/media/brand--logo.webp"
                alt="TripCast"
                width="1440"
                height="506"
              />
            </a>
            <nav aria-label="Weather and trip" className="shell-navigation">
              <button
                ref={weatherButton}
                type="button"
                aria-current={view === 'public' ? 'page' : undefined}
                disabled={disabled}
                onClick={(event) => navigate('public', event)}
              >
                Weather Search
              </button>
              <button
                ref={myTripRef}
                type="button"
                aria-current={view !== 'public' ? 'page' : undefined}
                disabled={disabled || loading}
                onClick={(event) => navigate('dashboard', event)}
              >
                My Trip
              </button>
            </nav>
            {accountControls}
          </div>
        </header>
      )}
    >
      {children}
    </AuthPanel>
  );
}
