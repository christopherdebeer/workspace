/**
 * Squishy: what things stand on. A kitchen's things aren't stood on towers of tins: a pudding's on a
 * cake stand, a pan on an upturned crate, a steamer on a stool, a plate on a stack of cookbooks. Each
 * support here is built from what it stands on (y0) up to its seat (y1), where what's on it goes, and
 * kept simple where it's met (boxes, cylinders, rods) and drawn as what it is (splayed legs and rungs,
 * slats, a flared stem, wire). Where it would be played with, what's met is what's drawn: a stool's
 * rungs, a cake stand's thin neck, a rack's wires, an upturned bowl's shoulders.
 *
 * - **stool**: three splayed legs, rungs between them, a round seat;
 * - **bench**: a little four-legged stool, square, rails along two sides;
 * - **pedestal**: a cake stand: a foot, a flared neck, a thin stem, a broad plate;
 * - **trestle**: a board laid across two jars (or tins, or mugs upturned);
 * - **crate**: a slatted wooden crate turned over, its lid boards across the top;
 * - **books**: cookbooks stacked a little anyhow;
 * - **bowl**: a bowl upturned, its foot ring the seat, its shoulders falling away;
 * - **rack**: a wire cooling rack on two tins;
 * - and as they were: **tins** (tea tins and jars under a board).
 *
 * Supports stack: a bowl too short for where it's wanted goes on a crate, a cake stand on books.
 * And two are places of themselves (see `kitchen.ts`): a tiered stand, its plates to land on; a rack
 * with nothing on it, to land across its wires.
 */
import { hash, type Rand } from '../kit/rng';
import { DUST, MAT, box, cap, cyl, ownHeight, tower, type Shape, type Top, type Tower, type V3 } from './level';
import { box as drawBox, cylinder } from './mesh';
import { surface } from './props';

export type Holder = 'stool' | 'bench' | 'pedestal' | 'trestle' | 'crate' | 'books' | 'bowl' | 'rack' | 'tins';
export interface Held {
  /** what's met (and, unless a ghost, drawn as itself) */
  shapes: Shape[];
  /** what's drawn besides (VSTRIDE vertices) */
  decor: number[];
  /** its seat: how high, and how far out from (x, z) it holds what's on it (a box's half sides, if square) */
  y: number; r: number; box?: [number, number];
}
/** how tall each can be of itself (a bowl's no taller than a bowl; past that, it's stood on something) */
export const SPAN: Record<Holder, [number, number]> = {
  stool: [9, 26], bench: [8, 18], pedestal: [5, 14], trestle: [5, 16], crate: [6, 20], books: [4, 16], bowl: [5, 11], rack: [4, 14], tins: [1, 40],
};
type Coin = (salt: number) => number;
const ring = (n: number, a0 = 0) => Array.from({ length: n }, (_, i) => a0 + (i / n) * Math.PI * 2);

/**
 * A support of a kind at (x, z), from y0 up to its seat at y1, holding something `need` across (its
 * radius), turned to yaw; its own proportions from the coin. If it can't be so tall of itself, it's
 * stood on another (`base`) to make up the rest.
 */
