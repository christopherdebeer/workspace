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
const SPACING = 0.78;
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
        // (and room behind for the eye: nothing taller than them within it, from the line back to where the eye stands)
        for (let i = 0; i < count && clear; i += Math.max(1, count - 1)) for (let s = 0.5; s <= 7.5; s += 0.5) for (const k of [-1.5, 0, 1.5]) {
          const p = spots[i], x = p[0] - n[0] * s + t[0] * k, z = p[2] - n[2] * s + t[2] * k;
          if (city.heightAt(x, z) > y + 0.6) clear = false;
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
