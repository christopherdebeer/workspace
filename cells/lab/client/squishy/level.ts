/**
 * Squishy: the course, apart from the drawing and the dumpling (so it can be tested on its own): what's
 * met (boxes, cylinders, capsules, sheets, jellies), what a top is and the kinds of top (steamers, a
 * plate, a chopping board across jars, a mango pudding, a lazy Susan, a tea tin; the butter dish, a honey
 * jar you land against, a pot whose lid lifts on steam, a frying pan with its rim), and the flick: where
 * it goes, and whether a hop from one top to another can be made, by the same parabola the aiming line
 * draws (for a lid, at some moment of its cycle). The places and their levels are laid in kitchen.ts.
 * Units are centimetres; the dumpling is 6 across.
 */
import { hash, type Rand } from '../kit/rng';
import { FEELS, breadFor, makeJel, mouldFor, shapeMax, touchJel, type Bread, type Jel, type JellyFeel, type Mould } from './jelly';

export type V3 = [number, number, number];
export const G = 981;
/** the dumpling's size (its radius) */
export const RADIUS = 3;
/** a flick: from gentle to hard, always at this angle up */
export const V_MIN = 70, V_MAX = 340, LAUNCH = (60 * Math.PI) / 180;
/** how high the dumpling's middle sits above what it rests on */
export const REST_H = RADIUS * 0.62;
/** How far a honey jar goes down below its tower's height (its foot, on its stand). */
export const JAR_UNDER = 12;

/** what each thing is made of, for the drawing */
export const MAT = {
  counter: 0, bamboo: 1, weave: 2, porcelain: 3, lacquer: 4, jelly: 5, tin: 6, jar: 7, board: 8, gold: 9, chopstick: 10, tiles: 11,
  // (12–16 are the drawing's own: a window, the aiming dots, the landing ring, the dark under it, the jelly's light)
  butter: 17, honey: 18, glass: 19, pot: 20, pan: 21, hob: 22, burner: 23, knob: 24,
  // (25–29: what's on a top, drawn over it: 24 + its dust)
  spoon: 30, towel: 31, gingham: 32, floral: 33, smear: 34, legs: 35,
  // (jellies: a panna cotta with its coulis, a konjac jelly)
  pannacotta: 36, konjac: 37,
  // (the counter: a loaf's crust, a bread bin's enamel)
  bread: 38, enamel: 39,
  // (the sink: brushed steel, a sponge, soap bubbles, the water)
  steel: 40, sponge: 41, bubble: 42, water: 43,
  // (home's paper serviette, folded square on its top)
  napkin: 44,
  // (cookbooks, stacked: cloth covers, their pages' edges at the sides)
  book: 45,
  // (on a pudding's top: a raspberry, a strawberry, a blackcurrant (its kind in the hundredths))
  berry: 46,
} as const;
/**
 * What coats the dumpling where it touches: flour (dry: it grips and loses its tack), butter
 * (slippery: it slides, can't hold a wall, and honey won't hold it), crumbs (rough: it bounces
 * and won't settle), pepper (it sneezes: a hop, and the pepper's off), hundreds and thousands
 * (sweet and sticky: more tack). None is 0.
 */
export const DUST = { none: 0, flour: 1, butter: 2, crumbs: 3, pepper: 4, sprinkles: 5 } as const;
export type Dust = (typeof DUST)[keyof typeof DUST];
/** each coating: how fast it comes off on what touches it (/s), how fast it wears off (/s), how much a hard landing shakes off */
export const DUSTS: Record<Dust, { on: number; off: number; shake: number }> = {
  [DUST.none]: { on: 0, off: 0, shake: 0 },
  [DUST.flour]: { on: 6, off: 0.06, shake: 0.5 },
  [DUST.butter]: { on: 3, off: 0.08, shake: 0.5 },
  [DUST.crumbs]: { on: 5, off: 0.1, shake: 0.7 },
  [DUST.pepper]: { on: 6, off: 0.12, shake: 0.3 },
  [DUST.sprinkles]: { on: 4, off: 0.04, shake: 0.4 },
};
/** which kitchen a level is in: the preparation table, the counter, then the stovetop, then all of it mixed */
export type Chapter = 'table' | 'counter' | 'sink' | 'stove' | 'mixed';
export const chapterOf = (n: number): Chapter => (n <= 4 ? 'table' : n <= 8 ? 'counter' : n <= 12 ? 'sink' : n <= 16 ? 'stove' : 'mixed');
/** the first level of each kitchen */
export const CHAPTER_AT: Record<Chapter, number> = { table: 1, counter: 5, sink: 9, stove: 13, mixed: 17 };
/** what each kitchen is called, as its title card says */
export const CHAPTER_NAME: Record<Chapter, string> = { table: 'The Preparation Table', counter: 'The Counter by the Window', sink: 'The Sink', stove: 'The Stovetop', mixed: 'The Whole Kitchen' };

/**
 * A sheet of triangles with a thickness: a spoon, a towel, a tilted plate. Its top is the
 * triangles (their normals point out of the top); its body goes down from them, so far, along
 * each one's normal. Found by a grid: each cell lists the triangles that come near it.
 */
export interface Sheet {
  /** each triangle's three corners (9 numbers), and its normal (3) */
  tris: Float32Array;
  norms: Float32Array;
  /** how thick it is, under its top */
  th: number;
  grid: Map<number, Int32Array>;
  /** each triangle's bounds (6 numbers), and the last ask that looked at it (so one ask looks at each once) */
  box: Float32Array;
  seen: Int32Array;
}
/** the grid's cell: each lists the triangles (with their thickness) that come into it */
const CELL = 2.5;
let ask = 0;
const cellKey = (ix: number, iy: number, iz: number) => ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;

/** A solid the dumpling meets: a box (turned about the vertical), an upright cylinder, a capsule, or a sheet. */
export interface Shape {
  kind: 'box' | 'cyl' | 'cap' | 'sheet' | 'jelly';
  /** a sheet's triangles */
  sheet?: Sheet;
  /** a jelly's top, as it moves (see jelly.ts) */
  jel?: Jel;
  /** box and cylinder: the centre; capsule: one end */
  c: V3;
  /** capsule: the other end */
  b: V3;
  /** box: half its size */
  h: V3;
  /** cylinder and capsule: the radius; cylinder: half its height */
  r: number;
  hh: number;
  yaw: number;
  /** grip, bounce, and turning (radians a second, about the vertical: a lazy Susan) */
  mu: number;
  bounce: number;
  spin: number;
  /** how much the dumpling's tack holds here (0: none, butter; 3: honey), and how fast it tires on a wall of this (0: never) */
  tack: number;
  tire: number;
  /** a lid that lifts: how far, its cycle, where in it it starts, and its rest height */
  lift: { amp: number; period: number; phase: number; y0: number } | null;
  /** what's on it that comes off on the dumpling (flour, crumbs, pepper, sprinkles; butter), if anything */
  dust: Dust;
  mat: number;
  lo: V3;
  hi: V3;
  /** met, but drawn by what it's part of (a crate's slats over its solid sides), not as itself */
  ghost?: boolean;
}
export type Top = 'start' | 'steamer' | 'plate' | 'board' | 'pudding' | 'susan' | 'tin' | 'goal' | 'butter' | 'honey' | 'lid' | 'pan'
  | 'pad' | 'spoon' | 'bench' | 'paddle' | 'tilt'
  | 'boule' | 'tray' | 'stand' | 'bin' | 'block' | 'shelf' | 'sill' | 'jelly'
  | 'sponge' | 'soap' | 'drainer' | 'rack'
  | 'pancakes' | 'cereal';