export function holder(kind: Holder, x: number, z: number, y0: number, y1: number, need: number, yaw: number, coin: Coin): Held {
  const [lo, hi] = SPAN[kind];
  if (y1 - y0 > hi + 0.01) {
    // (too tall of itself: on a crate, or books, or a stool, whichever makes up the rest)
    const rest = y1 - y0 - hi * (0.7 + 0.3 * coin(0x31));
    const under: Holder = rest > SPAN.crate[1] ? 'stool' : rest > SPAN.books[1] || coin(0x32) < 0.5 ? 'crate' : 'books';
    const below = holder(under, x, z, y0, y0 + rest, need + 2, yaw + 0.3 * (coin(0x33) - 0.5), (s) => coin(s + 0x100));
    const above = holder(kind, x, z, below.y, y1, need, yaw, coin);
    return { shapes: [...below.shapes, ...above.shapes], decor: [...below.decor, ...above.decor], y: y1, r: above.r, box: above.box };
  }
  const h = Math.max(lo, y1 - y0);
  y1 = y0 + h;
  switch (kind) {
    case 'stool': return stool(x, z, y0, y1, need, yaw, coin);
    case 'bench': return bench(x, z, y0, y1, need, yaw, coin);
    case 'pedestal': return pedestal(x, z, y0, y1, need);
    case 'trestle': return trestle(x, z, y0, y1, need, yaw, coin);
    case 'crate': return crate(x, z, y0, y1, need, yaw, coin);
    case 'books': return books(x, z, y0, y1, need, yaw, coin);
    case 'bowl': return bowl(x, z, y0, y1, need, coin);
    case 'rack': return rack(x, z, y0, y1, need, yaw, coin);
    default: return tins(x, z, y0, y1, need, coin);
  }
}

