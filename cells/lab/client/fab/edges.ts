/**
 * The cutting table's geometry, after GarmentCode (Korosteleva & Sorkine-Hornung 2023): a piece's outline is edges, each
 * a straight line, a circle's arc or a Bézier curve, and a curve's control points are kept *relative to its chord* (a
 * point (t, s) is t of the way along the chord and s of the chord's length to its left), so its shape survives any move
 * of its ends. A piece is four runs of edges round it (its top, its two sides, its foot) and its cloth is a grid laid
 * over them: a Coons patch, each side's points spread by length along it and every corner between two edges on a grid
 * point. So a bodice with its armholes and neckline, a sleeve with its head, a trouser leg with its crotch curve are
 * all the same grid the skirt's panels always were, and the cloth (cloth.ts) needs nothing new to sew them.
 *
 * Where pieces meet is named: each edge of a run is a span of the piece's boundary points, and a seam is two spans sewn
 * by length (GarmentCode's stitches): a point of one to the place the same fraction along the other. Two spans of
 * different lengths gather the longer onto the shorter, which is what a gathered waist, a puffed sleeve head or a
 * skirt's tier is.
 */
import type { V3 } from './body';

export type P2 = [number, number];
/** a point of a piece's grid: piece, column, row */
export type At = [number, number, number];
export interface Mark { kind: 'dart' | 'pleat' | 'gather' | 'button' | 'fold'; pts: P2[] }
export interface Piece {
  name: string; kind: 'panel' | 'band';
  /** grid points across and down, less one */
  nu: number; nv: number;
  /** the flat pattern, cm (x across, y up) */
  flat: (u: number, v: number) => [number, number];
  /** the warp's direction on the piece: radians from its centre line (straight down) */
  grain: number;
  /** where it's laid out round the figure before it's sewn */
  start: (u: number, v: number) => V3;
  /** on the pattern sheet: what it's called, how many to cut; pieces that are another's mirror or copy aren't drawn */
  label?: string; cut?: number; drawn?: boolean;
  /** the dressmaker's marks on it, in its flat coordinates */
  marks?: Mark[];
  /** its named edges: the grid points along each, in order */
  spans?: Record<string, Array<[number, number]>>;
}
export interface Pair { a: At; b: At; b1?: At; t?: number; why: string }
export interface Check { name: string; ok: boolean; detail: string }

const TAU = Math.PI * 2;
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const lerp2 = (a: P2, b: P2, t: number): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const dist2 = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// ─── edges ─────────────────────────────────────────────────────────────────────────────────────
/** an edge: where it goes, by length along it (f from 0 to 1), how long it is, and its name if it's a seam */
export interface Edge { a: P2; b: P2; at: (f: number) => P2; len: number; name?: string }

