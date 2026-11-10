/**
 * Marks: a stroke or a wash as an organisation of splats.
 *
 * The brush lays marks by procedure; a fitted field lets every splat go its own way, and draws a stroke as scratchy
 * fragments. A mark here is between them. It has a few parameters that organise its deposits, and each deposit has
 * small residuals of its own, held near nothing. A teacher can change both: the organisation, and the deposits within
 * it. And it stays a mark: it has a spine or a place that can be picked up and moved, and its deposits come with it;
 * and what it learnt (its parameters: a style) can be put on another spine.
 *
 * `layout(mark)` is the one function that turns a mark into deposits. The page draws them (`marksToSplats`); the fitter
 * (devtools/splats-marks-fit.mjs) renders them, takes the exact gradient of its loss in each deposit, and carries it to
 * the mark's parameters through this function's own slope, taken numerically. So a new kind of mark needs only its
 * layout written here.
 *
 * **A stroke** runs along a smooth curve through its control points, as several rows of deposits side by side (the
 * brush's bristles; one row for a line). Its parameters (`STROKE`, 31):
 * - six knots of ink along it (a logit); six of width (a log, on its base width);
 * - its window: where it starts and stops (0…1 along it), and how sharply at each end;
 * - how long its deposits are against their spacing (a log); five knots of offset to the side (in base widths);
 * - four knots of dryness along it: how far its rows break up into streaks (each row has its own run of gaps, the same
 *   every time for the same mark); which side the dryness lies to; how far its rows overlap (a log); how much finer
 *   its outer rows are than its middle ones (a crisp edge round a full body);
 * - a splay (each deposit turned off the spine, alternately to each side) and an alternate step to the side (in base
 *   widths): with short deposits, a spray of dabs along a strand.
 * **A wash** lies on a face (a flat shape) or in a volume (an ellipsoid, in open space: its deposits round). Its
 * parameters (`WASH`, 10): a 3 × 3 grid of tone (logits, bilinear between; across a face's two axes; in a volume, from
 * its middle outward and from its foot up), and its deposits' size (a log).
 * **Each deposit's residuals** (`RESID`, 6): ink, length, width, turn, a shift to the side, a shift along (in spacings).
 * **The whole mark's view terms** (9): added to every deposit's ink, so a mark comes and goes with the view as one.
 * **Its hand-over** (`lod`): two thresholds on how large things look where the deposit is (render.ts, kind 12), so one
 * organisation can give way to another as it's approached.
 */
import type { Splats } from './format';

export type V = [number, number, number];
/** a deposit: where, its long axis (unit, in its plane), its plane's normal, its sizes (along, across, through), its
 * turn in its plane, its ink (a logit) */
