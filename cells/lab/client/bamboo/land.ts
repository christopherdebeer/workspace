/**
 * The mountain and its ways (no drawing here: the renderer and the grove read this).
 *
 * - **the slope**: a mountainside rising to the east (+x) at about one in two and a half, rumpled; to the west it breaks
 *   over an edge and falls steeply into the valley. The edge comes close in to the lower way along one stretch (where the
 *   grove thins and the valley opens) and stands well back elsewhere;
 * - **the ways**: a loop of paths over it, laid as a few control points each and walked as a graph (`Way`, `NODES`):
 *   the lower track along the contour with the valley on its left; a stone stair climbing the slope to a fork; from the
 *   fork, straight up more stairs, or round by an earth track dipping through a gully, both meeting again above; the
 *   upper track back along a higher contour, deep in the grove; and a long flight down to where it started;
 * - **the ground**: the slope, with each way cut into it as a bench, the bank rising on its uphill side and falling away
 *   below, the path's bed a little sunk; the stairs' ramp under their slabs (the slabs are `Way.steps`).
 *
 * Everything is in metres; y is up.
 */
import { hash } from '../kit/rng';

export type V2 = [number, number];

/** the land's extent (the ground's grid) */
export const X0 = -90, X1 = 110, Z0 = -60, Z1 = 260, CELL = 1;
export const NX = Math.round((X1 - X0) / CELL) + 1, NZ = Math.round((Z1 - Z0) / CELL) + 1;
/** a path's half width, and how far its banks run before the slope takes over */
export const HALF = 0.95, BANK = 2.6;
/** a stair's tread, along the way */
export const TREAD = 0.42;

