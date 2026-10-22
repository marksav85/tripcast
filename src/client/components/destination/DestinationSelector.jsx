import { useEffect, useId, useRef, useState } from 'react';
import { lookupCities, requestError } from '../../api/openWeather.js';
import { locationLabel, validateLookup, validCoordinates } from '../../lib/locations.js';
import { resolveTimeZone } from '../../lib/timeZone.js';
import { isTripTimeZone } from '../../../shared/trip.js';

const inputClass = 'editor-input';
/** initialValue is a mount-time location snapshot; remount to replace it. onChange receives complete location fields, or null while selection is incomplete/invalid. */
export default function DestinationSelector({
  onChange,
  initialValue = null,
  validationMessage = null,
}) {
  const id = useId();
  const [query, setQuery] = useState(initialValue?.cityName ?? '');
  const [candidates, setCandidates] = useState([]);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState(
    initialValue
      ? {
          id: `${initialValue.lat},${initialValue.lon}`,
          name: initialValue.cityName,
          country: initialValue.countryCode,
          region: initialValue.region ?? '',
          lat: initialValue.lat,
          lon: initialValue.lon,
        }
      : null,
  );
  const inputRef = useRef(null);
  const clearRef = useRef(null);
  const focusSelection = useRef(false);
  const request = useRef(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
      request.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (location && focusSelection.current) {
      focusSelection.current = false;
      clearRef.current?.focus();
    }
  }, [location]);
  function clearSearch() {
    generation.current += 1;
    request.current?.abort();
    setCandidates([]);
    setLocation(null);
    onChange(null);
  }
  function editQuery(value) {
    clearSearch();
    setQuery(value);
    setStatus('idle');
    setMessage('');
  }
  function clearSelection() {
    clearSearch();
    setQuery('');
    setStatus('idle');
    setMessage('');
    inputRef.current?.focus();
  }
  async function search(event) {
    event.preventDefault();
    clearSearch();
    const { query: normalized, errors } = validateLookup(query, '2000-01-01');
    // Only the existing city rule is relevant here; this component has no date input.
    if (errors.city) {
      setStatus('error');
      setMessage(errors.city);
      return;
    }
    const current = generation.current;
    const controller = new AbortController();
    request.current = controller;
    setStatus('loading');
    setMessage('Searching cities…');
    try {
      const matches = await lookupCities(normalized, controller.signal);
      if (generation.current !== current) return;
      setCandidates(matches);
      setStatus('ready');
      setMessage(
        matches.length ? 'Choose a city from the results.' : 'No cities found. Try another search.',
      );
    } catch (error) {
      if (generation.current !== current || controller.signal.aborted) return;
      setStatus('error');
      setMessage(requestError(error, 'City search'));
    }
  }
  function output(city, zone) {
    onChange(
      isTripTimeZone(zone)
        ? {
            cityName: city.name,
            countryCode: city.country,
            region: city.region || null,
            lat: city.lat,
            lon: city.lon,
            timeZone: zone,
          }
        : null,
    );
  }
  function choose(city) {
    // Geocoding normalization bounds coordinates, but optional provider labels may still
    // exceed the shared trip contract. Reject rather than truncate or invent labels.
    const labelValid = (value) =>
      typeof value === 'string' &&
      value.trim().length > 0 &&
      Array.from(value).length <= 100 &&
      !Array.from(value).some((char) => {
        const code = char.codePointAt(0);
        return code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff);
      });
    if (
      !labelValid(city.name) ||
      (city.region && !labelValid(city.region)) ||
      !/^[A-Z]{2}$/.test(city.country) ||
      !validCoordinates(city.lat, city.lon)
    ) {
      setLocation(null);
      onChange(null);
      setMessage('Selected city data is invalid. Choose another result.');
      return;
    }
    const result = resolveTimeZone(city.lat, city.lon);
    const zone =
      result.status === 'suggested' && isTripTimeZone(result.timeZone) ? result.timeZone : '';
    focusSelection.current = Boolean(zone);
    setLocation(zone ? city : null);
    if (zone) {
      setCandidates([]);
      setStatus('selected');
    }
    setMessage(
      zone ? '' : 'Could not select this location. Try selecting it again or choose another city.',
    );
    output(city, zone);
  }
  return (
    <section aria-label="Destination location" className="editor-location-selector">
      <form onSubmit={search} noValidate className="editor-city-search" aria-label="City search">
        <label htmlFor={id + '-city'} className="editor-city-label">
          Search city
        </label>
        <input
          ref={inputRef}
          id={id + '-city'}
          value={query}
          onChange={(e) => editQuery(e.target.value)}
          className={inputClass}
          maxLength={100}
          required
          aria-describedby={id + '-guidance' + (validationMessage ? ' ' + id + '-validation' : '')}
          aria-invalid={Boolean(validationMessage)}
        />
        <p id={id + '-guidance'} className="editor-city-guidance">
          Press Search or Enter, then choose a city from the results.
        </p>
        <button className="editor-button editor-button-secondary" disabled={status === 'loading'}>
          {status === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>
      <output className="editor-city-feedback" aria-live="polite">
        {message}
      </output>
      {validationMessage && (
        <p id={id + '-validation'} className="editor-field-error">
          {validationMessage}
        </p>
      )}
      {candidates.length > 0 && (
        <fieldset className="editor-city-results">
          <legend>Choose a city</legend>
          {candidates.map((city) => (
            <button
              key={city.id}
              type="button"
              aria-pressed={location?.id === city.id}
              onClick={() => choose(city)}
              aria-label={locationLabel(city)}
              className={`editor-city-option${location?.id === city.id ? ' editor-city-option-selected' : ''}`}
            >
              <span>{locationLabel(city)}</span>
              <span aria-hidden="true" className="editor-city-option-action">
                {location?.id === city.id ? '✓ Selected' : 'Select →'}
              </span>
            </button>
          ))}
        </fieldset>
      )}
      {location && (
        <div className="editor-city-selected">
          <output aria-live="polite">
            Selected city: <strong>{locationLabel(location)}</strong>
          </output>
          <button
            ref={clearRef}
            type="button"
            className="editor-city-clear"
            onClick={clearSelection}
            aria-label="Clear selected city"
            title="Clear city selection"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
    </section>
  );
}