export interface Deposit { p: V; t: V; n: V; s1: number; s2: number; thin: number; turn: number; logit: number }
export interface Mark {
  id: number; kind: 'stroke' | 'wash'; name?: string;
  /** a stroke: the points its spine runs through; the surface's normal there (one for all, or one a point; none: a
   * stroke in open space, round in section); its base width (scene units); its rows */
  ctrl?: V[]; normal?: V | V[]; width?: number; rows?: number;
  /** a wash on a face: a point of it, two unit axes in its plane, its normal, its shape as triangles in (u, v) */
  face?: { o: V; u: V; v: V; n: V; tris: number[][] };
  /** a wash in a volume: its middle and its three radii */
  blob?: { c: V; r: V };
  count: number;
  colour?: [number, number, number];
  /** its hand-over: shown between these two (log2 of how many screen heights a scene unit looks, where the deposit
   * is); the first above the second: it fades as it's approached; below: it comes in */
  lod?: [number, number];
  params: number[]; resid: number[]; view: number[];
}
export const STROKE = 31, WASH = 10, RESID = 6, VIEW_TERMS = 9;
/** the parameters' places in a stroke */
export const SP = { ink: 0, width: 6, u0: 12, u1: 13, sharp0: 14, sharp1: 15, along: 16, offset: 17, dry: 22, drySide: 26, spread: 27, splay: 28, step: 29, crisp: 30 } as const;
/** how many knots each run of a stroke's parameters has */
export const KN = { ink: 6, width: 6, offset: 5, dry: 4 } as const;
export const INK: [number, number, number] = [36, 31, 27];
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k], sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const knots = (k: number[], o: number, n: number, u: number) => { const x = Math.max(0, Math.min(1, u)) * (n - 1), i = Math.min(n - 2, Math.floor(x)), f = x - i; return k[o + i] * (1 - f) + k[o + i + 1] * f; };
const softplus = (x: number) => (x > 30 ? x : Math.log1p(Math.exp(x)));
const hash = (a: number, b: number, c: number) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** a new stroke through control points: full along it, of even weight, wet */
export function strokeMark(id: number, ctrl: V[], normal: V | V[] | undefined, width: number, count: number, rows = 1, name?: string): Mark {
  const params = new Array(STROKE).fill(0); for (let i = 0; i < 6; i++) params[i] = 1.5; params[SP.u0] = -0.04; params[SP.u1] = 1.04;
  return { id, kind: 'stroke', name, ctrl: ctrl.map((p) => [...p] as V), normal, width, rows, count, params, resid: new Array(count * RESID).fill(0), view: new Array(VIEW_TERMS).fill(0) };
}
/** a new wash on a face (its triangles, in the scene): an even, light tone */
export function washMark(id: number, tris: V[][], n: V, count: number, name?: string): Mark {
  const pts = tris.flat(), o = pts.reduce((a, p) => add(a, p, 1 / pts.length), [0, 0, 0] as V);
  // (its first axis level where the face isn't; its second up the face)
  const u = norm(Math.abs(n[1]) < 0.95 ? cross([0, 1, 0], n) : [1, 0, 0]), v = cross(n, u);
  return { id, kind: 'wash', name, face: { o, u, v, n, tris: tris.map((t) => t.flatMap((p) => [dot(sub(p, o), u), dot(sub(p, o), v)])) }, count, params: [-1.5, -1.5, -1.5, -1.5, -1.5, -1.5, -1.5, -1.5, -1.5, 0], resid: new Array(count * RESID).fill(0), view: new Array(VIEW_TERMS).fill(0) };
}
/** a new wash in a volume */
export function blobMark(id: number, c: V, r: V, count: number, name?: string): Mark {
  return { id, kind: 'wash', name, blob: { c, r }, count, params: [-1.5, -1.5, -1.5, -1.5, -1.5, -1.5, -1.5, -1.5, -1.5, 0], resid: new Array(count * RESID).fill(0), view: new Array(VIEW_TERMS).fill(0) };
}
/** a mark given another's style: its parameters, not its deposits' own residuals */
export function restyle(m: Mark, from: Mark): Mark { m.params = from.params.slice(); if (from.colour) m.colour = from.colour; return m; }

/** a stroke's spine: a smooth curve through its control points (Catmull-Rom), with the surface's normal along it */
export function spine(m: Mark): { pts: V[]; normals: V[] | null; cum: number[]; L: number } {
  const C = m.ctrl!, K = C.length, pts: V[] = [], ns: V[] = [], per = 10;
  const nAt = (i: number): V | null => (!m.normal ? null : Array.isArray(m.normal[0]) ? (m.normal as V[])[Math.max(0, Math.min(K - 1, i))] : (m.normal as V));
  for (let i = 0; i < K - 1; i++) {
    const p0 = C[Math.max(0, i - 1)], p1 = C[i], p2 = C[i + 1], p3 = C[Math.min(K - 1, i + 2)];
    for (let k = 0; k < per + (i === K - 2 ? 1 : 0); k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      pts.push([0, 1, 2].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)) as V);
      const a = nAt(i), b = nAt(i + 1); if (a && b) ns.push(norm(add(add([0, 0, 0], a, 1 - t), b, t)));
    }
  }
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  return { pts, normals: ns.length ? ns : null, cum, L: cum[cum.length - 1] || 1e-6 };
}

/** a wash's deposits' places: spread evenly (each the farthest of a few tries from those before it), the same every
 * time for the same mark; kept with the mark. On a face: (u, v); in a volume: within the unit ball */