/** A three-legged stool: a round seat, its legs splayed out under it, rungs between them a third of the way up. */
function stool(x: number, z: number, y0: number, y1: number, need: number, yaw: number, coin: Coin): Held {
  const R = need + 1.5 + coin(1) * 1.5, T = 2.2, splay = 1.5 + (y1 - y0) * 0.09;
  const shapes: Shape[] = [], decor: number[] = [];
  const seat = cyl(x, z, R, y1 - T, y1, MAT.board, 0.85);
  shapes.push(seat);
  const top = (a: number): V3 => [x + Math.cos(a) * R * 0.62, y1 - T, z + Math.sin(a) * R * 0.62];
  const foot = (a: number): V3 => [x + Math.cos(a) * (R * 0.62 + splay), y0 + 0.9, z + Math.sin(a) * (R * 0.62 + splay)];
  const legs = ring(3, yaw);
  for (const a of legs) shapes.push(cap(foot(a), top(a), 0.95, MAT.board, 0.7));
  // (rungs between the legs, a third of the way up: a stool's open, and its rungs are there to be met)
  const along = (a: number, t: number): V3 => { const f = foot(a), p = top(a); return [f[0] + (p[0] - f[0]) * t, f[1] + (p[1] - f[1]) * t, f[2] + (p[2] - f[2]) * t]; };
  for (let i = 0; i < 3; i++) shapes.push(cap(along(legs[i], 0.33), along(legs[(i + 1) % 3], 0.33), 0.55, MAT.board, 0.7));
  // (the seat's edge rounded over, and drawn a little thicker than a board)
  cylinder(decor, x, z, R - 0.4, y1 - T - 0.6, y1 - T, MAT.board, MAT.board, 36, false, R - 1.2);
  return { shapes, decor, y: y1, r: R };
}
/** A low square stool on four legs, rails along two sides near the floor. */
function bench(x: number, z: number, y0: number, y1: number, need: number, yaw: number, coin: Coin): Held {
  const hx = need + 1 + coin(2) * 2, hz = need + 0.5 + coin(3) * 1.5, T = 2;
  const shapes: Shape[] = [];
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const W = (lx: number, ly: number, lz: number): V3 => [x + cy * lx + sy * lz, ly, z - sy * lx + cy * lz];
  shapes.push(box([x, y1 - T / 2, z], [hx, T / 2, hz], yaw, MAT.board, 0.85));
  const lx = hx - 1.6, lz = hz - 1.6, lh = (y1 - T - y0) / 2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) shapes.push(box(W(sx * lx, y0 + lh, sz * lz), [0.9, lh, 0.9], yaw, MAT.board, 0.7));
  // (rails along its long sides, low; and an apron under the seat on those sides)
  for (const sz of [-1, 1]) {
    shapes.push(cap(W(-lx, y0 + lh * 0.5, sz * lz), W(lx, y0 + lh * 0.5, sz * lz), 0.5, MAT.board, 0.7));
    shapes.push(box(W(0, y1 - T - 1, sz * lz), [lx, 1, 0.4], yaw, MAT.board, 0.7));
  }
  return { shapes, decor: [], y: y1, r: Math.min(hx, hz), box: [hx, hz] };
}
/** A cake stand: a round foot, a neck flaring up out of it, a thin stem, a broad plate. Porcelain. */
function pedestal(x: number, z: number, y0: number, y1: number, need: number): Held {
  const R = need + 1.2, foot = Math.max(4.5, R * 0.55), stem = 1.3;
  const shapes: Shape[] = [], decor: number[] = [];
  const f1 = y0 + 1, n1 = y0 + Math.min(3, (y1 - y0) * 0.3), p0 = y1 - 1.3;
  shapes.push(cyl(x, z, foot, y0, f1, MAT.porcelain, 0.5));
  // (the neck: met as what's widest of it, drawn flaring from the foot to the stem)
  const neck = cyl(x, z, (foot * 0.55 + stem) / 2, f1, n1, MAT.porcelain, 0.5);
  neck.ghost = true;
  const st = cyl(x, z, stem, n1, p0, MAT.porcelain, 0.5);
  st.ghost = true;
  const plate = cyl(x, z, R, p0, y1, MAT.porcelain, 0.55);
  shapes.push(neck, st, plate);
  cylinder(decor, x, z, foot * 0.55, f1, n1, MAT.porcelain, MAT.porcelain, 32, false, stem);
  cylinder(decor, x, z, stem, n1, p0 - 0.8, MAT.porcelain, MAT.porcelain, 24, false);
  // (a collar under the plate, flaring out to it)
  cylinder(decor, x, z, stem, p0 - 0.8, p0, MAT.porcelain, MAT.porcelain, 32, false, R * 0.42);
  return { shapes, decor, y: y1, r: R };
}
/** A board laid across two of something: celadon jars, tea tins, or mugs upturned. */
function trestle(x: number, z: number, y0: number, y1: number, need: number, yaw: number, coin: Coin): Held {
  const T = 1.4, span = need + 3 + coin(4) * 4, hz = need * 0.75 + 1;
  const shapes: Shape[] = [];
  const ux = Math.cos(yaw), uz = -Math.sin(yaw);
  const what = coin(5) < 0.45 ? MAT.jar : coin(5) < 0.8 ? MAT.tin : MAT.pot;
  const pr = what === MAT.pot ? 4 : what === MAT.jar ? 4.5 : 4 + coin(6);
  for (const s of [-1, 1]) shapes.push(cyl(x + ux * span * s, z + uz * span * s, pr, y0, y1 - T, what));
  shapes.push(box([x, y1 - T / 2, z], [span + pr + 1.5, T / 2, hz], yaw, MAT.board, 0.85));
  return { shapes, decor: [], y: y1, r: Math.min(span, hz), box: [span + pr, hz] };
}
/** A wooden crate turned over: solid where it's met, drawn as slats on corner posts, its lid boards across the top. */
function crate(x: number, z: number, y0: number, y1: number, need: number, yaw: number, coin: Coin): Held {
  const hx = need + 2 + coin(7) * 2, hz = need + 1 + coin(8) * 2, h = (y1 - y0) / 2;
  const body = box([x, y0 + h, z], [hx, h, hz], yaw, MAT.board, 0.85);
  body.ghost = true;
  const decor: number[] = [];
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const W = (lx: number, ly: number, lz: number): V3 => [x + cy * lx + sy * lz, ly, z - sy * lx + cy * lz];
  // (its posts, at the corners)
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) drawBox(decor, W(sx * (hx - 0.8), y0 + h, sz * (hz - 0.8)), [0.8, h, 0.8], yaw, MAT.board);
  // (its slats, round its sides, with gaps between: dark inside)
  drawBox(decor, [x, y0 + h, z], [hx - 0.5, h - 0.2, hz - 0.5], yaw, MAT.legs);
  const n = Math.max(2, Math.round((y1 - y0 - 1.2) / 3.2)), step = (y1 - y0 - 1.2) / n;
  for (let i = 0; i < n; i++) {
    const cyy = y0 + step * (i + 0.5);
    for (const sz of [-1, 1]) drawBox(decor, W(0, cyy, sz * (hz - 0.25)), [hx - 0.2, step * 0.36, 0.3], yaw, MAT.board);
    for (const sx of [-1, 1]) drawBox(decor, W(sx * (hx - 0.25), cyy, 0), [0.3, step * 0.36, hz - 0.2], yaw, MAT.board);
  }
  // (its lid: boards across, a hair apart)
  const nb = Math.max(3, Math.round(hz / 2.6)), bw = (2 * hz) / nb;
  for (let i = 0; i < nb; i++) drawBox(decor, W(0, y1 - 0.6, -hz + bw * (i + 0.5)), [hx + 0.3, 0.6, bw / 2 - 0.12], yaw, MAT.board);
  return { shapes: [body], decor, y: y1, r: Math.min(hx, hz), box: [hx, hz] };
}
/** Cookbooks, stacked a little anyhow: each its own size, turned a little, set off a little. */
function books(x: number, z: number, y0: number, y1: number, need: number, yaw: number, coin: Coin): Held {
  const n = Math.max(1, Math.round((y1 - y0) / 4.2)), t = (y1 - y0) / n;
  const shapes: Shape[] = [];
  let last: Shape | null = null;
  for (let i = 0; i < n; i++) {
    const top = i === n - 1;
    // (the top one wide enough for what's on it; those under it bigger or smaller, the stack untidy)
    const hx = top ? need + 1 + coin(10 + i) * 1.5 : need + coin(10 + i) * 4, hz = top ? need * 0.8 + 1 : need * 0.75 + coin(20 + i) * 3;
    const dx = top ? 0 : (coin(30 + i) - 0.5) * 3, dz = top ? 0 : (coin(40 + i) - 0.5) * 2.5;
    last = box([x + dx, y0 + t * (i + 0.5), z + dz], [hx, t / 2, hz], yaw + (coin(50 + i) - 0.5) * (top ? 0.15 : 0.5), MAT.book, 0.8);
    shapes.push(last);
  }
  return { shapes, decor: [], y: y1, r: Math.min(last!.h[0], last!.h[2]), box: [last!.h[0], last!.h[2]] };
}
/** A bowl upturned: its foot ring on top the seat, its shoulders falling away round it to its rim. Met as drawn: its shoulders are a sheet. */
function bowl(x: number, z: number, y0: number, y1: number, need: number, coin: Coin): Held {
  const rf = Math.max(4.5, need * 0.62), Rb = rf * (1.85 + coin(9) * 0.3), H = y1 - y0, fh = 1;
  const mat = coin(11) < 0.5 ? MAT.porcelain : MAT.enamel;
  const shell = surface((u, v) => {
    const a = u * Math.PI * 2, r = rf + (Rb - rf) * Math.cos(v * Math.PI * 0.5) ** 0.8, y = y0 + (H - fh) * Math.sin(v * Math.PI * 0.5);
    return [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
  }, 40, 8, 0.6, mat, 0.6, [0, 1, 0], (u, v) => [u * 6, v]);
  const footRing = cyl(x, z, rf, y1 - fh, y1, mat, 0.6);
  const decor = [...shell.verts];
  // (its rim, rolled, where it sits)
  cylinder(decor, x, z, Rb + 0.3, y0, y0 + 0.8, mat, mat, 48, false);
  return { shapes: [...shell.shapes, footRing], decor, y: y1, r: rf };
}
/** A wire cooling rack on two tins: wires across, a frame round it, on little feet. What's met is the wires. */
function rack(x: number, z: number, y0: number, y1: number, need: number, yaw: number, coin: Coin): Held {
  const hx = need + 2.5 + coin(12) * 2, hz = need + 0.5 + coin(13) * 1.5, wr = 0.22, gap = 1.7;
  const shapes: Shape[] = [];
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const W = (lx: number, ly: number, lz: number): V3 => [x + cy * lx + sy * lz, ly, z - sy * lx + cy * lz];
  const ry = y1 - wr, feet = 1.6;
  // (what it's on: two tins under its ends; or, if it's low enough, its own feet)
  if (y1 - y0 > feet + 1) for (const s of [-1, 1]) { const p = W(s * (hx - 4), 0, 0); shapes.push(cyl(p[0], p[2], 3.6 + coin(14) * 0.8, y0, ry - wr - feet, MAT.tin)); }
  const fy = ry - wr - feet;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) shapes.push(cap(W(sx * (hx - 1), fy, sz * (hz - 1)), W(sx * (hx - 1), ry - wr, sz * (hz - 1)), 0.25, MAT.steel, 0.5));
  // (wires along it, close together; two under them, across, to hold them)
  for (let lz = -hz + 0.6; lz <= hz - 0.6 + 1e-6; lz += gap) shapes.push(cap(W(-hx + 0.4, ry, lz), W(hx - 0.4, ry, lz), wr, MAT.steel, 0.55));
  for (const s of [-1, 1]) shapes.push(cap(W(s * (hx - 3), ry - wr * 2, -hz), W(s * (hx - 3), ry - wr * 2, hz), wr, MAT.steel, 0.55));
  // (the frame round it)
  const corners: V3[] = [W(-hx, ry, -hz), W(hx, ry, -hz), W(hx, ry, hz), W(-hx, ry, hz)];
  for (let i = 0; i < 4; i++) shapes.push(cap(corners[i], corners[(i + 1) % 4], 0.32, MAT.steel, 0.55));
  return { shapes, decor: [], y: y1, r: Math.min(hx, hz) - 1, box: [hx - 1, hz - 1] };
}
/** Tea tins and a celadon jar or two under a board, as the old towers had. */
function tins(x: number, z: number, y0: number, y1: number, need: number, coin: Coin): Held {
  const shapes: Shape[] = [];
  const bt = 2;
  shapes.push(box([x, y1 - bt / 2, z], [need + 1.2, bt / 2, need + 1.2], 0, MAT.board, 0.85));
  let y = y0, i = 0;
  while (y1 - bt - y > 0.5) {
    let h = 9 + 7 * coin(0x40 + i);
    if (y1 - bt - y - h < 6) h = y1 - bt - y;
    const jar = coin(0x60 + i) < 0.3;
    shapes.push(cyl(x, z, Math.max(3.5, need * (jar ? 0.62 : 0.55 + 0.35 * coin(0x80 + i))), y, y + h, jar ? MAT.jar : MAT.tin));
    y += h; i++;
  }
  return { shapes, decor: [], y: y1, r: need + 1 };
}

