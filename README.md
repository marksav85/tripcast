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
npm run build -- --mode development
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
  conservative application bounds of 1979-01-02 through UTC today +540 days.

Unknown fields, credentials, arbitrary endpoints/URLs, invalid methods, oversized
bodies and foreign browser origins are rejected. API responses are JSON/no-store
with stable error codes. The server chooses fixed HTTPS provider paths/metric
units and normalizes responses before they reach React. Browser requests use
native fetch, never OpenWeather URLs or API keys. There is no Axios dependency.

Live weather uses a dedicated One Call 4.0 daily timeline adapter. High/low Celsius,
provider conditions, cloud cover, humidity, wind, optional UV and precipitation
probability preserve zero vs missing values. Scalar rain/snow is not exposed as a
confirmed daily total: `precipitationMm` remains null in live responses. The legacy
3.0 synthetic demo remains supported. Calendar dates remain `YYYY-MM-DD` values;
returned timestamps are matched in the provider IANA timezone, including DST.
Standard forecasts use TripCast's provisional today-through-+7 policy; later days
are labelled Long-range estimate. This is not a claim about the provider's model
switch or equal accuracy across horizons.
Retry last lookup restores the submitted query; Reset cancels/invalidates pending
work. Keyboard city choice and reduced-motion behavior are preserved.

## Secrets and environment isolation

Local fixture mode requires **no `.env` or `.dev.vars` file**. Safe examples are
provided; `.env*`, `.dev.vars*` and `.wrangler/` are ignored except example files.
Do not put weather credentials in browser settings or source. No browser
configuration is currently required.

Live integration uses only `OPENWEATHER_API_KEY` in a Worker secret binding.
Local live validation, once separately approved, uses a gitignored `.dev.vars`
file through a separately controlled path. Keep the local fixture configuration
unchanged for ordinary development. Wrangler has explicit local/staging/production
configuration; deployed/default settings disable fixtures. Fixtures also require
a loopback request hostname, so deployed local configuration fails closed.
A missing secret returns `SERVICE_UNCONFIGURED`, never fake success. No real key,
Cloudflare account/domain, deployment token or external subscription is needed
for fixture development. Staging/production secrets must be separately configured only
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
the Node/jsdom tests; new 4.0 regression fixtures are sanitized captures from Batch 4A; timezone
variants for other locations are synthetic, not live provider validation.

Lint combines supported ESLint 10 core/Hooks/Fast Refresh with Oxlint React and
accessibility checks. Tailwind stays on 3.4.19; its remaining build-tool advisories
are documented for review during Stitch redesign. Do not force upgrades to silence
audit output.

## Cache, limits and CSP

The Worker uses the Cache API for normalized public data: seven-day geocoding,
15-minute empty/unavailable results, three-hour near-term weather / 24-hour later
weather freshness, with weather stale fallback within 24/72 hours respectively.
Stale and fixture results are labeled. Live freshness and forecast labels use
provider-local today; transition into the provisional eight-day window forces
refresh. Cache namespace v2 separates live 4.0 from legacy/demo data.

Ten city/reverse lookups or five weather requests per IP/route/minute, at most
three concurrent upstream tasks, one retry for transient network/5xx failures and
bounded in-flight/map sizes are **isolate-local** controls. A visitor weather miss
allows at most two pages/four HTTP attempts including retries, with an 18-second
aggregate deadline, eight-second per-attempt timeout and three-second body-read
limit. Provider pagination links are validated as metadata; every request is
reconstructed against the fixed HTTPS host, including links returned as HTTP.
The public weather route still accepts one date, not itineraries. Cache entries are
location-local, can be evicted, and local workerd cache behavior is not worldwide
storage. Memory counters reset/repartition and minute buckets allow edge bursts.
These controls do **not** enforce a global billable account budget. Provider caps,
abuse monitoring and any cross-region coordination must be approved before public
live use. CORS/Origin restrictions are not authentication.

Static `_headers` and API security headers enforce same-origin scripts,
the exact hosted Supabase connect origin and Google Fonts stylesheet/font origins, no eval, no frames/objects and local geolocation. Lottie uses the light
expression-free build; FontAwesome uses compiled external CSS. Inline **style
attributes only** remain allowed for Lottie's transforms; script/style elements
are not opened to unsafe inline/eval. Static assets revalidate with no-cache.
HSTS/domain preload is deferred until an actual HTTPS deployment is reviewed.

## Reports

- [Preparation audit](docs/project-redesign/tripcast--phase-1--preparation-and-code-audit.md)
- [Batch 1](docs/project-redesign/tripcast--phase-1--batch-1--implementation-report.md)
- [Batch 2](docs/project-redesign/tripcast--phase-1--batch-2--implementation-report.md)
- [Batch 3](docs/project-redesign/tripcast--phase-1--batch-3--implementation-report.md)
- [Batch 4A validation](docs/project-redesign/tripcast--phase-1--batch-4a--api-validation.md)
- [Batch 4B integration](docs/project-redesign/tripcast--phase-1--batch-4b--implementation-report.md)