/** an edge from a parametric curve, tabulated so it's read by length */
export function tabulate(a: P2, b: P2, c: (t: number) => P2, name?: string, n = 96): Edge {
  const pts: P2[] = [], acc = [0];
  for (let k = 0; k <= n; k++) pts.push(k === 0 ? a : k === n ? b : c(k / n));
  for (let k = 1; k <= n; k++) acc.push(acc[k - 1] + dist2(pts[k - 1], pts[k]));
  const len = acc[n];
  const at = (f: number): P2 => {
    if (f <= 0) return [a[0], a[1]];
    if (f >= 1) return [b[0], b[1]];
    const s = f * len;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (acc[m] <= s) lo = m; else hi = m; }
    return lerp2(pts[lo], pts[lo + 1], (s - acc[lo]) / Math.max(1e-12, acc[lo + 1] - acc[lo]));
  };
  return { a, b, at, len, name };
}
/** a point given relative to a chord: t along it, s of its length to its left */
export function rel(a: P2, b: P2, t: number, s: number): P2 {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  return [a[0] + t * ex - s * ey, a[1] + t * ey + s * ex];
}
export function line(a: P2, b: P2, name?: string): Edge {
  return { a, b, at: (f) => lerp2(a, b, clamp(f, 0, 1)), len: dist2(a, b), name };
}
/** a Bézier: one control point (quadratic) or two (cubic), each relative to the chord */
export function curve(a: P2, b: P2, cps: Array<[number, number]>, name?: string): Edge {
  const c = cps.map(([t, s]) => rel(a, b, t, s));
  if (c.length === 1) return tabulate(a, b, (t) => { const u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0][0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[0][1] + t * t * b[1]]; }, name);
  return tabulate(a, b, (t) => {
    const u = 1 - t;
    return [u * u * u * a[0] + 3 * u * u * t * c[0][0] + 3 * u * t * t * c[1][0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c[0][1] + 3 * u * t * t * c[1][1] + t * t * t * b[1]];
  }, name);
}
/** a cubic with its control points given outright (cm), for curves set by how they leave and arrive */
export function cubic(a: P2, c1: P2, c2: P2, b: P2, name?: string): Edge {
  return tabulate(a, b, (t) => {
    const u = 1 - t;
    return [u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]];
  }, name);
}
/** a circle's arc through the chord's ends and the point (½, cy) relative to it (GarmentCode's CircleEdge) */
export function arc(a: P2, b: P2, cy: number, name?: string): Edge {
  if (Math.abs(cy) < 1e-6) return line(a, b, name);
  const m = rel(a, b, 0.5, cy);
  // (the circle through a, m, b)
  const ax = a[0], ay = a[1], bx = m[0], by = m[1], cx = b[0], cyy = b[1];
  const d = 2 * (ax * (by - cyy) + bx * (cyy - ay) + cx * (ay - by));
  const ux = ((ax * ax + ay * ay) * (by - cyy) + (bx * bx + by * by) * (cyy - ay) + (cx * cx + cyy * cyy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cyy * cyy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy), t0 = Math.atan2(ay - uy, ax - ux), tm = Math.atan2(by - uy, bx - ux);
  let t1 = Math.atan2(cyy - uy, cx - ux);
  // (the way round that passes through m)
  const norm = (x: number) => ((x % TAU) + TAU) % TAU;
  const ccw = norm(tm - t0) < norm(t1 - t0);
  if (ccw) { if (t1 < t0) t1 += TAU; } else { if (t1 > t0) t1 -= TAU; }
  return tabulate(a, b, (t) => { const th = t0 + (t1 - t0) * t; return [ux + Math.cos(th) * r, uy + Math.sin(th) * r]; }, name);
}
/** an edge run backwards */
export function reverse(e: Edge): Edge { return { a: e.b, b: e.a, at: (f) => e.at(1 - f), len: e.len, name: e.name }; }
/** an edge mirrored left to right (x → −x), still running the same way (a side seam's top to its foot) */
export function flipX(e: Edge): Edge { const m = (p: P2): P2 => [-p[0], p[1]]; return { a: m(e.a), b: m(e.b), at: (f) => m(e.at(f)), len: e.len, name: e.name }; }
/** an edge mirrored left to right (x → −x), and run the other way so a run of them still goes left to right */
export function mirror(e: Edge): Edge { const m = (p: P2): P2 => [-p[0], p[1]]; return { a: m(e.b), b: m(e.a), at: (f) => m(e.at(1 - f)), len: e.len, name: e.name }; }
/** an edge moved */
export function shift(e: Edge, dx: number, dy: number): Edge { const s = (p: P2): P2 => [p[0] + dx, p[1] + dy]; return { a: s(e.a), b: s(e.b), at: (f) => s(e.at(f)), len: e.len, name: e.name }; }
export const runLength = (r: Edge[]) => r.reduce((s, e) => s + e.len, 0);

/** the height (y) a run of edges is at, across at x: for an edge that runs left to right */
export function yAt(r: Edge[], x: number): number {
  for (const e of r) {
    const x0 = Math.min(e.a[0], e.b[0]), x1 = Math.max(e.a[0], e.b[0]);
    if (x < x0 - 1e-9 || x > x1 + 1e-9) continue;
    let lo = 0, hi = 1;
    const inc = e.b[0] >= e.a[0];
    for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2, px = e.at(m)[0]; if ((px < x) === inc) lo = m; else hi = m; }
    return e.at((lo + hi) / 2)[1];
  }
  return NaN;
}

