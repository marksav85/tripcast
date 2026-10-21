# TripCast

TripCast is live at https://tripcast.marksavilledesigns.com.
Repository: [marksav85/tripcast](https://github.com/marksav85/tripcast).

React/Vite/Tailwind frontend assets and the same-origin API deploy together as
Cloudflare Worker **`tripcast`** with Static Assets. Supabase Cloud provides
email/password authentication and user-owned trip persistence. The Worker accesses
OpenWeather using an `OPENWEATHER_API_KEY` runtime secret; the browser never receives
that credential. Saved trips include per-day weather and rule-based clothing advice.

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
provided; local `.env*`, `.dev.vars*` and `.wrangler/` files are ignored.
Public `.env.production` defaults and example files are tracked. Browser authentication
uses only the public Supabase URL and publishable key. Never put weather credentials
in browser settings or source.

Live integration uses only `OPENWEATHER_API_KEY` in a Worker secret binding.
Local live validation, once separately approved, uses a gitignored `.dev.vars`
file through a separately controlled path. Keep the local fixture configuration
unchanged for ordinary development. Wrangler has named local/staging environments
and top-level production configuration; deployed/default settings disable fixtures. Fixtures also require
a loopback request hostname, so deployed local configuration fails closed.
A missing secret returns `SERVICE_UNCONFIGURED`, never fake success. No real key,
Cloudflare account/domain, deployment token or external subscription is needed
for fixture development. Runtime secrets belong to their individual Worker;
production uses `tripcast`. The working manual deployment command is `npm run deploy`.

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


## Production deployment

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

### Working manual deployment

```sh
npm run deploy
```

This runs `npm run build && wrangler deploy` against top-level Worker `tripcast`.
Use the intended Cloudflare account and no `CLOUDFLARE_ENV` override. The Custom
Domain is already assigned to `tripcast`; routine deployment needs no DNS or secret
changes. workers.dev and preview URLs remain disabled. Deployment requires owner
authorization; a maintenance check should not execute this command.

### GitHub automatic deployment

Cloudflare GitHub integration for `tripcast`: use build command `npm run build`
and deploy command `npx wrangler deploy` (no `--env production` or name override).
Keep the production branch set to `main` and supply the hosted VITE build variables
in its build settings. Remove any `CLOUDFLARE_ENV` environment override from the
local deploy shell or GitHub build settings so top-level configuration is selected.
These dashboard settings are not stored in this repository.

The former named production environment created a separate `tripcast-production`
Worker. It is redundant and is not the deployment target. Its later removal is a
separate owner action, not part of routine deployment or maintenance.

### Environment boundaries

| Location | Purpose |
| --- | --- |
| Ignored `.env.local` | Local Docker Supabase URL and publishable browser key for Vite development |
| Tracked `.env.production` | Public hosted URL and deliberately blank key default |
| Ignored `.env.production.local` | Hosted publishable key for local production builds |
| Cloudflare GitHub build variables | Hosted VITE URL/key; ignored local files do not reach CI |
| Ignored `.dev.vars` / `.dev.vars.local` | Local Worker bindings only; not production secret provisioning |
| `wrangler.jsonc` top-level `vars` | Public production stage and JWT verification settings |
| `tripcast` runtime secret | `OPENWEATHER_API_KEY`; never a VITE build variable |

Keep the existing local binding files intact. `npm run dev:worker` selects the local
Wrangler environment. Production Supabase Auth callbacks use the public origin and
`/auth/callback`; retain local callbacks needed for Docker development.

### Maintenance notes and pending CI investigation

- Vite's existing chunk-size warning is non-blocking. Bundle splitting is deferred.
- `tests/TripWeatherPreview.test.jsx` has two previously reproduced failures on
  unchanged HEAD: “makes weather available after saving the first trip” and
  “deletes weather together with the saved baseline”. They involve stale editor
  expectations and are outside this maintenance pass.
- GitHub automatic deployment reliability remains unverified. No failed build log
  or repository-owned CI workflow was available for this investigation; local
  configuration alone cannot establish its failure cause.
- Inspect the failed build's first error and failing command in `tripcast` Settings
  → Builds before changing configuration. If Vite reports missing hosted settings,
  supply the publishable key in **build** variables (a runtime secret does not
  supply frontend build inputs). If Wrangler reports a missing production environment
  or wrong Worker, remove the obsolete `--env production`/name override in the
  dashboard deploy command. If it reports a domain conflict, inspect assignments
  before taking action. These are conditional checks, not confirmed failure causes.
- Record the failing commit, Node version (project requires Node 24.21.x), build
  command, deploy command and sanitized first error. Reconcile only the setting
  shown to be wrong, then authorize a CI retry separately.
- Temporary per-attempt OpenWeather console diagnostics have been removed after
  resolving unsupported redirect handling. Manual redirect rejection, bounded
  retries and sanitized public errors remain in place. No replacement logging
  infrastructure has been added.

CSP is identical for assets and Worker responses: only the exact Supabase HTTPS
origin is added to connect-src, fonts.googleapis.com to style-src and
fonts.gstatic.com to font-src. Existing Google Fonts markup stays in use without
new dependencies/assets. Other security headers and inline-style restrictions
remain intact. Realtime is unused, so no Supabase WebSocket origin is allowed.

References: [Vite env precedence](https://vite.dev/guide/env-and-mode),
[Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