export interface Tower {
  top: Top;
  /** the middle of its top surface (for honey: the place against its side where you stick) */
  at: V3;
  /** how far from the middle a landing is a landing; or, for a box top, half its sides */
  r: number;
  box?: [number, number];
  yaw: number;
  shapes: Shape[];
  /** what a landing counts on, when not all of it (a pot's lid and knob, not the pot under it) */
  land?: Shape[];
  /** for honey: the jar, and which way the course goes on from its side */
  jar?: { c: V3; r: number };
  exitYaw?: number;
  /** what's drawn under it on the stove: a burner, this wide */
  burner?: number;
  /**
   * reached by a wall: too high to flick onto, it's reached by landing against what hangs or
   * stands below it (these shapes, a side that holds), and climbing up and over from there; and
   * where on that wall to aim
   */
  wall?: Shape[];
  wallAt?: V3;
}
export interface Level {
  n: number;
  chapter: Chapter;
  /** the stops along the way: where it starts, each top it must reach, home */
  towers: Tower[];
  /** everything solid: the counter (or the table), the towers, the props, the chopsticks */
  shapes: Shape[];
  /** chopstick pairs, for the drawing: each a pair of capsules */
  sticks: Shape[];
  /** the shapes that move (lids), for the drawing and for moving them */
  movers: Shape[];
  /** the jellies: their tops move as they're pressed, and are drawn as they are */
  jellies?: Shape[];
  /** below this, it's fallen (to the counter, or off the table) */
  kill: number;
  /** the room's floor, for the drawing */
  ground: number;
  /** what's drawn that isn't one of the shapes as they'd draw themselves (the props' own meshes, the table's legs), VSTRIDE vertices */
  decor: number[];
  /** the room's floor, if not the counter's wood */
  floorMat?: number;
  /** the room's walls, which the camera stays on this side of */
  walls?: Shape[];
  /**
   * A place, not a run (one with more than one way through it): from each top, which to make for
   * next (for the camera's look ahead, and playing itself); and the way the opening view goes over it.
   * Without these, the tops are a run, each the way on from the one before.
   */
  next?: number[];
  route?: number[];
}

const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);
function bounds(s: Shape): Shape {
  if (s.kind === 'box') {
    const ex = Math.abs(Math.cos(s.yaw)) * s.h[0] + Math.abs(Math.sin(s.yaw)) * s.h[2], ez = Math.abs(Math.sin(s.yaw)) * s.h[0] + Math.abs(Math.cos(s.yaw)) * s.h[2];
    s.lo = [s.c[0] - ex, s.c[1] - s.h[1], s.c[2] - ez];
    s.hi = [s.c[0] + ex, s.c[1] + s.h[1], s.c[2] + ez];
  } else if (s.kind === 'cyl') {
    s.lo = [s.c[0] - s.r, s.c[1] - s.hh, s.c[2] - s.r];
    s.hi = [s.c[0] + s.r, s.c[1] + s.hh, s.c[2] + s.r];
  } else if (s.kind === 'cap') {
    s.lo = [Math.min(s.c[0], s.b[0]) - s.r, Math.min(s.c[1], s.b[1]) - s.r, Math.min(s.c[2], s.b[2]) - s.r];
    s.hi = [Math.max(s.c[0], s.b[0]) + s.r, Math.max(s.c[1], s.b[1]) + s.r, Math.max(s.c[2], s.b[2]) + s.r];
  } else if (s.kind === 'jelly') {
    const j = s.jel!;
    // (as wide as its mould's widest, ribs and all; as high as its top can go)
    const w = j.rad * Math.max(1, ...(j.mould?.prof ?? [1])) * shapeMax(j);
    s.lo = [j.cx - w, j.base, j.cz - w];
    s.hi = [j.cx + w, j.top + 3.5, j.cz + w];
  } else {
    const t = s.sheet!.tris, th = s.sheet!.th;
    s.lo = [Infinity, Infinity, Infinity]; s.hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) { s.lo[k] = Math.min(s.lo[k], t[i + k] - th); s.hi[k] = Math.max(s.hi[k], t[i + k] + th); }
  }
  return s;
}
/**
 * A sheet from its triangles (corners in order, so that (b − a) × (c − a) points out of its top),
 * this thick under its top.
 */
