/**
 * Brushwork: a look in which everything visible is paint laid as brush strokes, each stroke deposited as one or a few
 * splats (oriented, instanced stamps). The geometry says what exists, what can be touched and what is in front; the
 * brush says what to say about it. After Switchback's painted mode, whose mountain is solid in depth and visible only
 * as marks placed on it.
 *
 *   features   what a rule can draw (from the city and the rig, each with a stable key): a wall or roof plane (its
 *              outline, its axes, which way it faces), a lip (an edge hold: the coping a palm can catch), a sill, a
 *              pipe, a bar, the runner's bones (its masses and limbs, the hand and shoe at contact), the runner's shadow
 *              thrown on what receives it
 *   marks      what a rule says about them (`Mark`): a path on its support (two ends; a plane's normal, or none: an
 *              edge, turned about its own line to the eye), a width and taper, a pigment and how opaque, a kind of
 *              footprint (a loaded pull with a dry lift, a wash, ink, a shadow passage, a wash hung from an edge, a
 *              dab), a rank (how long it survives as the picture simplifies), a layer, and a seed from its key
 *   stamps     what is drawn: each mark as one stamp, or a few that tile it exactly (`deposit`); a stamp knows where it
 *              lies along its whole mark, so the taper, the load and the bristles run on across the joins
 *
 * The frame, in order (`StrokePainter.draw`): the paper; the solid world (the city and the posed body) into depth
 * only; then the paint against that depth, depth writes off, layer by layer (broad colour, shadow, edges and lips,
 * accents), the runner's shadow between the shadow and the edges, the runner last. Every plane stamp is a quad lying
 * on its support, so the depth it's tested at is its support's under every pixel (a long mark crossing the screen at a
 * slant is right along all of it, and one whose centre is off screen or behind the eye is clipped as geometry, not
 * lost); it sits a little toward the eye, by a bias that grows with distance, and is cut to its own receiver. A dry gap
 * in a foreground wall shows paper, because the wall is still in depth.
 *
 * The city's stamps are made once a chunk, when it's first drawn, and kept; the runner's (a few dozen) each frame. Whole
 * marks withdraw with distance by rank, all of a mark's stamps together (they fade on its anchor), so detail goes as
 * whole gestures, and a lip that can be held (rank 1) never goes within what's drawn.
 *
 * A look gives the rules (`StrokeRules`: looks/stroke-gouache.ts, looks/sumi.ts); this module is the machinery the two
 * share, and the camera, the replay, the city and the rig are the same for both.
 */
import type { Box, Chunk, City, Hold } from './city';
import { TAG } from './city';
import type { Bone } from './rig';
import type { M4 } from './m4';
import { point } from './m4';

export type V = [number, number, number];
export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const mix = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** a 32-bit hash of a key (FNV-1a, mixed): a mark's seed from its feature's key, never from the order it was made in */
export function hashKey(k: string): number {
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return (h >>> 0) || 1;
}
/** a random stream from a seed (mulberry32): each feature draws its marks' dice from its own */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r2 = (x: number) => (Math.round(x * 100) / 100).toString();

/** a stamp's footprint */
export const K = {
  /** a loaded pull: opaque, irregular sides, bristles, a dry lift toward its exit */
  PULL: 0,
  /** a wash: soft and translucent, pigment pooling at its edge */
  WASH: 1,
  /** ink: dense, pressed at its heart, tapering, flying white where it runs dry */
  INK: 2,
  /** a shadow passage: a pull that is laid only where the sun map says its place is out of the light */
  SHADE: 3,
  /** a wash hung from an edge (the stamp's +across side), reaching down unevenly */
  HANG: 4,
  /** a dab: an oval, loaded (a head, a hand) */
  DAB: 5,
  /** an underpainting: the whole of its receiver, flat and opaque, a little uneven (what the broad strokes go over) */
  FILL: 6,
} as const;
/** added to a kind: the mark turns about its own line to face the eye (an edge between two faces, a bar, a pipe) */
export const EDGE = 8;
/** the layers, painted in this order: broad colour, shadow, edges and lips, accents */
export const LAYER = { BROAD: 0, SHADOW: 1, EDGE: 2, ACCENT: 3 } as const;
const LAYERS = 4;
/** floats a stamp: nine vec4s */
export const STAMP = 44;

/** A mark, as a rule says it. */
export interface Mark {
  layer: number; kind: number;
  /** its path's two ends */
  a: V; b: V;
  /** the support's normal (it lies on that plane); or `side`, the way across it, given (the runner's, turned to the eye);
   * neither: an edge (EDGE in its kind) */
  n?: V; side?: V;
  width: number; col: V; alpha: number;
  /** how dry its exit (0..1); where along it the load is fullest (0..1); its taper in and out (m) */
  dry?: number; heart?: number; taper?: [number, number];
  /** how long it survives as the picture simplifies (0: first to go … 1: kept within all that's drawn) */
  rank?: number;
  /** its identity: the seed of its bristles and wander */
  key: string;
  /** the receiver it's cut to (world box) */
  clip?: [V, V];
  /** the longest a single stamp of it may be (m): longer, and it's tiled */
  seg?: number;
  /** a sky mark: no haze, never withdrawn */
  sky?: boolean;
  /** a figure's mark: how much of its colour it takes from the lit body underneath it (0: its own; 1: the body's), where the
   * body is under it */
  body?: number;
  /** a second pigment carried in the brush, laid by irregular bristle groups and heavier on one side; how much of it */
  col2?: V; mix2?: number;
  /** a bent mark: its path, a to b through these (a, then the points, then b); one stroke, its taper, load and dry lift over the
   * whole length, its stamps one a leg, overlapping at each bend (Switchback's strokes bend on strips) */
  path?: V[];
  /** a bent mark's width at each of its points (a, the path's, b): the form swelling and narrowing along it */
  widths?: number[];
  /** the splat's surface: the normal of what it lies on (lit by the sun, its bristles' relief bumping it; and seen edge-on it
   * narrows and fades). None: lit as before */
  surf?: V;
  /** its paint load (0..1): thick and opaque where it lands, draining along it to dry-brush; its relief is the paint's thickness */
  load?: number;
  /** wet into wet (0..1): how much of the paint already under it it picks up and drags along, strongest where it lands; and
   * how far it drags it (m) */
  pick?: number; smear?: number;
}

const NOCLIP: [V, V] = [[-1e5, -1e5, -1e5], [1e5, 1e5, 1e5]];
/** Deposit a mark as its stamps: one, or several tiling it exactly, each knowing its share of the whole. */
export function deposit(m: Mark, out: number[]): void {
  if (m.path && m.path.length) { depositPath(m, out); return; }
  const d = sub(m.b, m.a), L = len(d);
  if (L < 1e-5) return;
  const dir = scale(d, 1 / L);
  const across = m.side ? unit(m.side) : m.n ? unit(cross(m.n, dir)) : unit(Math.abs(dir[1]) > 0.9 ? cross(dir, [1, 0, 0]) : cross(dir, [0, 1, 0]));
  const hw = (m.width / 2) * 1.15, n = Math.max(1, Math.ceil(L / (m.seg ?? Infinity))), seed = (hashKey(m.key) % 100000) / 100000;
  const clip = m.clip ?? NOCLIP, anchor = add(m.a, scale(d, m.heart ?? 0.5)), Lm = Math.max(L, 1e-4);
  const [tin, tout] = m.taper ?? [Math.min(Lm * 0.3, m.width * 0.6), Math.min(Lm * 0.45, m.width * 1.5)];
  for (let i = 0; i < n; i++) {
    const s0 = i / n, s1 = (i + 1) / n, c = add(m.a, scale(d, (s0 + s1) / 2)), U = scale(d, (s1 - s0) / 2), Vv = scale(across, hw);
    out.push(c[0], c[1], c[2], m.alpha, U[0], U[1], U[2], m.kind, Vv[0], Vv[1], Vv[2], seed, m.col[0], m.col[1], m.col[2], m.rank ?? 0.5,
      anchor[0], anchor[1], anchor[2], m.dry ?? 0, clip[0][0], clip[0][1], clip[0][2], s0, clip[1][0], clip[1][1], clip[1][2], s1, m.heart ?? 0.5, tin, tout, m.sky ? 1 : -(m.body ?? 0), ...(m.col2 ?? m.col), m.mix2 ?? 0, ...(m.surf ?? [0, 0, 0]), m.load ?? 0, m.pick ?? 0, m.smear ?? 0.15, 1, 1);
  }
}

/** a bent mark's stamps: a leg of its path each, each knowing its share of the whole length (so the shader's taper, bristles and
 * dry lift run the whole stroke), lapped a little past each bend so no gap opens there, its width across each leg as it turns */
