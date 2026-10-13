// src/client/components/MainView.js
import { useRef, useEffect, useContext } from "react";
import WeatherContext from "../context/WeatherContextProvider";
import Destination from "./destination/Destination";
import Weather from "./weather/Weather";
import useReducedMotion from "../hooks/useReducedMotion";
const travelCamper = "/media/travel_camper.jpg";

// MainView component that displays Destination and Weather components
export default function MainView() {
  const { weather } = useContext(WeatherContext);
  const reducedMotion = useReducedMotion();
  const weatherRef = useRef(null);
  useEffect(() => {
    if (weather.status === 'success') {
      weatherRef.current?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }, [weather.status, weather.result, reducedMotion]);

  return (
    <div
      className="flex flex-col md:flex-row w-full h-full justify-center items-center space-y-6 md:space-y-0 md:space-x-6 p-6 bg-cover bg-center"
      // Apply a background image to the container and center it
      style={{ backgroundImage: `url(${travelCamper})` }}
    >
      {/* Render the Destination component */}
      <Destination />

      {/* Container for the Weather component */}
      {/* 
        The `w-full max-w-md` class ensures that the Weather component
        takes up the full width available but is constrained to a maximum width
        of `md`. Wrapping Weather in this div allows it to be styled without
        affecting its internal layout or width.
      */}
      <div className="w-full max-w-md" ref={weatherRef}>
        {/* Render the Weather component */}
        <Weather />
      </div>
    </div>
  );
}
