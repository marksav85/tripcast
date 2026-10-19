import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DatePicker } from '../src/client/components/ui/date-picker';
import { toPickerDate, fromPickerDate } from '../src/client/lib/datePickerDate';

function setup({ initial = '2026-12-31', ...props } = {}) {
  const changed = vi.fn();
  function Field() {
    const [value, setValue] = useState(initial);
    return <><label htmlFor="test-date">Travel date</label><DatePicker id="test-date" label="Travel date" value={value}
      onChange={(next) => { changed(next); setValue(next); }} {...props} /><button>Outside</button></>;
  }
  return { user: userEvent.setup(), changed, ...render(<Field />) };
}
const trigger = () => screen.getByRole('button', { name: 'Open calendar for travel date' });
const day = (label) => screen.getByRole('button', { name: label });

it('opens at the selected date and closes on Escape with focus restored', async () => {
  const { user } = setup();
  await user.click(trigger());
  expect(screen.getByRole('dialog', { name: 'Choose travel date' })).toBeVisible();
  await waitFor(() => expect(day(/December 31st, 2026, selected/)).toHaveFocus());
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger()).toHaveFocus();
});
it('selects a day across the year boundary and reopens with that selection', async () => {
  const { user, changed } = setup();
  await user.click(trigger());
  await user.click(screen.getByRole('button', { name: /Go to the Next Month/i }));
  await user.click(day(/January 1st, 2027/));
  expect(changed).toHaveBeenLastCalledWith('2027-01-01');
  expect(screen.getByLabelText('Travel date')).toHaveValue('01/01/2027');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(trigger());
  expect(day(/January 1st, 2027, selected/)).toBeInTheDocument();
});
it('supports arrow-key date selection and closes after Enter', async () => {
  const { user, changed } = setup();
  await user.tab(); expect(screen.getByLabelText('Travel date')).toHaveFocus();
  await user.tab(); expect(trigger()).toHaveFocus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(day(/December 31st, 2026, selected/)).toHaveFocus());
  await user.keyboard('{ArrowRight}{Enter}');
  expect(changed).toHaveBeenLastCalledWith('2027-01-01');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('handles an empty date and explicit clearing without inventing a selection', async () => {
  const { user, changed } = setup({ initial: '' });
  await user.click(trigger());
  expect(screen.getByRole('button', { name: 'Clear date' })).toBeDisabled();
  expect(screen.getByLabelText('Travel date')).toHaveValue('');
  expect(changed).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Close calendar' }));
  fireEvent.change(screen.getByLabelText('Travel date'), { target: { value: '2028-02-29' } });
  await user.click(trigger()); await user.click(screen.getByRole('button', { name: 'Clear date' }));
  expect(changed).toHaveBeenLastCalledWith('');
  expect(screen.getByLabelText('Travel date')).toHaveValue('');
});
it('disables calendar choices outside inclusive bounds and never clamps the controlled value', async () => {
  const { user, changed } = setup({ initial: '2027-01-15', min: '2027-01-10', max: '2027-01-20' });
  await user.click(trigger());
  expect(day(/January 9th, 2027/)).toBeDisabled();
  expect(day(/January 21st, 2027/)).toBeDisabled();
  expect(day(/January 10th, 2027/)).toBeEnabled();
  expect(day(/January 20th, 2027/)).toBeEnabled();
  await user.click(day(/January 9th, 2027/)); expect(changed).not.toHaveBeenCalled();
  await user.click(day(/January 20th, 2027/)); expect(changed).toHaveBeenLastCalledWith('2027-01-20');
  fireEvent.change(screen.getByLabelText('Travel date'), { target: { value: '2027-01-25' } });
  expect(screen.getByLabelText('Travel date')).toHaveValue('2027-01-25');
});
it('keeps partial and invalid drafts visible without sending them to application state', () => {
  const { changed } = setup();
  for (const value of ['2027-02-', '2027-02-29', '']) {
    fireEvent.change(screen.getByLabelText('Travel date'), { target: { value } });
    expect(changed).toHaveBeenLastCalledWith('');
    expect(screen.getByLabelText('Travel date')).toHaveValue(value);
  }
});
it('closes when clicking outside and respects disabled controls', async () => {
  const { user, unmount } = setup();
  await user.click(trigger()); await user.click(screen.getByRole('button', { name: 'Outside' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  unmount(); setup({ disabled: true });
  expect(trigger()).toBeDisabled(); expect(screen.getByLabelText('Travel date')).toBeDisabled();
});
it.each(['2026-12-31', '2027-01-01', '2028-02-29', '2026-03-29', '2026-10-25', '0099-01-01'])('round-trips calendar day %s using local fields', (value) => {
  const date = toPickerDate(value);
  expect(date.getHours()).toBe(12);
  expect(fromPickerDate(date)).toBe(value);
});
it.each(['', '2027-02-29', '2026-13-01', '2026-02-30', 'not a date'])('does not normalize invalid calendar day %s', (value) => {
  expect(toPickerDate(value)).toBeUndefined();
});

it.each([
  ['en-GB', '04/05/2026', '2026-05-04', '04/05/2026'],
  ['en-US', '04/05/2026', '2026-04-05', '04/05/2026'],
  ['de-DE', '25-10-2026', '2026-10-25', '25.10.2026'],
  ['en-GB', '10/25/2026', '2026-10-25', '25/10/2026'],
])('keeps %s typing and calendar selection synchronized', async (locale, input, iso, display) => {
  const { user, changed } = setup({ initial: '', locale });
  const field = screen.getByLabelText('Travel date');
  fireEvent.change(field, { target: { value: input } });
  expect(changed).toHaveBeenLastCalledWith(iso);
  expect(field).toHaveValue(input);
  fireEvent.blur(field);
  expect(field).toHaveValue(display);
  await user.click(trigger());
  expect(screen.getByRole('gridcell', { selected: true })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Clear date' }));
  expect(field).toHaveValue('');
});
it('shows the active format, retains partial typing, and reports invalid dates on blur', () => {
  const { changed } = setup({ initial: '', locale: 'en-GB' });
  const field = screen.getByLabelText('Travel date');
  expect(field).toHaveAttribute('placeholder', 'DD/MM/YYYY');
  expect(screen.getByText('Enter DD/MM/YYYY or choose a date from the calendar.')).toBeVisible();
  fireEvent.change(field, { target: { value: '25/1' } });
  expect(field).toHaveValue('25/1');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.change(field, { target: { value: '31/02/2026' } });
  fireEvent.blur(field);
  expect(field).toHaveValue('31/02/2026');
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid date (DD/MM/YYYY).');
  expect(changed).toHaveBeenLastCalledWith('');
});

it('preserves keyboard edits until blur and then uses the preferred display format', async () => {
  const { user, changed } = setup({ initial: '', locale: 'en-US' });
  const field = screen.getByLabelText('Travel date');
  await user.type(field, '25/10');
  expect(field).toHaveValue('25/10');
  expect(changed).toHaveBeenLastCalledWith('');
  await user.type(field, '/2026');
  expect(field).toHaveValue('25/10/2026');
  expect(changed).toHaveBeenLastCalledWith('2026-10-25');
  await user.tab();
  expect(field).toHaveValue('10/25/2026');
});


it('defaults to day-first despite an American browser preference', async () => {
  vi.stubGlobal('navigator', { language: 'en-US' });
  const { user, changed } = setup({ initial: '2026-10-25' });
  const field = screen.getByLabelText('Travel date');
  expect(field).toHaveValue('25/10/2026');
  expect(field).toHaveAttribute('placeholder', 'DD/MM/YYYY');
  expect(screen.getByText('Enter DD/MM/YYYY or choose a date from the calendar.')).toBeVisible();
  fireEvent.change(field, { target: { value: '04/05/2026' } });
  expect(changed).toHaveBeenLastCalledWith('2026-05-04');
  await user.click(trigger());
  expect(day(/May 4th, 2026, selected/)).toBeVisible();
  await user.click(day(/May 5th, 2026/));
  expect(field).toHaveValue('05/05/2026');
  expect(changed).toHaveBeenLastCalledWith('2026-05-05');
});
