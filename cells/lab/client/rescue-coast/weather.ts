/**
 * The weather, as the boards have it (Calm, Windy, Foggy, Choppy, Night; the title card's sunset): one set of numbers
 * each, read by the sea (how high, how steep, how much foam), the light (the sun's way and colour, the sky's fill),
 * the sky (its colours, how much cloud and how dark), the air (fog: how near it starts, how thick), what falls (rain),
 * and what's lit (lamps, the lighthouses' beams, your searchlight).
 *
 * Colours are sRGB; the shaders take them to linear.
 */
export type WeatherName = 'sunny' | 'calm' | 'windy' | 'stormy' | 'foggy' | 'night' | 'sunset';
export interface Weather {
  name: WeatherName; label: string; icon: string;
  /** the sea: wave height, how steep and sharp, how much foam; the wind (spray, clouds, flags) */
  height: number; chop: number; foam: number; wind: number;
  /** toward the sun (or moon); its colour × strength; the sky's fill (from above, from below) */
  sun: [number, number, number]; sunColour: [number, number, number]; sunStrength: number;
  fillSky: [number, number, number]; fillGround: [number, number, number];
  /** the sky: overhead, at the horizon; clouds: how much of it (0..1), how dark beneath (0..1) */
  skyTop: [number, number, number]; skyHorizon: [number, number, number]; cloud: number; cloudDark: number;
  /** the air: its colour, how near it begins (m), how far until it's thick (m), how thick at most (0..1) */
  haze: [number, number, number]; fogStart: number; fogScale: number; fogMax: number;
  /** the water's own colour: deep, and lit through */
  deep: [number, number, number]; body: [number, number, number];
  /** exposure, saturation; rain (0..1); lightning; how dark it is (lamps, beams, windows, searchlight: 0..1); stars */
  exposure: number; saturation: number; rain: number; lightning: boolean; dark: number; stars: boolean;
  gulls: boolean;
}

import { hash } from '../kit/rng';

const norm = (v: [number, number, number]): [number, number, number] => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
const base: Weather = {
  name: 'sunny', label: 'sunny', icon: '☀️',
  height: 1.25, chop: 1.15, foam: 1, wind: 1,
  sun: norm([-0.5, 0.72, -0.35]), sunColour: [1, 0.9, 0.76], sunStrength: 2.7,
  fillSky: [0.55, 0.7, 0.95], fillGround: [0.5, 0.46, 0.4],
  skyTop: [0.13, 0.39, 0.86], skyHorizon: [0.6, 0.79, 0.96], cloud: 0.34, cloudDark: 0.2,
  haze: [0.68, 0.82, 0.95], fogStart: 220, fogScale: 1000, fogMax: 0.6,
  deep: [0.015, 0.1, 0.27], body: [0.05, 0.36, 0.6],
  exposure: 1.05, saturation: 0.96, rain: 0, lightning: false, dark: 0, stars: false, gulls: true,
};
export const WEATHERS: Record<WeatherName, Weather> = {
  sunny: base,
  calm: { ...base, name: 'calm', label: 'calm', icon: '🌤️', height: 0.55, chop: 0.75, foam: 0.45, wind: 0.4, cloud: 0.24 },
  windy: {
    ...base, name: 'windy', label: 'windy', icon: '💨', height: 1.75, chop: 1.38, foam: 1.7, wind: 2.2,
    cloud: 0.62, cloudDark: 0.35, skyTop: [0.24, 0.5, 0.86], haze: [0.78, 0.86, 0.94],
  },
  stormy: {
    ...base, name: 'stormy', label: 'stormy', icon: '⛈️', height: 2.4, chop: 1.45, foam: 2.3, wind: 3,
    sun: norm([-0.3, 0.8, 0.2]), sunColour: [0.75, 0.8, 0.88], sunStrength: 0.7,
    fillSky: [0.42, 0.48, 0.56], fillGround: [0.24, 0.25, 0.27],
    skyTop: [0.2, 0.24, 0.3], skyHorizon: [0.42, 0.46, 0.52], cloud: 1, cloudDark: 0.85,
    haze: [0.4, 0.45, 0.5], fogStart: 50, fogScale: 380, fogMax: 0.85,
    deep: [0.05, 0.15, 0.24], body: [0.1, 0.32, 0.4],
    exposure: 1.15, saturation: 0.9, rain: 1, lightning: true, dark: 0.55, gulls: false,
  },
  foggy: {
    ...base, name: 'foggy', label: 'foggy', icon: '🌫️', height: 0.9, chop: 0.95, foam: 0.8, wind: 0.6,
    sun: norm([-0.4, 0.55, 0.3]), sunColour: [0.95, 0.94, 0.9], sunStrength: 0.9,
    fillSky: [0.72, 0.76, 0.8], fillGround: [0.45, 0.46, 0.47],
    skyTop: [0.68, 0.72, 0.76], skyHorizon: [0.8, 0.82, 0.84], cloud: 1, cloudDark: 0.1,
    haze: [0.78, 0.8, 0.82], fogStart: 15, fogScale: 140, fogMax: 0.97,
    deep: [0.06, 0.16, 0.24], body: [0.12, 0.3, 0.4],
    exposure: 1.05, saturation: 0.8, dark: 0.45, gulls: false,
  },
  night: {
    ...base, name: 'night', label: 'night', icon: '🌙', height: 1.1, chop: 1.05, foam: 0.8, wind: 0.8,
    sun: norm([0.4, 0.45, 0.6]), sunColour: [0.55, 0.65, 0.95], sunStrength: 0.42,
    fillSky: [0.1, 0.15, 0.3], fillGround: [0.05, 0.05, 0.08],
    skyTop: [0.02, 0.04, 0.12], skyHorizon: [0.08, 0.14, 0.28], cloud: 0.3, cloudDark: 0.9,
    haze: [0.06, 0.1, 0.2], fogStart: 80, fogScale: 600, fogMax: 0.8,
    deep: [0.01, 0.04, 0.12], body: [0.02, 0.1, 0.24],
    exposure: 1.6, saturation: 1.05, dark: 1, stars: true, gulls: false,
  },
  sunset: {
    ...base, name: 'sunset', label: 'sunset', icon: '🌅', height: 1.1, chop: 1.05,
    sun: norm([-0.15, 0.17, 0.98]), sunColour: [1, 0.66, 0.36], sunStrength: 2.4,
    fillSky: [0.55, 0.55, 0.8], fillGround: [0.45, 0.3, 0.25],
    skyTop: [0.22, 0.32, 0.62], skyHorizon: [1, 0.72, 0.45], cloud: 0.55, cloudDark: 0.4,
    haze: [0.95, 0.74, 0.55], fogStart: 120, fogScale: 800, fogMax: 0.75,
    deep: [0.04, 0.12, 0.32], body: [0.12, 0.3, 0.55],
    exposure: 1.05, saturation: 1.18, dark: 0.15,
  },
};
export const WEATHER_ORDER: WeatherName[] = ['sunny', 'calm', 'windy', 'stormy', 'foggy', 'night', 'sunset'];

