import { useRef } from 'react';
import { useAuth } from './auth/context.js';
import Header from './components/Header';
import MainView from './components/MainView';
import TripDashboard from './components/trip/TripDashboard.jsx';

function App() {
  const auth = useAuth();
  const myTripRef = useRef(null);
  // Reuse the shared control so the promotion follows its auth and navigation guards.
  const publicWeather = <MainView onPlanTrip={() => myTripRef.current?.click()} />;
  return (
    <div className="app-shell">
      {new URLSearchParams(window.location.search).get('account') === 'deleted' &&
        !auth.isAuthenticated && <output className="trip-notice">Account deleted.</output>}
      {auth.isAuthenticated ? (
        <TripDashboard
          key={auth.user.id}
          ownerId={auth.user.id}
          myTripRef={myTripRef}
          publicWeather={publicWeather}
        />
      ) : (
        <Header myTripRef={myTripRef}>
          <main>{publicWeather}</main>
        </Header>
      )}
    </div>
  );
}

export default App;
