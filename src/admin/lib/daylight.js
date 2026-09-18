/* ─────────────────────────────────────────────────────────────────────
 * Is it day or night where this browser is?
 *
 * Used by the dashboard's automatic dark mode. There is no location
 * permission involved and no network call: the browser's IANA time zone
 * gives an approximate latitude and longitude, and the standard sunrise
 * equation turns that into today's sunrise and sunset.
 *
 * An approximation is the right tool here — being a few minutes out only
 * shifts when the dashboard changes colour.
 * ───────────────────────────────────────────────────────────────────── */

/* The zones our venues and staff actually sit in, plus the ones a laptop
 * is likely to report. Anything else falls back to the longitude implied
 * by the UTC offset at latitude 45°, which is close enough. */
const ZONE_COORDS = {
  'Europe/Amsterdam': [52.37, 4.90],
  'Europe/Brussels': [50.85, 4.35],
  'Europe/London': [51.51, -0.13],
  'Europe/Paris': [48.86, 2.35],
  'Europe/Berlin': [52.52, 13.40],
  'Europe/Madrid': [40.42, -3.70],
  'Europe/Lisbon': [38.72, -9.14],
  'Europe/Rome': [41.90, 12.50],
  'Europe/Zurich': [47.38, 8.54],
  'Europe/Vienna': [48.21, 16.37],
  'Europe/Stockholm': [59.33, 18.07],
  'Europe/Copenhagen': [55.68, 12.57],
  'Europe/Oslo': [59.91, 10.75],
  'Europe/Dublin': [53.35, -6.26],
  'Asia/Dubai': [25.20, 55.27],
  'Asia/Qatar': [25.29, 51.53],
  'Asia/Riyadh': [24.71, 46.68],
  'Asia/Singapore': [1.35, 103.82],
  'Asia/Tokyo': [35.68, 139.69],
  'America/New_York': [40.71, -74.01],
  'America/Chicago': [41.88, -87.63],
  'America/Los_Angeles': [34.05, -118.24],
  'America/Toronto': [43.65, -79.38],
  'Australia/Sydney': [-33.87, 151.21],
};

const RAD = Math.PI / 180;

function coordsFor(date) {
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* keep empty */ }
  const known = ZONE_COORDS[zone];
  if (known) return known;
  // No match: the UTC offset puts us within an hour of the right meridian.
  const offsetHours = -date.getTimezoneOffset() / 60;
  return [45, Math.max(-180, Math.min(180, offsetHours * 15))];
}

/* Sunrise and sunset as hours after local midnight, or null on a polar day
 * or night (where the sun never crosses the horizon). */
function solarEvents(date, lat, lon) {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date - start) / 86400000);

  // Fractional year → the sun's declination and the equation of time.
  const g = (2 * Math.PI / 365) * (dayOfYear - 1 + 0.5);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);

  // The hour angle where the sun's centre sits 0.833° below the horizon
  // (the usual sunrise definition: refraction plus the sun's radius).
  const cosHa = (Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)))
    - Math.tan(lat * RAD) * Math.tan(decl);
  if (cosHa > 1 || cosHa < -1) return null;
  const ha = Math.acos(cosHa) / RAD;

  const offsetMinutes = -date.getTimezoneOffset();
  const noon = (720 - 4 * lon - eqTime + offsetMinutes) / 60;
  return { sunrise: noon - ha / 15, sunset: noon + ha / 15 };
}

/* 'day' or 'night' for the browser's own time zone and clock. */
export function daylightPhase(date = new Date()) {
  const [lat, lon] = coordsFor(date);
  const events = solarEvents(date, lat, lon);
  const hour = date.getHours() + date.getMinutes() / 60;
  if (!events) {
    // Polar day or night: fall back to a plain clock split.
    return hour >= 7 && hour < 19 ? 'day' : 'night';
  }
  return hour >= events.sunrise && hour < events.sunset ? 'day' : 'night';
}

/* Milliseconds until the phase flips, capped so a long polar day still
 * re-checks now and then. */
export function msUntilPhaseChange(date = new Date()) {
  const [lat, lon] = coordsFor(date);
  const events = solarEvents(date, lat, lon);
  const HOUR = 3600000;
  if (!events) return 6 * HOUR;
  const hour = date.getHours() + date.getMinutes() / 60;
  const next = hour < events.sunrise ? events.sunrise
    : hour < events.sunset ? events.sunset
      : events.sunrise + 24;
  return Math.max(60000, Math.min(6 * HOUR, (next - hour) * HOUR));
}
