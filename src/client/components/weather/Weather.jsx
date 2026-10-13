import { useContext, useEffect, useRef } from 'react';
import Lottie from 'lottie-react';
import WeatherContext from '../../context/WeatherContextProvider';
import useReducedMotion from '../../hooks/useReducedMotion';
import { formatCalendarDate } from '../../lib/calendar';
import { locationLabel } from '../../lib/locations';
import travelAnimation from '../../../assets/travel-animation.json';
const raindropIcon = '/media/weather-icons/raindrop.svg';
const cloudyIcon = '/media/weather-icons/cloudy.svg';
const thermometerIcon = '/media/weather-icons/thermometers/thermometer.svg';

const temperature = (value) => value === null ? 'Unavailable' : `${Math.round(value)}°C`;

export default function Weather() {
  const { weather, retry } = useContext(WeatherContext);
  const reducedMotion = useReducedMotion();
  const { status, message, result } = weather;
  const headingRef = useRef(null);
  useEffect(() => {
    if (status === 'success' || status === 'unavailable') headingRef.current?.focus({ preventScroll: true });
  }, [status, result]);
  return (
    <section aria-label="Weather result" aria-busy={status === 'loading'}
      className="bg-white shadow-lg rounded-lg w-full max-w-md mx-auto min-h-[600px]">
      <div id="weather-header" className="bg-blue-500 text-white rounded-t-lg p-4 lg:p-6">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg md:text-xl lg:text-2xl font-semibold text-center">
          {result ? locationLabel(result.location) : 'Weather'}
        </h2>
      </div>
      <div className="p-6">
        <p role={status === 'error' ? 'alert' : 'status'} className="text-gray-700">
          {status === 'idle' ? 'Enter a city and date to see weather.' : message}
        </p>
        {status === 'loading' && !reducedMotion && (
          <div aria-hidden="true"><Lottie animationData={travelAnimation} loop autoplay /></div>
        )}
        {['error', 'empty', 'unavailable'].includes(status) && (
          <button type="button" onClick={retry} className="mt-4 p-2 bg-blue-500 text-white rounded-lg focus:ring-2 focus:ring-blue-500">Retry last lookup</button>
        )}
        {result && (
          <div id="weather-details" className="space-y-4 text-blue-700 font-semibold mt-4">
            <h3 className="text-lg md:text-xl lg:text-2xl">{formatCalendarDate(result.date)}</h3>
            <div className="flex items-center gap-4">
              <img src={thermometerIcon} className="w-20 h-20" alt="" />
              <dl><dt>High temperature</dt><dd>{temperature(result.highC)}</dd>
                <dt>Low temperature</dt><dd>{temperature(result.lowC)}</dd></dl>
            </div>
            <div className="flex items-center gap-4">
              <img src={cloudyIcon} className="w-20 h-20" alt="" />
              <dl><dt>Cloud cover (provider snapshot)</dt><dd>{result.cloudPercent === null ? 'Unavailable' : `${result.cloudPercent}%`}</dd></dl>
            </div>
            <div className="flex items-center gap-4">
              <img src={raindropIcon} className="w-20 h-20" alt="" />
              <dl><dt>Total precipitation (liquid-water equivalent)</dt><dd>{result.precipitationMm === null ? 'Unavailable' : `${result.precipitationMm} mm`}</dd></dl>
            </div>
            <p className="text-sm text-gray-700">Weather conditions: unavailable from this daily summary.</p>
            <p className="text-sm text-gray-700">{result.source}. Missing measurements are unavailable.</p>
          </div>
        )}
      </div>
    </section>
  );
}
