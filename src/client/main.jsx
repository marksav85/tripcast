import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { WeatherProvider } from "./context/WeatherContextProvider";

import { AuthProvider } from "./context/AuthContextProvider.jsx";
import { lazy, Suspense } from "react";
const TripEditorPreview = import.meta.env.DEV ? lazy(() => import("./components/trip/TripEditorPreview.jsx")) : null;
import AuthPanel from "./components/auth/AuthPanel.jsx";

config.autoAddCss = false;

ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <AuthPanel />
    {import.meta.env.DEV && <Suspense fallback={<output>Loading local editor…</output>}><TripEditorPreview /></Suspense>}
    <WeatherProvider>
      <App />
    </WeatherProvider>
  </AuthProvider>
);