// ─── pieces ────────────────────────────────────────────────────────────────────────────────────
/** how many grid steps each edge of a run gets: by length, at least one each, summing to n */
function share(r: Edge[], n: number): number[] {
  const L = runLength(r), raw = r.map((e) => (e.len / L) * n), out = raw.map((x) => Math.max(1, Math.floor(x)));
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length) { out[order[k][1]]++; left--; }
  while (left < 0) { const i = out.indexOf(Math.max(...out)); out[i]--; left++; }
  return out;
}
/** a run read by grid position: g from 0 to 1, each edge over its share of the steps */
function reader(r: Edge[], counts: number[]) {
  const n = counts.reduce((a, b) => a + b, 0), cum = [0];
  for (const c of counts) cum.push(cum[cum.length - 1] + c);
  return (g: number): P2 => {
    const x = clamp(g, 0, 1) * n;
    let k = 0;
    while (k < counts.length - 1 && x > cum[k + 1]) k++;
    return r[k].at((x - cum[k]) / counts[k]);
  };
}

export interface Patch {
  name: string; kind?: 'panel' | 'band';
  /** the four runs: top and foot run left to right (u), the sides top to foot (v); their ends meet at the corners */
  top: Edge[]; foot: Edge[]; left: Edge[]; right: Edge[];
  /** about how far apart the grid's points are (cm) */
  h: number;
  grain?: number;
  start: Piece['start'];
  label?: string; cut?: number; drawn?: boolean; marks?: Mark[];
  /** at least this many steps across / down */
  minU?: number; minV?: number;
}
/** a piece from four runs of edges round it (a Coons patch) */
export function patch(o: Patch): Piece {
  const near = (p: P2, q: P2) => dist2(p, q) < 1e-3;
  const T = o.top, F = o.foot, Lr = o.left, R = o.right;
  if (!near(T[0].a, Lr[0].a) || !near(T[T.length - 1].b, R[0].a) || !near(F[0].a, Lr[Lr.length - 1].b) || !near(F[F.length - 1].b, R[R.length - 1].b))
    throw new Error(`${o.name}: its edges don't meet at the corners`);
  const nu = Math.max(o.minU ?? 3, T.length, F.length, Math.round(Math.max(runLength(T), runLength(F)) / o.h));
  const nv = Math.max(o.minV ?? 3, Lr.length, R.length, Math.round(Math.max(runLength(Lr), runLength(R)) / o.h));
  const cT = share(T, nu), cF = share(F, nu), cL = share(Lr, nv), cR = share(R, nv);
  const tT = reader(T, cT), tF = reader(F, cF), tL = reader(Lr, cL), tR = reader(R, cR);
  const p00 = T[0].a, p10 = T[T.length - 1].b, p01 = F[0].a, p11 = F[F.length - 1].b;
  const flat = (u: number, v: number): [number, number] => {
    const t = tT(u), f = tF(u), l = tL(v), r = tR(v);
    return [
      (1 - v) * t[0] + v * f[0] + (1 - u) * l[0] + u * r[0] - ((1 - u) * (1 - v) * p00[0] + u * (1 - v) * p10[0] + (1 - u) * v * p01[0] + u * v * p11[0]),
      (1 - v) * t[1] + v * f[1] + (1 - u) * l[1] + u * r[1] - ((1 - u) * (1 - v) * p00[1] + u * (1 - v) * p10[1] + (1 - u) * v * p01[1] + u * v * p11[1]),
    ];
  };
  // (the named edges, as runs of grid points: the top and foot left to right, the sides top to foot)
  const spans: Record<string, Array<[number, number]>> = {};
  const name = (r: Edge[], counts: number[], pt: (k: number) => [number, number]) => {
    let c = 0;
    r.forEach((e, k) => { if (e.name) spans[e.name] = Array.from({ length: counts[k] + 1 }, (_, q) => pt(c + q)); c += counts[k]; });
  };
  name(T, cT, (i) => [i, 0]); name(F, cF, (i) => [i, nv]); name(Lr, cL, (j) => [0, j]); name(R, cR, (j) => [nu, j]);
  return { name: o.name, kind: o.kind ?? 'panel', nu, nv, flat, grain: o.grain ?? 0, start: o.start, label: o.label, cut: o.cut, drawn: o.drawn, marks: o.marks, spans };
}

