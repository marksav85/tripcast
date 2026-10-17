import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import App from '../src/client/App.jsx';
import { AuthContext } from '../src/client/auth/context.js';
import { WeatherProvider } from '../src/client/context/WeatherContextProvider.jsx';
import { loadMyTrip, saveMyTrip, deleteMyTrip } from '../src/client/api/trips.js';
import { getTripWeather } from '../src/client/api/tripWeather.js';
import { savedTrip, tripDraft, weatherEnvelope } from './fixtures/tripWeather.js';
import { deferred, berlin, daySummary } from './fixtures/weather.js';
import { fetchMock, apiResponse } from './fixtures/api.js';
vi.mock('../src/client/api/trips.js', () => ({ loadMyTrip: vi.fn(), saveMyTrip: vi.fn(), deleteMyTrip: vi.fn() }));
vi.mock('../src/client/api/tripWeather.js', () => ({ getTripWeather: vi.fn() }));
const ok = data => ({ ok: true, data, error: null });
const fail = (code = 'SERVICE_UNAVAILABLE') => ({ ok: false, data: null, error: { code, message: code === 'CONFLICT' ? 'Reload your saved trip.' : 'Service unavailable.' } });
const click = name => fireEvent.click(screen.getByRole('button', { name, exact: true }));
const change = (name, value) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
function setup(user = 'a', loading = false) {
  const view = (owner, restoring = false) => <AuthContext.Provider value={{ isAuthenticated: Boolean(owner), loading: restoring, user: owner ? { id: owner } : null }}>
    <WeatherProvider><App /></WeatherProvider>
  </AuthContext.Provider>;
  return { ...render(view(user, loading)), view };
}
async function dashboard() { click('My Trip'); await screen.findByRole('heading', { name: 'Summer' }); }
async function weather() { click('Get Weather'); await screen.findByText(/Some dates could not/); }
beforeEach(() => {
  vi.resetAllMocks(); loadMyTrip.mockResolvedValue(ok(savedTrip()));
  const value = weatherEnvelope(); value.data.days[1].reason.message = 'Outside the weather range.'; value.data.days[2].error.message = 'Could not retrieve this day.';
  getTripWeather.mockResolvedValue({ ok: true, ...value, error: null });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
it('preserves anonymous public weather and does not load trips during session restoration', async () => {
  const { rerender, view } = setup(null, true);
  expect(screen.queryByRole('button', { name: 'My Trip' })).not.toBeInTheDocument();
  expect(loadMyTrip).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(apiResponse([berlin])).mockResolvedValueOnce(apiResponse(daySummary));
  change('City:', 'Berlin'); change('Date of travel:', daySummary.date); click('Submit'); await screen.findByText('Weather loaded.');
  rerender(view('a')); await waitFor(() => expect(loadMyTrip).toHaveBeenCalledTimes(1));
  click('My Trip'); expect(await screen.findByRole('heading', { name: 'Summer' })).toBeVisible();
});
it('distinguishes loading, load failure and a successful empty load', async () => {
  const pending = deferred(); loadMyTrip.mockReturnValueOnce(pending.promise); setup(); click('My Trip');
  expect(screen.getByRole('status')).toHaveTextContent('Loading saved trip');
  expect(screen.queryByRole('button', { name: 'Create Trip' })).not.toBeInTheDocument();
  await act(async () => pending.resolve(fail())); expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable');
  expect(screen.queryByRole('region', { name: 'No saved trip' })).not.toBeInTheDocument();
  loadMyTrip.mockResolvedValueOnce(ok(null)); click('Retry loading trip');
  expect(await screen.findByRole('region', { name: 'No saved trip' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Create Trip' })).toBeEnabled(); expect(getTripWeather).not.toHaveBeenCalled();
});
it('preserves the same lifecycle and public form across repeated navigation', async () => {
  setup(); change('City:', 'Unsubmitted public city'); await dashboard();
  expect(screen.getByText(/3 covered days/)).toBeVisible();
  expect(screen.getByText('Weather dates: 1 June 2027 – 3 June 2027')).toBeVisible();
  await weather(); expect(getTripWeather).toHaveBeenCalledWith({ draft: tripDraft, expectedUserId: 'a', signal: expect.any(AbortSignal) });
  click('Single-city weather'); expect(screen.getByLabelText('City:')).toHaveValue('Unsubmitted public city');
  click('My Trip'); expect(screen.getByText(/Some dates could not/)).toBeVisible();
  expect(loadMyTrip).toHaveBeenCalledTimes(1); expect(getTripWeather).toHaveBeenCalledTimes(1);
});
it('preserves weather through unsaved edits and Discard, with focus moving between views', async () => {
  setup(); await dashboard(); await weather(); click('Edit Trip');
  expect(screen.getByRole('heading', { name: 'Edit Trip' })).toHaveFocus();
  change('Trip title', 'Unsaved'); click('Discard changes');
  expect(screen.getByRole('heading', { name: 'My Trip' })).toHaveFocus();
  expect(screen.getByText(/Some dates could not/)).toBeVisible(); click('Edit Trip'); expect(screen.getByLabelText('Trip title')).toHaveValue('Summer');
  expect(loadMyTrip).toHaveBeenCalledTimes(1); expect(getTripWeather).toHaveBeenCalledTimes(1); expect(saveMyTrip).not.toHaveBeenCalled();
});
it('confirms Back and navigation without saving, retaining edits if leaving is declined', async () => {
  setup(); await dashboard(); click('Edit Trip'); change('Trip title', 'Unsaved');
  window.confirm.mockReturnValueOnce(false); click('Back to My Trip'); expect(screen.getByLabelText('Trip title')).toHaveValue('Unsaved');
  window.confirm.mockReturnValueOnce(false); click('Single-city weather'); expect(screen.getByLabelText('Trip title')).toBeVisible();
  click('Back to My Trip'); click('Edit Trip'); expect(screen.getByLabelText('Trip title')).toHaveValue('Summer');
  click('Single-city weather'); expect(screen.getByLabelText('City:')).toBeVisible(); expect(saveMyTrip).not.toHaveBeenCalled(); expect(deleteMyTrip).not.toHaveBeenCalled();
});
it('returns to dashboard after saving the canonical revision and invalidates weather', async () => {
  saveMyTrip.mockResolvedValue(ok(savedTrip(2, 'Canonical'))); setup(); await dashboard(); await weather();
  click('Edit Trip'); change('Trip title', 'Edited'); click('Save Trip');
  expect(await screen.findByRole('heading', { name: 'Canonical' })).toBeVisible();
  expect(saveMyTrip).toHaveBeenCalledWith({ tripId: savedTrip().id, expectedRevision: 1, draft: { ...tripDraft, title: 'Edited' } });
  expect(screen.queryByText(/Some dates could not/)).not.toBeInTheDocument(); expect(getTripWeather).toHaveBeenCalledTimes(1);
  click('Edit Trip'); change('Trip title', 'Discard me'); click('Discard changes'); click('Edit Trip'); expect(screen.getByLabelText('Trip title')).toHaveValue('Canonical');
});
it('creates the first trip through the existing editor without fetching unsaved weather', async () => {
  loadMyTrip.mockResolvedValue(ok(null)); saveMyTrip.mockResolvedValue(ok(savedTrip())); setup(); click('My Trip');
  fireEvent.click(await screen.findByRole('button', { name: 'Create Trip' }));
  change('Trip title', tripDraft.title); change('Trip arrival date', tripDraft.startDate); change('Trip departure date', tripDraft.endDate); click('Add destination');
  fetchMock.mockResolvedValueOnce(apiResponse([{ name: 'Paris', country: 'FR', lat: 48.8566, lon: 2.3522 }]));
  change('Search city', 'Paris'); click('Search'); fireEvent.click(await screen.findByRole('button', { name: 'Paris, FR' }));
  change('Destination 1 arrival', tripDraft.startDate); change('Destination 1 departure', tripDraft.endDate);
  expect(getTripWeather).not.toHaveBeenCalled(); click('Save Trip');
  expect(await screen.findByRole('heading', { name: 'Summer' })).toBeVisible(); expect(screen.getByRole('button', { name: 'Get Weather' })).toBeEnabled();
});
it('preserves failed saves and confirms conflict reload before replacing edits and weather', async () => {
  saveMyTrip.mockResolvedValueOnce(fail()).mockResolvedValueOnce(fail('CONFLICT')); setup(); await dashboard(); await weather(); click('Edit Trip'); change('Trip title', 'Unsaved');
  click('Save Trip'); await screen.findByRole('alert'); expect(screen.getByLabelText('Trip title')).toHaveValue('Unsaved');
  click('Save Trip'); await screen.findByText('Reload your saved trip.'); expect(screen.getByRole('button', { name: 'Save Trip' })).toBeDisabled();
  window.confirm.mockReturnValueOnce(false); click('Reload saved trip'); expect(loadMyTrip).toHaveBeenCalledTimes(1);
  loadMyTrip.mockResolvedValueOnce(ok(savedTrip(4, 'Latest'))); click('Reload saved trip'); await screen.findByDisplayValue('Latest'); click('Discard changes');
  expect(screen.queryByText(/Some dates could not/)).not.toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Latest' })).toBeVisible();
});
it('confirms deletion, preserves trip/weather on failure, and cancels weather on success', async () => {
  deleteMyTrip.mockResolvedValueOnce(fail()).mockResolvedValueOnce(ok({ deleted: true })); setup(); await dashboard(); await weather();
  window.confirm.mockReturnValueOnce(false); click('Delete Trip'); expect(deleteMyTrip).not.toHaveBeenCalled();
  click('Delete Trip'); await screen.findByRole('alert'); expect(screen.getByText(/Some dates could not/)).toBeVisible();
  const pending = deferred(); getTripWeather.mockReturnValue(pending.promise); click('Refresh Weather'); const signal = getTripWeather.mock.calls[1][0].signal;
  click('Delete Trip'); expect(await screen.findByRole('region', { name: 'No saved trip' })).toBeVisible(); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ ok: true, ...weatherEnvelope(), error: null })); expect(screen.queryByRole('region', { name: 'Trip weather' })).not.toBeInTheDocument();
});
it('presents partial outcomes, cancellation and safe request errors', async () => {
  setup(); await dashboard(); await weather(); const region = within(screen.getByRole('region', { name: 'Trip weather' }));
  expect(region.getByText(/Minimum 0 °C/)).toBeVisible(); expect(region.getByText(/Unavailable: Outside/)).toBeVisible(); expect(region.getByText(/Retrieval error: Could not/)).toBeVisible();
  const pending = deferred(); getTripWeather.mockReturnValueOnce(pending.promise); click('Refresh Weather'); expect(screen.getByRole('button', { name: 'Get Weather' })).toBeDisabled();
  click('Cancel weather request'); expect(screen.getByText('Weather request cancelled.')).toBeVisible();
  getTripWeather.mockResolvedValueOnce(fail()); click('Refresh Weather'); expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
  await act(async () => pending.resolve({ ok: true, ...weatherEnvelope(), error: null })); expect(screen.queryByText(/Some dates could not/)).not.toBeInTheDocument();
});
it.each(['b', null])('isolates pending work on account change/sign-out %s', async owner => {
  const pending = deferred(); getTripWeather.mockReturnValue(pending.promise); const { rerender, view } = setup(); await dashboard(); click('Get Weather');
  const signal = getTripWeather.mock.calls[0][0].signal; loadMyTrip.mockResolvedValueOnce(ok(savedTrip(1, 'Account B'))); rerender(view(owner)); expect(signal.aborted).toBe(true);
  expect(screen.queryByRole('heading', { name: 'Summer' })).not.toBeInTheDocument();
  if (owner) { click('My Trip'); expect(await screen.findByRole('heading', { name: 'Account B' })).toBeVisible(); }
  await act(async () => pending.resolve({ ok: true, ...weatherEnvelope(), error: null })); expect(screen.queryByText(/Some dates could not/)).not.toBeInTheDocument();
});
