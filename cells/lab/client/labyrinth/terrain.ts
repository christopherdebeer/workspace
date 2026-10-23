/**
 * The land as it's drawn and walked (after the phone, "more blocky than before", and the review with it): continuous
 * land first, construction accommodated where it stands. Not a terrace on every cell with a skirt round it; a hillside,
 * its slopes, ridges and hollows, and only where something's built a bench let into it.
 *
 * - **The hill**: the columns' levels (land.ts: the rise, the ravine, the stream's bed) read as a smooth surface, each
 *   cell's level blended with those round it through a broad kernel and moved a little by noise, so a step of a level
 *   between two stretches of ground is a slope, a ravine a valley, an outcrop a knoll. The grid's still what's built on
 *   and what connects; the land no longer shows it.
 * - **Benches**: where something's built (on a cell, against it, a wall holding its bank, a way, paving, a court, a pool,
 *   a flight, the stream's bed and its falls), the cell is flat at its own level, exactly, so what stands there stands
 *   on it. Round it the ground goes to meet the hill: cut steep and narrow where the hill's above the bench, filled
 *   gentle and wide where it's below, so a way along a slope has its bank on the uphill side and its fall on the other.
 * - **One surface**: the mesh lays the ground from it, the drawing lies on it, and what reads the ground's height (the
 *   cats, a pick, what's placed on the land) reads it from here.
 */
import { DIRS, key, type World } from './model';
import { noise2, onLand } from './land';
import { walled } from './context';

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** the ground's level at a cell: the stream's bed a little under its banks */
export const levelAt = (w: World, i: number, j: number) => (onLand(i, j) ? w.ground(i, j) - (w.land?.water.has(j * 1000 + i) ? 0.3 : 0) : -1);

interface Cells { v: number; lev: Map<number, number>; bench: Map<number, boolean> }
const cellCache = new WeakMap<World, Cells>();
function cellsOf(w: World): Cells {
  let c = cellCache.get(w);
  if (!c || c.v !== w.version) { c = { v: w.version, lev: new Map(), bench: new Map() }; cellCache.set(w, c); }
  return c;
}
const ck = (i: number, j: number) => (j + 512) * 1024 + i + 512;
function lev(w: World, C: Cells, i: number, j: number) {
  const k = ck(i, j);
  let v = C.lev.get(k);
  if (v === undefined) { v = levelAt(w, Math.max(-18, Math.min(29, i)), Math.max(-18, Math.min(29, j))); C.lev.set(k, v); }
  return v;
}
/** whether a cell's a bench: flat at its level, because something's built there or it's the stream's */
export function benched(w: World, i: number, j: number): boolean { return bench(w, cellsOf(w), i, j); }
function bench(w: World, C: Cells, i: number, j: number): boolean {
  const kk = ck(i, j);
  let h = C.bench.get(kk);
  if (h !== undefined) return h;
  h = false;
  if (w.land) {
    const g = w.ground(i, j), wet = (x: number, z: number) => w.land!.water.has(z * 1000 + x);
    const built = (k: number, x: number, z: number) => w.stone(k, x, z) || w.pier(k, x, z) || w.stair(k, x, z) >= 0;
    if (wet(i, j)) h = false;
    else if (built(g, i, j) || built(g - 1, i, j) || built(g + 1, i, j)) h = true;
    else if (w.paved(i, j) || w.courts.has(key(0, i, j)) || w.pools.has(key(0, i, j)) || w.way(g, i, j)) h = true;
    else {
      const sharp = walled(w);
      for (let d = 0; d < 4 && !h; d++) {
        const [a, b] = DIRS[d], x = i + a, z = j + b, gn = w.ground(x, z);
        if (sharp(i, j, d)) h = true;
        // (what's built beside it against its ground: the ground it leans on stays)
        for (let k = gn; k < g && !h; k++) if (built(k, x, z)) h = true;
      }
    }
  }
  C.bench.set(kk, h);
  return h;
}
/** the hill at a point, before anything's built into it */
export function hillAt(w: World, x: number, z: number): number {
  if (!w.land) return 0;
  const C = cellsOf(w), i = Math.floor(x), j = Math.floor(z), seed = w.land.seed;
  let num = 0, den = 0;
  for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
    const dx = x - (i + a + 0.5), dz = z - (j + b + 0.5), k = Math.exp(-(dx * dx + dz * dz) / (2 * 0.8 * 0.8));
    num += k * lev(w, C, i + a, j + b); den += k;
  }
  const h0 = num / den + (noise2(seed + 41, x * 0.55, z * 0.55) - 0.5) * 0.35 + (noise2(seed + 42, x * 1.7, z * 1.7) - 0.5) * 0.1 + roughAt(w, x, z);
  // (and honest about the levels the hand builds on (after the blind reviews: a hill drawn a level off a column read as
  // a slope the column hasn't): over each column's middle the ground's held within a quarter level of the column's own,
  // softly, the hold let go toward its edges so the slope between columns runs on unbroken)
  const L = lev(w, C, i, j), d = Math.max(Math.abs(x - i - 0.5), Math.abs(z - j - 0.5));
  const h = L < 0 ? h0 : L + 0.25 * Math.tanh((h0 - L) / 0.25) + (h0 - L - 0.25 * Math.tanh((h0 - L) / 0.25)) * smooth(0.12, 0.45, d);
  // (the stream's channel cut down into it: its bed flat across, its banks rising to the hill, wider the higher they are)
  const rv = nearRiver(w, x, z);
  if (!rv) return h;
  const bw = Math.min(0.6, Math.max(0.3, (h - rv.bed) * 0.38));
  if (rv.d >= rv.hw + bw) return h;
  const top = Math.max(h, rv.bed + 0.18);
  return rv.bed + (top - rv.bed) * smooth(rv.hw, rv.hw + bw, rv.d);
}
/** how broken the hill is at a point: nought over most of it; in a few patches (a broad field picks them) the ground's
 * rougher, folded in ridges at a finer grain, where the rock's near the surface. The crags stand in these (mesh.ts) */
