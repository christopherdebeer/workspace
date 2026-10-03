/**
 * The light: sun by day, moon by night, both behind the fog. Everything the
 * picture needs follows from where they are — the fog's colour low and high,
 * how bright the wood is, the brighter place in the sky where the light is,
 * and the direction that shades the round wood.
 *
 * Fully parameterised (all optional, in the address):
 *   ?hour=0–24     time of day (default: your clock); it passes in real time
 *   ?moon=0–1      the moon's phase (default: tonight's); 0 new, 0.5 full
 *   ?fog=0.5–3     fog thickness, times the wood's own
 *   ?warm=-1–1     a tint towards cool or warm
 * The baseline is dark: a fog that holds the light rather than glowing.
 */

export interface Atmos {
  fogLow: [number, number, number];
  fogHigh: [number, number, number];
  /** what lights the wood (colour × strength) and the sky's share of it */
  illum: [number, number, number];
  /** the key light (sun, or moon at night): world direction, glow colour, how strong its glow */
  dir: [number, number, number];
  glow: [number, number, number];
  /** azimuth, elevation of the key light (for the glow in the sky) */
  at: [number, number];
  /** 0 night … 1 day */
  day: number;
  /** the eye's adaptation: brighter at night, never all the way (night stays night) */
  exposure: number;
}

type V3 = [number, number, number];
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** The moon's phase for a date (0 new … 0.5 full … 1 new), from a known new moon and the synodic month. */
export function moonPhase(d: Date): number {
  const days = (d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  return (((days / 29.530588) % 1) + 1) % 1;
}

/**
 * The atmosphere at an hour. `warm` tints it; `phase` is the moon's.
 * Sun: rises in the east (azimuth −π/2, to the left of the path's general way), highest at
 * noon in the south ahead (azimuth 0); the moon about opposite.
 */
export function atmosphere(hour: number, phase: number, warm = 0): Atmos {
  const h = ((hour % 24) + 24) % 24;
  const sunEl = Math.sin(((h - 6) / 12) * Math.PI) * 0.72;
  const sunAz = ((h - 12) / 12) * Math.PI;
  const moonEl = Math.sin(((h - 18) / 12) * Math.PI) * 0.6;
  const moonAz = ((h - 24) / 12) * Math.PI + 0.4;
  // the moon's light: none when new, most when full
  const moonLight = Math.sin(phase * Math.PI) ** 1.5;
  const day = smooth(-0.12, 0.08, sunEl);
  const low = 1 - smooth(0.05, 0.35, sunEl); // a low sun warms the fog
  // the fog by day (darker than glare: the light held in it), low sun, twilight, moonlit night
  // (graded against a photograph of a misty wood: grey-green, not teal; the low fog a little warmer)
  const dayLow: V3 = [0.45, 0.5, 0.42];
  const dayHigh: V3 = [0.5, 0.58, 0.5];
  const warmLow: V3 = [0.45, 0.42, 0.33];
  const warmHigh: V3 = [0.51, 0.47, 0.37];
  const duskLow: V3 = [0.16, 0.17, 0.2];
  const duskHigh: V3 = [0.21, 0.22, 0.26];
  const nightLow: V3 = scale([0.065, 0.075, 0.088], 0.6 + 0.8 * moonLight);
  const nightHigh: V3 = scale([0.085, 0.097, 0.112], 0.6 + 0.8 * moonLight);
  let fogLow = mix(dayLow, warmLow, low * day * 0.7);
  let fogHigh = mix(dayHigh, warmHigh, low * day * 0.7);
  const dusk = smooth(-0.25, -0.02, sunEl) * (1 - day);
  fogLow = mix(mix(nightLow, duskLow, dusk), fogLow, day);
  fogHigh = mix(mix(nightHigh, duskHigh, dusk), fogHigh, day);
  // a nudge warm or cool
  const tint: V3 = warm > 0 ? [1 + 0.12 * warm, 1, 1 - 0.1 * warm] : [1 + 0.06 * warm, 1, 1 - 0.12 * warm];
  fogLow = [fogLow[0] * tint[0], fogLow[1] * tint[1], fogLow[2] * tint[2]];
  fogHigh = [fogHigh[0] * tint[0], fogHigh[1] * tint[1], fogHigh[2] * tint[2]];
  // the wood is lit as the fog is (the fog is that light, scattered)
  const lum = (fogLow[0] + fogLow[1] + fogLow[2]) / 3 / 0.4;
  const illum = scale(mix([0.9, 0.95, 1.05], [1.05, 1, 0.92], low * day), lum);
  // the key light: the sun while it is up, else the moon
  const useSun = sunEl > -0.06;
  const el = useSun ? Math.max(sunEl, 0.04) : Math.max(moonEl, 0.05);
  const az = useSun ? sunAz : moonAz;
  const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const glow: V3 = useSun ? scale(mix([1, 0.98, 0.9], [1, 0.82, 0.55], low), 0.1 + 0.06 * day) : scale([0.75, 0.85, 1], 0.05 * moonLight * (moonEl > 0 ? 1 : 0));
  const exposure = Math.min(2.6, Math.pow(0.46 / Math.max(0.02, (fogLow[0] + fogLow[1] + fogLow[2]) / 3), 0.6));
  return { fogLow, fogHigh, illum, dir, glow, at: [az, el], day, exposure };
}