/** the outline of a piece, round it: top, right side, foot back, left side up */
export function outline(p: Piece): P2[] {
  const o: P2[] = [];
  for (let i = 0; i <= p.nu; i++) o.push(p.flat(i / p.nu, 0));
  for (let j = 1; j <= p.nv; j++) o.push(p.flat(1, j / p.nv));
  for (let i = p.nu - 1; i >= 0; i--) o.push(p.flat(i / p.nu, 1));
  for (let j = p.nv - 1; j > 0; j--) o.push(p.flat(0, j / p.nv));
  return o;
}
/** a piece's flat area (cm²) */
export function areaOf(p: Piece): number {
  let a = 0;
  for (let j = 0; j < p.nv; j++) for (let i = 0; i < p.nu; i++) {
    const q00 = p.flat(i / p.nu, j / p.nv), q10 = p.flat((i + 1) / p.nu, j / p.nv), q01 = p.flat(i / p.nu, (j + 1) / p.nv), q11 = p.flat((i + 1) / p.nu, (j + 1) / p.nv);
    a += Math.abs((q11[0] - q00[0]) * (q01[1] - q10[1]) - (q01[0] - q10[0]) * (q11[1] - q00[1])) / 2;
  }
  return a;
}
/** the grid laid over a piece is sound: every cell the same way round, none folded or crushed (its worst cell's
 * smallest corner, in degrees, and whether any is turned over) */
export function gridHealth(p: Piece): { ok: boolean; worst: number; flipped: number } {
  let worst = 180, flipped = 0, sign = 0;
  for (let j = 0; j < p.nv; j++) for (let i = 0; i < p.nu; i++) {
    const q = [p.flat(i / p.nu, j / p.nv), p.flat((i + 1) / p.nu, j / p.nv), p.flat((i + 1) / p.nu, (j + 1) / p.nv), p.flat(i / p.nu, (j + 1) / p.nv)];
    for (let k = 0; k < 4; k++) {
      const a = q[k], b = q[(k + 1) % 4], c = q[(k + 3) % 4];
      const e1: P2 = [b[0] - a[0], b[1] - a[1]], e2: P2 = [c[0] - a[0], c[1] - a[1]];
      const cr = e1[0] * e2[1] - e1[1] * e2[0], l = Math.hypot(...e1) * Math.hypot(...e2);
      if (l < 1e-9) continue;
      const s = Math.sign(cr);
      if (!sign && s) sign = s;
      if (s && s !== sign) flipped++;
      worst = Math.min(worst, (Math.asin(clamp(Math.abs(cr) / l, 0, 1)) * 180) / Math.PI);
    }
  }
  return { ok: flipped === 0 && worst > 12, worst, flipped };
}

// ─── seams ─────────────────────────────────────────────────────────────────────────────────────
/** a span: a run of grid points on one piece (its index), in order */
export interface Span { piece: number; pts: Array<[number, number]> }
export const at = (s: Span, k: number): At => [s.piece, s.pts[k][0], s.pts[k][1]];
/** spans joined end to end (round a neckline, a hem): a loop's points, in order */
export type Run = At[];
export const run = (...spans: Span[]): Run => spans.flatMap((s) => s.pts.map((p): At => [s.piece, p[0], p[1]]));
export const backwards = (r: Run): Run => r.slice().reverse();
/** each point's fraction of the way along a run, by the flat length of its pieces' edges (a jump between two pieces
 * is no length: they're sewn together there) */
