export const tripDraft = {
  title: 'Summer',
  startDate: '2027-06-01',
  endDate: '2027-06-04',
  destinations: [
    {
      position: 0,
      cityName: 'Paris',
      countryCode: 'FR',
      region: null,
      lat: 48.8566,
      lon: 2.3522,
      timeZone: 'Europe/Paris',
      arrivalDate: '2027-06-01',
      departureDate: '2027-06-04',
    },
  ],
};
export const savedTrip = (revision = 1, title = 'Summer') => ({
  id: '11111111-1111-4111-8111-111111111111',
  revision,
  draft: { ...tripDraft, title },
});
export function weatherEnvelope() {
  return {
    data: {
      days: [
        {
          position: 0,
          date: '2027-06-01',
          status: 'available',
          model: {
            date: '2027-06-01',
            timeZone: 'Europe/Paris',
            lowC: 0,
            highC: 20,
            temperatureC: { morning: 0, day: 18, evening: 16, night: 8, min: 0, max: 20 },
            feelsLikeC: { morning: 0, day: 18, evening: 16, night: 8 },
            condition: { id: 800, main: 'Clear', description: 'clear sky' },
          },
          meta: { cached: false, stale: false },
        },
        {
          position: 0,
          date: '2027-06-02',
          status: 'unavailable',
          model: null,
          reason: { code: 'DATE_UNAVAILABLE', message: 'Do not display raw server messages' },
        },
        {
          position: 0,
          date: '2027-06-03',
          status: 'error',
          model: null,
          error: { code: 'UPSTREAM_TIMEOUT', message: 'Do not display raw server messages' },
        },
      ],
    },
    meta: { partial: true, mock: false },
  };
}
