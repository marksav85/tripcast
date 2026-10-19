import { forwardRef, useId, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarDays } from '@fortawesome/free-solid-svg-icons';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { dateInputFormat, displayInputDate, parseInputDate } from '../../lib/dateInputFormat';
import { toPickerDate, fromPickerDate } from '../../lib/datePickerDate';

/** Controlled YYYY-MM-DD field with a separate localized editing draft.
 * min/max constrain calendar selection; parents retain authoritative validation for typed values.
 */
/* oxlint-disable jsx-a11y/no-autofocus -- Calendar focus follows an explicit user request to open the popover. */
export const DatePicker = forwardRef(function DatePicker({
  value, onChange, locale, label = 'Date', min, max, disabled = false, ...inputProps
}, ref) {
  const [open, setOpen] = useState(false);
  const format = useMemo(() => dateInputFormat(locale), [locale]);
  const hintId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState(() => ({ value, text: displayInputDate(value, format), format: format.placeholder, invalid: false }));
  // Reconcile external selections/Retry without replacing the text of an active edit.
  if (draft.value !== value || draft.format !== format.placeholder) {
    setDraft({ value, text: displayInputDate(value, format), format: format.placeholder, invalid: false });
  }
  const showError = draft.invalid && !inputProps['aria-invalid'];
  const fieldState = inputProps['aria-invalid'] || showError ? 'invalid'
    : parseInputDate(draft.text, format) ? 'populated' : 'empty';
  function edit(text) {
    const next = parseInputDate(text, format);
    setDraft({ value: next, text, format: format.placeholder, invalid: false });
    onChange(next);
  }
  function finishEditing(event) {
    const next = parseInputDate(draft.text, format);
    setDraft({ ...draft, text: next ? displayInputDate(next, format) : draft.text, invalid: Boolean(draft.text.trim()) && !next });
    inputProps.onBlur?.(event);
  }
  const selected = toPickerDate(value);
  const minimum = toPickerDate(min);
  const maximum = toPickerDate(max);
  const firstDay = minimum ?? toPickerDate('0001-01-01');
  const lastDay = maximum ?? toPickerDate('9999-12-31');
  const disabledDays = [{ before: firstDay }, { after: lastDay }];
  function select(date) {
    const next = fromPickerDate(date);
    setDraft({ value: next, text: displayInputDate(next, format), format: format.placeholder, invalid: false });
    onChange(next);
    setOpen(false);
  }
  return <Popover open={open && !disabled} onOpenChange={setOpen}>
    <div>
      <div className="tripcast-date-field" data-state={fieldState}>
        <input {...inputProps} ref={ref} type="text" className="home-input tripcast-date-input"
          value={draft.text} onChange={(event) => edit(event.target.value)} onBlur={finishEditing} disabled={disabled}
          aria-invalid={Boolean(inputProps['aria-invalid'] || showError)}
          aria-describedby={[inputProps['aria-describedby'], hintId, showError ? errorId : null].filter(Boolean).join(' ')}
          placeholder={format.placeholder} autoComplete="off" maxLength={10} />
        <PopoverTrigger asChild>
          <button type="button" className="tripcast-date-trigger" disabled={disabled} aria-label={`Open calendar for ${label.toLowerCase()}`}>
            <FontAwesomeIcon icon={faCalendarDays} aria-hidden="true" />
          </button>
        </PopoverTrigger>
      </div>
      <p id={hintId} className="home-date-hint">Enter {format.placeholder} or choose a date from the calendar.</p>
      {showError && <p id={errorId} role="alert" className="home-field-error">Enter a valid date ({format.placeholder}).</p>}
    </div>
    <PopoverContent aria-label={`Choose ${label.toLowerCase()}`}>
      <Calendar key={value} mode="single" selected={selected} defaultMonth={selected ?? minimum ?? maximum}
        startMonth={firstDay} endMonth={lastDay} onSelect={select} disabled={disabledDays} autoFocus />
      <div className="tripcast-calendar-actions">
        <button type="button" onClick={() => select(undefined)} disabled={!value && !draft.text}>Clear date</button>
        <button type="button" onClick={() => setOpen(false)}>Close calendar</button>
      </div>
    </PopoverContent>
  </Popover>;
});
