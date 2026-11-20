/**
 * The menu: the page as it opens. A view over the city from a high ledge, every character lined up along its edge,
 * backs to the eye, looking out; the eye behind one of them. What's under a finger says what a sideways swipe changes:
 * a character, who you are (the eye moves along the line to them); the sky, the time of day; the city below, the
 * seed (another city, another ledge); the roof underfoot, the look. Pushed forward (a swipe up, the button, W or ↑),
 * the one you're behind leaps off into the city and is yours; the others stay on the ledge, watching.
 *
 * The ledge is found, not authored: the tallest buildings near the start, each edge long enough for everyone, clear at
 * its lip (no parapet or unit in the way), scored by how open the view out over it is and whether there's a lower roof
 * across a jumpable gap to leap to first.
 */
import type { Box, City } from './city';
import { TAG } from './city';

type V3 = [number, number, number];
/** how far apart they stand along the ledge (m): shoulder to shoulder, near enough */
const SPACING = 1.4;
/** where the menu's eye is, behind the line and above the roof (m): the ledge must leave it a clear view (main.ts menuView) */
export const EYE_BACK = 7.6, EYE_UP = 3.6;
export interface Ledge {
  box: Box; y: number;
  /** out over the edge (level, unit), and along it (to the line's right, seen from behind) */
  n: V3; t: V3;
  /** where each stands (0.85 m back from the lip), the way they face, what's across the gap in front */
  spots: V3[]; heading: number; across: { d: number; y: number } | null;
}

/** a ledge for `count` to stand along, near the start of this city */
export function findLedge(city: City, count: number): Ledge | null {
  const need = count * SPACING + 1.2;
  let best: { s: number; l: Ledge } | null = null;
  for (const min of [15, 9, 3]) {
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) for (const b of city.chunk(cx, cz).boxes) {
      if (b.tag !== TAG.BUILDING || b.y1 < min) continue;
      const y = b.y1, sides: [V3, V3, V3, number][] = [
        [[0, 0, -1], [b.x0, y, b.z0], [1, 0, 0], b.x1 - b.x0], [[0, 0, 1], [b.x1, y, b.z1], [-1, 0, 0], b.x1 - b.x0],
        [[-1, 0, 0], [b.x0, y, b.z1], [0, 0, -1], b.z1 - b.z0], [[1, 0, 0], [b.x1, y, b.z0], [0, 0, 1], b.z1 - b.z0],
      ];
      for (const [n, o, tt, L] of sides) {
        if (L < need) continue;
        // (seen from behind, facing n, the line runs to the right along -tt for these corners: take t as the viewer's right)
        const t: V3 = [n[2] * -1, 0, n[0]], mid: V3 = [o[0] + tt[0] * L / 2, y, o[2] + tt[2] * L / 2];
        const spots: V3[] = [];
        let clear = true;
        for (let i = 0; i < count; i++) {
          const k = (i - (count - 1) / 2) * SPACING, p: V3 = [mid[0] + t[0] * k - n[0] * 0.85, y, mid[2] + t[2] * k - n[2] * 0.85];
          // (nothing standing where they'd stand, or between them and the lip)
          for (const d of [0, 0.4, 0.8, -0.6]) if (Math.abs(city.heightAt(p[0] + n[0] * d, p[2] + n[2] * d) - y) > 0.01) clear = false;
          spots.push(p);
        }
        // (and room behind for the eye: nothing on the roof between it and anyone's feet, along the line it sees them by, nor
        // standing up behind it)
        for (let i = 0; i < count && clear; i++) for (let s = 0.3; s <= EYE_BACK + 1.5; s += 0.3) for (const k of [-0.5, 0, 0.5]) {
          const p = spots[i], x = p[0] - n[0] * s + t[0] * k, z = p[2] - n[2] * s + t[2] * k;
          if (city.heightAt(x, z) > y + 0.05 + Math.min(EYE_UP, (EYE_UP * s) / EYE_BACK) * 0.85) clear = false;
        }
        if (!clear) continue;
        // (across: the first roof out over the gap; open: how far below the view out over it falls)
        let across: Ledge['across'] = null;
        for (let s = 0.3; s <= 6; s += 0.3) { const h = city.heightAt(mid[0] + n[0] * s, mid[2] + n[2] * s); if (h > 1) { across = { d: s, y: h }; break; } }
        let open = 0, m = 0;
        for (let s = 10; s <= 80; s += 7) for (const k of [-12, 0, 12]) { open += Math.max(0, y - city.heightAt(mid[0] + n[0] * s + t[0] * k, mid[2] + n[2] * s + t[2] * k)) / y; m++; }
        // (blocked: anything near in front standing up into the view, past the roof across)
        let blocked = 0, nb = 0;
        for (let s = (across?.d ?? 2) + 3; s <= 40; s += 1.5) for (const k of [-4, 0, 4]) { if (city.heightAt(mid[0] + n[0] * s + t[0] * k, mid[2] + n[2] * s + t[2] * k) > y - 1.5) blocked++; nb++; }
        const jumpable = !!across && across.d >= 1.2 && across.d <= 4.5 && across.y < y - 0.4 && across.y > y - 7;
        const score = (open / m) * 4 + (jumpable ? 2 : 0) + y / 40 - (blocked / nb) * 8;
        if (!best || score > best.s) best = { s: score, l: { box: b, y, n, t, spots, heading: Math.atan2(n[0], n[2]), across } };
      }
    }
    if (best) break;
  }
  return (best as { s: number; l: Ledge } | null)?.l ?? null;
}

