import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { isCalendarDate } from '../../../shared/calendar.js';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowUp,
  faArrowDown,
  faTrashCan,
  faCirclePlus,
  faSliders,
  faLocationDot,
} from '@fortawesome/free-solid-svg-icons';
import { DatePicker } from '../ui/date-picker.jsx';
import DestinationSelector from '../destination/DestinationSelector.jsx';
import { allocateTripDates, MAX_DESTINATIONS } from '../../../shared/trip.js';
const fieldClass = 'editor-input';
const buttonClass = 'editor-button';
const empty = { title: '', startDate: '', endDate: '', destinations: [] };
function rowsOf(draft) {
  return draft.destinations.map((d, index) => ({
    key: `initial-${index}`,
    location: {
      cityName: d.cityName,
      countryCode: d.countryCode,
      region: d.region ?? null,
      lat: d.lat,
      lon: d.lon,
      timeZone: d.timeZone,
    },
    arrivalDate: d.arrivalDate,
    departureDate: d.departureDate,
  }));
}
/**
 * initialDraft is a mount-time snapshot (remount with a new key for another trip).
 * onChange receives the shared allocation result: invalid trip is null, allocations empty.
 * onSubmit receives only a normalized valid trip; onCancel follows restoration of the snapshot.
 * disabled also carries the parent fieldset state into portaled calendars.
 * UI row keys are never included in the trip contract. No persistence is performed here.
 */
