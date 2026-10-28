/**
 * The mountain, endless (no drawing here: render.ts draws a chunk as it's handed one).
 *
 * - **the land**: long slopes and ridges and the valleys between, rumpled; here and there the rock breaks through in a
 *   **cliff band**, the ground stepping up five to nine metres along a winding rim (`base`);
 * - **the trails**: a sparse network over it. The land is cut into regions; a trail crosses some edges of each, and
 *   every crossing is shared with the region next door, so trails run on from one region into the next, meeting at a
 *   point inside each. A trail's bed follows the land smoothed; where it climbs steeply (a cliff band, mostly) it's a
 *   flight of stone steps. Each is cut into the slope as a bench;
 * - **the chunks**: the land is built where you are and a little way round, a chunk at a time (`Chunk`): its ground,
 *   its culms (thick and close, thinner on steep ground and over a cliff's rim, thinner still along the grove's own
 *   runs, the lanes a deer would take), their sprays, low greens along the trails, stones, and the trails' steps.
 *
 * Everything is in metres; y is up. The same seed is the same mountain wherever you go.
 */
import { hash } from '../kit/rng';

export type V2 = [number, number];
export const CHUNK = 32, CELL = 1, CN = CHUNK / CELL + 1;
export const REGION = 160;
/** a trail's half width; how far its banks run before the slope takes over; a stair's tread */
export const HALF = 0.9, BANK = 2.4, TREAD = 0.4;