export function roughness(w: World, x: number, z: number): number {
  return w.land ? smooth(0.56, 0.74, noise2(w.land.seed + 43, x * 0.18, z * 0.18)) : 0;
}
function roughAt(w: World, x: number, z: number): number {
  const rg = roughness(w, x, z);
  if (rg <= 0) return 0;
  const seed = w.land!.seed, rid = 1 - Math.abs(2 * noise2(seed + 44, x * 1.25, z * 1.25) - 1);
  return rg * ((rid - 0.55) * 0.62 + (noise2(seed + 45, x * 2.6, z * 2.6) - 0.5) * 0.22);
}
// ─── the stream, carved through the hill ───
/** the stream's course: a smooth line down its cells (their middles, corners cut), the bed's level at each point (stepping
 * at a fall), its half-width there; and where it falls */
export interface River { pts: Array<[number, number]>; bed: number[]; hw: number[]; falls: number[]; grid: Map<number, number[]> }
const riverCache = new WeakMap<object, River>();
export function riverOf(w: World): River | null {
  const land = w.land;
  if (!land) return null;
  let r = riverCache.get(land);
  if (r) return r;
  // (corners cut twice, each point remembering how far along the cells it is, so its bed is its nearest cell's)
  let P = land.stream.map(([i, j], q) => ({ x: i + 0.5, z: j + 0.5, u: q }));
  for (let pass = 0; pass < 3; pass++) {
    const Q: typeof P = [P[0]];
    for (let q = 0; q + 1 < P.length; q++) {
      const a = P[q], b = P[q + 1];
      Q.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25, u: a.u * 0.75 + b.u * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75, u: a.u * 0.25 + b.u * 0.75 });
    }
    Q.push(P[P.length - 1]); P = Q;
  }
  const lvl = (u: number) => { const [i, j] = land.stream[Math.min(land.stream.length - 1, Math.max(0, Math.round(u)))]; return w.ground(i, j) - 0.3; };
  const pts = P.map((p) => [p.x, p.z] as [number, number]), bed = P.map((p) => lvl(p.u));
  const hw = P.map((p) => 0.3 + (noise2(land.seed + 51, p.x * 0.8, p.z * 0.8) - 0.5) * 0.16);
  const falls: number[] = [];
  for (let q = 0; q + 1 < bed.length; q++) if (Math.abs(bed[q] - bed[q + 1]) > 1e-3) falls.push(q);
  // (which stretches pass near each cell, for finding the nearest quickly)
  const grid = new Map<number, number[]>();
  for (let q = 0; q + 1 < pts.length; q++) {
    const x0 = Math.floor(Math.min(pts[q][0], pts[q + 1][0]) - 1.6), x1 = Math.floor(Math.max(pts[q][0], pts[q + 1][0]) + 1.6), z0 = Math.floor(Math.min(pts[q][1], pts[q + 1][1]) - 1.6), z1 = Math.floor(Math.max(pts[q][1], pts[q + 1][1]) + 1.6);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const k = ck(x, z); (grid.get(k) ?? grid.set(k, []).get(k)!).push(q); }
  }
  r = { pts, bed, hw, falls, grid };
  riverCache.set(land, r);
  return r;
}
/** the nearest point of the stream's course to a point: how far, its bed and half-width there, along which stretch */
export function nearRiver(w: World, x: number, z: number): { d: number; bed: number; hw: number; q: number; t: number } | null {
  const R = riverOf(w);
  if (!R) return null;
  const list = R.grid.get(ck(Math.floor(x), Math.floor(z)));
  if (!list) return null;
  let best: { d: number; bed: number; hw: number; q: number; t: number } | null = null;
  for (const q of list) {
    const [ax, az] = R.pts[q], [bx, bz] = R.pts[q + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (!best || d < best.d) best = { d, bed: t < 0.5 ? R.bed[q] : R.bed[q + 1], hw: R.hw[q] + (R.hw[q + 1] - R.hw[q]) * t, q, t };
  }
  return best;
}
/** how far a bench's cut reaches into the hill above it, and its fill out over the hill below */
export const CUT = 0.45, FILL = 0.95;
/** the ground's height as drawn and walked at a point (cells: cell (i, j) spans i..i+1) */
export function groundAt(w: World, x: number, z: number): number {
  if (!w.land) return 0;
  const C = cellsOf(w), i = Math.floor(x), j = Math.floor(z);
  if (!onLand(i, j)) return -1;
  // (on a bench, its level; on the line between two, the higher's)
  let on = -Infinity;
  const fx = x - i, fz = z - j, e = 1e-6;
  for (const [a, b] of [[0, 0], [fx < e ? -1 : 0, 0], [0, fz < e ? -1 : 0], [fx < e ? -1 : 0, fz < e ? -1 : 0]]) if (bench(w, C, i + a, j + b)) on = Math.max(on, lev(w, C, i + a, j + b));
  if (on > -Infinity) return on;
  // (off them, the hill, going to meet the nearest bench: cut steep above it, filled gentle below)
  const h = hillAt(w, x, z);
  // (never over the stream: its channel's kept open however near a bench comes, the bench's edge falling to the bank)
  const rv = nearRiver(w, x, z), open = rv ? smooth(rv.hw + 0.05, rv.hw + 0.45, rv.d) : 1;
  let best = 0, at = h;
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    if ((!a && !b) || !bench(w, C, i + a, j + b)) continue;
    const ci = i + a, cj = j + b, L = lev(w, C, ci, cj);
    const d = Math.hypot(Math.max(ci - x, 0, x - ci - 1), Math.max(cj - z, 0, z - cj - 1));
    const wgt = (1 - smooth(0, h > L ? CUT : FILL, d)) * (h > L ? 1 : open);
    if (wgt > best) { best = wgt; at = L; }
  }
  return h + (at - h) * best;
}
