import { fetchMock, apiResponse, apiError } from './fixtures/api';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Destination from '../src/client/components/destination/Destination';
import Weather from '../src/client/components/weather/Weather';
import { WeatherProvider } from '../src/client/context/WeatherContextProvider';
import { berlin, londonUK, londonCA, daySummary, deferred } from './fixtures/weather';

function app() {
  return render(<WeatherProvider><Destination /><Weather /></WeatherProvider>);
}
function fill(city = 'Berlin', date = '2026-10-13') {
  fireEvent.change(screen.getByLabelText('City:'), { target: { value: city } });
  fireEvent.change(screen.getByLabelText('Date of travel:'), { target: { value: date } });
}
function submit() { fireEvent.click(screen.getByRole('button', { name: 'Search Weather' })); }
async function success() { await screen.findByText('Weather loaded.'); }
const response = apiResponse;

// Fetch mocks intentionally ignore AbortSignal in race tests; generation guards
// must still suppress a completion after abort or after a newer request.
describe('single-city lookup regression', () => {
  it('loads normalized weather and keeps the submitted city distinct from edits', async () => {
    fetchMock.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response(daySummary));
    app(); fill(); submit(); await success();
    expect(screen.getByRole('heading', { name: 'Berlin, DE' })).toBeVisible();
    expect(screen.getByText('15°C')).toBeVisible();
    expect(screen.getByText('0°C')).toBeVisible();
    expect(screen.getByText('0 mm')).toBeVisible();
    expect(screen.queryByText(/average|Extreme Rain|Sunny/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('City:'), { target: { value: 'Paris' } });
    expect(screen.getByRole('heading', { name: 'Berlin, DE' })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('submits the calendar-selected day unchanged and resets the controlled picker', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response(daySummary));
    app(); fill('Berlin', '2026-10-12');
    await user.click(screen.getByRole('button', { name: 'Open calendar for date of travel' }));
    await user.click(screen.getByRole('button', { name: /October 13th, 2026/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Date of travel:')).toHaveValue('13/10/2026');
    submit(); await success();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ lat: berlin.lat, lon: berlin.lon, date: '2026-10-13' });
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('Date of travel:')).toHaveValue('');
    expect(screen.getByLabelText('City:')).toHaveFocus();
  });

  it('retains selected coordinates for identical resubmission and a changed date', async () => {
    fetchMock.mockResolvedValueOnce(response([berlin])).mockImplementation(() => Promise.resolve(response(daySummary)));
    app(); fill(); submit(); await success(); submit(); await success();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fireEvent.change(screen.getByLabelText('Date of travel:'), { target: { value: '2026-10-14' } });
    fetchMock.mockResolvedValueOnce(response({ ...daySummary, date: '2026-10-14' }));
    submit(); await success();
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ lat: berlin.lat, lon: berlin.lon, date: '2026-10-14' });
  });

  it('reports empty results and permits correcting/resubmitting the city', async () => {
    fetchMock.mockResolvedValueOnce(response([]));
    app(); fill('Atlantis'); submit();
    await screen.findByText(/No matching city/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response(daySummary));
    fill(); submit(); await success();
  });

  it.each([{}, [null], [{ name: 'Berlin', country: 'DE', lat: '52', lon: 13 }]])('handles malformed geocoding: %j', async (data) => {
    fetchMock.mockResolvedValueOnce(response(data));
    app(); fill(); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/city service/);
    expect(screen.getByRole('button', { name: 'Search Weather' })).toBeEnabled();
  });

  it('supports ambiguity through focused keyboard-accessible candidate buttons', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response([londonUK, londonCA])).mockResolvedValueOnce(response(daySummary));
    app(); fill('London'); submit();
    const candidate = await screen.findByRole('button', { name: 'London, England, GB' });
    await waitFor(() => expect(candidate).toHaveFocus());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(screen.getByRole('button', { name: 'London, Ontario, CA' })).toHaveFocus();
    await user.keyboard('{Enter}'); await success();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ lat: londonCA.lat, lon: londonCA.lon });
    expect(screen.getByRole('heading', { name: 'London, Ontario, CA' })).toBeVisible();
  });

  it('retries a failed weather query without geocoding again, restoring its draft', async () => {
    fetchMock.mockResolvedValueOnce(response([berlin])).mockRejectedValueOnce(new Error('Network error'));
    app(); fill(); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Weather lookup failed/);
    fill('Paris', '2026-10-14');
    fetchMock.mockResolvedValueOnce(response(daySummary));
    fireEvent.click(screen.getByRole('button', { name: 'Retry last lookup' })); await success();
    expect(screen.getByLabelText('City:')).toHaveValue('Berlin');
    expect(screen.getByLabelText('Date of travel:')).toHaveValue('13/10/2026');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries failed geocoding with the identical query', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Offline'));
    app(); fill(); submit(); await screen.findByRole('alert');
    fetchMock.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response(daySummary));
    fireEvent.click(screen.getByRole('button', { name: 'Retry last lookup' })); await success();
    expect(new URL(fetchMock.mock.calls[1][0], 'http://localhost').searchParams.get('q')).toBe('Berlin');
  });

  it.each([
    [apiError('UPSTREAM_LIMIT', 503), /busy/],
    [apiError('UPSTREAM_ACCESS', 503), /access is unavailable/],
    [apiError('UPSTREAM_TIMEOUT', 504), /timed out/],
  ])('maps service failures safely: %j', async (error, message) => {
    fetchMock.mockResolvedValueOnce(error);
    app(); fill(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(fetchMock).toHaveBeenCalledTimes(1); // No automatic quota-consuming retries.
  });

  it.each(['geocode', 'weather'])('reset invalidates an in-flight %s completion', async (stage) => {
    const pending = deferred();
    if (stage === 'weather') fetchMock.mockResolvedValueOnce(response([berlin]));
    fetchMock.mockReturnValueOnce(pending.promise);
    app(); fill(); submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(stage === 'weather' ? 2 : 1));
    const signal = fetchMock.mock.calls.at(-1)[1].signal;
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(response(stage === 'weather' ? daySummary : [berlin])));
    expect(screen.getByText('Enter a city and date to see weather.')).toBeVisible();
    expect(screen.getByLabelText('City:')).toHaveValue('');
    expect(screen.getByLabelText('Date of travel:')).toHaveValue('');
    expect(screen.getByLabelText('City:')).toHaveFocus();
    expect(screen.queryByText('Weather loaded.')).not.toBeInTheDocument();
  });

  it.each(['resolve', 'reject'])('keeps a newer success when obsolete geocoding later %s', async (completion) => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    app(); fill('Old City'); submit();
    fill('Berlin');
    fetchMock.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response(daySummary));
    submit(); await success();
    await act(async () => pending[completion](completion === 'resolve' ? response([londonUK]) : new Error('late error')));
    expect(screen.getByRole('heading', { name: 'Berlin, DE' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('suppresses an older weather result while a replacement is still loading', async () => {
    const oldWeather = deferred(); const newWeather = deferred();
    fetchMock.mockResolvedValueOnce(response([berlin])).mockReturnValueOnce(oldWeather.promise);
    app(); fill(); submit(); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fill('London');
    fetchMock.mockResolvedValueOnce(response([londonUK])).mockReturnValueOnce(newWeather.promise);
    submit(); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await act(async () => oldWeather.resolve(response(daySummary)));
    expect(screen.getByRole('region', { name: 'Weather result' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Weather loaded.')).not.toBeInTheDocument();
    await act(async () => newWeather.resolve(response(daySummary))); await success();
    expect(screen.getByRole('heading', { name: 'London, England, GB' })).toBeVisible();
  });

  it('cancels on unmount without advancing to a weather request', async () => {
    const pending = deferred(); fetchMock.mockReturnValueOnce(pending.promise);
    const rendered = app(); fill(); submit(); const signal = fetchMock.mock.calls[0][1].signal;
    rendered.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(response([berlin])));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows unavailable or partial weather without inventing missing values', async () => {
    fetchMock.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response({ date: daySummary.date }));
    app(); fill(); submit(); await screen.findByText('Weather is unavailable for this location and date.');
    expect(screen.getAllByText('Unavailable')).toHaveLength(4);
    fetchMock.mockResolvedValueOnce(response({ date: daySummary.date, precipitation: { total: 0 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry last lookup' })); await success();
    expect(screen.getByText('0 mm')).toBeVisible();
    expect(screen.getAllByText('Unavailable')).toHaveLength(3);
  });

  it('rejects mismatched dates/malformed weather without crashing', async () => {
    fetchMock.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response({ ...daySummary, date: '2026-10-14' }));
    app(); fill(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent(/invalid date or response/);
  });

  it('validates empty city/date with focus and no fallback request', () => {
    app(); submit();
    expect(screen.getByLabelText('City:')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('City:')).toHaveFocus();
    expect(screen.getByLabelText('Date of travel:')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('provides one calendar control, typed date entry and Reset', () => {
    app();
    expect(screen.getByLabelText('City:')).toBeRequired();
    expect(screen.getByLabelText('Date of travel:')).toBeRequired();
    expect(screen.getByRole('button', { name: 'Use current location' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Open calendar for date of travel' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: "Use today's date" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Date of travel:'), { target: { value: '2026-10-13' } });
    expect(screen.getByLabelText('Date of travel:')).toHaveValue('2026-10-13');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('Date of travel:')).toHaveValue('');
  });

  it('retains parent validation for invalid typed dates and focuses the date field', () => {
    app(); fill('Berlin', '2027-02-29'); submit();
    expect(screen.getByLabelText('Date of travel:')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Date of travel:')).toHaveFocus();
    expect(screen.getByLabelText('Date of travel:')).toHaveValue('2027-02-29');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps city parameters separate from reserved URL characters', async () => {
    fetchMock.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response(daySummary));
    app(); fill('  München & units=imperial?  '); submit(); await success();
    const [url, options] = fetchMock.mock.calls[0];
    const parsed = new URL(url, 'http://localhost');
    expect(parsed.pathname).toBe('/api/geocode');
    expect(parsed.searchParams.get('q')).toBe('München & units=imperial?');
    expect(parsed.searchParams.has('units')).toBe(false);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('respects reduced motion while loading', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const pending = deferred(); fetchMock.mockReturnValueOnce(pending.promise);
    app(); fill(); submit();
    const result = screen.getByRole('region', { name: 'Weather result' });
    expect(within(result).getByText('Finding cities…')).toBeVisible();
    expect(within(result).queryByTestId('loading-indicator')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await act(async () => pending.resolve(response([])));
  });
});

it.each([['en-GB', '25/10/2026'], ['en-US', '10/25/2026'], ['de-DE', '25.10.2026']])('submits an ISO day from %s entry and resets an invalid draft', async (locale, typed) => {
  vi.stubGlobal('navigator', { language: locale });
  fetchMock.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response({ ...daySummary, date: '2026-10-25' }));
  app(); fill('Berlin', typed); submit(); await success();
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).date).toBe('2026-10-25');
  fireEvent.change(screen.getByLabelText('Date of travel:'), { target: { value: '31/02/2026' } });
  submit();
  expect(screen.getByLabelText('Date of travel:')).toHaveAttribute('aria-invalid', 'true');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(screen.getByLabelText('Date of travel:')).toHaveValue('');
});