export function sheet(all: number[], th: number, mat: number, mu = 0.8): Shape {
  // (not the triangles with no area: the tip of a spoon, the middle of a plate)
  const corners: number[] = [];
  for (let o = 0; o < all.length; o += 9) {
    const ux = all[o + 3] - all[o], uy = all[o + 4] - all[o + 1], uz = all[o + 5] - all[o + 2], vx = all[o + 6] - all[o], vy = all[o + 7] - all[o + 1], vz = all[o + 8] - all[o + 2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-6) for (let k = 0; k < 9; k++) corners.push(all[o + k]);
  }
  const n = corners.length / 9;
  const tris = new Float32Array(corners), norms = new Float32Array(n * 3), bx = new Float32Array(n * 6);
  const grid = new Map<number, number[]>();
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
    const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    norms[t * 3] = nx; norms[t * 3 + 1] = ny; norms[t * 3 + 2] = nz;
    // (listed in every cell its bounds, with its thickness, come into)
    const lo = [0, 1, 2].map((k) => Math.min(tris[o + k], tris[o + 3 + k], tris[o + 6 + k]) - th);
    const hi = [0, 1, 2].map((k) => Math.max(tris[o + k], tris[o + 3 + k], tris[o + 6 + k]) + th);
    for (let k = 0; k < 3; k++) { bx[t * 6 + k] = lo[k]; bx[t * 6 + 3 + k] = hi[k]; lo[k] = Math.floor(lo[k] / CELL); hi[k] = Math.floor(hi[k] / CELL); }
    for (let ix = lo[0]; ix <= hi[0]; ix++) for (let iy = lo[1]; iy <= hi[1]; iy++) for (let iz = lo[2]; iz <= hi[2]; iz++) {
      const key = cellKey(ix, iy, iz);
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(t);
    }
  }
  const g = new Map<number, Int32Array>();
  for (const [k, v] of grid) g.set(k, Int32Array.from(v));
  return bounds({ ...base(), kind: 'sheet', sheet: { tris, norms, th, grid: g, box: bx, seen: new Int32Array(n) }, mat, mu });
}
/** The point of triangle (a, b, c) nearest p, into q; whether it's within the triangle's face (not on an edge or a corner). After Ericson. */
function nearestOnTri(t: Float32Array, o: number, px: number, py: number, pz: number, q: number[]): boolean {
  const ax = t[o], ay = t[o + 1], az = t[o + 2], bx = t[o + 3], by = t[o + 4], bz = t[o + 5], cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { q[0] = ax; q[1] = ay; q[2] = az; return false; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { q[0] = bx; q[1] = by; q[2] = bz; return false; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q[0] = ax + abx * v; q[1] = ay + aby * v; q[2] = az + abz * v; return false; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { q[0] = cx; q[1] = cy; q[2] = cz; return false; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q[0] = ax + acx * w; q[1] = ay + acy * w; q[2] = az + acz * w; return false; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); q[0] = bx + (cx - bx) * w; q[1] = by + (cy - by) * w; q[2] = bz + (cz - bz) * w; return false; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  q[0] = ax + abx * v + acx * w; q[1] = ay + aby * v + acy * w; q[2] = az + abz * v + acz * w;
  return true;
}
const qTmp = [0, 0, 0];
/**
 * A point with a skin of s against a sheet: of the triangles listed near it, the one it's
 * nearest. Over a triangle's face: above its top, pushed up off it; within its thickness, out
 * the nearer side; below, pushed down off its underside. By an edge: out from the edge, which
 * runs down through the sheet's thickness.
 */
function touchSheet(sh: Sheet, px: number, py: number, pz: number, s: number, o: Hit, gap: number): boolean {
  const th = sh.th, t = sh.tris, N = sh.norms, B = sh.box, seen = sh.seen;
  const R = s + gap;
  const x0 = Math.floor((px - R) / CELL), x1 = Math.floor((px + R) / CELL), y0 = Math.floor((py - R) / CELL), y1 = Math.floor((py + R) / CELL), z0 = Math.floor((pz - R) / CELL), z1 = Math.floor((pz + R) / CELL);
  const me = ++ask;
  let best = -Infinity, found = false;
  for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (let iz = z0; iz <= z1; iz++) {
  const list = sh.grid.get(cellKey(ix, iy, iz));
  if (!list) continue;
  for (let k = 0; k < list.length; k++) {
    const ti = list[k];
    if (seen[ti] === me) continue;
    seen[ti] = me;
    const b6 = ti * 6;
    if (px < B[b6] - R || px > B[b6 + 3] + R || py < B[b6 + 1] - R || py > B[b6 + 4] + R || pz < B[b6 + 2] - R || pz > B[b6 + 5] + R) continue;
    const face = nearestOnTri(t, ti * 9, px, py, pz, qTmp);
    const nx = N[ti * 3], ny = N[ti * 3 + 1], nz = N[ti * 3 + 2];
    const dx = px - qTmp[0], dy = py - qTmp[1], dz = pz - qTmp[2];
    const sd = dx * nx + dy * ny + dz * nz;
    let d: number, ox: number, oy: number, oz: number;
    if (face) {
      if (sd >= -th / 2) { d = s - sd; ox = nx; oy = ny; oz = nz; }
      else { d = s - (-sd - th); ox = -nx; oy = -ny; oz = -nz; }
    } else {
      // (an edge: the nearest point on it, down through the thickness)
      const dn = Math.max(0, Math.min(th, -sd));
      const ex = dx + nx * dn, ey = dy + ny * dn, ez = dz + nz * dn;
      const dist = Math.hypot(ex, ey, ez);
      if (dist < 1e-6) continue;
      d = s - dist; ox = ex / dist; oy = ey / dist; oz = ez / dist;
    }
    if (d < -gap) continue;
    if (d > best) { best = d; o.nx = ox; o.ny = oy; o.nz = oz; found = true; }
  }
  }
  if (!found) return false;
  o.d = best;
  return true;
}
const base = (): Shape => ({ kind: 'box', c: [0, 0, 0], b: [0, 0, 0], h: [0, 0, 0], r: 0, hh: 0, yaw: 0, mu: 0.8, bounce: 0, spin: 0, tack: 1, tire: 1, lift: null, dust: DUST.none, mat: 0, lo: [0, 0, 0], hi: [0, 0, 0] });
export const box = (c: V3, h: V3, yaw: number, mat: number, mu = 0.8): Shape => bounds({ ...base(), kind: 'box', c, h, yaw, mat, mu });
/** an upright cylinder from y0 up to y1 */
export const cyl = (x: number, z: number, r: number, y0: number, y1: number, mat: number, mu = 0.8): Shape =>
  bounds({ ...base(), kind: 'cyl', c: [x, (y0 + y1) / 2, z], r, hh: (y1 - y0) / 2, mat, mu });
export const cap = (a: V3, b: V3, r: number, mat: number, mu = 0.7): Shape => bounds({ ...base(), kind: 'cap', c: a, b, r, mat, mu });
/** a jelly from y0 up to y1, set in a mould (of a recipe, if wanted), its top a membrane that gives (see jelly.ts) */
export function jelly(x: number, z: number, r: number, y0: number, y1: number, mat: number, feel: JellyFeel = FEELS.pudding, mu = 0.85, dome = 0, recipe?: number): Shape {
  // (a pudding, a panna cotta, a konjac: set in a mould of its own, from where it stands; not a loaf, nor a sponge)
  let mould: Mould | undefined;
  if (mat === MAT.jelly || mat === MAT.pannacotta || mat === MAT.konjac) {
    let h = hash(Math.round(x * 10), Math.round(z * 10), 0x30d);
    const kind = mat === MAT.pannacotta ? 'pannacotta' : mat === MAT.konjac ? 'konjac' : 'pudding';
    const m = mouldFor(() => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), (h % 100000) / 100000), kind, recipe);
    mould = m.mould;
    if (!dome) dome = m.dome;
  }
  return bounds({ ...base(), kind: 'jelly', c: [x, (y0 + y1) / 2, z], r, hh: (y1 - y0) / 2, mat, mu, tack: JELLY_TACK, jel: makeJel(x, z, r, y0, y1, feel, dome, 7, 24, mould) });
}
/** A bread (see jelly.ts's `BREAD`), its foot at y0, its length lying yaw: soft under its crust, and dead, as a loaf is. */
export function bread(x: number, z: number, kind: Bread, y0: number, yaw = 0): Shape {
  const b = breadFor(kind, yaw);
  return bounds({ ...base(), kind: 'jelly', c: [x, y0 + b.h / 2, z], r: b.rad, hh: b.h / 2, mat: MAT.bread, mu: 0.9, tack: JELLY_TACK, jel: makeJel(x, z, b.rad, y0, y0 + b.h, FEELS.boule, b.dome, 7, 24, b.mould) });
}
/** how much the dumpling's tack holds to a jelly: glossy, and moving, it hardly does */
export let JELLY_TACK = 0.25;
export const setJellyTack = (v: number) => { JELLY_TACK = v; };