function washPoints(m: Mark): { pts: number[][]; h: number; box: [number, number, number, number] } {
  const cache = m as Mark & { _pts?: ReturnType<typeof washPoints> };
  if (cache._pts && cache._pts.pts.length === m.count) return cache._pts;
  let r = (m.id * 2654435761) >>> 0 || 7; const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pts: number[][] = [];
  if (m.blob) {
    for (let i = 0; i < m.count; i++) {
      let best: number[] | null = null, bd = -1;
      for (let k = 0; k < 10; k++) {
        let q = [0, 0, 0]; do q = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]; while (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] > 1);
        let d = Infinity; for (const p of pts) d = Math.min(d, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2);
        if (d > bd) { bd = d; best = q; }
      }
      pts.push(best!);
    }
    return (cache._pts = { pts, h: Math.cbrt(4.19 / Math.max(1, m.count)), box: [-1, 1, -1, 1] });
  }
  const T = m.face!.tris; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, area = 0;
  for (const t of T) { for (let k = 0; k < 6; k += 2) { x0 = Math.min(x0, t[k]); x1 = Math.max(x1, t[k]); y0 = Math.min(y0, t[k + 1]); y1 = Math.max(y1, t[k + 1]); } area += Math.abs((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1])) / 2; }
  const inside = (x: number, y: number) => T.some((t) => { const d = (t[3] - t[5]) * (t[0] - t[4]) + (t[4] - t[2]) * (t[1] - t[5]), a = ((t[3] - t[5]) * (x - t[4]) + (t[4] - t[2]) * (y - t[5])) / d, b = ((t[5] - t[1]) * (x - t[4]) + (t[0] - t[4]) * (y - t[5])) / d; return a >= 0 && b >= 0 && a + b <= 1; });
  for (let i = 0; i < m.count; i++) {
    let best: number[] | null = null, bd = -1;
    for (let k = 0; k < 12; k++) {
      let x = 0, y = 0, ok = false; for (let q = 0; q < 40 && !ok; q++) { x = x0 + rnd() * (x1 - x0); y = y0 + rnd() * (y1 - y0); ok = inside(x, y); }
      if (!ok) continue;
      let d = Infinity; for (const p of pts) d = Math.min(d, (p[0] - x) ** 2 + (p[1] - y) ** 2);
      if (d > bd) { bd = d; best = [x, y]; }
    }
    pts.push(best ?? [(x0 + x1) / 2, (y0 + y1) / 2]);
  }
  return (cache._pts = { pts, h: Math.sqrt(area / Math.max(1, m.count)), box: [x0, x1, y0, y1] });
}
const grid = (P: number[], gx: number, gy: number) => {
  const x = Math.max(0, Math.min(1, gx)) * 2, y = Math.max(0, Math.min(1, gy)) * 2, ix = Math.min(1, Math.floor(x)), iy = Math.min(1, Math.floor(y)), fx = x - ix, fy = y - iy;
  return (P[iy * 3 + ix] * (1 - fx) + P[iy * 3 + ix + 1] * fx) * (1 - fy) + (P[(iy + 1) * 3 + ix] * (1 - fx) + P[(iy + 1) * 3 + ix + 1] * fx) * fy;
};

