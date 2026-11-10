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
export interface Deposit { p: V; t: V; n: V; s1: number; s2: number; thin: number; turn: number; logit: number;
  /** its own view terms (nine, as the mark's: added to them), and the most ink it lays whatever the view (0…1; 1 if
   * not given): a deposit whose ink depends on where it's seen from */
  view?: number[]; cap?: number;
  /** how its cap changes with its own ink residual (for fitting a deposit's ink where its cap carries it) */
  dcap?: number }
/** the nine terms a deposit's ink can depend on the view by: of d, the unit vector from it to the eye */
export const viewBasis = (d: V): number[] => [1, d[0], d[1], d[2], d[0] * d[1], d[1] * d[2], d[0] * d[2], d[0] * d[0] - d[1] * d[1], 3 * d[2] * d[2] - 1];
/** how much ink a deposit lays, seen from an eye (0…1): its cap, and its logit with its mark's view terms and its own */
export function inkOf(d: Deposit, eye: V, markView?: number[]): number {
  let z = d.logit;
  if (d.view || markView) { const l = Math.hypot(eye[0] - d.p[0], eye[1] - d.p[1], eye[2] - d.p[2]) || 1, b = viewBasis([(eye[0] - d.p[0]) / l, (eye[1] - d.p[1]) / l, (eye[2] - d.p[2]) / l]); for (let k = 1; k < 9; k++) z += ((d.view?.[k] ?? 0) + (markView?.[k] ?? 0)) * b[k]; z += (d.view?.[0] ?? 0) + (markView?.[0] ?? 0); }
  return (d.cap ?? 1) / (1 + Math.exp(-z));
}
export interface Mark {
  id: number; kind: 'stroke' | 'wash'; name?: string;
  /** what it is in its scene, said once: a key no other mark has (what's taught to it is kept by this, and its id is
   * made from it, so adding a mark elsewhere changes neither); and its role (marks of a role share a style) */
  key?: string; role?: string;
  /** a stroke: the points its spine runs through; the surface's normal there (one for all, or one a point; none: a
   * stroke in open space, round in section; 'tube': its rows laid round a tube about its spine, its width the tube's,
   * so it's a band of the same weight from wherever it's seen: a limb); its base width (scene units); its rows */
  ctrl?: V[]; normal?: V | V[] | 'tube'; width?: number; rows?: number;
  /** a tube's shading: how far its ink keeps to its underside (0: all round; 1: its top left bare), as a limb drawn
   * with one loaded stroke along it and the paper left for the rest */
  shade?: number;
  /** a banded limb: its rows keep to an arc of the tube, each with a part to play by its place across the arc: a
   * firm edge along the middle of the arc (seen from the side, the limb's edge), a body beside it, and bristles that
   * break up toward the arc's two ends. Where the arc's middle faces (a unit vector; default straight down: a limb
   * inked along its underside). Or 'seen': its rows go all the way round, and each deposit lays its ink where it
   * lies in the limb's lower band as the limb is seen (its view terms say so exactly): the same loaded stroke along
   * the limb's lower edge from wherever it's looked at. Its parameters then: `arc` the band's thickness (a log, on one
   * half-width), `fall` how sharply it ends inside (a log), `bristle` how far its thickness wavers along it.
   * Or 'edges': rows all round, each deposit laying its ink where the tube's surface is seen edge-on: a line along
   * each of the limb's two edges as seen. Its parameters: `arc` how thick the lines (a log), `fall` how sharp */
  band?: V | true | 'seen' | 'edges';
  /** a band as seen keeps to the limb's upper side (as seen), not its lower */
  bandUp?: boolean;
  /**
   * A band as seen made a sweep: one pass of a loaded brush along the limb. A pressure runs along it (an attack, the
   * stroke's own run of harder and lighter, a release), and three things follow it together:
   * - its width: the band is `tmin` half-widths thick where the pressure is nothing, `tmax` where it's full;
   * - its coverage: each row (a bristle) lays ink only where the pressure is over the row's own threshold, so a
   *   lighter stretch thins into streaks and the release frays, row by row (`dry`: how far the thresholds spread);
   * - its load: the ink runs out along it (`decay`, in the logit a stroke's length).
   * `vary`: how much its own run of pressure dips (0…1); `taper`: how much of its length the release takes;
   * `jitter`: how far its deposits stand off the tube, row by row (in base widths): a rim that isn't the tube's.
   */
  sweep?: { tmin: number; tmax: number; dry: number; decay: number; vary: number; taper: number; jitter: number; runs?: number; wet?: number };
  /** a tube that hides nothing (one of several marks on the same limb: only the first is its solid) */
  ghost?: boolean;
  /** leaves along it (a stroke in open space): each a few deposits (`n`) along its own axis, `len` long, widest a
   * third of the way out and narrowing to its tip by `taper` (0 none … 1 to a point), its tip paler by `fade`; they
   * come off the spine at the stroke's `splay` (radians from the way the spine runs), turning round it leaf by leaf;
   * `bunch` to a bunch, a bunch's leaves drawn together along the spine by `cluster` (0 evenly spaced … 1 on one spot) */
  leaf?: { n: number; len: number; taper: number; fade: number; bunch: number; cluster: number };
  /** a sweep's deposits moved off its even lattice (three numbers a deposit): how far along the limb (0…1), which
   * bristle (0…rows, round the limb), and how free of the gesture it is (0: it lays ink only where the sweep's band
   * and its bristle do; 1: wherever it sits, whatever the view). Where a fit has put them (devtools/splats-limb-fit.mjs) */
  homes?: number[];
  /** the stretch of its spine its deposits are laid over (0…1 of its length); the whole of it if not given */
  span?: [number, number];
  /** where a tube's light comes from (a unit vector; none: from straight above its spine): its ink keeps to the side
   * turned away from it, and the side turned to it is left to the paper */
  light?: V;
  /** how far its far end sways (scene units; render.ts moves a fitted mark's deposits by their own share of it) */
  sway?: number;
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
export const STROKE = 36, WASH = 10, RESID = 6, VIEW_TERMS = 9;
/** the parameters' places in a stroke */
export const SP = { ink: 0, width: 6, u0: 12, u1: 13, sharp0: 14, sharp1: 15, along: 16, offset: 17, dry: 22, drySide: 26, spread: 27, splay: 28, step: 29, crisp: 30, arc: 31, fine: 32, feather: 33, fall: 34, bristle: 35 } as const;
/** a banded limb's own parameters (the last five), as they are when nothing has set them: its arc (a log, on 100° to each
 * side); how much finer its edge and bristle rows are than its body's (a log); where across the arc its ink starts to
 * fall (0…1); how steeply; how much drier its bristles are than its body */
export const BAND = { arc: 0, fine: 0.9, feather: 0.55, fall: 1, bristle: 1 } as const;
/** how many knots each run of a stroke's parameters has */
export const KN = { ink: 6, width: 6, offset: 5, dry: 4 } as const;
export const INK: [number, number, number] = [36, 31, 27];
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k], sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const knots = (k: number[], o: number, n: number, u: number) => { const x = Math.max(0, Math.min(1, u)) * (n - 1), i = Math.min(n - 2, Math.floor(x)), f = x - i; return k[o + i] * (1 - f) + k[o + i + 1] * f; };
const softplus = (x: number) => (x > 30 ? x : Math.log1p(Math.exp(x)));
export const hash = (a: number, b: number, c: number) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** an id from a key (a 32-bit hash of it) */
export function keyId(key: string): number { let h = 2166136261; for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) || 1; }
/**
 * Marks given their keys, ids and roles, once a scene has laid them all: a mark's key is its name, with its place among
 * the marks of that name where there are several (`tunnel/boardwalk/plank #12`); its id is made from its key (no two the
 * same); its role comes from `roleOf`.
 */