/**
 * What raises a thing that isn't tall itself (a jar, a pot) to where it's wanted: a stack from
 * the counter up to y1, of tea tins and a celadon jar or two, each a size of its own, with a
 * wooden board on top for the thing to stand on. As wide as r at the top, narrower below.
 */
function stand(x: number, z: number, r: number, y1: number, yaw: number, coin: (salt: number) => number, y0 = 0): Shape[] {
  const out: Shape[] = [];
  if (y1 - y0 < 1) return out;
  // (the board on top: a square of wood a little wider than what's on it)
  const bt = Math.min(2, y1 - y0);
  out.push(box([x, y1 - bt / 2, z], [r + 1.2, bt / 2, r + 1.2], yaw, MAT.board, 0.85));
  let y = y0, i = 0;
  const top = y1 - bt;
  while (top - y > 0.5) {
    // (each piece 9 to 16 tall, the last one taking what's left)
    let h = 9 + 7 * coin(0x40 + i);
    if (top - y - h < 6) h = top - y;
    const jar = coin(0x60 + i) < 0.3;
    const w = r * (jar ? 0.62 : 0.55 + 0.35 * coin(0x80 + i));
    out.push(cyl(x, z, Math.max(3.5, w), y, y + h, jar ? MAT.jar : MAT.tin));
    y += h; i++;
  }
  return out;
}
/**
 * Home's serviette: a paper napkin folded square and laid on its top, as small as fits inside the top
 * (none of it overhangs, so it catches nothing: come in badly and you go off the far side, as you would
 * without it); paper, so it grips a little better than the steamer's rim. It marks home as nothing else
 * on the counter is marked, white and red-bordered on the gold.
 */
export function serviette(x: number, y: number, z: number, rad: number, yaw = 0.35): Shape {
  const h = Math.min(6.5, rad * 0.66);
  return box([x, y + 0.12, z], [h, 0.12, h], yaw, MAT.napkin, 0.95);
}
/**
 * How high a kind of top stands of itself, off what it's stood on (a plate, its own thickness; a pudding, its
 * saucer and itself; a pot, itself and its lid): what a support has to make up the rest of.
 */
export function ownHeight(top: Top, rad: number): number {
  switch (top) {
    case 'start': case 'steamer': case 'goal': return 7;
    case 'plate': return 1.6;
    case 'board': return 7;
    case 'pudding': return 6.2;
    case 'susan': return 1.4;
    case 'tin': return Math.round(rad * 1.3);
    case 'butter': return 2.2;
    case 'lid': return Math.round(rad * 1.5 + 1.8);
    case 'pan': return 1.4;
    default: return 2;
  }
}
/**
 * A tower of a kind, its top at `at`: what's on top, and what holds it up from what it stands on (the counter,
 * or, `seat` high, a support: see supports.ts), tins and jars making up whatever's between.
 */