const u01 = (i: number, j: number, s: number) => hash(i, j, s) / 4294967296;
/** smooth value noise, 0..1 */
export function vnoise(x: number, z: number, s = 1): number {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = u01(i, j, s), b = u01(i + 1, j, s), c = u01(i, j + 1, s), d = u01(i + 1, j + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
const fbm = (x: number, z: number, s: number) => vnoise(x, z, s) * 0.55 + vnoise(x * 2.1, z * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, z * 4.3, s + 13) * 0.15;
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** where the slope breaks over into the valley (x, along z): close in to the lower way about z 60–95 */
export const edgeX = (z: number) => -32 + 25 * Math.exp(-(((z - 78) / 26) ** 2));
/** the slope as it lies, before any way is cut into it */
export function base(x: number, z: number, seed = 1): number {
  let y = 0.42 * x + (fbm(x / 38, z / 38, seed) - 0.5) * 7 + (fbm(x / 9, z / 9, seed + 3) - 0.5) * 1.2;
  // (a gully down the slope that the earth track dips through)
  y -= 4.5 * Math.exp(-(((x - 15) / 7) ** 2)) * ss(150, 170, z) * (1 - ss(195, 215, z));
  const e = edgeX(z);
  if (x < e) y -= (e - x) * 0.95 + (e - x) ** 2 * 0.004;
  return y;
}

/** a junction of the ways */
export const NODES: Record<string, V2> = { start: [0, 0], foot: [0, 118], fork: [26, 152], meet: [42, 196], turn: [45, 30] };
/** each way: its ends (nodes) and the points it's laid through; `kind` what it's made of */
const PLAN: { a: string; b: string; kind: 'earth' | 'stone'; pts: V2[]; name: string }[] = [
  { a: 'start', b: 'foot', kind: 'earth', name: 'the lower track', pts: [[0, 0], [-2.5, 28], [1, 52], [-1.5, 78], [1.5, 100], [0, 118]] },
  { a: 'foot', b: 'fork', kind: 'stone', name: 'the stair up', pts: [[0, 118], [5, 127], [13, 136], [21, 145], [26, 152]] },
  { a: 'fork', b: 'meet', kind: 'stone', name: 'the stair straight up', pts: [[26, 152], [31, 165], [36, 179], [42, 196]] },
  { a: 'fork', b: 'meet', kind: 'earth', name: 'the track round the gully', pts: [[26, 152], [17, 164], [13, 180], [19, 197], [31, 206], [42, 196]] },
  { a: 'meet', b: 'turn', kind: 'earth', name: 'the upper track', pts: [[42, 196], [46, 170], [43, 140], [47, 105], [43, 70], [45, 30]] },
  { a: 'turn', b: 'start', kind: 'stone', name: 'the long stair down', pts: [[45, 30], [37, 17], [25, 7], [12, -3], [0, 0]] },
];

/** a stone step: its front edge's middle, which way it faces (up the stair), its top, how deep and wide */
export interface Step { sa: number; sb: number; x: number; z: number; dx: number; dz: number; y: number; depth: number; width: number; drop: number }
export interface Way {
  id: number; a: string; b: string; kind: 'earth' | 'stone'; name: string;
  /** samples every half metre: x, z, y (the bed), along (s), and whether it's stair there */
  x: Float32Array; z: Float32Array; y: Float32Array; s: Float32Array; stair: Uint8Array; length: number;
  steps: Step[];
}

/** centripetal Catmull-Rom through the points, then resampled every `ds` metres */
function lay(pts: V2[], ds: number): V2[] {
  const P = [pts[0], ...pts, pts[pts.length - 1]], dense: V2[] = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let k = 0; k < 40; k++) {
      const t = k / 40, t2 = t * t, t3 = t2 * t;
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
  const last = dense[dense.length - 1], prev = out[out.length - 1];
  if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) > ds * 0.3) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

export interface Land {
  seed: number; ways: Way[];
  /** the ground's heights, on the grid */
  ground: Float32Array;
  /** per grid point: how far to the nearest way's centre line (capped), which way, which sample */
  near: Float32Array; nearWay: Int16Array; nearAt: Int32Array;
  groundAt: (x: number, z: number) => number;
  /** how far (x, z) is from the nearest way, and that way's sample there */
  wayNear: (x: number, z: number) => { d: number; way: number; i: number };
}

const DS = 0.5;
export function makeLand(seed = 1): Land {
  // ─── the ways: laid, their beds' heights found from the slope (smoothed, so a way doesn't follow every rumple), the
  // stairs where they climb steeply; the ends of ways meeting at a node agree on its height ───
  const nodeY: Record<string, number> = {};
  for (const [k, [x, z]] of Object.entries(NODES)) nodeY[k] = base(x, z, seed);
  const ways: Way[] = PLAN.map((p, id) => {
    const pts = lay(p.pts, DS), n = pts.length, raw = new Float32Array(n), y = new Float32Array(n), s = new Float32Array(n);
    for (let i = 0; i < n; i++) { raw[i] = base(pts[i][0], pts[i][1], seed); s[i] = i * DS; }
    // (a long moving average, then pinned to the nodes' heights at the ends)
    const W = 24;
    for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let k = -W; k <= W; k++) { const j = Math.min(n - 1, Math.max(0, i + k)); a += raw[j]; c++; } y[i] = a / c; }
    const ya = nodeY[p.a] - y[0], yb = nodeY[p.b] - y[n - 1];
    for (let i = 0; i < n; i++) { const t = i / (n - 1); y[i] += ya * (1 - t) + yb * t; }
    const stair = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const j0 = Math.max(0, i - 4), j1 = Math.min(n - 1, i + 4); if (Math.abs(y[j1] - y[j0]) / ((j1 - j0) * DS) > 0.13 && p.kind === 'stone') stair[i] = 1; }
    // (the steps: each tread flat, at the height of its upper end, its front edge at its lower end; laid along every
    // stretch of stair, so the bed under it is the ramp they sit on)
    const steps: Step[] = [];
    const lerp = (q: number) => { const f = Math.min(n - 1.001, Math.max(0, q / DS)), i = Math.floor(f), t = f - i; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, y[i] + (y[i + 1] - y[i]) * t]; };
    for (let i = 0; i < n; ) {
      if (!stair[i]) { i++; continue; }
      let j = i; while (j < n - 1 && stair[j + 1]) j++;
      const s0 = s[i], s1 = s[j], count = Math.max(1, Math.round((s1 - s0) / TREAD)), up = y[j] > y[i] ? 1 : -1;
      for (let k = 0; k < count; k++) {
        const sa = s0 + ((s1 - s0) * k) / count, sb = s0 + ((s1 - s0) * (k + 1)) / count;
        const lo = lerp(up > 0 ? sa : sb), hi = lerp(up > 0 ? sb : sa), dx = hi[0] - lo[0], dz = hi[1] - lo[1], l = Math.hypot(dx, dz) || 1;
        // (each stone laid by hand: a little off line, a little turned, its top not quite level with the next)
        const jx = (u01(id, k, 78) - 0.5) * 0.14, ja = (u01(id, k, 79) - 0.5) * 0.12, ca = Math.cos(ja), sa2 = Math.sin(ja);
        const ux = dx / l, uz = dz / l;
        steps.push({ sa, sb, x: lo[0] - uz * jx, z: lo[1] + ux * jx, dx: ux * ca + uz * sa2, dz: uz * ca - ux * sa2, y: hi[2] + (u01(id, k, 80) - 0.5) * 0.03, depth: (sb - sa) * 1.06, width: HALF * 1.6 * (0.9 + u01(id, k, 77) * 0.2), drop: Math.abs(hi[2] - lo[2]) + 0.25 });
      }
      i = j + 1;
    }
    return { id, a: p.a, b: p.b, kind: p.kind, name: p.name, x: Float32Array.from(pts.map((q) => q[0])), z: Float32Array.from(pts.map((q) => q[1])), y, s, stair, length: s[n - 1], steps };
  });

  // ─── what's near each grid point: the nearest sample of any way (through a coarse bucket grid) ───
  const B = 8, bx = Math.ceil((X1 - X0) / B) + 1, bucket: number[][] = Array.from({ length: bx * (Math.ceil((Z1 - Z0) / B) + 1) }, () => []);
  for (const w of ways) for (let i = 0; i < w.x.length; i++) bucket[Math.floor((w.x[i] - X0) / B) + Math.floor((w.z[i] - Z0) / B) * bx].push(w.id, i);
  const wayNear = (x: number, z: number) => {
    const cx = Math.floor((x - X0) / B), cz = Math.floor((z - Z0) / B);
    let best = 1e9, bw = -1, bi = -1;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const k = cx + a + (cz + b) * bx; if (cx + a < 0 || cx + a >= bx || k < 0 || k >= bucket.length) continue;
      const L = bucket[k];
      for (let m = 0; m < L.length; m += 2) { const w = ways[L[m]], i = L[m + 1], d = (w.x[i] - x) ** 2 + (w.z[i] - z) ** 2; if (d < best) { best = d; bw = L[m]; bi = i; } }
    }
    return { d: bw < 0 ? 99 : Math.sqrt(best), way: bw, i: bi };
  };
  const ground = new Float32Array(NX * NZ), near = new Float32Array(NX * NZ), nearWay = new Int16Array(NX * NZ), nearAt = new Int32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = X0 + i * CELL, z = Z0 + j * CELL, k = i + j * NX, b = base(x, z, seed), q = wayNear(x, z);
    near[k] = q.d; nearWay[k] = q.way; nearAt[k] = q.i;
    if (q.way < 0) { ground[k] = b; continue; }
    // (the bench: the bed flat and a little sunk across the path, then the bank up to the slope or the fall away from it)
    const yp = ways[q.way].y[q.i] - 0.06, t = ss(HALF, HALF + BANK + Math.abs(b - yp) * 0.25, q.d);
    ground[k] = yp + (b - yp) * t;
  }
  const groundAt = (x: number, z: number) => {
    const fx = Math.min(NX - 1.001, Math.max(0, (x - X0) / CELL)), fz = Math.min(NZ - 1.001, Math.max(0, (z - Z0) / CELL));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = i + j * NX;
    return (ground[k] * (1 - u) + ground[k + 1] * u) * (1 - v) + (ground[k + NX] * (1 - u) + ground[k + NX + 1] * u) * v;
  };
  return { seed, ways, ground, near, nearWay, nearAt, groundAt, wayNear };
}

/** a way's position and heading at a distance along it (clamped), with the bed's height there (a stair's tread flat) */
export function along(w: Way, s: number): { x: number; z: number; y: number; dx: number; dz: number; stair: boolean } {
  const f = Math.min(w.x.length - 1.001, Math.max(0, s / DS)), i = Math.floor(f), t = f - i;
  const x = w.x[i] + (w.x[i + 1] - w.x[i]) * t, z = w.z[i] + (w.z[i + 1] - w.z[i]) * t;
  let y = w.y[i] + (w.y[i + 1] - w.y[i]) * t;
  const stair = !!w.stair[i];
  if (stair) {
    // (on a stair, the height of the tread underfoot)
    for (const st of w.steps) if (s >= st.sa && s < st.sb) { y = st.y; break; }
  }
  const dx = w.x[i + 1] - w.x[i], dz = w.z[i + 1] - w.z[i], l = Math.hypot(dx, dz) || 1;
  return { x, z, y, dx: dx / l, dz: dz / l, stair };
}
