const finite = (value) => typeof value === 'number' && Number.isFinite(value);

// Celsius, precipitation fraction, metres/second and UV index. No inferred zeros.
export const CLOTHING_THRESHOLDS = Object.freeze({
  cold: 5,
  cool: 15,
  heat: 28,
  extremeHeat: 32,
  rain: 0.4,
  wind: 8,
  highUV: 6,
});

/** Informal packing guidance from normalized daily data, not a weather guarantee. */
export function clothingAdvice(model = {}) {
  const t = CLOTHING_THRESHOLDS;
  const temperatures = [model.lowC, model.highC, ...Object.values(model.feelsLikeC ?? {})].filter(
    finite,
  );
  const cold = temperatures.some((value) => value <= t.cold);
  const cool = !cold && temperatures.some((value) => value <= t.cool);
  const hot = temperatures.some((value) => value >= t.heat);
  const extremeHeat = temperatures.some((value) => value >= t.extremeHeat);
  const code = model.condition?.id;
  const rain =
    (Number.isInteger(code) && code >= 200 && code < 600) ||
    (finite(model.precipitationProbability) &&
      model.precipitationProbability >= t.rain &&
      model.precipitationProbability <= 1);
  const wind = finite(model.windSpeedMs) && model.windSpeedMs >= t.wind;
  const uv = finite(model.uvIndex) && model.uvIndex >= t.highUV;
  // Clear sky supports sunglasses, but is not evidence of low rain risk or low UV.
  const sun = code === 800 || uv;
  const thermal = cold
    ? 'Warm coat and layers'
    : cool
      ? 'Light jacket or layers'
      : hot
        ? 'Light, breathable clothing'
        : temperatures.length
          ? 'Light clothing'
          : null;
  const additional = [];
  let primary;
  let coversThermal = false;
  let coversSunglasses = false;
  if (rain && (cold || cool)) {
    primary = cold ? 'Rain jacket and warm layers' : 'Rain jacket and light layers';
    coversThermal = true;
  } else if (rain) primary = wind ? 'Rain jacket with a secure hood' : 'Rain jacket or umbrella';
  else if (cold) {
    primary = thermal;
    coversThermal = true;
  } else if (wind) primary = 'Windproof jacket';
  else if (extremeHeat) {
    primary = 'Very light, breathable clothing';
    coversThermal = true;
  } else if (thermal) {
    primary =
      sun && !cool
        ? hot
          ? 'Light, breathable clothing and sunglasses'
          : 'Light clothing and sunglasses'
        : thermal;
    coversThermal = true;
    coversSunglasses = sun && !cool;
  } else if (uv) {
    primary = 'Sunscreen, sunglasses and a hat';
    coversSunglasses = true;
  } else if (sun) {
    primary = 'Sunglasses for clear conditions';
    coversSunglasses = true;
  } else primary = 'Not enough weather signals for specific clothing advice';
  if (thermal && !coversThermal) additional.push(thermal);
  if (wind && primary !== 'Windproof jacket' && primary !== 'Rain jacket with a secure hood')
    additional.push(
      rain ? 'Choose a windproof rain jacket with a secure hood' : 'Windproof outer layer',
    );
  if (hot && (cold || cool)) additional.push('Light, breathable clothing for warmer hours');
  if (extremeHeat) additional.push('Take shade breaks during the hottest hours');
  if (uv && primary !== 'Sunscreen, sunglasses and a hat')
    additional.push(
      coversSunglasses
        ? 'Sunscreen and a sun hat for high UV'
        : 'Sunscreen, sunglasses and a sun hat',
    );
  else if (sun && !coversSunglasses && !uv) additional.push('Sunglasses for clear conditions');
  const provisional = model.forecastType === 'long-range';
  return {
    primary: provisional ? `Provisional: ${primary}` : primary,
    additional: [...new Set(additional)].filter((item) => item !== primary),
    provisional,
  };
}
