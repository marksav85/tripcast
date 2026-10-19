import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import WeatherContext from '../src/client/context/WeatherContextProvider';
import Weather from '../src/client/components/weather/Weather';

function setup(model, status = 'success', freshness = {}) {
  const result = { date: '2026-10-13', location: { name: 'Berlin', country: 'DE' }, source: 'Fixture source',
    highC: null, lowC: null, cloudPercent: null, precipitationMm: null, condition: null, freshness, ...model };
  render(<WeatherContext.Provider value={{ weather: { status, message: status === 'success' ? 'Weather loaded.' : 'Weather is unavailable for this location and date.', result }, retry: vi.fn() }}><Weather /></WeatherContext.Provider>);
}
function metric(label) { return screen.getByText(label, { selector: 'dt' }).parentElement; }
it('renders supported optional zero measurements without inventing daily rainfall or model claims', () => {
  setup({ highC: 0, lowC: -2, cloudPercent: 0, humidityPercent: 0, windSpeedMs: 0,
    windDirectionDeg: 0, uvIndex: 0, pressureHpa: 0, dewPointC: 0, precipitationProbability: 0,
    condition: { id: 800, description: 'clear sky', icon: '01d' }, providerRainValue: 12345 });
  expect(within(metric('Wind speed')).getByText('0 m/s')).toBeVisible();
  expect(within(metric('Humidity')).getByText('0%')).toBeVisible();
  expect(within(metric('UV index')).getByText('0')).toBeVisible();
  expect(within(metric('Wind direction')).getByText('0°')).toBeVisible();
  expect(within(metric('Pressure')).getByText('0 hPa')).toBeVisible();
  expect(within(metric('Total precipitation (liquid-water equivalent)')).getByText('Unavailable')).toBeVisible();
  expect(screen.getByText('Precipitation probability: 0%')).toBeVisible();
  expect(screen.getByText('Weather conditions: clear sky.')).toBeVisible();
  expect(screen.queryByText(/12345|confidence|packing|sea temperature/i)).not.toBeInTheDocument();
});
it('shows supported periods and preserves missing period measurements', () => {
  setup({ temperatureC: { morning: 0, day: 12, evening: null, night: -1 }, feelsLikeC: { morning: null, day: 0 } });
  const periods = screen.getByRole('region', { name: 'Temperatures through the day' });
  expect(within(periods).getByText('0°C')).toBeVisible();
  expect(within(periods).getByText('Feels like 0°C')).toBeVisible();
  expect(within(periods).getAllByText('Feels like Unavailable')).toHaveLength(3);
});
it('keeps unavailable weather intentional and identifies stale demonstration data', () => {
  setup({}, 'unavailable', { mock: true, stale: true });
  expect(screen.getAllByText('Unavailable')).toHaveLength(4);
  expect(screen.queryByRole('region', { name: 'Temperatures through the day' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry last lookup' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('older cached weather');
  expect(screen.getByText('Local demonstration data — not a live forecast.')).toBeVisible();
});