export function tower(top: Top, at: V3, rad: number, yaw: number, r: Rand, seat = 0): Tower {
  const [x, y, z] = at;
  // (what's on a top is decided from where it stands, not from the level's own dice, so it changes no layout)
  const coin = (salt: number) => (hash(Math.round(x * 10), Math.round(z * 10), salt) % 1000) / 1000;
  const shapes: Shape[] = [];
  // (a filler of tins from what it's stood on up to so high, if there's any way to go)
  const fill = (y1: number, rr: number, mat: number = MAT.tin) => { if (y1 - seat > 0.5) shapes.push(cyl(x, z, rr, seat, y1, mat)); };
  let landR = rad - 1;
  let box2: [number, number] | null = null;
  let jar: Tower['jar'];
  let land: Shape[] | undefined;
  switch (top) {
    case 'start':
    case 'steamer':
    case 'goal':
      // a stack of bamboo steamers right down to what it stands on
      shapes.push(cyl(x, z, rad, seat, y, top === 'goal' ? MAT.gold : MAT.bamboo));
      if (top === 'goal') { const n = serviette(x, y, z, rad); shapes.push(n); land = [shapes[0], n]; }
      break;
    case 'plate': {
      // a plate on a tea tin: glazed, and so a little slippery; now and then with crumbs on it, or pepper
      fill(y - 1.6, rad * 0.5);
      const pl = cyl(x, z, rad, y - 1.6, y, MAT.porcelain, 0.55);
      const d = coin(0x2c);
      if (d < 0.4) pl.dust = DUST.crumbs; else if (d < 0.65) pl.dust = DUST.pepper;
      shapes.push(pl);
      break;
    }
    case 'board': {
      // a chopping board laid across two jars
      const ux = Math.cos(yaw), uz = -Math.sin(yaw);
      for (const s of [-1, 1]) shapes.push(cyl(x + ux * 9 * s, z + uz * 9 * s, 4.5, seat, y - 2.4, MAT.jar));
      const bd = box([x, y - 1.2, z], [15, 1.2, 9], yaw, MAT.board, 0.85);
      // (a board's for rolling out on: floury)
      bd.dust = DUST.flour;
      shapes.push(bd);
      landR = 8;
      box2 = [14, 8];
      break;
    }
    case 'pudding': {
      // a mango pudding on a saucer on a tin: it gives, and throws you back up
      fill(y - 6.2, 5.5);
      shapes.push(cyl(x, z, 10.5, y - 6.2, y - 5.4, MAT.porcelain, 0.5));
      // (it gives: its top dents where you land and springs back, and may throw you up again)
      const p = jelly(x, z, rad, y - 5.4, y, MAT.jelly, FEELS.pudding);
      // (some with hundreds and thousands on top)
      if (coin(0x5e) < 0.7) p.dust = DUST.sprinkles;
      shapes.push(p);
      landR = rad - 1.5;
      break;
    }
    case 'susan': {
      // a lacquered lazy Susan on a tin, turning
      fill(y - 1.4, 6);
      const s = cyl(x, z, rad, y - 1.4, y, MAT.lacquer, 0.85);
      s.spin = (r() < 0.5 ? -1 : 1) * ramp(r, 0.45, 0.8);
      shapes.push(bounds(s));
      break;
    }
    case 'tin': {
      // a tall tea tin: a small top
      shapes.push(cyl(x, z, rad, seat, y, MAT.tin));
      landR = rad - 1.5;
      break;
    }
    case 'butter': {
      // a butter dish on a tin: a block of butter, slippery, in a porcelain dish with a lip round it that catches you
      fill(y - 2.2, 5);
      shapes.push(box([x, y - 1.6, z], [12, 0.6, 8.5], yaw, MAT.porcelain, 0.5));
      const b = box([x, y - 0.5, z], [8.5, 0.5, 5.5], yaw, MAT.butter, 0.28);
      b.tack = 0; b.dust = DUST.butter;
      shapes.push(b);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      // (the lip: a proper wall, as a covered dish's base has; a fast slide stops against it)
      const at2 = (lx: number, lz: number): V3 => [x + cy * lx + sy * lz, y + 0.6, z - sy * lx + cy * lz];
      for (const sx of [-1, 1]) shapes.push(box(at2(11.75 * sx, 0), [0.25, 1.9, 8.5], yaw, MAT.porcelain, 0.5));
      for (const sz of [-1, 1]) shapes.push(box(at2(0, 8.25 * sz), [11.5, 1.9, 0.25], yaw, MAT.porcelain, 0.5));
      box2 = [11.5, 8.25];
      break;
    }
    case 'honey': {
      // a big honey jar on a stand, its top higher than a flick reaches: honey has run down its side, and that's where you land, against it, and stick
      const jc: V3 = [x + Math.sin(yaw) * (rad + RADIUS * 0.82), 0, z + Math.cos(yaw) * (rad + RADIUS * 0.82)];
      shapes.push(cyl(jc[0], jc[2], rad, y - JAR_UNDER, y + 15, MAT.glass, 0.45));
      shapes.push(cyl(jc[0], jc[2], rad * 0.9, y + 15, y + 17.5, MAT.board, 0.7));
      // (the honey has run well down: a splat slides a little before it holds, and stays on honey)
      const h = cyl(jc[0], jc[2], rad + 0.45, y - JAR_UNDER + 0.3, y + 4.5, MAT.honey, 0.9);
      h.tack = 3; h.tire = 0;
      shapes.push(h);
      shapes.push(...stand(jc[0], jc[2], rad, y - JAR_UNDER, yaw, coin, seat));
      jar = { c: [jc[0], y, jc[2]], r: rad + 0.45 };
      landR = 0;
      break;
    }
    case 'lid': {
      // a pot, its lid on, on a stand: every few seconds the steam in it rattles the lid, and you on it
      const ph = Math.min(y - 1.8 - seat, rad * 1.5);
      shapes.push(cyl(x, z, rad, y - 1.8 - ph, y - 1.8, MAT.pot));
      // (its two handles, out to the sides)
      for (const sd of [-1, 1]) { const a = yaw + Math.PI / 2; shapes.push(box([x + Math.sin(a) * sd * (rad + 1.5), y - 4.2, z + Math.cos(a) * sd * (rad + 1.5)], [0.6, 0.45, 1.6], a, MAT.pot, 0.7)); }
      const l = cyl(x, z, rad + 0.7, y - 1.6, y, MAT.pot, 0.7);
      l.lift = { amp: 0.9, period: ramp(r, 4.5, 6.5), phase: r(), y0: l.c[1] };
      shapes.push(l);
      const k = cyl(x, z, 1.3, y, y + 1.2, MAT.knob, 0.7);
      k.lift = { ...l.lift, y0: k.c[1] };
      shapes.push(k);
      land = [l, k];
      landR = rad - 0.5;
      shapes.push(...stand(x, z, rad, y - 1.8 - ph, yaw, coin, seat));
      break;
    }
    case 'pan': {
      // a frying pan on a pot: wide and a little slippery, with a rim round it, and a handle out the back
      const ph = Math.min(y - 1.4 - seat, 13);
      if (ph > 0.5) shapes.push(cyl(x, z, 8, y - 1.4 - ph, y - 1.4, MAT.pot));
      shapes.push(...stand(x, z, 8, y - 1.4 - Math.max(0, ph), yaw, coin, seat));
      shapes.push(cyl(x, z, rad, y - 1.4, y, MAT.pan, 0.4));
      const segs = 14;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
        const A: V3 = [x + Math.cos(a0) * (rad - 0.3), y + 1, z + Math.sin(a0) * (rad - 0.3)], B: V3 = [x + Math.cos(a1) * (rad - 0.3), y + 1, z + Math.sin(a1) * (rad - 0.3)];
        shapes.push(cap(A, B, 1, MAT.pan, 0.5));
      }
      // (the handle out to one side of the course, where it's out of the way of the hops)
      const hy = yaw + (r() < 0.5 ? -1 : 1) * Math.PI / 2;
      shapes.push(box([x + Math.sin(hy) * (rad + 6.5), y + 0.6, z + Math.cos(hy) * (rad + 6.5)], [1.4, 0.7, 7.5], hy, MAT.board, 0.7));
      landR = rad - 2;
      break;
    }
  }
  const tw: Tower = { top, at, r: landR, yaw, shapes };
  if (box2) tw.box = box2;
  if (jar) tw.jar = jar;
  if (land) tw.land = land;
  return tw;
}

// ─── meeting the course ──────────────────────────────────────────────────────────────────────────
/** a touch: the normal out of the surface, how deep (negative: apart by that much), the surface's own velocity there */
export interface Hit { nx: number; ny: number; nz: number; d: number; vx: number; vy: number; vz: number }
/**
 * A point with a skin of s against a shape: true if within s + gap of its surface, and then
 * the push out (normal, depth), the surface's velocity there.
 */
