import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/client/auth/context.js';
import AuthenticatedTripEditor from '../src/client/components/trip/AuthenticatedTripEditor.jsx';
import { loadMyTrip, saveMyTrip, deleteMyTrip } from '../src/client/api/trips.js';
import { getTripWeather } from '../src/client/api/tripWeather.js';
import { savedTrip, tripDraft, weatherEnvelope } from './fixtures/tripWeather.js';
import { deferred } from './fixtures/weather.js';
vi.mock('../src/client/api/trips.js', () => ({ loadMyTrip: vi.fn(), saveMyTrip: vi.fn(), deleteMyTrip: vi.fn() }));
vi.mock('../src/client/api/tripWeather.js', () => ({ getTripWeather: vi.fn() }));
const ok = data => ({ ok: true, data, error: null });
const result = () => { const value = weatherEnvelope(); value.data.days[1].reason.message = 'Outside the weather range.'; value.data.days[2].error.message = 'Retrieval failed for this date.'; return { ok: true, ...value, error: null }; };
function setup() {
  const view = (user = 'a') => <AuthContext.Provider value={{ isAuthenticated: Boolean(user), user: user ? { id: user } : null }}><AuthenticatedTripEditor onClose={() => {}} /></AuthContext.Provider>;
  return { ...render(view()), view };
}
const refresh = () => fireEvent.click(screen.getByRole('button', { name: 'Refresh weather' }));
const title = value => fireEvent.change(screen.getByLabelText('Trip title'), { target: { value } });
beforeEach(() => {
  vi.resetAllMocks(); loadMyTrip.mockResolvedValue(ok(savedTrip())); getTripWeather.mockResolvedValue(result());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
it('makes no weather request for an empty saved trip', async () => {
  loadMyTrip.mockResolvedValue(ok(null)); setup(); await screen.findByText(/No saved trip/);
  expect(screen.queryByRole('button', { name: 'Refresh weather' })).not.toBeInTheDocument(); expect(getTripWeather).not.toHaveBeenCalled();
});
it('explicitly refreshes the saved baseline while edits and discard preserve it', async () => {
  setup(); await screen.findByDisplayValue('Summer'); expect(getTripWeather).not.toHaveBeenCalled();
  title('Unsaved'); refresh(); await screen.findByText(/Some dates could not/);
  expect(getTripWeather).toHaveBeenCalledWith({ draft: tripDraft, expectedUserId: 'a', signal: expect.any(AbortSignal) });
  expect(screen.getByRole('heading', { name: 'Saved trip weather: Summer' })).toBeInTheDocument();
  const headings = within(screen.getByLabelText('Saved trip weather preview')).getAllByRole('heading', { level: 3 }).map(el => el.textContent);
  expect(headings).toEqual(['Paris — 2027-06-01', 'Paris — 2027-06-02', 'Paris — 2027-06-03']);
  expect(screen.getByText(/Morning 0 °C/)).toBeInTheDocument(); expect(screen.getByText('Outside the weather range.')).toBeInTheDocument(); expect(screen.getByText('Retrieval failed for this date.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Discard changes')); expect(screen.getByLabelText('Trip title')).toHaveValue('Summer');
  expect(screen.getByText(/Some dates could not/)).toBeInTheDocument(); expect(getTripWeather).toHaveBeenCalledTimes(1);
});
it('invalidates weather after saving canonical changes and requests the new baseline', async () => {
  saveMyTrip.mockResolvedValue(ok(savedTrip(2, 'Saved update'))); setup(); await screen.findByDisplayValue('Summer');
  refresh(); await screen.findByText(/Some dates could not/); title('Edited'); fireEvent.click(screen.getByRole('button', { name: 'Save Trip' }));
  await screen.findByDisplayValue('Saved update'); expect(screen.queryByText(/Some dates could not/)).not.toBeInTheDocument();
  expect(getTripWeather).toHaveBeenCalledTimes(1); refresh(); await screen.findByText(/Some dates could not/);
  expect(getTripWeather.mock.calls[1][0].draft.title).toBe('Saved update');
});
it('makes weather available after saving the first trip', async () => {
  loadMyTrip.mockResolvedValue(ok(null)); saveMyTrip.mockResolvedValue(ok(savedTrip())); setup(); await screen.findByText(/No saved trip/);
  title('Summer'); fireEvent.change(screen.getByLabelText('Trip arrival date'), { target: { value: tripDraft.startDate } });
  fireEvent.change(screen.getByLabelText('Trip departure date'), { target: { value: tripDraft.endDate } });
  fireEvent.click(screen.getByText('Add destination'));
  const { fetchMock, apiResponse } = await import('./fixtures/api.js');
  fetchMock.mockResolvedValueOnce(apiResponse([{ name: 'Paris', country: 'FR', lat: 48.8566, lon: 2.3522 }]));
  fireEvent.change(screen.getByLabelText('Search city'), { target: { value: 'Paris' } }); fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Paris, FR' }));
  fireEvent.change(screen.getByLabelText('Destination 1 arrival'), { target: { value: tripDraft.startDate } });
  fireEvent.change(screen.getByLabelText('Destination 1 departure'), { target: { value: tripDraft.endDate } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Trip' })); await screen.findByText('Trip saved.');
  expect(screen.getByRole('button', { name: 'Refresh weather' })).toBeEnabled(); expect(getTripWeather).not.toHaveBeenCalled();
});
it('cancels obsolete requests on save and ignores their late responses', async () => {
  const pending = deferred(); getTripWeather.mockReturnValueOnce(pending.promise).mockResolvedValue(result());
  saveMyTrip.mockResolvedValue(ok(savedTrip(2, 'New baseline'))); setup(); await screen.findByDisplayValue('Summer'); refresh();
  title('Update'); fireEvent.click(screen.getByRole('button', { name: 'Save Trip' })); await screen.findByDisplayValue('New baseline');
  expect(getTripWeather.mock.calls[0][0].signal.aborted).toBe(true); refresh(); await screen.findByText(/Some dates could not/);
  const old = result(); old.data.days[0].model.condition.main = 'Obsolete storm'; await act(async () => pending.resolve(old));
  expect(screen.queryByText(/Obsolete storm/)).not.toBeInTheDocument();
});
it('blocks overlapping refreshes and supports explicit cancellation', async () => {
  const pending = deferred(); getTripWeather.mockReturnValue(pending.promise); setup(); await screen.findByDisplayValue('Summer'); refresh(); refresh();
  expect(getTripWeather).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Refresh weather' })).toBeDisabled();
  fireEvent.click(screen.getByText('Cancel weather request')); expect(getTripWeather.mock.calls[0][0].signal.aborted).toBe(true);
  expect(screen.getByText('Weather request cancelled.')).toBeInTheDocument();
  getTripWeather.mockResolvedValue(result()); refresh(); await screen.findByText(/Some dates could not/);
  await act(async () => pending.resolve({ ok: false, error: { message: 'Old error' } })); expect(screen.queryByText('Old error')).not.toBeInTheDocument();
});
it('deletes weather together with the saved baseline', async () => {
  deleteMyTrip.mockResolvedValue(ok({ deleted: true })); setup(); await screen.findByDisplayValue('Summer'); refresh(); await screen.findByText(/Some dates could not/);
  fireEvent.click(screen.getByText('Delete Trip')); await screen.findByText(/Trip deleted/);
  expect(screen.queryByLabelText('Saved trip weather preview')).not.toBeInTheDocument();
});
it.each(['b', null])('clears and cancels weather on account change/sign-out %s', async user => {
  const pending = deferred(); getTripWeather.mockReturnValue(pending.promise); const { rerender, view } = setup(); await screen.findByDisplayValue('Summer'); refresh();
  loadMyTrip.mockResolvedValue(ok(savedTrip(1, 'Account B'))); rerender(view(user));
  expect(getTripWeather.mock.calls[0][0].signal.aborted).toBe(true);
  await act(async () => pending.resolve(result())); expect(screen.queryByText(/Some dates could not/)).not.toBeInTheDocument();
});
it('cancels on close/unmount and does not retain weather when reopened', async () => {
  const pending = deferred(); getTripWeather.mockReturnValue(pending.promise); const { unmount } = setup(); await screen.findByDisplayValue('Summer'); refresh();
  unmount(); expect(getTripWeather.mock.calls[0][0].signal.aborted).toBe(true); await act(async () => pending.resolve(result()));
  setup(); await screen.findByDisplayValue('Summer'); expect(screen.queryByText(/Some dates could not/)).not.toBeInTheDocument();
});
it('shows safe request errors and retry information', async () => {
  getTripWeather.mockResolvedValue({ ok: false, error: { code: 'RATE_LIMITED', message: 'Please wait before refreshing.', retryAfter: 60 } });
  setup(); await screen.findByDisplayValue('Summer'); refresh(); expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 60 seconds.');
});
