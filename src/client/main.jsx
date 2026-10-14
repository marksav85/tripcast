import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { WeatherProvider } from "./context/WeatherContextProvider";

import { AuthProvider } from "./context/AuthContextProvider.jsx";
import AuthPanel from "./components/auth/AuthPanel.jsx";

config.autoAddCss = false;

ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <AuthPanel />
    <WeatherProvider>
      <App />
    </WeatherProvider>
  </AuthProvider>
);
