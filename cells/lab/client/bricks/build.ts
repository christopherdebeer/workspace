/**
 * Bricks: the rules, apart from the drawing (so they can be tested on their own).
 *
 * A baseplate N studs a side. The world is a grid of cells one stud across and one plate high
 * (a brick is three plates, as the real ones are: 9.6 mm to 3.2 mm, on an 8 mm stud). A brick
 * goes where it fits and connects as the real ones do: on the baseplate, on the studs of
 * something below it, or under something above it. Nothing clears; you build.
 */
import { hash, seeded } from '../kit/rng';

export type C3 = [number, number, number];

/** studs a side */
export const N = 24;
/** plates high */
export const H = 72;
/** a plate's height, in studs */
export const PLATE = 0.4;

/** The sizes in the tray: studs across and along. */
export const SIZES: Array<[number, number]> = [
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 6], [2, 2], [2, 3], [2, 4], [2, 6],
];

/** The colours in the tray (the classic ones), and their names. */
export const COLOURS: Array<{ name: string; rgb: C3 }> = [
  { name: 'white', rgb: [0.93, 0.93, 0.9] },
  { name: 'light grey', rgb: [0.62, 0.64, 0.64] },
  { name: 'dark grey', rgb: [0.36, 0.38, 0.39] },
  { name: 'black', rgb: [0.12, 0.12, 0.13] },
  { name: 'red', rgb: [0.72, 0.09, 0.08] },
  { name: 'orange', rgb: [0.93, 0.45, 0.1] },
  { name: 'yellow', rgb: [0.97, 0.79, 0.06] },
  { name: 'tan', rgb: [0.85, 0.76, 0.55] },
  { name: 'reddish brown', rgb: [0.41, 0.2, 0.11] },
  { name: 'lime', rgb: [0.62, 0.77, 0.1] },
  { name: 'green', rgb: [0.0, 0.5, 0.24] },
  { name: 'azure', rgb: [0.32, 0.68, 0.87] },
  { name: 'blue', rgb: [0.05, 0.32, 0.68] },
  { name: 'dark blue', rgb: [0.05, 0.2, 0.36] },
];

export interface Brick {
  /** studs across (x) and along (z), after its turn */
  w: number;
  d: number;
  /** plates high: 3 a brick, 1 a plate */
  h: number;
  colour: number;
  /** its least corner, in cells */
  at: C3;
}

export class World {
  /** 0 empty, else the index of the brick there + 1 */
  cells = new Int32Array(N * H * N);
  bricks: Array<Brick | null> = [];
  idx(x: number, y: number, z: number) {
    return (y * N + z) * N + x;
  }
  inside(x: number, y: number, z: number) {
    return x >= 0 && x < N && z >= 0 && z < N && y >= 0 && y < H;
  }
  at(x: number, y: number, z: number) {
    return this.inside(x, y, z) ? this.cells[this.idx(x, y, z)] : 0;
  }
  /** Whether a brick of this size fits with its corner at p. */
  fits(w: number, d: number, h: number, p: C3): boolean {
    for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      const q: C3 = [p[0] + x, p[1] + y, p[2] + z];
      if (!this.inside(...q) || this.at(...q)) return false;
    }
    return true;
  }
  /** Whether it connects: on the baseplate, on the studs of something below, or under something. */
  connects(w: number, d: number, h: number, p: C3): boolean {
    if (p[1] === 0) return true;
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      if (this.at(p[0] + x, p[1] - 1, p[2] + z)) return true;
      if (this.at(p[0] + x, p[1] + h, p[2] + z)) return true;
    }
    return false;
  }
  add(b: Brick): number {
    const id = this.bricks.length;
    this.bricks.push(b);
    this.mark(b, id + 1);
    return id;
  }
  remove(id: number): Brick | null {
    const b = this.bricks[id];
    if (!b) return null;
    this.mark(b, 0);
    this.bricks[id] = null;
    return b;
  }
  /** Put a removed brick back where it was (undo). */
  restore(id: number, b: Brick) {
    this.bricks[id] = b;
    this.mark(b, id + 1);
  }
  private mark(b: Brick, v: number) {
    for (let y = 0; y < b.h; y++) for (let z = 0; z < b.d; z++) for (let x = 0; x < b.w; x++) {
      this.cells[this.idx(b.at[0] + x, b.at[1] + y, b.at[2] + z)] = v;
    }
  }
  count(): number {
    return this.bricks.filter(Boolean).length;
  }
  height(): number {
    for (let y = H - 1; y >= 0; y--) for (let i = 0; i < N * N; i++) if (this.cells[y * N * N + i]) return y + 1;
    return 0;
  }
  /** Whether the top of the cell at (x, y, z) shows its stud (nothing sits on it). */
  studShows(x: number, y: number, z: number) {
    return !this.at(x, y + 1, z);
  }
  /** The live bricks, compacted (to keep). */
  list(): Brick[] {
    return this.bricks.filter((b): b is Brick => !!b);
  }
}

