import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/client/auth/context.js';
import AuthenticatedTripEditor from '../src/client/components/trip/AuthenticatedTripEditor.jsx';
import { loadMyTrip, saveMyTrip, deleteMyTrip } from '../src/client/api/trips.js';
import { deferred } from './fixtures/weather';
vi.mock('../src/client/api/trips.js', () => ({ loadMyTrip: vi.fn(), saveMyTrip: vi.fn(), deleteMyTrip: vi.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const draft = { title: 'Summer', startDate: '2027-06-01', endDate: '2027-06-03', destinations: [
  { position: 0, cityName: 'Paris', countryCode: 'FR', region: null, lat: 48.8566, lon: 2.3522,
    timeZone: 'Europe/Paris', arrivalDate: '2027-06-01', departureDate: '2027-06-03' },
] };
const saved = (revision = 1, title = 'Summer') => ({ id, revision, draft: { ...draft, title } });
const ok = data => ({ ok: true, data, error: null });
const fail = (code = 'SERVICE_UNAVAILABLE') => ({ ok: false, data: null, error: { code, message: code === 'CONFLICT' ? 'Your saved trip has changed. Reload it before trying again.' : code === 'UNAUTHENTICATED' ? 'Sign in again to access your trip.' : 'Trip storage is unavailable. Please try again later.' } });
const auth = user => ({ isAuthenticated: Boolean(user), user: user ? { id: user } : null });
const changeTitle = title => fireEvent.change(screen.getByLabelText('Trip title'), { target: { value: title } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save Trip' }));
function setup(user = 'a') {
  const close = vi.fn();
  const view = userId => <AuthContext.Provider value={auth(userId)}><AuthenticatedTripEditor onClose={close} /></AuthContext.Provider>;
  return { ...render(view(user)), close, view };
}
beforeEach(() => {
  vi.resetAllMocks(); loadMyTrip.mockResolvedValue(ok(saved()));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
it('shows loading then an empty editor only after a successful no-trip load', async () => {
  const pending = deferred(); loadMyTrip.mockReturnValue(pending.promise); setup();
  expect(screen.getByText('Loading saved trip…')).toBeInTheDocument();
  expect(screen.queryByLabelText('Trip title')).not.toBeInTheDocument();
  await act(async () => pending.resolve(ok(null)));
  expect(screen.getByLabelText('Trip title')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Save Trip' })).toBeDisabled();
});
it('loads a saved trip and preserves edits across parent rerenders', async () => {
  const { rerender, view } = setup(); await screen.findByDisplayValue('Summer');
  changeTitle('Edited'); rerender(view('a')); expect(screen.getByLabelText('Trip title')).toHaveValue('Edited');
  expect(loadMyTrip).toHaveBeenCalledTimes(1);
});
it('keeps failed loading distinct from an empty trip and offers retry', async () => {
  loadMyTrip.mockResolvedValueOnce(fail()); setup(); await screen.findByRole('alert');
  expect(screen.queryByLabelText('Trip title')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Retry loading trip')); await screen.findByDisplayValue('Summer');
});
it('creates with a stable secure UUID across failures, preventing duplicate concurrent saves', async () => {
  loadMyTrip.mockResolvedValue(ok(null));
  const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);
  const pending = deferred(); saveMyTrip.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ok(saved()));
  setup(); await screen.findByLabelText('Trip title');
  changeTitle('Summer');
  fireEvent.change(screen.getByLabelText('Trip arrival date'), { target: { value: draft.startDate } });
  fireEvent.change(screen.getByLabelText('Trip departure date'), { target: { value: draft.endDate } });
  fireEvent.click(screen.getByRole('button', { name: 'Add destination' }));
  const { fetchMock, apiResponse } = await import('./fixtures/api');
  fetchMock.mockResolvedValueOnce(apiResponse([{ name: 'Paris', country: 'FR', lat: 48.8566, lon: 2.3522 }]));
  fireEvent.change(screen.getByLabelText('Search city'), { target: { value: 'Paris' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Paris, FR' }));
  fireEvent.change(screen.getByLabelText('Destination 1 arrival'), { target: { value: draft.startDate } });
  fireEvent.change(screen.getByLabelText('Destination 1 departure'), { target: { value: draft.endDate } });
  save(); save(); expect(saveMyTrip).toHaveBeenCalledTimes(1);
  expect(saveMyTrip).toHaveBeenLastCalledWith({ tripId: id, expectedRevision: 0, draft });
  await act(async () => pending.resolve(fail()));
  expect(screen.getByLabelText('Trip title')).toHaveValue('Summer'); save(); await screen.findByText('Trip saved.');
  expect(uuid).toHaveBeenCalledTimes(1);
  expect(saveMyTrip).toHaveBeenLastCalledWith({ tripId: id, expectedRevision: 0, draft });
});
it('uses returned revisions and refreshes the discard baseline after save', async () => {
  saveMyTrip.mockResolvedValueOnce(ok(saved(2, 'Canonical'))).mockResolvedValueOnce(ok(saved(3, 'Again')));
  setup(); await screen.findByDisplayValue('Summer'); changeTitle('Edited'); save();
  await screen.findByDisplayValue('Canonical');
  expect(saveMyTrip).toHaveBeenLastCalledWith({ tripId: id, expectedRevision: 1, draft: { ...draft, title: 'Edited' } });
  changeTitle('Unsaved'); fireEvent.click(screen.getByText('Discard changes'));
  expect(screen.getByLabelText('Trip title')).toHaveValue('Canonical');
  changeTitle('Again'); save(); await screen.findByText('Trip saved.');
  expect(saveMyTrip).toHaveBeenLastCalledWith({ tripId: id, expectedRevision: 2, draft: { ...draft, title: 'Again' } });
});
it.each(['SERVICE_UNAVAILABLE', 'INVALID_TRIP', 'UNAUTHENTICATED'])('preserves draft on save failure %s', async code => {
  saveMyTrip.mockResolvedValue(fail(code)); setup(); await screen.findByDisplayValue('Summer');
  changeTitle('Unsaved'); save(); await screen.findByRole('alert');
  expect(screen.getByLabelText('Trip title')).toHaveValue('Unsaved'); expect(screen.queryByText('Trip saved.')).not.toBeInTheDocument();
});
it('requires deletion confirmation and clears the editor after success', async () => {
  deleteMyTrip.mockResolvedValue(ok({ id, deleted: true })); setup(); await screen.findByDisplayValue('Summer');
  window.confirm.mockReturnValueOnce(false); fireEvent.click(screen.getByText('Delete Trip'));
  expect(deleteMyTrip).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Delete Trip')); await screen.findByText(/Trip deleted/);
  expect(deleteMyTrip).toHaveBeenCalledExactlyOnceWith({ tripId: id, expectedRevision: 1 });
  expect(screen.getByLabelText('Trip title')).toHaveValue('');
  expect(screen.queryByText('Delete Trip')).not.toBeInTheDocument();
});
it('preserves draft and disables conflicting operations while delete is pending or fails', async () => {
  const pending = deferred(); deleteMyTrip.mockReturnValue(pending.promise);
  setup(); await screen.findByDisplayValue('Summer'); changeTitle('Unsaved');
  fireEvent.click(screen.getByText('Delete Trip')); save();
  expect(saveMyTrip).not.toHaveBeenCalled();
  await act(async () => pending.resolve(fail()));
  expect(screen.getByLabelText('Trip title')).toHaveValue('Unsaved'); expect(screen.getByText('Delete Trip')).toBeEnabled();
});
it.each(['save', 'delete'])('handles %s conflict and confirms before reload replaces edits', async operation => {
  saveMyTrip.mockResolvedValue(fail('CONFLICT')); deleteMyTrip.mockResolvedValue(fail('CONFLICT'));
  setup(); await screen.findByDisplayValue('Summer'); changeTitle('Unsaved');
  if (operation === 'save') save(); else fireEvent.click(screen.getByText('Delete Trip'));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Trip title')).toHaveValue('Unsaved');
  expect(screen.getByRole('button', { name: 'Save Trip' })).toBeDisabled();
  expect(screen.getByText('Delete Trip')).toBeDisabled();
  window.confirm.mockReturnValueOnce(false); fireEvent.click(screen.getByText('Reload saved trip'));
  expect(loadMyTrip).toHaveBeenCalledTimes(1);
  loadMyTrip.mockResolvedValueOnce(ok(saved(4, 'Latest')));
  fireEvent.click(screen.getByText('Reload saved trip')); await screen.findByDisplayValue('Latest');
  expect(screen.getByRole('button', { name: 'Save Trip' })).toBeEnabled();
});
it('hides old account data immediately and ignores its late load', async () => {
  const pending = deferred(); loadMyTrip.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ok(saved(2, 'Account B')));
  const { rerender, view } = setup(); await waitFor(() => expect(loadMyTrip).toHaveBeenCalledTimes(1)); rerender(view('b')); await screen.findByDisplayValue('Account B');
  await act(async () => pending.resolve(ok(saved(1, 'Account A'))));
  expect(screen.queryByDisplayValue('Account A')).not.toBeInTheDocument();
  rerender(view(null)); expect(screen.queryByLabelText('Trip title')).not.toBeInTheDocument();
  expect(deleteMyTrip).not.toHaveBeenCalled();
});
it('ignores a late save after sign-out and does not leak it on re-entry', async () => {
  const pending = deferred(); saveMyTrip.mockReturnValue(pending.promise);
  const { rerender, view } = setup(); await screen.findByDisplayValue('Summer'); save();
  rerender(view(null)); await act(async () => pending.resolve(ok(saved(2, 'Old saved result'))));
  loadMyTrip.mockResolvedValueOnce(ok(null)); rerender(view('b'));
  await waitFor(() => expect(screen.getByLabelText('Trip title')).toHaveValue(''));
});
it('ignores a late load after close/unmount', async () => {
  const pending = deferred(); loadMyTrip.mockReturnValue(pending.promise);
  const { unmount } = setup(); unmount(); await act(async () => pending.resolve(ok(saved())));
  expect(screen.queryByLabelText('Trip title')).not.toBeInTheDocument();
});

it('preserves unsaved input if a confirmed conflict reload fails', async () => {
  saveMyTrip.mockResolvedValue(fail('CONFLICT')); setup(); await screen.findByDisplayValue('Summer');
  changeTitle('Unsaved'); save(); await screen.findByRole('alert');
  loadMyTrip.mockResolvedValueOnce(fail()); fireEvent.click(screen.getByText('Reload saved trip'));
  await screen.findByRole('alert'); expect(screen.getByLabelText('Trip title')).toHaveValue('Unsaved');
  expect(screen.getByRole('button', { name: 'Save Trip' })).toBeDisabled();
});
it('ignores a late deletion response after switching accounts', async () => {
  const pending = deferred(); deleteMyTrip.mockReturnValue(pending.promise);
  const { rerender, view } = setup(); await screen.findByDisplayValue('Summer');
  fireEvent.click(screen.getByText('Delete Trip'));
  loadMyTrip.mockResolvedValueOnce(ok(saved(3, 'Account B'))); rerender(view('b'));
  await screen.findByDisplayValue('Account B');
  await act(async () => pending.resolve(ok({ id, deleted: true })));
  expect(screen.getByLabelText('Trip title')).toHaveValue('Account B');
});
it('discard and close do not write or delete trips', async () => {
  const { close } = setup(); await screen.findByDisplayValue('Summer'); changeTitle('Unsaved');
  fireEvent.click(screen.getByText('Discard changes')); expect(screen.getByLabelText('Trip title')).toHaveValue('Summer');
  fireEvent.click(screen.getByText('Close editor')); expect(close).toHaveBeenCalledOnce();
  expect(saveMyTrip).not.toHaveBeenCalled(); expect(deleteMyTrip).not.toHaveBeenCalled();
});
