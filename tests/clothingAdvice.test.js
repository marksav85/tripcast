import { expect, it } from 'vitest';
import { clothingAdvice } from '../src/client/lib/clothingAdvice.js';

it('prioritizes cold rain and keeps wind/UV advice deduplicated', () => {
  const result = clothingAdvice({ lowC: 5, highC: 12, precipitationProbability: .4,
    condition: { id: 500 }, windSpeedMs: 8, uvIndex: 6 });
  expect(result.primary).toBe('Rain jacket and warm layers');
  expect(result.additional).toEqual(['Choose a windproof rain jacket with a secure hood', 'Sunscreen, sunglasses and a sun hat']);
  expect(new Set(result.additional).size).toBe(result.additional.length);
});
it.each([
  [{ lowC: 5 }, 'Warm coat and layers'],
  [{ lowC: 15 }, 'Light jacket or layers'],
  [{ highC: 28 }, 'Light, breathable clothing'],
  [{ precipitationProbability: .4 }, 'Rain jacket or umbrella'],
  [{ condition: { id: 501 } }, 'Rain jacket or umbrella'],
  [{ windSpeedMs: 8 }, 'Windproof jacket'],
  [{ uvIndex: 6 }, 'Sunscreen, sunglasses and a hat'],
  [{ feelsLikeC: { morning: 0 } }, 'Warm coat and layers'],
])('uses explicit threshold signals %j', (model, primary) => {
  expect(clothingAdvice(model).primary).toBe(primary);
});
it('does not recommend an umbrella in strong wind', () => {
  expect(clothingAdvice({ precipitationProbability: .8, windSpeedMs: 10 }).primary).toBe('Rain jacket with a secure hood');
});
it.each([{}, { lowC: null, highC: NaN, uvIndex: undefined },
  { lowC: '0', precipitationProbability: null, windSpeedMs: NaN },
  { precipitationProbability: 0, uvIndex: 0, windSpeedMs: 0 },
])('never invents fair-weather or measurement signals %j', model => {
  expect(clothingAdvice(model)).toEqual({ primary: 'Not enough weather signals for specific clothing advice', additional: [], provisional: false });
});
it('qualifies long-range guidance and does not mutate the model', () => {
  const model = Object.freeze({ forecastType: 'long-range', lowC: 0 });
  expect(clothingAdvice(model)).toMatchObject({ primary: 'Provisional: Warm coat and layers', provisional: true });
  expect(clothingAdvice({ forecastType: 'long-range' }).primary).toMatch(/^Provisional:/);
});
it('gives useful mild clear-weather advice for the reported Los Angeles day', () => {
  expect(clothingAdvice({ lowC: 18.05, highC: 24.59, condition: { id: 800 },
    precipitationProbability: 0, windSpeedMs: 3.83, uvIndex: 5.53 })).toEqual({
    primary: 'Light clothing and sunglasses', additional: [], provisional: false,
  });
});
it('uses mild temperatures without assuming missing rain or UV measurements are safe', () => {
  expect(clothingAdvice({ lowC: 18, highC: 24 })).toEqual({ primary: 'Light clothing', additional: [], provisional: false });
});
it('combines cool rain, and prioritizes wind and extreme heat', () => {
  expect(clothingAdvice({ lowC: 10, precipitationProbability: .6 }).primary).toBe('Rain jacket and light layers');
  expect(clothingAdvice({ highC: 24, windSpeedMs: 9 })).toMatchObject({ primary: 'Windproof jacket', additional: ['Light clothing'] });
  expect(clothingAdvice({ highC: 33 }).primary).toBe('Very light, breathable clothing');
});
it('does not repeat primary items in high UV additional advice', () => {
  expect(clothingAdvice({ lowC: 18, highC: 24, uvIndex: 6 })).toMatchObject({
    primary: 'Light clothing and sunglasses', additional: ['Sunscreen and a sun hat for high UV'],
  });
});
