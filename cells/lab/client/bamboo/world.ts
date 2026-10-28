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
  // (long ridges and the valleys between, steep-sided: a wild mountain's, not a downland's)
  let y = (fbm(x / 420, z / 420, seed) - 0.5) * 150 + (fbm(x / 95, z / 95, seed + 3) - 0.5) * 60 + (fbm(x / 22, z / 22, seed + 5) - 0.5) * 3.2;
  const c = cliff(x, z, seed);
  return y + c.up * c.h;
}

// ─── the trails ───
/** a stone step: its range along its trail, its front edge, which way it faces (up), its top, how deep, wide, tall */
export interface Step { sa: number; sb: number; x: number; z: number; dx: number; dz: number; y: number; depth: number; width: number; drop: number; seed: number }
export interface Trail { id: string; x: Float32Array; z: Float32Array; y: Float32Array; stair: Uint8Array; length: number; steps: Step[]; boulders: { x: number; z: number; r: number }[] }
const DS = 1;

/**
 * The way a trail goes from a to b over the land, as one's worn by feet that would rather not climb: the cheapest way
 * over a 4 m grid, where each step costs its length and much more for its grade, so it keeps to the contour, bends
 * where the land does, and takes a slope on only where it must (a flight of steps, then). Smoothed, so it isn't the
 * grid's.
 */