export function fractions(pieces: Piece[], r: Run): { f: number[]; len: number } {
  const acc = [0];
  for (let k = 1; k < r.length; k++) {
    const a = r[k - 1], b = r[k];
    if (a[0] !== b[0]) { acc.push(acc[k - 1]); continue; }
    const pa = pieces[a[0]], pb = pieces[b[0]];
    acc.push(acc[k - 1] + dist2(pa.flat(a[1] / pa.nu, a[2] / pa.nv), pb.flat(b[1] / pb.nu, b[2] / pb.nv)));
  }
  const len = acc[acc.length - 1];
  return { f: acc.map((x) => (len > 0 ? x / len : 0)), len };
}
/** where a fraction f falls on a run: between which two of its points, and how far */
function locate(r: Run, f: number[], x: number): { b: At; b1: At; t: number } {
  let lo = 0, hi = f.length - 1;
  if (x <= f[0]) return { b: r[0], b1: r[0], t: 0 };
  if (x >= f[hi]) return { b: r[hi], b1: r[hi], t: 0 };
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m] <= x) lo = m; else hi = m; }
  const span = f[hi] - f[lo], t = span > 1e-9 ? (x - f[lo]) / span : 0;
  if (t < 2e-3) return { b: r[lo], b1: r[lo], t: 0 };
  if (t > 1 - 2e-3) return { b: r[hi], b1: r[hi], t: 0 };
  return { b: r[lo], b1: r[hi], t };
}
export interface Seam { why: string; a: number; b: number; ratio: number; want: number; tol: number }
/**
 * Sew run A to run B by length: every point of each to the place the same fraction along the other. `map` (optional)
 * gives each of A's points its own fraction along B (a skirt's waist, its folds closed, round a bodice's hem).
 * Returns the stitches and the seam's two lengths, for the pattern's checks.
 */
export function sew(pieces: Piece[], A: Run, B: Run, why: string, o: { want?: number; tol?: number; map?: number[] } = {}): { pairs: Pair[]; seam: Seam } {
  const fa = fractions(pieces, A), fb = fractions(pieces, B), pairs: Pair[] = [];
  const mapA = o.map ?? fa.f;
  const sameAt = (p: At, q: At) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
  for (let k = 0; k < A.length; k++) { const l = locate(B, fb.f, mapA[k]); if (!sameAt(A[k], l.b) || l.t) pairs.push({ a: A[k], b: l.b, b1: l.b1, t: l.t, why }); }
  // (and B's points back onto A: through the same map, read the other way)
  for (let k = 1; k < B.length - 1; k++) {
    const x = fb.f[k];
    let j = 0;
    while (j < A.length - 2 && mapA[j + 1] < x) j++;
    const s0 = mapA[j], s1 = mapA[j + 1], t = s1 - s0 > 1e-9 ? clamp((x - s0) / (s1 - s0), 0, 1) : 0;
    if (t >= 2e-3 && t <= 1 - 2e-3) pairs.push({ a: B[k], b: A[j], b1: A[j + 1], t, why });
    else pairs.push({ a: B[k], b: t > 0.5 ? A[j + 1] : A[j], why });
  }
  return { pairs, seam: { why, a: fa.len, b: fb.len, ratio: fb.len > 0 ? fa.len / fb.len : 1, want: o.want ?? 1, tol: o.tol ?? 0.02 } };
}
/** buttoned: a few points of two edges held together, the rest left open */
export function buttons(pieces: Piece[], A: Run, B: Run, n: number, why = 'button'): Pair[] {
  const fa = fractions(pieces, A), fb = fractions(pieces, B), out: Pair[] = [];
  for (let k = 0; k < n; k++) {
    const x = (k + 0.5) / n, la = locate(A, fa.f, x), lb = locate(B, fb.f, x);
    out.push({ a: la.t < 0.5 ? la.b : la.b1, b: lb.b, b1: lb.b1, t: lb.t, why });
  }
  return out;
}