export function keyMarks(marks: Mark[], roleOf: (name: string) => string): Mark[] {
  const many = new Map<string, number>(), at = new Map<string, number>(), ids = new Set<number>();
  for (const m of marks) many.set(m.name ?? '', (many.get(m.name ?? '') ?? 0) + 1);
  for (const m of marks) {
    const n = m.name ?? '', k = at.get(n) ?? 0; at.set(n, k + 1);
    m.key = many.get(n)! > 1 ? `${n} #${k}` : n; m.role = roleOf(n);
    let id = keyId(m.key), salt = 0; while (ids.has(id)) id = keyId(`${m.key}~${++salt}`); ids.add(id); m.id = id;
    delete (m as Mark & { _pts?: unknown })._pts;
  }
  return marks;
}
/** a parameter's range (a stroke's by its place, a wash's tones and size) */
export function paramRange(m: Mark, j: number): [number, number] {
  if (m.kind !== 'stroke') return j < 9 ? [-7, 3] : [-0.6, 0.9];
  if (j < SP.width) return [-7, 5]; if (j < SP.u0) return [-1.6, 1.2];
  if (j === SP.u0) return [-0.1, 0.6]; if (j === SP.u1) return [0.4, 1.1]; if (j === SP.sharp0 || j === SP.sharp1) return [-2.5, 2]; if (j === SP.along) return [-1.5, 1];
  if (j < SP.dry) return [-1.5, 1.5]; if (j < SP.drySide) return [0, 2.5]; if (j === SP.drySide) return [-1, 1]; if (j === SP.spread) return [-0.8, 0.8]; if (j === SP.splay) return [-1.2, 1.2]; if (j === SP.crisp) return [0, 3];
  if (j === SP.arc) return [-1.4, 0.8]; if (j === SP.fine) return [0, 2.2]; if (j === SP.feather) return [0.1, 0.95]; if (j === SP.fall) return [0, 4]; if (j === SP.bristle) return [0, 4];
  return [-3, 3];
}
/** a new stroke through control points: full along it, of even weight, wet */
export function strokeMark(id: number, ctrl: V[], normal: V | V[] | 'tube' | undefined, width: number, count: number, rows = 1, name?: string): Mark {
  const params = new Array(STROKE).fill(0); for (let i = 0; i < 6; i++) params[i] = 1.5; params[SP.u0] = -0.04; params[SP.u1] = 1.04;
  params[SP.arc] = BAND.arc; params[SP.fine] = BAND.fine; params[SP.feather] = BAND.feather; params[SP.fall] = BAND.fall; params[SP.bristle] = BAND.bristle;
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
  const nAt = (i: number): V | null => (!m.normal || m.normal === 'tube' ? null : Array.isArray(m.normal[0]) ? (m.normal as V[])[Math.max(0, Math.min(K - 1, i))] : (m.normal as V));
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

/**
 * A sweep as a surface, for a renderer that draws the gesture a pixel at a time (render.ts `setStroke`): the limb's
 * tube as rings of vertices, each carrying where it is, which way its surface faces, the way the band takes as up
 * there, how far along the limb it is (0…1), which bristle it lies on (0…rows, round the limb, the same bristles the
 * deposits are laid on) and how far along in limb widths. And the sweep's numbers, as the deposits' layout reads them.
 * Thirteen floats a vertex: position, normal, up, (along, bristle, along in widths, 0).
 */
export function sweepMesh(m: Mark, rings = 200, segs = 32): { verts: Float32Array; index: Uint32Array; style: { id: number; rows: number; ink: number; fall: number; spread: number; ragged: number; tmin: number; tmax: number; dry: number; decay: number; vary: number; taper: number; runs: number; wet: number } } {
  const S = spine(m), pts = S.pts, L = S.L, P = m.params, w0 = m.width ?? 0.01, rows = Math.max(1, m.rows ?? 1), SW = m.sweep!, verts = new Float32Array((rings + 1) * (segs + 1) * 13), index = new Uint32Array(rings * segs * 6);
  for (let a = 0; a <= rings; a++) {
    const u = a / rings, s = u * L; let k = 0; while (k < pts.length - 2 && S.cum[k + 1] < s) k++;
    const f = Math.max(0, Math.min(1, (s - S.cum[k]) / Math.max(1e-9, S.cum[k + 1] - S.cum[k]))), t = norm(sub(pts[k + 1], pts[k])), q = Math.abs(t[1]) < 0.95 ? t[1] : t[0];
    const N0 = norm(sub(Math.abs(t[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], [t[0] * q, t[1] * q, t[2] * q])), B0 = cross(t, N0), U0: V = Math.abs(t[1]) < 0.8 ? N0 : norm(cross(t, cross([0.6, 0, 0.8], t))), U: V = m.bandUp ? [-U0[0], -U0[1], -U0[2]] : U0;
    const w = w0 * Math.exp(knots(P, SP.width, KN.width, u)), centre = add(add(pts[k], sub(pts[k + 1], pts[k]), f), N0, knots(P, SP.offset, KN.offset, u) * w0);
    for (let b = 0; b <= segs; b++) {
      const rowf = (b / segs) * rows, th = (rowf / rows) * Math.PI * 2 + hash(m.id, 3, 3) * 6.28, c = Math.cos(th), sn = Math.sin(th), rad: V = [N0[0] * c + B0[0] * sn, N0[1] * c + B0[1] * sn, N0[2] * c + B0[2] * sn], o = (a * (segs + 1) + b) * 13;
      verts.set(add(centre, rad, w / 2), o); verts.set(rad, o + 3); verts.set(U, o + 6); verts[o + 9] = u; verts[o + 10] = rowf; verts[o + 11] = s / w0;
    }
  }
  for (let a = 0, o = 0; a < rings; a++) for (let b = 0; b < segs; b++) { const i0 = a * (segs + 1) + b, i1 = i0 + segs + 1; index.set([i0, i1, i0 + 1, i0 + 1, i1, i1 + 1], o); o += 6; }
  return { verts, index, style: { id: m.id >>> 0, rows, ink: knots(P, SP.ink, KN.ink, 0.5), fall: P[SP.fall] ?? 1, spread: P[SP.spread], ragged: Math.min(0.6, P[SP.bristle] ?? 0), tmin: SW.tmin, tmax: SW.tmax, dry: SW.dry, decay: SW.decay, vary: SW.vary, taper: SW.taper, runs: SW.runs ?? 3, wet: SW.wet ?? 0 } };
}
/** a mark's deposits */
export function layout(m: Mark): Deposit[] {
  const out: Deposit[] = [], N = m.count, P = m.params, R = m.resid;
  if (m.kind === 'stroke') {
    const S = spine(m), pts = S.pts, L = S.L, w0 = m.width ?? 0.01, tube = m.normal === 'tube', free = !S.normals && !tube, rows = Math.max(1, m.rows ?? 1), cols = Math.ceil(N / rows);
    const t0 = 0.03 * Math.exp(-P[SP.sharp0]), t1 = 0.03 * Math.exp(-P[SP.sharp1]);
    const sp0 = m.span?.[0] ?? 0, sp1 = m.span?.[1] ?? 1, Lc = (L * (sp1 - sp0)) / cols;
    // (its rows across it: the outer ones finer than the middle ones by `crisp`, packed side by side)
    const rw: number[] = [], rc: number[] = []; let rs = 0;
    for (let j = 0; j < rows; j++) { const v = rows > 1 ? (j + 0.5) / rows - 0.5 : 0; rw.push(Math.exp(-Math.max(0, P[SP.crisp]) * 4 * v * v)); rs += rw[j]; }
    { let a = 0; for (let j = 0; j < rows; j++) { rc.push((a + rw[j] / 2) / rs - 0.5); a += rw[j]; } }
    if (m.leaf) {
      const F = m.leaf, n = Math.max(1, F.n), leaves = Math.floor(N / n), per = Math.max(1, Math.round(F.bunch)), bunches = Math.max(1, Math.ceil(leaves / per)), a0 = Math.max(0, P[SP.u0]), a1 = Math.min(1, P[SP.u1]);
      const wl = (m.width ?? 0.02) * Math.exp(P[SP.spread]), cl = Math.max(0, Math.min(1, F.cluster));
      for (let q = 0; q < leaves; q++) {
        // (its bunch's place along the spine: evenly, a little off; the bunch's leaves over a stretch about it)
        const g = Math.floor(q / per), centre = (g + 0.5 + 0.5 * (hash(m.id, 61, g) - 0.5)) / bunches, extent = (1 - 0.85 * cl) / bunches;
        const u = Math.max(0, Math.min(1, a0 + (a1 - a0) * (centre + (((q % per) + 0.5) / per - 0.5) * extent + (hash(m.id, 62, q) - 0.5) * 0.3 * extent))), s = u * L;
        let k = 0; while (k < pts.length - 2 && S.cum[k + 1] < s) k++;
        const f = Math.max(0, Math.min(1, (s - S.cum[k]) / Math.max(1e-9, S.cum[k + 1] - S.cum[k]))), t = norm(sub(pts[k + 1], pts[k])), A = add(pts[k], sub(pts[k + 1], pts[k]), f);
        // (its axis: off the way the spine runs by the splay, to a side that turns round the spine leaf by leaf)
        const e1 = norm(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross(t, e1), phi = q * 2.39996 + hash(m.id, 63, 0) * 6.28, th = P[SP.splay] * (0.7 + 0.6 * hash(m.id, 64, q));
        const c = Math.cos(phi), sn = Math.sin(phi), ct = Math.cos(th), st = Math.sin(th), axis = norm([t[0] * ct + (e1[0] * c + e2[0] * sn) * st, t[1] * ct + (e1[1] * c + e2[1] * sn) * st, t[2] * ct + (e1[2] * c + e2[2] * sn) * st]);
        const nn = norm(cross(axis, Math.abs(dot(axis, t)) < 0.98 ? t : e1)), len = F.len * (0.75 + 0.5 * hash(m.id, 65, q));
        for (let j = 0; j < n; j++) {
          const r = (q * n + j) * RESID, x = (j + 0.5) / n, shape = Math.max(0.12, x < 0.35 ? 0.45 + 0.55 * (x / 0.35) : 1 - F.taper * Math.pow((x - 0.35) / 0.65, 1.3));
          out.push({ p: add(A, axis, len * x), t: axis, n: nn, s1: (len / n) * 0.55 * Math.exp(P[SP.along] + R[r + 1]), s2: (wl / 2) * 0.7 * shape * Math.exp(R[r + 2]), thin: (wl / 2) * 0.7 * shape, turn: R[r + 3], logit: knots(P, SP.ink, KN.ink, u) - 1.5 * F.fade * x + R[r] });
        }
      }
      // (any deposits over a whole number of leaves: none of them shown)
      for (let i = leaves * n; i < N; i++) out.push({ p: [...pts[0]] as V, t: [0, -1, 0], n: [0, 0, 1], s1: 0.001, s2: 0.001, thin: 0.001, turn: 0, logit: -20 });
      return out;
    }
    const HM = m.homes && m.homes.length === N * 3 ? m.homes : null;
    for (let i = 0; i < N; i++) {
      const r = i * RESID, col = Math.floor(i / rows), row = HM ? ((Math.floor(HM[i * 3 + 1]) % rows) + rows) % rows : i % rows, v = rows > 1 ? rc[row] : 0;
      // (rows staggered like bricks, so their deposits' ends don't line up across the stroke)
      const u = HM ? Math.max(0, Math.min(1, HM[i * 3] + R[r + 5] / cols)) : sp0 + (sp1 - sp0) * Math.max(0, Math.min(1, (col + 0.5 + (rows > 1 ? ((row * 0.618) % 1) - 0.5 : 0) * 0.8 + R[r + 5]) / cols)), s = u * L;
      let k = 0; while (k < pts.length - 2 && S.cum[k + 1] < s) k++;
      const f = Math.max(0, Math.min(1, (s - S.cum[k]) / Math.max(1e-9, S.cum[k + 1] - S.cum[k]))), t = norm(sub(pts[k + 1], pts[k]));
      // (on a surface, its plane is the surface's; in open space, any plane through its length: it's round in section)
      let n: V = free || tube ? norm(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])) : norm(add(add([0, 0, 0], S.normals![k], 1 - f), S.normals![Math.min(S.normals!.length - 1, k + 1)], f));
      n = norm(sub(n, [t[0] * dot(n, t), t[1] * dot(n, t), t[2] * dot(n, t)]));
      const w = w0 * Math.exp(knots(P, SP.width, KN.width, u)), alt = i % 2 ? 1 : -1;
      if (tube && m.band === 'edges') {
        const N0 = norm(sub(Math.abs(t[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], [t[0] * (Math.abs(t[1]) < 0.95 ? t[1] : t[0]), t[1] * (Math.abs(t[1]) < 0.95 ? t[1] : t[0]), t[2] * (Math.abs(t[1]) < 0.95 ? t[1] : t[0])])), B0 = cross(t, N0);
        const th = ((row + 0.5) / rows) * Math.PI * 2 + hash(m.id, 3, 3) * 6.28, c = Math.cos(th), sn = Math.sin(th), rad: V = [N0[0] * c + B0[0] * sn, N0[1] * c + B0[1] * sn, N0[2] * c + B0[2] * sn];
        // (ink where its face is edge-on to the eye: b (tau - (n·d)^2), a quadratic in d the nine terms hold exactly)
        const tau = 0.25 * Math.exp(P[SP.arc] ?? 0), b = 14 * Math.exp((P[SP.fall] ?? 1) - 1), S2 = (i: number, j: number) => rad[i] * rad[j];
        const view = [0, 0, 0, 0, -2 * b * S2(0, 1), -2 * b * S2(1, 2), -2 * b * S2(0, 2), (-b * (S2(0, 0) - S2(1, 1))) / 2, (-b * (-S2(0, 0) - S2(1, 1) + 2 * S2(2, 2))) / 6];
        // (one edge only, if it says which: the limb's upper as seen or its lower. Each can be there or not on its own)
        let one = 0;
        if (m.bandUp !== undefined) {
          const U: V = Math.abs(t[1]) < 0.8 ? N0 : norm(cross(t, cross([0.6, 0, 0.8], t))), sg = m.bandUp ? 1 : -1, c2 = 6, Sm = (a: number, bb: number) => (U[a] * rad[bb] + U[bb] * rad[a]) / 2, nU = dot(rad, U);
          // (c (s v - 1), v the deposit's place across the limb as seen: n·U - (U·d)(n·d))
          one = c2 * (sg * nU - 1) - (c2 * sg * nU) / 3;
          const q = -c2 * sg;
          view[4] += 2 * q * Sm(0, 1); view[5] += 2 * q * Sm(1, 2); view[6] += 2 * q * Sm(0, 2); view[7] += (q * (Sm(0, 0) - Sm(1, 1))) / 2; view[8] += (q * (-Sm(0, 0) - Sm(1, 1) + 2 * Sm(2, 2))) / 6;
        }
        const run = s / (5 * w0) + hash(m.id, row, 7) * 16, r0 = Math.floor(run), rf = run - r0, sm = rf * rf * (3 - 2 * rf), gap = hash(m.id, row, r0) * (1 - sm) + hash(m.id, row, r0 + 1) * sm;
        const body = knots(P, SP.ink, KN.ink, u) - softplus((P[SP.u0] - u) / t0) - softplus((u - P[SP.u1]) / t1) - Math.max(0, knots(P, SP.dry, KN.dry, u)) * 9 * gap * gap + R[r];
        const centre = add(add(pts[k], sub(pts[k + 1], pts[k]), f), N0, knots(P, SP.offset, KN.offset, u) * w0);
        out.push({ p: add(centre, rad, w / 2 + R[r + 4] * w0), t, n: rad, s1: Lc * 0.9 * Math.exp(P[SP.along] + R[r + 1]), s2: ((Math.PI * w) / rows) * 0.62 * Math.exp(P[SP.spread] + R[r + 2]), thin: 0.0008, turn: R[r + 3], logit: b * (tau - 1 / 3) + one, view, cap: 1 / (1 + Math.exp(-body)) });
        continue;
      }
      if (tube && m.band === 'seen') {
        const N0 = norm(sub(Math.abs(t[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], [t[0] * (Math.abs(t[1]) < 0.95 ? t[1] : t[0]), t[1] * (Math.abs(t[1]) < 0.95 ? t[1] : t[0]), t[2] * (Math.abs(t[1]) < 0.95 ? t[1] : t[0])])), B0 = cross(t, N0);
        const free = HM ? Math.max(0, Math.min(1, HM[i * 3 + 2])) : 0;
        const th = ((HM ? HM[i * 3 + 1] : row + 0.5) / rows) * Math.PI * 2 + hash(m.id, 3, 3) * 6.28, c = Math.cos(th), sn = Math.sin(th), rad: V = [N0[0] * c + B0[0] * sn, N0[1] * c + B0[1] * sn, N0[2] * c + B0[2] * sn];
        // (up as the band takes it: across the limb where the limb is anywhere near level; for an upright limb, to one side)
        // (or, where a light is given, toward the light: the band keeps to the side away from it)
        const lit = m.light ? sub(m.light, [t[0] * dot(m.light, t), t[1] * dot(m.light, t), t[2] * dot(m.light, t)]) : null;
        const U0: V = lit && Math.hypot(lit[0], lit[1], lit[2]) > 0.25 ? norm(lit) : Math.abs(t[1]) < 0.8 ? N0 : norm(cross(t, cross([0.6, 0, 0.8], t)));
        // (the band on the limb's lower side as seen, or its upper)
        const U: V = m.bandUp ? [-U0[0], -U0[1], -U0[2]] : U0;
        // (how thick the band is here: wavering along the limb, the same for every row, so its inner edge wobbles)
        const wv = s / ((m.sweep ? 0.7 : 2.2) * w0) + hash(m.id, 91, 5) * 9, w0i = Math.floor(wv), wf = wv - w0i, ws = wf * wf * (3 - 2 * wf), wob = (hash(m.id, 91, w0i) * (1 - ws) + hash(m.id, 91, w0i + 1) * ws) * 2 - 1;
        // (a sweep's pressure here: its attack, its own run along it, its release)
        const SW = m.sweep; let press = 1, cover = 0, load = 0, stand = 0;
        if (SW) {
          // (the brush is loaded where it's set down, and again a few times along the limb, each where the limb's own
          // id puts it; from each loading it dries: its pressure falls toward 1 - vary over about half the way to the
          // next. Which end it starts from is the limb's own too)
          const sm3 = (x: number) => { const y = Math.max(0, Math.min(1, x)); return y * y * (3 - 2 * y); }, runs = SW.runs ?? 3, uu = hash(m.id, 57, 2) < 0.5 ? 1 - u : u;
          const at = (k: number) => (k <= 0 ? 0 : (k + 0.7 * (hash(m.id, 55, k) - 0.5)) / runs);
          let k0 = Math.floor(uu * runs); if (at(k0 + 1) <= uu) k0++; else if (at(k0) > uu) k0--;
          const since = uu - at(k0);
          press = (0.55 + 0.45 * sm3(since / 0.012)) * sm3((1 - uu) / Math.max(0.005, SW.taper)) * (1 - SW.vary * (1 - Math.exp((-since * runs) / 0.45)));
          const jr = s / (0.6 * w0) + hash(m.id, row, 23) * 11, j0 = Math.floor(jr), jf = jr - j0, js = jf * jf * (3 - 2 * jf);
          stand = SW.jitter * ((hash(m.id, row + 300, j0) * (1 - js) + hash(m.id, row + 300, j0 + 1) * js) * 2 - 1); load = SW.decay * 3 * u;
        }
        const T = (SW ? SW.tmin + Math.max(0, SW.tmax - SW.tmin) * press : Math.exp(P[SP.arc] ?? 0)) * (1 + (SW ? Math.min(0.6, P[SP.bristle] ?? 0) : P[SP.bristle] ?? 0) * 0.5 * wob), K = 7 * Math.exp((P[SP.fall] ?? 1) - 1) * (1 - free), nU = dot(rad, U);
        // (ink where it lies under the band's inner edge as seen: K (B - n·U' ), U' the part of U across the line of
        // sight: B - n·U + (U·d)(n·d), the last a quadratic in d: the nine terms hold it exactly)
        const Sm = (a: number, b: number) => (U[a] * rad[b] + U[b] * rad[a]) / 2, Bd = -1 + T;
        const view = [0, 0, 0, 0, 2 * K * Sm(0, 1), 2 * K * Sm(1, 2), 2 * K * Sm(0, 2), (K * (Sm(0, 0) - Sm(1, 1))) / 2, (K * (-Sm(0, 0) - Sm(1, 1) + 2 * Sm(2, 2))) / 6];
        // (each row's own unevenness along it: a sweep's bristles break over a couple of the limb's widths)
        const run = s / ((SW ? 2 : 5) * w0) + hash(m.id, row, 7) * 16, r0 = Math.floor(run), rf = run - r0, sm = rf * rf * (3 - 2 * rf), gap = hash(m.id, row, r0) * (1 - sm) + hash(m.id, row, r0 + 1) * sm;
        const dry = Math.max(0, knots(P, SP.dry, KN.dry, u)) * 9 * gap * gap, wet = SW ? (SW.wet ?? 0) * (press - 0.5) : 0, body = knots(P, SP.ink, KN.ink, u) - softplus((P[SP.u0] - u) / t0) - softplus((u - P[SP.u1]) / t1) - dry - load + 2 * wet + R[r];
        // (a sweep's row lays ink where the pressure, with the row's own unevenness, is over the row's threshold)
        if (SW) cover = 1 / (1 + Math.exp(-12 * (press * (0.7 + 0.6 * gap) - hash(m.id, row, 41) * SW.dry)));
        // (a deposit freed of the gesture lays its ink whatever its bristle does and wherever the band is)
        if (SW && free) cover = cover + (1 - cover) * free;
        const sig = 1 / (1 + Math.exp(-body)), capv = (SW ? cover : 1) * sig;
        const centre = add(add(pts[k], sub(pts[k + 1], pts[k]), f), N0, knots(P, SP.offset, KN.offset, u) * w0);
        out.push({ p: add(centre, rad, w / 2 + (R[r + 4] + stand) * w0), t, n: rad, s1: Lc * 0.9 * Math.exp(P[SP.along] + R[r + 1]), s2: ((Math.PI * w) / rows) * 0.62 * Math.exp(P[SP.spread] + wet + R[r + 2]), thin: 0.0008, turn: R[r + 3], logit: K * (Bd - nU) + (K * nU) / 3 + 4 * free, view, cap: capv, dcap: capv * (1 - sig) });
        continue;
      }
      if (tube && m.band) {
        // (a banded limb: rows in pairs, one to each side of the arc's middle; a row's part is its place across the
        // arc, q: 0 the firm edge, then the body, then bristles toward 1. Edge and bristle rows are finer than the
        // body's; the ink falls past `feather`; the bristles break up (each row its own run of gaps))
        const dir: V = m.band === true || m.band === 'seen' || m.band === 'edges' ? [0, -1, 0] : m.band, dd = dot(dir, t); let D0: V = [dir[0] - t[0] * dd, dir[1] - t[1] * dd, dir[2] - t[2] * dd];
        if (Math.hypot(D0[0], D0[1], D0[2]) < 0.3) { const alt2: V = Math.abs(t[0]) < 0.8 ? [1, 0, 0] : [0, 0, 1], da = dot(alt2, t); D0 = [alt2[0] - t[0] * da, alt2[1] - t[1] * da, alt2[2] - t[2] * da]; }
        D0 = norm(D0); const B0 = cross(t, D0), pairs = Math.ceil(rows / 2), pr = Math.floor(row / 2), sgn = row % 2 ? -1 : 1;
        const A = ((100 * Math.PI) / 180) * Math.exp(P[SP.arc] ?? BAND.arc), fine = P[SP.fine] ?? BAND.fine, qf = P[SP.feather] ?? BAND.feather, fall = P[SP.fall] ?? BAND.fall, bris = P[SP.bristle] ?? BAND.bristle;
        // (each pair's share of the arc: less where it's an edge or a bristle)
        const share = (j: number) => { const q = (j + 0.5) / pairs; return Math.exp(-fine * (Math.max(0, 1 - q / 0.22) + Math.max(0, (q - 0.68) / 0.32))); };
        let tot = 0, before = 0; for (let j = 0; j < pairs; j++) { const sh = share(j); if (j < pr) before += sh; tot += sh; }
        const q = (before + share(pr) / 2) / tot, phi = sgn * q * A, c = Math.cos(phi), sn = Math.sin(phi), rad: V = [D0[0] * c + B0[0] * sn, D0[1] * c + B0[1] * sn, D0[2] * c + B0[2] * sn];
        const run = s / (5 * w0) + hash(m.id, row, 7) * 16, r0 = Math.floor(run), rf = run - r0, sm = rf * rf * (3 - 2 * rf), gap = hash(m.id, row, r0) * (1 - sm) + hash(m.id, row, r0 + 1) * sm;
        const dry = Math.max(0, knots(P, SP.dry, KN.dry, u)) * (0.12 + bris * q * q * 3) * 9 * gap * gap, past = Math.max(0, (q - qf) / Math.max(0.05, 1 - qf));
        const centre = add(add(pts[k], sub(pts[k + 1], pts[k]), f), D0, -knots(P, SP.offset, KN.offset, u) * w0);
        out.push({ p: add(centre, rad, w / 2 + R[r + 4] * w0), t, n: rad, s1: Lc * 0.9 * Math.exp(P[SP.along] + R[r + 1]), s2: ((A * w) / 2) * (share(pr) / tot) * 0.62 * Math.exp(P[SP.spread] + R[r + 2]), thin: 0.0008, turn: R[r + 3], logit: knots(P, SP.ink, KN.ink, u) - softplus((P[SP.u0] - u) / t0) - softplus((u - P[SP.u1]) / t1) - dry - fall * 6 * past * past + R[r] });
        continue;
      }
      if (tube) {
        // (round a tube: this row's place round it; its deposit lies on the tube's surface, facing out)
        const N0 = norm(sub(Math.abs(t[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], [t[0] * (Math.abs(t[1]) < 0.95 ? t[1] : t[0]), t[1] * (Math.abs(t[1]) < 0.95 ? t[1] : t[0]), t[2] * (Math.abs(t[1]) < 0.95 ? t[1] : t[0])])), B0 = cross(t, N0);
        const th = ((row + 0.5) / rows) * Math.PI * 2 + hash(m.id, 3, 3) * 6.28, c = Math.cos(th), sn = Math.sin(th), rad: V = [N0[0] * c + B0[0] * sn, N0[1] * c + B0[1] * sn, N0[2] * c + B0[2] * sn];
        const run = s / (5 * w0) + hash(m.id, row, 7) * 16, r0 = Math.floor(run), rf = run - r0, sm = rf * rf * (3 - 2 * rf), gap = hash(m.id, row, r0) * (1 - sm) + hash(m.id, row, r0 + 1) * sm;
        const dry = Math.max(0, knots(P, SP.dry, KN.dry, u)) * Math.max(0, 1 + P[SP.drySide] * c) * 9 * gap * gap;
        const centre = add(add(pts[k], sub(pts[k + 1], pts[k]), f), N0, knots(P, SP.offset, KN.offset, u) * w0);
        out.push({ p: add(centre, rad, w / 2 + R[r + 4] * w0), t, n: rad, s1: Lc * 0.9 * Math.exp(P[SP.along] + R[r + 1]), s2: ((Math.PI * w) / rows) * 0.62 * Math.exp(P[SP.spread] + R[r + 2]), thin: 0.0008, turn: R[r + 3], logit: knots(P, SP.ink, KN.ink, u) - softplus((P[SP.u0] - u) / t0) - softplus((u - P[SP.u1]) / t1) - dry - (m.shade ?? 0) * 3 * (1 + (m.light ? dot(rad, m.light) : c)) + R[r] });
        continue;
      }
      const b = cross(n, t);
      const s2 = ((w * rw[row]) / rs) * 0.62 * Math.exp(P[SP.spread] + R[r + 2]);
      const side = knots(P, SP.offset, KN.offset, u) * w0 + v * w * 0.9 + (R[r + 4] + alt * P[SP.step]) * w0;
      // (dryness: each row has its own run of gaps along the stroke, a few widths long; drier to one side)
      const run = s / (5 * w0) + hash(m.id, row, 7) * 16, r0 = Math.floor(run), rf = run - r0, sm = rf * rf * (3 - 2 * rf);
      const gap = hash(m.id, row, r0) * (1 - sm) + hash(m.id, row, r0 + 1) * sm;
      const dry = Math.max(0, knots(P, SP.dry, KN.dry, u)) * Math.max(0, 1 + 2 * P[SP.drySide] * v) * 9 * gap * gap;
      out.push({ p: add(add(add(pts[k], sub(pts[k + 1], pts[k]), f), b, side), n, free ? 0 : 0.002), t, n, s1: Lc * 0.9 * Math.exp(P[SP.along] + R[r + 1]), s2, thin: free ? s2 : 0.0008, turn: R[r + 3] + alt * P[SP.splay], logit: knots(P, SP.ink, KN.ink, u) - softplus((P[SP.u0] - u) / t0) - softplus((u - P[SP.u1]) / t1) - dry + R[r] });
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
    layout(m).forEach((d, i) => { const own = d.view ? d.view.slice(1).reduce((a, v) => a + Math.abs(v), 0) + d.view[0] : 0; if ((d.cap ?? 1) / (1 + Math.exp(-(d.logit + lift + own))) > floor) all.push({ d, m, i, colour: m.colour ?? INK }); });
  }
  loose.forEach((l, i) => { if (1 / (1 + Math.exp(-l.d.logit)) > floor) all.push({ d: l.d, m: null, i, colour: l.colour ?? INK }); });
  const N = all.length;
  const s = { n: N, pos: new Float32Array(N * 3), scale: new Float32Array(N * 3), rot: new Float32Array(N * 4), rgba: new Uint8Array(N * 4), mark: new Uint8Array(N), rank: new Float32Array(N), normal: new Float32Array(N * 3), feature: new Uint32Array(N), element: new Uint32Array(N), support: new Uint8Array(N), coef: new Float32Array(N * 12), owner: new Uint32Array(N) };
  all.forEach(({ d, m, i, colour }, k) => {
    const [x, y, z] = axes(d);
    s.pos.set(d.p, k * 3); s.scale.set([Math.max(d.s1, 0.0002), Math.max(d.s2, 0.0002), Math.max(d.thin, 0.0002)], k * 3); s.rot.set(quat(x, y, z), k * 4); s.normal.set(d.n, k * 3);
    // (on a surface: given its plane's depth, so the face it lies on doesn't cut it; in open space: its own)
    s.support[k] = d.thin < 0.002 ? 1 : 3; s.rgba.set([colour[0], colour[1], colour[2], Math.round(255 * (d.cap ?? 1))], k * 4); s.mark[k] = 12; s.rank[k] = 1; s.element[k] = m ? m.id : 0; s.feature[k] = i + 1; s.owner[k] = m ? m.id : 0;
    s.coef[k * 12] = d.logit + (m ? m.view[0] : 0) + (d.view?.[0] ?? 0); if (d.view && !m) for (let b = 1; b < VIEW_TERMS; b++) s.coef[k * 12 + b] = d.view[b];
    if (m) { for (let b = 1; b < VIEW_TERMS; b++) s.coef[k * 12 + b] = m.view[b] + (d.view?.[b] ?? 0); if (m.lod) { s.coef[k * 12 + 9] = m.lod[0]; s.coef[k * 12 + 10] = m.lod[1]; }
      // (its share of its mark's sway: none where it hangs from, all at its far end)
      if (m.sway) { const rows = Math.max(1, m.rows ?? 1), u = (Math.floor(i / rows) + 0.5) / Math.ceil(m.count / rows); s.coef[k * 12 + 11] = m.sway * u * u; } }
  });
  return s;
}