/** between two weathers, `f` of the way (0..1): the numbers and colours in between, the rest (names, rain's lightning,
 * stars, gulls) from whichever it's nearer */
export function blend(a: Weather, b: Weather, f: number): Weather {
  if (f <= 0) return a;
  if (f >= 1) return b;
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(a) as (keyof Weather)[]) {
    const x = a[k], y = b[k];
    o[k] = typeof x === 'number' ? x + ((y as number) - x) * f : Array.isArray(x) ? x.map((v, i) => v + ((y as number[])[i] - v) * f) : f < 0.5 ? x : y;
  }
  const w = o as unknown as Weather;
  w.sun = norm(w.sun);
  return w;
}

/**
 * The Service's weather: it changes as the day goes on. A voyage is a list of legs: from `at` seconds out, over the
 * next `TURN` seconds, it becomes `w`. Which story, from the seed; where it starts, the weather chosen on the title:
 * fair weather may bring a squall through, or a fog bank, or freshen to a gale, or go on into the evening and the
 * night; a storm clears; fog lifts (or the night comes down on it); the night ends in a dawn.
 */
export interface Leg { at: number; w: WeatherName }
export const TURN = 30;
const STORIES: Record<WeatherName, [number, WeatherName][][]> = {
  sunny: [[[60, 'windy'], [110, 'stormy'], [160, 'windy'], [210, 'sunny']], [[70, 'foggy'], [170, 'sunny']], [[100, 'sunset'], [200, 'night']], [[80, 'windy'], [170, 'stormy']], [[120, 'calm']]],
  calm: [[[70, 'windy'], [120, 'stormy'], [180, 'sunny']], [[80, 'foggy'], [180, 'calm']], [[100, 'sunset'], [200, 'night']], [[90, 'sunny'], [180, 'windy']]],
  windy: [[[80, 'stormy'], [140, 'windy'], [200, 'sunny']], [[100, 'sunny'], [190, 'calm']], [[110, 'stormy']]],
  stormy: [[[80, 'windy'], [160, 'sunny']], [[100, 'foggy'], [190, 'calm']], [[130, 'windy']]],
  foggy: [[[100, 'sunny'], [190, 'windy']], [[130, 'calm']], [[160, 'night']]],
  night: [[[120, 'sunset'], [210, 'sunny']], [[160, 'sunset']], [[100, 'sunset'], [190, 'calm']]],
  sunset: [[[100, 'night']], [[90, 'stormy'], [180, 'night']], [[140, 'night']]],
};
export function voyage(seed: number, start: WeatherName): Leg[] {
  const all = STORIES[start] ?? STORIES.sunny, story = all[hash(seed, 31) % all.length];
  return [{ at: 0, w: start }, ...story.map(([at, w]) => ({ at, w }))];
}
/** the weather at `t` seconds out on a voyage */
export function weatherAt(legs: Leg[], t: number): Weather {
  let w = WEATHERS[legs[0].w];
  for (let i = 1; i < legs.length && t > legs[i].at; i++) w = blend(w, WEATHERS[legs[i].w], (t - legs[i].at) / TURN);
  return w;
}
/** just the sea's height and steepness at `t` (the race reads it every step) */
export function seaOf(legs: Leg[], t: number): [number, number] {
  let h = WEATHERS[legs[0].w].height, c = WEATHERS[legs[0].w].chop;
  for (let i = 1; i < legs.length && t > legs[i].at; i++) {
    const f = Math.min(1, (t - legs[i].at) / TURN), n = WEATHERS[legs[i].w];
    h += (n.height - h) * f; c += (n.chop - c) * f;
  }
  return [h, c];
}
