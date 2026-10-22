import { useContext, useEffect, useRef, useState } from 'react';
import WeatherContext from '../../context/WeatherContextProvider';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLocationCrosshairs } from '@fortawesome/free-solid-svg-icons';
import { DatePicker } from '../ui/date-picker';
import { locationLabel } from '../../lib/locations';

export default function Destination() {
  const {
    city,
    date,
    changeCity,
    changeDate,
    fieldErrors,
    selectedLocation,
    submit,
    resetAll,
    handleUseCurrentLocation,
    weather,
    geolocation,
  } = useContext(WeatherContext);
  const cityRef = useRef(null);
  const dateRef = useRef(null);
  // Reset also discards an unfinished draft when its canonical value is already empty.
  const [dateResetKey, setDateResetKey] = useState(0);
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
  const handleReset = () => {
    resetAll();
    setDateResetKey((key) => key + 1);
    cityRef.current?.focus();
  };
  const inputClass = 'home-input';

  return (
    <section
      id="destination-container"
      className="home-search-card"
      aria-labelledby="destination-heading"
    >
      <h2 id="destination-heading" className="sr-only">
        Search weather
      </h2>
      <form
        onSubmit={handleSubmit}
        noValidate
        className="home-search-form"
        aria-label="Weather search"
      >
        <div>
          <label htmlFor="city" className="home-field-label">
            City:
          </label>
          <div className="home-input-group">
            <input
              ref={cityRef}
              id="city"
              type="text"
              name="city"
              value={city}
              onChange={(event) => changeCity(event.target.value)}
              className={inputClass}
              placeholder="Destination e.g., Berlin"
              required
              maxLength={100}
              aria-invalid={Boolean(fieldErrors.city)}
              aria-describedby={fieldErrors.city ? 'city-error' : undefined}
            />
            <button
              type="button"
              onClick={handleUseCurrentLocation}
              className="home-icon-button"
              aria-label="Use current location"
              disabled={geolocation.status === 'loading'}
            >
              <FontAwesomeIcon icon={faLocationCrosshairs} />
            </button>
          </div>
          {fieldErrors.city && (
            <p id="city-error" role="alert" className="home-field-error">
              {fieldErrors.city}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="travel-date" className="home-field-label">
            Date of travel:
          </label>
          <DatePicker
            key={dateResetKey}
            ref={dateRef}
            id="travel-date"
            name="travel-date"
            label="Date of travel"
            value={date}
            onChange={changeDate}
            required
            aria-invalid={Boolean(fieldErrors.date)}
            aria-describedby={fieldErrors.date ? 'date-error' : undefined}
          />
          {fieldErrors.date && (
            <p id="date-error" role="alert" className="home-field-error">
              {fieldErrors.date}
            </p>
          )}
        </div>
        <div className="home-search-actions">
          <button
            type="submit"
            disabled={weather.status === 'loading'}
            className="home-button home-button-primary"
          >
            {weather.status === 'loading' ? 'Loading…' : 'Search Weather'}
          </button>
          <button type="button" onClick={handleReset} className="home-button home-button-secondary">
            Reset
          </button>
        </div>
        <output className="home-search-feedback" aria-live="polite">
          {geolocation.message}
        </output>
        {weather.status === 'selecting' && (
          <fieldset className="home-city-candidates">
            <legend>Choose a city:</legend>
            {weather.candidates.map((candidate, index) => (
              <button
                ref={index === 0 ? candidateRef : undefined}
                key={candidate.id}
                type="button"
                onClick={() => weather.chooseCity(candidate)}
                className="home-city-option"
              >
                {locationLabel(candidate)}
              </button>
            ))}
          </fieldset>
        )}
        {selectedLocation && (
          <p className="home-selected-city">Selected: {locationLabel(selectedLocation)}</p>
        )}
      </form>
      <p className="home-search-note">
        Search by city, then choose a matching result if prompted. Weather availability depends on
        the selected date and provider access.
      </p>
    </section>
  );
}
