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
            <button
              type="button"
              className="shell-brand"
              disabled={disabled}
              onClick={(event) => navigate('public', event)}
              aria-label="TripCast — Weather Search"
            >
              <span className="shell-brand-icon" aria-hidden="true">
                ✧
              </span>
              <span>TripCast</span>
            </button>
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
