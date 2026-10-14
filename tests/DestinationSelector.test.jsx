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
it('uses existing geocoding and emits only reviewed location fields after explicit selection', async () => {
  const { onChange } = setup(); fetchMock.mockResolvedValueOnce(apiResponse([paris])); search();
  const city = await screen.findByRole('button', { name: 'Paris, FR' });
  expect(onChange).toHaveBeenLastCalledWith(null); expect(resolve).not.toHaveBeenCalled();
  fireEvent.click(city);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/geocode?q=Paris');
  expect(resolve).toHaveBeenCalledWith(48.8566, 2.3522);
  expect(onChange).toHaveBeenLastCalledWith({ cityName: 'Paris', countryCode: 'FR', region: null, lat: 48.8566, lon: 2.3522, timeZone: 'Europe/Paris' });
  expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Paris');
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
it.each([{ status: 'unresolved', timeZone: null }, { status: 'suggested', timeZone: 'Invalid/Zone' }])('requires manual timezone when the suggestion is unusable %#', async (result) => {
  resolve.mockReturnValue(result); const { onChange } = setup(); await selectParis();
  expect(screen.getByText(/Timezone could not be suggested/)).toBeInTheDocument(); expect(onChange).toHaveBeenLastCalledWith(null);
  const selector = screen.getByLabelText('Timezone'); expect(selector).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(selector, { target: { value: 'UTC' } });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: 'UTC' }));
});
it('filters and corrects timezone without losing the selected suggestion', async () => {
  const { onChange } = setup(); await selectParis();
  fireEvent.change(screen.getByLabelText('Filter timezones'), { target: { value: 'New_York' } });
  expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Paris');
  expect(screen.getByRole('option', { name: 'America/New_York' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'America/New_York' } });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: 'America/New_York' }));
  fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: '' } });
  expect(onChange).toHaveBeenLastCalledWith(null);
});
it('preserves a valid alias missing from the catalog', async () => {
  const spy = vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Europe/Paris']);
  try {
    resolve.mockReturnValue({ status: 'suggested', timeZone: 'US/Eastern' }); setup(); await selectParis();
    expect(screen.getByLabelText('Timezone')).toHaveValue('US/Eastern'); expect(screen.getByRole('option', { name: 'UTC' })).toBeInTheDocument();
  } finally { spy.mockRestore(); }
});
it('supports validated manual entry when the platform catalog is unavailable', async () => {
  const spy = vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => { throw new Error(); });
  try {
    const { onChange } = setup(); await selectParis(); const input = screen.getByLabelText('Timezone');
    fireEvent.change(input, { target: { value: 'PST' } }); expect(onChange).toHaveBeenLastCalledWith(null);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(input, { target: { value: 'Pacific/Kiritimati' } }); expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ timeZone: 'Pacific/Kiritimati' }));
  } finally { spy.mockRestore(); }
});
it('invalidates the prior selection while searching again and recalculates the replacement timezone', async () => {
  const { onChange } = setup(); await selectParis();
  fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'UTC' } });
  resolve.mockReturnValue({ status: 'suggested', timeZone: 'Europe/London' }); fetchMock.mockResolvedValueOnce(apiResponse([londonUK])); search('London');
  expect(onChange).toHaveBeenLastCalledWith(null); expect(screen.queryByLabelText('Timezone')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'London, England, GB' }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ cityName: 'London', timeZone: 'Europe/London' }));
});
it('supports keyboard city selection and labelled native timezone control focus', async () => {
  const user = userEvent.setup(); setup(); fetchMock.mockResolvedValueOnce(apiResponse([paris])); search();
  const city = await screen.findByRole('button', { name: 'Paris, FR' }); city.focus(); await user.keyboard('{Enter}');
  screen.getByLabelText('Filter timezones').focus(); await user.tab();
  expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveFocus();
  await user.selectOptions(screen.getByLabelText('Timezone'), 'UTC'); expect(screen.getByText('Selected timezone: UTC')).toBeInTheDocument();
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
