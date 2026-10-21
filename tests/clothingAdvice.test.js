import { expect, it } from 'vitest';
import { clothingAdvice } from '../src/client/lib/clothingAdvice.js';

it('prioritizes cold rain and keeps wind/UV advice deduplicated', () => {
  const result = clothingAdvice({ lowC: 5, highC: 12, precipitationProbability: .4,
    condition: { id: 500 }, windSpeedMs: 8, uvIndex: 6 });
  expect(result.primary).toBe('Warm waterproof coat and layers');
  expect(result.additional).toEqual(['Windproof outer layer', 'Sunscreen, sunglasses and a sun hat']);
  expect(new Set(result.additional).size).toBe(result.additional.length);
});
it.each([
  [{ lowC: 5 }, 'Warm coat, layers and a hat'],
  [{ lowC: 15 }, 'Light jacket or removable layers'],
  [{ highC: 28 }, 'Lightweight, breathable clothing'],
  [{ precipitationProbability: .4 }, 'Rain jacket or umbrella'],
  [{ condition: { id: 501 } }, 'Rain jacket or umbrella'],
  [{ windSpeedMs: 8 }, 'Windproof outer layer'],
  [{ uvIndex: 6 }, 'Sunscreen, sunglasses and a sun hat'],
  [{ feelsLikeC: { morning: 0 } }, 'Warm coat, layers and a hat'],
])('uses explicit threshold signals %j', (model, primary) => {
  expect(clothingAdvice(model).primary).toBe(primary);
});
it('does not recommend an umbrella in strong wind', () => {
  expect(clothingAdvice({ precipitationProbability: .8, windSpeedMs: 10 }).primary).toBe('Rain jacket with a secure hood');
});
it.each([{}, { lowC: null, highC: NaN, uvIndex: undefined },
  { lowC: '0', precipitationProbability: null, windSpeedMs: NaN },
  { precipitationProbability: 0, uvIndex: 0, windSpeedMs: 0 },
  { lowC: 15.1, highC: 27.9, precipitationProbability: .39, windSpeedMs: 7.9, uvIndex: 5.9 },
  { condition: { id: 800 }, precipitationProbability: 2 },
])('never invents fair-weather or measurement signals %j', model => {
  expect(clothingAdvice(model)).toEqual({ primary: 'Not enough weather signals for specific clothing advice', additional: [], provisional: false });
});
it('qualifies long-range guidance and does not mutate the model', () => {
  const model = Object.freeze({ forecastType: 'long-range', lowC: 0 });
  expect(clothingAdvice(model)).toMatchObject({ primary: 'Provisional: Warm coat, layers and a hat', provisional: true });
  expect(clothingAdvice({ forecastType: 'long-range' }).primary).toMatch(/^Provisional:/);
});
