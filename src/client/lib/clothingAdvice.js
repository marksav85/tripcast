const finite = value => typeof value === 'number' && Number.isFinite(value);

// Celsius, precipitation fraction, metres/second and UV index. No inferred zeros.
export const CLOTHING_THRESHOLDS = Object.freeze({ cold: 5, cool: 15, heat: 28, rain: 0.4, wind: 8, highUV: 6 });

/** Informal packing guidance from normalized daily data, not a weather guarantee. */
export function clothingAdvice(model = {}) {
  const t = CLOTHING_THRESHOLDS;
  const temperatures = [model.lowC, model.highC, ...Object.values(model.feelsLikeC ?? {})].filter(finite);
  const cold = temperatures.some(value => value <= t.cold);
  const cool = !cold && temperatures.some(value => value <= t.cool);
  const hot = finite(model.highC) && model.highC >= t.heat;
  const code = model.condition?.id;
  const wetCondition = Number.isInteger(code) && code >= 200 && code < 600;
  const rain = wetCondition || (finite(model.precipitationProbability)
    && model.precipitationProbability >= t.rain && model.precipitationProbability <= 1);
  const wind = finite(model.windSpeedMs) && model.windSpeedMs >= t.wind;
  const uv = finite(model.uvIndex) && model.uvIndex >= t.highUV;
  const advice = [];
  if (rain && cold) advice.push('Warm waterproof coat and layers');
  else {
    if (rain) advice.push(wind ? 'Rain jacket with a secure hood' : 'Rain jacket or umbrella');
    if (cold) advice.push('Warm coat, layers and a hat');
  }
  if (wind) advice.push('Windproof outer layer');
  if (cool) advice.push('Light jacket or removable layers');
  if (hot) advice.push('Lightweight, breathable clothing');
  if (uv) advice.push('Sunscreen, sunglasses and a sun hat');
  const unique = [...new Set(advice)];
  const provisional = model.forecastType === 'long-range';
  const primary = unique.shift() ?? 'Not enough weather signals for specific clothing advice';
  return { primary: provisional ? `Provisional: ${primary}` : primary, additional: unique, provisional };
}
