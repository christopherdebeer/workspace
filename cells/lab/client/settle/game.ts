/**
 * Settle: the rules, apart from the drawing (so they can be tested on their own).
 *
 * A square bed, N cells a side, open above to H. Pieces (small polycubes) arrive one at a time
 * from a seeded bag; nothing falls and nothing hurries. A piece goes anywhere it fits, against any
 * face — on the bed, on top of what's there, out from its side. A layer filled edge to edge
 * dissolves, and whatever was above it settles down one.
 */
import { hash, seeded, type Rand } from '../kit/rng';

export type C3 = [number, number, number];

export const N = 5;
export const H = 14;

/** The pieces: their cubes, and how often they come (calmer ones more often). */
export const SHAPES: Array<{ name: string; cubes: C3[]; weight: number }> = [
  { name: 'one', cubes: [[0, 0, 0]], weight: 0.5 },
  { name: 'two', cubes: [[0, 0, 0], [1, 0, 0]], weight: 1.2 },
  { name: 'three', cubes: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], weight: 1.2 },
  { name: 'corner', cubes: [[0, 0, 0], [1, 0, 0], [0, 0, 1]], weight: 1.4 },
  { name: 'four', cubes: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], weight: 0.7 },
  { name: 'square', cubes: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]], weight: 1 },
  { name: 'tee', cubes: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 0, 1]], weight: 1 },
  { name: 'ell', cubes: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 1]], weight: 1 },
  { name: 'step', cubes: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [2, 0, 1]], weight: 0.8 },
  { name: 'branch', cubes: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], weight: 0.5 },
  { name: 'twist', cubes: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 1]], weight: 0.5 },
  { name: 'twist′', cubes: [[1, 0, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]], weight: 0.5 },
];

export const COLOURS = 6;

export interface Piece {
  shape: number;
  colour: number;
  /** its cubes, in its current turn, shifted so the least of each axis is 0 */
  cubes: C3[];
}

/** Shift cubes so each axis starts at 0, in a stable order. */
export function norm(cubes: C3[]): C3[] {
  const m = [0, 1, 2].map((a) => Math.min(...cubes.map((c) => c[a])));
  return cubes
    .map((c) => [c[0] - m[0], c[1] - m[1], c[2] - m[2]] as C3)
    .sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
}

/** A quarter turn about an axis (0 x, 1 y, 2 z), `dir` ±1. */
export function rotate(cubes: C3[], axis: number, dir = 1): C3[] {
  return norm(
    cubes.map(([x, y, z]) => {
      if (axis === 1) return dir > 0 ? [-z, y, x] : [z, y, -x];
      if (axis === 0) return dir > 0 ? [x, -z, y] : [x, z, -y];
      return dir > 0 ? [-y, x, z] : [y, -x, z];
    }),
  );
}

const key = (cubes: C3[]) => norm(cubes).map((c) => c.join(',')).join(';');

/** Every distinct way a piece can lie (up to 24). */
export function orientations(cubes: C3[]): C3[][] {
  const seen = new Map<string, C3[]>();
  let a = norm(cubes);
  for (let i = 0; i < 4; i++) {
    let b = a;
    for (let j = 0; j < 4; j++) {
      let c = b;
      for (let k = 0; k < 4; k++) {
        seen.set(key(c), c);
        c = rotate(c, 2);
      }
      b = rotate(b, 1);
    }
    a = rotate(a, 0);
  }
  return [...seen.values()];
}