/** a mark's deposits */
export function layout(m: Mark): Deposit[] {
  const out: Deposit[] = [], N = m.count, P = m.params, R = m.resid;
  if (m.kind === 'stroke') {
    const S = spine(m), pts = S.pts, L = S.L, w0 = m.width ?? 0.01, free = !S.normals, rows = Math.max(1, m.rows ?? 1), cols = Math.ceil(N / rows);
    const t0 = 0.03 * Math.exp(-P[SP.sharp0]), t1 = 0.03 * Math.exp(-P[SP.sharp1]);
    // (its rows across it: the outer ones finer than the middle ones by `crisp`, packed side by side)
    const rw: number[] = [], rc: number[] = []; let rs = 0;
    for (let j = 0; j < rows; j++) { const v = rows > 1 ? (j + 0.5) / rows - 0.5 : 0; rw.push(Math.exp(-Math.max(0, P[SP.crisp]) * 4 * v * v)); rs += rw[j]; }
    { let a = 0; for (let j = 0; j < rows; j++) { rc.push((a + rw[j] / 2) / rs - 0.5); a += rw[j]; } }
    for (let i = 0; i < N; i++) {
      const r = i * RESID, col = Math.floor(i / rows), row = i % rows, v = rows > 1 ? rc[row] : 0;
      // (rows staggered like bricks, so their deposits' ends don't line up across the stroke)
      const u = Math.max(0, Math.min(1, (col + 0.5 + (rows > 1 ? ((row * 0.618) % 1) - 0.5 : 0) * 0.8 + R[r + 5]) / cols)), s = u * L;
      let k = 0; while (k < pts.length - 2 && S.cum[k + 1] < s) k++;
      const f = Math.max(0, Math.min(1, (s - S.cum[k]) / Math.max(1e-9, S.cum[k + 1] - S.cum[k]))), t = norm(sub(pts[k + 1], pts[k]));
      // (on a surface, its plane is the surface's; in open space, any plane through its length: it's round in section)
      let n: V = free ? norm(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])) : norm(add(add([0, 0, 0], S.normals![k], 1 - f), S.normals![Math.min(S.normals!.length - 1, k + 1)], f));
      n = norm(sub(n, [t[0] * dot(n, t), t[1] * dot(n, t), t[2] * dot(n, t)]));
      const b = cross(n, t), w = w0 * Math.exp(knots(P, SP.width, KN.width, u)), alt = i % 2 ? 1 : -1;
      const s2 = ((w * rw[row]) / rs) * 0.62 * Math.exp(P[SP.spread] + R[r + 2]);
      const side = knots(P, SP.offset, KN.offset, u) * w0 + v * w * 0.9 + (R[r + 4] + alt * P[SP.step]) * w0;
      // (dryness: each row has its own run of gaps along the stroke, a few widths long; drier to one side)
      const run = s / (5 * w0) + hash(m.id, row, 7) * 16, r0 = Math.floor(run), rf = run - r0, sm = rf * rf * (3 - 2 * rf);
      const gap = hash(m.id, row, r0) * (1 - sm) + hash(m.id, row, r0 + 1) * sm;
      const dry = Math.max(0, knots(P, SP.dry, KN.dry, u)) * Math.max(0, 1 + 2 * P[SP.drySide] * v) * 9 * gap * gap;
      out.push({ p: add(add(add(pts[k], sub(pts[k + 1], pts[k]), f), b, side), n, free ? 0 : 0.002), t, n, s1: (L / cols) * 0.9 * Math.exp(P[SP.along] + R[r + 1]), s2, thin: free ? s2 : 0.0008, turn: R[r + 3] + alt * P[SP.splay], logit: knots(P, SP.ink, KN.ink, u) - softplus((P[SP.u0] - u) / t0) - softplus((u - P[SP.u1]) / t1) - dry + R[r] });
    }
  } else if (m.blob) {
    const B = m.blob, { pts, h } = washPoints(m), rm = Math.cbrt(B.r[0] * B.r[1] * B.r[2]);
    for (let i = 0; i < N; i++) {
      const r = i * RESID, q = pts[i], sz = 0.8 * h * rm * Math.exp(P[9]);
      const p: V = [B.c[0] + (q[0] + R[r + 4] * h) * B.r[0], B.c[1] + (q[1] + R[r + 5] * h) * B.r[1], B.c[2] + q[2] * B.r[2]];
      out.push({ p, t: [1, 0, 0], n: [0, 0, 1], s1: sz * Math.exp(R[r + 1]), s2: sz * Math.exp(R[r + 2]), thin: sz, turn: R[r + 3], logit: grid(P, Math.hypot(q[0], q[2]), q[1] * 0.5 + 0.5) + R[r] });
    }
  } else {
    const F = m.face!, { pts, h, box } = washPoints(m);
    for (let i = 0; i < N; i++) {
      const r = i * RESID, x = pts[i][0] + R[r + 4] * h, y = pts[i][1] + R[r + 5] * h, sz = 0.75 * h * Math.exp(P[9]);
      out.push({ p: add(add(add(F.o, F.u, x), F.v, y), F.n, 0.002), t: F.u, n: F.n, s1: sz * Math.exp(R[r + 1]), s2: sz * Math.exp(R[r + 2]), thin: 0.0008, turn: R[r + 3], logit: grid(P, (x - box[0]) / Math.max(1e-9, box[1] - box[0]), (y - box[2]) / Math.max(1e-9, box[3] - box[2])) + R[r] });
    }
  }
  return out;
}