/** How far out a kind of top reaches from its middle, for what it stands on to hold it. */
export function footprint(top: Top, rad: number): number {
  switch (top) {
    case 'pudding': return 10.5;
    case 'butter': return 10;
    case 'lid': return rad + 1.5;
    case 'tin': return rad + 0.5;
    default: return rad;
  }
}
/** what each kind of top can stand on (a honey jar, a board on its jars, keep their own) */
export const HOLDS: Partial<Record<Top, Holder[]>> = {
  steamer: ['stool', 'crate', 'books', 'bench', 'rack', 'bowl', 'tins'],
  goal: ['stool', 'crate', 'books', 'pedestal', 'bench'],
  plate: ['stool', 'crate', 'books', 'bowl', 'trestle', 'bench', 'pedestal'],
  pudding: ['pedestal', 'stool', 'crate', 'books', 'bowl', 'rack', 'trestle'],
  susan: ['crate', 'books', 'stool', 'pedestal', 'bench'],
  tin: ['stool', 'books', 'crate', 'bowl', 'bench'],
  butter: ['crate', 'books', 'trestle', 'bench', 'rack'],
  pan: ['crate', 'books', 'trestle', 'bench', 'stool'],
  lid: ['crate', 'books', 'stool', 'trestle', 'bench', 'tins'],
};
/**
 * A top on a support: a kind of top, its top surface at `at`, stood on a support of a kind (on whatever
 * it's on, y0 high), set off its middle by `off` (along yaw + π/2, as far as the seat leaves room), the
 * whole made into one stop: what's met, what a landing counts on (the top, not its support), and what's
 * drawn besides. Null if the support can't be made to hold it there.
 */
