/**
 * Moods (`mood=gold|mist|autumn|moon`, a flag for now): the same painting in another light, after Astra's art-direction
 * studies. A mood is the colours only (no new strokes): each material's four bands from lit to deep shade, the sky's
 * horizon, top and pale strokes, the clouds lit and shaded, and how strongly the far off is hazed toward the horizon.
 * The rider's orange, its jacket and the fence keep their own, so they stand out in any light.
 */
import { M, PALETTE } from './mesh';
import { SKY } from './paint';
import { REGION } from './regions';
import { FX, SUN as SUN0 } from './render';

type Mood = { pal: Partial<Record<number, string[]>>; sky: Omit<typeof SKY, 'fog' | 'air'> & { fog: number[][] }; fx: Partial<Record<keyof typeof FX, string[]>> };
const MOODS: Record<string, Mood> = {
  // (apricot snow against plum cliffs; the road kept cream so the light doesn't compete with the rider)
  gold: {
    pal: {
      [M.SNOW]: ['#ffe0bc', '#e8b8a0', '#9a82a6', '#5e4a78'], [M.TRACK]: ['#f6e6d2', '#e2c6a8', '#b0898a', '#7a5a72'], [M.ROCK]: ['#c98a74', '#6a4a6a', '#4a3552', '#33243e'],
      [M.WHITE]: ['#fff6ea', '#ffe6cc', '#f2c7a4', '#b98a8f'], [M.SHADOW]: ['#a07a90', '#a07a90', '#a07a90', '#a07a90'], [M.RUT]: ['#e2c6a8', '#c8a088', '#9a7a80', '#6e5468'],
      [M.MTN]: ['#b48fbf', '#9c7cb0', '#6e5b98', '#55488a'], [M.MTNSNOW]: ['#ffd2a6', '#f0b797', '#8f7cb0', '#62568f'], [M.FAR]: ['#c9a3c8', '#b08cb8', '#7d6aa3', '#5f5390'],
      [M.FARSNOW]: ['#ffdcb6', '#f2c0a2', '#9b86b8', '#6d5f9c'], [M.RIDGE]: ['#a888b4', '#8e74a6', '#5e4c85', '#463a70'], [M.FOREST]: ['#4a3550', '#3d2c46', '#30223a', '#25192e'],
      [M.VALLEY]: ['#9a84b8', '#9a84b8', '#8a76aa', '#8a76aa'], [M.FIELD]: ['#e8b98c', '#c9a0b8', '#9b84b8', '#6f5f9c'], [M.UMBER]: ['#7a5a62', '#5e4450', '#4a3442', '#382634'], [M.BLACK]: ['#3a2a3c', '#2e2032', '#251a2a', '#1c1420'], [M.GRASS]: ['#ffc070', '#d49a5c', '#8a6a5c', '#5a4252'],
    },
    sky: { lo: [1, 0.78, 0.58], hi: [0.4, 0.34, 0.6], pale: [1, 0.88, 0.76], cloudLit: [1, 0.9, 0.8], cloudShade: [0.74, 0.6, 0.74], haze: 1.3, hazeBase: 0.08, fog: [[1, 0.84, 0.72], [0.84, 0.66, 0.74], [0.64, 0.52, 0.72], [0.52, 0.44, 0.68]], sun: [-0.855, 0.302, 0.422], lit: -0.2, flat: 0.25, thin: 0, belt: [0.9, 0.76, 0.76], woods: [0.3, 0.45, 0.5], woodsD: [10, 100] },
    fx: { air: ['#fff2e2', '#ffe6cc', '#f2c7a4', '#d8a890'], grit: ['#3a2638', '#4f3548', '#6a4a5c'], wall: ['#3a2638', '#4f3548', '#6a4a5c'], crash: ['#e85a0d', '#3a2638', '#ffe6cc', '#f2c7a4'], land: ['#f2c7a4', '#e2c6a8', '#ffe6cc', '#6a4a5c', '#4f3548'] },
  },
  // (cold cloud: teal greys, low contrast in the distance, the far off mostly lost in haze; the rider's orange alone warm)
  mist: {
    pal: {
      [M.SNOW]: ['#eef2f0', '#d3dcda', '#9fb0ae', '#6e8483'], [M.TRACK]: ['#e6ebe8', '#ccd5d2', '#a0afad', '#76888a'], [M.ROCK]: ['#5f7a7a', '#4a6464', '#3a5252', '#2c4242'],
      [M.WHITE]: ['#f2f5f4', '#e2e8e6', '#cad3d1', '#9fb0ae'], [M.SHADOW]: ['#9fb0ae', '#9fb0ae', '#9fb0ae', '#9fb0ae'], [M.RUT]: ['#ccd5d2', '#a0afad', '#88999a', '#6e8283'],
      [M.MTN]: ['#93aaab', '#84a0a1', '#6b8a8c', '#5e7f81'], [M.MTNSNOW]: ['#e6eded', '#d3dfdf', '#9fb5b6', '#86a0a2'], [M.FAR]: ['#a9bcbd', '#9cb0b2', '#869ea1', '#7a9396'],
      [M.FARSNOW]: ['#dfe7e6', '#cfdbda', '#a8bcbd', '#93aaab'], [M.RIDGE]: ['#7f9a9b', '#6e8b8d', '#557476', '#466668'], [M.FOREST]: ['#3e5a5b', '#34504f', '#2a4444', '#203838'],
      [M.VALLEY]: ['#9fb4b4', '#9fb4b4', '#93a9a9', '#93a9a9'], [M.FIELD]: ['#c3cfc9', '#a9bab7', '#8ea3a3', '#728a8b'], [M.UMBER]: ['#5a6e6a', '#485a57', '#384a48', '#2a3a39'], [M.BLACK]: ['#3c5454', '#324848', '#2a3e3e', '#223434'], [M.GRASS]: ['#a8b29a', '#8e9a84', '#6e7c6c', '#566458'],
    },
    sky: { lo: [0.8, 0.85, 0.84], hi: [0.52, 0.6, 0.62], pale: [0.92, 0.94, 0.93], cloudLit: [0.94, 0.96, 0.95], cloudShade: [0.68, 0.75, 0.75], haze: 2.6, hazeBase: 0.42, fog: [[0.84, 0.88, 0.87], [0.76, 0.82, 0.82], [0.7, 0.77, 0.77], [0.66, 0.74, 0.74]], sun: [], lit: -0.05, flat: 0.85, thin: 0.55, belt: [0.82, 0.86, 0.85], woods: [0.2, 0.15, 0.85], woodsD: [6, 70] },
    fx: { air: ['#e6ecea', '#d8e0de', '#c8d2d0', '#aebcba'], grit: ['#2c4242', '#3a5252', '#4a6464'], wall: ['#2c4242', '#3a5252', '#4a6464'], crash: ['#e85a0d', '#2c4242', '#e6ecea', '#c8d2d0'], land: ['#d3dcda', '#ccd5d2', '#e6ecea', '#4a6464', '#3a5252'] },
  },
  // (lower slopes in autumn: limestone and scree, ochre grass, green-grey ranges with snow only high up)
  autumn: {
    pal: {
      [M.SNOW]: ['#ece4d6', '#d5c8b4', '#a8977f', '#7a6a58'], [M.TRACK]: ['#e8dccb', '#cdbca4', '#a6937c', '#7a6a58'], [M.ROCK]: ['#8a7a6a', '#6a5a4c', '#4f4238', '#3a302a'],
      [M.WHITE]: ['#f6efe3', '#ece4d6', '#d5c8b4', '#a8977f'], [M.SHADOW]: ['#a69a8c', '#a69a8c', '#a69a8c', '#a69a8c'], [M.RUT]: ['#cdbca4', '#a6937c', '#8a7a68', '#6a5c4e'],
      [M.MTN]: ['#8ea08a', '#7d927a', '#647a66', '#52685a'], [M.MTNSNOW]: ['#f2f2ee', '#e2e2dc', '#a7b2a6', '#8a978b'], [M.FAR]: ['#a3b4aa', '#93a69c', '#7c938a', '#6c847c'],
      [M.FARSNOW]: ['#f4f4f0', '#e4e6e0', '#b0bcb2', '#93a29a'], [M.RIDGE]: ['#b8a462', '#9a8a54', '#6f6a48', '#5a573e'], [M.FOREST]: ['#4b5238', '#3f462f', '#333a27', '#282e1f'],
      [M.VALLEY]: ['#a8a070', '#a8a070', '#968e62', '#968e62'], [M.FIELD]: ['#d8b45a', '#b8a46a', '#8f8a64', '#6a6a52'], [M.UMBER]: ['#7a5a42', '#5e4432', '#4a3426', '#38261c'], [M.BLACK]: ['#3a3628', '#2e2b20', '#26231a', '#1e1c15'],
    },
    sky: { lo: [0.76, 0.85, 0.87], hi: [0.4, 0.58, 0.66], pale: [0.9, 0.93, 0.92], cloudLit: [0.98, 0.98, 0.96], cloudShade: [0.78, 0.82, 0.82], haze: 1.2, hazeBase: 0.05, fog: [[0.8, 0.86, 0.84], [0.64, 0.74, 0.72], [0.52, 0.64, 0.62], [0.46, 0.58, 0.58]], sun: [], lit: 0, flat: 0.2, thin: 0, belt: [0.84, 0.85, 0.82], woods: [0.45, 0.35, 0.45], woodsD: [12, 110] },
    fx: { air: ['#f6efe3', '#ece4d6', '#d5c8b4', '#bfae96'], grit: ['#3a302a', '#4f4238', '#6a5a4c'], wall: ['#3a302a', '#4f4238', '#6a5a4c'], crash: ['#e85a0d', '#3a302a', '#ece4d6', '#d5c8b4'], land: ['#d5c8b4', '#cdbca4', '#ece4d6', '#6a5a4c', '#4f4238'] },
  },
  // (moonlight: a silver road against indigo; the rider's orange and cream kept, so they still read)
  moon: {
    pal: {
      [M.SNOW]: ['#b8c0e6', '#8a92c4', '#5e669c', '#3f4677'], [M.TRACK]: ['#9ea6cc', '#7e86b6', '#5e669c', '#40477c'], [M.ROCK]: ['#3a3f66', '#2c3156', '#22264a', '#191c3a'],
      [M.WHITE]: ['#c6cdee', '#8f98c6', '#6a72a6', '#4a5288'], [M.SHADOW]: ['#5a6298', '#5a6298', '#5a6298', '#5a6298'], [M.RUT]: ['#9ea6cc', '#7a82b4', '#5a6298', '#3f4677'],
      [M.MTN]: ['#424a86', '#3a4178', '#30366a', '#282d5c'], [M.MTNSNOW]: ['#cfd6f2', '#aeb7e0', '#646eaa', '#424a86'], [M.FAR]: ['#4a5290', '#414884', '#363c74', '#2e3366'],
      [M.FARSNOW]: ['#d6dcf4', '#b8c0e6', '#6e78b4', '#4a5290'], [M.RIDGE]: ['#363d74', '#2f3566', '#262b58', '#1f234a'], [M.FOREST]: ['#1c1f3e', '#171a35', '#13152c', '#0f1124'],
      [M.VALLEY]: ['#3e4678', '#3e4678', '#363e6e', '#363e6e'], [M.FIELD]: ['#5a6298', '#4c5488', '#3e4678', '#323a68'], [M.UMBER]: ['#34385e', '#2a2e50', '#222644', '#1a1d36'], [M.BLACK]: ['#14172e', '#111326', '#0e1020', '#0b0c1a'], [M.GRASS]: ['#5a6890', '#46527a', '#343e64', '#262e50'],
    },
    sky: { lo: [0.24, 0.27, 0.48], hi: [0.05, 0.06, 0.18], pale: [0.42, 0.45, 0.64], cloudLit: [0.44, 0.47, 0.68], cloudShade: [0.22, 0.24, 0.42], haze: 1, hazeBase: 0.1, fog: [[0.36, 0.39, 0.6], [0.24, 0.27, 0.48], [0.16, 0.18, 0.38], [0.12, 0.14, 0.32]], sun: [0.352, 0.755, 0.553], lit: -0.32, flat: 0.35, thin: 0.2, belt: [0.36, 0.4, 0.62], woods: [0.7, 0.12, 0.4], woodsD: [14, 120] },
    fx: { air: ['#a6aed6', '#9ea6cc', '#8a92c4', '#6a72a6'], grit: ['#191c3a', '#22264a', '#2c3156'], wall: ['#191c3a', '#22264a', '#2c3156'], crash: ['#e85a0d', '#191c3a', '#a6aed6', '#8a92c4'], land: ['#9ea6cc', '#8a92c4', '#a6aed6', '#2c3156', '#22264a'] },
  },
};
export const MOOD_NAMES = Object.keys(MOODS);
// (the day as it stands, before any mood: the cycle starts and ends on it)
const hexes = (a: string[]) => a.slice();
const DAY = { pal: PALETTE.map(hexes), sky: JSON.parse(JSON.stringify(SKY)) as typeof SKY, fx: Object.fromEntries(Object.entries(FX).map(([k, v]) => [k, v.slice()])) as Record<keyof typeof FX, string[]> };
/** a mood's whole state (the day's, with the mood's own over it) */
function full(name: string) {
  const e = fullOwn(name);
  // (with the course's regions, the valley's floor is land below the snowline (its grass, by whatever light), not the
  // alpine fields' lavenders and blues)
  if (REGION.on) { const pal = e.pal.map(hexes); const g = pal[M.GRASS]; pal[M.FIELD] = [g[0], g[1], g[1], g[2]]; pal[M.VALLEY] = [g[2], g[2], g[3], g[3]]; return { ...e, pal }; }
  return e;
}
function fullOwn(name: string) {
  if (name === 'day' || !MOODS[name]) return DAY;
  const m = MOODS[name], pal = DAY.pal.map(hexes);
  for (const [k, v] of Object.entries(m.pal)) pal[Number(k)] = v!;
  const fx = { ...DAY.fx } as Record<keyof typeof FX, string[]>;
  for (const [k, v] of Object.entries(m.fx)) fx[k as keyof typeof FX] = v!;
  return { pal, sky: { ...DAY.sky, ...m.sky }, fx };
}
/** put a mood on the palette and the sky, before the renderer's made */
export function applyMood(name: string | null) {
  if (!name || name === 'cycle' || !MOODS[name]) return name === 'cycle';
  set(full(name));
  return true;
}
const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const hex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mixHex = (a: string, b: string, t: number) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); };
const mixArr = (a: number[], b: number[], t: number) => a.map((v, i) => v + ((b[i] ?? v) - v) * t);
function set(e: ReturnType<typeof full>) {
  e.pal.forEach((v, i) => (PALETTE[i] = v));
  // (the composed backdrop's flat masses (backdrop.ts) take the light's own colours for the ranges, the valley and the
  // river, so their bodies and their strokes agree whatever the mood)
  const flat = (k: number, c: string) => (PALETTE[k] = [c, c, c, c]);
  // (the far band taken most of the way toward the sky's horizon, as distance does: it recedes, not a strip of colour)
  const toward = (h: string, c: number[], k: number) => '#' + [1, 3, 5].map((i, j) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - k) + c[j] * 255 * k).toString(16).padStart(2, '0')).join('');
  flat(M.MASS_FAR, toward(PALETTE[M.FAR][0], e.sky.lo, 0.6)); flat(M.MASS_BODY, PALETTE[M.MTN][1]); flat(M.MASS_SHADE, PALETTE[M.MTN][2]);
  flat(M.MASS_SNOW, PALETTE[M.MTNSNOW][0]); flat(M.MASS_SNOWSH, PALETTE[M.MTNSNOW][2]); flat(M.MASS_RIDGE, PALETTE[M.RIDGE][2]);
  flat(M.MASS_RIDGESH, PALETTE[M.RIDGE][3]); flat(M.MASS_FLOOR, PALETTE[M.VALLEY][0]); flat(M.MASS_RIVER, PALETTE[M.WHITE][2]);
  const two = (k: number, lit: string, sh: string) => (PALETTE[k] = [lit, lit, sh, sh]);
  // (the forest's pines: the light's grass sunk toward black where lit, the forest's navy in the dark, black in shade)
  { const g = PALETTE[M.GRASS], k = PALETTE[M.BLACK]; const f = PALETTE[M.FOREST][0]; PALETTE[M.PINE] = [mixHex(g[1], k[0], 0.3), mixHex(g[2], k[0], 0.5), mixHex(k[0], f, 0.45), mixHex(k[1], f, 0.25)]; }
  two(M.PATCH_NEAR, PALETTE[M.GRASS][1], PALETTE[M.GRASS][3]); two(M.PATCH_FAR, PALETTE[M.RIDGE][1], PALETTE[M.RIDGE][3]); flat(M.PATCH_FLOOR, PALETTE[M.GRASS][2]);
  Object.assign(SKY, e.sky, { fog: e.sky.fog.map((f) => f.slice()), sun: e.sky.sun.slice(), belt: e.sky.belt.slice(), woods: e.sky.woods.slice(), woodsD: e.sky.woodsD.slice() });
  // (the forest's air: the air the far off recedes into, the belt's and the distance's, never a colour of its own)
  SKY.air = mixArr(SKY.belt, SKY.fog[2], 0.4);
  // (the light shafts in the woods: the air, lit toward the clouds' lit colour)
  { const lit = hex(mixArr(SKY.air, SKY.cloudLit, 0.7).map((v) => v * 255)); PALETTE[M.SHAFT] = [lit, mixHex(lit, hex(SKY.air.map((v) => v * 255)), 0.2), mixHex(lit, hex(SKY.air.map((v) => v * 255)), 0.4), mixHex(lit, hex(SKY.air.map((v) => v * 255)), 0.6)]; }
  if (WOODS_LOOK) Object.assign(SKY, WOODS_LOOK);
  for (const k of Object.keys(FX) as (keyof typeof FX)[]) { const a = FX[k]; a.length = 0; a.push(...e.fx[k]); }
}
/** the cycle (`mood=cycle`): the day, then each mood in turn and back, each held a while and blended into the next, by
 * game time t (s); `hold` and `blend` seconds */