export function touch(sh: Shape, px: number, py: number, pz: number, s: number, o: Hit, gap = 0): boolean {
  o.vx = 0; o.vy = 0; o.vz = 0;
  if (sh.kind === 'sheet') return touchSheet(sh.sheet!, px, py, pz, s, o, gap);
  if (sh.kind === 'jelly') return touchJel(sh.jel!, px, py, pz, s, o, gap);
  const dx = px - sh.c[0], dy = py - sh.c[1], dz = pz - sh.c[2];
  if (sh.kind === 'box') {
    const cy = Math.cos(sh.yaw), sy = Math.sin(sh.yaw);
    const lx = cy * dx - sy * dz, ly = dy, lz = sy * dx + cy * dz;
    const [hx, hy, hz] = sh.h;
    const ex = lx - Math.max(-hx, Math.min(hx, lx)), ey = ly - Math.max(-hy, Math.min(hy, ly)), ez = lz - Math.max(-hz, Math.min(hz, lz));
    const dist = Math.hypot(ex, ey, ez);
    let nx: number, ny: number, nz: number;
    if (dist > 1e-6) {
      if (dist > s + gap) return false;
      nx = ex / dist; ny = ey / dist; nz = ez / dist;
      o.d = s - dist;
    } else {
      const ax = hx - Math.abs(lx), ay = hy - Math.abs(ly), az = hz - Math.abs(lz);
      if (ay <= ax && ay <= az) { nx = 0; ny = Math.sign(ly) || 1; nz = 0; o.d = s + ay; }
      else if (ax <= az) { nx = Math.sign(lx) || 1; ny = 0; nz = 0; o.d = s + ax; }
      else { nx = 0; ny = 0; nz = Math.sign(lz) || 1; o.d = s + az; }
    }
    o.nx = cy * nx + sy * nz; o.ny = ny; o.nz = -sy * nx + cy * nz;
    return true;
  }
  if (sh.kind === 'cyl') {
    const rr = Math.hypot(dx, dz), dr = rr - sh.r, dh = Math.abs(dy) - sh.hh;
    const rx = rr > 1e-6 ? dx / rr : 1, rz = rr > 1e-6 ? dz / rr : 0, sy = Math.sign(dy) || 1;
    if (dr <= 0 && dh <= 0) {
      if (-dr < -dh) { o.nx = rx; o.ny = 0; o.nz = rz; o.d = s - dr; }
      else { o.nx = 0; o.ny = sy; o.nz = 0; o.d = s - dh; }
    } else if (dr > 0 && dh > 0) {
      const dist = Math.hypot(dr, dh);
      if (dist > s + gap) return false;
      o.nx = (rx * dr) / dist; o.ny = (sy * dh) / dist; o.nz = (rz * dr) / dist; o.d = s - dist;
    } else if (dr > 0) {
      if (dr > s + gap) return false;
      o.nx = rx; o.ny = 0; o.nz = rz; o.d = s - dr;
    } else {
      if (dh > s + gap) return false;
      o.nx = 0; o.ny = sy; o.nz = 0; o.d = s - dh;
    }
    // (a turning top: its surface moves, ω × r; a lifting one goes up and down)
    if (sh.spin) { o.vx = sh.spin * dz; o.vz = -sh.spin * dx; }
    if (sh.lift) o.vy = sh.b[1];
    return true;
  }
  const ax = sh.b[0] - sh.c[0], ay = sh.b[1] - sh.c[1], az = sh.b[2] - sh.c[2];
  const t = Math.max(0, Math.min(1, (dx * ax + dy * ay + dz * az) / (ax * ax + ay * ay + az * az || 1)));
  const ex = dx - ax * t, ey = dy - ay * t, ez = dz - az * t;
  const dist = Math.hypot(ex, ey, ez);
  if (dist > s + sh.r + gap || dist < 1e-6) return false;
  o.nx = ex / dist; o.ny = ey / dist; o.nz = ez / dist; o.d = s + sh.r - dist;
  return true;
}
/**
 * A lid's cycle: shut most of the time; then the steam under it rattles it, a few quick jumps
 * on the pot's rim, the steam escaping round it, and it settles shut again. 0–1 of its jump,
 * how fast it's going (jumps a second), and whether it's rattling.
 */
export const RATTLE = 0.16;
export function liftAt(l: NonNullable<Shape['lift']>, t: number): { k: number; v: number; on: boolean } {
  const ph = (((t / l.period + l.phase) % 1) + 1) % 1;
  const f = (p: number) => {
    const x = (p - (1 - RATTLE)) / RATTLE;
    if (x <= 0 || x >= 1) return 0;
    // (six jumps, the middle ones highest)
    return Math.sin(Math.PI * x) ** 0.6 * Math.abs(Math.sin(6 * Math.PI * x));
  };
  const e = 1e-4;
  return { k: f(ph), v: (f(ph + e) - f(ph - e)) / (2 * e * l.period), on: ph > 1 - RATTLE };
}
/** The lids where they are at a time: moved, their bounds with them, their speed kept (in b[1]) for what rests on them. */
export function moveShapes(lv: Level, t: number) {
  for (const s of lv.movers) {
    const l = s.lift!;
    const { k, v } = liftAt(l, t);
    s.c[1] = l.y0 + l.amp * k;
    s.b[1] = l.amp * v;
    s.lo[1] = s.c[1] - s.hh; s.hi[1] = s.c[1] + s.hh;
  }
}
/** The shapes whose bounds come within rad of a point. */
export function near(lv: Level, p: V3, rad: number, out: Shape[]): Shape[] {
  out.length = 0;
  for (const s of lv.shapes) {
    if (p[0] + rad < s.lo[0] || p[0] - rad > s.hi[0] || p[1] + rad < s.lo[1] || p[1] - rad > s.hi[1] || p[2] + rad < s.lo[2] || p[2] - rad > s.hi[2]) continue;
    out.push(s);
  }
  return out;
}

// ─── the flick, and where it goes ─────────────────────────────────────────────────────────────────
/** a climb: once it's up past the top of the wall it went up, how fast it's carried in over it (cm/s) */
export const CLIMB_IN = 40;
const SLIDE = 0.3, CLEAR_GAP = 1.2;
/** and how long it must be off the wall to be clear of it (s) */
export const CLIMB_CLEAR = 0.03;
/** A climb, so hard (0–1): straight up the wall, as fast as a flick that hard. */
export function climbLaunch(power: number): V3 {
  return [0, V_MIN + (V_MAX - V_MIN) * Math.max(0, Math.min(1, power)), 0];
}
/** A flick the way yaw (from +z toward +x), so hard (0–1): the velocity it gives. */
export function launch(yaw: number, power: number): V3 {
  const v = V_MIN + (V_MAX - V_MIN) * Math.max(0, Math.min(1, power));
  return [Math.sin(yaw) * Math.cos(LAUNCH) * v, Math.sin(LAUNCH) * v, Math.cos(yaw) * Math.cos(LAUNCH) * v];
}
export interface Path { pts: V3[]; hit: { p: V3; n: V3; shape: Shape; v: V3 } | null; t: number }
/**
 * Where the dumpling's middle goes from `from` at `vel`: a parabola (its middle flies one; the
 * squish is about it) until a ball the size of its middle meets something.
 */
