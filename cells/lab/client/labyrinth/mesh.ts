/**
 * The labyrinth's stone, as triangles: the intended solid and its resolution (model.ts), each face with how it's lit
 * (its normal, how shut in it is), what it's made of, and how it rises (when it was laid, the height it grows from).
 *
 * - **blocks**: their faces where nothing hides them, darker at the foot where they meet a floor;
 * - **stairs**: six steps up a level;
 * - **arches**: under a run of stone carried over nothing, an arch from the stone each side, springing as low as the
 *   resolution let it; the stone over it is spandrels each side and a deck, its underside lit from within;
 * - **piers**: square columns under what has nothing else to stand on, with a cap;
 * - **courtyards**: paved; water where the rules put it, a rim round it; cypresses;
 * - **the stone and the table**: the travertine slab, on a table in the sun.
 *
 * x and z are centred on the slab; y up, the slab's top at 0.
 */
import { DECK, DIRS, LEVELS, N, type Span, type World } from './model';

/** floats a vertex: position, normal, ao (1 open .. 0 shut in), material (MAT), its rising (when laid, the height it
 * grows from, how), and a seed for its stone's tone */
export const STRIDE = 12;
export const MAT = { stone: 0, within: 1, water: 2, leaves: 3, bark: 4, slab: 5, slabSide: 6, table: 7, court: 8 };
export const MARGIN = 0.6, SLAB = 0.42;
const STEPS = 6, CURVE = 14, PIER = 0.3;

export interface Mesh { data: Float32Array; count: number }
type V3 = [number, number, number];
const X = (i: number) => i - N / 2, Z = (j: number) => j - N / 2;
const tone = (k: number, i: number, j: number) => (((k * 73856093) ^ (i * 19349663) ^ (j * 83492791)) >>> 0) / 4294967296;