OpenWeather 4.0 access and Paris daily responses were validated in Batch 4A.
Daily precipitation aggregation, exact provider horizon/model boundaries,
other-location live semantics, attribution/caching rights, quota enforcement and
deployed behavior remain separate readiness checks. No subscription changes or
deployment are implied by this integration.


## Portfolio deployment preparation (Phase 4C)

Architecture: the existing Worker with Static Assets, at
`https://tripcast.marksavilledesigns.com`. The production Worker is `tripcast`.
Top-level Wrangler settings use the confirmed Supabase staging project.
The local Worker environment remains unchanged.

### Frontend build

Keep Docker settings in `.env.local`. Create a separate ignored
`.env.production.local` containing only:

```dotenv
VITE_SUPABASE_PUBLISHABLE_KEY=<staging sb_publishable_ key>
```

The public URL is tracked in `.env.production`:
`https://oowesugpxxzvyvfqqxlu.supabase.co`. Its blank key prevents fallback to
the local Docker key. Alternatively, supply both VITE variables through protected
build configuration. Shell variables take precedence over env files. The production
build fails on a wrong URL or missing/non-publishable key; the opaque key's project
association must be confirmed by the owner. VITE values are public bundle content.
Never put OpenWeather, service-role, secret keys or tokens in VITE variables.

Run `npm run build`. For ordinary local previews use `npm run preview:worker`
(which builds in development mode), or `npm run dev` for HMR.

### Worker and owner actions (after review)

Wrangler already declares these non-secret production variables:

- `SUPABASE_JWT_ISSUER=https://oowesugpxxzvyvfqqxlu.supabase.co/auth/v1`
- `SUPABASE_JWKS_URL=https://oowesugpxxzvyvfqqxlu.supabase.co/auth/v1/.well-known/jwks.json`
- `SUPABASE_JWT_AUDIENCE=authenticated`
- `SUPABASE_JWT_ALGORITHMS=ES256`
- `STAGE=production`, `MOCK_PROVIDER=false`

The only application Worker secret is `OPENWEATHER_API_KEY`; set it for the
`tripcast` Worker via the Cloudflare dashboard's Worker secret settings
(or `npx wrangler secret put OPENWEATHER_API_KEY` once the Worker
exists). It is never a frontend build variable. Existing caching and request
limits remain unchanged; provider account caps remain an owner responsibility.

Minimum owner actions:

1. Confirm `marksavilledesigns.com` is an active zone in the intended Cloudflare
   account, sign in with Wrangler, and check that the intended hostname has no
   conflicting DNS record/Worker assignment.
2. Supply the staging publishable build key and approve the production Worker
   secret. Set Supabase Auth's Site URL to `https://tripcast.marksavilledesigns.com`
   and allow the exact redirect `https://tripcast.marksavilledesigns.com/auth/callback`
   for confirmation/recovery flows; retain required local callback URLs.
3. After deployment approval, run `npm run deploy`. This builds first and deploys
   with top-level configuration (Worker name `tripcast`). Ensure its
   `OPENWEATHER_API_KEY` secret is configured before using weather features.
   The declared Custom Domain activates at deployment; Cloudflare manages its
   DNS and certificate. No manual CNAME is required. workers.dev and preview URLs
   are disabled. Do not run deploy commands during preparation.

Cloudflare GitHub integration for `tripcast`: use build command `npm run build`
and deploy command `npx wrangler deploy` (no `--env production` or name override).
Keep the production branch set to `main` and supply the hosted VITE build variables
in its build settings. Remove any `CLOUDFLARE_ENV` environment override from the
local deploy shell or GitHub build settings so top-level configuration is selected.
These dashboard settings are not stored in this repository.

Before the next deployment, confirm the Custom Domain is assigned to `tripcast`.
If it is attached to `tripcast-production`, resolve that assignment separately:
a deployment may conflict with or change the existing assignment. Runtime secrets
belong to each Worker separately; confirm `OPENWEATHER_API_KEY` exists on `tripcast`.
Removing the local environment block does not delete the redundant remote Worker.

CSP is identical for assets and Worker responses: only the exact Supabase HTTPS
origin is added to connect-src, fonts.googleapis.com to style-src and
fonts.gstatic.com to font-src. Existing Google Fonts markup stays in use without
new dependencies/assets. Other security headers and inline-style restrictions
remain intact. Realtime is unused, so no Supabase WebSocket origin is allowed.

References: [Vite env precedence](https://vite.dev/guide/env-and-mode),
[Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