export function path(lv: Level, from: V3, vel: V3, max = 3, t0 = 0, climb: V3 | null = null): Path {
  const pts: V3[] = [];
  const h = 1 / 240, R = RADIUS * 0.82;
  // (climbing: up the wall, sliding along it; off its top, carried in over it: as the body does)
  let climbing = !!climb, off = 0;
  // (as it leaves it's still broad and low, sat on its flat bottom: a wider ball for the first moments, so a lip ahead of it is seen to catch it; climbing, it's long up the wall)
  const ballAt = (t: number) => (climbing ? RADIUS * 1.1 : climb ? R : RADIUS * (1.15 - 0.33 * Math.min(1, t / 0.15)));

  const o: Hit = { nx: 0, ny: 0, nz: 0, d: 0, vx: 0, vy: 0, vz: 0 };
  const ns: Shape[] = [];
  let [x, y, z] = from, [vx, vy, vz] = vel;
  // (what it's squashed against and going away from, the top it's leaving, a jar it's stuck to: not a hit for the first moments; anything it's going toward is)
  const leaving: Shape[] = [];
  if (lv.movers.length) moveShapes(lv, t0);
  near(lv, from, R + 0.5, ns);
  for (const s of ns) if (touch(s, from[0], from[1], from[2], R + 0.5, o) && o.d > 0 && vel[0] * o.nx + vel[1] * o.ny + vel[2] * o.nz > 0) leaving.push(s);
  for (let i = 0, t = 0; t < max; i++, t += h) {
    vy -= G * h;
    x += vx * h; y += vy * h; z += vz * h;
    if (i % 8 === 0) pts.push([x, y, z]);
    if (t < 0.01) continue;
    if (lv.movers.length && i % 4 === 0) moveShapes(lv, t0 + t);
    const Rt = ballAt(t);
    near(lv, [x, y, z], Rt + 1, ns);
    if (climbing) {
      let on = false;
      // (on the wall while within a hair of it: sliding, it's kept there, not bounced off it and back)
      for (const s of ns) if (touch(s, x, y, z, Rt + SLIDE, o) && o.d > 0 && Math.abs(o.ny) < 0.5) {
        on = true;
        const d = Math.max(0, o.d - SLIDE);
        x += o.nx * d; y += o.ny * d; z += o.nz * d;
        const vn = vx * o.nx + vy * o.ny + vz * o.nz;
        if (vn < 0) { vx -= o.nx * vn; vy -= o.ny * vn; vz -= o.nz * vn; }
      }
      // (and clear of it only when well off it: a lip on the wall, a step in the glass, is still the wall)
      if (!on) for (const s of ns) if (touch(s, x, y, z, Rt + CLEAR_GAP, o) && o.d > 0 && Math.abs(o.ny) < 0.5) { on = true; break; }
      if (on) {
        off = 0;
        // (sliding back down: it hasn't made it)
        if (vy < -30) { if (lv.movers.length) moveShapes(lv, t0); return { pts, hit: null, t }; }
        continue;
      }
      if ((off += h) >= CLIMB_CLEAR) { vx -= climb![0] * CLIMB_IN; vz -= climb![2] * CLIMB_IN; climbing = false; }
      else continue;
    }
    for (const s of ns) if (!(t < 0.2 && leaving.includes(s)) && touch(s, x, y, z, Rt, o) && o.d > 0) {
      pts.push([x, y, z]);
      if (lv.movers.length) moveShapes(lv, t0);
      return { pts, hit: { p: [x, y, z], n: [o.nx, o.ny, o.nz], shape: s, v: [vx, vy, vz] }, t };
    }
  }
  if (lv.movers.length) moveShapes(lv, t0);
  return { pts, hit: null, t: max };
}
/** Whether a point is on a tower's top: within its landing reach, and resting on it (not below). */
export function onTop(tw: Tower, p: V3, slack = 0): boolean {
  const dx = p[0] - tw.at[0], dz = p[2] - tw.at[2];
  if (tw.jar) {
    // (against the honey on the jar's side, within its band)
    const d = Math.hypot(p[0] - tw.jar.c[0], p[2] - tw.jar.c[2]) - tw.jar.r;
    return p[1] > tw.at[1] - JAR_UNDER - slack && p[1] < tw.at[1] + 5.5 + slack && d > 0.5 - slack && d < 4.5 + slack;
  }
  // (on a lid: above the lid where it is now, not on the pot under it while it's up)
  const lidTop = tw.land?.[0].lift ? tw.land[0].c[1] + tw.land[0].hh : tw.at[1];
  // (a little below its top too: a dish has a gutter round its butter)
  if (p[1] < lidTop - (tw.box ? 2 : 0.5) || p[1] > lidTop + RADIUS * 2.5) return false;
  if (tw.box) {
    const cy = Math.cos(tw.yaw), sy = Math.sin(tw.yaw);
    const lx = cy * dx - sy * dz, lz = sy * dx + cy * dz;
    return Math.abs(lx) < tw.box[0] + slack && Math.abs(lz) < tw.box[1] + slack;
  }
  return Math.hypot(dx, dz) < tw.r + slack;
}
/** How fast what's under a point carries it (a lazy Susan's top, turning), so sat on one it's still, though it goes round. */
export function carried(lv: Level, p: V3): V3 {
  const k = towerAt(lv, p, 1);
  const s = k >= 0 ? (lv.towers[k].land ?? lv.towers[k].shapes).find((sh) => sh.spin) : undefined;
  if (!s) return [0, 0, 0];
  const dx = p[0] - s.c[0], dz = p[2] - s.c[2];
  return [s.spin * dz, 0, -s.spin * dx];
}
/** The tower whose top a point is on, or -1. */
export function towerAt(lv: Level, p: V3, slack = 0): number {
  for (let i = lv.towers.length - 1; i >= 0; i--) if (onTop(lv.towers[i], p, slack)) return i;
  return -1;
}
/**
 * A flick from `from` that lands on tower k: the way to it, and the strength in the middle of
 * the band that lands there (the safest); null if none does.
 */
export function aim(lv: Level, from: V3, k: number, t = 0): { yaw: number; power: number } | null {
  const tw = lv.towers[k];
  const yaw = Math.atan2(tw.at[0] - from[0], tw.at[2] - from[2]);
  let lo = -1, hi = -1;
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const pa = path(lv, from, launch(yaw, p), 3, t);
    // (on its top; or, for honey, against the honey, which holds)
    // (a touch as it leaves, on what it's leaving, isn't a landing)
    const ok = pa.hit && pa.t > 0.06 && (tw.land ?? tw.shapes).includes(pa.hit.shape) && (tw.jar ? pa.hit.shape.tack > 1 && Math.abs(pa.hit.n[1]) < 0.6 : pa.hit.n[1] > 0.7) && onTop(tw, pa.hit.p, -1.5);
    if (ok) { if (lo < 0) lo = p; hi = p; } else if (lo >= 0) break;
  }
  // (a little short of the middle of the band: it carries on a little after it lands)
  return lo < 0 ? null : { yaw, power: lo + (hi - lo) * 0.4 };
}
/**
 * The autopilot's flick, from where it is, having last stood on tower `at` (null: wait); on to the next; else
 * back to the middle of this one (not a jar's); else on past the next; else, wedged somewhere
 * with no clear flick, a hop toward the next to get loose.
 */