/** `woods=dark|airy`: the woods' light held one way whatever the mood, to compare (the mood's own, unset) */
let WOODS_LOOK: { woods: number[]; woodsD: number[] } | null = null;
export function woodsLook(k: string | null) {
  WOODS_LOOK = k === 'dark' ? { woods: [0.75, 0.15, 0.35], woodsD: [16, 140] } : k === 'airy' ? { woods: [0.2, 0.4, 0.85], woodsD: [8, 90] } : null;
}
export const CYCLE = ['day', 'gold', 'mist', 'autumn', 'moon'];
/** a blend of two moods (a into b by s, 0 to 1), set */
function blendSet(an: string, bn: string, s: number) {
  const a = full(an), b = full(bn);
  const sunA = a.sky.sun.length ? a.sky.sun : SUN0, sunB = b.sky.sun.length ? b.sky.sun : SUN0, sun = mixArr(sunA, sunB, s), sl = Math.hypot(sun[0], sun[1], sun[2]) || 1;
  set({
    pal: a.pal.map((band, i) => band.map((h, j) => mixHex(h, b.pal[i][j] ?? h, s))),
    sky: { lo: mixArr(a.sky.lo, b.sky.lo, s), hi: mixArr(a.sky.hi, b.sky.hi, s), pale: mixArr(a.sky.pale, b.sky.pale, s), cloudLit: mixArr(a.sky.cloudLit, b.sky.cloudLit, s), cloudShade: mixArr(a.sky.cloudShade, b.sky.cloudShade, s),
      haze: a.sky.haze + (b.sky.haze - a.sky.haze) * s, hazeBase: a.sky.hazeBase + (b.sky.hazeBase - a.sky.hazeBase) * s, fog: a.sky.fog.map((f, i) => mixArr(f, b.sky.fog[i], s)),
      sun: sun.map((v) => v / sl), lit: a.sky.lit + (b.sky.lit - a.sky.lit) * s, flat: a.sky.flat + (b.sky.flat - a.sky.flat) * s, thin: a.sky.thin + (b.sky.thin - a.sky.thin) * s, belt: mixArr(a.sky.belt, b.sky.belt, s),
      woods: mixArr(a.sky.woods, b.sky.woods, s), woodsD: mixArr(a.sky.woodsD, b.sky.woodsD, s), air: a.sky.air /* (set derives it) */ },
    fx: Object.fromEntries((Object.keys(FX) as (keyof typeof FX)[]).map((k) => [k, a.fx[k].map((h, j) => mixHex(h, b.fx[k][j % b.fx[k].length], s))])) as Record<keyof typeof FX, string[]>,
  });
}
export function cycleAt(t: number, hold = 8, blend = 5) {
  const per = hold + blend, n = CYCLE.length, k = Math.floor(t / per) % n, u = t - Math.floor(t / per) * per;
  const f = u < hold ? 0 : (u - hold) / blend, s = f * f * (3 - 2 * f);
  blendSet(CYCLE[k], CYCLE[(k + 1) % n], s);
  return f > 0 ? `${CYCLE[k]} → ${CYCLE[(k + 1) % n]}` : CYCLE[k];
}
/** the light down the course (`mood=course`): between its keys (station, mood) by where you are */
export function lightAlong(s: number, keys: [number, string][]) {
  let k = 0; while (k < keys.length - 1 && keys[k + 1][0] <= s) k++;
  if (k >= keys.length - 1) { blendSet(keys[k][1], keys[k][1], 0); return keys[k][1]; }
  const [s0, a] = keys[k], [s1, b] = keys[k + 1], f = Math.max(0, Math.min(1, (s - s0) / Math.max(1, s1 - s0))), e = f * f * (3 - 2 * f);
  blendSet(a, b, e);
  return a === b ? a : f < 0.5 ? a : b;
}