/** a rotation (unit quaternion w x y z) whose columns are the three axes given */
function quat(x: V, y: V, z: V): [number, number, number, number] {
  const tr = x[0] + y[1] + z[2];
  if (tr > 0) { const w = Math.sqrt(tr + 1) * 2; return [w / 4, (y[2] - z[1]) / w, (z[0] - x[2]) / w, (x[1] - y[0]) / w]; }
  if (x[0] > y[1] && x[0] > z[2]) { const w = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2; return [(y[2] - z[1]) / w, w / 4, (y[0] + x[1]) / w, (z[0] + x[2]) / w]; }
  if (y[1] > z[2]) { const w = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2; return [(z[0] - x[2]) / w, (y[0] + x[1]) / w, w / 4, (z[1] + y[2]) / w]; }
  const w = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2; return [(x[1] - y[0]) / w, (z[0] + x[2]) / w, (z[1] + y[2]) / w, w / 4];
}
/** a deposit's own axes: its long axis turned in its plane, the axis across it, its normal */
export function axes(d: Deposit): [V, V, V] {
  const b = cross(d.n, d.t), c = Math.cos(d.turn), s = Math.sin(d.turn);
  const t: V = [d.t[0] * c + b[0] * s, d.t[1] * c + b[1] * s, d.t[2] * c + b[2] * s];
  return [t, cross(d.n, t), d.n];
}
export type MarkSplats = Splats & { mark: Uint8Array; rank: Float32Array; normal: Float32Array; feature: Uint32Array; element: Uint32Array; support: Uint8Array; coef: Float32Array; owner: Uint32Array };
/**
 * Marks as the renderer takes them (kind 12: fitted marks, their view terms in the coefficient texture): each splat's
 * element its mark's id and its feature its place in the mark, so a mark keeps its identity for an editor. Deposits
 * that ink nothing from anywhere are left out (`floor`: the least ink worth a splat). `loose`: deposits given as they
 * are, belonging to no mark (a fit's independent discs), each with its colour.
 */
export function marksToSplats(marks: Mark[], floor = 0.02, loose: Array<{ d: Deposit; colour?: [number, number, number] }> = []): MarkSplats {
  const all: Array<{ d: Deposit; m: Mark | null; i: number; colour: [number, number, number] }> = [];
  for (const m of marks) {
    // (the most its view terms can add, roughly: their size)
    const lift = m.view.slice(1).reduce((a, v) => a + Math.abs(v), 0) + m.view[0];
    layout(m).forEach((d, i) => { if (1 / (1 + Math.exp(-(d.logit + lift))) > floor) all.push({ d, m, i, colour: m.colour ?? INK }); });
  }
  loose.forEach((l, i) => { if (1 / (1 + Math.exp(-l.d.logit)) > floor) all.push({ d: l.d, m: null, i, colour: l.colour ?? INK }); });
  const N = all.length;
  const s = { n: N, pos: new Float32Array(N * 3), scale: new Float32Array(N * 3), rot: new Float32Array(N * 4), rgba: new Uint8Array(N * 4), mark: new Uint8Array(N), rank: new Float32Array(N), normal: new Float32Array(N * 3), feature: new Uint32Array(N), element: new Uint32Array(N), support: new Uint8Array(N), coef: new Float32Array(N * 12), owner: new Uint32Array(N) };
  all.forEach(({ d, m, i, colour }, k) => {
    const [x, y, z] = axes(d);
    s.pos.set(d.p, k * 3); s.scale.set([Math.max(d.s1, 0.0002), Math.max(d.s2, 0.0002), Math.max(d.thin, 0.0002)], k * 3); s.rot.set(quat(x, y, z), k * 4); s.normal.set(d.n, k * 3);
    // (on a surface: given its plane's depth, so the face it lies on doesn't cut it; in open space: its own)
    s.support[k] = d.thin < 0.002 ? 1 : 3; s.rgba.set([colour[0], colour[1], colour[2], 255], k * 4); s.mark[k] = 12; s.rank[k] = 1; s.element[k] = m ? m.id : 0; s.feature[k] = i + 1; s.owner[k] = m ? m.id : 0;
    s.coef[k * 12] = d.logit + (m ? m.view[0] : 0); if (m) { for (let b = 1; b < VIEW_TERMS; b++) s.coef[k * 12 + b] = m.view[b]; if (m.lod) { s.coef[k * 12 + 9] = m.lod[0]; s.coef[k * 12 + 10] = m.lod[1]; } }
  });
  return s;
}
