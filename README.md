# Travel Weather App

## Overview

The **Travel Weather App** is a React-based application that allows users to check the weather for a specific city on a chosen date. It provides weather information, including temperature, cloud cover, and rainfall, and displays relevant weather and temperature icons. Users can also use their current location to fetch weather data automatically.

## Features

- **Weather Information**: Fetches and displays weather details including temperature, cloud cover, and rainfall for a specified city and date.
- **Location-Based Weather**: Allows users to use their current location to automatically set the city for weather queries.
- **Dynamic Icons**: Displays weather and temperature icons based on the current conditions and temperature.
- **Date Selection**: Users can choose a specific travel date or use today's date as a default.

## Technologies Used

- **React**: Frontend framework for building user interfaces.
- **Axios**: HTTP client for making API requests to fetch weather data.
- **Node.js**: Runtime environment for executing server-side code.
- **Vite**: Build tool and development server.
- **Tailwind CSS**: Utility-first CSS framework for styling.
- **Vercel**: Deployment platform for hosting the React app.
- **Lottie**: Animation library for interactive animations.
- **FontAwesome**: Icon library used for interactive buttons.

## Installation

1. **Clone the repository**:
   - git clone https://github.com/marksav85/Travel-App-React.git
   - cd travel-app-react
2. **Install dependencies:**:
   - npm install
3. **Set up environment variables:**:

   - Visit [OpenWeatherMap](https://openweathermap.org/api) and obtain an API key for _One Call API 3.0_
   - Create a .env file in the root directory and add the following environment variables:
   - VITE_API_KEY=(Add your One Call API Key here)

4. **Start the development server:**:
   - npm run dev

## Usage

- **Enter a City and Date**: Use the form to input a city and travel date, then click "Submit" to fetch weather data.
- **Use Current Location**: Click the location icon to automatically set the city based on your current location.
- **Reset**: Use the "Reset" button to clear the form and reset the application state.

## Acknowledgements

- **OpenWeatherMap**: For weather data API.
- **Lottie**: For interactive animations.
- **FontAwesome**: For iconography.

## Batch 1 development baseline

Use **Node.js 24.21.0 LTS** (`nvm install && nvm use`; pinned in `.nvmrc`).
The supported runtime range is Node 24 from 24.21.0; this batch was verified with
npm 11.19.0. Install reproducibly with `npm ci` using the committed lockfile.

```sh
npm ci
npm run lint
npm run test:run
npm run build
```

`npm test` runs Vitest in watch mode; `npm run check` runs lint, tests and build.
Tests use jsdom and React Testing Library with mocked context actions. Unexpected
Axios/fetch requests fail; no weather credentials are required for these checks.
The initial tests cover stable form behavior and the header, not live weather
capability or the reliability defects scheduled for later batches.

Lint uses ESLint 10 flat configuration for JavaScript, React Hooks and Fast
Refresh, plus Oxlint's React and JSX accessibility rules. Both must pass the
single `npm run lint` command. Current `eslint-plugin-react` and
`eslint-plugin-jsx-a11y` peer ranges exclude ESLint 10; ESLint 9 is end-of-life.
No forced peer installation is used.

Tailwind remains on **3.4.19** with the existing stylesheet/configuration.
Outstanding build-tool advisories and retained Axios risks are tracked in
[the Batch 1 implementation report](docs/project-redesign/tripcast--phase-1--batch-1--implementation-report.md).
Revisit Tailwind 4 during the approved Stitch redesign. The existing browser
OpenWeather integration remains unchanged in this batch; its public-key design
is still scheduled for the later Worker/security batch.


## Batch 2 lookup behavior

City/date fields remain editable after a lookup. Submit resolves cities, lets you
choose among matching locations, and reuses selected coordinates for later dates.
Reset cancels pending work and clears the draft/result. Retry last lookup restores
and retries the submitted query; edits do not relabel previously loaded weather.
Today uses your browser's local calendar date.

Weather cards now show high/low Celsius temperatures, cloud-cover snapshots and
total precipitation (liquid-water equivalent). Missing measurements are unavailable;
the daily summary does not supply a validated condition code. Loading and location
errors are announced, controls have accessible names, and reduced motion is respected.

The expanded test suite uses synthetic existing-endpoint fixtures and mocked Axios
responses. It does not validate One Call 4.0 or require a key. The existing browser
API key mechanism remains pending the separately authorized Worker security batch.
See [the Batch 2 report](docs/project-redesign/tripcast--phase-1--batch-2--implementation-report.md)
for verification and deferred work.
