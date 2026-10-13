// Local-only synthetic 3.0 examples, not validated OpenWeather 4.0 fixtures.
export function mockProvider(url) {
  if (url.pathname.endsWith('/direct')) {
    const q = url.searchParams.get('q').toLowerCase();
    if (q.includes('missing')) return [];
    if (q.includes('london')) return [
      { name: 'London', state: 'England', country: 'GB', lat: 51.5, lon: -0.12 },
      { name: 'London', state: 'Ontario', country: 'CA', lat: 42.98, lon: -81.25 },
    ];
    return [{ name: 'Berlin', country: 'DE', lat: 52.52, lon: 13.405 }];
  }
  if (url.pathname.endsWith('/reverse')) return [{ name: 'Berlin', country: 'DE', lat: 52.52, lon: 13.405 }];
  return { date: url.searchParams.get('date'), temperature: { min: 0, max: 15 },
    cloud_cover: { afternoon: 20 }, precipitation: { total: 0 } };
}
