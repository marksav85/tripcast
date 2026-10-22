import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import useSavedTrip from '../src/client/hooks/useSavedTrip.js';
import useTripWeather from '../src/client/hooks/useTripWeather.js';
import { loadMyTrip, saveMyTrip, deleteMyTrip } from '../src/client/api/trips.js';
import { getTripWeather } from '../src/client/api/tripWeather.js';
import { savedTrip, weatherEnvelope } from './fixtures/tripWeather.js';
import { deferred } from './fixtures/weather.js';
vi.mock('../src/client/api/trips.js', () => ({
  loadMyTrip: vi.fn(),
  saveMyTrip: vi.fn(),
  deleteMyTrip: vi.fn(),
}));
vi.mock('../src/client/api/tripWeather.js', () => ({ getTripWeather: vi.fn() }));
const ok = (data) => ({ ok: true, data, error: null });
const weatherResult = () => ({ ok: true, ...weatherEnvelope(), error: null });
beforeEach(() => {
  vi.resetAllMocks();
  loadMyTrip.mockResolvedValue(ok(savedTrip()));
  getTripWeather.mockResolvedValue(weatherResult());
});
function useLifecycle(ownerId) {
  const trip = useSavedTrip(ownerId);
  const weather = useTripWeather({
    saved: trip.saved,
    ownerId,
    version: trip.version,
    disabled: Boolean(trip.busy) || trip.blocked,
  });
  return { trip, weather };
}
it('invalidates weather after a successful reload without remounting, but preserves it on failed reload', async () => {
  const { result } = renderHook(() => useLifecycle('a'));
  await waitFor(() => expect(result.current.trip.loaded).toBe(true));
  await act(() => result.current.weather.refresh());
  expect(result.current.weather.result.data.days.map((d) => d.status)).toEqual([
    'available',
    'unavailable',
    'error',
  ]);
  loadMyTrip.mockResolvedValueOnce({
    ok: false,
    error: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' },
  });
  await act(() => result.current.trip.load());
  expect(result.current.weather.result).not.toBeNull();
  // Even an identical object returned by the API is a newly accepted baseline.
  loadMyTrip.mockResolvedValueOnce(ok(result.current.trip.saved));
  await act(() => result.current.trip.load());
  expect(result.current.weather.result).toBeNull();
  expect(getTripWeather).toHaveBeenCalledTimes(1);
});
it('isolates account changes and sign-out without requiring a keyed parent', async () => {
  const oldSave = deferred();
  saveMyTrip.mockReturnValue(oldSave.promise);
  const { result, rerender } = renderHook(({ owner }) => useLifecycle(owner), {
    initialProps: { owner: 'a' },
  });
  await waitFor(() => expect(result.current.trip.loaded).toBe(true));
  act(() => {
    void result.current.trip.save(savedTrip().draft);
  });
  const pendingWeather = deferred();
  getTripWeather.mockReturnValue(pendingWeather.promise);
  // A pending mutation disables weather. Complete it before starting weather work.
  await act(async () => oldSave.resolve(ok(savedTrip(2))));
  act(() => {
    void result.current.weather.refresh();
  });
  const signal = getTripWeather.mock.calls[0][0].signal;
  loadMyTrip.mockResolvedValueOnce(ok(savedTrip(1, 'Account B')));
  rerender({ owner: 'b' });
  expect(result.current.trip.saved).toBeNull();
  expect(result.current.weather.result).toBeNull();
  expect(signal.aborted).toBe(true);
  await waitFor(() => expect(result.current.trip.saved?.draft.title).toBe('Account B'));
  await act(async () => pendingWeather.resolve(weatherResult()));
  expect(result.current.weather.result).toBeNull();
  rerender({ owner: null });
  expect(result.current.trip.saved).toBeNull();
  await act(() => result.current.weather.refresh());
  expect(getTripWeather).toHaveBeenCalledTimes(1);
  expect(loadMyTrip).toHaveBeenCalledTimes(2);
});
it('ignores late loads when the same mounted hook changes accounts', async () => {
  const pending = deferred();
  loadMyTrip.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(ok(savedTrip(1, 'B')));
  const { result, rerender } = renderHook(({ owner }) => useSavedTrip(owner), {
    initialProps: { owner: 'a' },
  });
  await waitFor(() => expect(loadMyTrip).toHaveBeenCalledTimes(1));
  rerender({ owner: 'b' });
  await waitFor(() => expect(result.current.saved?.draft.title).toBe('B'));
  await act(async () => pending.resolve(ok(savedTrip(1, 'A'))));
  expect(result.current.saved.draft.title).toBe('B');
});
it('clears and aborts weather on deletion without remounting', async () => {
  deleteMyTrip.mockResolvedValue(ok({ deleted: true }));
  const pending = deferred();
  getTripWeather.mockReturnValue(pending.promise);
  const { result, unmount } = renderHook(() => useLifecycle('a'));
  await waitFor(() => expect(result.current.trip.loaded).toBe(true));
  act(() => {
    void result.current.weather.refresh();
  });
  const signal = getTripWeather.mock.calls[0][0].signal;
  await act(() => result.current.trip.remove());
  expect(signal.aborted).toBe(true);
  expect(result.current.weather.loading).toBe(false);
  await act(async () => pending.resolve(weatherResult()));
  expect(result.current.weather.result).toBeNull();
  await act(() => result.current.weather.refresh());
  expect(getTripWeather).toHaveBeenCalledTimes(1);
  unmount();
});