function route(a: V2, b: V2, seed: number, box: [number, number, number, number]): V2[] {
  const G = 4, [x0, z0, x1, z1] = box, nx = Math.ceil((x1 - x0) / G) + 1, nz = Math.ceil((z1 - z0) / G) + 1, N = nx * nz;
  const H = new Float32Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * G, z = z0 + j * G;
    // (a little wander of its own, so two trails over the same slope don't run as one)
    H[i + j * nx] = base(x, z, seed) + (vnoise(x / 9, z / 9, seed + 90) - 0.5) * 0.6;
  }
  const idx = (p: V2) => Math.min(nx - 1, Math.max(0, Math.round((p[0] - x0) / G))) + Math.min(nz - 1, Math.max(0, Math.round((p[1] - z0) / G))) * nx;
  const start = idx(a), goal = idx(b), gx = goal % nx, gz = Math.floor(goal / nx);
  const cost = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const heap: number[] = [], key: number[] = [];
  const push = (n: number, k: number) => { heap.push(n); key.push(k); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (key[p] <= key[c]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; [key[p], key[c]] = [key[c], key[p]]; c = p; } };
  const pop = () => { const n = heap[0], last = heap.pop()!, lk = key.pop()!; if (heap.length) { heap[0] = last; key[0] = lk; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && key[l] < key[m]) m = l; if (r < heap.length && key[r] < key[m]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; [key[m], key[c]] = [key[c], key[m]]; c = m; } } return n; };
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
  cost[start] = 0; push(start, 0);
  while (heap.length) {
    const n = pop(); if (done[n]) continue; done[n] = 1;
    if (n === goal) break;
    const ci = n % nx, cj = Math.floor(n / nx);
    for (const [di, dj] of D) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const m = i + j * nx, len = Math.hypot(di, dj) * G, grade = Math.abs(H[m] - H[n]) / len;
      const c = cost[n] + len * (1 + 140 * grade * grade + (grade > 0.25 ? 60 * (grade - 0.25) : 0));
      if (c < cost[m]) { cost[m] = c; from[m] = n; push(m, c + Math.hypot(i - gx, j - gz) * G); }
    }
  }
  let path: V2[] = [];
  for (let n = goal; n >= 0; n = from[n]) path.push([x0 + (n % nx) * G, z0 + Math.floor(n / nx) * G]);
  path.reverse();
  path[0] = a; path[path.length - 1] = b;
  // (smoothed: corners cut a few times over, the ends kept)
  for (let it = 0; it < 3; it++) {
    const q: V2[] = [path[0]];
    for (let k = 0; k < path.length - 1; k++) { const [p0, p1] = [path[k], path[k + 1]]; q.push([p0[0] * 0.75 + p1[0] * 0.25, p0[1] * 0.75 + p1[1] * 0.25], [p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75]); }
    q.push(path[path.length - 1]); path = q;
  }
  // (thinned to every few metres, for laying)
  const out: V2[] = [path[0]];
  for (const p of path) if (Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 3) out.push(p);
  out.push(path[path.length - 1]);
  return out;
}

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
    const box: [number, number, number, number] = [i * REGION - 24, j * REGION - 24, (i + 1) * REGION + 24, (j + 1) * REGION + 24];
    if (ends.length >= 1) ends.forEach((e, k) => {
      // (from the edge to the meeting place, the way feet would go)
      out.push(this.make(`${key}:${k}`, lay(route(e, C, s, box), DS)));
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
    const steps: Step[] = [], boulders: { x: number; z: number; r: number }[] = [];
    const lerp = (q: number) => { const f = Math.min(n - 1.001, Math.max(0, q / DS)), i = Math.floor(f), t = f - i; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, y[i] + (y[i + 1] - y[i]) * t]; };
    for (let i = 0; i < n; ) {
      if (!stair[i]) { i++; continue; }
      let j = i; while (j < n - 1 && stair[j + 1]) j++;
      // (a flight that turns, turns round something: a boulder on the inside of its bend, the reason it bends)
      let most = 0, at = -1, side = 0;
      for (let k = Math.max(1, i); k <= Math.min(n - 2, j); k++) {
        const ax = pts[k][0] - pts[k - 1][0], az = pts[k][1] - pts[k - 1][1], bx = pts[Math.min(n - 1, k + 3)][0] - pts[k][0], bz = pts[Math.min(n - 1, k + 3)][1] - pts[k][1];
        const cr = (ax * bz - az * bx) / ((Math.hypot(ax, az) || 1) * (Math.hypot(bx, bz) || 1));
        if (Math.abs(cr) > most) { most = Math.abs(cr); at = k; side = Math.sign(cr); }
      }
      if (at >= 0 && most > 0.12) {
        const dx = pts[at + 1][0] - pts[at - 1][0], dz = pts[at + 1][1] - pts[at - 1][1], l = Math.hypot(dx, dz) || 1, r = 1.3 + u01(s, i, 83) * 0.9;
        // (the inside of the bend: the side the way turns toward)
        const lx = (dz / l) * side, lz = (-dx / l) * side, off = HALF * 0.9 + r * 0.75;
        boulders.push({ x: pts[at][0] - lx * off, z: pts[at][1] - lz * off, r });
      }
      const s0 = i * DS, s1 = j * DS, count = Math.max(1, Math.round((s1 - s0) / TREAD)), up = y[j] > y[i] ? 1 : -1;
      for (let k = 0; k < count; k++) {
        const sa = s0 + ((s1 - s0) * k) / count, sb = s0 + ((s1 - s0) * (k + 1)) / count;
        const lo = lerp(up > 0 ? sa : sb), hi = lerp(up > 0 ? sb : sa), dx = hi[0] - lo[0], dz = hi[1] - lo[1], l = Math.hypot(dx, dz) || 1;
        const jx = (u01(s, k, i, 78) - 0.5) * 0.3, ja = (u01(s, k, i, 79) - 0.5) * 0.28, ca = Math.cos(ja), sa2 = Math.sin(ja), ux = dx / l, uz = dz / l;
        steps.push({ sa, sb, x: lo[0] - uz * jx, z: lo[1] + ux * jx, dx: ux * ca + uz * sa2, dz: uz * ca - ux * sa2, y: hi[2] + (u01(s, k, i, 80) - 0.5) * 0.06, depth: (sb - sa) * (1.02 + u01(s, k, i, 82) * 0.2), width: HALF * 1.7 * (0.72 + u01(s, k, i, 77) * 0.45), drop: Math.abs(hi[2] - lo[2]) + 0.9, seed: u01(s, k, i, 81) });
      }
      i = j + 1;
    }
    return { id, x: Float32Array.from(pts.map((p) => p[0])), z: Float32Array.from(pts.map((p) => p[1])), y, stair, length: (n - 1) * DS, steps, boulders };
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
  /** the land at (x, z) before any trail's cut into it */
  base(x: number, z: number): number { return base(x, z, this.seed); }
  /** the trails that could cross the chunk at (x0, z0) */
  trailsAround(x0: number, z0: number): Trail[] {
    const out: Trail[] = [], seen = new Set<string>();
    for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) {
      const ri = Math.floor((x0 + a * CHUNK) / REGION), rj = Math.floor((z0 + b * CHUNK) / REGION);
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (const t of this.trails(ri + da, rj + db)) if (!seen.has(t.id)) { seen.add(t.id); out.push(t); }
    }
    return out;
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
    // ─── culms: in stands, as a grove grows from its runners: clumps of a few to a dozen or more, each of an age, with
    // open floor between them; thicker toward the middle of a stand; now and then one old giant standing over a trail ───
    const culms: Culm[] = [], CELLS = 4.6;
    const sa0 = Math.floor(x0 / CELLS) - 1, sa1 = Math.floor((x0 + CHUNK) / CELLS) + 1, sb0 = Math.floor(z0 / CELLS) - 1, sb1 = Math.floor((z0 + CHUNK) / CELLS) + 1;
    for (let sa = sa0; sa <= sa1; sa++) for (let sb = sb0; sb <= sb1; sb++) {
      const cx = (sa + 0.2 + u01(s, sa, sb, 1) * 0.6) * CELLS, cz = (sb + 0.2 + u01(s, sa, sb, 2) * 0.6) * CELLS;
      // (how thick the grove is here: in drifts across the mountain, thinning in its own runs)
      let dense = 0.62 + 0.6 * vnoise(cx / 22, cz / 22, s + 40);
      const lane = Math.abs(vnoise(cx / 46, cz / 46, s + 60) - 0.5), lane2 = Math.abs(vnoise(cx / 31 + 7, cz / 31, s + 61) - 0.5);
      dense *= 1 - 0.8 * (1 - ss(0.03, 0.07, Math.min(lane, lane2)));
      if (u01(s, sa, sb, 3) > dense) continue;
      const R = 1.4 + u01(s, sa, sb, 4) * 1.9, n = 5 + Math.floor(u01(s, sa, sb, 5) * 12 * dense), standAge = u01(s, sa, sb, 6);
      const placed: [number, number][] = [];
      for (let m = 0; m < n * 3 && placed.length < n; m++) {
        const ang = u01(s, sa, sb, m, 7) * 6.283, rr = R * Math.sqrt(u01(s, sa, sb, m, 8));
        const x = cx + Math.cos(ang) * rr, z = cz + Math.sin(ang) * rr;
        if (placed.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 0.55 * 0.55)) continue;
        placed.push([x, z]);
        if (x < x0 || x >= x0 + CHUNK || z < z0 || z >= z0 + CHUNK) continue;
        const gi = sa * 977 + m, gj = sb * 991 + m;
        const q = this.trailNear(x, z);
        if (q.d < HALF + 0.2 + u01(s, gi, gj, 3) * 0.3) continue;
        // (by a trail, the hillside's own slope, not its cut bank's: culms stand on the bank, right at the path's edge)
        const sl = q.d < 6 ? Math.hypot(this.base(x + 0.7, z) - this.base(x - 0.7, z), this.base(x, z + 0.7) - this.base(x, z - 0.7)) / 1.4 : slope(x, z), c = cliff(x, z, s);
        if (sl > 1.05) continue; // (none on the rock)
        let keep = 1 - ss(0.6, 1.05, sl) * 0.6;
        // (below a trail, where the hill falls away, thinner: the way looks out between them; above it, the bank's thick)
        if (q.trail && q.d < 11 && g(x, z) < q.trail.y[q.i] - 0.5) keep *= 0.3 + 0.5 * (q.d / 11);
        // (over a cliff's rim, sparser: you see out)
        keep *= 1 - 0.6 * c.up * (1 - ss(0.618, 0.64, fbm(x / 150, z / 150, s + 50)));
        if (u01(s, gi, gj, 4) > keep) continue;
        // (girth: a stand's middle stoutest; and now and then a giant beside a trail, the one the eye goes to)
        const mid = 1 - rr / R, hero = q.d < 5 && u01(s, gi, gj, 16) < 0.3;
        const girth = hero ? 1 : Math.min(1, u01(s, gi, gj, 5) * 0.7 + mid * 0.4);
        const y = g(x, z), r = hero ? 0.1 + u01(s, gi, gj, 17) * 0.015 : 0.05 + girth * 0.04, h = hero ? 20 + u01(s, gi, gj, 6) * 4 : 10 + girth * 9 + u01(s, gi, gj, 6) * 3;
        // (lean: down the fall of the ground a little, out from the stand's middle, and out over a trail beside it)
        const fx = g(x + 1, z) - g(x - 1, z), fz = g(x, z + 1) - g(x, z - 1), ox = x - cx, oz = z - cz, ol = Math.hypot(ox, oz) || 1;
        let lx = -fx * 0.6 + (ox / ol) * 0.5 * (1 - mid) + (u01(s, gi, gj, 8) - 0.5) * 0.7, lz = -fz * 0.6 + (oz / ol) * 0.5 * (1 - mid) + (u01(s, gi, gj, 9) - 0.5) * 0.7;
        if (q.trail && q.d < 6) { const tx = q.trail.x[q.i] - x, tz = q.trail.z[q.i] - z, l = Math.hypot(tx, tz) || 1, k = (1 - q.d / 6) * (0.8 + u01(s, gi, gj, 10) * 1.4); lx += (tx / l) * k; lz += (tz / l) * k; }
        const age = Math.min(1, Math.max(0, standAge + (u01(s, gi, gj, 12) - 0.5) * 0.5));
        culms.push({ x, y, z, r, h, lx, lz, node: 0.26 + u01(s, gi, gj, 11) * 0.12 + (hero ? 0.06 : 0), age, phase: u01(s, gi, gj, 13) * 6.283, pick: hero ? u01(s, gi, gj, 14) * 0.3 : u01(s, gi, gj, 14), crown: 0.42 + u01(s, gi, gj, 15) * 0.18 });
      }
    }
    const tall = culms.length;
    // ─── sprays: along the upper part of each culm ───
    const sprays: Spray[] = [];
    culms.forEach((c, k) => {
      for (let m = 0; m < 12; m++) {
        const f = c.crown + (1 - c.crown) * Math.sqrt((m + u01(s, ci, cj, k, m, 21)) / 12), a = u01(s, ci, cj, k, m, 22) * 6.283, out = 0.4 + u01(s, ci, cj, k, m, 23) * 1.3;
        sprays.push({ c: k, y: c.h * f, ox: Math.sin(a) * out, oz: Math.cos(a) * out, size: 0.75 + u01(s, ci, cj, k, m, 24) * 0.75, yaw: a + (u01(s, ci, cj, k, m, 25) - 0.5) * 1.2, tilt: (u01(s, ci, cj, k, m, 26) - 0.5) * 0.9, seed: u01(s, ci, cj, k, m, 27) });
      }
    });
    // ─── low greens: scattered through the grove, thicker along a trail's edges (each held by a hidden stub) ───
    for (let n = 0; n < 45; n++) {
      const x = x0 + u01(s, ci, cj, n, 60) * CHUNK, z = z0 + u01(s, ci, cj, n, 61) * CHUNK, q = this.trailNear(x, z);
      const p = q.d < HALF + 0.2 ? 0 : q.d < 4.5 ? 0.6 : 0.2;
      if (u01(s, ci, cj, n, 62) > p || slope(x, z) > 0.9) continue;
      const gy = g(x, z), a = u01(s, ci, cj, n, 64) * 6.283;
      culms.push({ x, y: gy - 3, z, r: 0, h: 3.2, lx: 0, lz: 0, node: 1, age: 0, phase: u01(s, ci, cj, n, 63) * 6.28, pick: 0, crown: 1 });
      const k = culms.length - 1;
      for (let m = 0; m < 2; m++) sprays.push({ c: k, y: 3.15 + u01(s, ci, cj, n, 65 + m) * 0.7, ox: Math.sin(a + m * 2) * 0.25, oz: Math.cos(a + m * 2) * 0.25, size: 0.4 + u01(s, ci, cj, n, 67 + m) * 0.5, yaw: a + m * 1.7, tilt: (u01(s, ci, cj, n, 69 + m) - 0.5) * 1.2, seed: u01(s, ci, cj, n, 71 + m) });
    }
    // ─── stones: under cliffs (fallen), at the foot of a trail's bank, now and then anywhere ───
    const stones: Stone[] = [];
    for (let n = 0; n < 48; n++) {
      const x = x0 + u01(s, ci, cj, n, 40) * CHUNK, z = z0 + u01(s, ci, cj, n, 41) * CHUNK, q = this.trailNear(x, z), sl = slope(x, z);
      // (a trail's sides are stony: its bank breaks out in rock, stones lie along its edge)
      const p = sl > 0.5 ? 0.45 : q.d > HALF + 0.3 && q.d < 4.5 ? 0.7 : 0.05;
      if (u01(s, ci, cj, n, 42) > p || q.d < HALF + 0.35) continue;
      const r = 0.22 + u01(s, ci, cj, n, 43) ** 2 * (q.d < 4.5 ? 1.2 : 1.4);
      stones.push({ x, y: g(x, z) - r * 0.35, z, r, yaw: u01(s, ci, cj, n, 44) * 6.283, flat: 0.55 + u01(s, ci, cj, n, 45) * 0.35, kind: Math.floor(u01(s, ci, cj, n, 46) * 4), moss: u01(s, ci, cj, n, 47) });
    }
    // ─── the steps of any trail whose stair is in this chunk; and boulders along a flight, as one's cut through them ───
    const steps: Step[] = [];
    for (const t of this.trailsAround(x0, z0)) for (const b of t.boulders) if (b.x >= x0 && b.x < x0 + CHUNK && b.z >= z0 && b.z < z0 + CHUNK) {
      stones.push({ x: b.x, y: g(b.x, b.z) - b.r * 0.25, z: b.z, r: b.r, yaw: b.x * 0.7, flat: 0.85, kind: 1, moss: 0.8 });
    }
    for (const t of this.trailsAround(x0, z0)) for (const st of t.steps) if (st.x >= x0 && st.x < x0 + CHUNK && st.z >= z0 && st.z < z0 + CHUNK) {
      steps.push(st);
      if (st.seed > 0.3) continue;
      const side = st.seed < 0.15 ? 1 : -1, lx = -st.dz * side, lz = st.dx * side, off = st.width / 2 + 0.35 + st.seed * 3, r = 0.45 + st.seed * 3.5;
      const x = st.x + lx * (off + r * 0.6), z = st.z + lz * (off + r * 0.6);
      stones.push({ x, y: Math.max(g(x, z), st.y) - r * 0.3, z, r, yaw: st.seed * 40, flat: 0.6 + st.seed, kind: 1, moss: 0.4 + st.seed });
    }
    // ─── roots across a trail now and then, from the bank side, half in the earth, worn on top ───
    const roots: Root[] = [];
    for (const t of this.trailsAround(x0, z0)) {
      for (let k = 2; k < t.x.length - 2; k++) {
        if (t.stair[k] || t.x[k] < x0 || t.x[k] >= x0 + CHUNK || t.z[k] < z0 || t.z[k] >= z0 + CHUNK) continue;
        if (u01(s, Math.round(t.x[k] * 3), Math.round(t.z[k] * 3), 90) > 0.075) continue;
        const dx = t.x[k + 1] - t.x[k - 1], dz = t.z[k + 1] - t.z[k - 1], l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
        // (which side's uphill: it comes from there)
        const up = this.base(t.x[k] - uz * 3, t.z[k] + ux * 3) > this.base(t.x[k] + uz * 3, t.z[k] - ux * 3) ? 1 : -1;
        const a = u01(s, k, Math.round(t.x[k]), 91), len = 1.5 + a * 1.6, r = 0.045 + u01(s, k, Math.round(t.z[k]), 92) * 0.05;
        const ang = Math.atan2(-uz * up, ux * up) + (a - 0.5) * 0.9, off = (u01(s, k, 93) - 0.5) * 0.5;
        const x = t.x[k] - uz * up * off, z = t.z[k] + ux * up * off;
        roots.push({ x, y: g(x, z) - r * 0.35, z, yaw: ang, r, len, moss: u01(s, k, 94) });
      }
    }
    return { ci, cj, x0, z0, ground, near, rock, culms, tall, sprays, stones, steps, roots };
  }
}

export interface Culm { x: number; y: number; z: number; r: number; h: number; lx: number; lz: number; node: number; age: number; phase: number; pick: number; crown: number }
export interface Spray { c: number; y: number; ox: number; oz: number; size: number; yaw: number; tilt: number; seed: number }
export interface Stone { x: number; y: number; z: number; r: number; yaw: number; flat: number; kind: number; moss: number }
/** a root across a trail: its middle, which way it runs, how thick, how long */
export interface Root { x: number; y: number; z: number; yaw: number; r: number; len: number; moss: number }
export interface Chunk {
  ci: number; cj: number; x0: number; z0: number;
  /** the ground's heights, how far each point is from a trail, how much it's rock */
  ground: Float32Array; near: Float32Array; rock: Float32Array;
  /** the culms (the first `tall` of them real; the rest hidden stubs holding low greens), their sprays, stones, steps */
  culms: Culm[]; tall: number; sprays: Spray[]; stones: Stone[]; steps: Step[]; roots: Root[];
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