export default function TripEditor({
  initialDraft = empty,
  onChange,
  onSubmit,
  onCancel,
  submitLabel = 'Review validated draft',
  submitMessage = 'Validated draft delivered for review. Nothing has been saved.',
  submitDisabled = false,
  disabled = false,
  showHeading = true,
}) {
  const id = useId();
  const counter = useRef(0);
  const [initial] = useState(() => structuredClone(initialDraft));
  const [details, setDetails] = useState(() => ({
    title: initial.title,
    startDate: initial.startDate,
    endDate: initial.endDate,
  }));
  const [rows, setRows] = useState(() => rowsOf(initial));
  const [reset, setReset] = useState(0);
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState({});
  const [reviewAttempt, setReviewAttempt] = useState(0);
  const editor = useRef(null);
  useEffect(() => {
    if (reviewAttempt) editor.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [reviewAttempt]);
  const touch = (key) => setTouched((old) => ({ ...old, [key]: true }));
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);
  const validation = useMemo(
    () =>
      allocateTripDates({
        ...details,
        destinations: rows.map((row, position) => ({
          ...(row.location ?? {}),
          position,
          arrivalDate: row.arrivalDate,
          departureDate: row.departureDate,
        })),
      }),
    [details, rows],
  );
  useEffect(() => {
    callback.current?.(validation);
  }, [validation]);
  function edit(field, value) {
    setMessage('');
    setDetails((old) => ({ ...old, [field]: value }));
  }
  function update(key, patch) {
    setMessage('');
    setRows((old) => old.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function move(index, direction) {
    setMessage('');
    setRows((old) => {
      const next = [...old];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }
  function discard() {
    setDetails({ title: initial.title, startDate: initial.startDate, endDate: initial.endDate });
    setTouched({});
    setReviewAttempt(0);
    setRows(rowsOf(initial));
    setReset((old) => old + 1);
    setMessage('Changes discarded.');
    onCancel?.();
  }
  function submit() {
    if (!validation.valid || submitDisabled || disabled) return;
    onSubmit?.(structuredClone(validation.trip));
    setMessage(submitMessage);
  }
  const errors = validation.errors;
  function field(label, name, value, change, type, path = name, touchKey = name) {
    const fieldId = id + '-' + path;
    const structural = errors[path] === 'Final departure must equal trip end.';
    const show = reviewAttempt > 0 || (touched[touchKey] && (!structural || touched.endDate));
    const error =
      show && errors[path]
        ? !value && type === 'date'
          ? `Choose ${label.toLowerCase()}.`
          : errors[path]
        : null;
    const controlProps = {
      id: fieldId,
      value: value ?? '',
      onBlur: () => touch(touchKey),
      'aria-invalid': Boolean(error),
      'aria-describedby': error ? fieldId + '-error' : undefined,
    };
    return (
      <div className="editor-field">
        <label htmlFor={fieldId}>{label}</label>
        {type === 'date' ? (
          <DatePicker
            key={reset + '-' + touchKey}
            {...controlProps}
            label={label}
            onChange={change}
            disabled={disabled}
          />
        ) : (
          <input
            {...controlProps}
            type={type}
            onChange={(event) => change(event.target.value)}
            className={fieldClass}
          />
        )}
        {error && (
          <p id={fieldId + '-error'} className="editor-field-error">
            {error}
          </p>
        )}
      </div>
    );
  }
  function addDestination() {
    if (rows.length >= MAX_DESTINATIONS) return;
    const key = `new-${counter.current++}`;
    setMessage('');
    setRows((old) => {
      const previousDate = old.length ? old.at(-1).departureDate : details.startDate;
      return [
        ...old,
        {
          key,
          location: null,
          arrivalDate: isCalendarDate(previousDate) ? previousDate : '',
          departureDate: '',
        },
      ];
    });
  }
  return (
    <section ref={editor} aria-label="Trip editor" className="trip-editor">
      <div className="editor-introduction">
        <p className="editor-eyebrow">Trip configuration</p>
        {showHeading && <h2>{initial.destinations.length ? 'Edit Trip' : 'Create Trip'}</h2>}
        <p>
          Manage your destinations and travel dates. Each covered day belongs to one destination.
        </p>
      </div>
      <section className="editor-card editor-settings" aria-labelledby={id + '-settings'}>
        <div className="editor-card-heading">
          <span className="editor-heading-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faSliders} />
          </span>
          <div>
            <h3 id={id + '-settings'}>Trip details</h3>
            <p>Name your journey and set its overall dates.</p>
          </div>
        </div>
        {field('Trip title', 'title', details.title, (v) => edit('title', v), 'text')}
        <div className="editor-date-grid">
          {field(
            'Trip arrival date',
            'startDate',
            details.startDate,
            (v) => edit('startDate', v),
            'date',
          )}
          {field(
            'Trip departure date',
            'endDate',
            details.endDate,
            (v) => edit('endDate', v),
            'date',
          )}
        </div>
        <p className="editor-guidance">
          Plan up to eight destinations and 42 weather days. Your departure date ends the trip and
          is not counted as a weather day.
        </p>
      </section>
      <div className="editor-destinations-heading">
        <h3>
          Destinations{' '}
          <span>
            {rows.length} of {MAX_DESTINATIONS}
          </span>
        </h3>
        <p>Transfer dates belong to the arriving destination.</p>
      </div>
      <p className="editor-guidance">
        Add destinations in travel order. Existing dates stay as entered; Check trip will identify
        gaps or overlaps.
      </p>
      <div className="editor-destinations">
        {rows.map((row, index) => (
          <section
            key={reset + '-' + row.key}
            aria-label={`Destination ${index + 1}`}
            className="editor-card editor-destination"
          >
            <div className="editor-destination-header">
              <h4>
                <FontAwesomeIcon icon={faLocationDot} aria-hidden="true" />
                Destination {index + 1}
              </h4>
              <div className="editor-row-actions">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move destination ${index + 1} up`}
                  title="Move up"
                >
                  <FontAwesomeIcon icon={faArrowUp} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move destination ${index + 1} down`}
                  title="Move down"
                >
                  <FontAwesomeIcon icon={faArrowDown} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="editor-button editor-button-danger"
                  onClick={() => {
                    setMessage('');
                    setRows((old) => old.filter((item) => item.key !== row.key));
                  }}
                  aria-label={`Remove destination ${index + 1}`}
                  title="Remove destination"
                >
                  <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="editor-destination-content">
              <div className="editor-city">
                <DestinationSelector
                  initialValue={row.location}
                  onChange={(location) => update(row.key, { location })}
                  validationMessage={
                    !row.location && reviewAttempt > 0
                      ? 'Search for a city and choose a result.'
                      : null
                  }
                />
              </div>
              <div className="editor-date-grid">
                {field(
                  `Destination ${index + 1} arrival`,
                  'arrivalDate',
                  row.arrivalDate,
                  (v) => update(row.key, { arrivalDate: v }),
                  'date',
                  `destinations.${index}.arrivalDate`,
                  row.key + ':arrivalDate',
                )}
                {field(
                  `Destination ${index + 1} departure`,
                  'departureDate',
                  row.departureDate,
                  (v) => update(row.key, { departureDate: v }),
                  'date',
                  `destinations.${index}.departureDate`,
                  row.key + ':departureDate',
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
      <button
        type="button"
        className="editor-button editor-button-primary editor-add"
        aria-label="Add destination"
        aria-describedby={rows.length >= MAX_DESTINATIONS ? id + '-destination-limit' : undefined}
        disabled={rows.length >= MAX_DESTINATIONS}
        onClick={addDestination}
      >
        <FontAwesomeIcon icon={faCirclePlus} aria-hidden="true" />
        <span>Add Destination</span>
      </button>
      {rows.length >= MAX_DESTINATIONS && (
        <output id={id + '-destination-limit'} className="editor-destination-limit">
          Maximum eight destinations reached. Remove a destination to add another.
        </output>
      )}
      <div className="editor-action-bar">
        <div className="editor-feedback">
          <output className="editor-validation-status" aria-live="polite">
            {validation.valid
              ? `${validation.allocations.length} weather days across ${rows.length} ${rows.length === 1 ? 'destination' : 'destinations'}.`
              : 'Complete your trip details. Use Check trip to see what needs attention.'}
          </output>
          {!validation.valid && reviewAttempt > 0 && (
            <p role="alert" className="editor-field-error">
              Check the highlighted fields before saving.
              {errors.destinations && ` ${errors.destinations}`}
            </p>
          )}
          <output aria-live="polite">{message}</output>
        </div>
        <div className="editor-actions">
          {!validation.valid && (
            <button
              type="button"
              className={buttonClass}
              disabled={submitDisabled}
              onClick={() => setReviewAttempt((old) => old + 1)}
            >
              Check trip
            </button>
          )}
          <button type="button" className={buttonClass} onClick={discard}>
            Discard changes
          </button>
          <button
            type="button"
            className="editor-button editor-button-primary"
            disabled={!validation.valid || submitDisabled || disabled}
            onClick={submit}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
