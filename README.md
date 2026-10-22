# TripCast — Travel weather and itinerary planner

TripCast helps travellers check destination weather and plan a multi-stop journey.
Built with React, a Cloudflare Worker API and Supabase, it combines public city-and-date
weather searches with a personal itinerary workspace, daily weather summaries and
rule-based clothing recommendations.

**[Explore the live application](https://tripcast.marksavilledesigns.com/)**

## Features

- **Public weather search:** find a city, choose between matching locations or use
  browser geolocation, then check weather for a selected date without signing in.
- **Multi-destination planning:** create, edit and delete one saved trip per account,
  with up to eight ordered destinations across 42 days.
- **Daily trip weather:** explore temperatures and available conditions throughout a
  saved journey. Refresh or cancel requests, and see successful days alongside any
  unavailable results or retrieval errors.
- **Clothing recommendations:** receive packing suggestions based on temperatures,
  feels-like readings, rain probability, wind and UV. Advice for long-range estimates
  is marked provisional.
- **Account management:** register and sign in with email/password, recover a password,
  sign out locally or delete an account after explicit confirmation.
- **Accessible interactions:** keyboard-operable location selection, labelled forms,
  focus management, status announcements and reduced-motion handling.

## Technology stack

| Area                     | Technologies                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Frontend                 | JavaScript, React 18, Vite 7, Tailwind CSS 3, React Context and custom hooks            |
| UI                       | Radix UI, React DayPicker, Font Awesome                                                 |
| Backend and hosting      | Cloudflare Workers with Static Assets                                                   |
| Authentication and data  | Supabase Auth and PostgreSQL                                                            |
| Weather and locations    | OpenWeather geocoding and One Call 4.0 daily timeline; coordinate-based timezone lookup |
| Testing and code quality | Vitest, React Testing Library, jsdom, database tests, ESLint, Oxlint and Prettier       |

## Technical highlights

- **Calendar-safe travel dates:** arrival and departure remain date-only values,
  avoiding timezone shifts during storage and editing. Each stay includes arrival
  and excludes departure, giving each covered day one destination. Shared validation
  checks the complete itinerary before saving or allocating weather dates.
- **Explicit weather semantics:** normalization preserves missing measurements versus
  zero and presents metric units. Provider timestamps are matched to calendar days in
  the provider's IANA timezone, including daylight-saving transitions. Scalar rain
  values are not presented as confirmed daily precipitation totals.
- **Conflict-aware persistence:** transactional database functions save the trip and
  its destinations together. Revision checks detect stale edits and deletions, so a
  second tab cannot silently overwrite a newer itinerary.
- **Resilient retrieval:** caching, bounded retries, timeouts and concurrency controls
  limit upstream work. Transient failures can use labelled stale data, while partial
  itinerary results keep successful days available. Request counters are isolate-local
  rather than a global provider quota.
- **Protected service boundaries:** OpenWeather credentials stay in the Worker.
  Upstream requests use allowlisted destinations and reject redirects that could
  expose credentials. Protected routes verify Supabase JWT signatures and claims;
  administrative account deletion additionally checks the current Auth user.

## How it works

### Weather search and trip forecasts

The React frontend manages search, authentication and itinerary state through Context
and custom hooks. Weather searches go through the same-origin Worker API, which
validates requests, calls OpenWeather and normalizes responses for presentation.

For trip weather, the browser submits a validated itinerary snapshot to an
authenticated Worker route. The Worker groups destination dates into bounded batches
and returns daily outcomes, allowing errors to be shown without discarding successful
results. Weather retrieval is separate from saving a trip: the database stores the
itinerary, while weather is fetched and cached independently.

Forecast labels distinguish historical weather, standard forecasts and long-range
estimates. The standard forecast window covers destination-local today through the
following seven days; later dates are provisional long-range estimates. This is
TripCast's presentation policy, not a claim about a provider model boundary or equal
accuracy across forecast horizons. Data availability depends on the date and provider.

### Authentication and persistence

The Supabase browser SDK manages sessions, refresh and account recovery. The frontend
uses a public publishable key to access user-owned trip data. PostgreSQL stores trips
and ordered destinations; row-level security restricts reads, while transactional
save/delete functions explicitly enforce authenticated ownership and revision checks.

Account deletion uses the Worker's administrative integration rather than a privileged
browser client. After verifying identity and confirming the Auth user still exists,
the Worker deletes that user; the schema's cascading foreign keys remove the associated
trip and destinations. Local account state and persisted session records are cleared
only after server-confirmed deletion. Existing access tokens can remain valid until
expiry; account deletion does not introduce general token revocation.

## Getting started

Use Node.js **24.21.0**, pinned in `.nvmrc`, and npm.

```sh
nvm install
nvm use
npm ci
npm run preview:worker
```

Open `http://127.0.0.1:8787`. The preview script builds assets in development mode and
starts the local Worker with synthetic weather fixtures. Public weather exploration
requires no provider credentials or Supabase account. Fixture results are labelled
demonstration data and are not live forecasts.

For frontend hot reload, keep the Worker running and start `npm run dev` in a second
terminal. Open `http://localhost:5173`; Vite proxies API requests to the local Worker.
`npm start` supplies a static preview only, without the API.

### Optional account features

Local authentication and saved trips require Docker, local Supabase and the repository's
database migrations. Set the local Supabase URL and public publishable key in ignored
`.env.local`, using `.env.example` as the configuration template. Database reset and
test scripts are guarded for the project's isolated local Docker environment; they
are not a general-purpose setup for an arbitrary Supabase instance. Account deletion
is restricted to the configured hosted project and is unavailable against local Docker.

### Testing and build

```sh
npm run lint
npm run format:check
npm run test:client
npm run test:worker
npm run build
```

Client tests cover React interactions and mocked integrations. Worker tests exercise
provider requests, caching, authentication and response handling. Database tests cover
ownership and persistence rules against the isolated local Supabase setup.

Production builds require the configured hosted Supabase URL and a matching public
publishable key in production build settings. Use `npm run preview:worker` for a
credential-free weather demonstration instead.

## Deployment

The deployment configuration serves the React build and same-origin API together as
Cloudflare Worker `tripcast` with Static Assets and SPA fallback. Supabase provides
hosted authentication and PostgreSQL persistence; OpenWeather supplies weather and
location data. Local fixtures are isolated from the production configuration.

Frontend builds contain only public Supabase settings. Weather and administrative
credentials belong in Worker runtime secrets, never frontend environment variables or
source. Authentication callbacks use the application's own origin. Cloudflare and
Supabase settings must remain aligned with that origin and the intended project.

## Credits

Weather and geocoding data are supplied by OpenWeather. Local demonstration weather
is synthetic; tests also use sanitized provider captures and synthetic timezone cases.
Clothing recommendations are informal packing guidance, not a weather or safety guarantee.
