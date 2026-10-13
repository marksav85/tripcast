import { vi } from 'vitest';
import { normalizeCandidates } from '../../src/shared/locations';
import { normalizeDaySummary } from '../../src/worker/normalize';
import { berlin, daySummary } from './weather';

export const fetchMock = vi.fn();
// Synthetic normalized boundary fixtures for the client regression suite.
export function apiResponse(raw) {
  let data = raw;
  if (Array.isArray(raw)) {
    try { data = normalizeCandidates(raw); } catch { /* Intentionally malformed client fixture. */ }
  } else if (raw?.date) {
    const { model, available } = normalizeDaySummary(raw, { date: raw.date, location: berlin });
    delete model.location;
    data = { model, available };
  }
  return new Response(JSON.stringify({ data, meta: { mock: true, stale: false } }), { headers: { 'Content-Type': 'application/json' } });
}
export function apiError(code, status) {
  return new Response(JSON.stringify({ error: { code } }), { status, headers: { 'Content-Type': 'application/json' } });
}
export function defaultWeatherResponse() { return apiResponse(daySummary); }
