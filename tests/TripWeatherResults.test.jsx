import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import TripWeatherResults from '../src/client/components/trip/TripWeatherResults.jsx';
import { savedTrip, weatherEnvelope } from './fixtures/tripWeather.js';
import { addCalendarDays } from '../src/shared/trip.js';

function setup({ saved = savedTrip(), result = weatherEnvelope() } = {}) {
  return render(<TripWeatherResults saved={saved} weather={{ result, loading: false, error: null, refresh: vi.fn(), cancel: vi.fn() }} />);
}
function firstModel() {
  const result = weatherEnvelope();
  Object.assign(result.data.days[0].model, { forecastType: 'long-range', forecastLabel: 'Long-range estimate', precipitationProbability: 0,
    windSpeedMs: 0, windDirectionDeg: 0, humidityPercent: 0, cloudPercent: null, uvIndex: 0, providerRainValue: 999,
    feelsLikeC: { morning: 0, day: null, evening: -2, night: 4 } });
  return result;
}
it('groups allocated days in saved destination order and matches both position and date', () => {
  const saved = savedTrip(); saved.draft = { ...saved.draft, destinations: [
    { ...saved.draft.destinations[0], departureDate: '2027-06-02' },
    { ...saved.draft.destinations[0], position: 1, cityName: 'Rome', countryCode: 'IT', arrivalDate: '2027-06-02' },
  ] };
  const result = weatherEnvelope(); result.data.days[1].position = 1; result.data.days[2].position = 1;
  // This stray same-date outcome must not appear under Rome.
  result.data.days.push({ ...result.data.days[0], position: 0, date: '2027-06-02', model: { ...result.data.days[0].model, condition: { main: 'Wrong destination weather' } } });
  setup({ saved, result });
  const regions = screen.getAllByRole('region').slice(1);
  expect(regions.map(el => el.getAttribute('aria-label'))).toEqual(['Paris, FR — Leg 1', 'Rome, IT — Leg 2']);
  expect(within(regions[0]).getByText('Leg 1 of 2')).toBeVisible();
  expect(within(regions[0]).getByText('1 covered day')).toBeVisible();
  expect(within(regions[1]).getByText('Weather dates: 2 June 2027 – 3 June 2027')).toBeVisible();
  expect(within(regions[1]).queryByText(/clear sky/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Wrong destination weather/)).not.toBeInTheDocument();
  expect(screen.queryByText('4 June 2027')).not.toBeInTheDocument();
});
it('shows compact zero-valued summaries, explicit long-range labels and stale information', () => {
  const result = firstModel(); result.data.days[0].meta = { stale: true, cached: true }; setup({ result });
  expect(screen.getByText('0% precipitation chance')).toBeVisible();
  expect(screen.getByText('Long-range estimate')).toBeVisible(); expect(screen.getByText('Older cached weather')).toBeVisible();
  expect(screen.getByText('clear sky')).toBeVisible();
  expect(screen.queryByText(/999/)).not.toBeInTheDocument();
  expect(screen.queryByText(/updated/i)).not.toBeInTheDocument();
});
it('provides a keyboard-focusable native disclosure for measurements, preserving zeros and nullable values', async () => {
  setup({ result: firstModel() }); const user = userEvent.setup();
  const details = document.querySelector('details'); const summary = details.querySelector('summary');
  expect(details.open).toBe(false); expect(within(details).getByText('Humidity')).not.toBeVisible();
  await user.tab(); expect(summary).toHaveFocus();
  expect(details.firstElementChild).toBe(summary);
  // jsdom lacks the browser's native Enter/Space default action for summary.
  await user.click(summary); expect(details.open).toBe(true);
  expect(within(details).getByText('Wind speed')).toBeVisible(); expect(within(details).getByText('0 m/s')).toBeVisible();
  expect(within(details).getByText('0°')).toBeVisible(); expect(within(details).getByText('UV index')).toBeVisible();
  expect(within(details).getByText('Feels like 0 °C')).toBeVisible(); expect(within(details).getByText('Feels like —')).toBeVisible();
  expect(within(details).getByText('—')).toBeVisible(); await user.click(summary); expect(details.open).toBe(false);
});
it('keeps missing details compact and never prints null, undefined or nonfinite measurements', () => {
  const result = weatherEnvelope(); result.data.days[0].model = { date: '2027-06-01', lowC: null, highC: NaN, condition: null, windSpeedMs: undefined };
  setup({ result }); fireEvent.click(document.querySelector('summary'));
  expect(screen.getByText('Condition unavailable')).toBeVisible();
  expect(screen.getByText('Additional measurements are unavailable.')).toBeVisible();
  expect(document.body.textContent).not.toMatch(/null|undefined|NaN/); expect(screen.queryByText('Wind speed')).not.toBeInTheDocument();
});
it('distinguishes missing provider data, failed dates, and one partial notice', () => {
  const result = weatherEnvelope(); result.data.days[1].reason.message = 'No usable weather data.'; result.data.days[2].error.message = 'Please retry.'; setup({ result });
  expect(screen.getByText('Unavailable: No usable weather data.')).toBeVisible();
  expect(screen.getByText('Retrieval error: Please retry.')).toBeVisible();
  expect(screen.getAllByText(/Some dates could not/)).toHaveLength(1);
  expect(document.querySelectorAll('details')).toHaveLength(1);
  expect(document.querySelectorAll('summary [aria-live]')).toHaveLength(0);
});
it('shows every allocated day before explicit retrieval without inventing weather', () => {
  setup({ result: null }); expect(screen.getAllByText('Weather not requested.')).toHaveLength(3);
  expect(document.querySelectorAll('details')).toHaveLength(0);
});
it('keeps a 42-day itinerary as 42 individual rows with departure excluded', () => {
  const saved = savedTrip(); const end = addCalendarDays(saved.draft.startDate, 42);
  saved.draft = { ...saved.draft, endDate: end, destinations: [{ ...saved.draft.destinations[0], departureDate: end }] };
  setup({ saved, result: null }); expect(screen.getAllByText('Weather not requested.')).toHaveLength(42);
  expect(screen.getByText('42 covered days')).toBeVisible();
});
it('uses returned standard classification and night icons without highlighting ordinary cache hits', () => {
  const result = weatherEnvelope();
  Object.assign(result.data.days[0].model, { forecastType: 'standard', forecastLabel: 'Standard forecast', condition: { id: 800, main: 'Clear', description: 'clear night', icon: '01n' } });
  result.data.days[0].meta = { stale: false, cached: true };
  setup({ result }); expect(screen.getByText('Standard forecast')).toBeVisible();
  expect(document.querySelector('[data-icon="moon"]')).not.toBeNull();
  expect(screen.queryByText('Older cached weather')).not.toBeInTheDocument();
  expect(screen.queryByText(/% precipitation chance/)).not.toBeInTheDocument();
});

