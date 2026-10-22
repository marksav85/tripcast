// Hand-authored examples of the existing 3.0 adapter. Not validated 4.0 data.
export const berlin = { name: 'Berlin', country: 'DE', lat: 52.52, lon: 13.405 };
export const londonUK = { name: 'London', country: 'GB', state: 'England', lat: 51.5, lon: -0.12 };
export const londonCA = {
  name: 'London',
  country: 'CA',
  state: 'Ontario',
  lat: 42.98,
  lon: -81.25,
};
export const daySummary = {
  date: '2026-10-13',
  temperature: { min: 0, max: 15 },
  cloud_cover: { afternoon: 20 },
  precipitation: { total: 0 },
};
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
