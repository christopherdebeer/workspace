/**
 * Moods (`mood=gold|mist|autumn|moon`, a flag for now): the same painting in another light, after Astra's art-direction
 * studies. A mood is the colours only (no new strokes): each material's four bands from lit to deep shade, the sky's
 * horizon, top and pale strokes, the clouds lit and shaded, and how strongly the far off is hazed toward the horizon.
 * The rider's orange, its jacket and the fence keep their own, so they stand out in any light.
 */
import { M, PALETTE } from './mesh';
import { SKY } from './paint';
import { FX } from './render';

type Mood = { pal: Partial<Record<number, string[]>>; sky: Omit<typeof SKY, 'fog'> & { fog: number[][] }; fx: Partial<Record<keyof typeof FX, string[]>> };
const MOODS: Record<string, Mood> = {
  // (apricot snow against plum cliffs; the road kept cream so the light doesn't compete with the rider)
  gold: {
    pal: {
      [M.SNOW]: ['#ffe6cc', '#f2c7a4', '#b98a8f', '#6e4a6b'], [M.TRACK]: ['#f6e6d2', '#e2c6a8', '#b0898a', '#7a5a72'], [M.ROCK]: ['#8a6474', '#6a4a5c', '#4f3548', '#3a2638'],
      [M.WHITE]: ['#fff6ea', '#ffe6cc', '#f2c7a4', '#b98a8f'], [M.SHADOW]: ['#a07a90', '#a07a90', '#a07a90', '#a07a90'], [M.RUT]: ['#e2c6a8', '#c8a088', '#9a7a80', '#6e5468'],
      [M.MTN]: ['#b48fbf', '#9c7cb0', '#6e5b98', '#55488a'], [M.MTNSNOW]: ['#ffd2a6', '#f0b797', '#8f7cb0', '#62568f'], [M.FAR]: ['#c9a3c8', '#b08cb8', '#7d6aa3', '#5f5390'],
      [M.FARSNOW]: ['#ffdcb6', '#f2c0a2', '#9b86b8', '#6d5f9c'], [M.RIDGE]: ['#a888b4', '#8e74a6', '#5e4c85', '#463a70'], [M.FOREST]: ['#4a3550', '#3d2c46', '#30223a', '#25192e'],
      [M.VALLEY]: ['#9a84b8', '#9a84b8', '#8a76aa', '#8a76aa'], [M.FIELD]: ['#e8b98c', '#c9a0b8', '#9b84b8', '#6f5f9c'], [M.UMBER]: ['#7a5a62', '#5e4450', '#4a3442', '#382634'],
    },
    sky: { lo: [1, 0.78, 0.58], hi: [0.4, 0.34, 0.6], pale: [1, 0.88, 0.76], cloudLit: [1, 0.9, 0.8], cloudShade: [0.74, 0.6, 0.74], haze: 1.3, hazeBase: 0.08, fog: [[1, 0.84, 0.72], [0.84, 0.66, 0.74], [0.64, 0.52, 0.72], [0.52, 0.44, 0.68]] },
    fx: { air: ['#fff2e2', '#ffe6cc', '#f2c7a4', '#d8a890'], grit: ['#3a2638', '#4f3548', '#6a4a5c'], wall: ['#3a2638', '#4f3548', '#6a4a5c'], crash: ['#e85a0d', '#3a2638', '#ffe6cc', '#f2c7a4'], land: ['#f2c7a4', '#e2c6a8', '#ffe6cc', '#6a4a5c', '#4f3548'] },
  },
  // (cold cloud: teal greys, low contrast in the distance, the far off mostly lost in haze; the rider's orange alone warm)
  mist: {
    pal: {
      [M.SNOW]: ['#eef2f0', '#d3dcda', '#9fb0ae', '#6e8483'], [M.TRACK]: ['#e6ebe8', '#ccd5d2', '#a0afad', '#76888a'], [M.ROCK]: ['#5f7a7a', '#4a6464', '#3a5252', '#2c4242'],
      [M.WHITE]: ['#ffffff', '#eef2f0', '#d3dcda', '#9fb0ae'], [M.SHADOW]: ['#9fb0ae', '#9fb0ae', '#9fb0ae', '#9fb0ae'], [M.RUT]: ['#ccd5d2', '#a0afad', '#88999a', '#6e8283'],
      [M.MTN]: ['#93aaab', '#84a0a1', '#6b8a8c', '#5e7f81'], [M.MTNSNOW]: ['#e6eded', '#d3dfdf', '#9fb5b6', '#86a0a2'], [M.FAR]: ['#a9bcbd', '#9cb0b2', '#869ea1', '#7a9396'],
      [M.FARSNOW]: ['#dfe7e6', '#cfdbda', '#a8bcbd', '#93aaab'], [M.RIDGE]: ['#7f9a9b', '#6e8b8d', '#557476', '#466668'], [M.FOREST]: ['#3e5a5b', '#34504f', '#2a4444', '#203838'],
      [M.VALLEY]: ['#9fb4b4', '#9fb4b4', '#93a9a9', '#93a9a9'], [M.FIELD]: ['#c3cfc9', '#a9bab7', '#8ea3a3', '#728a8b'], [M.UMBER]: ['#5a6e6a', '#485a57', '#384a48', '#2a3a39'],
    },
    sky: { lo: [0.8, 0.85, 0.84], hi: [0.52, 0.6, 0.62], pale: [0.92, 0.94, 0.93], cloudLit: [0.94, 0.96, 0.95], cloudShade: [0.68, 0.75, 0.75], haze: 2.6, hazeBase: 0.42, fog: [[0.84, 0.88, 0.87], [0.76, 0.82, 0.82], [0.7, 0.77, 0.77], [0.66, 0.74, 0.74]] },
    fx: { air: ['#e6ecea', '#d8e0de', '#c8d2d0', '#aebcba'], grit: ['#2c4242', '#3a5252', '#4a6464'], wall: ['#2c4242', '#3a5252', '#4a6464'], crash: ['#e85a0d', '#2c4242', '#e6ecea', '#c8d2d0'], land: ['#d3dcda', '#ccd5d2', '#e6ecea', '#4a6464', '#3a5252'] },
  },
  // (lower slopes in autumn: limestone and scree, ochre grass, green-grey ranges with snow only high up)
  autumn: {
    pal: {
      [M.SNOW]: ['#ece4d6', '#d5c8b4', '#a8977f', '#7a6a58'], [M.TRACK]: ['#e8dccb', '#cdbca4', '#a6937c', '#7a6a58'], [M.ROCK]: ['#8a7a6a', '#6a5a4c', '#4f4238', '#3a302a'],
      [M.WHITE]: ['#f6efe3', '#ece4d6', '#d5c8b4', '#a8977f'], [M.SHADOW]: ['#a69a8c', '#a69a8c', '#a69a8c', '#a69a8c'], [M.RUT]: ['#cdbca4', '#a6937c', '#8a7a68', '#6a5c4e'],
      [M.MTN]: ['#8ea08a', '#7d927a', '#647a66', '#52685a'], [M.MTNSNOW]: ['#f2f2ee', '#e2e2dc', '#a7b2a6', '#8a978b'], [M.FAR]: ['#a3b4aa', '#93a69c', '#7c938a', '#6c847c'],
      [M.FARSNOW]: ['#f4f4f0', '#e4e6e0', '#b0bcb2', '#93a29a'], [M.RIDGE]: ['#b8a462', '#9a8a54', '#6f6a48', '#5a573e'], [M.FOREST]: ['#4b5238', '#3f462f', '#333a27', '#282e1f'],
      [M.VALLEY]: ['#a8a070', '#a8a070', '#968e62', '#968e62'], [M.FIELD]: ['#d8b45a', '#b8a46a', '#8f8a64', '#6a6a52'], [M.UMBER]: ['#7a5a42', '#5e4432', '#4a3426', '#38261c'],
    },
    sky: { lo: [0.76, 0.85, 0.87], hi: [0.4, 0.58, 0.66], pale: [0.9, 0.93, 0.92], cloudLit: [0.98, 0.98, 0.96], cloudShade: [0.78, 0.82, 0.82], haze: 1.2, hazeBase: 0.05, fog: [[0.8, 0.86, 0.84], [0.64, 0.74, 0.72], [0.52, 0.64, 0.62], [0.46, 0.58, 0.58]] },
    fx: { air: ['#f6efe3', '#ece4d6', '#d5c8b4', '#bfae96'], grit: ['#3a302a', '#4f4238', '#6a5a4c'], wall: ['#3a302a', '#4f4238', '#6a5a4c'], crash: ['#e85a0d', '#3a302a', '#ece4d6', '#d5c8b4'], land: ['#d5c8b4', '#cdbca4', '#ece4d6', '#6a5a4c', '#4f4238'] },
  },
  // (moonlight: a silver road against indigo; the rider's orange and cream kept, so they still read)
  moon: {
    pal: {
      [M.SNOW]: ['#d2d8f0', '#a6aed6', '#6a72a6', '#3f4677'], [M.TRACK]: ['#cad0ea', '#9ea6cc', '#6a72a6', '#454c7e'], [M.ROCK]: ['#3a3f66', '#2c3156', '#22264a', '#191c3a'],
      [M.WHITE]: ['#e8ecfc', '#d2d8f0', '#a6aed6', '#6a72a6'], [M.SHADOW]: ['#5a6298', '#5a6298', '#5a6298', '#5a6298'], [M.RUT]: ['#9ea6cc', '#7a82b4', '#5a6298', '#3f4677'],
      [M.MTN]: ['#424a86', '#3a4178', '#30366a', '#282d5c'], [M.MTNSNOW]: ['#cfd6f2', '#aeb7e0', '#646eaa', '#424a86'], [M.FAR]: ['#4a5290', '#414884', '#363c74', '#2e3366'],
      [M.FARSNOW]: ['#d6dcf4', '#b8c0e6', '#6e78b4', '#4a5290'], [M.RIDGE]: ['#363d74', '#2f3566', '#262b58', '#1f234a'], [M.FOREST]: ['#1c1f3e', '#171a35', '#13152c', '#0f1124'],
      [M.VALLEY]: ['#3e4678', '#3e4678', '#363e6e', '#363e6e'], [M.FIELD]: ['#5a6298', '#4c5488', '#3e4678', '#323a68'], [M.UMBER]: ['#34385e', '#2a2e50', '#222644', '#1a1d36'],
    },
    sky: { lo: [0.24, 0.27, 0.48], hi: [0.05, 0.06, 0.18], pale: [0.42, 0.45, 0.64], cloudLit: [0.44, 0.47, 0.68], cloudShade: [0.22, 0.24, 0.42], haze: 1, hazeBase: 0.1, fog: [[0.36, 0.39, 0.6], [0.24, 0.27, 0.48], [0.16, 0.18, 0.38], [0.12, 0.14, 0.32]] },
    fx: { air: ['#a6aed6', '#9ea6cc', '#8a92c4', '#6a72a6'], grit: ['#191c3a', '#22264a', '#2c3156'], wall: ['#191c3a', '#22264a', '#2c3156'], crash: ['#e85a0d', '#191c3a', '#a6aed6', '#8a92c4'], land: ['#9ea6cc', '#8a92c4', '#a6aed6', '#2c3156', '#22264a'] },
  },
};
export const MOOD_NAMES = Object.keys(MOODS);
/** put a mood on the palette and the sky, before the renderer's made */
export function applyMood(name: string | null) {
  const m = name ? MOODS[name] : null;
  if (!m) return false;
  for (const [k, v] of Object.entries(m.pal)) PALETTE[Number(k)] = v!;
  Object.assign(SKY, m.sky);
  // (in place: the speed layer holds these arrays)
  for (const [k, v] of Object.entries(m.fx)) { const a = FX[k as keyof typeof FX]; a.length = 0; a.push(...v!); }
  return true;
}
