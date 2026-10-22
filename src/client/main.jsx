import { config } from '@fortawesome/fontawesome-svg-core';
import '@fortawesome/fontawesome-svg-core/styles.css';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { WeatherProvider } from './context/WeatherContextProvider';

import { AuthProvider } from './context/AuthContextProvider.jsx';
import { lazy, Suspense } from 'react';
const TripEditorPreview = import.meta.env.DEV
  ? lazy(() => import('./components/trip/TripEditorPreview.jsx'))
  : null;
import Header from './components/Header.jsx';
import MainView from './components/MainView.jsx';

config.autoAddCss = false;
// Mutually exclusive entry: the development preview never mounts alongside My Trip.
const previewMode =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('preview') === 'trip-editor';

ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <WeatherProvider>
      {previewMode ? (
        <>
          <Suspense fallback={<output>Loading local editor…</output>}>
            <TripEditorPreview />
          </Suspense>
          <Header />
          <MainView />
        </>
      ) : (
        <App />
      )}
    </WeatherProvider>
  </AuthProvider>,
);