export class Bed {
  /** 0 empty, else colour + 1 */
  cells = new Uint8Array(N * H * N);
  idx(x: number, y: number, z: number) {
    return (y * N + z) * N + x;
  }
  inside(x: number, y: number, z: number) {
    return x >= 0 && x < N && z >= 0 && z < N && y >= 0 && y < H;
  }
  at(x: number, y: number, z: number) {
    return this.inside(x, y, z) ? this.cells[this.idx(x, y, z)] : 0;
  }
  set(x: number, y: number, z: number, v: number) {
    this.cells[this.idx(x, y, z)] = v;
  }
  /** Whether a piece fits with its origin at `p`. */
  fits(cubes: C3[], p: C3): boolean {
    for (const c of cubes) {
      const x = c[0] + p[0];
      const y = c[1] + p[1];
      const z = c[2] + p[2];
      if (!this.inside(x, y, z) || this.at(x, y, z)) return false;
    }
    return true;
  }
  /** Whether it touches the bed or something already set (a piece can't hang in the air). */
  touches(cubes: C3[], p: C3): boolean {
    for (const c of cubes) {
      const x = c[0] + p[0];
      const y = c[1] + p[1];
      const z = c[2] + p[2];
      if (y === 0) return true;
      for (const [dx, dy, dz] of FACES) if (this.at(x + dx, y + dy, z + dz)) return true;
    }
    return false;
  }
  place(piece: Piece, p: C3) {
    for (const c of piece.cubes) this.set(c[0] + p[0], c[1] + p[1], c[2] + p[2], piece.colour + 1);
  }
  /** The layers now full, lowest first. */
  full(): number[] {
    const out: number[] = [];
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let i = 0; i < N * N; i++) if (this.cells[y * N * N + i]) n++;
      if (n === N * N) out.push(y);
    }
    return out;
  }
  /** Take a layer out; what was above comes down one. */
  remove(y: number) {
    this.cells.copyWithin(y * N * N, (y + 1) * N * N);
    this.cells.fill(0, (H - 1) * N * N);
  }
  height(): number {
    for (let y = H - 1; y >= 0; y--) for (let i = 0; i < N * N; i++) if (this.cells[y * N * N + i]) return y + 1;
    return 0;
  }
  count(): number {
    let n = 0;
    for (const v of this.cells) if (v) n++;
    return n;
  }
}

export const FACES: C3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** The bag: pieces from a seed, each one a little turned, colours not repeating. */
export class Bag {
  private r: Rand;
  private last = -1;
  constructor(seed: number, public drawn = 0) {
    this.r = seeded(hash(seed, 0x5e7));
    for (let i = 0; i < drawn; i++) this.make();
  }
  private make(): Piece {
    const total = SHAPES.reduce((s, x) => s + x.weight, 0);
    let t = this.r() * total;
    let shape = 0;
    while (shape < SHAPES.length - 1 && (t -= SHAPES[shape].weight) > 0) shape++;
    let colour = Math.floor(this.r() * COLOURS);
    if (colour === this.last) colour = (colour + 1 + Math.floor(this.r() * (COLOURS - 1))) % COLOURS;
    this.last = colour;
    let cubes = norm(SHAPES[shape].cubes);
    const turns = Math.floor(this.r() * 4);
    for (let i = 0; i < turns; i++) cubes = rotate(cubes, 1);
    return { shape, colour, cubes };
  }
  next(): Piece {
    this.drawn++;
    return this.make();
  }
}

export interface Hit {
  /** the empty cell the ray reached (against a face) */
  cell: C3;
  /** the face it came through: which way is "out" from what it rests on */
  normal: C3;
}

/**
 * Where a ray meets the bed: the empty cell in front of the first filled cube it hits, or the
 * bed's own floor. Cells are unit cubes from (x, y, z) to (x+1, y+1, z+1).
 */
