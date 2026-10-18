import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import DestinationSelector from '../src/client/components/destination/DestinationSelector.jsx';
import { fetchMock, apiResponse, apiError } from './fixtures/api';
import { deferred, londonUK, londonCA } from './fixtures/weather';
const { resolve } = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../src/client/lib/timeZone.js', () => ({ resolveTimeZone: resolve }));
const paris = { name: 'Paris', country: 'FR', lat: 48.8566, lon: 2.3522 };
beforeEach(() => resolve.mockReturnValue({ status: 'suggested', timeZone: 'Europe/Paris' }));
function setup() { const onChange = vi.fn(); return { onChange, ...render(<DestinationSelector onChange={onChange} />) }; }
function search(query = 'Paris') {
  fireEvent.change(screen.getByLabelText('Search city'), { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}
async function selectParis() {
  fetchMock.mockResolvedValueOnce(apiResponse([paris])); search();
  fireEvent.click(await screen.findByRole('button', { name: 'Paris, FR' }));
}
it('uses existing geocoding and emits only validated location fields after explicit selection', async () => {
  const { onChange } = setup(); fetchMock.mockResolvedValueOnce(apiResponse([paris])); search();
  const city = await screen.findByRole('button', { name: 'Paris, FR' });
  expect(onChange).toHaveBeenLastCalledWith(null); expect(resolve).not.toHaveBeenCalled();
  fireEvent.click(city);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/geocode?q=Paris');
  expect(resolve).toHaveBeenCalledWith(48.8566, 2.3522);
  expect(onChange).toHaveBeenLastCalledWith({ cityName: 'Paris', countryCode: 'FR', region: null, lat: 48.8566, lon: 2.3522, timeZone: 'Europe/Paris' });
  expect(screen.queryByText(/timezone/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it('differentiates duplicate names using country and region', async () => {
  const { onChange } = setup(); fetchMock.mockResolvedValueOnce(apiResponse([londonUK, londonCA])); search('London');
  expect(await screen.findByRole('button', { name: 'London, England, GB' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'London, Ontario, CA' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ cityName: 'London', countryCode: 'CA', region: 'Ontario' }));
});
it.each(['empty', 'error'])('handles geocoding %s', async (kind) => {
  setup(); fetchMock.mockResolvedValueOnce(kind === 'empty' ? apiResponse([]) : apiError('API_FAILURE', 503)); search();
  await screen.findByText(kind === 'empty' ? /No cities found/ : /City search failed/);
  expect(screen.queryByLabelText('Timezone')).not.toBeInTheDocument();
});
it('rejects a short search before requesting', () => {
  setup(); search('P'); expect(screen.getByText(/Enter a city between/)).toBeInTheDocument(); expect(fetchMock).not.toHaveBeenCalled();
});
it('cancels requests and ignores out-of-order responses', async () => {
  setup(); const first = deferred(); fetchMock.mockReturnValueOnce(first.promise); search('London');
  const signal = fetchMock.mock.calls[0][1].signal;
  fetchMock.mockResolvedValueOnce(apiResponse([paris])); search();
  await screen.findByRole('button', { name: 'Paris, FR' }); expect(signal.aborted).toBe(true);
  await act(async () => first.resolve(apiResponse([londonUK])));
  expect(screen.queryByRole('button', { name: /London, England/ })).not.toBeInTheDocument();
});
it.each([{ status: 'unresolved', timeZone: null }, { status: 'suggested', timeZone: 'Invalid/Zone' }])('keeps failed resolution incomplete and allows retry %#', async (result) => {
  resolve.mockReturnValue(result); const { onChange } = setup(); await selectParis();
  expect(screen.getByText(/Could not select this location/)).toBeInTheDocument();
  expect(onChange).toHaveBeenLastCalledWith(null);
  expect(screen.queryByText(/timezone/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Selected city:/)).not.toBeInTheDocument();
  resolve.mockReturnValue({ status: 'suggested', timeZone: 'Europe/Paris' });
  fireEvent.click(screen.getByRole('button', { name: 'Paris, FR' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: 'Europe/Paris' }));
  expect(screen.queryByText(/Could not select this location/)).not.toBeInTheDocument();
});
it('accepts a validated automatic alias without a timezone catalog', async () => {
  resolve.mockReturnValue({ status: 'suggested', timeZone: 'US/Eastern' });
  const { onChange } = setup(); await selectParis();
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: 'US/Eastern' }));
});
it('invalidates the prior selection while searching again and recalculates the replacement timezone', async () => {
  const { onChange } = setup(); await selectParis();
  resolve.mockReturnValue({ status: 'suggested', timeZone: 'Europe/London' }); fetchMock.mockResolvedValueOnce(apiResponse([londonUK])); search('London');
  expect(onChange).toHaveBeenLastCalledWith(null); expect(screen.queryByLabelText('Timezone')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'London, England, GB' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ cityName: 'London', timeZone: 'Europe/London' }));
});
it('supports keyboard city selection with automatic resolution', async () => {
  const user = userEvent.setup(); const { onChange } = setup(); fetchMock.mockResolvedValueOnce(apiResponse([paris])); search();
  const city = await screen.findByRole('button', { name: 'Paris, FR' }); city.focus(); await user.keyboard('{Enter}');
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: 'Europe/Paris' }));
  expect(screen.queryByText(/timezone/i)).not.toBeInTheDocument();
});
it('aborts a pending search on unmount without late callbacks', async () => {
  const pending = deferred(); const { onChange, unmount } = setup(); fetchMock.mockReturnValueOnce(pending.promise); search();
  const signal = fetchMock.mock.calls[0][1].signal; const calls = onChange.mock.calls.length; unmount();
  await act(async () => pending.resolve(apiResponse([paris]))); expect(signal.aborted).toBe(true); expect(onChange).toHaveBeenCalledTimes(calls);
});

