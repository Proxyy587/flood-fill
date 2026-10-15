/**
 * Render-only time of day. The simulation clock is `startTimeSeconds + tick`;
 * this turns it into sun position and how much daylight there is. Sunrise and
 * sunset are annual averages for Guwahati (26°N); synthetic, not an almanac.
 */
export const SUNRISE = 5 * 3600 + 15 * 60;
export const SUNSET = 17 * 3600 + 45 * 60;
/** Highest sun elevation (radians) at local noon. */
const NOON_ELEVATION = 1.15;

export interface Daylight {
  /** Seconds after midnight, 0..86399. */
  seconds: number;
  /** Sun elevation in radians (negative below the horizon). */
  elevation: number;
  /** Unit vector toward the sun: east = +x, south = +z, up = +y. */
  sun: { x: number; y: number; z: number };
  /** 0 = night, 1 = full day. */
  day: number;
  /** 0..1, strongest just after sunrise and before sunset. */
  golden: number;
  /** 0..1 clear morning blue (peaks mid-morning). */
  morning: number;
  /** 0..1 bright afternoon (peaks near noon–3pm). */
  afternoon: number;
  /** 0..1 deep midnight (peaks around 00:00). */
  midnight: number;
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const daylightAt = (secondsOfDay: number): Daylight => {
  const seconds = ((secondsOfDay % 86400) + 86400) % 86400;
  const dayLength = SUNSET - SUNRISE;
  let elevation: number;
  let arc: number;
  if (seconds >= SUNRISE && seconds <= SUNSET) {
    arc = (seconds - SUNRISE) / dayLength;
    elevation = Math.sin(Math.PI * arc) * NOON_ELEVATION;
  } else {
    const since = (seconds - SUNSET + 86400) % 86400;
    const nightArc = since / (86400 - dayLength);
    arc = 1 + nightArc;
    elevation = -Math.sin(Math.PI * nightArc) * 0.9;
  }
  const flat = Math.cos(elevation);
  const sun = { x: Math.cos(Math.PI * arc) * flat, y: Math.sin(elevation), z: Math.abs(Math.sin(Math.PI * arc)) * flat * 0.45 };
  const len = Math.hypot(sun.x, sun.y, sun.z) || 1;
  const day = smooth(-0.12, 0.22, elevation);
  const golden = day > 0 ? (1 - smooth(0.05, 0.45, elevation)) * smooth(-0.12, 0.02, elevation) : 0;
  const hour = seconds / 3600;
  // Perfect morning ~07–10, afternoon ~12–16, midnight deepest around 00:00.
  const morning = day * smooth(6, 7.5, hour) * (1 - smooth(10.5, 12, hour)) * (1 - golden);
  const afternoon = day * smooth(11, 12.5, hour) * (1 - smooth(16, 17.5, hour)) * (1 - golden * 0.85);
  const midDist = Math.min(Math.abs(hour), Math.abs(hour - 24));
  const midnight = (1 - day) * (1 - smooth(0, 3.5, midDist));
  return {
    seconds,
    elevation,
    sun: { x: sun.x / len, y: sun.y / len, z: sun.z / len },
    day,
    golden,
    morning,
    afternoon,
    midnight,
  };
};