/** a path smoothed: Catmull-Rom through its points, four legs between each pair; widths eased along with it */
function smoothPath(pts: V[], ws?: number[]): { pts: V[]; ws?: number[] } {
  if (pts.length < 3) return { pts, ws };
  const out: V[] = [], ow: number[] = [], S = 4, at = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))], wa = (i: number) => ws![Math.max(0, Math.min(ws!.length - 1, i))];
  for (let i = 0; i + 1 < pts.length; i++) for (let s = 0; s < S; s++) {
    const t = s / S, t2 = t * t, t3 = t2 * t, p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    out.push([0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)) as V);
    if (ws) { const e = t * t * (3 - 2 * t); ow.push(wa(i) + (wa(i + 1) - wa(i)) * e); }
  }
  out.push(pts[pts.length - 1]); if (ws) ow.push(ws[ws.length - 1]);
  return { pts: out, ws: ws ? ow : undefined };
}
function depositPath(m: Mark, out: number[]): void {
  const sm = smoothPath([m.a, ...m.path!, m.b], m.widths && m.widths.length === m.path!.length + 2 ? m.widths : undefined);
  m = { ...m, widths: sm.ws };
  const pts = sm.pts, legs: { a: V; b: V; l: number; k: number }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) { const l = len(sub(pts[i + 1], pts[i])); if (l > 1e-5) legs.push({ a: pts[i], b: pts[i + 1], l, k: i }); }
  const L = legs.reduce((t, g) => t + g.l, 0); if (L < 1e-5) return;
  const hw = (m.width / 2) * 1.15, seed = (hashKey(m.key) % 100000) / 100000, clip = m.clip ?? NOCLIP, Lm = Math.max(L, 1e-4);
  const [tin, tout] = m.taper ?? [Math.min(Lm * 0.3, m.width * 0.6), Math.min(Lm * 0.45, m.width * 1.5)];
  // (the anchor, where the load is fullest along the whole: what withdraws it, all its stamps together)
  let at = (m.heart ?? 0.5) * L, anchor = m.a; for (const g of legs) { if (at <= g.l) { anchor = add(g.a, scale(sub(g.b, g.a), at / g.l)); break; } at -= g.l; }
  let run = 0;
  legs.forEach((g, i) => {
    const dir = scale(sub(g.b, g.a), 1 / g.l), lap = Math.min(hw * 0.6, g.l * 0.4), e0 = i > 0 ? lap : 0, e1 = i < legs.length - 1 ? lap : 0;
    const a = sub(g.a, scale(dir, e0)), b = add(g.b, scale(dir, e1)), s0 = Math.max(0, (run - e0) / L), s1 = Math.min(1, (run + g.l + e1) / L);
    run += g.l;
    let across: V;
    if (m.side) { const sd = unit(m.side), k = dot(sd, dir); across = sub(sd, scale(dir, k)); across = len(across) > 1e-4 ? unit(across) : sd; }
    else across = m.n ? unit(cross(m.n, dir)) : unit(Math.abs(dir[1]) > 0.9 ? cross(dir, [1, 0, 0]) : cross(dir, [0, 1, 0]));
    // (a swelling mark: the leg's stamp as wide as its wider end, its ends' widths as shares of that, eased between in the shader)
    const wa = m.widths && m.widths.length === pts.length ? m.widths[g.k] : 0, wb = m.widths && m.widths.length === pts.length ? m.widths[g.k + 1] : 0;
    const lw = wa || wb ? (Math.max(wa, wb) / 2) * 1.15 : hw, r0 = wa || wb ? wa / Math.max(wa, wb) : 1, r1 = wa || wb ? wb / Math.max(wa, wb) : 1;
    const c = scale(add(a, b), 0.5), U = scale(sub(b, a), 0.5), Vv = scale(across, lw);
    out.push(c[0], c[1], c[2], m.alpha, U[0], U[1], U[2], m.kind, Vv[0], Vv[1], Vv[2], seed, m.col[0], m.col[1], m.col[2], m.rank ?? 0.5,
      anchor[0], anchor[1], anchor[2], m.dry ?? 0, clip[0][0], clip[0][1], clip[0][2], s0, clip[1][0], clip[1][1], clip[1][2], s1, m.heart ?? 0.5, tin, tout, m.sky ? 1 : -(m.body ?? 0), ...(m.col2 ?? m.col), m.mix2 ?? 0, ...(m.surf ?? [0, 0, 0]), m.load ?? 0, m.pick ?? 0, m.smear ?? 0.15, r0, r1);
  });
}

// ─── features

/** a plane a rule can paint: a wall or a top (or the street), with its own axes: o + t·[0,w] + up·[0,h] */
export interface Plane { key: string; box: Box | null; n: V; o: V; t: V; up: V; w: number; h: number; top: boolean; clip: [V, V]; seed: number }
/** a lip: an edge hold along a box's top, the coping a hand can catch, and what's across from it */
export interface Lip { key: string; hold: Hold; box: Box | null; a: V; b: V; n: V; len: number; across: number; acrossH: number; seed: number }

const inside = (p: V, o: Box) => p[0] > o.x0 && p[0] < o.x1 && p[1] > o.y0 && p[1] < o.y1 && p[2] > o.z0 && p[2] < o.z1;
/** a box's colour seed: its own, from where it is */
export const boxSeed = (b: Box) => (hashKey(`${r2(b.x0)},${r2(b.z0)},${r2(b.y1)}`) % 10000) / 10000;

/** The planes of a box that can be seen: its top and its four sides, less any wholly behind a neighbour. */
export function planesOf(b: Box, near: Box[]): Plane[] {
  const out: Plane[] = [], seed = boxSeed(b), id = `${r2(b.x0)},${r2(b.z0)},${r2(b.x1)},${r2(b.z1)},${r2(b.y1)}`;
  const covered = (pts: V[]) => pts.every((p) => near.some((o) => o !== b && inside(p, o)));
  const w = b.x1 - b.x0, d = b.z1 - b.z0, H = b.y1 - b.y0, e = 0.01;
  // (the top, along its longer way)
  {
    const alongX = w >= d, o: V = [b.x0, b.y1, b.z0], t: V = alongX ? [1, 0, 0] : [0, 0, 1], up: V = alongX ? [0, 0, 1] : [1, 0, 0];
    const pts: V[] = [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]].map(([i, j]) => [b.x0 + w * i, b.y1 + 0.05, b.z0 + d * j]);
    if (!covered(pts)) out.push({ key: `${id}/top`, box: b, n: [0, 1, 0], o, t, up, w: alongX ? w : d, h: alongX ? d : w, top: true, clip: [[b.x0 - e, b.y1 - 1, b.z0 - e], [b.x1 + e, b.y1 + 1, b.z1 + e]], seed });
  }
  const sides: [V, V, V, number][] = [
    [[0, 0, -1], [b.x1, b.y0, b.z0], [-1, 0, 0], w], [[0, 0, 1], [b.x0, b.y0, b.z1], [1, 0, 0], w],
    [[-1, 0, 0], [b.x0, b.y0, b.z0], [0, 0, 1], d], [[1, 0, 0], [b.x1, b.y0, b.z1], [0, 0, -1], d],
  ];
  for (const [n, o, t, W] of sides) {
    const pts: V[] = [];
    for (const fu of [0.2, 0.5, 0.8]) for (const fv of [0.2, 0.8]) pts.push(add(add(o, scale(t, W * fu)), add([0, H * fv, 0], scale(n, 0.05))));
    if (covered(pts)) continue;
    const lo: V = [Math.min(b.x0, b.x1), b.y0 - e, Math.min(b.z0, b.z1)], hi: V = [b.x1, b.y1 + e, b.z1];
    // (cut to the face: its own plane, give or take the bias the stamps sit toward the eye by)
    const k = n[0] ? 0 : 2, at = n[k] < 0 ? (k ? b.z0 : b.x0) : (k ? b.z1 : b.x1);
    lo[k] = at - 1; hi[k] = at + 1; lo[2 - k] -= e; hi[2 - k] += e;
    out.push({ key: `${id}/${n.join('')}`, box: b, n, o, t, up: [0, 1, 0], w: W, h: H, top: false, clip: [lo, hi], seed });
  }
  return out;
}

/** The lips of a chunk (its edge holds), each with the box it tops and what's across from it, out along its face. */
export function lipsOf(c: Chunk, city: City): Lip[] {
  const out: Lip[] = [];
  for (const h of c.holds) {
    if (h.kind !== 'edge') continue;
    const a: V = [h.ax, h.ay, h.az], b: V = [h.bx, h.by, h.bz], n: V = [h.nx, 0, h.nz], L = len(sub(b, a));
    if (L < 0.3) continue;
    const mid = scale(add(a, b), 0.5);
    const box = c.boxes.find((o) => Math.abs(o.y1 - h.ay) < 0.02 && mid[0] >= o.x0 - 0.02 && mid[0] <= o.x1 + 0.02 && mid[2] >= o.z0 - 0.02 && mid[2] <= o.z1 + 0.02) ?? null;
    // (across: the first thing taller than a storey out along the face, within an alley's width)
    let across = Infinity, acrossH = 0;
    for (let s = 0.4; s <= 8; s += 0.4) { const y = city.heightAt(mid[0] + n[0] * s, mid[2] + n[2] * s); if (y > Math.max(3, h.ay - 9) && y > 1) { across = s; acrossH = y; break; } }
    out.push({ key: `lip:${r2(h.ax)},${r2(h.ay)},${r2(h.az)},${r2(h.bx)},${r2(h.bz)}`, hold: h, box, a, b, n, len: L, across, acrossH, seed: box ? boxSeed(box) : 0.5 });
  }
  return out;
}

/** whether a point is out of the sun: the city's tops, looked along the light from it (static: asked once, when a
 * chunk's marks are made) */
export function shadowed(city: City, p: V, sun: V, far = 60): boolean {
  const d = unit(sun), step = 0.6, top = 40;
  for (let s = step; s < far; s += step) {
    const y = p[1] + d[1] * s; if (y > top) return false;
    if (city.heightAt(p[0] + d[0] * s, p[2] + d[2] * s) > y) return true;
  }
  return false;
}