/** a time of day: the light (as azimuth from the way the ledge looks, and elevation, degrees), and what a look with a sky
 * shows of it */
export interface Time { name: string; az: number; el: number; sky: { top: [number, number, number]; horizon: [number, number, number]; clouds: number }; fog: [number, number, number]; fogNear: number }
export const TIMES: Time[] = [
  { name: 'dusk', az: 12, el: 7, sky: { top: [0.24, 0.27, 0.53], horizon: [0.66, 0.5, 0.6], clouds: 0.7 }, fog: [0.47, 0.47, 0.64], fogNear: 0.06 },
  { name: 'golden hour', az: 55, el: 14, sky: { top: [0.47, 0.52, 0.72], horizon: [0.98, 0.76, 0.56], clouds: 0.5 }, fog: [0.82, 0.7, 0.66], fogNear: 0.1 },
  { name: 'day', az: 140, el: 50, sky: { top: [0.58, 0.56, 0.7], horizon: [0.89, 0.83, 0.84], clouds: 0.5 }, fog: [0.77, 0.74, 0.83], fogNear: 0.12 },
  { name: 'morning', az: -70, el: 18, sky: { top: [0.55, 0.66, 0.84], horizon: [0.95, 0.88, 0.8], clouds: 0.35 }, fog: [0.8, 0.83, 0.88], fogNear: 0.1 },
];
/** a time's sun, toward it, for a ledge looking along `heading` */
export function sunOf(time: Time, heading: number): [number, number, number] {
  const a = heading + (time.az * Math.PI) / 180, e = (time.el * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}

/** what's under a point of the screen: one of the characters, the roof underfoot, the city, or the sky */
export type Under = { kind: 'character'; i: number } | { kind: 'roof' | 'city' | 'sky' };
export function underAt(ndc: [number, number], vp: Float32Array, inv: Float32Array, eye: number[], city: City, ledge: Ledge): Under {
  const proj = (p: V3) => { const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13], w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15]; return w > 0 ? [x / w, y / w] : null; };
  // (a character: within its outline as seen, feet to head, shoulders wide; the nearest of them)
  let near = -1, nd = Infinity;
  ledge.spots.forEach((s, i) => {
    const f = proj(s), h = proj([s[0], s[1] + 1.9, s[2]]), r = proj([s[0] + ledge.t[0] * 0.4, s[1] + 1, s[2] + ledge.t[2] * 0.4]), c = proj([s[0], s[1] + 1, s[2]]);
    if (!f || !h || !r || !c) return;
    const half = Math.abs(r[0] - c[0]), dx = Math.abs(ndc[0] - c[0]);
    if (dx < half && ndc[1] > f[1] && ndc[1] < h[1] && dx < nd) { nd = dx; near = i; }
  });
  if (near >= 0) return { kind: 'character', i: near };
  const a = mulPoint(inv, [ndc[0], ndc[1], -1]), b = mulPoint(inv, [ndc[0], ndc[1], 1]);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]); d[0] /= l; d[1] /= l; d[2] /= l;
  for (let s = 0.2, step = 0.1; s < 600; s += step, step = Math.min(2, step * 1.04)) {
    const x = eye[0] + d[0] * s, y = eye[1] + d[1] * s, z = eye[2] + d[2] * s;
    if (y < 0) return { kind: 'city' };
    const h = city.heightAt(x, z);
    if (y <= h) { const o = ledge.box; return x >= o.x0 - 0.1 && x <= o.x1 + 0.1 && z >= o.z0 - 0.1 && z <= o.z1 + 0.1 && Math.abs(h - ledge.y) < 0.3 ? { kind: 'roof' } : { kind: 'city' }; }
  }
  return { kind: d[1] > -0.03 ? 'sky' : 'city' };
}
function mulPoint(m: Float32Array, p: number[]): number[] {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x / w, y / w, z / w];
}