export function raycast(bed: Bed, o: C3, d: C3): Hit | null {
  // the volume's box, entered
  let t0 = 0;
  let t1 = 1e9;
  const lo = [0, 0, 0];
  const hi = [N, H, N];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return null;
      continue;
    }
    let ta = (lo[a] - o[a]) / d[a];
    let tb = (hi[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  if (t0 > t1) return null;
  const p = [0, 1, 2].map((a) => o[a] + d[a] * (t0 + 1e-6));
  const cell = p.map((v, a) => Math.min(Math.floor(v), hi[a] - 1)) as C3;
  const step = d.map((v) => (v > 0 ? 1 : -1));
  const tMax = [0, 1, 2].map((a) => (Math.abs(d[a]) < 1e-9 ? 1e9 : (cell[a] + (d[a] > 0 ? 1 : 0) - o[a]) / d[a]));
  const tDelta = d.map((v) => (Math.abs(v) < 1e-9 ? 1e9 : Math.abs(1 / v)));
  let prev: C3 | null = null;
  let normal: C3 = [0, 1, 0];
  for (let i = 0; i < 64; i++) {
    if (!bed.inside(...cell)) {
      // left the volume: through the floor means it rests on the bed
      if (cell[1] < 0 && prev) return { cell: prev, normal: [0, 1, 0] };
      return null;
    }
    if (bed.at(...cell)) return prev ? { cell: prev, normal } : null;
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
 * Where a piece goes for a hit: the cube nearest the face it's put against lands in the hit
 * cell; if that doesn't fit, it's eased out along the face's normal, then a cell to either side.
 */
export function placeFor(bed: Bed, cubes: C3[], hit: Hit): C3 | null {
  const n = hit.normal;
  const dot = (c: C3) => c[0] * n[0] + c[1] * n[1] + c[2] * n[2];
  const lowest = Math.min(...cubes.map(dot));
  const centre = [0, 1, 2].map((a) => cubes.reduce((s, c) => s + c[a], 0) / cubes.length);
  // (of those against the face, the one nearest the piece's middle: it sits under the finger)
  const contact = cubes
    .filter((c) => dot(c) === lowest)
    .sort((a, b) => dist(a, centre) - dist(b, centre))[0];
  const base: C3 = [hit.cell[0] - contact[0], hit.cell[1] - contact[1], hit.cell[2] - contact[2]];
  const tries: C3[] = [[0, 0, 0]];
  for (let k = 1; k <= 3; k++) tries.push([n[0] * k, n[1] * k, n[2] * k]);
  for (const s of [-1, 1, -2, 2]) {
    for (let a = 0; a < 3; a++) {
      if (n[a] !== 0) continue;
      const t: C3 = [0, 0, 0];
      t[a] = s;
      tries.push(t);
    }
  }
  for (const t of tries) {
    const p: C3 = [base[0] + t[0], base[1] + t[1], base[2] + t[2]];
    if (bed.fits(cubes, p) && bed.touches(cubes, p)) return p;
  }
  return null;
}

function dist(c: C3, m: number[]) {
  return Math.hypot(c[0] - m[0], c[1] - m[1], c[2] - m[2]);
}

/**
 * A quiet player (the lab's preview, and a test): of every way the piece can lie and every place
 * it can rest, the one that leaves the bed lowest, fullest and with fewest hollows.
 */
export function choose(bed: Bed, cubes: C3[]): { cubes: C3[]; at: C3 } | null {
  let best: { cubes: C3[]; at: C3; score: number } | null = null;
  for (const o of orientations(cubes)) {
    for (let x = -3; x < N; x++) {
      for (let z = -3; z < N; z++) {
        // rest it as low as it will go in this column
        let at: C3 | null = null;
        for (let y = 0; y < H; y++) {
          const p: C3 = [x, y, z];
          if (bed.fits(o, p) && rests(bed, o, p)) {
            at = p;
            break;
          }
        }
        if (!at) continue;
        const score = judge(bed, o, at);
        if (!best || score < best.score) best = { cubes: o, at, score };
      }
    }
  }
  return best && { cubes: best.cubes, at: best.at };
}

/** Resting on something from below (the quiet player doesn't build out from walls). */
function rests(bed: Bed, cubes: C3[], p: C3): boolean {
  for (const c of cubes) {
    const y = c[1] + p[1];
    if (y === 0 || bed.at(c[0] + p[0], y - 1, c[2] + p[2])) return true;
  }
  return false;
}

function judge(bed: Bed, cubes: C3[], p: C3): number {
  const t = new Bed();
  t.cells.set(bed.cells);
  for (const c of cubes) t.set(c[0] + p[0], c[1] + p[1], c[2] + p[2], 1);
  const full = t.full().length;
  let hollows = 0;
  for (const c of cubes) {
    const x = c[0] + p[0];
    const z = c[2] + p[2];
    for (let y = c[1] + p[1] - 1; y >= 0 && !t.at(x, y, z); y--) hollows++;
  }
  const ys = cubes.reduce((s, c) => s + c[1] + p[1], 0) / cubes.length;
  return ys * 1.5 + hollows * 3 - full * 8 + t.height() * 0.5;
}