/** where along a lip a course's line of travel crosses it (the course's start x, running along z), if it does */
export function onLine(city: City, a: V, b: V): number | null {
  const x = city.course?.start.x; if (x === undefined || Math.abs(b[0] - a[0]) < 1e-3) return null;
  const u = (x - a[0]) / (b[0] - a[0]); return u > 0.02 && u < 0.98 ? u : null;
}

/** a part of the runner as a rule can paint it: a bone's line (in front of the bone, toward the eye), its width as seen,
 * the way across it, how its turned faces take the sun; whether a foot bears weight, whether a hand is closed on a hold */
export interface Part { name: string; kind: string; mat: number; a: V; b: V; side: V; toEye: V; width: number; length: number;
  /** how end-on it's seen (0: side on … 1: along its length), and its girth (what's seen of it end-on) */
  endOn: number; girth: number;
  /** (a foot) the height of what's under it */
  ground: number; sunSide: number; sunFront: number; planted: boolean; gripping: boolean;
  /** the way the bone faces (its own z: the face, the chest, the toes); how far its middle is from the eye (for painting far
   * to near: its marks are brought forward by its thickness, its middle isn't) */
  fwd: V; dist: number;
  /** a cloth's quad (rig.ts): its column and row and the columns round; its top and bottom (middles), brought forward as a and b
   * are; its width */
  grid?: [number, number, number]; top?: V; bot?: V; gw?: number }

/**
 * The lit body's mesh: each bone a smooth tube, its cross-section an ellipse from its start's width and depth to its end's,
 * with a domed cap past each end (so joints round over and a short block (a head, a hand, a foot) is an egg), smooth normals.
 * Floats a vertex: position, normal, material.
 */
const BN = 8, BCAP = 2, BRINGS = BCAP * 2 + 2, BVERTS = BRINGS * (BN + 1);
let bodyBuf = new Float32Array(1 << 14);
/** the lit body's triangles, as indices into bodyMesh's vertices: the same pattern a bone, offset (made once, for this many) */
export function bodyIndex(bones: number): Uint32Array {
  const out = new Uint32Array(bones * (BRINGS - 1) * BN * 6); let at = 0;
  for (let k = 0; k < bones; k++) { const base = k * BVERTS; for (let r = 0; r + 1 < BRINGS; r++) for (let j = 0; j < BN; j++) {
    const a = base + r * (BN + 1) + j, b = a + 1, c = a + BN + 2, d = a + BN + 1; out[at++] = a; out[at++] = b; out[at++] = c; out[at++] = a; out[at++] = c; out[at++] = d; } }
  return out;
}
export function bodyMesh(bones: Bone[]): Float32Array {
  if (bodyBuf.length < bones.length * BVERTS * 7) bodyBuf = new Float32Array(bones.length * BVERTS * 7 * 1.25);
  const out = bodyBuf, ring = new Float64Array(BRINGS * 4); let at = 0;
  for (const b of bones) {
    const m = b.m, x0 = b.x ?? 0, zc = b.zc ?? 0, s = Math.sign(b.y1 - b.y0) || 1, mat = b.mat ?? 0, r0 = Math.min(b.w0, b.d0) / 2, r1 = Math.min(b.w1, b.d1) / 2;
    // (rings, from the start's cap through the tube to the end's: y, half width, half depth, how far the normal tips along)
    let ri = 0; const put = (y: number, hw: number, hd: number, tip: number) => { ring[ri * 4] = y; ring[ri * 4 + 1] = hw; ring[ri * 4 + 2] = hd; ring[ri * 4 + 3] = tip; ri++; };
    for (let k = BCAP; k >= 1; k--) { const ph = (k / BCAP) * (Math.PI / 2) * 0.9, c = Math.cos(ph); put(b.y0 - s * r0 * Math.sin(ph) * 0.7, (b.w0 / 2) * c, (b.d0 / 2) * c, -s * Math.sin(ph)); }
    put(b.y0, b.w0 / 2, b.d0 / 2, 0); put(b.y1, b.w1 / 2, b.d1 / 2, 0);
    for (let k = 1; k <= BCAP; k++) { const ph = (k / BCAP) * (Math.PI / 2) * 0.9, c = Math.cos(ph); put(b.y1 + s * r1 * Math.sin(ph) * 0.7, (b.w1 / 2) * c, (b.d1 / 2) * c, s * Math.sin(ph)); }
    for (let r = 0; r < BRINGS; r++) for (let j = 0; j <= BN; j++) {
      const y = ring[r * 4], hw = ring[r * 4 + 1], hd = ring[r * 4 + 2], tip = ring[r * 4 + 3], a = (2 * Math.PI * j) / BN, ca = Math.cos(a), sa = Math.sin(a), k = Math.sqrt(1 - tip * tip);
      const lx = x0 + ca * hw, lz = zc + sa * hd; let nx = ca / Math.max(hw, 1e-4), nz = sa / Math.max(hd, 1e-4); const nl = Math.hypot(nx, nz) || 1; nx = (nx / nl) * k; nz = (nz / nl) * k;
      out[at++] = m[0] * lx + m[4] * y + m[8] * lz + m[12]; out[at++] = m[1] * lx + m[5] * y + m[9] * lz + m[13]; out[at++] = m[2] * lx + m[6] * y + m[10] * lz + m[14];
      out[at++] = m[0] * nx + m[4] * tip + m[8] * nz; out[at++] = m[1] * nx + m[5] * tip + m[9] * nz; out[at++] = m[2] * nx + m[6] * tip + m[10] * nz; out[at++] = mat;
    }
  }
  return out.subarray(0, at);
}

/** The runner's bones as parts, from the pose and the eye. */
export function partsOf(bones: Bone[], eye: number[], sun: V, city: City): Part[] {
  const out: Part[] = [];
  for (const bn of bones) {
    const m = bn.m, X: V = unit([m[0], m[1], m[2]]), Y: V = unit([m[4], m[5], m[6]]), Z: V = unit([m[8], m[9], m[10]]);
    const W = Math.max(bn.w0, bn.w1), D = Math.max(bn.d0, bn.d1), Ly = Math.abs(bn.y1 - bn.y0), x = bn.x ?? 0, ym = (bn.y0 + bn.y1) / 2;
    let a: V, b: V, P: V, Q: V, pw: number, qw: number;
    if (Ly >= W && Ly >= D) { a = point(m, x, bn.y0, bn.zc) as V; b = point(m, x, bn.y1, bn.zc) as V; P = X; Q = Z; pw = W; qw = D; }
    else if (D >= W) { a = point(m, x, ym, bn.zc - D / 2) as V; b = point(m, x, ym, bn.zc + D / 2) as V; P = X; Q = Y; pw = W; qw = Ly; }
    else { a = point(m, x - W / 2, ym, bn.zc) as V; b = point(m, x + W / 2, ym, bn.zc) as V; P = Z; Q = Y; pw = D; qw = Ly; }
    const c = scale(add(a, b), 0.5), e = unit(sub(eye as V, c)), dir = unit(sub(b, a));
    let side = cross(dir, e); side = len(side) < 1e-3 ? P : unit(side);
    // (in front of the bone toward the eye: by its cross-section, and, seen end-on, by half its length too)
    const width = Math.abs(dot(P, side)) * pw + Math.abs(dot(Q, side)) * qw, depth = 0.5 * (Math.abs(dot(P, e)) * pw + Math.abs(dot(Q, e)) * qw + Math.abs(dot(dir, e)) * len(sub(b, a))) + 0.015;
    const kind = bn.name.startsWith('worn:') ? 'worn' : bn.name.replace(/[LR]$/, '');
    let planted = false, gripping = false;
    if (kind === 'foot') { const lo = Math.min(a[1], b[1]) - qw / 2; planted = lo - city.heightAt(c[0], c[2]) < 0.07; }
    if (kind === 'foreArm') {
      const h = b; for (const o of city.holdsNear(h[0], h[2], 0.6)) if (o.kind !== 'face') { const d = segDist(h, [o.ax, o.ay, o.az], [o.bx, o.by, o.bz]); if (d < 0.1) { gripping = true; break; } }
    }
    // (a hand's parts: closed on a hold, or the palm planted on what's under it (a vault's box, a rail's top))
    if (kind === 'palm' || kind === 'fingers' || kind === 'tips') {
      for (const o of city.holdsNear(c[0], c[2], 0.6)) if (o.kind !== 'face') { const d = segDist(c, [o.ax, o.ay, o.az], [o.bx, o.by, o.bz]); if (d < 0.12) { gripping = true; break; } }
      const under = city.heightAt(c[0], c[2]); if (!gripping && under > 0.05 && c[1] - under < 0.16 && c[1] - under > -0.04) planted = true;
    }
    out.push({ name: bn.name, kind, mat: bn.mat ?? 0, a: add(a, scale(e, depth)), b: add(b, scale(e, depth)), side, toEye: e, width, length: len(sub(b, a)), endOn: Math.abs(dot(dir, e)), girth: Math.max(pw, qw) * 1.15, ground: kind === 'foot' ? city.heightAt(c[0], c[2]) : 0, sunSide: dot(side, sun), sunFront: dot(e, sun), planted, gripping, fwd: Z, dist: len(sub(eye as V, c)) - (/^worn:(shin|thigh|upperArm|foreArm|foot)/.test(bn.name) ? 0.08 : 0),
      ...(bn.grid ? { grid: bn.grid, top: add(point(m, 0, 0, 0) as V, scale(e, depth)), bot: add(point(m, 0, bn.y1, 0) as V, scale(e, depth)), gw: (bn.w0 + bn.w1) / 2 } : {}) });
  }
  return out;
}
function segDist(p: V, a: V, b: V): number {
  const d = sub(b, a), l2 = dot(d, d), t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  return len(sub(p, add(a, scale(d, t))));
}