/**
 * Standing about, as a layer over a standing pose's bones (the rig has no idle of its own): the head turned about the
 * neck, the upper body bent at the waist, the whole leaned over the feet. At rest: a slouch, slow breathing, the weight
 * shifting from leg to leg, the head drifting, looking about and down at the drop. Attentive (`attention` 1, the one
 * chosen): up straight, chest up, a quicker breath, leaning a little toward the edge, the eyes out over the city; and
 * `look` (radians, about up and across): a turn of the head asked for over that (a look back over the shoulder at the
 * eye when chosen, or toward the runner once one's gone).
 */
export function idlePose(bones: { name: string; m: Float32Array }[], o: { heading: number; attention: number; look: { yaw: number; pitch: number }; t: number; seed: number }): void {
  const f: V3 = [Math.sin(o.heading), 0, Math.cos(o.heading)], r: V3 = [-f[2], 0, f[0]], up: V3 = [0, 1, 0], a = o.attention, t = o.t, sd = o.seed;
  const wander = (k: number, rate: number) => noise(sd * 13.7 + k, t * rate) * 2 - 1;
  const at = (n: string) => bones.find((b) => b.name === n);
  const head = at('head'), torso = at('torso'), feet = bones.filter((b) => b.name.startsWith('foot'));
  if (!head || !torso) return;
  const neck: V3 = [head.m[12], head.m[13], head.m[14]], waist: V3 = [torso.m[12], torso.m[13], torso.m[14]];
  const ground: V3 = feet.length ? [feet.reduce((s, b) => s + b.m[12], 0) / feet.length, Math.min(...feet.map((b) => b.m[13])), feet.reduce((s, b) => s + b.m[14], 0) / feet.length] : [waist[0], waist[1] - 1, waist[2]];
  const isHead = (n: string) => n === 'head' || n === 'worn:head';
  const isUpper = (n: string) => isHead(n) || /^(torso|upperArm|foreArm)/.test(n) || /^worn:(torso|upperArm|foreArm)/.test(n);
  // (a positive turn about `r` tips the top back: a slouch, forward, is negative)
  const breath = Math.sin(t * (1.6 + 0.9 * a) + sd * 5) * (0.012 + 0.008 * a);
  const headYaw = (1 - a) * wander(1, 0.18) * 0.45 + o.look.yaw, headPitch = (1 - a) * (0.16 + 0.12 * wander(2, 0.12)) - a * 0.04 + o.look.pitch;
  const slouch = (1 - a) * 0.08 - a * 0.035, sway = (1 - a) * wander(3, 0.09) * 0.03 + a * Math.sin(t * 2.1 + sd) * 0.006;
  const apply = (sel: (n: string) => boolean, M: Float32Array) => { for (const b of bones) if (sel(b.name)) b.m = mulM(M, b.m); };
  apply(isHead, mulM(rotAbout(neck, up, headYaw), rotAbout(neck, r, -headPitch)));
  // (the shoulders go a little way with a turn of the head: a look back is a turn of the body too)
  apply(isUpper, mulM(rotAbout(waist, up, o.look.yaw * 0.3), rotAbout(waist, r, -(slouch + breath))));
  apply(() => true, mulM(rotAbout(ground, f, sway), rotAbout(ground, r, -a * 0.03)));
}
/** a 1-D value noise (0..1) */
function noise(seed: number, x: number): number {
  const h = (i: number) => { let v = Math.imul((i | 0) ^ Math.imul(seed * 1000 | 0, 0x9e3779b1), 0x85ebca6b); v ^= v >>> 13; v = Math.imul(v, 0xc2b2ae35); v ^= v >>> 16; return (v >>> 0) / 4294967296; };
  const i = Math.floor(x), u = x - i, s = u * u * (3 - 2 * u); return h(i) * (1 - s) + h(i + 1) * s;
}
/** a turn by `ang` about `axis` (unit) through `p`, as a matrix (column-major) */
function rotAbout(p: V3, axis: V3, ang: number): Float32Array {
  const [x, y, z] = axis, c = Math.cos(ang), s = Math.sin(ang), k = 1 - c, m = new Float32Array(16);
  m[0] = c + x * x * k; m[1] = y * x * k + z * s; m[2] = z * x * k - y * s;
  m[4] = x * y * k - z * s; m[5] = c + y * y * k; m[6] = z * y * k + x * s;
  m[8] = x * z * k + y * s; m[9] = y * z * k - x * s; m[10] = c + z * z * k; m[15] = 1;
  m[12] = p[0] - (m[0] * p[0] + m[4] * p[1] + m[8] * p[2]); m[13] = p[1] - (m[1] * p[0] + m[5] * p[1] + m[9] * p[2]); m[14] = p[2] - (m[2] * p[0] + m[6] * p[1] + m[10] * p[2]);
  return m;
}
function mulM(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
