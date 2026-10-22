import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faLocationDot,
  faCalendarDays,
  faCloudSun,
  faCirclePlus,
  faArrowRight,
  faMagnifyingGlass,
} from '@fortawesome/free-solid-svg-icons';

const steps = [
  {
    icon: faLocationDot,
    title: 'Choose your destinations',
    description: 'Add the cities you’d like to visit.',
  },
  { icon: faCalendarDays, title: 'Set your travel dates', description: 'Build your itinerary.' },
  {
    icon: faCloudSun,
    title: 'Explore the weather',
    description: 'Check conditions throughout your journey.',
  },
];

function JourneyIllustration() {
  return (
    <svg
      className="trip-empty-illustration"
      viewBox="0 0 480 180"
      aria-hidden="true"
      focusable="false"
      fill="none"
    >
      <path
        className="trip-empty-route"
        d="M55 128C115 28 167 152 252 85S357 35 427 87"
        strokeWidth="2"
        strokeDasharray="5 6"
      />
      {[
        ['55', '128'],
        ['252', '85'],
        ['427', '87'],
      ].map(([cx, cy]) => (
        <g key={cx}>
          <circle className="trip-empty-waypoint" cx={cx} cy={cy} r="14" />
          <circle className="trip-empty-point" cx={cx} cy={cy} r="6" />
        </g>
      ))}
      <g transform="translate(177 108) rotate(-8)">
        <rect className="trip-empty-passport" width="38" height="48" rx="5" />
        <path
          className="trip-empty-route"
          d="M8 10H30M8 17H23"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle className="trip-empty-waypoint" cx="24" cy="33" r="6" />
      </g>
      <g transform="translate(22 54)">
        <rect className="trip-empty-weather-tile" width="66" height="42" rx="10" />
        <circle className="trip-empty-sun" cx="33" cy="21" r="7" strokeWidth="1.5" />
        <path
          className="trip-empty-sun"
          d="M33 7V10M33 32V35M19 21H22M44 21H47M23 11L25 13M41 29L43 31M23 31L25 29M41 13L43 11"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </g>
      <g transform="translate(219 12)">
        <rect className="trip-empty-weather-tile" width="66" height="42" rx="10" />
        <path
          className="trip-empty-wind"
          d="M17 17H41C48 17 48 8 42 8C38 8 38 12 38 12M14 23H49M21 29H40C46 29 46 36 41 36"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </g>
      <g transform="translate(393 15)">
        <rect className="trip-empty-weather-tile" width="66" height="42" rx="10" />
        <path
          className="trip-empty-cloud"
          d="M22 26C12 26 14 14 23 15C26 5 41 9 41 16C52 15 53 28 43 28H22Z"
        />
        <path
          className="trip-empty-wind"
          d="M27 31L25 35M36 31L34 35"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

/** Presentation only. The dashboard owns load guards, navigation, and persistence. */
export default function TripEmptyState({ onCreate, onWeatherSearch, disabled }) {
  return (
    <section aria-label="No saved trip" className="trip-empty-state">
      <div className="trip-empty-welcome">
        <JourneyIllustration />
        <h3>Your next adventure starts here.</h3>
        <p className="trip-empty-description">
          Plan your journey, add your destinations, and discover the weather throughout your trip.
        </p>
        <button
          type="button"
          className="trip-button trip-button-primary trip-empty-create"
          disabled={disabled}
          onClick={onCreate}
        >
          <FontAwesomeIcon icon={faCirclePlus} aria-hidden="true" />
          Create Your Trip
          <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
        </button>
        <p className="trip-empty-limits">
          One saved trip at a time · Up to eight destinations · Up to 42 covered calendar days
        </p>
      </div>
      <section className="trip-empty-workflow" aria-labelledby="trip-empty-workflow-title">
        <h3 id="trip-empty-workflow-title">How TripCast works</h3>
        <ol className="trip-empty-steps">
          {steps.map(({ icon, title, description }, index) => (
            <li key={title}>
              <span className="trip-empty-step-icon" aria-hidden="true">
                <FontAwesomeIcon icon={icon} />
              </span>
              <h4>
                {index + 1}. {title}
              </h4>
              <p>{description}</p>
            </li>
          ))}
        </ol>
      </section>
      <aside className="trip-empty-discovery" aria-label="Single-city weather search">
        <span className="trip-empty-step-icon" aria-hidden="true">
          <FontAwesomeIcon icon={faMagnifyingGlass} />
        </span>
        <div>
          <h3>Looking for single-city weather instead?</h3>
          <p>Check a city and travel date without building an itinerary.</p>
        </div>
        <button type="button" className="trip-button" onClick={onWeatherSearch}>
          Weather Search <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
        </button>
      </aside>
    </section>
  );
}