const u01 = (...n: number[]) => hash(...n) / 4294967296;
export function vnoise(x: number, z: number, s = 1): number {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = u01(i, j, s), b = u01(i + 1, j, s), c = u01(i, j + 1, s), d = u01(i + 1, j + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
const fbm = (x: number, z: number, s: number) => vnoise(x, z, s) * 0.55 + vnoise(x * 2.1, z * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, z * 4.3, s + 13) * 0.15;
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** how far up a cliff band (x, z) is, 0 below its rim … 1 on top, and the band's height there */
export function cliff(x: number, z: number, seed: number): { up: number; h: number } {
  const n = fbm(x / 150, z / 150, seed + 50);
  return { up: ss(0.6, 0.618, n), h: 5 + vnoise(x / 60, z / 60, seed + 51) * 4 };
}
/** the land as it lies, before any trail is cut into it */
export function base(x: number, z: number, seed: number): number {
  let y = (fbm(x / 420, z / 420, seed) - 0.5) * 110 + (fbm(x / 95, z / 95, seed + 3) - 0.5) * 26 + (fbm(x / 22, z / 22, seed + 5) - 0.5) * 2.4;
  const c = cliff(x, z, seed);
  return y + c.up * c.h;
}

// ─── the trails ───
/** a stone step: its range along its trail, its front edge, which way it faces (up), its top, how deep, wide, tall */
export interface Step { sa: number; sb: number; x: number; z: number; dx: number; dz: number; y: number; depth: number; width: number; drop: number; seed: number }
export interface Trail { id: string; x: Float32Array; z: Float32Array; y: Float32Array; stair: Uint8Array; length: number; steps: Step[] }
const DS = 1;

function lay(pts: V2[], ds: number): V2[] {
  const P = [pts[0], ...pts, pts[pts.length - 1]], dense: V2[] = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let k = 0; k < 30; k++) {
      const t = k / 30, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(pts[pts.length - 1]);
  const out: V2[] = [dense[0]];
  let carry = 0;
  for (let i = 1; i < dense.length; i++) {
    const [ax, az] = dense[i - 1], [bx, bz] = dense[i], l = Math.hypot(bx - ax, bz - az);
    let at = ds - carry;
    while (at <= l) { const t = at / l; out.push([ax + (bx - ax) * t, az + (bz - az) * t]); at += ds; }
    carry = l - (at - ds);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export class World {
  private regions = new Map<string, Trail[]>();
  private buckets = new Map<string, number[]>(); // (8 m cells: the trail samples in each, as trail index pairs)
  private trailList: Trail[] = [];
  constructor(readonly seed: number) {}

  /** where a trail crosses a region's edge (shared with the region next door), or null if none does */
  private crossing(kind: 'v' | 'h', i: number, j: number): V2 | null {
    if (u01(this.seed, i, j, kind === 'v' ? 11 : 12) > 0.62) return null;
    const t = 0.2 + 0.6 * u01(this.seed, i, j, kind === 'v' ? 13 : 14);
    return kind === 'v' ? [i * REGION, (j + t) * REGION] : [(i + t) * REGION, j * REGION];
  }
  /** a region's trails, laid on first asking */
  trails(i: number, j: number): Trail[] {
    const key = `${i},${j}`, have = this.regions.get(key);
    if (have) return have;
    const s = this.seed;
    const ends = [this.crossing('v', i, j), this.crossing('v', i + 1, j), this.crossing('h', i, j), this.crossing('h', i, j + 1)].filter((p): p is V2 => !!p);
    const C: V2 = [(i + 0.3 + 0.4 * u01(s, i, j, 20)) * REGION, (j + 0.3 + 0.4 * u01(s, i, j, 21)) * REGION];
    const out: Trail[] = [];
    if (ends.length >= 1) ends.forEach((e, k) => {
      // (from the edge to the meeting place, by a wandering line)
      const m1: V2 = [e[0] + (C[0] - e[0]) * 0.35 + (u01(s, i, j, k, 30) - 0.5) * 40, e[1] + (C[1] - e[1]) * 0.35 + (u01(s, i, j, k, 31) - 0.5) * 40];
      const m2: V2 = [e[0] + (C[0] - e[0]) * 0.7 + (u01(s, i, j, k, 32) - 0.5) * 30, e[1] + (C[1] - e[1]) * 0.7 + (u01(s, i, j, k, 33) - 0.5) * 30];
      out.push(this.make(`${key}:${k}`, lay([e, m1, m2, C], DS)));
    });
    this.regions.set(key, out);
    for (const t of out) {
      const ti = this.trailList.push(t) - 1;
      for (let n = 0; n < t.x.length; n++) { const b = `${Math.floor(t.x[n] / 8)},${Math.floor(t.z[n] / 8)}`; (this.buckets.get(b) ?? this.buckets.set(b, []).get(b)!).push(ti, n); }
    }
    return out;
  }
  private make(id: string, pts: V2[]): Trail {
    const n = pts.length, s = this.seed, raw = new Float32Array(n), y = new Float32Array(n);
    for (let k = 0; k < n; k++) raw[k] = base(pts[k][0], pts[k][1], s);
    // (smoothed, so a trail doesn't follow every rumple; its ends pinned to the land where trails meet)
    const W = 10;
    for (let k = 0; k < n; k++) { let a = 0, c = 0; for (let m = -W; m <= W; m++) { a += raw[Math.min(n - 1, Math.max(0, k + m))]; c++; } y[k] = a / c; }
    const ya = raw[0] - y[0], yb = raw[n - 1] - y[n - 1];
    for (let k = 0; k < n; k++) { const t = k / (n - 1); y[k] += ya * (1 - t) + yb * t; }
    const stair = new Uint8Array(n);
    for (let k = 0; k < n; k++) { const a = Math.max(0, k - 2), b = Math.min(n - 1, k + 2); if (Math.abs(y[b] - y[a]) / ((b - a) * DS) > 0.16) stair[k] = 1; }
    const steps: Step[] = [];
    const lerp = (q: number) => { const f = Math.min(n - 1.001, Math.max(0, q / DS)), i = Math.floor(f), t = f - i; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, y[i] + (y[i + 1] - y[i]) * t]; };
    for (let i = 0; i < n; ) {
      if (!stair[i]) { i++; continue; }
      let j = i; while (j < n - 1 && stair[j + 1]) j++;
      const s0 = i * DS, s1 = j * DS, count = Math.max(1, Math.round((s1 - s0) / TREAD)), up = y[j] > y[i] ? 1 : -1;
      for (let k = 0; k < count; k++) {
        const sa = s0 + ((s1 - s0) * k) / count, sb = s0 + ((s1 - s0) * (k + 1)) / count;
        const lo = lerp(up > 0 ? sa : sb), hi = lerp(up > 0 ? sb : sa), dx = hi[0] - lo[0], dz = hi[1] - lo[1], l = Math.hypot(dx, dz) || 1;
        const jx = (u01(s, k, i, 78) - 0.5) * 0.12, ja = (u01(s, k, i, 79) - 0.5) * 0.12, ca = Math.cos(ja), sa2 = Math.sin(ja), ux = dx / l, uz = dz / l;
        steps.push({ sa, sb, x: lo[0] - uz * jx, z: lo[1] + ux * jx, dx: ux * ca + uz * sa2, dz: uz * ca - ux * sa2, y: hi[2] + (u01(s, k, i, 80) - 0.5) * 0.03, depth: (sb - sa) * 1.08, width: HALF * 1.7 * (0.9 + u01(s, k, i, 77) * 0.2), drop: Math.abs(hi[2] - lo[2]) + 0.9, seed: u01(s, k, i, 81) });
      }
      i = j + 1;
    }
    return { id, x: Float32Array.from(pts.map((p) => p[0])), z: Float32Array.from(pts.map((p) => p[1])), y, stair, length: (n - 1) * DS, steps };
  }
  /** make sure the trails that could reach (x, z) are laid */
  private around(x: number, z: number) {
    const i = Math.floor(x / REGION), j = Math.floor(z / REGION);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) this.trails(i + a, j + b);
  }
  /** the nearest trail sample to (x, z) within about 16 m: its distance, the trail and the sample */
  trailNear(x: number, z: number): { d: number; trail: Trail | null; i: number } {
    this.around(x, z);
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    let best = 1e9, bt: Trail | null = null, bi = -1;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const L = this.buckets.get(`${cx + a},${cz + b}`); if (!L) continue;
      for (let m = 0; m < L.length; m += 2) { const t = this.trailList[L[m]], i = L[m + 1], d = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2; if (d < best) { best = d; bt = t; bi = i; } }
    }
    return { d: bt ? Math.sqrt(best) : 99, trail: bt, i: bi };
  }
  /** the ground at (x, z): the land, with any trail's bench cut into it */
  ground(x: number, z: number): number {
    const b = base(x, z, this.seed), q = this.trailNear(x, z);
    if (!q.trail) return b;
    const yp = q.trail.y[q.i] - 0.06, t = ss(HALF, HALF + BANK + Math.abs(b - yp) * 0.25, q.d);
    return yp + (b - yp) * t;
  }
  /** the height underfoot on a trail's stair, if (x, z) is on one */
  tread(x: number, z: number): number | null {
    const q = this.trailNear(x, z);
    if (!q.trail || q.d > HALF || !q.trail.stair[q.i]) return null;
    const s = q.i * DS;
    for (const st of q.trail.steps) if (s >= st.sa - 0.5 && s < st.sb + 0.5) { const ax = x - st.x, az = z - st.z, a = ax * st.dx + az * st.dz; if (a >= -0.05 && a <= st.depth) return st.y; }
    return null;
  }

  // ─── a chunk ───
  chunk(ci: number, cj: number): Chunk {
    const s = this.seed, x0 = ci * CHUNK, z0 = cj * CHUNK;
    const ground = new Float32Array(CN * CN), near = new Float32Array(CN * CN), rock = new Float32Array(CN * CN);
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
      const x = x0 + i * CELL, z = z0 + j * CELL, k = i + j * CN;
      ground[k] = this.ground(x, z); near[k] = Math.min(30, this.trailNear(x, z).d);
    }
    // (rock where the ground's steep: a cliff's face, a bank cut deep)
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
      const k = i + j * CN, gx = (ground[Math.min(CN - 1, i + 1) + j * CN] - ground[Math.max(0, i - 1) + j * CN]) / 2, gz = (ground[i + Math.min(CN - 1, j + 1) * CN] - ground[i + Math.max(0, j - 1) * CN]) / 2;
      rock[k] = ss(0.9, 1.4, Math.hypot(gx, gz));
    }
    const g = (x: number, z: number) => {
      const fx = Math.min(CN - 1.001, Math.max(0, (x - x0) / CELL)), fz = Math.min(CN - 1.001, Math.max(0, (z - z0) / CELL)), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = i + j * CN;
      return (ground[k] * (1 - u) + ground[k + 1] * u) * (1 - v) + (ground[k + CN] * (1 - u) + ground[k + CN + 1] * u) * v;
    };
    const slope = (x: number, z: number) => Math.hypot(g(x + 0.7, z) - g(x - 0.7, z), g(x, z + 0.7) - g(x, z - 0.7)) / 1.4;
    // ─── culms ───
    const culms: Culm[] = [], SP = 1.6;
    for (let a = 0; a < CHUNK / SP; a++) for (let b = 0; b < CHUNK / SP; b++) {
      const gi = ci * 1000 + a, gj = cj * 1000 + b;
      const x = x0 + (a + 0.5 + (u01(s, gi, gj, 1) - 0.5) * 0.9) * SP, z = z0 + (b + 0.5 + (u01(s, gi, gj, 2) - 0.5) * 0.9) * SP;
      const q = this.trailNear(x, z);
      if (q.d < HALF + 0.3 + u01(s, gi, gj, 3) * 0.4) continue;
      let keep = 0.62 + 0.45 * vnoise(x / 14, z / 14, s + 40);
      // (the grove's own runs: winding lanes where it's thin, the way through it)
      const lane = Math.abs(vnoise(x / 46, z / 46, s + 60) - 0.5), lane2 = Math.abs(vnoise(x / 31 + 7, z / 31, s + 61) - 0.5);
      keep *= 1 - 0.85 * (1 - ss(0.025, 0.06, Math.min(lane, lane2)));
      const sl = slope(x, z), c = cliff(x, z, s);
      if (sl > 0.9) continue; // (none on the rock)
      keep *= 1 - ss(0.45, 0.9, sl) * 0.7;
      // (over a cliff's rim, sparser: you see out)
      keep *= 1 - 0.6 * c.up * (1 - ss(0.618, 0.64, fbm(x / 150, z / 150, s + 50)));
      if (u01(s, gi, gj, 4) > keep) continue;
      const y = g(x, z), girth = u01(s, gi, gj, 5), r = 0.055 + girth * 0.04, h = 11 + girth * 8 + u01(s, gi, gj, 6) * 3;
      // (lean: down the fall of the ground a little, and out over a trail beside it)
      const fx = g(x + 1, z) - g(x - 1, z), fz = g(x, z + 1) - g(x, z - 1);
      let lx = -fx * 0.6 + (u01(s, gi, gj, 8) - 0.5) * 0.9, lz = -fz * 0.6 + (u01(s, gi, gj, 9) - 0.5) * 0.9;
      if (q.trail && q.d < 6) { const tx = q.trail.x[q.i] - x, tz = q.trail.z[q.i] - z, l = Math.hypot(tx, tz) || 1, k = (1 - q.d / 6) * (0.8 + u01(s, gi, gj, 10) * 1.4); lx += (tx / l) * k; lz += (tz / l) * k; }
      culms.push({ x, y, z, r, h, lx, lz, node: 0.26 + u01(s, gi, gj, 11) * 0.12, age: u01(s, gi, gj, 12), phase: u01(s, gi, gj, 13) * 6.283, pick: u01(s, gi, gj, 14), crown: 0.42 + u01(s, gi, gj, 15) * 0.18 });
    }
    const tall = culms.length;
    // ─── sprays: along the upper part of each culm ───
    const sprays: Spray[] = [];
    culms.forEach((c, k) => {
      for (let m = 0; m < 9; m++) {
        const f = c.crown + (1 - c.crown) * ((m + u01(s, ci, cj, k, m, 21)) / 9), a = u01(s, ci, cj, k, m, 22) * 6.283, out = 0.4 + u01(s, ci, cj, k, m, 23) * 1.3;
        sprays.push({ c: k, y: c.h * f, ox: Math.sin(a) * out, oz: Math.cos(a) * out, size: 0.7 + u01(s, ci, cj, k, m, 24) * 0.6, yaw: a + (u01(s, ci, cj, k, m, 25) - 0.5) * 1.2, tilt: (u01(s, ci, cj, k, m, 26) - 0.5) * 0.9, seed: u01(s, ci, cj, k, m, 27) });
      }
    });
    // ─── low greens: scattered through the grove, thicker along a trail's edges (each held by a hidden stub) ───
    for (let n = 0; n < 70; n++) {
      const x = x0 + u01(s, ci, cj, n, 60) * CHUNK, z = z0 + u01(s, ci, cj, n, 61) * CHUNK, q = this.trailNear(x, z);
      const p = q.d < HALF + 0.2 ? 0 : q.d < 4.5 ? 0.9 : 0.22;
      if (u01(s, ci, cj, n, 62) > p || slope(x, z) > 0.9) continue;
      const gy = g(x, z), a = u01(s, ci, cj, n, 64) * 6.283;
      culms.push({ x, y: gy - 3, z, r: 0, h: 3.2, lx: 0, lz: 0, node: 1, age: 0, phase: u01(s, ci, cj, n, 63) * 6.28, pick: 0, crown: 1 });
      const k = culms.length - 1;
      for (let m = 0; m < 2; m++) sprays.push({ c: k, y: 3.15 + u01(s, ci, cj, n, 65 + m) * 0.7, ox: Math.sin(a + m * 2) * 0.25, oz: Math.cos(a + m * 2) * 0.25, size: 0.35 + u01(s, ci, cj, n, 67 + m) * 0.3, yaw: a + m * 1.7, tilt: (u01(s, ci, cj, n, 69 + m) - 0.5) * 1.2, seed: u01(s, ci, cj, n, 71 + m) });
    }
    // ─── stones: under cliffs (fallen), at the foot of a trail's bank, now and then anywhere ───
    const stones: Stone[] = [];
    for (let n = 0; n < 26; n++) {
      const x = x0 + u01(s, ci, cj, n, 40) * CHUNK, z = z0 + u01(s, ci, cj, n, 41) * CHUNK, q = this.trailNear(x, z), sl = slope(x, z);
      const p = sl > 0.5 ? 0.5 : q.d > HALF + 0.4 && q.d < 4 ? 0.45 : 0.06;
      if (u01(s, ci, cj, n, 42) > p || q.d < HALF + 0.5) continue;
      const r = 0.25 + u01(s, ci, cj, n, 43) ** 2 * 1.4;
      stones.push({ x, y: g(x, z) - r * 0.35, z, r, yaw: u01(s, ci, cj, n, 44) * 6.283, flat: 0.55 + u01(s, ci, cj, n, 45) * 0.35, kind: Math.floor(u01(s, ci, cj, n, 46) * 4), moss: u01(s, ci, cj, n, 47) });
    }
    // ─── the steps of any trail whose stair is in this chunk ───
    const steps: Step[] = [];
    const seen = new Set<string>();
    for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) {
      const ri = Math.floor((x0 + a * CHUNK) / REGION), rj = Math.floor((z0 + b * CHUNK) / REGION);
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (const t of this.trails(ri + da, rj + db)) {
        if (seen.has(t.id)) continue; seen.add(t.id);
        for (const st of t.steps) if (st.x >= x0 && st.x < x0 + CHUNK && st.z >= z0 && st.z < z0 + CHUNK) steps.push(st);
      }
    }
    return { ci, cj, x0, z0, ground, near, rock, culms, tall, sprays, stones, steps };
  }
}