export interface Hit {
  /** the empty cell the ray reached, against a face */
  cell: C3;
  /** the face it came through */
  normal: C3;
  /** the brick it met (-1: the baseplate) */
  brick: number;
}

/**
 * Where a ray (in the world: studs across, studs up) meets what's built: the empty cell in front
 * of the first brick it hits, or the baseplate.
 */
export function raycast(world: World, o: C3, d: C3): Hit | null {
  // into cell space: a cell is one stud across, one plate high
  const O: C3 = [o[0], o[1] / PLATE, o[2]];
  const D: C3 = [d[0], d[1] / PLATE, d[2]];
  let t0 = 0;
  let t1 = 1e9;
  const hi = [N, H, N];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(D[a]) < 1e-9) {
      if (O[a] < 0 || O[a] > hi[a]) return null;
      continue;
    }
    let ta = (0 - O[a]) / D[a];
    let tb = (hi[a] - O[a]) / D[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  if (t0 > t1) return null;
  const p = [0, 1, 2].map((a) => O[a] + D[a] * (t0 + 1e-6));
  const cell = p.map((v, a) => Math.max(0, Math.min(Math.floor(v), hi[a] - 1))) as C3;
  const step = D.map((v) => (v > 0 ? 1 : -1));
  const tMax = [0, 1, 2].map((a) => (Math.abs(D[a]) < 1e-9 ? 1e9 : (cell[a] + (D[a] > 0 ? 1 : 0) - O[a]) / D[a]));
  const tDelta = D.map((v) => (Math.abs(v) < 1e-9 ? 1e9 : Math.abs(1 / v)));
  let prev: C3 | null = null;
  let normal: C3 = [0, 1, 0];
  for (let i = 0; i < 400; i++) {
    if (!world.inside(...cell)) {
      if (cell[1] < 0 && prev) return { cell: prev, normal: [0, 1, 0], brick: -1 };
      return null;
    }
    const v = world.at(...cell);
    if (v) return prev ? { cell: prev, normal, brick: v - 1 } : null;
    prev = [...cell] as C3;
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    cell[a] += step[a];
    tMax[a] += tDelta[a];
    normal = [0, 0, 0];
    normal[a] = -step[a];
  }
  return null;
}

/**
 * Where a w×d brick, h plates high, goes for a hit: on top of what it met, under it, or beside
 * it at the same level — the cell under the finger at its `anchor` stud (by default, its middle) — and,
 * if that doesn't fit or connect, the nearest place that does.
 */
