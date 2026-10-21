// Run from a trusted interactive terminal. Never loads or writes .env.local.
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { emitKeypressEvents } from 'node:readline';
import { isDeepStrictEqual } from 'node:util';
import { validateTripDraft } from '../../src/shared/trip.js';

const project = 'oowesugpxxzvyvfqqxlu';
const url = `https://${project}.supabase.co`;
const id = randomUUID();
const draft = {
  title: `TripCast disposable ${id}`, startDate: '2027-06-01', endDate: '2027-06-03',
  destinations: [{ position: 0, cityName: 'Paris', countryCode: 'FR', region: null,
    lat: 48.8566, lon: 2.3522, timeZone: 'Europe/Paris',
    arrivalDate: '2027-06-01', departureDate: '2027-06-03' }],
};
const updated = { ...draft, title: `${draft.title} updated` };
const invalid = structuredClone(updated);
invalid.destinations[0].arrivalDate = '2027-06-02'; // Gap at trip start: INVALID_TRIP.
const stages = ['Create', 'Read-back', 'Update', 'Revision conflict', 'Invalid itinerary', 'Delete', 'Final empty state'];
const results = Object.fromEntries(stages.map(name => [name, 'NOT RUN']));
let stage = 'Preflight';
let client;
let attemptedCreate = false;
let deletionAttempted = false;
let signedIn = false;
let interrupted = false;
let revision;
let cleanup = 'Not needed';
let finalState = 'Not inspected';
const interrupt = () => { interrupted = true; };

function requireCheck(condition) {
  if (!condition) throw new Error('CHECK_FAILED');
}

// Raw terminal input suppresses echo for every prompt, including pasted secrets.
async function prompt(label) {
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('CANCELLED'));
      if (key.name === 'return') return finish();
      if (key.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    };
    process.stdin.on('keypress', onKey);
  });
}

async function rows(table) {
  const response = await client.from(table).select('*');
  requireCheck(!response.error && Array.isArray(response.data));
  return response.data;
}

async function verifyEmpty() {
  requireCheck((await rows('trips')).length === 0);
  requireCheck((await rows('trip_destinations')).length === 0);
  finalState = 'Authenticated reads show no trips or destinations (RLS visibility only)';
}

async function verifySaved(expectedRevision, expectedDraft) {
  const trips = await rows('trips');
  const children = await rows('trip_destinations');
  requireCheck(trips.length === 1 && children.length === 1);
  const t = trips[0];
  requireCheck(t.id === id && t.revision === expectedRevision && children[0].trip_id === id);
  const actual = { title: t.title, startDate: t.start_date, endDate: t.end_date,
    destinations: children.sort((a, b) => a.sort_order - b.sort_order).map(d => ({
      position: d.sort_order, cityName: d.city_name, countryCode: d.country_code,
      region: d.region, lat: d.latitude, lon: d.longitude, timeZone: d.timezone,
      arrivalDate: d.arrival_date, departureDate: d.departure_date,
    })) };
  requireCheck(isDeepStrictEqual(actual, expectedDraft));
}

async function save(expectedRevision, value) {
  requireCheck(!interrupted);
  // Match src/client/api/trips.js; invalid fixture intentionally reaches SQL validation.
  return client.rpc('save_trip', { p_trip_id: id, p_expected_revision: expectedRevision, p_draft: value });
}

function saved(response, expectedRevision, value) {
  requireCheck(!response.error && response.data?.id === id
    && response.data.revision === expectedRevision && isDeepStrictEqual(response.data.draft, value));
  revision = response.data.revision;
}

async function remove(expectedRevision) {
  deletionAttempted = true;
  const response = await client.rpc('delete_trip', { p_trip_id: id, p_expected_revision: expectedRevision });
  requireCheck(!response.error && response.data?.id === id && response.data.deleted === true);
}