export interface Culm { x: number; y: number; z: number; r: number; h: number; lx: number; lz: number; node: number; age: number; phase: number; pick: number; crown: number }
export interface Spray { c: number; y: number; ox: number; oz: number; size: number; yaw: number; tilt: number; seed: number }
export interface Stone { x: number; y: number; z: number; r: number; yaw: number; flat: number; kind: number; moss: number }
export interface Chunk {
  ci: number; cj: number; x0: number; z0: number;
  /** the ground's heights, how far each point is from a trail, how much it's rock */
  ground: Float32Array; near: Float32Array; rock: Float32Array;
  /** the culms (the first `tall` of them real; the rest hidden stubs holding low greens), their sprays, stones, steps */
  culms: Culm[]; tall: number; sprays: Spray[]; stones: Stone[]; steps: Step[];
}

/** the far ranges, all round about (drawn as a backdrop that keeps its distance): each a jagged line, one behind another */
export function ridges(seed: number): { x: number; z: number; y: number }[][] {
  const out: { x: number; z: number; y: number }[][] = [];
  for (let r = 0; r < 4; r++) {
    const R = 700 + r * 320, line: { x: number; z: number; y: number }[] = [];
    for (let a = 0; a <= 360; a += 1.2 + r * 0.4) {
      const t = (a * Math.PI) / 180, n = vnoise(a / (9 + r * 3), r * 3.7, seed + 90 + r), m = vnoise(a / 2.5, r * 1.3, seed + 120 + r);
      line.push({ x: Math.cos(t) * R, z: Math.sin(t) * R, y: -60 + 50 * r + n * (90 + r * 60) + m * 16 });
    }
    out.push(line);
  }
  return out;
}