export function placeFor(world: World, w: number, d: number, h: number, hit: Hit, anchor?: [number, number]): C3 | null {
  const n = hit.normal;
  const c = hit.cell;
  // which of its studs is under the finger: the one it was taken by, or its middle — or (beside
  // a brick) its near edge
  let ox = anchor ? Math.min(w - 1, Math.max(0, anchor[0])) : Math.floor((w - 1) / 2);
  let oz = anchor ? Math.min(d - 1, Math.max(0, anchor[1])) : Math.floor((d - 1) / 2);
  if (n[0] > 0) ox = 0;
  if (n[0] < 0) ox = w - 1;
  if (n[2] > 0) oz = 0;
  if (n[2] < 0) oz = d - 1;
  let y = c[1];
  if (n[1] < 0) y = c[1] - h + 1;
  else if (n[1] === 0 && hit.brick >= 0) y = world.bricks[hit.brick]?.at[1] ?? c[1];
  const base: C3 = [c[0] - ox, y, c[2] - oz];
  const tries: C3[] = [];
  const lateral: Array<[number, number]> = [[0, 0]];
  for (let r = 1; r <= 2; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) === r) lateral.push([dx, dz]);
  }
  // (beside a brick, never into it: no sliding back along the normal)
  const ok = ([dx, dz]: [number, number]) => !(n[0] && Math.sign(dx) === -n[0]) && !(n[2] && Math.sign(dz) === -n[2]);
  const vertical = n[1] < 0 ? [0, -1, -2, -3] : [0, 1, 2, 3, -1, -2, -3];
  for (const dy of vertical) for (const l of lateral) if (ok(l)) tries.push([l[0], dy, l[1]]);
  for (const t of tries) {
    const p: C3 = [base[0] + t[0], base[1] + t[1], base[2] + t[2]];
    if (world.fits(w, d, h, p) && world.connects(w, d, h, p)) return p;
  }
  return null;
}

/** Drop a brick in a column: the lowest place it rests on what's below (the quiet builder). */
export function restIn(world: World, w: number, d: number, h: number, x: number, z: number): C3 | null {
  let top = 0;
  for (let zz = 0; zz < d; zz++) for (let xx = 0; xx < w; xx++) {
    for (let y = H - 1; y >= 0; y--) {
      if (world.at(x + xx, y, z + zz)) {
        top = Math.max(top, y + 1);
        break;
      }
    }
  }
  const p: C3 = [x, top, z];
  return world.fits(w, d, h, p) ? p : null;
}

/**
 * The quiet builder (the lab's preview): a little town from a seed — a few buildings on the
 * baseplate, each a stack of courses with its joints staggered as a builder would, in a colour
 * or two, with a roof plate and now and then a tree.
 */
export function* town(seed: number): Generator<Brick> {
  const r = seeded(hash(seed, 0xb1c));
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const walls = [0, 4, 6, 7, 11, 12, 1, 5];
  const roofs = [3, 2, 8, 13, 4];
  const lots: Array<[number, number, number, number]> = [];
  for (let tries = 0; tries < 60 && lots.length < 7; tries++) {
    const w = 4 + Math.floor(r() * 4);
    const d = 4 + Math.floor(r() * 4);
    const x = 1 + Math.floor(r() * (N - w - 2));
    const z = 1 + Math.floor(r() * (N - d - 2));
    if (lots.some(([a, b, c, e]) => x < a + c + 1 && a < x + w + 1 && z < b + e + 1 && b < z + d + 1)) continue;
    lots.push([x, z, w, d]);
  }
  for (const [x0, z0, w, d] of lots) {
    const wall = pick(walls);
    const trim = r() < 0.4 ? pick(walls) : wall;
    const courses = 2 + Math.floor(r() * 5);
    for (let k = 0; k < courses; k++) {
      // a ring of bricks round the lot, its joints offset course to course
      const y = k * 3;
      const colour = k === courses - 1 ? trim : wall;
      const ring: Array<[number, number, number, number]> = [];
      const run = (x: number, z: number, len: number, alongX: boolean) => {
        // (odd courses start with a short brick, so no joint sits over the one below)
        const pieces: number[] = k % 2 && len > 1 ? [1] : [];
        let left = len - pieces.length;
        while (left > 0) {
          const s = Math.min(left, pick([2, 3, 4]));
          pieces.push(s);
          left -= s;
        }
        let o = 0;
        for (const s of pieces) {
          ring.push(alongX ? [x + o, z, s, 1] : [x, z + o, 1, s]);
          o += s;
        }
      };
      run(x0, z0, w, true);
      run(x0, z0 + d - 1, w, true);
      run(x0, z0 + 1, d - 2, false);
      run(x0 + w - 1, z0 + 1, d - 2, false);
      for (const [x, z, bw, bd] of ring) yield { w: bw, d: bd, h: 3, colour, at: [x, y, z] };
    }
    // a roof: plates across the top
    const roof = pick(roofs);
    for (let z = z0; z < z0 + d; z += 2) {
      for (let x = x0; x < x0 + w; x += 4) {
        yield { w: Math.min(4, x0 + w - x), d: Math.min(2, z0 + d - z), h: 1, colour: roof, at: [x, courses * 3, z] };
      }
    }
  }
  // trees: a brown trunk, a green crown
  for (let t = 0; t < 6; t++) {
    const x = 1 + Math.floor(r() * (N - 3));
    const z = 1 + Math.floor(r() * (N - 3));
    yield { w: 1, d: 1, h: 3, colour: 8, at: [x, 0, z] };
    yield { w: 1, d: 1, h: 3, colour: 8, at: [x, 3, z] };
    yield { w: 2, d: 2, h: 3, colour: r() < 0.5 ? 10 : 9, at: [x - (r() < 0.5 ? 1 : 0), 6, z - (r() < 0.5 ? 1 : 0)] };
  }
}