it('keeps destination headings below the Trip weather section heading', () => {
  setup();
  expect(screen.getByRole('heading', { name: 'Trip weather', level: 3 })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Paris, FR', level: 4 })).toBeVisible();
});

it('shows primary clothing advice collapsed and additional guidance on expansion', () => {
  const result = weatherEnvelope();
  Object.assign(result.data.days[0].model, { forecastType: 'standard', lowC: 2,
    precipitationProbability: .8, windSpeedMs: 10, uvIndex: 7 });
  setup({ result });
  const details = document.querySelector('details');
  expect(within(details.querySelector('summary')).getByText('Rain jacket and warm layers')).toBeVisible();
  expect(within(details).getByText('Choose a windproof rain jacket with a secure hood')).not.toBeVisible();
  fireEvent.click(details.querySelector('summary'));
  expect(within(details).getByText('Choose a windproof rain jacket with a secure hood')).toBeVisible();
  expect(within(details).getByText('Sunscreen, sunglasses and a sun hat')).toBeVisible();
});
it('labels long-range clothing advice provisional in summary and details', () => {
  const result = firstModel(); setup({ result });
  const details = document.querySelector('details');
  expect(within(details.querySelector('summary')).getByText(/^Provisional:/)).toBeVisible();
  fireEvent.click(details.querySelector('summary'));
  expect(within(details).getByText('Clothing advice — provisional')).toBeVisible();
  expect(within(details).getByText(/check again closer to departure/)).toBeVisible();
});
it('shows cautious missing-data advice without inventing clothing needs', () => {
  const result = weatherEnvelope(); result.data.days[0].model = { lowC: null, highC: null };
  setup({ result });
  expect(within(document.querySelector('summary')).getByText('Not enough weather signals for specific clothing advice')).toBeVisible();
});
it('shows useful mild clear-weather advice with no unnecessary expanded list', () => {
  const result = weatherEnvelope();
  result.data.days[0].model = { forecastType: 'standard', lowC: 18.05, highC: 24.59,
    condition: { id: 800, description: 'clear sky' }, precipitationProbability: 0, windSpeedMs: 3.83, uvIndex: 5.53 };
  setup({ result });
  const details = document.querySelector('details');
  expect(within(details.querySelector('summary')).getByText('Light clothing and sunglasses')).toBeVisible();
  fireEvent.click(details.querySelector('summary'));
  expect(details.querySelector('.trip-clothing-details ul')).toBeNull();
});
