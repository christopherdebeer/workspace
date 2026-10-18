/**
 * The labyrinth's stone, as triangles (model.ts says what's there): each face with how it's lit (its normal, how shut
 * in it is), what it's made of, and how it rises (when it was built, the height it grows from).
 *
 * - **block**: its faces where nothing's against them, darker at the foot where they meet a floor.
 * - **arch**: a block with a way through, its jambs and its round head lit from within (as light gathers in the
 *   prints' archways); on an arch the same way, one tall arch.
 * - **stair**: six steps up one level.
 * - **bridge**: a deck on one arch, from support to support, springing as low as both supports go (so between two tall
 *   towers it's a great round arch), with a low parapet each side.
 * - **cypress**: a tall dark spindle of a tree.
 * - **pool**: water let into the stone.
 * - **the stone and the table**: the travertine slab it's all built on, on a table in the sun.
 *
 * x and z are centred on the slab; y up, the slab's top at 0.
 */
import { DECK, DIRS, LEVELS, N, type Labyrinth, type Piece } from './model';

/** floats a vertex: position, normal, ao (1 open .. 0 shut in), material (MAT), its rising (when built, the height it
 * grows from, and how: 1 up from there, 2 out from its foot as a tree), and a seed for its stone's tone */
export const STRIDE = 12;
/** what a face is made of */
export const MAT = { stone: 0, within: 1, water: 2, leaves: 3, bark: 4, slab: 5, slabSide: 6, table: 7 };
export const MARGIN = 0.6, SLAB = 0.42;
const STEPS = 6, CURVE = 14, HW = 0.3;

export interface Mesh { data: Float32Array; count: number }
type V3 = [number, number, number];
const X = (i: number) => i - N / 2, Z = (j: number) => j - N / 2;

