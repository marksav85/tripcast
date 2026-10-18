import { useEffect, useId, useRef, useState } from 'react';
import { lookupCities, requestError } from '../../api/openWeather.js';
import { locationLabel, validateLookup, validCoordinates } from '../../lib/locations.js';
import { resolveTimeZone } from '../../lib/timeZone.js';
import { isTripTimeZone } from '../../../shared/trip.js';

const inputClass = 'w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
/** initialValue is a mount-time location snapshot; remount to replace it. onChange receives complete location fields, or null while selection is incomplete/invalid. */
export default function DestinationSelector({ onChange, initialValue = null, validationMessage = null }) {
  const id = useId();
  const [query, setQuery] = useState(initialValue?.cityName ?? ''); const [candidates, setCandidates] = useState([]);
  const [status, setStatus] = useState('idle'); const [message, setMessage] = useState('');
  const [location, setLocation] = useState(initialValue ? { id: `${initialValue.lat},${initialValue.lon}`, name: initialValue.cityName, country: initialValue.countryCode, region: initialValue.region ?? '', lat: initialValue.lat, lon: initialValue.lon } : null);
  const request = useRef(null); const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; request.current?.abort(); }, []);
  function clearSearch() {
    generation.current += 1; request.current?.abort();
    setCandidates([]); setLocation(null); onChange(null);
  }
  function editQuery(value) { clearSearch(); setQuery(value); setStatus('idle'); setMessage(''); }
  async function search(event) {
    event.preventDefault(); clearSearch();
    const { query: normalized, errors } = validateLookup(query, '2000-01-01');
    // Only the existing city rule is relevant here; this component has no date input.
    if (errors.city) { setStatus('error'); setMessage(errors.city); return; }
    const current = generation.current; const controller = new AbortController(); request.current = controller;
    setStatus('loading'); setMessage('Searching cities…');
    try {
      const matches = await lookupCities(normalized, controller.signal);
      if (generation.current !== current) return;
      setCandidates(matches); setStatus('ready'); setMessage(matches.length ? 'Choose a city from the results.' : 'No cities found. Try another search.');
    } catch (error) {
      if (generation.current !== current || controller.signal.aborted) return;
      setStatus('error'); setMessage(requestError(error, 'City search'));
    }
  }
  function output(city, zone) {
    onChange(isTripTimeZone(zone) ? {
      cityName: city.name, countryCode: city.country, region: city.region || null,
      lat: city.lat, lon: city.lon, timeZone: zone,
    } : null);
  }
  function choose(city) {
    // Geocoding normalization bounds coordinates, but optional provider labels may still
    // exceed the shared trip contract. Reject rather than truncate or invent labels.
    const labelValid = (value) => typeof value === 'string' && value.trim().length > 0
      && Array.from(value).length <= 100 && !Array.from(value).some((char) => {
        const code = char.codePointAt(0);
        return code < 32 || code === 127 || (code >= 0xD800 && code <= 0xDFFF);
      });
    if (!labelValid(city.name) || (city.region && !labelValid(city.region))
      || !/^[A-Z]{2}$/.test(city.country) || !validCoordinates(city.lat, city.lon)) {
      setLocation(null); onChange(null);
      setMessage('Selected city data is invalid. Choose another result.'); return;
    }
    const result = resolveTimeZone(city.lat, city.lon);
    const zone = result.status === 'suggested' && isTripTimeZone(result.timeZone) ? result.timeZone : '';
    setLocation(zone ? city : null);
    setMessage(zone ? '' : 'Could not select this location. Try selecting it again or choose another city.');
    output(city, zone);
  }
  return <section aria-label="Destination location" className="bg-white rounded-lg p-4 space-y-4">
    <form onSubmit={search} noValidate className="space-y-2" aria-label="City search">
      <label htmlFor={id + '-city'} className="block font-medium">Search city</label>
      <input id={id + '-city'} value={query} onChange={(e) => editQuery(e.target.value)} className={inputClass} maxLength={100} required aria-describedby={id + '-guidance' + (validationMessage ? ' ' + id + '-validation' : '')} aria-invalid={Boolean(validationMessage)} />
      <p id={id + '-guidance'} className="text-sm text-gray-600">Enter a city, press Search or Enter, then choose a result to select your destination.</p>
      <button className="bg-blue-500 text-white rounded-lg p-2 focus:ring-2 focus:ring-blue-500 disabled:opacity-60" disabled={status === 'loading'}>{status === 'loading' ? 'Searching…' : 'Search'}</button>
    </form>
    <output className="block" aria-live="polite">{message}</output>
    {validationMessage && <p id={id + '-validation'} className="text-red-700 text-sm">{validationMessage}</p>}
    {candidates.length > 0 && <fieldset className="space-y-2"><legend>Choose a city</legend>{candidates.map((city) => <button key={city.id} type="button" aria-pressed={location?.id === city.id} onClick={() => choose(city)} aria-label={locationLabel(city)} className={`flex w-full items-center justify-between gap-3 p-3 border rounded-lg text-left hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 ${location?.id === city.id ? 'bg-blue-50 border-blue-600' : 'bg-white border-gray-300'}`}><span>{locationLabel(city)}</span><span aria-hidden="true" className="text-blue-700 font-medium">{location?.id === city.id ? '✓ Selected' : 'Select →'}</span></button>)}</fieldset>}
    {location && <output className="block rounded-lg bg-green-50 p-3 text-green-800" aria-live="polite">Selected city: {locationLabel(location)}</output>}
  </section>;
}