/** A brick before it's set: its size and colour, not yet anywhere. */
export interface Spec {
  w: number;
  d: number;
  h: number;
  colour: number;
}

/** The bag's colour schemes: a few that sit together, so a build looks like one place. */
export const SCHEMES: Array<{ name: string; colours: number[]; base: C3 }> = [
  // (and a baseplate each, one the colours stand out on)
  { name: 'harbour', colours: [0, 11, 12, 13, 1], base: [0.8, 0.79, 0.74] },
  { name: 'village', colours: [4, 7, 0, 8, 10], base: [0.25, 0.52, 0.27] },
  { name: 'garden', colours: [10, 9, 6, 7, 0], base: [0.82, 0.74, 0.58] },
  { name: 'stone', colours: [1, 2, 7, 0, 3], base: [0.25, 0.52, 0.27] },
  { name: 'sunset', colours: [5, 6, 4, 7, 8], base: [0.62, 0.64, 0.64] },
];

/** How often each size comes (by SIZES index): the everyday bricks most. */
const SIZE_WEIGHT = [0.6, 1.3, 0.8, 1.1, 0.5, 1.2, 0.8, 1.4, 0.5];

/**
 * The bag: bricks one at a time from a seed, Tetris-fashion — you don't choose, you place what
 * comes. A plate now and then; colours from the bag's scheme, rarely the same twice running.
 */
export class Bag {
  private r: () => number;
  private last = -1;
  readonly scheme: (typeof SCHEMES)[number];
  constructor(public seed: number, public drawn = 0) {
    this.r = seeded(hash(seed, 0xba9));
    this.scheme = SCHEMES[hash(seed, 0x5c4) % SCHEMES.length];
    const n = drawn;
    this.drawn = 0;
    for (let i = 0; i < n; i++) this.next();
  }
  next(): Spec {
    this.drawn++;
    const total = SIZE_WEIGHT.reduce((s, x) => s + x, 0);
    let t = this.r() * total;
    let i = 0;
    while (i < SIZES.length - 1 && (t -= SIZE_WEIGHT[i]) > 0) i++;
    const [a, b] = SIZES[i];
    const plate = this.r() < 0.22;
    const cs = this.scheme.colours;
    let c = Math.floor(this.r() * cs.length);
    if (c === this.last && this.r() < 0.8) c = (c + 1) % cs.length;
    this.last = c;
    const turned = this.r() < 0.5;
    return { w: turned ? b : a, d: turned ? a : b, h: plate ? 1 : 3, colour: cs[c] };
  }
}
