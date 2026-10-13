import axios from 'axios';
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
function submit() { fireEvent.click(screen.getByRole('button', { name: 'Submit' })); }
async function success() { await screen.findByText('Weather loaded.'); }
const response = (data) => ({ data });

// Axios mocks intentionally ignore AbortSignal in race tests; generation guards
// must still suppress a completion after abort or after a newer request.
describe('single-city lookup regression', () => {
  it('loads normalized weather and keeps the submitted city distinct from edits', async () => {
    axios.get.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response(daySummary));
    app(); fill(); submit(); await success();
    expect(screen.getByRole('heading', { name: 'Berlin, DE' })).toBeVisible();
    expect(screen.getByText('15°C')).toBeVisible();
    expect(screen.getByText('0°C')).toBeVisible();
    expect(screen.getByText('0 mm')).toBeVisible();
    expect(screen.queryByText(/average|Extreme Rain|Sunny/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('City:'), { target: { value: 'Paris' } });
    expect(screen.getByRole('heading', { name: 'Berlin, DE' })).toBeVisible();
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('retains selected coordinates for identical resubmission and a changed date', async () => {
    axios.get.mockResolvedValueOnce(response([berlin])).mockResolvedValue(response(daySummary));
    app(); fill(); submit(); await success(); submit(); await success();
    expect(axios.get).toHaveBeenCalledTimes(3);
    fireEvent.change(screen.getByLabelText('Date of travel:'), { target: { value: '2026-10-14' } });
    axios.get.mockResolvedValueOnce(response({ ...daySummary, date: '2026-10-14' }));
    submit(); await success();
    expect(axios.get.mock.calls[3][1].params).toMatchObject({ lat: berlin.lat, lon: berlin.lon, date: '2026-10-14', units: 'metric' });
  });

  it('reports empty results and permits correcting/resubmitting the city', async () => {
    axios.get.mockResolvedValueOnce(response([]));
    app(); fill('Atlantis'); submit();
    await screen.findByText(/No matching city/);
    expect(axios.get).toHaveBeenCalledTimes(1);
    axios.get.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response(daySummary));
    fill(); submit(); await success();
  });

  it.each([{}, [null], [{ name: 'Berlin', country: 'DE', lat: '52', lon: 13 }]])('handles malformed geocoding: %j', async (data) => {
    axios.get.mockResolvedValueOnce(response(data));
    app(); fill(); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/city service/);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  it('supports ambiguity through focused keyboard-accessible candidate buttons', async () => {
    const user = userEvent.setup();
    axios.get.mockResolvedValueOnce(response([londonUK, londonCA])).mockResolvedValueOnce(response(daySummary));
    app(); fill('London'); submit();
    const candidate = await screen.findByRole('button', { name: 'London, England, GB' });
    await waitFor(() => expect(candidate).toHaveFocus());
    expect(axios.get).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(screen.getByRole('button', { name: 'London, Ontario, CA' })).toHaveFocus();
    await user.keyboard('{Enter}'); await success();
    expect(axios.get.mock.calls[1][1].params).toMatchObject({ lat: londonCA.lat, lon: londonCA.lon });
    expect(screen.getByRole('heading', { name: 'London, Ontario, CA' })).toBeVisible();
  });

  it('retries a failed weather query without geocoding again, restoring its draft', async () => {
    axios.get.mockResolvedValueOnce(response([berlin])).mockRejectedValueOnce(new Error('Network error'));
    app(); fill(); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Weather lookup failed/);
    fill('Paris', '2026-10-14');
    axios.get.mockResolvedValueOnce(response(daySummary));
    fireEvent.click(screen.getByRole('button', { name: 'Retry last lookup' })); await success();
    expect(screen.getByLabelText('City:')).toHaveValue('Berlin');
    expect(screen.getByLabelText('Date of travel:')).toHaveValue('2026-10-13');
    expect(axios.get).toHaveBeenCalledTimes(3);
  });

  it('retries failed geocoding with the identical query', async () => {
    axios.get.mockRejectedValueOnce(new Error('Offline'));
    app(); fill(); submit(); await screen.findByRole('alert');
    axios.get.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response(daySummary));
    fireEvent.click(screen.getByRole('button', { name: 'Retry last lookup' })); await success();
    expect(axios.get.mock.calls[1][1].params.q).toBe('Berlin');
  });

  it.each([
    [{ response: { status: 429 } }, /busy/],
    [{ response: { status: 401 } }, /access is unavailable/],
    [{ code: 'ECONNABORTED' }, /timed out/],
  ])('maps service failures safely: %j', async (error, message) => {
    axios.get.mockRejectedValueOnce(error);
    app(); fill(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(axios.get).toHaveBeenCalledTimes(1); // No automatic quota-consuming retries.
  });

  it.each(['geocode', 'weather'])('reset invalidates an in-flight %s completion', async (stage) => {
    const pending = deferred();
    if (stage === 'weather') axios.get.mockResolvedValueOnce(response([berlin]));
    axios.get.mockReturnValueOnce(pending.promise);
    app(); fill(); submit();
    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(stage === 'weather' ? 2 : 1));
    const signal = axios.get.mock.calls.at(-1)[1].signal;
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
    axios.get.mockReturnValueOnce(pending.promise);
    app(); fill('Old City'); submit();
    fill('Berlin');
    axios.get.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response(daySummary));
    submit(); await success();
    await act(async () => pending[completion](completion === 'resolve' ? response([londonUK]) : new Error('late error')));
    expect(screen.getByRole('heading', { name: 'Berlin, DE' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledTimes(3);
  });

  it('suppresses an older weather result while a replacement is still loading', async () => {
    const oldWeather = deferred(); const newWeather = deferred();
    axios.get.mockResolvedValueOnce(response([berlin])).mockReturnValueOnce(oldWeather.promise);
    app(); fill(); submit(); await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(2));
    fill('London');
    axios.get.mockResolvedValueOnce(response([londonUK])).mockReturnValueOnce(newWeather.promise);
    submit(); await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(4));
    await act(async () => oldWeather.resolve(response(daySummary)));
    expect(screen.getByRole('region', { name: 'Weather result' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Weather loaded.')).not.toBeInTheDocument();
    await act(async () => newWeather.resolve(response(daySummary))); await success();
    expect(screen.getByRole('heading', { name: 'London, England, GB' })).toBeVisible();
  });

  it('cancels on unmount without advancing to a weather request', async () => {
    const pending = deferred(); axios.get.mockReturnValueOnce(pending.promise);
    const rendered = app(); fill(); submit(); const signal = axios.get.mock.calls[0][1].signal;
    rendered.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(response([berlin])));
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('shows unavailable or partial weather without inventing missing values', async () => {
    axios.get.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response({ date: daySummary.date }));
    app(); fill(); submit(); await screen.findByText('Weather is unavailable for this location and date.');
    expect(screen.getAllByText('Unavailable')).toHaveLength(4);
    axios.get.mockResolvedValueOnce(response({ date: daySummary.date, precipitation: { total: 0 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry last lookup' })); await success();
    expect(screen.getByText('0 mm')).toBeVisible();
    expect(screen.getAllByText('Unavailable')).toHaveLength(3);
  });

  it('rejects mismatched dates/malformed weather without crashing', async () => {
    axios.get.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response({ ...daySummary, date: '2026-10-14' }));
    app(); fill(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent(/invalid date or response/);
  });

  it('validates empty city/date with focus and no fallback request', () => {
    app(); submit();
    expect(screen.getByLabelText('City:')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('City:')).toHaveFocus();
    expect(screen.getByLabelText('Date of travel:')).toHaveAttribute('aria-invalid', 'true');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('provides named buttons, controlled Today and Reset', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 13, 1));
    try {
      app();
      expect(screen.getByLabelText('City:')).toBeRequired();
      expect(screen.getByRole('button', { name: 'Use current location' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: "Use today's date" }));
      expect(screen.getByLabelText('Date of travel:')).toHaveValue('2026-10-13');
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      expect(screen.getByLabelText('Date of travel:')).toHaveValue('');
    } finally { vi.useRealTimers(); }
  });

  it('keeps city parameters separate from reserved URL characters', async () => {
    axios.get.mockResolvedValueOnce(response([berlin])).mockResolvedValueOnce(response(daySummary));
    app(); fill('  München & units=imperial?  '); submit(); await success();
    const [url, options] = axios.get.mock.calls[0];
    expect(url).toBe('https://api.openweathermap.org/geo/1.0/direct');
    expect(options.params.q).toBe('München & units=imperial?');
    expect(options.params).not.toHaveProperty('units');
    expect(options.timeout).toBe(8000);
  });

  it('respects reduced motion while loading', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const pending = deferred(); axios.get.mockReturnValueOnce(pending.promise);
    app(); fill(); submit();
    const result = screen.getByRole('region', { name: 'Weather result' });
    expect(within(result).getByText('Finding cities…')).toBeVisible();
    expect(within(result).queryByTestId('loading-animation')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await act(async () => pending.resolve(response([])));
  });
});