export function assemble(top: Top, kind: Holder, at: V3, rad: number, yaw: number, r: Rand, y0 = 0, off = 0): { tower: Tower; decor: number[] } | null {
  const [x, y, z] = at;
  const coin = (salt: number) => (hash(Math.round(x * 10), Math.round(z * 10), salt) % 1000) / 1000;
  const need = footprint(top, rad);
  // (the seat where the top's own height puts it; lower if the support can't be so short, a tin under the top making up the rest)
  let seat = y - ownHeight(top, rad);
  if (seat - y0 < SPAN[kind][0]) return null;
  seat = Math.round(seat * 10) / 10;
  // (set off: a seat wider than what's on it, what's on it to one side, the rest of the seat a ledge to land on, lower)
  const spare = off ? Math.min(Math.abs(off), 6) : 0;
  const held = holder(kind, x, z, y0, seat, need + spare, yaw, coin);
  const sx = Math.cos(yaw + Math.PI / 2) * spare * Math.sign(off), sz = -Math.sin(yaw + Math.PI / 2) * spare * Math.sign(off);
  const tw = tower(top, [x + sx, y, z + sz], rad, yaw, r, held.y);
  tw.land ??= [...tw.shapes];
  tw.shapes = [...held.shapes, ...tw.shapes];
  return { tower: tw, decor: held.decor };
}
/**
 * A tiered cake stand: plates on a thin rod, the lower broader, on a foot. The upper is the place to land;
 * the lower, under it, catches what comes short or slides off (a ledge, not a stop: from under the upper
 * plate, nothing flicks up past it). Porcelain; the upper sticky with hundreds and thousands now and then.
 */
