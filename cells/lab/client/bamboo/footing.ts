/**
 * What the body meets (nothing decided here: runner.ts asks).
 *
 * - **underfoot**: anywhere near, the highest of the ground, a stair's tread, a stone's top and a root's, each as the
 *   renderer draws it (a stone's top is the lump's own, turned and scaled as it's drawn), and which it is;
 * - **in the way**: the culms as they really go, leaning and bowed, cut into posts: an upright culm one post rising from
 *   the ground, a bowed one a run of short ones along its arc, each knowing how high off the ground it passes. A post
 *   low enough is stepped over, one at head height ducked under, the rest gone round or squeezed past.
 */
import { CHUNK, culmPoint, type Chunk, type Culm, type Land, type Stone } from './world';
import { lumpTopAt, LUMP_R } from './lump';

export type Footing = 'ground' | 'step' | 'stone' | 'root';
export interface Under { y: number; kind: Footing; stone: Stone | null }
/** a bit of culm near the body: where, how thick, how high off the ground it passes (lo … hi) */
export interface Post { x: number; z: number; r: number; lo: number; hi: number; culm: Culm }
/** how a post stands to a body running past it */
export type Meets = 'over' | 'duck' | 'block' | 'free';
/** a body's heights: the knees (stepped over below them), the hips, the head's top */
export const KNEE = 0.5, HIPS = 1.15, HEAD = 1.78;
export function meets(p: Post, duckTo = HEAD): Meets {
  if (p.hi < KNEE) return 'over';
  if (p.lo >= HEAD) return 'free';
  if (p.lo >= HIPS) return p.lo >= duckTo ? 'free' : 'duck';
  return 'block';
}

const key = (i: number, j: number) => `${i},${j}`;

export class Footings {
  constructor(readonly land: Land, readonly chunks: Map<string, Chunk>) {}
  private near(x: number, z: number) {
    const out: Chunk[] = [], ci = Math.floor(x / CHUNK), cj = Math.floor(z / CHUNK);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const c = this.chunks.get(key(ci + a, cj + b)); if (c) out.push(c); }
    return out;
  }
  /** the ground itself (a stair's tread, where there is one) */
  groundAt(x: number, z: number) {
    const tr = this.land.tread(x, z);
    if (tr !== null) return tr;
    const c = this.chunks.get(key(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (!c) return this.land.ground(x, z);
    const fx = x - c.x0, fz = z - c.z0, i = Math.min(CHUNK - 1, Math.floor(fx)), j = Math.min(CHUNK - 1, Math.floor(fz)), u = fx - i, v = fz - j, N = CHUNK + 1, G = c.ground, k = i + j * N;
    return (G[k] * (1 - u) + G[k + 1] * u) * (1 - v) + (G[k + N] * (1 - u) + G[k + N + 1] * u) * v;
  }
  /** what you'd stand on at (x, z) */
  at(x: number, z: number): Under {
    const tr = this.land.tread(x, z);
    if (tr !== null) return { y: tr, kind: 'step', stone: null };
    let y = this.groundAt(x, z), kind: Footing = 'ground', stone: Stone | null = null;
    for (const c of this.near(x, z)) {
      for (const s of c.stones) {
        const dx = x - s.x, dz = z - s.z, R = s.r * LUMP_R;
        if (dx > R || dx < -R || dz > R || dz < -R) continue;
        const co = Math.cos(s.yaw), si = Math.sin(s.yaw), t = lumpTopAt((co * dx - si * dz) / s.r, (si * dx + co * dz) / s.r);
        if (Number.isNaN(t)) continue;
        const ys = s.y + t * s.flat * s.r;
        if (ys > y) { y = ys; kind = 'stone'; stone = s; }
      }
      for (const q of c.roots) {
        const dx = x - q.x, dz = z - q.z;
        if (Math.abs(dx) > q.len || Math.abs(dz) > q.len) continue;
        const co = Math.cos(q.yaw), si = Math.sin(q.yaw), u = (co * dx - si * dz) / (q.len * 0.5), w = si * dx + co * dz;
        if (Math.abs(u) >= 1) continue;
        const thin = 1 - u * u * 0.6, a = Math.abs(w) / (q.r * thin);
        if (a >= 1) continue;
        const yr = q.y + q.r * (0.75 * thin + 0.4 * (1 - u * u)) * Math.sqrt(1 - a * a);
        if (yr > y) { y = yr; kind = 'root'; stone = null; }
      }
    }
    return { y, kind, stone };
  }
  /** the slope underfoot, as a normal (from what you'd stand on round about) */
  normalAt(x: number, z: number, e = 0.15): [number, number, number] {
    const gx = (this.at(x + e, z).y - this.at(x - e, z).y) / (2 * e), gz = (this.at(x, z + e).y - this.at(x, z - e).y) / (2 * e), l = Math.hypot(gx, 1, gz);
    return [-gx / l, 1 / l, -gz / l];
  }
  /** the stones within r of (x, z) */
  stonesNear(x: number, z: number, r: number): Stone[] {
    const out: Stone[] = [];
    for (const c of this.near(x, z)) for (const s of c.stones) if (Math.abs(s.x - x) < r + s.r && Math.abs(s.z - z) < r + s.r) out.push(s);
    return out;
  }
  /** the culms near (x, z) cut into posts: an upright one at hip height (where it leans to there), a bowed one all
   * along its arc */
  posts(x: number, z: number, r: number): Post[] {
    const out: Post[] = [];
    for (const c of this.near(x, z)) for (let k = 0; k < c.tall; k++) {
      const q = c.culms[k];
      if (q.r <= 0) continue;
      const bowed = q.bend > 1.5, reach = bowed ? q.h * 0.8 : 1;
      if (Math.abs(q.x - x) > r + reach || Math.abs(q.z - z) > r + reach) continue;
      if (!bowed) { const p = culmPoint(q, 1); out.push({ x: p[0], z: p[2], r: q.r, lo: 0, hi: q.h, culm: q }); continue; }
      const n = Math.max(12, Math.ceil(q.h / 0.25));
      for (let m = 0; m <= n; m++) {
        const v = m / n, p = culmPoint(q, v * q.h), rr = q.r * (1 - 0.62 * v ** 1.3), hgt = p[1] - this.groundAt(p[0], p[2]);
        if (Math.abs(p[0] - x) > r || Math.abs(p[2] - z) > r) continue;
        out.push({ x: p[0], z: p[2], r: rr, lo: Math.max(0, hgt - rr), hi: hgt + rr, culm: q });
      }
    }
    return out;
  }
}
