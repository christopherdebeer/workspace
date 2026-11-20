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
export const STAMP = 36;

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
  /** a second pigment carried in the brush, laid by irregular bristle groups and heavier on one side; how much of it */
  col2?: V; mix2?: number;
}

const NOCLIP: [V, V] = [[-1e5, -1e5, -1e5], [1e5, 1e5, 1e5]];
/** Deposit a mark as its stamps: one, or several tiling it exactly, each knowing its share of the whole. */
export function deposit(m: Mark, out: number[]): void {
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
      anchor[0], anchor[1], anchor[2], m.dry ?? 0, clip[0][0], clip[0][1], clip[0][2], s0, clip[1][0], clip[1][1], clip[1][2], s1, m.heart ?? 0.5, tin, tout, m.sky ? 1 : 0, ...(m.col2 ?? m.col), m.mix2 ?? 0);
  }
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
  ground: number; sunSide: number; sunFront: number; planted: boolean; gripping: boolean }

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
    out.push({ name: bn.name, kind, mat: bn.mat ?? 0, a: add(a, scale(e, depth)), b: add(b, scale(e, depth)), side, toEye: e, width, length: len(sub(b, a)), endOn: Math.abs(dot(dir, e)), girth: Math.max(pw, qw) * 1.15, ground: kind === 'foot' ? city.heightAt(c[0], c[2]) : 0, sunSide: dot(side, sun), sunFront: dot(e, sun), planted, gripping });
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
in vec2 aQ; in vec4 a0; in vec4 a1; in vec4 a2; in vec4 a3; in vec4 a4; in vec4 a5; in vec4 a6; in vec4 a7; in vec4 a8;
uniform mat4 uVP; uniform vec3 uEye; uniform float uFar; uniform float uFogNear; uniform float uDetail; uniform vec3 uSunC;
uniform highp sampler2DShadow uShadowMap; uniform mat4 uSunVP; uniform int uShadowOn;
out vec2 vQ; out vec3 vW; out float vFog;
flat out vec4 vCol; flat out vec4 vP; flat out vec4 vS; flat out vec3 vMin; flat out vec3 vMax; flat out vec2 vT; flat out vec4 vCol2; flat out vec3 vN; flat out float vReach;
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
  vec3 N = cross(U, V); N = length(N) > 1e-9 ? normalize(N) : e; if (dot(N, toE) < 0.0) N = -N;
  float alpha = a0.w;
  // (whole marks withdraw with distance, by rank, all of a mark's stamps on its one anchor)
  float rank = a3.w, f0 = (14.0 + (uFar * 1.15 - 14.0) * rank * rank) * uDetail; bool sky = a7.w > 0.5;
  if (!sky) alpha *= 1.0 - smoothstep(f0 * 0.7, f0, length(uEye - a4.xyz));
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
  gl_Position = uVP * vec4(p + N * (0.004 + dist * 0.0012), 1.0);
}`;
const NOISE = `
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v / 0.875; }
`;
const FS = `#version 300 es
precision highp float;
in vec2 vQ; in vec3 vW; in float vFog; flat in vec4 vCol; flat in vec4 vP; flat in vec4 vS; flat in vec3 vMin; flat in vec3 vMax; flat in vec2 vT; flat in vec4 vCol2; flat in vec3 vN; flat in float vReach;
uniform vec3 uHaze; uniform float uFade; uniform float uGrain; uniform int uCount;
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
  float k = um / Wm;
  float side = 1.0 - 0.17 * noise(vec2(k * 0.9, sd + (t > 0.0 ? 3.1 : 7.7))) - 0.08 * noise(vec2(k * 4.0, sd + (t > 0.0 ? 1.3 : 5.9)));
  float hw = prof * side;
  // (bristles: streaks along it, a dozen and more across it, whatever its width)
  float br = 0.6 * noise(vec2((t * 0.5 + 0.5) * 13.0 + sd, k * 0.3)) + 0.4 * noise(vec2((t * 0.5 + 0.5) * 34.0 + sd * 1.7, k * 0.7));
  float grain = 0.5 * noise(gl_FragCoord.xy * 0.45) + 0.5 * noise(gl_FragCoord.xy * 1.3 + 9.0);
  // (the dry lift: toward its exit, and a little along its sides; the paper's tooth shows through it)
  float dz = dry * (0.9 * smoothstep(0.4, 1.0, u) + 0.3 * smoothstep(0.55, 1.0, at / max(hw, 1e-3)));
  float gap = dz > 0.0 ? smoothstep(dz - 0.09, dz + 0.09, br + 0.18 * (grain - 0.5) + 0.1) : 1.0;
  vec3 col = vCol.rgb; float a;
  // (the second pigment: in irregular groups of bristles, heavier toward one side of the brush)
  if (vCol2.a > 0.0) { float g = noise(vec2((t * 0.5 + 0.5) * 3.2 + sd * 1.3, k * 0.06)) + 0.3 * t; col = mix(col, vCol2.rgb, vCol2.a * smoothstep(0.42, 0.72, g + 0.25 * (br - 0.5))); }
  if (kind == 6) {
    // (underpainting: all of its receiver, a little uneven, no edge of its own: the clip is its edge)
    a = 1.0; col *= 0.975 + 0.05 * noise(vec2(um * 0.12, t * 0.6 + sd));
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
    col *= 0.95 + 0.1 * noise(vec2(k * 0.5, t * 1.5 + sd));
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
  a *= vCol.a * (1.0 - vFog * uFade);
  col = mix(col, uHaze, vFog * (1.0 - uFade));
  col *= 1.0 - uGrain * 0.08 * (grain - 0.5);
  if (a < 0.003) discard;
  o = vec4(col, min(a, 1.0));
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

  constructor(private gl: WebGL2RenderingContext, program: (vs: string, fs: string, attribs: string[]) => WebGLProgram) {
    this.prog = program(VS, FS, ['aQ', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']);
    for (const n of ['uVP', 'uEye', 'uFar', 'uFogNear', 'uDetail', 'uSunC', 'uShadowMap', 'uSunVP', 'uShadowOn', 'uHaze', 'uFade', 'uGrain', 'uCount']) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.pprog = program(PVS, PFS, ['aQ']); for (const n of ['uPaper', 'uGrain']) this.u['p' + n] = gl.getUniformLocation(this.pprog, n);
    this.kprog = program(KVS, KFS, ['aQ']); for (const n of ['uInv', 'uTop', 'uHor', 'uGrain']) this.u['k' + n] = gl.getUniformLocation(this.kprog, n);
    this.corner = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.corner); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.dyn = this.layered(this.dynData, gl.DYNAMIC_DRAW, [0, 0, 0, 0]);
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
    for (let i = 0; i < 9; i++) { gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, STAMP * 4, (first * STAMP + i * 4) * 4); gl.vertexAttribDivisor(1 + i, 1); }
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
      rules.city(city.chunk(cx, cz), city, (m) => { if (keeps(m.rank ?? 0.5)) marks.push(m); }, keeps, light);
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
  draw(o: { vp: M4; inv: Float32Array; eye: number[]; far: number; rules: StrokeRules; light: Light; city: City; bones: Bone[]; palette: V[]; sunVP: M4 | null; sunC: V; detail: number; solid: () => void; bare: boolean }): void {
    const gl = this.gl, R = o.rules, timing = !!this.cost, t0 = timing ? (gl.finish(), performance.now()) : 0;
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
    gl.useProgram(this.pprog); gl.uniform3fv(this.u.puPaper, R.paper); gl.uniform1f(this.u.puGrain, R.grain);
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
    gl.uniform1i(this.u.uShadowMap, 3); gl.uniform1i(this.u.uShadowOn, o.sunVP ? 1 : 0); if (o.sunVP) gl.uniformMatrix4fv(this.u.uSunVP, false, o.sunVP);
    gl.uniform3fv(this.u.uHaze, o.light.haze); gl.uniform1f(this.u.uFade, R.fadeToPaper); gl.uniform1f(this.u.uGrain, R.grain); gl.uniform1i(this.u.uCount, this.counting ? 1 : 0);
    gl.depthMask(false); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND);
    // (toward the eye by the slope too: a face seen edge-on still passes against its own depth, no paper at a box's edge)
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
    if (this.counting) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    // (the moving marks: the sky about the eye, the runner's shadow, the runner)
    const dyn: Mark[][] = [[], [], []];
    if (R.sky && this.skyFor !== o.light.key) { this.skyMarks = R.sky(o.light); this.skyFor = o.light.key; }
    if (R.sky && !o.bare) for (const m of this.skyMarks) dyn[0].push({ ...m, a: add(o.eye as V, scale(m.a, o.far * 1.3)), b: add(o.eye as V, scale(m.b, o.far * 1.3)), width: m.width * o.far * 1.3 });
    const parts = o.bones.length ? partsOf(o.bones, o.eye, unit(o.light.sun), o.city) : [];
    if (parts.length && !o.bare && R.shadow) { const pel = parts.find((p) => p.kind === 'pelvis') ?? parts[0], c = scale(add(pel.a, pel.b), 0.5); R.shadow(parts, receivers(o.city, c[0], c[1], c[2], o.light.sun), (m) => dyn[1].push(m), o.light); }
    if (parts.length) R.figure(parts, o.palette, (m) => dyn[2].push(m), o.light);
    const flat: number[] = [], dc: number[] = [];
    for (const ms of dyn) { const n0 = flat.length; for (const m of ms) deposit(m, flat); dc.push((flat.length - n0) / STAMP); }
    const nd = Math.min(this.dynCap, flat.length / STAMP); this.dynData.set(flat.slice(0, nd * STAMP));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dyn.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.dynData, 0, nd * STAMP);
    const dynAt = [0, dc[0], dc[0] + dc[1]];
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
    drawDyn(2);
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
