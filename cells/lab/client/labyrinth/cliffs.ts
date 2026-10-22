/**
 * The land's forms (after the in-situ target sheets, and the phone: "more blocky and voxel than before"): terraces and
 * the limestone cliffs between them, their outlines not the cells' edges but the lie of the land. One description that
 * the mesh builds the ground and its rock from, the drawing draws its lines from, and the ground's height is read from.
 *
 * - **The levels as fields.** For each level the land steps up to, a field over the ground: each cell's own (whether its
 *   ground is that high), blended with its neighbours' (a smooth kernel) and moved a little by noise, so a staircase of
 *   cells reads as a diagonal, a corner is rounded, a lone rise is a knoll, and an edge wanders. The terrace is where
 *   the field's over a half; its edge, the field's contour there. The middle of every cell keeps its own level (what
 *   stands at it never floats or sinks), and where anything's built (on a cell, against it, a wall holding its bank, a
 *   way, a flight, a fall) the cell is kept square and exact, so the land meets what's built as it did.
 * - **Terraces**: the ground between contours, flat at its level; the stream's bed (its level a little under its banks)
 *   among them, where the water lies.
 * - **Runs**: each contour chained into a line, the high ground on its left, with its normal out over the low ground at
 *   each point. Where the contours of two levels lie apart, the cliff's in two steps with a ledge between; where they
 *   lie together (an exact edge), one cliff the whole height, the lower contours left to it.
 * - **Blocks**: a run cut along into blocks of unequal length, each set a little forward or back of the next and leaning
 *   back a little, its top edge rounded, now and then sunk a little under the terrace; a tall face in two courses.
 */
import { hash } from '../kit/rng';
import { DIRS, key, type World } from './model';
import { DOMAIN, noise2, onLand } from './land';
import { walled } from './context';

export type V2 = [number, number];
/** a block of a run: from so far along it to so far; how far out its face stands at its top, how much it leans back
 * (out per unit down), how far its top's sunk under the terrace */
export interface Block { s0: number; s1: number; r: number; lean: number; sunk: number }
export interface Run {
  id: number;
  /** the level of the ground above it (its threshold) */
  t: number;
  /** its line (cells: cell (i, j) spans i..i+1), the normal out over the low ground at each point, the length along it */
  pts: V2[]; nrm: V2[]; s: number[];
  /** each stretch's (between point q and q + 1): the ground's level below it, and whether the rock's built there (not
   * where a wall holds the bank, a flight climbs it, or a higher cliff stands in the same place) */
  bot: number[]; face: boolean[];
  /** whether it's the stream's bank (the ground below it the stream's bed) */
  bank: boolean[];
  blocks: Block[]; closed: boolean;
  /** where a tall face is split into two courses, a ledge between, as a fraction down it */
  split: number;
}
/** a piece of terrace: its level and its outline */
export interface Region { level: number; poly: V2[] }
export interface LandForm { thresholds: number[]; beds: Set<number>; runs: Run[]; regions: Region[]; R: number }

/** how much a course's top edge is rounded off (a stream's low bank, less) */
export const BEVEL = 0.055, BEVEL_SMALL = 0.02;
export const bevelOf = (h: number) => (h < 0.6 ? BEVEL_SMALL : BEVEL);

const rng = (...n: number[]) => { let s = hash(...n) >>> 0; return () => { s = hash(s, 0x51ed) >>> 0; return s / 4294967296; }; };
const ramp = (r: () => number, a: number, b: number) => a + r() * (b - a);
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** the ground's level at a cell, as drawn: the stream's bed a little under its banks */
export const levelAt = (w: World, i: number, j: number) => (onLand(i, j) ? w.ground(i, j) - (w.land?.water.has(j * 1000 + i) ? 0.3 : 0) : -1);