/** which top to make for next from top k: the place's own say, or, on a run, the one after */
export function nextTop(lv: Level, k: number): number { return Math.min(lv.towers.length - 1, Math.max(0, lv.next ? lv.next[k] ?? k + 1 : k + 1)); }
export function autoFlick(lv: Level, from: V3, at: number, t = 0, butter = 0, cling: V3 | null = null): { yaw: number; power: number; climb?: V3 } | null {
  // (buttered, a jar's honey won't hold it: wait for the butter to wear off first)
  const n1 = nextTop(lv, at), n2 = nextTop(lv, n1);
  if (butter > 0.04 && lv.towers[n1]?.jar && lv.towers[at].top !== 'butter') return null;
  // (on a lid, or onto one, not while it's rattling: wait for it to settle)
  const rattles = (k: number, at: number) => { const l = lv.towers[k].land?.[0].lift; return !!l && liftAt(l, at).on; };
  if (rattles(at, t) && onTop(lv.towers[at], from, 1)) return null;
  // (the next is reached by its wall: clinging to it, up and over; else at it)
  const nx0 = lv.towers[n1];
  if (nx0?.wall) {
    if (cling) { const c = climbAim(lv, from, cling, n1, t); if (c) return { yaw: 0, power: c.power, climb: cling }; }
    // (not on the wall, or held by something else: at the wall)
    const w = aimWall(lv, from, n1, t);
    if (w) return { yaw: w.yaw, power: w.power };
  }
  const tries = [n1, lv.towers[at].jar ? -1 : at, n2].filter((k) => k >= 0 && k < lv.towers.length);
  for (const k of tries) {
    const a = aim(lv, from, k, t);
    if (a) return rattles(k, t + path(lv, from, launch(a.yaw, a.power), 3, t).t) ? null : a;
  }
  // (clinging to the side of something, with no flick away that lands: up it, and over onto its top)
  if (cling) for (const k of [n1, at].filter((k) => k >= 0 && k < lv.towers.length)) {
    const c = climbAim(lv, from, cling, k, t);
    if (c) return { yaw: 0, power: c.power, climb: cling };
  }
  const nx = lv.towers[n1].at;
  return { yaw: Math.atan2(nx[0] - from[0], nx[2] - from[2]), power: 0.3 };
}
/**
 * A climb from `from`, up the wall it's on (n: out of the wall), that lands on top of tower k:
 * the strength in the middle of the band that does; null if none does.
 */
export function climbAim(lv: Level, from: V3, n: V3, k: number, t = 0): { power: number } | null {
  const tw = lv.towers[k];
  let lo = -1, hi = -1;
  for (let p = 0; p <= 1.0001; p += 0.02) {
    const pa = path(lv, from, climbLaunch(p), 3, t, n);
    const ok = pa.hit && tw.shapes.includes(pa.hit.shape) && pa.hit.n[1] > 0.7 && inside(pa.hit.shape, pa.hit.p, 1.8);
    if (ok) { if (lo < 0) lo = p; hi = p; } else if (lo >= 0) break;
  }
  // (up a towel, high in the band: sliding up it costs a little, and past the top there's the wall behind to stop it;
  // onto a jar's top, nothing behind to stop it, the middle of the band)
  return lo < 0 ? null : { power: lo + (hi - lo) * (tw.wall ? 0.65 : 0.4) };
}
/**
 * A flick from `from` that lands against tower k's wall (its `wall`: a side that holds, below its
 * top), low enough on it to cling and high enough that a climb from there gets up and over onto
 * the top: the flick (yaw, strength), where it lands on the wall and which way the wall faces,
 * and the climb's strength; null if there's none.
 */
export function aimWall(lv: Level, from: V3, k: number, t = 0): { yaw: number; power: number; at: V3; n: V3; climb: number } | null {
  const tw = lv.towers[k];
  if (!tw.wall || !tw.wallAt) return null;
  const yaw = Math.atan2(tw.wallAt[0] - from[0], tw.wallAt[2] - from[2]);
  const good: Array<{ power: number; at: V3; n: V3; climb: number }> = [];
  for (let p = 0.05; p <= 1.0001; p += 0.02) {
    const pa = path(lv, from, launch(yaw, p), 3, t);
    const h = pa.hit;
    if (!h || !tw.wall.includes(h.shape) || Math.abs(h.n[1]) > 0.5) { if (good.length) break; continue; }
    const l = Math.hypot(h.n[0], h.n[2]);
    const n: V3 = [h.n[0] / l, 0, h.n[2] / l];
    // (where it hangs once it's stuck: a little down from where its middle met the wall)
    const hang: V3 = [h.p[0] + n[0] * 0.4, h.p[1] - 1, h.p[2] + n[2] * 0.4];
    const c = climbAim(lv, hang, n, k, t + pa.t);
    if (c) good.push({ power: p, at: hang, n, climb: c.power }); else if (good.length) break;
  }
  if (!good.length) return null;
  // (high on the band: it slides a little, and droops, once it's stuck, and wants wall above it to climb)
  const g = good[Math.floor(good.length * 0.65)];
  return { yaw, ...g };
}
/** Whether a point is over a shape's top, at least so far in from its edge. */
function inside(s: Shape, p: V3, margin: number): boolean {
  if (s.kind === 'cyl') return Math.hypot(p[0] - s.c[0], p[2] - s.c[2]) < s.r - margin;
  if (s.kind === 'box') {
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), dx = p[0] - s.c[0], dz = p[2] - s.c[2];
    return Math.abs(cy * dx - sy * dz) < s.h[0] - margin && Math.abs(sy * dx + cy * dz) < s.h[2] - margin;
  }
  return true;
}
/** Where the dumpling's middle is, sat on tower j at a time (on a lid, it rides with it). */
export function standing(lv: Level, j: number, t = 0): V3 {
  const tw = lv.towers[j];
  const l = tw.land?.[0];
  if (!l?.lift) return [tw.at[0], tw.at[1] + REST_H, tw.at[2]];
  return [tw.at[0], l.lift!.y0 + l.hh + l.lift!.amp * liftAt(l.lift!, t).k + REST_H, tw.at[2]];
}
/**
 * Whether the hop from tower j to tower k can be made: from the middle of j (from a jar's side,
 * from lower down too: a splat slides before the honey holds it). With a lid at either end, at some moment
 * of its cycle; otherwise, now.
 */
export function hop(lv: Level, j: number, k: number): { t: number; flights: V3[][] } | null {
  const a = lv.towers[j], b = lv.towers[k];
  const lid = b.land?.[0].lift ?? a.land?.[0].lift;
  const times = lid ? [0, 1, 2, 3, 4, 5].map((i) => ((i / 6 + 1 - lid.phase) % 1) * lid.period) : [0];
  const froms = (t: number) => { const f = standing(lv, j, t); return a.jar ? [f, [f[0], f[1] - 4, f[2]] as V3, [f[0], f[1] - 8, f[2]] as V3] : [f]; };
  // (onto a top reached by its wall: against the wall, and up)
  if (b.wall) {
    const f = standing(lv, j, 0), w = aimWall(lv, f, k, 0);
    if (!w) return null;
    const up = path(lv, w.at, climbLaunch(w.climb), 3, 0, w.n);
    return { t: 0, flights: [path(lv, f, launch(w.yaw, w.power), 3, 0).pts, up.pts] };
  }
  for (const t of times) {
    const fs = froms(t), aims = fs.map((f) => aim(lv, f, k, t));
    if (aims.every(Boolean)) return { t, flights: fs.map((f, i) => path(lv, f, launch(aims[i]!.yaw, aims[i]!.power), 3, t).pts) };
  }
  return null;
}
