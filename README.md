# TripCast

A React/Vite/Tailwind single-city weather lookup with editable dates, city
selection, browser geolocation, safe reset/retry behavior and normalized daily
measurements. Cloudflare Workers Static Assets serves the production build;
a same-origin Worker owns provider access. Supabase/trips and the Stitch redesign
are later phases.

## Runtime and installation

Use **Node 24.21.0 LTS**, pinned in `.nvmrc` (supported range `>=24.21.0 <25`).
Verification uses npm 11.19.0.

```sh
nvm install
nvm use
npm ci
```

## Local development — no credentials

First build the static assets, then run the local Worker:

```sh
npm run build
npm run dev:worker
```

Open `http://127.0.0.1:8787` to use the built app with synthetic provider data.
`npm run preview:worker` combines build and local Worker startup. Local fixtures
include Berlin, ambiguous London matches and an empty result for “Missing City”.
Results explicitly identify demonstration data. They are not live forecasts or
validated One Call 4.0 responses.

For frontend hot reload, keep the Worker running and use a second terminal:

```sh
npm run dev
```

Open `http://localhost:5173`; Vite proxies `/api` to port 8787. Only known local
browser origins are translated by the development proxy. Both servers must run.
`npm start` is Vite-only static preview and does not supply the API; use the Worker
preview for integration/security checks. Keep development servers local.

## API boundary

- `GET /api/geocode?q=...`: trimmed 2–100-character city; up to five candidates.
- `GET /api/reverse-geocode?lat=...&lon=...`: finite bounded coordinates.
- `POST /api/weather`: JSON `{ "lat": 52.52, "lon": 13.405, "date": "2026-10-13" }`.
  One location/date only; 16 KiB streamed body cap, strict calendar validation and
  provisional existing-adapter bounds of 1979-01-02 through UTC today +540 days.

Unknown fields, credentials, arbitrary endpoints/URLs, invalid methods, oversized
bodies and foreign browser origins are rejected. API responses are JSON/no-store
with stable error codes. The server chooses fixed HTTPS provider paths/metric
units and normalizes responses before they reach React. Browser requests use
native fetch, never OpenWeather URLs or API keys. There is no Axios dependency.

High/low Celsius, snapshot cloud cover and total liquid-water-equivalent
precipitation preserve zero vs missing values. Conditions unavailable from the
existing daily summary are not guessed. Calendar dates remain `YYYY-MM-DD` values.
Retry last lookup restores the submitted query; Reset cancels/invalidates pending
work. Keyboard city choice and reduced-motion behavior are preserved.

## Secrets and environment isolation

Local fixture mode requires **no `.env` or `.dev.vars` file**. Safe examples are
provided; `.env*`, `.dev.vars*` and `.wrangler/` are ignored except example files.
Do not put weather credentials in browser settings or source. No browser
configuration is currently required.

Future live integration uses only `OPENWEATHER_API_KEY` in a Worker secret binding.
Local live validation, once separately approved, uses a gitignored `.dev.vars`
file and fixture mode disabled. Wrangler has explicit local/staging/production
configuration; deployed/default settings disable fixtures. Fixtures also require
a loopback request hostname, so deployed local configuration fails closed.
A missing secret returns `SERVICE_UNCONFIGURED`, never fake success. No real key,
Cloudflare account/domain, deployment token or external subscription is needed
for this batch. Staging/production secrets must be separately configured only
after authorization. No deployment script or deployment is included.

## Verification

```sh
npm run lint
npm run test:run
npm run build
npm run check
npm audit --package-lock-only --ignore-scripts
```

`npm test` watches client tests. `test:client` includes mocked React-to-Worker
integration; `test:worker` runs deterministic Worker Fetch/Streams/cache tests in
Node with injected provider/cache/clock dependencies. `test:run` and `check` run
both suites. Local Wrangler/workerd and headless Chrome smoke checks complement
the Node/jsdom tests; no live-provider contract is claimed.

Lint combines supported ESLint 10 core/Hooks/Fast Refresh with Oxlint React and
accessibility checks. Tailwind stays on 3.4.19; its remaining build-tool advisories
are documented for review during Stitch redesign. Do not force upgrades to silence
audit output.

## Cache, limits and CSP

The Worker uses the Cache API for normalized public data: seven-day geocoding,
15-minute empty/unavailable results, three-hour near-term weather / 24-hour later
weather freshness, with weather stale fallback within 24/72 hours respectively.
Stale and fixture results are labeled. Without destination timezone validation,
the UTC +8-day cache boundary is conservative; it does not label forecast confidence.

Ten city/reverse lookups or five weather requests per IP/route/minute, at most
three concurrent upstream tasks, one retry for transient network/5xx failures and
bounded in-flight/map sizes are **isolate-local** controls. Cache entries are
location-local, can be evicted, and local workerd cache behavior is not worldwide
storage. Memory counters reset/repartition and minute buckets allow edge bursts.
These controls do **not** enforce a global billable account budget. Provider caps,
abuse monitoring and any cross-region coordination must be approved before public
live use. CORS/Origin restrictions are not authentication.

Static `_headers` and API security headers enforce same-origin script/connect
sources, no eval, no frames/objects and local geolocation. Lottie uses the light
expression-free build; FontAwesome uses compiled external CSS. Inline **style
attributes only** remain allowed for Lottie's transforms; script/style elements
are not opened to unsafe inline/eval. Static assets revalidate with no-cache.
HSTS/domain preload is deferred until an actual HTTPS deployment is reviewed.

## Reports

- [Preparation audit](docs/project-redesign/tripcast--phase-1--preparation-and-code-audit.md)
- [Batch 1](docs/project-redesign/tripcast--phase-1--batch-1--implementation-report.md)
- [Batch 2](docs/project-redesign/tripcast--phase-1--batch-2--implementation-report.md)
- [Batch 3](docs/project-redesign/tripcast--phase-1--batch-3--implementation-report.md)

OpenWeather is the intended data provider. The existing 3.0 adapter is preserved
for compatibility; 4.0 entitlement, timezone/precipitation semantics, attribution,
pricing and sustainable quotas require separately authorized validation before
live readiness. No subscription changes are implied by this code.