// ─── the fields ───
interface Cells { v: number; lev: Map<number, number>; hard: Map<number, boolean> }
const cellCache = new WeakMap<World, Cells>();
function cellsOf(w: World): Cells {
  let c = cellCache.get(w);
  if (!c || c.v !== w.version) { c = { v: w.version, lev: new Map(), hard: new Map() }; cellCache.set(w, c); }
  return c;
}
const ck = (i: number, j: number) => (j + 512) * 1024 + i + 512;
function lev(w: World, C: Cells, i: number, j: number) {
  const k = ck(i, j);
  let v = C.lev.get(k);
  if (v === undefined) { v = levelAt(w, i, j); C.lev.set(k, v); }
  return v;
}
/** whether a cell's kept square and exact: anything built on it or against its ground, a wall or what's built holding
 * one of its banks, a way, paving, a court, a pool, a flight's foot or head, a fall of the stream */
function hard(w: World, C: Cells, i: number, j: number): boolean {
  const kk = ck(i, j);
  let h = C.hard.get(kk);
  if (h !== undefined) return h;
  h = false;
  if (w.land) {
    const g = w.ground(i, j), wet = (x: number, z: number) => w.land!.water.has(z * 1000 + x);
    const built = (k: number, x: number, z: number) => w.stone(k, x, z) || w.pier(k, x, z) || w.stair(k, x, z) >= 0;
    if (built(g, i, j) || built(g - 1, i, j) || built(g + 1, i, j)) h = true;
    else if (w.paved(i, j) || w.courts.has(key(0, i, j)) || w.pools.has(key(0, i, j)) || w.way(g, i, j)) h = true;
    else {
      const sharp = walled(w);
      for (let d = 0; d < 4 && !h; d++) {
        const [a, b] = DIRS[d], x = i + a, z = j + b, gn = w.ground(x, z);
        if (sharp(i, j, d)) h = true;
        // (what's built beside it, against its ground or standing at its level)
        for (let k = Math.min(g, gn) - 1; k <= g && !h; k++) if (built(k, x, z)) h = true;
        // (a way or paving beside it at another level: its edge exact)
        if ((w.paved(x, z) || w.way(gn, x, z)) && gn !== g) h = true;
        // (a fall: the stream stepping down to the next cell of it)
        if (wet(i, j) && wet(x, z) && gn !== g) h = true;
      }
    }
  }
  C.hard.set(kk, h);
  return h;
}
/** what the fields of every level at a point are made of: its cell's own level, its neighbours' and their weights in
 * the kernel, the noise, how much the middle of its cell holds it, and how near the stream is */
interface Pack { hard: boolean; own: number; den: number; kw: number[]; kl: number[]; N: number; cw: number; wetK: number; bed: number }
function pack(w: World, C: Cells, x: number, z: number, seed: number): Pack {
  const i = Math.floor(x), j = Math.floor(z), own = lev(w, C, i, j);
  if (hard(w, C, i, j)) return { hard: true, own, den: 1, kw: [], kl: [], N: 0, cw: 1, wetK: 0, bed: 0 };
  const kw: number[] = [], kl: number[] = [], water = w.land!.water;
  let den = 0, wk = 0, bed = Infinity;
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    const d = Math.hypot(x - (i + a + 0.5), z - (j + b + 0.5)), q = Math.max(0, 1 - (d / 1.2) ** 2), k = q * q, l = lev(w, C, i + a, j + b);
    kw.push(k); kl.push(l); den += k;
    if (water.has((j + b) * 1000 + i + a)) { wk += k; bed = Math.min(bed, l); }
  }
  const N = (noise2(seed + 31, x * 1.15, z * 1.15) - 0.5) * 0.5 + (noise2(seed + 32, x * 2.9, z * 2.9) - 0.5) * 0.16;
  const cw = 1 - smooth(0.08, 0.3, Math.max(Math.abs(x - i - 0.5), Math.abs(z - j - 0.5)));
  return { hard: false, own, den, kw, kl, N, cw, wetK: wk / den, bed };
}
/** the field of a level at a point: over a half where the ground's that high. Near the stream, the levels over its bed
 * held back from it, the higher the further, so its banks open upward in steps and its water's seen */