export function tiered(x: number, z: number, y0: number, yHigh: number, coin: Coin): { stop: Tower; decor: number[] } {
  const R1 = 13 + coin(0x71) * 2, R2 = 8.5 + coin(0x72) * 1.5, T = 1.2, yLow = Math.max(y0 + 5, yHigh - 10 - coin(0x74) * 3);
  const foot = cyl(x, z, 5.5, y0, y0 + 1, MAT.porcelain, 0.5);
  const lower = cyl(x, z, R1, yLow - T, yLow, MAT.porcelain, 0.55), upper = cyl(x, z, R2, yHigh - T, yHigh, MAT.porcelain, 0.55);
  // (the rod, from the foot through the lower plate up to the upper: thin, and met)
  const rod1 = cyl(x, z, 0.8, y0 + 1, yLow - T, MAT.gold, 0.5), rod2 = cyl(x, z, 0.8, yLow, yHigh - T, MAT.gold, 0.5);
  if (coin(0x73) < 0.5) upper.dust = DUST.sprinkles;
  const decor: number[] = [];
  // (each plate's collar where the rod meets it)
  for (const yy of [yLow - T, yHigh - T]) cylinder(decor, x, z, 0.8, yy - 0.8, yy, MAT.gold, MAT.gold, 16, false, 1.6);
  return { stop: { top: 'stand', at: [x, yHigh, z], r: R2 - 1.5, yaw: 0, shapes: [foot, rod1, lower, rod2, upper], land: [upper] }, decor };
}