async function run() {
  requireCheck(validateTripDraft(draft).valid && validateTripDraft(updated).valid
    && !validateTripDraft(invalid).valid);
  if (process.argv.length === 3 && process.argv[2] === '--check') {
    console.log('PASS: local valid/invalid fixtures; no network requests');
    return;
  }
  requireCheck(process.argv.length === 2 && process.stdin.isTTY && process.stdout.isTTY);
  emitKeypressEvents(process.stdin);
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  console.log(`Target staging project: ${project}\nURL: ${url}`);
  let key = await prompt('Staging sb_publishable_ key (hidden): ');
  requireCheck(/^sb_publishable_[A-Za-z0-9_-]+$/.test(key));
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, options) => fetch(input, { ...options, signal: AbortSignal.timeout(20000) }) },
  });
  key = '';
  let email = await prompt('Existing staging user email (hidden): ');
  let password = await prompt('Password (hidden): ');
  const auth = await client.auth.signInWithPassword({ email, password });
  email = ''; password = '';
  signedIn = Boolean(auth.data?.session);
  requireCheck(!auth.error && signedIn);
  const [head, body] = auth.data.session.access_token.split('.').slice(0, 2).map(part =>
    JSON.parse(Buffer.from(part, 'base64url').toString('utf8')));
  requireCheck(head.alg === 'ES256' && body.iss === `${url}/auth/v1`
    && [body.aud].flat().includes('authenticated'));
  await verifyEmpty();
  console.log(`Account is empty. Disposable trip: ${draft.title}`);
  console.log('Plan: create one Paris trip (2027-06-01–03), read it, update title,');
  console.log('attempt a stale update and invalid date gap, verify unchanged state, then delete.');
  console.log('Use this account exclusively until the test finishes. Cleanup is limited to this run UUID.');
  const confirmation = `DISPOSABLE STAGING ${project}`;
  requireCheck(await prompt(`Confirm this is the disposable staging environment. Type ${confirmation}: `) === confirmation);
  requireCheck(!interrupted);
  await verifyEmpty(); // Recheck immediately before the first write.
  stage = 'Create';
  attemptedCreate = true;
  finalState = 'Unknown after write attempt';
  console.log(`Test trip ID (retain for cleanup if interrupted): ${id}`);
  saved(await save(0, draft), 1, draft);
  results[stage] = 'PASS';
  stage = 'Read-back';
  await verifySaved(revision, draft); results[stage] = 'PASS';
  stage = 'Update';
  saved(await save(revision, updated), 2, updated);
  await verifySaved(revision, updated); results[stage] = 'PASS';
  stage = 'Revision conflict';
  const stale = await save(1, draft); // Different from updated: avoids idempotent retry path.
  requireCheck(stale.error?.code === 'P0001' && stale.error.message === 'TRIP_CONFLICT');
  await verifySaved(revision, updated); results[stage] = 'PASS';
  stage = 'Invalid itinerary';
  const rejected = await save(revision, invalid);
  requireCheck(rejected.error?.code === '22023' && rejected.error.message === 'INVALID_TRIP');
  await verifySaved(revision, updated); results[stage] = 'PASS';
  stage = 'Delete';
  requireCheck(!interrupted);
  await remove(revision); results[stage] = 'PASS';
  stage = 'Final empty state';
  await verifyEmpty(); results[stage] = 'PASS'; cleanup = 'Verified';
}

try {
  await run();
} catch {
  if (Object.hasOwn(results, stage)) results[stage] = 'FAIL';
  console.log(`STOP: ${stage} failed or cancelled; sensitive details suppressed.`);
  process.exitCode = 1;
} finally {
  if (attemptedCreate && cleanup !== 'Verified') {
    try {
      // Reconcile ambiguous responses by read, never by retrying a save/delete blindly.
      const trips = await rows('trips');
      const own = trips.find(t => t.id === id);
      if (own) {
        requireCheck(!deletionAttempted && Number.isSafeInteger(own.revision) && own.revision >= 1
          && [draft.title, updated.title].includes(own.title));
        await remove(own.revision);
      }
      await verifyEmpty(); cleanup = 'Verified';
    } catch {
      cleanup = `UNVERIFIED; inspect only test trip ${id}; no further mutations attempted`;
      finalState = 'Unknown; cleanup could not be verified';
      process.exitCode = 1;
    }
  }
  if (signedIn) {
    try {
      const response = await client.auth.signOut({ scope: 'local' });
      requireCheck(!response.error);
    } catch { console.log('FAIL: sign-out'); process.exitCode = 1; }
  }
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  console.log(`Target: ${project}`);
  for (const [name, result] of Object.entries(results)) console.log(`${name}: ${result}`);
  console.log(`Final database state: ${finalState}\nCleanup: ${cleanup}`);
  console.log('Gap: hosted two-user isolation intentionally skipped; absent children verified through RLS only.');
}