function fOf(P: Pack, t: number): number {
  const own = P.own >= t - 1e-6 ? 1 : 0;
  if (P.hard) return own;
  let num = 0;
  for (let m = 0; m < P.kw.length; m++) if (P.kl[m] >= t - 1e-6) num += P.kw[m];
  const back = P.wetK > 0 && t > P.bed + 1e-6 ? P.wetK * 0.3 * Math.min(2.5, t - P.bed + 0.4) : 0;
  return (num / P.den + P.N - back) * (1 - P.cw) + own * P.cw;
}
function fieldAt(w: World, C: Cells, t: number, x: number, z: number, seed: number): number { return fOf(pack(w, C, x, z, seed), t); }
/** the ground's height as drawn at a point (cells), from the same fields the mesh lays it from */
export function groundAt(w: World, x: number, z: number): number {
  if (!w.land) return 0;
  const C = cellsOf(w), i = Math.floor(x), j = Math.floor(z), seed = w.land.seed;
  if (!onLand(i, j)) return -1;
  if (hard(w, C, i, j)) return lev(w, C, i, j);
  const ts = new Set<number>();
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) ts.add(lev(w, C, i + a, j + b));
  const sorted = [...ts].sort((p, q) => q - p);
  for (let k = 0; k < sorted.length - 1; k++) if (fieldAt(w, C, sorted[k], x, z, seed) > 0.5) return sorted[k];
  return sorted[sorted.length - 1];
}

