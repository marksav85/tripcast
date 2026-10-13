import { useContext, useEffect, useRef } from 'react';
import WeatherContext from '../../context/WeatherContextProvider';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLocationCrosshairs, faCalendarWeek } from '@fortawesome/free-solid-svg-icons';
import { locationLabel } from '../../lib/locations';

export default function Destination() {
  const {
    city, date, changeCity, changeDate, fieldErrors, selectedLocation,
    submit, resetAll, setToday, handleUseCurrentLocation, weather, geolocation,
  } = useContext(WeatherContext);
  const cityRef = useRef(null);
  const dateRef = useRef(null);
  const candidateRef = useRef(null);
  useEffect(() => {
    if (weather.status === 'selecting') candidateRef.current?.focus();
  }, [weather.status]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const errors = submit();
    if (errors.city) cityRef.current?.focus();
    else if (errors.date) dateRef.current?.focus();
  };
  const handleReset = () => { resetAll(); cityRef.current?.focus(); };
  const inputClass = 'w-full text-sm lg:text-base p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div id="destination-container" className="bg-white shadow-lg rounded-lg w-full max-w-md flex flex-col min-h-[600px]">
      <div id="destination-header" className="bg-blue-500 text-white rounded-t-lg flex-shrink-0 p-4 lg:p-6">
        <h2 className="text-lg md:text-xl lg:text-2xl font-semibold">Destination</h2>
      </div>
      <div id="destination-form-container" className="flex flex-col flex-grow">
        <div id="form-content" className="flex-grow flex items-center justify-center">
          <div className="w-full max-w-md p-4">
            <form onSubmit={handleSubmit} noValidate className="flex flex-col space-y-4">
              <div>
                <label htmlFor="city" className="block text-sm lg:text-base font-medium text-gray-700 mb-1">City:</label>
                <div className="flex">
                  <input ref={cityRef} id="city" type="text" name="city" value={city}
                    onChange={(event) => changeCity(event.target.value)} className={inputClass}
                    placeholder="Destination e.g., Berlin" required maxLength={100}
                    aria-invalid={Boolean(fieldErrors.city)} aria-describedby={fieldErrors.city ? 'city-error' : undefined} />
                  <button type="button" onClick={handleUseCurrentLocation} className="ml-2 mr-2"
                    aria-label="Use current location" disabled={geolocation.status === 'loading'}>
                    <FontAwesomeIcon icon={faLocationCrosshairs} />
                  </button>
                </div>
                {fieldErrors.city && <p id="city-error" role="alert" className="text-red-700 text-sm">{fieldErrors.city}</p>}
              </div>
              <div>
                <label htmlFor="travel-date" className="block text-sm lg:text-base md:mt-4 font-medium text-gray-700 mb-1">Date of travel:</label>
                <div className="flex">
                  <input ref={dateRef} type="date" id="travel-date" name="travel-date" value={date}
                    onChange={(event) => changeDate(event.target.value)} required className={inputClass}
                    aria-invalid={Boolean(fieldErrors.date)} aria-describedby={fieldErrors.date ? 'date-error' : undefined} />
                  <button type="button" onClick={setToday} className="ml-2 mr-2" aria-label="Use today's date">
                    <FontAwesomeIcon icon={faCalendarWeek} />
                  </button>
                </div>
                {fieldErrors.date && <p id="date-error" role="alert" className="text-red-700 text-sm">{fieldErrors.date}</p>}
              </div>
              <output className="block text-sm text-gray-700" aria-live="polite">{geolocation.message}</output>
              {weather.status === 'selecting' && (
                <fieldset className="space-y-2">
                  <legend>Choose a city:</legend>
                  {weather.candidates.map((candidate, index) => (
                    <button ref={index === 0 ? candidateRef : undefined} key={candidate.id} type="button"
                      onClick={() => weather.chooseCity(candidate)}
                      className="block w-full p-2 border border-blue-500 rounded-lg text-left focus:ring-2 focus:ring-blue-500">
                      {locationLabel(candidate)}
                    </button>
                  ))}
                </fieldset>
              )}
              {selectedLocation && <p className="text-sm text-gray-700">Selected: {locationLabel(selectedLocation)}</p>}
              <button type="submit" disabled={weather.status === 'loading'}
                className="w-full bg-blue-500 text-white text-sm lg:text-base md:mt-2 lg:mt-4 p-2 rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60">
                {weather.status === 'loading' ? 'Loading…' : 'Submit'}
              </button>
              <button type="button" onClick={handleReset}
                className="w-full bg-red-500 text-white text-sm lg:text-base md:mt-2 lg:mt-4 p-2 rounded-lg hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500">Reset</button>
            </form>
          </div>
        </div>
        <div id="destination-footer" className="bg-gray-100 p-2 rounded-b-lg text-start text-sm text-gray-600 md:p-3 lg:p-4">
          <p>Weather availability depends on the selected date and provider access.</p>
          <p>High/low temperatures and total precipitation are daily values. Cloud cover is a provider snapshot.</p>
          <p>Missing values are shown as unavailable. A daily summary does not identify rain or snow conditions.</p>
        </div>
      </div>
    </div>
  );
}
