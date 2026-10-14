import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { verifyLocalTarget, container } from './local-db-target.mjs';
import { validateTripDraft } from '../src/shared/trip.js';
verifyLocalTarget();
const cli = JSON.parse(execFileSync('./node_modules/.bin/supabase', ['status', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const url = new URL(cli.API_URL); assert.equal(url.origin, 'http://127.0.0.1:54321');
const key = cli.PUBLISHABLE_KEY ?? cli.ANON_KEY;
let passed = 0;
function check(condition, message) { assert.ok(condition, message); passed += 1; }
async function api(path, token, method = 'GET', body) {
  const response = await fetch(url.origin + path, { method, headers: { apikey: key,
    ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', Prefer: 'return=representation' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, data };
}
const run = randomUUID();
async function user(label) {
  const email = `tripcast-${label}-${run}@example.test`; const password = randomUUID() + '-Synthetic1!';
  const signup = await api('/auth/v1/signup', null, 'POST', { email, password });
  check(signup.status === 200 && signup.data?.user?.id, 'Local synthetic signup');
  const login = await api('/auth/v1/token?grant_type=password', null, 'POST', { email, password });
  check(login.status === 200 && login.data?.access_token, 'Local synthetic login');
  return { id: login.data.user.id, token: login.data.access_token, email };
}
const A = await user('a'); const B = await user('b');
const base = () => ({ title: 'Summer', startDate: '2027-06-01', endDate: '2027-06-03', destinations: [
  { position: 0, cityName: 'Paris', countryCode: 'FR', region: null, lat: 48.8566, lon: 2.3522, timeZone: 'Europe/Paris', arrivalDate: '2027-06-01', departureDate: '2027-06-03' },
] });
const id = randomUUID();
async function save(who, tripId, revision, draft) { return api('/rest/v1/rpc/save_trip', who?.token, 'POST', { p_trip_id: tripId, p_expected_revision: revision, p_draft: draft }); }
async function remove(who, tripId, revision) { return api('/rest/v1/rpc/delete_trip', who?.token, 'POST', { p_trip_id: tripId, p_expected_revision: revision }); }
const created = await save(A, id, 0, base());
check(created.status === 200 && created.data.revision === 1, 'Create through authenticated RPC');
check((await save(A, id, 0, base())).data?.revision === 1, 'Identical create retry');
check((await save(A, randomUUID(), 0, base())).status >= 400, 'One trip per owner');
check((await api('/rest/v1/trips?select=*', A.token)).data?.length === 1, 'Owner read');
check((await api('/rest/v1/trips?select=*', B.token)).data?.length === 0, 'Other owner parent isolation');
check((await api('/rest/v1/trip_destinations?select=*', B.token)).data?.length === 0, 'Child isolation');
check((await api('/rest/v1/trips?select=*', null)).status >= 400, 'Anonymous table read denied');
check((await save(null, id, 1, base())).status >= 400, 'Anonymous RPC denied');
check((await save(B, id, 1, base())).status >= 400, 'Cross-user save denied');
for (const table of ['trips', 'trip_destinations']) for (const method of ['POST', 'PATCH', 'DELETE']) {
  const r = await api(`/rest/v1/${table}${method === 'POST' ? '' : '?id=eq.' + id}`, A.token, method, method === 'DELETE' ? undefined : method === 'PATCH' ? (table === 'trips' ? { title: 'Forbidden' } : { city_name: 'Forbidden' }) : {});
  check(r.status >= 400, 'Direct application table mutation denied');
}
const edited = base(); edited.title = 'Edited';
check((await save(A, id, 1, edited)).data?.revision === 2, 'Atomic edit');
check((await save(A, id, 1, edited)).data?.revision === 2, 'Identical edit retry');
check((await save(A, id, 1, base())).status >= 400, 'Different stale edit rejected');
const invalids = [
  null, [], { ...base(), user_id: B.id }, { ...base(), title: 'x'.repeat(101) },
  { ...base(), title: '\uD800' }, { ...base(), startDate: '2027-6-01' }, { ...base(), endDate: 'infinity' },
  { ...base(), endDate: '10000-01-01' }, { ...base(), endDate: '2027-07-14' },
  { ...base(), destinations: [] }, { ...base(), destinations: Array.from({ length: 9 }, () => base().destinations[0]) },
];
for (const [field, value] of [['lat', '48'], ['lon', null], ['lat', 91], ['position', '0'], ['position', 1], ['cityName', 'A\nB'],
  ['countryCode', 'FR\n'], ['timeZone', 'PST'], ['timeZone', '+02:00'], ['timeZone', 'Invalid/Zone'], ['region', ''], ['url', 'forbidden'],
  ['arrivalDate', '2027-06-02'], ['departureDate', '2027-06-01']]) {
  const d = base(); d.destinations[0][field] = value; invalids.push(d);
}
for (const draft of invalids) {
  check((await save(A, id, 2, draft)).status >= 400, 'Malformed draft rejected');
  const after = await api(`/rest/v1/trips?id=eq.${id}&select=title,revision`, A.token);
  check(after.data?.[0]?.title === 'Edited' && after.data[0].revision === 2, 'Invalid replacement rolls back');
}
for (const revision of ['2', null, -1, 1.5, 9007199254740992]) check((await save(A, id, revision, base())).status >= 400, 'Strict safe revision validation');
for (const title of ['\u00A0Summer\uFEFF', '😀'.repeat(100)]) {
  const d = base(); d.title = title;
  check(validateTripDraft(d).valid, 'JS valid Unicode fixture');
  const r = await save(A, id, 2, d); check(r.status === 200 && r.data?.draft.title === title.trim(), 'SQL Unicode normalization parity');
  check((await save(A, id, 2, d)).data?.revision === 3, 'Unicode identical retry');
  await remove(A, id, 3); await save(A, id, 0, edited); await save(A, id, 1, edited); // equivalent retry stays revision 1
  // Restore revision 2 with a different canonical state for the next case.
  await save(A, id, 1, base()); await save(A, id, 2, edited);
  // Start next case from a fresh trip with revision 2.
  await remove(A, id, 3); await save(A, id, 0, base()); await save(A, id, 1, edited);
}
check((await remove(B, id, 2)).status === 200, 'Foreign deletion is indistinguishable from absent');
check((await api(`/rest/v1/trips?id=eq.${id}&select=id`, A.token)).data?.length === 1, 'Foreign deletion did not modify owner');
check((await remove(A, id, 1)).status >= 400, 'Stale delete denied');
check((await remove(A, id, 2)).data?.deleted, 'Owner delete');
check((await remove(A, id, 2)).data?.deleted, 'Repeated delete safe');
const nextId = randomUUID(); await save(A, nextId, 0, base()); await remove(A, id, 2);
check((await api(`/rest/v1/trips?id=eq.${nextId}&select=id`, A.token)).data?.length === 1, 'Old delete retry cannot erase recreated trip');
await remove(A, nextId, 1);

// Real PostgreSQL sessions: the connection is administrative only for fixture setup;
// every mutation under test executes as authenticated with that owner's claims.
function sqlLiteral(value) { return "'" + value.replaceAll("'", "''") + "'"; }
function statements(owner, statement) { return `begin; set local role authenticated; select set_config('request.jwt.claims',${sqlLiteral(JSON.stringify({ sub: owner.id, role: 'authenticated' }))},true); ${statement} commit;`; }
function session(sql, ready = false) {
  const p = spawn('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1']);
  let output = ''; let error = ''; let mark;
  const marker = new Promise((resolve) => { mark = resolve; });
  p.stdout.on('data', (b) => { output += b; if (output.includes('TRIPCAST_READY')) mark(); });
  p.stderr.on('data', (b) => { error += b; });
  const result = new Promise((resolve, reject) => { p.on('error', reject); p.on('close', (code) => { mark(); resolve({ code, output, error }); }); });
  p.stdin.end(sql);
  return { marker: ready ? marker : Promise.resolve(), result };
}
const saveSql = (tripId, revision, draft) => `select public.save_trip('${tripId}', '${JSON.stringify(revision)}'::jsonb, ${sqlLiteral(JSON.stringify(draft))}::jsonb);`;
const deleteSql = (tripId, revision) => `select public.delete_trip('${tripId}','${JSON.stringify(revision)}'::jsonb);`;
async function race(first, second, expectedSecond, name) {
  const a = session(statements(A, first + "select 'TRIPCAST_READY'; select pg_sleep(1);"), true); await a.marker;
  const b = session(statements(A, second)); const [ra, rb] = await Promise.all([a.result, b.result]);
  check(ra.code === 0, name + ' first transaction');
  check(expectedSecond === 'ok' ? rb.code === 0 : rb.code !== 0 && rb.error.includes(expectedSecond), name + ' second transaction');
}
const raceId = randomUUID(); const changed = base(); changed.title = 'Concurrent';
await race(saveSql(raceId, 0, base()), saveSql(randomUUID(), 0, base()), 'TRIP_CONFLICT', 'Concurrent creates');
await race(saveSql(raceId, 1, changed), saveSql(raceId, 1, base()), 'TRIP_CONFLICT', 'Different concurrent edits');
const changed2 = base(); changed2.title = 'Same retry';
await race(saveSql(raceId, 2, changed2), saveSql(raceId, 2, changed2), 'ok', 'Identical concurrent edits');
await race(saveSql(raceId, 3, base()), deleteSql(raceId, 3), 'TRIP_CONFLICT', 'Edit then stale delete');
await race(deleteSql(raceId, 4), saveSql(raceId, 4, changed), 'TRIP_CONFLICT', 'Delete then edit');
const finalId = randomUUID(); await race(saveSql(finalId, 0, base()), deleteSql(finalId, 1), 'ok', 'Create then delete');
check((await api('/rest/v1/trips?select=id', A.token)).data?.length === 0, 'Concurrent final state remains empty');

// Local recovery email is caught by Mailpit; no external sender/hosted Auth.
check((await api('/auth/v1/recover', null, 'POST', { email: A.email })).status === 200, 'Local Auth recovery email');
const mail = await fetch('http://127.0.0.1:54324/api/v1/messages').then((r) => r.json());
check(mail.messages?.some((m) => m.To?.some((recipient) => recipient.Address === A.email)), 'Mailpit captured synthetic recovery');
console.log(`Local Data API/Auth/independent-session checks passed: ${passed}. No service-role client used.`);
