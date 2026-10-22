import { useRef, useEffect, useContext } from 'react';
import WeatherContext from '../context/WeatherContextProvider';
import Destination from './destination/Destination';
import Weather from './weather/Weather';
import useReducedMotion from '../hooks/useReducedMotion';

export default function MainView({ onPlanTrip }) {
  const { weather } = useContext(WeatherContext);
  const reducedMotion = useReducedMotion();
  const weatherRef = useRef(null);
  useEffect(() => {
    if (weather.status === 'success') {
      weatherRef.current?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }, [weather.status, weather.result, reducedMotion]);

  return (
    <div className="public-home">
      <section className="home-hero" aria-labelledby="home-title">
        <p className="home-eyebrow">Public weather search</p>
        <h1 id="home-title">Your journey, your weather.</h1>
        <p>
          Check the weather at your next destination. Choose a city and travel date to start
          planning your journey.
        </p>
      </section>
      <Destination />
      <div ref={weatherRef} className="home-results">
        <Weather />
      </div>
      {onPlanTrip && (
        <section className="home-trip-promotion" aria-labelledby="home-trip-title">
          <div>
            <p className="home-eyebrow">Multi-destination planning</p>
            <h2 id="home-trip-title">Exploring more than one destination?</h2>
            <p>Save an itinerary and check the weather throughout your journey.</p>
          </div>
          <button type="button" className="home-button home-button-secondary" onClick={onPlanTrip}>
            Plan a Trip <span aria-hidden="true">→</span>
          </button>
        </section>
      )}
    </div>
  );
}
