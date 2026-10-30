/**
 * The time of day and the air (no drawing here: render.ts lights by it, main.ts re-bakes the land's shadows when its
 * light moves).
 *
 * - **the sun's path**: up at six, down at eighteen, highest at noon (57°), going round from the east of the slope to the
 *   west; at eight in the morning exactly where the grove was always lit from (world.ts `SUN`), so the house is unchanged;
 * - **the moon**: full, opposite the sun, so it's up all night and highest at midnight; its light cool and dim;
 * - **the light and the sky**: the sun white at noon, warm in the morning, orange and low at the horizon; the sky's blue
 *   going rose at dusk and indigo at night; the eye adjusting (`expo`), so a night is dim, not black;
 * - **the air**: the haze far off and the mist in the valley below, the colour of the hour (warm paper by day, peach at
 *   dusk, blue-grey at night), thicker or thinner by `mist`;
 * - **the page**: by night the sheet takes a wash, darker toward the top, and the moon is left as bare paper.
 */
import { SUN } from './world';

export type V3 = [number, number, number];
export interface Sky {
  /** where the light comes from (the sun by day, the moon by night), and its colour */
  lightDir: V3; lightC: V3;
  sunDir: V3; moonDir: V3;
  /** the sky's light (ambient) */
  skyC: V3;
  /** 0 by day … 1 at night; 0 … 1 round sunrise and sunset */
  night: number; dusk: number;
  /** the far haze and the valley's mist, their colour and how thick (1 = as the house has it) */
  haze: V3; veil: V3; mist: number;
  /** the wash laid on the sheet; the sheet itself (its torn edge); the far ranges' tone; a shaft of light's colour */
  paper: V3; sheet: V3; ridge: V3; shaft: V3;
  /** the eye's adjustment to how much light there is */
  expo: number;
}

const PAPER: V3 = [0.937, 0.902, 0.824];
const E = Math.asin(SUN[1]) / 0.5, AZ0 = Math.atan2(SUN[0], SUN[2]);
/** the sun's direction at an hour (0–24) */
export function sunAt(hour: number): V3 {
  const el = E * Math.sin((Math.PI * (hour - 6)) / 12), az = AZ0 + ((hour - 8) * Math.PI) / 12;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lum = (c: V3) => c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;
/** a colour by the sun's height (its direction's y), between the heights given */
function byHeight(y: number, table: [number, V3][]): V3 {
  if (y <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) if (y <= table[i][0]) return mix(table[i - 1][1], table[i][1], (y - table[i - 1][0]) / (table[i][0] - table[i - 1][0]));
  return table[table.length - 1][1];
}
const H8 = SUN[1];
const SUNC: [number, V3][] = [[-0.02, [0, 0, 0]], [0, [0.9, 0.35, 0.12]], [0.12, [2.2, 1.25, 0.6]], [H8, [3, 2.45, 1.6]], [0.84, [3.2, 2.95, 2.4]]];
const SKYC: [number, V3][] = [[-0.35, [0.035, 0.045, 0.08]], [-0.1, [0.12, 0.11, 0.17]], [0, [0.38, 0.3, 0.32]], [0.12, [0.45, 0.42, 0.45]], [H8, [0.5, 0.55, 0.6]], [0.84, [0.52, 0.6, 0.7]]];
const DAYLUM = lum([3, 2.45, 1.6]) + 1.5 * lum([0.5, 0.55, 0.6]);

export function skyAt(hour: number, mist = 0.5): Sky {
  const sunDir = sunAt(hour), moonDir = sunAt(hour + 12), y = sunDir[1];
  const night = ss(0, -0.3, y), dusk = (1 - ss(0, 0.25, Math.abs(y))) * (1 - night);
  const sunUp = y > -0.02;
  const moonC = mix([0, 0, 0], [0.3, 0.38, 0.55], ss(0, 0.25, moonDir[1]) * night);
  const lightC = sunUp ? byHeight(y, SUNC) : moonC, skyC = byHeight(y, SKYC);
  const expo = Math.min(6, Math.max(1, (DAYLUM / Math.max(0.05, lum(lightC) + 1.5 * lum(skyC))) ** 0.7));
  const day = (a: V3, d: V3, n: V3) => mix(mix(a, d, dusk), n, night);
  return {
    lightDir: sunUp ? sunDir : moonDir, lightC, sunDir, moonDir, skyC, night, dusk,
    haze: day([0.93, 0.9, 0.8], [0.96, 0.78, 0.62], [0.22, 0.25, 0.33]),
    veil: day([0.78, 0.82, 0.86], [0.85, 0.75, 0.72], [0.18, 0.22, 0.3]),
    mist: mist / 0.5,
    paper: mix(mix(PAPER, [0.95, 0.84, 0.74], dusk * 0.5), [0.33, 0.35, 0.41], night * 0.9), sheet: PAPER,
    ridge: day([1, 1, 1], [1.05, 0.88, 0.85], [0.42, 0.46, 0.58]),
    shaft: sunUp ? mix([1, 0.95, 0.8], [1, 0.72, 0.45], dusk) : [0.62, 0.72, 0.92],
    expo,
  };
}