/** what the runner's shadow falls on: the top under it, and a wall the light carries it onto (as render.ts's cast) */
export interface Receiver { n: V; d: number; clip: [V, V]; strength: number; box: Box | null }
export function receivers(city: City, px: number, py: number, pz: number, sun: V): Receiver[] {
  const L = scale(unit(sun), -1), out: Receiver[] = [];
  const top = city.topAt(px, pz), gy = city.heightAt(px, pz);
  if (py - gy < 12) out.push({ n: [0, 1, 0], d: gy, clip: top ? [[top.x0, gy - 0.6, top.z0], [top.x1, gy + 0.6, top.z1]] : [[px - 30, gy - 0.6, pz - 30], [px + 30, gy + 0.6, pz + 30]], strength: Math.max(0, 1 - (py - gy) / 12), box: top });
  const hl = Math.hypot(L[0], L[2]) || 1, hx = L[0] / hl, hz = L[2] / hl, drop = L[1] / hl;
  let wx = px, wz = pz;
  for (let s = 0.3; s <= 7; s += 0.15) {
    const x = px + hx * s, z = pz + hz * s, y = py + drop * s;
    if (city.heightAt(x, z) > y + 0.3) {
      const b = city.boxesNear(x, z, 0.01).find((o) => x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1 && o.y1 > y);
      if (b) {
        const fromX = wx < b.x0 ? -1 : wx >= b.x1 ? 1 : 0, fromZ = wz < b.z0 ? -1 : wz >= b.z1 ? 1 : 0;
        const n: V = fromX ? [fromX, 0, 0] : [0, 0, fromZ || -Math.sign(hz)], d = n[0] ? (fromX < 0 ? b.x0 : b.x1) * n[0] : (n[2] < 0 ? b.z0 : b.z1) * n[2];
        const k = n[0] ? 0 : 2, lo: V = [b.x0, Math.max(b.y0, gy), b.z0], hi: V = [b.x1, b.y1, b.z1]; lo[k] -= 0.6; hi[k] += 0.6;
        out.push({ n, d, clip: [lo, hi], strength: Math.max(0, 1 - s / 7), box: b });
      }
      break;
    }
    wx = x; wz = z;
  }
  return out;
}
/** a point thrown along the light onto a receiver (null: the light doesn't carry it there) */
export function onto(p: V, r: Receiver, sun: V): V | null {
  const L = scale(unit(sun), -1), k = dot(r.n, L);
  if (k > -0.05) return null;
  const t = (r.d - dot(r.n, p)) / k; return t < -0.05 ? null : add(p, scale(L, Math.max(0, t)));
}

/** The light a frame is painted in: the sun, the sky's two ends, the haze; and the roof a picture leads to (the first
 * landing, from the menu). Made from a time of day (menu.ts TIMES) or the look's own; the city is repainted when it changes. */
export interface Light { sun: V; top: V; horizon: V; haze: V; hazeNear: number; focus: { x0: number; z0: number; x1: number; z1: number; y: number } | null; key: string }
export const lightKey = (l: Omit<Light, 'key'>) => [l.sun, l.top, l.horizon, l.haze].map((v) => v.map((x) => x.toFixed(3)).join(',')).join('|') + `|${l.hazeNear}|${l.focus ? Object.values(l.focus).join(',') : ''}`;

/** A look's rules: what to say about each feature, and how. */
export interface StrokeRules {
  /** the ground of the image, and how much its grain shows */
  paper: V; grain: number;
  /** what the distance goes to, from where (a share of how far is drawn), and whether it fades to the paper instead
   * (1: marks go transparent; 0: they take the haze's colour) */
  haze: V; hazeNear: number; fadeToPaper: number;
  /** the light, toward it */
  sun: V;
  /** the city's marks for a chunk (made once and kept; made again when it moves between near and far). `keeps`: whether
   * a mark of that rank is wanted (far chunks keep only what would still show at their distance): asked before work */
  city(c: Chunk, city: City, put: (m: Mark) => void, keeps: (rank: number) => boolean, light: Light): void;
  /** the lit body under the figure's marks: the light's colour where the sun reaches and the shade's where it doesn't (none: no
   * body is rendered, marks keep their own colour) */
  bodyLight?(light: Light): { sunlit: V; shade: V };
  /** the sky: a continuous field from `top` to `horizon` behind everything (none: the paper is the sky) */
  skyField?: { top: V; horizon: V };
  /** the sky's marks over the field, as directions from the eye (each end a unit direction): laid far off */
  sky?(light: Light): Mark[];
  /** the runner's marks, from its parts (each frame) */
  figure(parts: Part[], palette: V[], put: (m: Mark) => void, light: Light): void;
  /** the runner's shadow: its marks on what receives it (none: the shadow passages, from the sun's map, carry it) */
  shadow?(parts: Part[], rs: Receiver[], put: (m: Mark) => void, light: Light): void;
}

// ─── drawing