export function buildMesh(w: World): Mesh {
  const out: number[] = [];
  let cur = { born: -1e3, pivot: 0, how: 1, tone: 0 };
  const vert = (p: V3, n: V3, ao: number, mat: number) => out.push(p[0], p[1], p[2], n[0], n[1], n[2], ao, mat, cur.born, cur.pivot, cur.how, cur.tone);
  const quad = (a: V3, b: V3, c: V3, d: V3, n: V3, ao: number[] | number, mat: number) => {
    const A = typeof ao === 'number' ? [ao, ao, ao, ao] : ao;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
    const P = flip ? [a, d, c, b] : [a, b, c, d], Q = flip ? [A[0], A[3], A[2], A[1]] : A;
    for (const k of [0, 1, 2, 0, 2, 3]) vert(P[k], n, Q[k], mat);
  };
  /** a face toward a neighbour hidden against it: a plain block, or a stair's back */
  const hides = (k: number, i: number, j: number, d: number) => {
    const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
    if (w.block(k, ni, nj)) return true;
    const s = w.stair(k, ni, nj);
    return s >= 0 && (s + 2) % 4 === d;
  };
  const floored = (k: number, i: number, j: number) => !w.occupied(k, i, j) && (k === 0 ? !w.pool(i, j) : w.stone(k - 1, i, j));
  const cornerAo = (k: number, i: number, j: number) => {
    const s = (a: number, b: number) => (w.block(k, i + a, j + b) ? 1 : 0);
    const c = (a: number, b: number) => { const s1 = s(a, 0), s2 = s(0, b), d = s(a, b); return s1 && s2 ? 0 : 3 - s1 - s2 - d; };
    return [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)].map((v) => 0.55 + v * 0.15);
  };
  const sides = (k: number, i: number, j: number, y0: number, y1: number, mat: number) => {
    const x0 = X(i), z0 = Z(j);
    for (let d = 0; d < 4; d++) {
      if (hides(k, i, j, d)) continue;
      const [a, b] = DIRS[d], foot = floored(k, i + a, j + b) ? 0.6 : 1;
      const A: V3 = a ? [a > 0 ? x0 + 1 : x0, y0, z0] : [x0, y0, b > 0 ? z0 + 1 : z0], B: V3 = a ? [A[0], y0, z0 + 1] : [x0 + 1, y0, A[2]];
      quad(A, B, [B[0], y1, B[2]], [A[0], y1, A[2]], [a, 0, b], [foot, foot, 1, 1], mat);
    }
  };
  const topFace = (k: number, i: number, j: number, y: number) => {
    if (w.block(k + 1, i, j) || w.stair(k + 1, i, j) >= 0) return;
    const x0 = X(i), z0 = Z(j);
    quad([x0, y, z0], [x0 + 1, y, z0], [x0 + 1, y, z0 + 1], [x0, y, z0 + 1], [0, 1, 0], cornerAo(k + 1, i, j), MAT.stone);
  };

  // ─── the stone, and the table it's on ───
  {
    const e = N / 2 + MARGIN;
    for (let j = -1; j <= N; j++) for (let i = -1; i <= N; i++) {
      const inside = i >= 0 && j >= 0 && i < N && j < N;
      if (inside && (w.pool(i, j) || w.block(0, i, j) || w.stair(0, i, j) >= 0)) continue;
      const x0 = i < 0 ? -e : X(i), x1 = i >= N ? e : X(i + 1), z0 = j < 0 ? -e : Z(j), z1 = j >= N ? e : Z(j + 1);
      const court = inside && w.courts.has((0 * N + j) * N + i);
      quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [0, 1, 0], inside ? cornerAo(0, i, j) : 1, court ? MAT.court : MAT.slab);
    }
    const T = 70, R = 1.6;
    for (let d = 0; d < 4; d++) {
      const [a, b] = DIRS[d], n: V3 = [a, 0, b];
      const c0: V3 = a ? [a * e, 0, -e] : [-e, 0, b * e], c1: V3 = a ? [a * e, 0, e] : [e, 0, b * e];
      quad(c0, c1, [c1[0], -SLAB, c1[2]], [c0[0], -SLAB, c0[2]], n, [1, 1, 0.7, 0.7], MAT.slabSide);
      const o0: V3 = a ? [a * (e + R), -SLAB, -(e + R)] : [-(e + R), -SLAB, b * (e + R)], o1: V3 = a ? [a * (e + R), -SLAB, e + R] : [e + R, -SLAB, b * (e + R)];
      quad([c0[0], -SLAB, c0[2]], [c1[0], -SLAB, c1[2]], o1, o0, [0, 1, 0], [0.5, 0.5, 1, 1], MAT.table);
    }
    for (const [x0, z0, x1, z1] of [[-T, -T, T, -(e + R)], [-T, e + R, T, T], [-T, -(e + R), -(e + R), e + R], [e + R, -(e + R), T, e + R]]) quad([x0, -SLAB, z0], [x1, -SLAB, z0], [x1, -SLAB, z1], [x0, -SLAB, z1], [0, 1, 0], 1, MAT.table);
  }

  // ─── the hand's stone: blocks and stairs ───
  for (let k = 0; k < LEVELS; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = X(i), z0 = Z(j), y0 = k, y1 = k + 1;
    if (w.block(k, i, j)) {
      cur = { born: w.born(k, i, j), pivot: y0, how: 1, tone: tone(k, i, j) };
      sides(k, i, j, y0, y1, MAT.stone);
      topFace(k, i, j, y1);
      continue;
    }
    const d = w.stair(k, i, j);
    if (d >= 0) {
      cur = { born: w.born(k, i, j), pivot: y0, how: 1, tone: tone(k, i, j) };
      const [a, b] = DIRS[d];
      const pt = (u: number, wv: number, y: number): V3 => { const cx = x0 + 0.5, cz = z0 + 0.5; return a ? [cx + a * (u - 0.5), y, cz + (wv - 0.5)] : [cx + (wv - 0.5), y, cz + b * (u - 0.5)]; };
      const across = [(d + 1) % 4, (d + 3) % 4];
      for (let s = 0; s < STEPS; s++) {
        const u0 = s / STEPS, u1 = (s + 1) / STEPS, h = y0 + (s + 1) / STEPS, h0 = y0 + s / STEPS;
        quad(pt(u0, 0, h), pt(u1, 0, h), pt(u1, 1, h), pt(u0, 1, h), [0, 1, 0], [0.8, 0.95, 0.95, 0.8], MAT.stone);
        quad(pt(u0, 0, h0), pt(u0, 1, h0), pt(u0, 1, h), pt(u0, 0, h), [-a, 0, -b], [0.65, 0.65, 0.9, 0.9], MAT.stone);
        for (const q of across) {
          if (hides(k, i, j, q)) continue;
          const dd = DIRS[q], wv = (a ? dd[1] : dd[0]) > 0 ? 1 : 0;
          quad(pt(u0, wv, y0), pt(u1, wv, y0), pt(u1, wv, h), pt(u0, wv, h), [dd[0], 0, dd[1]], [0.7, 0.7, 1, 1], MAT.stone);
        }
      }
      if (!hides(k, i, j, d)) quad(pt(1, 0, y0), pt(1, 1, y0), pt(1, 1, y1), pt(1, 0, y1), [a, 0, b], [0.7, 0.7, 1, 1], MAT.stone);
      continue;
    }
    if (w.pier(k, i, j)) {
      // (a pier: a square column; a cap where it meets what it carries)
      cur = { born: w.born(k, i, j), pivot: 0, how: 1, tone: tone(k, i, j) };
      const cx = x0 + 0.5, cz = z0 + 0.5, capped = !w.pier(k + 1, i, j), r = PIER, rc = PIER + 0.08;
      const yTop = capped ? y1 - 0.12 : y1;
      for (let d = 0; d < 4; d++) {
        const [a, b] = DIRS[d], P = (s: number, y: number, rr: number): V3 => (a ? [cx + a * rr, y, cz + s * rr] : [cx + s * rr, y, cz + b * rr]);
        quad(P(-1, y0, r), P(1, y0, r), P(1, yTop, r), P(-1, yTop, r), [a, 0, b], [k === 0 ? 0.6 : 0.9, k === 0 ? 0.6 : 0.9, 1, 1], MAT.stone);
        if (capped) quad(P(-1, yTop, rc), P(1, yTop, rc), P(1, y1, rc), P(-1, y1, rc), [a, 0, b], 0.85, MAT.stone);
      }
      if (capped) for (const [x, z, xx, zz] of [[-rc, -rc, rc, -r], [-rc, r, rc, rc], [-rc, -r, -r, r], [r, -r, rc, r]]) quad([cx + x, yTop, cz + z], [cx + xx, yTop, cz + z], [cx + xx, yTop, cz + zz], [cx + x, yTop, cz + zz], [0, -1, 0], 0.7, MAT.stone);
    }
  }
  for (const sp of w.spans) span(sp);

  // ─── what grows in the courtyards ───
  for (const dc of w.decor) {
    cur = { born: dc.born, pivot: -0.4, how: 1, tone: 0.5 };
    const x0 = X(dc.i), z0 = Z(dc.j);
    if (dc.kind === 'pool') {
      const lv = -0.1;
      quad([x0, lv, z0], [x0 + 1, lv, z0], [x0 + 1, lv, z0 + 1], [x0, lv, z0 + 1], [0, 1, 0], 1, MAT.water);
      for (let d = 0; d < 4; d++) {
        const [a, b] = DIRS[d];
        if (w.pool(dc.i + a, dc.j + b)) continue;
        const A: V3 = a ? [a > 0 ? x0 + 1 : x0, lv, z0] : [x0, lv, b > 0 ? z0 + 1 : z0], B: V3 = a ? [A[0], lv, z0 + 1] : [x0 + 1, lv, A[2]];
        quad(A, B, [B[0], 0, B[2]], [A[0], 0, A[2]], [-a, 0, -b], [0.6, 0.6, 0.9, 0.9], MAT.court);
      }
    } else cypress(dc.i, dc.j, 0, dc.born);
  }
  return { data: new Float32Array(out), count: out.length / STRIDE };

  /** an arch under a run of stone, and the stone over it: spandrels, deck, its underside lit from within */
  function span(sp: Span) {
    const { k, a, n } = sp, [di, dj] = DIRS[a], yT = k + 1, yD = yT - DECK;
    const half = n / 2, rise = Math.min(half, yD - sp.low), ys = yD - rise;
    cur = { born: sp.born, pivot: yT, how: 1, tone: tone(k, sp.i, sp.j) };
    const cx = X(sp.i) + 0.5 + (di * (n - 1)) / 2, cz = Z(sp.j) + 0.5 + (dj * (n - 1)) / 2;
    const P = (u: number, wv: number, y: number): V3 => (a === 0 ? [cx + u, y, cz + wv] : [cx + wv, y, cz + u]);
    const nW = (s: number): V3 => (a === 0 ? [0, 0, s] : [s, 0, 0]);
    const arc = (u: number) => ys + rise * Math.sqrt(Math.max(0, 1 - (u / half) ** 2));
    const S = Math.max(CURVE, n * 10);
    // (which cell of the run a point along it is in, and whether a side's hidden there)
    const cellAt = (u: number) => Math.min(n - 1, Math.max(0, Math.floor(u + half)));
    const sideHidden = (q: number, s: number) => { const ci = sp.i + q * di, cj = sp.j + q * dj, d = a === 0 ? (s > 0 ? 1 : 3) : s > 0 ? 0 : 2; return hides(k, ci, cj, d) || w.span(k, ci + DIRS[d][0], cj + DIRS[d][1])?.a === a; };
    for (let q = 0; q < S; q++) {
      const u0 = -half + (n * q) / S, u1 = -half + (n * (q + 1)) / S, um = (u0 + u1) / 2, c = cellAt(um);
      for (const s of [-1, 1]) if (!sideHidden(c, s)) quad(P(u0, s * 0.5, arc(u0)), P(u1, s * 0.5, arc(u1)), P(u1, s * 0.5, yT), P(u0, s * 0.5, yT), nW(s), [0.85, 0.85, 1, 1], MAT.stone);
      const slope = (arc(u1) - arc(u0)) / (u1 - u0), l = Math.hypot(slope, 1);
      const nu: V3 = a === 0 ? [slope / l, -1 / l, 0] : [0, -1 / l, slope / l];
      const ao = 0.55 + 0.45 * Math.min(1, (arc(um) - ys) / Math.max(0.2, rise));
      quad(P(u0, -0.5, arc(u0)), P(u1, -0.5, arc(u1)), P(u1, 0.5, arc(u1)), P(u0, 0.5, arc(u0)), nu, ao, MAT.within);
    }
    for (let s = 0; s < n; s++) topFace(k, sp.i + s * di, sp.j + s * dj, yT);
  }

  /** a cypress: a dark spindle of leaves on a short trunk */
  function cypress(i: number, j: number, y0: number, born: number) {
    const cx = X(i) + 0.5, cz = Z(j) + 0.5, Ht = 1.85, SEG = 12, RINGS = 16, seed = i * 31 + j * 17;
    cur = { born, pivot: y0, how: 2, tone: 0.5 };
    const rnd = (q: number) => { const x = Math.sin((seed * 97 + q) * 12.9898) * 43758.5453; return x - Math.floor(x); };
    for (let s = 0; s < 6; s++) {
      const a0 = (s / 6) * Math.PI * 2, a1 = ((s + 1) / 6) * Math.PI * 2, r = 0.05;
      const n: V3 = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      quad([cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], [cx + Math.cos(a1) * r, y0 + 0.2, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, y0 + 0.2, cz + Math.sin(a0) * r], n, 0.6, MAT.bark);
    }
    const prof = (t: number) => 0.27 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.92) ** 0.8), 0.85);
    const lean = rnd(99) * 0.06;
    const at = (q: number, s: number): V3 => {
      const t = q / RINGS, ang = (s / SEG) * Math.PI * 2, bump = 1 + 0.1 * Math.sin(ang * 3 + q * 1.7 + rnd(1) * 6) * Math.sin(q * 2.3);
      const r = prof(t) * (q === RINGS ? 0 : bump);
      return [cx + Math.cos(ang) * r + lean * t, y0 + 0.12 + t * Ht, cz + Math.sin(ang) * r];
    };
    for (let q = 0; q < RINGS; q++) for (let s = 0; s < SEG; s++) {
      const a = at(q, s), b = at(q, s + 1), c = at(q + 1, s + 1), d = at(q + 1, s);
      const ang = ((s + 0.5) / SEG) * Math.PI * 2, t = (q + 0.5) / RINGS, dr = (prof(t + 0.01) - prof(t - 0.01)) / (0.02 * Ht);
      const l = Math.hypot(1, dr);
      quad(a, b, c, d, [Math.cos(ang) / l, -dr / l, Math.sin(ang) / l], 0.55 + 0.45 * t, MAT.leaves);
    }
  }
}

