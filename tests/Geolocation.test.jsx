import { fetchMock, apiResponse } from './fixtures/api';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Destination from '../src/client/components/destination/Destination';
import Weather from '../src/client/components/weather/Weather';
import { WeatherProvider } from '../src/client/context/WeatherContextProvider';
import { berlin, daySummary, deferred } from './fixtures/weather';

function setup() {
  let success;
  let failure;
  const getCurrentPosition = vi.fn((yes, no) => { success = yes; failure = no; });
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  const rendered = render(<WeatherProvider><Destination /><Weather /></WeatherProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Use current location' }));
  return { ...rendered, getCurrentPosition,
    succeed: async () => act(async () => success({ coords: { latitude: 52.521, longitude: 13.406 } })),
    fail: (code) => act(() => failure({ code, message: 'sensitive raw error' })),
  };
}

describe('geolocation lifecycle', () => {
  it('retains GPS coordinates and does not forward-geocode the city again', async () => {
    fetchMock.mockResolvedValueOnce(apiResponse([berlin])).mockResolvedValueOnce(apiResponse(daySummary));
    const geo = setup();
    expect(screen.getByText('Getting your location…')).toBeVisible();
    expect(geo.getCurrentPosition.mock.calls[0][2]).toMatchObject({ timeout: 10000, enableHighAccuracy: false });
    await geo.succeed();
    expect(screen.getByLabelText('City:')).toHaveValue('Berlin');
    fireEvent.change(screen.getByLabelText('Date of travel:'), { target: { value: daySummary.date } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByText('Weather loaded.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ lat: 52.521, lon: 13.406 });
  });

  it.each([[1, /permission denied/], [2, /Your location is unavailable/], [3, /timed out/]])('handles browser error %i and allows retry', (code, message) => {
    const geo = setup(); geo.fail(code);
    expect(screen.getByText(message)).toBeVisible();
    expect(screen.queryByText('sensitive raw error')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use current location' }));
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it('handles unsupported geolocation while preserving manual lookup', () => {
    vi.stubGlobal('navigator', {});
    render(<WeatherProvider><Destination /><Weather /></WeatherProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Use current location' }));
    expect(screen.getByText(/Geolocation is not supported/)).toBeVisible();
    expect(screen.getByLabelText('City:')).toBeEnabled();
  });

  it.each(['reset', 'city', 'date', 'submit', 'unmount'])('ignores a late geolocation success after %s', async (action) => {
    const geo = setup();
    if (action === 'reset') fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    if (action === 'city') fireEvent.change(screen.getByLabelText('City:'), { target: { value: 'Paris' } });
    if (action === 'date') fireEvent.change(screen.getByLabelText('Date of travel:'), { target: { value: daySummary.date } });
    if (action === 'submit') fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    if (action === 'unmount') geo.unmount();
    await geo.succeed();
    expect(fetchMock).not.toHaveBeenCalled();
    if (action !== 'unmount') expect(screen.getByLabelText('City:')).toHaveValue(action === 'city' ? 'Paris' : '');
  });

  it('ignores a late permission failure after reset', () => {
    const geo = setup(); fireEvent.click(screen.getByRole('button', { name: 'Reset' })); geo.fail(1);
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });

  it('aborts reverse geocoding and ignores its response after reset', async () => {
    const pending = deferred(); fetchMock.mockReturnValueOnce(pending.promise);
    const geo = setup();
    // Do not await callback's pending reverse lookup.
    void geo.succeed();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1].signal;
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await act(async () => pending.resolve(apiResponse([berlin])));
    expect(signal.aborted).toBe(true);
    expect(screen.getByLabelText('City:')).toHaveValue('');
  });

  it.each([['empty', []], ['malformed', {}]])('handles %s reverse results', async (kind, data) => {
    fetchMock.mockResolvedValueOnce(apiResponse(data));
    const geo = setup(); await geo.succeed();
    expect(screen.getByText(kind === 'empty' ? /No city found/ : /invalid response/)).toBeVisible();
    expect(screen.getByLabelText('City:')).toHaveValue('');
  });

  it('handles reverse lookup network errors without leaking URLs', async () => {
    fetchMock.mockRejectedValueOnce(new Error('https://provider?appid=sensitive'));
    const geo = setup(); await geo.succeed();
    expect(screen.getByText(/Location lookup failed/)).toBeVisible();
    expect(screen.queryByText(/sensitive/)).not.toBeInTheDocument();
  });
});