const VS = `#version 300 es
precision highp float;
in vec2 aQ; in vec4 a0; in vec4 a1; in vec4 a2; in vec4 a3; in vec4 a4; in vec4 a5; in vec4 a6; in vec4 a7; in vec4 a8; in vec4 a9; in vec4 a10;
uniform mat4 uVP; uniform vec3 uEye; uniform float uFar; uniform float uFogNear; uniform float uDetail; uniform vec3 uSunC; uniform float uPx;
uniform highp sampler2DShadow uShadowMap; uniform mat4 uSunVP; uniform int uShadowOn;
out vec2 vQ; out vec3 vW; out float vFog;
flat out vec4 vCol; flat out vec4 vP; flat out vec4 vS; flat out vec3 vMin; flat out vec3 vMax; flat out vec2 vT; flat out vec4 vCol2; flat out vec3 vN; flat out float vReach; flat out float vBody; flat out vec4 vSurf; flat out vec3 vU; flat out vec3 vV2; flat out vec3 vPick; flat out vec2 vWr;
float lit(vec3 p) {
  if (uShadowOn == 0) return 1.0;
  vec4 q = uSunVP * vec4(p, 1.0); vec3 c = q.xyz / q.w * 0.5 + 0.5;
  if (any(lessThan(c.xy, vec2(0.0))) || any(greaterThan(c.xy, vec2(1.0)))) return 1.0;
  return texture(uShadowMap, vec3(c.xy, c.z - 0.002));
}
void main() {
  vec3 c = a0.xyz, U = a1.xyz, V = a2.xyz; int kind = int(a1.w + 0.5); bool edge = kind >= 8; if (edge) kind -= 8;
  vec3 toE = uEye - c; float dist = length(toE); vec3 e = toE / max(dist, 1e-4);
  // (an edge: turned about its own line to the eye, and brought forward of what it lies along by its own half-width)
  if (edge) { vec3 d = normalize(U); vec3 s = cross(d, e); if (length(s) < 1e-3) s = cross(d, vec3(0.0, 1.0, 0.0)); V = normalize(s) * length(V); c += e * length(V); }
  // (never thinner than a couple of pixels (Switchback's floor): a lip, a pipe, a wire, a pole far off is still a mark, not
  // a gap; \`uPx\` the world's size of a pixel a metre off)
  if (kind != 6 && kind != 3) { float w = length(V), wmin = uPx * dist * 1.1; if (w > 1e-6 && w < wmin) V *= wmin / w; }
  vec3 N = cross(U, V); N = length(N) > 1e-9 ? normalize(N) : e; if (dot(N, toE) < 0.0) N = -N;
  float alpha = a0.w;
  // (a splat on a surface: seen edge-on it narrows and fades, no sliver, no gap)
  vSurf = vec4(a9.xyz, a9.w); vU = normalize(U); vV2 = normalize(V); vWr = a10.zw;
  if (dot(a9.xyz, a9.xyz) > 0.01) { float facing = abs(dot(normalize(a9.xyz), e)); V *= mix(0.4, 1.0, smoothstep(0.05, 0.45, facing)); alpha *= smoothstep(0.03, 0.22, facing); }
  // (whole marks withdraw with distance, by rank, all of a mark's stamps on its one anchor)
  float rank = a3.w, f0 = (14.0 + (uFar * 1.15 - 14.0) * rank * rank) * uDetail; bool sky = a7.w > 0.5; vBody = max(0.0, -a7.w);
  // (withdrawing, a mark shrinks to its anchor rather than fading (Switchback's rule): no ghost of half-alpha marks far off,
  // and what's left is whole paint; a stamp of a tiled mark shrinks toward the mark's anchor, so the mark goes as one)
  float gone = sky ? 0.0 : smoothstep(f0 * 0.7, f0, length(uEye - a4.xyz));
  if (gone > 0.0) { vec3 an = a4.xyz; c = an + (c - an) * (1.0 - gone); U *= 1.0 - gone; V *= 1.0 - gone; if (gone > 0.999) alpha = 0.0; }
  // (a shadow passage: the receiver's real shadow, from the sun's map, is its mask (in the fragment); as far as the map reaches)
  vN = N; vReach = 1.0;
  vCol2 = a8;
  vCol = vec4(a3.xyz, alpha); vP = vec4(float(kind), a2.w, a4.w, a7.x); vS = vec4(a5.w, a6.w, a7.y, a7.z);
  vMin = edge ? vec3(-1e5) : a5.xyz; vMax = edge ? vec3(1e5) : a6.xyz; vQ = aQ;
  float s0 = a5.w, s1 = a6.w;
  vT = vec2(length(U) * 2.0 / max(s1 - s0, 1e-4), length(V) * 2.0 / 1.15);
  vec3 p = c + U * aQ.x + V * aQ.y; vW = p;
  if (kind == 3) vReach = 1.0 - smoothstep(36.0, 46.0, length((p - uSunC).xz));
  vFog = sky ? 0.0 : smoothstep(uFar * uFogNear, uFar, length(uEye - p));
  if (alpha < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // (brought toward the eye along its own view ray (Switchback's lift), by what the old normal bias gave in depth: the same
  // clearance over its receiver, but no slide across the screen as the eye moves)
  vec3 ep = uEye - p; float ed = length(ep);
  { vec4 q0 = uVP * vec4(c, 1.0), q1 = uVP * vec4(c + U, 1.0); vec2 sd2 = q1.xy / q1.w - q0.xy / q0.w; vPick = vec3(length(sd2) > 1e-6 ? normalize(sd2) : vec2(1.0, 0.0), a10.x); vSurf.w = a9.w; }
  gl_Position = uVP * vec4(p + ep / max(ed, 1e-4) * min((0.004 + dist * 0.0012) / max(abs(dot(N, ep / max(ed, 1e-4))), 0.25), ed * 0.5), 1.0);
}`;
const NOISE = `
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v / 0.875; }
`;
const FS = `#version 300 es
precision highp float;
in vec2 vQ; in vec3 vW; in float vFog; flat in vec4 vCol; flat in vec4 vP; flat in vec4 vS; flat in vec3 vMin; flat in vec3 vMax; flat in vec2 vT; flat in vec4 vCol2; flat in vec3 vN; flat in float vReach; flat in float vBody; flat in vec4 vSurf; flat in vec3 vU; flat in vec3 vV2; flat in vec3 vPick; flat in vec2 vWr;
uniform vec3 uHaze; uniform float uFade; uniform float uGrain; uniform int uCount; uniform sampler2D uBody; uniform int uBodyOn; uniform float uBreak; uniform vec3 uEyeF; uniform vec3 uPaperF; uniform vec3 uSunD; uniform vec3 uLit; uniform vec3 uShd; uniform sampler2D uUnder; uniform int uUnderOn; uniform vec2 uRes;
uniform highp sampler2DShadow uShadowMap; uniform highp mat4 uSunVP; uniform highp int uShadowOn;
out vec4 o;
${NOISE}
void main() {
  if (uCount == 1) { o = vec4(1.0 / 255.0); return; }
  // (cut to its receiver, give or take a pixel's footprint: the clip is judged at the pixel's centre, the depth by its
  // samples, so an edge pixel cut whole would leave paper in the samples that are the receiver's)
  vec3 px = fwidth(vW) * 1.5 + 0.004;
  if (any(lessThan(vW, vMin - px)) || any(greaterThan(vW, vMax + px))) discard;
  int kind = int(vP.x + 0.5); float sd = vP.y * 97.0, dry = vP.z, heart = vP.w;
  float Lm = max(vT.x, 1e-3), Wm = max(vT.y, 0.02);
  float u = mix(vS.x, vS.y, vQ.x * 0.5 + 0.5), um = u * Lm, t = vQ.y * 1.15, at = abs(t);
  // (its taper in and out, in metres along it; its sides wandering, each its own way)
  float tin = clamp(vS.z / Lm, 0.002, 0.5), tout = clamp(vS.w / Lm, 0.002, 0.6);
  float prof = sqrt(smoothstep(0.0, tin, u)) * sqrt(smoothstep(1.0, 1.0 - tout, u));
  // (a figure's brush lands blunt (a rounded end, the brush's own width) and keeps its width to the end, where it breaks into the
  // bristles' streaks instead of coming to a point)
  float ci = clamp(0.5 * max(vT.y, 0.02) / max(vT.x, 1e-3), 0.004, 0.45);
  if (vBody > 0.0) prof = sqrt(max(0.0, 1.0 - pow(1.0 - clamp(u / ci, 0.0, 1.0), 2.0))) * (0.82 + 0.18 * smoothstep(1.0, 1.0 - tout, u));
  float k = um / Wm;
  float side = 1.0 - 0.17 * noise(vec2(k * 0.9, sd + (t > 0.0 ? 3.1 : 7.7))) - 0.08 * noise(vec2(k * 4.0, sd + (t > 0.0 ? 1.3 : 5.9)));
  // (a figure's marks a loaded brush's: sides torn by the bristles, the edge breaking where the paint thins)
  if (vBody > 0.0) side = min(1.1, (side + 0.12) * (1.0 + 0.32 * (noise(vec2(k * 3.0, sd + (t > 0.0 ? 11.0 : 17.0))) - 0.5) + 0.2 * (noise(vec2(k * 12.0, sd + (t > 0.0 ? 4.0 : 8.0))) - 0.5)));
  float hw = prof * side * mix(vWr.x, vWr.y, vQ.x * 0.5 + 0.5);
  // (bristles: streaks along it, a dozen and more across it, whatever its width)
  float br = 0.6 * noise(vec2((t * 0.5 + 0.5) * 13.0 + sd, k * 0.3)) + 0.4 * noise(vec2((t * 0.5 + 0.5) * 34.0 + sd * 1.7, k * 0.7));
  // (the paper's tooth in the mark: on the mark itself, in its own metres, so it travels with it (no crawl as the eye moves);
  // calmed toward its mean where it would be finer than a pixel)
  vec2 mq = vec2(um, t * Wm * 0.5) + sd;
  float gq = clamp(0.6 / max(fwidth(um) * 40.0, 1e-4), 0.0, 1.0);
  float grain = 0.5 + gq * (0.5 * noise(mq * 40.0) + 0.5 * noise(mq * 110.0 + 9.0) - 0.5);
  // (the dry lift: toward its exit, and a little along its sides; the paper's tooth shows through it)
  float dz = dry * (0.9 * smoothstep(0.4, 1.0, u) + 0.3 * smoothstep(0.55, 1.0, at / max(hw, 1e-3)));
  float gap = dz > 0.0 ? smoothstep(dz - 0.09, dz + 0.09, br + 0.18 * (grain - 0.5) + 0.1) : 1.0;
  vec3 col = vCol.rgb; float a;
  // (the second pigment: in irregular groups of bristles, heavier toward one side of the brush)
  if (vCol2.a > 0.0) { float g = noise(vec2((t * 0.5 + 0.5) * 3.2 + sd * 1.3, k * 0.06)) + 0.3 * t; col = mix(col, vCol2.rgb, vCol2.a * smoothstep(0.42, 0.72, g + 0.25 * (br - 0.5))); }
  if (kind == 6) {
    // (underpainting: all of its receiver, a little uneven, no edge of its own: the clip is its edge)
    // (laid as an oil sketch's ground is: broken toward its edges, and here and there inside, so the toned board shows through;
    // the breaks on the mark itself, so they travel with it)
    vec3 ext = vMax - vMin, dd = min(vW - vMin, vMax - vW); float e = 1e5;
    if (ext.x > 0.05) e = min(e, dd.x); if (ext.y > 0.05) e = min(e, dd.y); if (ext.z > 0.05) e = min(e, dd.z);
    float hole = fbm(vec2(um * 0.35, t * 1.2) + sd) + 0.3 * smoothstep(0.0, 1.2, e);
    // (broken only on a toned ground (uBreak); on pale paper, whole, or the paper reads as white specks)
    a = uBreak > 0.5 ? smoothstep(0.46, 0.56, hole) : 1.0; col *= 0.96 + 0.08 * noise(vec2(um * 0.12, t * 0.6 + sd));
  } else if (kind == 3) {
    // (a shadow passage: its receiver's shadow, from the sun's map, read through the brush so its edge breaks a little)
    float sh = 0.0;
    if (uShadowOn == 1) {
      vec4 q = uSunVP * vec4(vW + vN * 0.07, 1.0); vec3 c = q.xyz / q.w * 0.5 + 0.5; vec2 j = (vec2(noise(vec2(um * 1.9, t * 2.0 + sd)), noise(vec2(um * 1.3 + 7.0, t * 2.6))) - 0.5) * (6.0 / 2048.0);
      if (all(greaterThan(c.xy, vec2(0.0))) && all(lessThan(c.xy, vec2(1.0)))) { float l = 0.0; for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) l += texture(uShadowMap, vec3(c.xy + j + vec2(x, y) / 2048.0, c.z - 0.0015)); sh = 1.0 - l / 9.0; }
    }
    a = smoothstep(0.38, 0.62, sh + 0.35 * (br - 0.5)) * vReach;
    col *= 0.96 + 0.08 * noise(vec2(k * 0.4, t * 1.2 + sd));
  } else if (kind == 0) {
    a = (1.0 - smoothstep(hw - 0.06, hw, at)) * gap;
    if (vBody > 0.0) {
      a *= smoothstep(0.0, 0.2, br + 0.75 - at / max(hw, 1e-3) * 0.75);
      // (the end breaks into bristle streaks; the paint's ridges catch the light, its grooves hold the shade (impasto))
      a *= smoothstep(0.0, 0.18, (1.0 - u) / max(tout, 0.03) + (br - 0.5) * 1.1 - 0.15);
      col *= 0.86 + 0.3 * br; col += vec3(0.07, 0.065, 0.06) * smoothstep(0.62, 0.85, br);
    }
    // (the bristles show in the paint: ridges a little lighter, grooves a little darker)
    col *= 0.93 + 0.1 * noise(vec2(k * 0.5, t * 1.5 + sd)) + 0.22 * (br - 0.5);
    col *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, 0.35, abs(u - heart)));
  } else if (kind == 1) {
    float r = at / max(hw, 1e-3);
    a = (1.0 - smoothstep(0.45, 1.0, r)) * (0.7 + 0.4 * fbm(vec2(k * 1.2, t * 1.5) + sd)) + 0.45 * smoothstep(0.62, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
  } else if (kind == 2) {
    float press = 0.7 + 0.3 * exp(-pow((u - heart) * 3.5, 2.0));
    a = (1.0 - smoothstep(hw * press - 0.05, hw * press, at)) * gap;
    col *= 1.0 - 0.35 * exp(-pow((u - heart) * 3.0, 2.0));
  } else if (kind == 4) {
    float reach = 0.3 + 0.7 * noise(vec2(k * 0.25, sd)), from = (1.15 - t) / 2.3;
    a = smoothstep(0.0, 0.25, prof) * (1.0 - smoothstep(reach - 0.35, reach, from)) * (0.75 + 0.4 * fbm(vec2(um * 0.8, t * 2.0) + sd));
  } else {
    float r = length(vec2(vQ.x, t)) / side;
    a = 1.0 - smoothstep(0.8, 1.0, r);
  }
  // (a figure's mark takes its colour, as much as it asks, from the lit body under it (rendered just before, smooth, lit per point):
  // the light turns across the form; the mark keeps its own shape, edge and brush. Its own variation kept as a nudge about it)
  if (uBodyOn == 1 && vBody > 0.0) { vec4 bd = texelFetch(uBody, ivec2(gl_FragCoord.xy), 0); if (bd.a > 0.5) col = mix(col, bd.rgb * (0.88 + 0.24 * clamp(dot(col, vec3(0.3, 0.59, 0.11)) / max(dot(vCol.rgb, vec3(0.3, 0.59, 0.11)), 0.02), 0.0, 1.0)), vBody); }
  a *= vCol.a * (1.0 - vFog * uFade);
  col = mix(col, uHaze, vFog * (1.0 - uFade));
  col *= 1.0 - uGrain * 0.08 * (grain - 0.5);
  // (load: the paint thins as it's laid out along the stroke, thick where it lands; where it's thin the bristles break it)
  float ld = vSurf.w, thick = ld > 0.0 ? ld * (1.15 - 0.85 * u) : 0.0;
  if (ld > 0.0) { a *= smoothstep(0.0, 0.12, thick * 1.6 - (1.0 - br) * 0.7 + 0.15); col *= 0.94 + 0.12 * min(thick, 1.0); }
  // (lit as a splat on its surface: the sun on the surface's normal, bumped by the bristles' relief (the paint's thickness), a
  // gloss on the ridges where they turn to the light)
  if (dot(vSurf.xyz, vSurf.xyz) > 0.01) {
    float e1 = 0.06, b1 = 0.6 * noise(vec2(((t + e1) * 0.5 + 0.5) * 13.0 + sd, k * 0.3)) + 0.4 * noise(vec2(((t + e1) * 0.5 + 0.5) * 34.0 + sd * 1.7, k * 0.7));
    float rel = (0.25 + max(thick, 0.0)) * 0.9, dh = (b1 - br) / e1;
    vec3 n0 = normalize(vSurf.xyz), n = normalize(n0 - vV2 * dh * rel * 0.12), L = normalize(uSunD), Vw = normalize(uEyeF - vW);
    float lam = smoothstep(-0.25, 0.75, dot(n, L)), gloss = pow(max(dot(reflect(-L, n), Vw), 0.0), 18.0) * (0.15 + 0.5 * min(thick, 1.0));
    col = col * mix(uShd * 0.78, uLit * 1.05, lam) + vec3(gloss) * 0.6;
  }
  // (wet into wet: the paint under it picked up and dragged along the stroke, most where it lands)
  if (uUnderOn == 1 && vPick.z > 0.0) {
    vec2 back = -vPick.xy * vec2(0.5 * uRes.x, 0.5 * uRes.y) / max(uRes.x, uRes.y) * 60.0 * (0.4 + br);
    // (only paint is picked up, never the paper: where what's behind is paper, what's here; where neither, nothing)
    vec4 un = texture(uUnder, (gl_FragCoord.xy + back) / uRes), here = texture(uUnder, gl_FragCoord.xy / uRes);
    float pb = step(0.06, distance(un.rgb, uPaperF)), ph = step(0.06, distance(here.rgb, uPaperF));
    vec3 src = pb > 0.5 ? un.rgb : here.rgb; float wet = vPick.z * (1.0 - smoothstep(0.0, 0.85, u)) * max(pb, ph);
    col = mix(col, src, wet * (0.35 + 0.4 * br));
  }
  if (a < 0.003) discard;
  o = vec4(col, min(a, 1.0));
}`;
// (the lit body: the figure as smooth tubes, lit per point, under its marks (they take their colour from it))
const BVS = `#version 300 es
in vec3 aPos; in vec3 aNor; in float aMat; uniform mat4 uVP; out vec3 vW; out vec3 vNw; flat out int vM;
void main() { vW = aPos; vNw = aNor; vM = int(aMat + 0.5); gl_Position = uVP * vec4(aPos, 1.0); }`;
const BFS = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vNw; flat in int vM; uniform vec3 uPal[64]; uniform vec3 uSun; uniform vec3 uEye; uniform vec3 uSunlit; uniform vec3 uShade;
uniform highp sampler2DShadow uShadowMap; uniform mat4 uSunVP; uniform int uShadowOn; out vec4 o;
float lit(vec3 p) {
  if (uShadowOn == 0) return 1.0;
  vec4 q = uSunVP * vec4(p, 1.0); vec3 c = q.xyz / q.w * 0.5 + 0.5;
  if (any(lessThan(c.xy, vec2(0.0))) || any(greaterThan(c.xy, vec2(1.0)))) return 1.0;
  float s = 0.0; for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) s += texture(uShadowMap, vec3(c.xy + vec2(x, y) / 2048.0, c.z - 0.002)); return s / 9.0;
}
void main() {
  vec3 n = normalize(vNw), V = normalize(uEye - vW); if (dot(n, V) < 0.0) n = -n;
  vec3 base = uPal[vM]; float lum = dot(base, vec3(0.3, 0.59, 0.11)), lift = max(0.0, 0.32 - lum) * 1.1;
  float ndl = dot(n, normalize(uSun)), sun = smoothstep(-0.2, 0.55, ndl) * lit(vW + n * 0.03);
  vec3 dark = base * uShade, light = base * uSunlit + uSunlit * lift;
  // (the turn from light to shade, warm to cool; a little warmth bounced up from the roof into the undersides; a cool rim)
  vec3 c = mix(dark, light, 0.12 + 0.88 * sun);
  c += base * vec3(0.10, 0.07, 0.04) * max(0.0, -n.y) * (1.0 - sun);
  c = mix(c, c * vec3(0.92, 0.95, 1.08) + 0.02, pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.6);
  o = vec4(c, 1.0);
}`;
// (the paper: its colour and its tooth, everywhere, before anything)
const PVS = `#version 300 es
in vec2 aQ; void main() { gl_Position = vec4(aQ, 0.0, 1.0); }`;
const PFS = `#version 300 es
precision highp float; uniform vec3 uPaper; uniform float uGrain; out vec4 o;
${NOISE}
void main() { float g = 0.5 * noise(gl_FragCoord.xy * 0.45) + 0.5 * noise(gl_FragCoord.xy * 1.3 + 9.0), f = fbm(gl_FragCoord.xy * 0.012);
  o = vec4(uPaper * (1.0 - uGrain * (0.05 * (g - 0.5) + 0.03 * (f - 0.5))), 1.0); }`;

// (the sky as one field: from straight up to the horizon, deep above and warm only in a narrow band low down, a slow
// unevenness in it fixed to the sky; only where nothing solid is in front)
const KVS = `#version 300 es
in vec2 aQ; out vec2 vNdc; void main() { vNdc = aQ; gl_Position = vec4(aQ, 0.99999, 1.0); }`;
const KFS = `#version 300 es
precision highp float; in vec2 vNdc; uniform mat4 uInv; uniform vec3 uTop; uniform vec3 uHor; uniform float uGrain; out vec4 o;
${NOISE}
void main() {
  vec4 a = uInv * vec4(vNdc, -1.0, 1.0), b = uInv * vec4(vNdc, 1.0, 1.0); vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  vec2 p = d.xz / (max(d.y, 0.0) + 0.25);
  float up = clamp(d.y + 0.02 * (fbm(p * 0.7) - 0.5), 0.0, 1.0), band = smoothstep(0.0, 0.09, up);
  vec3 c = mix(uHor, mix(mix(uHor, uTop, 0.8), uTop, smoothstep(0.09, 0.45, up)), band);
  c *= 0.97 + 0.06 * fbm(p * vec2(0.35, 1.1) + 3.0);
  float g = 0.5 * noise(gl_FragCoord.xy * 0.45) + 0.5 * noise(gl_FragCoord.xy * 1.3 + 9.0);
  o = vec4(c * (1.0 - uGrain * 0.06 * (g - 0.5)), 1.0);
}`;

interface Layered { buf: WebGLBuffer; vaos: WebGLVertexArrayObject[]; counts: number[]; far?: boolean; key?: string }
/** how far (m) a mark of a rank shows before it has withdrawn (as the vertex shader has it, at detail 1) */
export const showsTo = (rank: number, far: number) => 14 + (far * 1.15 - 14) * rank * rank;
/** what each pass cost, the last frame it was asked (ms, with the GPU waited on between: coarse, but the same on a phone) */
export interface Cost { depth: number; city: number; shadow: number; figure: number; stamps: number; chunks: number }

/** The painter for a brushwork look: the stamps of each chunk, kept; the runner's each frame; the passes. */
export class StrokePainter {
  private prog: WebGLProgram; private pprog: WebGLProgram; private kprog: WebGLProgram; private corner: WebGLBuffer;
  private skyFor = ''; private skyMarks: Mark[] = [];
  private u: Record<string, WebGLUniformLocation | null> = {};
  private chunks = new Map<string, Layered>(); private rulesFor: StrokeRules | null = null;
  private dyn: Layered; private dynCap = 2048; private dynData = new Float32Array(2048 * STAMP);
  /** set to measure each pass (`?cost`): filled each frame */
  cost: Cost | null = null;
  stamps = 0;
  /** the underpainting left out (`?under=0`, U): only the strokes, to see what they cover */
  noUnder = false;
  private utex: WebGLTexture | null = null; private usize = [0, 0];
  /** another ground than the look's, and its underpainting broken to show it (the brush board's ochre: for judging whites) */
  paperOverride: V | null = null;
  /** the lit body: its program, its mesh's buffer and VAO, where it's rendered (a colour texture and depth, the drawing buffer's
   * size), and whether it was rendered this frame */
  private bprog!: WebGLProgram; private bbuf!: WebGLBuffer; private bvao!: WebGLVertexArrayObject; private bfbo: WebGLFramebuffer | null = null; private btex: WebGLTexture | null = null; private brb: WebGLRenderbuffer | null = null; private bsize = [0, 0]; private bodyOn = false; private bibuf!: WebGLBuffer; private bicount = 0;

  constructor(private gl: WebGL2RenderingContext, program: (vs: string, fs: string, attribs: string[]) => WebGLProgram) {
    this.prog = program(VS, FS, ['aQ', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10']);
    for (const n of ['uVP', 'uEye', 'uFar', 'uFogNear', 'uDetail', 'uSunC', 'uPx', 'uShadowMap', 'uSunVP', 'uShadowOn', 'uHaze', 'uFade', 'uGrain', 'uCount', 'uBody', 'uBodyOn', 'uBreak', 'uSunD', 'uLit', 'uShd', 'uUnder', 'uUnderOn', 'uRes', 'uEyeF', 'uPaperF']) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.pprog = program(PVS, PFS, ['aQ']); for (const n of ['uPaper', 'uGrain']) this.u['p' + n] = gl.getUniformLocation(this.pprog, n);
    this.kprog = program(KVS, KFS, ['aQ']); for (const n of ['uInv', 'uTop', 'uHor', 'uGrain']) this.u['k' + n] = gl.getUniformLocation(this.kprog, n);
    this.corner = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.corner); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.dyn = this.layered(this.dynData, gl.DYNAMIC_DRAW, [0, 0, 0, 0]);
    this.bprog = program(BVS, BFS, ['aPos', 'aNor', 'aMat']);
    for (const n of ['uVP', 'uPal', 'uSun', 'uEye', 'uSunlit', 'uShade', 'uShadowMap', 'uSunVP', 'uShadowOn']) this.u['b' + n] = gl.getUniformLocation(this.bprog, n);
    this.bbuf = gl.createBuffer()!; this.bvao = gl.createVertexArray()!; this.bibuf = gl.createBuffer()!;
    gl.bindVertexArray(this.bvao); gl.bindBuffer(gl.ARRAY_BUFFER, this.bbuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bibuf);
    gl.bindVertexArray(null);
  }

  /** the lit body: the figure as smooth tubes (bodyMesh) into its own colour and depth, the size of the drawing buffer and in the
   * same viewport, so a mark can read the body under its own pixel */
  private renderBody(o: { vp: M4; eye: number[]; bones: Bone[]; palette: V[]; sunVP: M4 | null; light: Light; rules: StrokeRules }): void {
    const gl = this.gl, R = o.rules; this.bodyOn = false;
    if (!R.bodyLight || !o.bones.length || this.counting) return;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    if (!this.bfbo || this.bsize[0] !== W || this.bsize[1] !== H) {
      if (this.bfbo) { gl.deleteFramebuffer(this.bfbo); gl.deleteTexture(this.btex); gl.deleteRenderbuffer(this.brb); }
      this.btex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.btex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.brb = gl.createRenderbuffer()!; gl.bindRenderbuffer(gl.RENDERBUFFER, this.brb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
      this.bfbo = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, this.bfbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.btex, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.brb);
      this.bsize = [W, H];
    }
    const mesh = bodyMesh(o.bones), L = R.bodyLight(o.light);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bfbo);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true); gl.colorMask(true, true, true, true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.bprog); gl.uniformMatrix4fv(this.u.buVP, false, o.vp);
    const pal = new Float32Array(64 * 3); o.palette.slice(0, 64).forEach((c, i) => pal.set(c, i * 3)); gl.uniform3fv(this.u.buPal, pal);
    gl.uniform3fv(this.u.buSun, o.light.sun); gl.uniform3f(this.u.buEye, o.eye[0], o.eye[1], o.eye[2]); gl.uniform3fv(this.u.buSunlit, L.sunlit); gl.uniform3fv(this.u.buShade, L.shade);
    gl.uniform1i(this.u.buShadowMap, 3); gl.uniform1i(this.u.buShadowOn, o.sunVP ? 1 : 0); if (o.sunVP) gl.uniformMatrix4fv(this.u.buSunVP, false, o.sunVP);
    gl.bindVertexArray(this.bvao); gl.bindBuffer(gl.ARRAY_BUFFER, this.bbuf); gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.DYNAMIC_DRAW);
    if (this.bicount < o.bones.length) { this.bicount = Math.max(o.bones.length, 96); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bodyIndex(this.bicount), gl.STATIC_DRAW); }
    gl.drawElements(gl.TRIANGLES, o.bones.length * (BRINGS - 1) * BN * 6, gl.UNSIGNED_INT, 0); gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.bodyOn = true;
  }

  /** a buffer of stamps sorted by layer, and a VAO onto each layer of it */
  private layered(data: Float32Array, usage: number, counts: number[]): Layered {
    const gl = this.gl, buf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const vaos: WebGLVertexArrayObject[] = []; let at = 0;
    for (let l = 0; l < counts.length; l++) { vaos.push(this.vaoAt(buf, at)); at += counts[l]; }
    return { buf, vaos, counts };
  }
  private vaoAt(buf: WebGLBuffer, first: number): WebGLVertexArrayObject {
    const gl = this.gl, vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corner); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (let i = 0; i < 11; i++) { gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, STAMP * 4, (first * STAMP + i * 4) * 4); gl.vertexAttribDivisor(1 + i, 1); }
    gl.bindVertexArray(null);
    return vao;
  }
  private free(l: Layered): void { const gl = this.gl; for (const v of l.vaos) gl.deleteVertexArray(v); gl.deleteBuffer(l.buf); }

  /** marks into stamps, sorted by layer (and, within a layer, in the order said: the paint order on a surface) */
  private stampsOf(marks: Mark[]): { data: Float32Array; counts: number[] } {
    const by: number[][] = Array.from({ length: LAYERS }, () => []);
    for (const m of marks) deposit(m, by[Math.max(0, Math.min(LAYERS - 1, m.layer))]);
    const counts = by.map((b) => b.length / STAMP), data = new Float32Array(by.reduce((n, b) => n + b.length, 0));
    let at = 0; for (const b of by) { data.set(b, at); at += b.length; }
    return { data, counts };
  }

  /**
   * The chunks drawn, round the eye's chunk (ex, ez): make the stamps of any not yet made, nearest first (at most
   * `budget`), drop those no longer drawn. A chunk next to the eye's has all its marks; one further off only those that
   * would still show from there (by rank), and is made again, whole, when the eye comes near.
   */
  sync(keys: string[], city: City, rules: StrokeRules, budget: number, ex: number, ez: number, far: number, light: Light): number {
    if (this.rulesFor !== rules) { for (const l of this.chunks.values()) this.free(l); this.chunks.clear(); this.rulesFor = rules; }
    const want = new Set(keys); let made = 0;
    for (const [k, l] of this.chunks) if (!want.has(k)) { this.free(l); this.chunks.delete(k); }
    const ring = (k: string) => { const [cx, cz] = k.split(',').map(Number); return Math.max(Math.abs(cx - ex), Math.abs(cz - ez)); };
    for (const k of [...keys].sort((a, b) => ring(a) - ring(b))) {
      const isFar = ring(k) >= 2, have = this.chunks.get(k);
      // (made already, for this light: kept; for another light, kept and drawn until it's made again)
      if (have && have.key === light.key && (have.far === isFar || (!have.far && isFar && ring(k) === 2))) continue;
      if (made++ >= budget) break;
      const [cx, cz] = k.split(',').map(Number), marks: Mark[] = [], from = (ring(k) - 1) * 64;
      const keeps = (rank: number) => !isFar || showsTo(rank, far) > from;
      rules.city(city.chunk(cx, cz), city, (m) => { if (keeps(m.rank ?? 0.5) && !(this.noUnder && m.kind === K.FILL && m.layer === LAYER.BROAD)) marks.push(m); }, keeps, light);
      const { data, counts } = this.stampsOf(marks);
      if (have) this.free(have);
      this.chunks.set(k, { ...this.layered(data, this.gl.STATIC_DRAW, counts), far: isFar, key: light.key });
    }
    return this.missing(keys);
  }
  /** forget every chunk's stamps (another city) */
  reset(): void { for (const l of this.chunks.values()) this.free(l); this.chunks.clear(); }
  /** how many of these chunks still have no paint (or paint in another light) */
  missing(keys: string[], light?: Light): number { return keys.filter((k) => !this.chunks.has(k) || (light && this.chunks.get(k)!.key !== light.key)).length; }

  /**
   * The frame: paper; `solid` (the renderer draws the city and the body into depth); then the paint. `sunVP`: the sun's
   * map, bound, for the shadow passages, centred at `sunC`.
   */
  draw(o: { vp: M4; inv: Float32Array; eye: number[]; far: number; rules: StrokeRules; light: Light; city: City; bones: Bone[]; palette: V[]; sunVP: M4 | null; sunC: V; detail: number; solid: () => void; bare: boolean; extra?: Mark[]; noFigure?: boolean }): void {
    const gl = this.gl, R = o.rules, timing = !!this.cost, t0 = timing ? (gl.finish(), performance.now()) : 0;
    this.renderBody(o);
    let tick = t0; const lap = (k: keyof Cost) => { count(k); if (!timing) return; gl.finish(); const n = performance.now(); (this.cost as Cost)[k] = n - tick; tick = n; };
    // (counting: each pass's paint fragments per pixel, read back after it)
    const vpx = gl.getParameter(gl.VIEWPORT) as Int32Array, px = new Uint8Array(vpx[2] * vpx[3] * 4); let before = 0;
    const count = (k: string) => {
      if (!this.counting) return; gl.readPixels(vpx[0], vpx[1], vpx[2], vpx[3], gl.RGBA, gl.UNSIGNED_BYTE, px);
      let sum = 0, max = 0; for (let i = 0; i < px.length; i += 4) { sum += px[i]; if (px[i] > max) max = px[i]; }
      this.overdraw[k] = { mean: (sum - before) / (vpx[2] * vpx[3]), max }; before = sum;
    };
    if (this.counting) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); this.overdraw = {}; }
    // (paper)
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.pprog); gl.uniform3fv(this.u.puPaper, this.paperOverride ?? R.paper); gl.uniform1f(this.u.puGrain, R.grain);
    if (!this.counting) { gl.bindVertexArray(this.dyn.vaos[0]); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    // (the solid world, in depth only)
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.colorMask(false, false, false, false);
    o.solid();
    gl.colorMask(true, true, true, true);
    lap('depth');
    // (the sky, one field, where nothing solid is)
    if (R.skyField && !o.bare && !this.counting) {
      gl.depthMask(false); gl.depthFunc(gl.LEQUAL); gl.useProgram(this.kprog); gl.uniformMatrix4fv(this.u.kuInv, false, o.inv);
      gl.uniform3fv(this.u.kuTop, o.light.top); gl.uniform3fv(this.u.kuHor, o.light.horizon); gl.uniform1f(this.u.kuGrain, R.grain);
      gl.bindVertexArray(this.dyn.vaos[0]); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    // (the paint)
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uVP, false, o.vp); gl.uniform3f(this.u.uEye, o.eye[0], o.eye[1], o.eye[2]); gl.uniform1f(this.u.uFar, o.far);
    gl.uniform1f(this.u.uFogNear, o.light.hazeNear); gl.uniform1f(this.u.uDetail, o.detail); gl.uniform3fv(this.u.uSunC, o.sunC);
    { // (a pixel's size a metre off: two points a pixel apart at the screen's middle, unprojected)
      const un = (y: number): V => { const m = o.inv, x = 0, z = 0.5; const w = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]; };
      const p0 = un(0), p1 = un(2 / Math.max(1, gl.drawingBufferHeight)), d0 = Math.hypot(p0[0] - o.eye[0], p0[1] - o.eye[1], p0[2] - o.eye[2]);
      gl.uniform1f(this.u.uPx, Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) / Math.max(d0, 1e-6));
    }
    gl.uniform1i(this.u.uShadowMap, 3); gl.uniform1i(this.u.uShadowOn, o.sunVP ? 1 : 0); if (o.sunVP) gl.uniformMatrix4fv(this.u.uSunVP, false, o.sunVP);
    gl.uniform3fv(this.u.uHaze, o.light.haze); gl.uniform1f(this.u.uFade, R.fadeToPaper); gl.uniform1f(this.u.uGrain, R.grain); gl.uniform1i(this.u.uCount, this.counting ? 1 : 0); gl.uniform1f(this.u.uBreak, this.paperOverride ? 1 : 0);
    { const BL = R.bodyLight ? R.bodyLight(o.light) : { sunlit: [1, 1, 1] as V, shade: [0.6, 0.6, 0.7] as V }; gl.uniform3fv(this.u.uSunD, o.light.sun); gl.uniform3fv(this.u.uLit, BL.sunlit); gl.uniform3fv(this.u.uShd, BL.shade); gl.uniform1i(this.u.uUnderOn, 0); gl.uniform2f(this.u.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.uniform3f(this.u.uEyeF, o.eye[0], o.eye[1], o.eye[2]); gl.uniform3fv(this.u.uPaperF, this.paperOverride ?? R.paper); }
    gl.depthMask(false); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND);
    // (toward the eye by the slope too: a face seen edge-on still passes against its own depth, no paper at a box's edge)
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
    if (this.counting) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    // (the moving marks: the sky about the eye, the runner's shadow, the runner)
    const dyn: Mark[][] = [[], [], [], []];
    if (R.sky && this.skyFor !== o.light.key) { this.skyMarks = R.sky(o.light); this.skyFor = o.light.key; }
    if (R.sky && !o.bare) for (const m of this.skyMarks) dyn[0].push({ ...m, a: add(o.eye as V, scale(m.a, o.far * 1.3)), b: add(o.eye as V, scale(m.b, o.far * 1.3)), width: m.width * o.far * 1.3 });
    const parts = o.bones.length && !o.noFigure ? partsOf(o.bones, o.eye, unit(o.light.sun), o.city) : [];
    if (parts.length && !o.bare && R.shadow) { const pel = parts.find((p) => p.kind === 'pelvis') ?? parts[0], c = scale(add(pel.a, pel.b), 0.5); R.shadow(parts, receivers(o.city, c[0], c[1], c[2], o.light.sun), (m) => dyn[1].push(m), o.light); }
    if (parts.length && !o.noFigure) R.figure(parts, o.palette, (m) => dyn[2].push(m), o.light);
    if (o.extra) for (const m of o.extra) dyn[m.pick ? 3 : 2].push(m);
    { const keep: Mark[] = []; for (const m of dyn[2]) (m.pick ? dyn[3] : keep).push(m); dyn[2] = keep; }
    const flat: number[] = [], dc: number[] = [];
    for (const ms of dyn) { const n0 = flat.length; for (const m of ms) deposit(m, flat); dc.push((flat.length - n0) / STAMP); }
    const nd = Math.min(this.dynCap, flat.length / STAMP); this.dynData.set(flat.slice(0, nd * STAMP));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dyn.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.dynData, 0, nd * STAMP);
    const dynAt = [0, dc[0], dc[0] + dc[1], dc[0] + dc[1] + dc[2]];
    const drawDyn = (i: number) => { const n = Math.min(dc[i], Math.max(0, nd - dynAt[i])); if (!n) return; const v = this.vaoAt(this.dyn.buf, dynAt[i]); gl.bindVertexArray(v); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n); gl.bindVertexArray(null); gl.deleteVertexArray(v); };
    drawDyn(0);
    count('sky');
    let stamps = nd;
    const layer = (l: number) => { if (o.bare) return; for (const c of this.chunks.values()) { const n = c.counts[l]; if (!n) continue; gl.bindVertexArray(c.vaos[l]); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n); stamps += n; } };
    layer(LAYER.BROAD); layer(LAYER.SHADOW);
    lap('city');
    drawDyn(1);
    lap('shadow');
    layer(LAYER.EDGE); layer(LAYER.ACCENT);
    count('edges');
    if (timing) { gl.finish(); const n = performance.now(); (this.cost as Cost).city += n - tick; tick = n; }
    // (the runner last, against the same depth: its far-side marks hidden by its own near side, all of it by whatever of
    // the city stands in front)
    if (this.bodyOn) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.btex); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(this.u.uBody, 4); gl.uniform1i(this.u.uBodyOn, 1); }
    drawDyn(2);
    // (the wet layer: what's painted so far copied, and the strokes that pick paint up laid over it, sampling it)
    if (dc[3] > 0 && !this.counting) {
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      if (!this.utex || this.usize[0] !== W || this.usize[1] !== H) { if (this.utex) gl.deleteTexture(this.utex); this.utex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.utex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); this.usize = [W, H]; }
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.utex); gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.u.uUnder, 5); gl.uniform1i(this.u.uUnderOn, 1); drawDyn(3); gl.uniform1i(this.u.uUnderOn, 0);
    }
    gl.uniform1i(this.u.uBodyOn, 0);
    lap('figure');
    this.stamps = stamps;
    if (this.cost) { this.cost.stamps = stamps; this.cost.chunks = this.chunks.size; }
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthMask(true); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND); gl.bindVertexArray(null);
  }
  /** set: each paint fragment adds one to the colour, and each pass's share is read back into `overdraw` (fragments a
   * pixel, on average, and at most: the paint's cost, as the GPU sees it, apart from the time) */
  counting = false;
  overdraw: Record<string, { mean: number; max: number }> = {};
}
