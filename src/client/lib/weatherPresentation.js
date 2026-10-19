import { faBolt, faCloudRain, faSnowflake, faSun, faCloudSun, faCloud, faSmog, faMoon, faCloudMoon } from '@fortawesome/free-solid-svg-icons';

// Static icons from the existing dependency respect reduced motion without animation.
export function conditionIcon(condition) {
  const id = condition?.id;
  const night = condition?.icon?.endsWith('n');
  if (id >= 200 && id < 300) return faBolt;
  if (id >= 300 && id < 600) return faCloudRain;
  if (id >= 600 && id < 700) return faSnowflake;
  if (id >= 700 && id < 800) return faSmog;
  if (id === 800) return night ? faMoon : faSun;
  if (id === 801 || id === 802) return night ? faCloudMoon : faCloudSun;
  return faCloud;
}