// ─── the forms over a box ───
const formCache = new WeakMap<World, { v: number; box: string; f: LandForm }>();
export function landForm(w: World, B0: { i0: number; i1: number; j0: number; j1: number }): LandForm {
  // (only over the land itself: past it there's nothing to step down to)
  const B = { i0: Math.max(B0.i0, DOMAIN.i0), i1: Math.min(B0.i1, DOMAIN.i1), j0: Math.max(B0.j0, DOMAIN.j0), j1: Math.min(B0.j1, DOMAIN.j1) };
  const box = `${B.i0}.${B.i1}.${B.j0}.${B.j1}`, c = formCache.get(w);
  if (c && c.v === w.version && c.box === box) return c.f;
  const R = 4, f: LandForm = { thresholds: [], beds: new Set(), runs: [], regions: [], R };
  if (!w.land) { formCache.set(w, { v: w.version, box, f }); return f; }
  const C = cellsOf(w), seed = w.land.seed, wet = (i: number, j: number) => w.land!.water.has(j * 1000 + i);
  // (the levels the land steps up to over the box, lowest first; the lowest is the ground under all of them)
  const all = new Set<number>();
  for (let j = B.j0 - 1; j <= B.j1 + 1; j++) for (let i = B.i0 - 1; i <= B.i1 + 1; i++) if (onLand(i, j)) { const v = lev(w, C, i, j); all.add(v); if (wet(i, j)) f.beds.add(v); }
  const levels = [...all].sort((a, b) => a - b), base = levels[0], T = levels.slice(1), nT = T.length;
  f.thresholds = T;
  // (the fields sampled over the box, a little past it: R to a cell, at the middles of the R×R squares)
  const x0 = B.i0, z0 = B.j0, nA = (B.i1 + 1 - B.i0) * R, nB = (B.j1 + 1 - B.j0) * R, NA = nA + 2, NB = nB + 2;
  const SX = (a: number) => x0 + (a - 1 + 0.5) / R, SZ = (b: number) => z0 + (b - 1 + 0.5) / R;
  const F = new Float32Array(NA * NB * Math.max(1, nT));
  for (let b = 0; b < NB; b++) for (let a = 0; a < NA; a++) {
    const x = Math.min(DOMAIN.i1 + 0.999, Math.max(DOMAIN.i0, SX(a))), z = Math.min(DOMAIN.j1 + 0.999, Math.max(DOMAIN.j0, SZ(b))), i = Math.floor(x), j = Math.floor(z), o = (b * NA + a) * nT;
    // (every level's field at once: what they're made of worked out once for the point)
    const P = pack(w, C, x, z, seed);
    for (let k = 0; k < nT; k++) F[o + k] = fOf(P, T[k]);
  }
  const fv = (a: number, b: number, k: number) => F[(b * NA + a) * nT + k];
  /** within a square of samples (a, b)…(a + 1, b + 1), the field of level k at a point there (bilinear) */
  const bil = (a: number, b: number, k: number, x: number, z: number) => {
    const u = (x - SX(a)) * R, v = (z - SZ(b)) * R;
    return (fv(a, b, k) * (1 - u) + fv(a + 1, b, k) * u) * (1 - v) + (fv(a, b + 1, k) * (1 - u) + fv(a + 1, b + 1, k) * u) * v;
  };
  const levelIn = (a: number, b: number, x: number, z: number) => { for (let k = nT - 1; k >= 0; k--) if (bil(a, b, k, x, z) > 0.5) return T[k]; return base; };
  const bx0 = B.i0, bx1 = B.i1 + 1, bz0 = B.j0, bz1 = B.j1 + 1;
  /** keep the part of a polygon where a value's over (or not) a half */
  const clip = (poly: V2[], val: (p: V2) => number, over: boolean): V2[] => {
    const out: V2[] = [], n = poly.length;
    for (let q = 0; q < n; q++) {
      const P = poly[q], Q = poly[(q + 1) % n], vp = val(P) - 0.5, vq = val(Q) - 0.5, ip = over ? vp > 0 : vp <= 0, iq = over ? vq > 0 : vq <= 0;
      if (ip) out.push(P);
      if (ip !== iq) { const t = vp / (vp - vq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
    }
    return out;
  };
  const inBox = (poly: V2[]) => {
    let p = clip(poly, (q) => (q[0] >= bx0 ? 1 : 0), true);
    if (p.length >= 3) p = clip(p, (q) => (q[0] <= bx1 ? 1 : 0), true);
    if (p.length >= 3) p = clip(p, (q) => (q[1] >= bz0 ? 1 : 0), true);
    if (p.length >= 3) p = clip(p, (q) => (q[1] <= bz1 ? 1 : 0), true);
    return p;
  };
  // ─── the terraces: each square of samples cut along the contours that cross it ───
  const segs: Array<{ k: number; p: V2; q: V2 }> = [];
  for (let b = 0; b + 1 < NB; b++) for (let a = 0; a + 1 < NA; a++) {
    const xa = SX(a), xb = SX(a + 1), za = SZ(b), zb = SZ(b + 1);
    if (xb <= bx0 || xa >= bx1 || zb <= bz0 || za >= bz1) continue;
    const sq: V2[] = [[xa, za], [xb, za], [xb, zb], [xa, zb]];
    const edge = xa < bx0 || xb > bx1 || za < bz0 || zb > bz1;
    const cross: number[] = [];
    for (let k = 0; k < nT; k++) { const c4 = [fv(a, b, k), fv(a + 1, b, k), fv(a + 1, b + 1, k), fv(a, b + 1, k)].map((v) => v > 0.5); if (c4.some((x) => x) && !c4.every((x) => x)) cross.push(k); }
    const emit = (level: number, poly: V2[]) => { const pp = edge ? inBox(poly) : poly; if (pp.length >= 3) f.regions.push({ level, poly: pp }); };
    if (!cross.length) {
      // (a square no contour crosses: run on along the row while the next ones are the same, up to a cell and a half,
      // and up to a quarter where a contour's near, for the shade at a cliff's foot)
      const L0 = levelIn(a, b, (xa + xb) / 2, (za + zb) / 2), near = (aa: number) => { for (let k = 0; k < nT; k++) { const c4 = [fv(aa, b, k), fv(aa + 1, b, k), fv(aa + 1, b + 1, k), fv(aa, b + 1, k)].map((v) => v > 0.5); if (c4.some((x) => x) && !c4.every((x) => x)) return true; } return false; };
      let a2 = a;
      const quiet = !near(Math.max(0, a - 1)) && !(a + 2 < NA && near(a + 1));
      while (quiet && a2 + 2 < NA && a2 - a < 5 && SX(a2 + 2) <= bx1 && !near(a2 + 1) && !(a2 + 3 < NA && near(a2 + 2)) && levelIn(a2 + 1, b, (SX(a2 + 1) + SX(a2 + 2)) / 2, (za + zb) / 2) === L0 && !(xa < bx0)) a2++;
      emit(L0, a2 === a ? sq : [[xa, za], [SX(a2 + 1), za], [SX(a2 + 1), zb], [xa, zb]]);
      a = a2;
      continue;
    }
    // (from the highest level down: the part over its contour at it, the rest on down)
    let rest = sq;
    for (let k = nT - 1; k >= 0 && rest.length >= 3; k--) {
      const part = clip(rest, (p) => bil(a, b, k, p[0], p[1]), true);
      if (part.length >= 3) emit(T[k], part);
      rest = clip(rest, (p) => bil(a, b, k, p[0], p[1]), false);
    }
    if (rest.length >= 3) emit(base, rest);
    // (and each crossing level's contour through it: marching squares, the high side on the left)
    for (const k of cross) {
      const v = [fv(a, b, k), fv(a + 1, b, k), fv(a + 1, b + 1, k), fv(a, b + 1, k)], P: V2[] = [[xa, za], [xb, za], [xb, zb], [xa, zb]];
      const at = (e: number): V2 => { const p = P[e], q = P[(e + 1) % 4], vp = v[e] - 0.5, vq = v[(e + 1) % 4] - 0.5, t = vp / (vp - vq); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
      const cr: number[] = [];
      for (let e = 0; e < 4; e++) if ((v[e] > 0.5) !== (v[(e + 1) % 4] > 0.5)) cr.push(e);
      const pairs: Array<[number, number]> = [];
      if (cr.length === 2) pairs.push([cr[0], cr[1]]);
      else if (cr.length === 4) {
        // (a saddle: by the middle's value, which corners are joined)
        const mid = (v[0] + v[1] + v[2] + v[3]) / 4 > 0.5;
        if ((v[0] > 0.5) === mid) pairs.push([0, 1], [2, 3]); else pairs.push([0, 3], [1, 2]);
      }
      for (const [e0, e1] of pairs) {
        let p = at(e0), q = at(e1);
        // (the high side on the left: going from p to q, left is (−dz, dx))
        const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2, dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
        const lx = -dz / l, lz = dx / l, e = 0.02;
        if (bil(a, b, k, mx + lx * e, mz + lz * e) < bil(a, b, k, mx - lx * e, mz - lz * e)) [p, q] = [q, p];
        segs.push({ k, p, q });
      }
    }
  }
  // ─── the runs: the contours chained, level by level ───
  const kp = (p: V2) => `${Math.round(p[0] * 4096)},${Math.round(p[1] * 4096)}`;
  const sharp = walled(w), E = w.extent();
  const levelHere = (x: number, z: number) => { const a = Math.floor((x - x0) * R - 0.5) + 1, b = Math.floor((z - z0) * R - 0.5) + 1; return a >= 0 && b >= 0 && a + 1 < NA && b + 1 < NB ? levelIn(a, b, x, z) : groundAt(w, x, z); };
  for (let k = 0; k < nT; k++) {
    const mine = segs.filter((s) => s.k === k), from = new Map<string, number[]>(), used = new Uint8Array(mine.length);
    mine.forEach((s, n) => { const k0 = kp(s.p); (from.get(k0) ?? from.set(k0, []).get(k0)!).push(n); });
    const ends = new Set<string>(mine.map((s) => kp(s.q)));
    const chainFrom = (n0: number) => {
      const pts: V2[] = [mine[n0].p];
      let n = n0;
      while (n >= 0 && !used[n]) {
        used[n] = 1; pts.push(mine[n].q);
        const nx = (from.get(kp(mine[n].q)) ?? []).find((m) => !used[m]);
        n = nx === undefined ? -1 : nx;
      }
      return pts;
    };
    const lines: Array<{ pts: V2[]; closed: boolean }> = [];
    mine.forEach((s, n) => { if (!used[n] && !ends.has(kp(s.p))) lines.push({ pts: chainFrom(n), closed: false }); });
    mine.forEach((_, n) => { if (!used[n]) { const pts = chainFrom(n); lines.push({ pts, closed: kp(pts[0]) === kp(pts[pts.length - 1]) }); } });
    for (const { pts: raw, closed } of lines) {
      // (its points no closer than a little: marching squares leaves slivers where it grazes a sample)
      const pts: V2[] = [];
      for (const p of raw) if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 0.04) pts.push(p);
      if (closed && pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.04) pts[pts.length - 1] = pts[0];
      else if (closed && pts.length > 2) pts.push(pts[0]);
      if (pts.length < 2) continue;
      // (no more points than its shape needs: where it runs nearly straight, one stretch; finer near what's shown)
      const mid = pts[Math.floor(pts.length / 2)], outBy = Math.max(E.i0 - mid[0], mid[0] - E.i1 - 1, E.j0 - mid[1], mid[1] - E.j1 - 1, 0);
      const simple = dp(pts, outBy > 1 ? 0.07 : 0.025);
      if (simple.length < (closed ? 4 : 2)) continue;
      pts.length = 0; pts.push(...simple);
      const nP = pts.length, s: number[] = [0];
      for (let q = 1; q < nP; q++) s.push(s[q - 1] + Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]));
      // (out over the low ground: the right of the way along, averaged at each point)
      const segN = (q: number): V2 => { const dx = pts[q + 1][0] - pts[q][0], dz = pts[q + 1][1] - pts[q][1], l = Math.hypot(dx, dz) || 1; return [dz / l, -dx / l]; };
      const nrm: V2[] = pts.map((_, q) => {
        const A = q > 0 ? segN(q - 1) : closed ? segN(nP - 2) : null, Bn = q < nP - 1 ? segN(q) : closed ? segN(0) : null;
        const n = A && Bn ? [A[0] + Bn[0], A[1] + Bn[1]] : (A ?? Bn)!, l = Math.hypot(n[0], n[1]) || 1;
        return [n[0] / l, n[1] / l];
      });
      const bot: number[] = [], face: boolean[] = [], bank: boolean[] = [];
      for (let q = 0; q < nP - 1; q++) {
        const m: V2 = [(pts[q][0] + pts[q + 1][0]) / 2, (pts[q][1] + pts[q + 1][1]) / 2], n = segN(q);
        const below = levelHere(m[0] + n[0] * 0.07, m[1] + n[1] * 0.07), above = levelHere(m[0] - n[0] * 0.07, m[1] - n[1] * 0.07);
        bot.push(Math.min(below, T[k] - 0.05)); bank.push(f.beds.has(below));
        // (not where a higher cliff stands in the same place; nor on a cell's edge a wall holds, or a flight climbs)
        let ok = above <= T[k] + 1e-3;
        const onX = Math.abs(m[0] - Math.round(m[0])) < 0.02 && Math.abs(n[0]) > 0.9, onZ = Math.abs(m[1] - Math.round(m[1])) < 0.02 && Math.abs(n[1]) > 0.9;
        if (ok && (onX || onZ)) {
          const hi: V2 = [Math.floor(m[0] - n[0] * 0.3), Math.floor(m[1] - n[1] * 0.3)], d = onX ? (n[0] > 0 ? 0 : 2) : n[1] > 0 ? 1 : 3, [da, db] = DIRS[d], lo: V2 = [hi[0] + da, hi[1] + db];
          const gl = w.ground(lo[0], lo[1]), gh = w.ground(hi[0], hi[1]), back = (d + 2) % 4;
          if (sharp(hi[0], hi[1], d) || (gh > gl && (w.stair(gl, lo[0], lo[1]) === back || w.stair(gh - 1, lo[0], lo[1]) === back))) ok = false;
        }
        face.push(ok);
      }
      // (its blocks)
      const id = hash(seed, Math.round(pts[0][0] * 64), Math.round(pts[0][1] * 64), k, 0xc11f) >>> 0, r = rng(id, 0xb10c), len = s[nP - 1];
      if (len < 0.05) continue;
      const blocks: Block[] = [];
      for (let s0 = 0; s0 < len - 1e-6;) {
        let L = ramp(r, 0.45, 1.4);
        if (len - s0 - L < 0.35) L = len - s0;
        blocks.push({ s0, s1: s0 + L, r: ramp(r, 0, 0.1), lean: ramp(r, 0.03, 0.13), sunk: 0 });
        s0 += L;
      }
      for (let q = 1; q + 1 < blocks.length; q++) if (r() < 0.3) blocks[q].sunk = ramp(r, 0.06, 0.2);
      f.runs.push({ id, t: T[k], pts, nrm, s, bot, face, bank, blocks, closed, split: r() < 0.7 ? ramp(r, 0.35, 0.6) : 0 });
    }
  }
  formCache.set(w, { v: w.version, box, f });
  return f;
}
/** a line simplified (Douglas–Peucker): its points within so far of it kept to those its shape needs */
function dp(p: V2[], tol: number): V2[] {
  if (p.length < 3) return p.slice();
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const go = (a: number, b: number) => {
    const ax = p[a][0], az = p[a][1], dx = p[b][0] - ax, dz = p[b][1] - az, l = Math.hypot(dx, dz) || 1;
    let far = -1, fd = tol;
    for (let q = a + 1; q < b; q++) { const d = Math.abs((p[q][0] - ax) * dz - (p[q][1] - az) * dx) / l; if (d > fd) { fd = d; far = q; } }
    if (far >= 0) { keep[far] = 1; go(a, far); go(far, b); }
  };
  go(0, p.length - 1);
  return p.filter((_, q) => keep[q]);
}
/** the block a point so far along a run is in */
export function blockAt(run: Run, s: number): Block {
  for (const b of run.blocks) if (s < b.s1) return b;
  return run.blocks[run.blocks.length - 1];
}
/**
 * A run's stretch q as rock: the block it's in, how high, its bevel, and its courses down from its top, each (top,
 * bottom, out at its top, out at its bottom): the top course's top sunk if the block is, a tall face in two with a ledge
 * between, the stream's low bank in one, hardly out at all
 */
export function courses(run: Run, q: number): { b: Block; h: number; bev: number; tiers: Array<{ top: number; bot: number; r0: number; r1: number }> } {
  const b = blockAt(run, (run.s[q] + run.s[q + 1]) / 2), bot = run.bot[q], h = run.t - bot, small = h < 0.6, bev = bevelOf(h);
  // (down to the water, standing straight from it, not leaning out over it)
  const wetFoot = run.bank[q], top = run.t - (small || h < 0.5 ? 0 : b.sunk), r0 = bev + (small || wetFoot ? b.r * 0.25 : b.r), lean = small || wetFoot ? 0.015 : b.lean;
  if (!run.split || h < 1.3 || small) return { b, h, bev, tiers: [{ top, bot: bot - 0.1, r0, r1: r0 + lean * (top - bot + 0.1) }] };
  const mid = top - (top - bot) * run.split, r1 = r0 + lean * (top - mid), r2 = r1 + bev + 0.03 + b.r * 0.5;
  return { b, h, bev, tiers: [{ top, bot: mid, r0, r1 }, { top: mid, bot: bot - 0.1, r0: r2, r1: r2 + lean * (mid - bot + 0.1) }] };
}
