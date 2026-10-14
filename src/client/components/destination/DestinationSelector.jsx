import { useEffect, useId, useRef, useState } from 'react';
import { lookupCities, requestError } from '../../api/openWeather.js';
import { locationLabel, validateLookup, validCoordinates } from '../../lib/locations.js';
import { resolveTimeZone } from '../../lib/timeZone.js';
import { isTripTimeZone } from '../../../shared/trip.js';

const inputClass = 'w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';
function timezoneCatalog() {
  try { return [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])].filter(isTripTimeZone).sort(); }
  catch { return null; }
}

/** onChange receives complete location fields, or null while selection is incomplete/invalid. */
export default function DestinationSelector({ onChange }) {
  const id = useId();
  const [query, setQuery] = useState(''); const [candidates, setCandidates] = useState([]);
  const [status, setStatus] = useState('idle'); const [message, setMessage] = useState('');
  const [location, setLocation] = useState(null); const [timeZone, setTimeZone] = useState('');
  const [suggestion, setSuggestion] = useState(null); const [filter, setFilter] = useState('');
  const [catalog] = useState(timezoneCatalog);
  const request = useRef(null); const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; request.current?.abort(); }, []);
  function clearSearch() {
    generation.current += 1; request.current?.abort();
    setCandidates([]); setLocation(null); setTimeZone(''); setSuggestion(null); setFilter(''); onChange(null);
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
      setLocation(null); setTimeZone(''); setSuggestion(null); onChange(null);
      setMessage('Selected city data is invalid. Choose another result.'); return;
    }
    const result = resolveTimeZone(city.lat, city.lon);
    const zone = result.status === 'suggested' && isTripTimeZone(result.timeZone) ? result.timeZone : '';
    setLocation(city); setSuggestion(zone || null); setTimeZone(zone); setFilter('');
    output(city, zone);
  }
  function changeZone(zone) { setTimeZone(zone); output(location, zone); }
  const validZone = isTripTimeZone(timeZone);
  const options = catalog ? [...new Set([...(validZone ? [timeZone] : []), ...catalog.filter((zone) => zone.toLowerCase().includes(filter.toLowerCase()))])] : [];
  return <section aria-label="Destination location" className="bg-white rounded-lg p-4 space-y-4">
    <form onSubmit={search} noValidate className="space-y-2">
      <label htmlFor={id + '-city'} className="block font-medium">Search city</label>
      <input id={id + '-city'} value={query} onChange={(e) => editQuery(e.target.value)} className={inputClass} maxLength={100} required />
      <button className="bg-blue-500 text-white rounded-lg p-2 focus:ring-2 focus:ring-blue-500 disabled:opacity-60" disabled={status === 'loading'}>Search</button>
    </form>
    <output className="block" aria-live="polite">{message}</output>
    {candidates.length > 0 && <fieldset className="space-y-2"><legend>Choose a city</legend>{candidates.map((city) => <button key={city.id} type="button" aria-pressed={location?.id === city.id} onClick={() => choose(city)} className="block w-full p-2 border border-blue-500 rounded-lg text-left focus:ring-2 focus:ring-blue-500">{locationLabel(city)}</button>)}</fieldset>}
    {location && <div className="space-y-2">
      <p>Selected city: {locationLabel(location)}</p>
      <p id={id + '-help'}>{suggestion ? `Suggested timezone: ${suggestion}. Review and correct if necessary.` : 'Timezone could not be suggested. Choose a named timezone manually.'}</p>
      {catalog && <><label htmlFor={id + '-filter'}>Filter timezones</label><input id={id + '-filter'} type="search" value={filter} onChange={(e) => setFilter(e.target.value)} className={inputClass} /></>}
      <label htmlFor={id + '-zone'} className="block font-medium">Timezone</label>
      {catalog ? <select id={id + '-zone'} value={timeZone} onChange={(e) => changeZone(e.target.value)} className={inputClass} aria-describedby={id + '-help'} aria-invalid={!validZone} required>
        <option value="">Choose a timezone</option>{options.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
      </select> : <input id={id + '-zone'} value={timeZone} onChange={(e) => changeZone(e.target.value)} placeholder="e.g., Europe/Paris or UTC" className={inputClass} aria-describedby={id + '-help'} aria-invalid={!validZone} required />}
      <output className="block" aria-live="polite">{validZone ? `Selected timezone: ${timeZone}` : 'A valid named timezone is required.'}</output>
    </div>}
  </section>;
}
