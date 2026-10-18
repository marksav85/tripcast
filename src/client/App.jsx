import { useAuth } from './auth/context.js';
import Header from './components/Header';
import MainView from './components/MainView';
import TripDashboard from './components/trip/TripDashboard.jsx';

function App() {
  const auth = useAuth();
  return (
    <div className="flex flex-col min-h-screen">
      <Header compact={auth.isAuthenticated} />
      {auth.isAuthenticated
        ? <TripDashboard key={auth.user.id} ownerId={auth.user.id} publicWeather={<MainView />} />
        : <main><MainView /></main>}
    </div>
  );
}

export default App;
