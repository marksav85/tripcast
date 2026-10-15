import { useEffect, useId, useMemo, useRef, useState } from 'react';
import DestinationSelector from '../destination/DestinationSelector.jsx';
import { allocateTripDates, MAX_DESTINATIONS } from '../../../shared/trip.js';
const fieldClass = 'w-full border border-gray-300 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500';
const buttonClass = 'border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 disabled:opacity-50';
const empty = { title: '', startDate: '', endDate: '', destinations: [] };
function rowsOf(draft) {
  return draft.destinations.map((d, index) => ({ key: `initial-${index}`, location: {
    cityName: d.cityName, countryCode: d.countryCode, region: d.region ?? null, lat: d.lat, lon: d.lon, timeZone: d.timeZone,
  }, arrivalDate: d.arrivalDate, departureDate: d.departureDate }));
}
/**
 * initialDraft is a mount-time snapshot (remount with a new key for another trip).
 * onChange receives the shared allocation result: invalid trip is null, allocations empty.
 * onSubmit receives only a normalized valid trip; onCancel follows restoration of the snapshot.
 * UI row keys are never included in the trip contract. No persistence is performed here.
 */
export default function TripEditor({ initialDraft = empty, onChange, onSubmit, onCancel }) {
  const id = useId(); const counter = useRef(0);
  const [initial] = useState(() => structuredClone(initialDraft));
  const [details, setDetails] = useState(() => ({ title: initial.title, startDate: initial.startDate, endDate: initial.endDate }));
  const [rows, setRows] = useState(() => rowsOf(initial)); const [reset, setReset] = useState(0);
  const [message, setMessage] = useState('');
  const callback = useRef(onChange);
  useEffect(() => { callback.current = onChange; }, [onChange]);
  const validation = useMemo(() => allocateTripDates({ ...details, destinations: rows.map((row, position) => ({
    ...(row.location ?? {}), position, arrivalDate: row.arrivalDate, departureDate: row.departureDate,
  })) }), [details, rows]);
  useEffect(() => { callback.current?.(validation); }, [validation]);
  function edit(field, value) { setMessage(''); setDetails((old) => ({ ...old, [field]: value })); }
  function update(key, patch) { setMessage(''); setRows((old) => old.map((row) => row.key === key ? { ...row, ...patch } : row)); }
  function move(index, direction) {
    setMessage(''); setRows((old) => { const next = [...old]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  }
  function discard() {
    setDetails({ title: initial.title, startDate: initial.startDate, endDate: initial.endDate });
    setRows(rowsOf(initial)); setReset((old) => old + 1); setMessage('Changes discarded.'); onCancel?.();
  }
  function submit() {
    if (!validation.valid) return;
    onSubmit?.(structuredClone(validation.trip)); setMessage('Validated draft delivered for review. Nothing has been saved.');
  }
  const errors = validation.errors;
  function field(label, name, value, change, type, path = name) {
    const fieldId = id + '-' + path;
    return <div><label htmlFor={fieldId} className="block font-medium">{label}</label><input id={fieldId} type={type} value={value ?? ''} onChange={(e) => change(e.target.value)} className={fieldClass} aria-invalid={Boolean(errors[path])} aria-describedby={errors[path] ? fieldId + '-error' : undefined} />{errors[path] && <p id={fieldId + '-error'} className="text-red-700 text-sm">{errors[path]}</p>}</div>;
  }
  return <section aria-label="Trip editor" className="max-w-4xl mx-auto bg-gray-50 p-4 md:p-6 space-y-5">
    <h2 className="text-2xl font-bold">Plan your trip</h2>
    <div className="bg-white rounded-lg shadow p-4 space-y-3">
      {field('Trip title', 'title', details.title, (v) => edit('title', v), 'text')}
      <div className="grid md:grid-cols-2 gap-4">{field('Trip arrival date', 'startDate', details.startDate, (v) => edit('startDate', v), 'date')}{field('Trip departure date', 'endDate', details.endDate, (v) => edit('endDate', v), 'date')}</div>
      <p>Your departure date is the day your trip ends and is not counted as a weather day.</p>
    </div>
    {rows.map((row, index) => <section key={reset + '-' + row.key} aria-label={`Destination ${index + 1}`} className="bg-white rounded-lg shadow p-4 space-y-3">
      <h3 className="text-lg font-semibold">Destination {index + 1}</h3>
      <DestinationSelector initialValue={row.location} onChange={(location) => update(row.key, { location })} />
      <div className="grid md:grid-cols-2 gap-4">{field(`Destination ${index + 1} arrival`, 'arrivalDate', row.arrivalDate, (v) => update(row.key, { arrivalDate: v }), 'date', `destinations.${index}.arrivalDate`)}{field(`Destination ${index + 1} departure`, 'departureDate', row.departureDate, (v) => update(row.key, { departureDate: v }), 'date', `destinations.${index}.departureDate`)}</div>
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move destination ${index + 1} up`}>Move up</button><button type="button" className={buttonClass} disabled={index === rows.length - 1} onClick={() => move(index, 1)} aria-label={`Move destination ${index + 1} down`}>Move down</button><button type="button" className={buttonClass} onClick={() => { setMessage(''); setRows((old) => old.filter((item) => item.key !== row.key)); }} aria-label={`Remove destination ${index + 1}`}>Remove</button></div>
    </section>)}
    <button type="button" className={buttonClass} disabled={rows.length >= MAX_DESTINATIONS} onClick={() => { const key = `new-${counter.current++}`; setMessage(''); setRows((old) => [...old, { key, location: null, arrivalDate: '', departureDate: '' }]); }}>Add destination</button>
    <output className="block" aria-live="polite">{validation.valid ? `${validation.allocations.length} weather days across ${rows.length} ${rows.length === 1 ? 'destination' : 'destinations'}.` : 'Draft is incomplete or invalid. Review the fields below.'}</output>
    {!validation.valid && <ul className="text-red-700 text-sm" aria-label="Validation issues">{Object.entries(errors).map(([path, text]) => <li key={path}>{path.startsWith('destinations.') ? `Destination ${Number(path.split('.')[1]) + 1}: ` : ''}{text}</li>)}</ul>}
    <div className="flex flex-wrap gap-3"><button type="button" className="bg-blue-600 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 disabled:opacity-50" disabled={!validation.valid} onClick={submit}>Review validated draft</button><button type="button" className={buttonClass} onClick={discard}>Discard changes</button></div>
    <output className="block" aria-live="polite">{message}</output>
  </section>;
}