it('rejects provider labels outside the trip contract', async () => {
  const { onChange } = setup(); fetchMock.mockResolvedValueOnce(apiResponse([{ ...paris, state: 'x'.repeat(101) }])); search();
  fireEvent.click(await screen.findByRole('button', { name: /^Paris,/ }));
  expect(screen.getByText('Selected city data is invalid. Choose another result.')).toBeInTheDocument();
  expect(onChange).toHaveBeenLastCalledWith(null); expect(resolve).not.toHaveBeenCalled();
});

it('does not retain the prior city timezone when replacement resolution fails', async () => {
  const { onChange } = setup();
  fetchMock.mockResolvedValueOnce(apiResponse([paris, londonUK])); search();
  fireEvent.click(await screen.findByRole('button', { name: 'Paris, FR' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: 'Europe/Paris' }));
  resolve.mockReturnValue({ status: 'unresolved', timeZone: null });
  fireEvent.click(screen.getByRole('button', { name: 'London, England, GB' }));
  expect(onChange).toHaveBeenLastCalledWith(null);
  expect(screen.getByText(/Could not select this location/)).toBeInTheDocument();
});

it('renders distinct query responses and emits each selected location with its automatic timezone', async () => {
  const { resolveTimeZone } = await vi.importActual('../src/client/lib/timeZone.js');
  resolve.mockImplementation(resolveTimeZone);
  const { onChange } = setup();
  const cities = [
    { name: 'Berlin', country: 'DE', lat: 52.52, lon: 13.405 },
    { name: 'Hamburg', country: 'DE', lat: 53.5511, lon: 9.9937 },
    { name: 'Munich', country: 'DE', lat: 48.1351, lon: 11.582 },
  ];
  let previous;
  for (const city of cities) {
    const pending = deferred(); fetchMock.mockReturnValueOnce(pending.promise);
    search(city.name);
    expect(fetchMock.mock.calls.at(-1)[0]).toBe(`/api/geocode?q=${city.name}`);
    expect(onChange).toHaveBeenLastCalledWith(null);
    if (previous) expect(screen.queryByRole('button', { name: `${previous.name}, DE` })).not.toBeInTheDocument();
    await act(async () => pending.resolve(apiResponse([city])));
    fireEvent.click(await screen.findByRole('button', { name: `${city.name}, DE` }));
    expect(onChange).toHaveBeenLastCalledWith({ cityName: city.name, countryCode: city.country,
      region: null, lat: city.lat, lon: city.lon, timeZone: 'Europe/Berlin' });
    previous = city;
  }
});

it('submits city search with Enter, announces loading, and requires deliberate single-result selection', async () => {
  const user = userEvent.setup(); const { onChange } = setup(); const pending = deferred(); fetchMock.mockReturnValueOnce(pending.promise);
  const input = screen.getByLabelText('Search city');
  expect(screen.getByText(/press Search or Enter, then choose/)).toBeInTheDocument();
  await user.type(input, 'Paris'); expect(fetchMock).not.toHaveBeenCalled();
  await user.keyboard('{Enter}'); expect(screen.getByText('Searching cities…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled();
  await act(async () => pending.resolve(apiResponse([paris])));
  const result = screen.getByRole('button', { name: 'Paris, FR' });
  expect(result).toHaveAttribute('aria-pressed', 'false'); expect(onChange).toHaveBeenLastCalledWith(null);
  result.focus(); await user.keyboard(' '); expect(result).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Selected city: Paris, FR')).toHaveAttribute('aria-live', 'polite');
  await user.type(input, 'x'); expect(screen.queryByText('Selected city: Paris, FR')).not.toBeInTheDocument();
  expect(onChange).toHaveBeenLastCalledWith(null);
});