/** Whether a point's in stone (anything a touch would strike), and so where a ray meets the build */
export function inStone(w: World, x: number, y: number, z: number): boolean {
  const e = N / 2 + MARGIN;
  if (y < 0) return y > -SLAB && Math.abs(x) < e && Math.abs(z) < e;
  const i = Math.floor(x + N / 2), j = Math.floor(z + N / 2), k = Math.floor(y);
  if (k >= LEVELS || i < 0 || j < 0 || i >= N || j >= N) return false;
  const fx = x + N / 2 - i - 0.5, fz = z + N / 2 - j - 0.5, fy = y - k;
  if (w.stone(k, i, j)) {
    const sp = w.span(k, i, j);
    if (!sp) return true;
    // (over an arch: stone above its curve)
    const half = sp.n / 2, yD = k + 1 - DECK, rise = Math.min(half, yD - sp.low), ys = yD - rise;
    const u = (sp.a === 0 ? i - sp.i : j - sp.j) + (sp.a === 0 ? fx : fz) + 0.5 - half;
    return y > ys + rise * Math.sqrt(Math.max(0, 1 - (u / half) ** 2));
  }
  const d = w.stair(k, i, j);
  if (d >= 0) { const [a, b] = DIRS[d], u = 0.5 + (a ? a * fx : b * fz); return fy < Math.ceil(Math.max(0.001, u) * STEPS) / STEPS; }
  if (w.pier(k, i, j)) return Math.abs(fx) < PIER && Math.abs(fz) < PIER;
  // (the air under an arch over this cell: its upper part's the arch's stone)
  for (let kk = k + 1; kk < LEVELS; kk++) {
    const sp = w.span(kk, i, j);
    if (!sp) { if (w.occupied(kk, i, j)) break; continue; }
    const half = sp.n / 2, yD = kk + 1 - DECK, rise = Math.min(half, yD - sp.low), ys = yD - rise;
    const u = (sp.a === 0 ? i - sp.i : j - sp.j) + (sp.a === 0 ? fx : fz) + 0.5 - half;
    return y > ys + rise * Math.sqrt(Math.max(0, 1 - (u / half) ** 2));
  }
  return false;
}