export function buildMesh(m: Labyrinth): Mesh {
  const out: number[] = [];
  let cur = { born: -1e3, pivot: 0, how: 1, tone: 0 };
  const vert = (p: V3, n: V3, ao: number, mat: number) => out.push(p[0], p[1], p[2], n[0], n[1], n[2], ao, mat, cur.born, cur.pivot, cur.how, cur.tone);
  /** a quad a b c d (in order round it), facing n: wound to face it */
  const quad = (a: V3, b: V3, c: V3, d: V3, n: V3, ao: number[] | number, mat: number) => {
    const A = typeof ao === 'number' ? [ao, ao, ao, ao] : ao;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
    const P = flip ? [a, d, c, b] : [a, b, c, d], Q = flip ? [A[0], A[3], A[2], A[1]] : A;
    for (const k of [0, 1, 2, 0, 2, 3]) vert(P[k], n, Q[k], mat);
  };
  /** is a cell's face toward a neighbour hidden against it (a block, an arch's solid side, a stair's back) */
  const hides = (k: number, i: number, j: number, d: number) => {
    const c = m.at(k, i + DIRS[d][0], j + DIRS[d][1]);
    if (!c) return false;
    if (c.p.kind === 'block') return true;
    if (c.p.kind === 'arch') return c.p.a !== d % 2;
    if (c.p.kind === 'stair') return (c.p.a + 2) % 4 === d;
    return false;
  };
  /** a floor in front of a face at level k (so its foot's shut in) */
  const floored = (k: number, i: number, j: number) => m.floor(k, i, j) && !m.solid(k, i, j);
  const cornerAo = (k: number, i: number, j: number) => {
    const s = (a: number, b: number) => (m.solid(k, i + a, j + b) ? 1 : 0);
    const c = (a: number, b: number) => { const s1 = s(a, 0), s2 = s(0, b), d = s(a, b); return s1 && s2 ? 0 : 3 - s1 - s2 - d; };
    return [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)].map((v) => 0.55 + v * 0.15);
  };
  /** a cell's four sides, each a quad from y0 to y1 (but those skipped, or hidden) */
  const sides = (k: number, i: number, j: number, y0: number, y1: number, mat: number, skip: (d: number) => boolean = () => false) => {
    const x0 = X(i), z0 = Z(j);
    for (let d = 0; d < 4; d++) {
      if (skip(d) || hides(k, i, j, d)) continue;
      const [a, b] = DIRS[d], foot = floored(k, i + a, j + b) ? 0.6 : 1;
      const A: V3 = a ? [a > 0 ? x0 + 1 : x0, y0, z0] : [x0, y0, b > 0 ? z0 + 1 : z0], B: V3 = a ? [A[0], y0, z0 + 1] : [x0 + 1, y0, A[2]];
      quad(A, B, [B[0], y1, B[2]], [A[0], y1, A[2]], [a, 0, b], [foot, foot, 1, 1], mat);
    }
  };
  const topFace = (k: number, i: number, j: number, y: number, mat = MAT.stone) => {
    const x0 = X(i), z0 = Z(j);
    quad([x0, y, z0], [x0 + 1, y, z0], [x0 + 1, y, z0 + 1], [x0, y, z0 + 1], [0, 1, 0], cornerAo(k + 1, i, j), mat);
  };
  const covered = (k: number, i: number, j: number) => { const c = m.kindAt(k + 1, i, j); return c === 'block' || c === 'stair'; };

  // ─── the stone, and the table it's on ───
  {
    const e = N / 2 + MARGIN;
    for (let j = -1; j <= N; j++) for (let i = -1; i <= N; i++) {
      const inside = i >= 0 && j >= 0 && i < N && j < N;
      if (inside && (m.pool(i, j) || m.solid(0, i, j))) continue;
      const x0 = i < 0 ? -e : X(i), x1 = i >= N ? e : X(i + 1), z0 = j < 0 ? -e : Z(j), z1 = j >= N ? e : Z(j + 1);
      quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [0, 1, 0], inside ? cornerAo(0, i, j) : 1, MAT.slab);
    }
    const T = 70, R = 1.6;
    for (let d = 0; d < 4; d++) {
      const [a, b] = DIRS[d], n: V3 = [a, 0, b];
      const c0: V3 = a ? [a * e, 0, -e] : [-e, 0, b * e], c1: V3 = a ? [a * e, 0, e] : [e, 0, b * e];
      quad(c0, c1, [c1[0], -SLAB, c1[2]], [c0[0], -SLAB, c0[2]], n, [1, 1, 0.7, 0.7], MAT.slabSide);
      // (the table round it: shut in close to its foot)
      const o0: V3 = a ? [a * (e + R), -SLAB, -(e + R)] : [-(e + R), -SLAB, b * (e + R)], o1: V3 = a ? [a * (e + R), -SLAB, e + R] : [e + R, -SLAB, b * (e + R)];
      quad([c0[0], -SLAB, c0[2]], [c1[0], -SLAB, c1[2]], o1, o0, [0, 1, 0], [0.5, 0.5, 1, 1], MAT.table);
    }
    for (const [x0, z0, x1, z1] of [[-T, -T, T, -(e + R)], [-T, e + R, T, T], [-T, -(e + R), -(e + R), e + R], [e + R, -(e + R), T, e + R]]) quad([x0, -SLAB, z0], [x1, -SLAB, z0], [x1, -SLAB, z1], [x0, -SLAB, z1], [0, 1, 0], 1, MAT.table);
  }

  for (const p of m.pieces) {
    cur = { born: p.born, pivot: p.k, how: 1, tone: ((p.id * 2654435761) >>> 0) / 4294967296 };
    const { k, i, j } = p, x0 = X(i), z0 = Z(j), y0 = k, y1 = k + 1;
    if (p.kind === 'block') {
      sides(k, i, j, y0, y1, MAT.stone);
      if (!covered(k, i, j)) topFace(k, i, j, y1);
    } else if (p.kind === 'arch') archCell(p);
    else if (p.kind === 'stair') {
      const d = p.a, [a, b] = DIRS[d];
      // (u along the flight, from its foot to its head; w across it)
      const pt = (u: number, w: number, y: number): V3 => { const cx = x0 + 0.5, cz = z0 + 0.5; return a ? [cx + a * (u - 0.5), y, cz + (w - 0.5)] : [cx + (w - 0.5), y, cz + b * (u - 0.5)]; };
      const across = [a ? (d + 1) % 4 : (d + 3) % 4, a ? (d + 3) % 4 : (d + 1) % 4];
      for (let s = 0; s < STEPS; s++) {
        const u0 = s / STEPS, u1 = (s + 1) / STEPS, h = y0 + (s + 1) / STEPS, h0 = y0 + s / STEPS;
        quad(pt(u0, 0, h), pt(u1, 0, h), pt(u1, 1, h), pt(u0, 1, h), [0, 1, 0], [0.8, 0.95, 0.95, 0.8], MAT.stone);
        quad(pt(u0, 0, h0), pt(u0, 1, h0), pt(u0, 1, h), pt(u0, 0, h), [-a, 0, -b], [0.65, 0.65, 0.9, 0.9], MAT.stone);
        for (const q of [0, 1]) {
          const dd = DIRS[across[q]];
          if (hides(k, i, j, across[q])) continue;
          // (the side toward this way: w = 0 or 1, whichever lies that way)
          const w = (a ? dd[1] : dd[0]) > 0 ? 1 : 0;
          quad(pt(u0, w, y0), pt(u1, w, y0), pt(u1, w, h), pt(u0, w, h), [dd[0], 0, dd[1]], [0.7, 0.7, 1, 1], MAT.stone);
        }
      }
      if (!hides(k, i, j, d)) quad(pt(1, 0, y0), pt(1, 1, y0), pt(1, 1, y1), pt(1, 0, y1), [a, 0, b], [0.7, 0.7, 1, 1], MAT.stone);
    } else if (p.kind === 'bridge') bridge(p);
    else if (p.kind === 'cypress') cypress(p);
    else if (p.kind === 'pool') {
      cur.pivot = -0.4;
      const w = -0.1;
      quad([x0, w, z0], [x0 + 1, w, z0], [x0 + 1, w, z0 + 1], [x0, w, z0 + 1], [0, 1, 0], 1, MAT.water);
      for (let d = 0; d < 4; d++) {
        const [a, b] = DIRS[d];
        if (m.pool(i + a, j + b)) continue;
        // (its rim, facing in)
        const A: V3 = a ? [a > 0 ? x0 + 1 : x0, w, z0] : [x0, w, b > 0 ? z0 + 1 : z0], B: V3 = a ? [A[0], w, z0 + 1] : [x0 + 1, w, A[2]];
        quad(A, B, [B[0], 0, B[2]], [A[0], 0, A[2]], [-a, 0, -b], [0.6, 0.6, 0.9, 0.9], MAT.slab);
      }
    }
  }
  return { data: new Float32Array(out), count: out.length / STRIDE };

  /** an arch: a block with a way through along its axis; tall, if there's an arch the same way under or over it */
  function archCell(p: Piece) {
    const { k, i, j, a } = p, y0 = k, y1 = k + 1;
    const under = m.at(k - 1, i, j)?.p, over = m.at(k + 1, i, j)?.p;
    const lower = over?.kind === 'arch' && over.a === a, upper = under?.kind === 'arch' && under.a === a;
    const ys = y0 + (upper ? 0.55 : 0.5), cx = X(i) + 0.5, cz = Z(j) + 0.5;
    // (u along the way through, w across it)
    const P = (u: number, w: number, y: number): V3 => (a === 0 ? [cx + u, y, cz + w] : [cx + w, y, cz + u]);
    const nU = (s: number): V3 => (a === 0 ? [s, 0, 0] : [0, 0, s]), nW = (s: number): V3 => (a === 0 ? [0, 0, s] : [s, 0, 0]);
    // (its solid sides, across the way)
    sides(k, i, j, y0, y1, MAT.stone, (d) => d % 2 === a);
    // (its two faces, the way through cut out of them)
    const head = (t: number) => (lower ? y1 : ys + Math.sqrt(Math.max(0, HW * HW - t * t)));
    for (const s of [-1, 1]) {
      const d = a === 0 ? (s > 0 ? 0 : 2) : s > 0 ? 1 : 3;
      if (hides(k, i, j, d)) continue;
      const foot = floored(k, i + DIRS[d][0], j + DIRS[d][1]) && !upper ? 0.6 : 1;
      quad(P(s * 0.5, -0.5, y0), P(s * 0.5, -HW, y0), P(s * 0.5, -HW, y1), P(s * 0.5, -0.5, y1), nU(s), [foot, foot, 1, 1], MAT.stone);
      quad(P(s * 0.5, HW, y0), P(s * 0.5, 0.5, y0), P(s * 0.5, 0.5, y1), P(s * 0.5, HW, y1), nU(s), [foot, foot, 1, 1], MAT.stone);
      if (!lower) for (let q = 0; q < CURVE; q++) {
        const t0 = -HW + (2 * HW * q) / CURVE, t1 = -HW + (2 * HW * (q + 1)) / CURVE;
        quad(P(s * 0.5, t0, head(t0)), P(s * 0.5, t1, head(t1)), P(s * 0.5, t1, y1), P(s * 0.5, t0, y1), nU(s), 1, MAT.stone);
      }
    }
    // (within: its jambs, and its head)
    for (const s of [-1, 1]) quad(P(-0.5, s * HW, y0), P(0.5, s * HW, y0), P(0.5, s * HW, lower ? y1 : ys), P(-0.5, s * HW, lower ? y1 : ys), nW(-s), upper ? 0.85 : [0.7, 0.7, 0.95, 0.95], MAT.within);
    if (!lower) for (let q = 0; q < CURVE; q++) {
      const t0 = -HW + (2 * HW * q) / CURVE, t1 = -HW + (2 * HW * (q + 1)) / CURVE, tm = (t0 + t1) / 2;
      const n = nW(-tm / HW); n[1] = -Math.sqrt(Math.max(0, HW * HW - tm * tm)) / HW;
      quad(P(-0.5, t0, head(t0)), P(0.5, t0, head(t0)), P(0.5, t1, head(t1)), P(-0.5, t1, head(t1)), n, 0.95, MAT.within);
    }
    // (its top: whole, or open where a tall arch goes on up)
    if (!covered(k, i, j)) {
      if (lower) for (const [w0, w1] of [[-0.5, -HW], [HW, 0.5]]) quad(P(-0.5, w0, y1), P(0.5, w0, y1), P(0.5, w1, y1), P(-0.5, w1, y1), [0, 1, 0], 1, MAT.stone);
      else topFace(k, i, j, y1);
    }
  }

  /** a bridge: a deck on one arch, the whole gap wide, a parapet each side */
  function bridge(p: Piece) {
    const { k, a, n } = p, [di, dj] = DIRS[a], yT = k + 1, yD = yT - DECK;
    // (it springs as low as stone goes on both sides: from a level's foot)
    const low = p.low ?? k;
    const half = n / 2, rise = Math.min(half, yD - low), ys = yD - rise;
    cur.pivot = yT;
    const cx = X(p.i) + 0.5 + (di * (n - 1)) / 2, cz = Z(p.j) + 0.5 + (dj * (n - 1)) / 2;
    const P = (u: number, w: number, y: number): V3 => (a === 0 ? [cx + u, y, cz + w] : [cx + w, y, cz + u]);
    const nW = (s: number): V3 => (a === 0 ? [0, 0, s] : [s, 0, 0]);
    const arc = (u: number) => ys + rise * Math.sqrt(Math.max(0, 1 - (u / half) ** 2));
    const S = Math.max(CURVE, n * 10);
    for (let q = 0; q < S; q++) {
      const u0 = -half + (n * q) / S, u1 = -half + (n * (q + 1)) / S, um = (u0 + u1) / 2;
      // (its spandrels, each side)
      for (const s of [-1, 1]) quad(P(u0, s * 0.5, arc(u0)), P(u1, s * 0.5, arc(u1)), P(u1, s * 0.5, yT), P(u0, s * 0.5, yT), nW(s), [0.85, 0.85, 1, 1], MAT.stone);
      // (its soffit: the underside of the arch, lit from within a little)
      const slope = (arc(u1) - arc(u0)) / (u1 - u0), l = Math.hypot(slope, 1);
      const nu: V3 = a === 0 ? [slope / l, -1 / l, 0] : [0, -1 / l, slope / l];
      const ao = 0.55 + 0.45 * Math.min(1, (arc(um) - ys) / Math.max(0.2, rise));
      quad(P(u0, -0.5, arc(u0)), P(u1, -0.5, arc(u1)), P(u1, 0.5, arc(u1)), P(u0, 0.5, arc(u0)), nu, ao, MAT.within);
    }
    // (its deck, and a low parapet each side)
    quad(P(-half, -0.5, yT), P(half, -0.5, yT), P(half, 0.5, yT), P(-half, 0.5, yT), [0, 1, 0], 0.9, MAT.stone);
    const ph = 0.2, pt = 0.09;
    for (const s of [-1, 1]) {
      const w0 = s * 0.5, w1 = s * (0.5 - pt);
      quad(P(-half, w0, yT), P(half, w0, yT), P(half, w0, yT + ph), P(-half, w0, yT + ph), nW(s), 1, MAT.stone);
      quad(P(-half, w1, yT), P(half, w1, yT), P(half, w1, yT + ph), P(-half, w1, yT + ph), nW(-s), [0.7, 0.7, 1, 1], MAT.stone);
      quad(P(-half, w0, yT + ph), P(half, w0, yT + ph), P(half, w1, yT + ph), P(-half, w1, yT + ph), [0, 1, 0], 1, MAT.stone);
    }
  }

  /** a cypress: a dark spindle of leaves on a short trunk */
  function cypress(p: Piece) {
    const cx = X(p.i) + 0.5, cz = Z(p.j) + 0.5, y0 = p.k, Ht = 1.85, SEG = 12, RINGS = 16;
    cur.how = 2;
    const rnd = (q: number) => { const x = Math.sin((p.id * 97 + q) * 12.9898) * 43758.5453; return x - Math.floor(x); };
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

/** Whether a point's in stone (or leaves: anything a touch would strike) */
export function inStone(m: Labyrinth, x: number, y: number, z: number): boolean {
  const e = N / 2 + MARGIN;
  if (y < 0) return y > -SLAB && Math.abs(x) < e && Math.abs(z) < e;
  const i = Math.floor(x + N / 2), j = Math.floor(z + N / 2), k = Math.floor(y);
  if (k >= LEVELS) return false;
  const c = m.at(k, i, j);
  if (!c) return false;
  const p = c.p, fx = x + N / 2 - i - 0.5, fz = z + N / 2 - j - 0.5, fy = y - k;
  switch (p.kind) {
    case 'block': return true;
    case 'arch': { const w = p.a === 0 ? fz : fx; return Math.abs(w) > HW || fy > 0.5 + Math.sqrt(Math.max(0, HW * HW - w * w)); }
    case 'stair': { const [a, b] = DIRS[p.a], u = 0.5 + (a ? a * fx : b * fz); return fy < Math.ceil(Math.max(0.001, u) * STEPS) / STEPS; }
    case 'bridge': return c.at >= 0 && fy > 1 - DECK - 0.15;
    case 'cypress': return Math.hypot(fx, fz) < 0.28;
    default: return false;
  }
}
