/**
 * The land: a small composed landscape the labyrinth is built on, instead of the flat slab. Seeded, and fixed once made
 * (what's built never changes it). It's made to give the architecture reasons: it rises toward a back corner in
 * shelves; a ravine runs down it with a stream in its bed; a rocky outcrop stands in the way of the obvious line; and
 * there's a shelf flat enough for a court.
 *
 * It's held two ways that never disagree:
 * - **by column** (`g`): the level the ground is at in each cell. What's built is in whole levels, so this is what
 *   stands, walks and is struck: earth fills each column below it (`World.earth`), and its top is a floor;
 * - **as a surface** (`surfaceY`): the ground as it's drawn, continuous: each cell flat at its own level through its
 *   middle, falling or rising to its neighbours' across a band at its edge (a bank where they differ by a level, a
 *   cliff where they differ by more), roughened a little where it slopes. Its flat middles are exactly the columns'
 *   levels, so what's built on a column sits on the ground as drawn.
 */
import { hash, smooth } from '../kit/rng';

/** the land's cells (first and last each way) */
export const LAND = { i0: -1, i1: 12, j0: -1, j1: 12 } as const;
/** how wide a cell's flat middle is (of its half-width); the rest is the band its ground meets its neighbours' across */
export const FLAT = 0.38;
/** how high the land goes, at most */
export const PEAK = 5;

export interface Land {
  seed: number;
  /** the ground's level in each column (by `at(i, j)`) */
  g: Int8Array;
  /** the stream's cells, top to bottom (each beside the next), and as a set (`j * 1000 + i`) */
  stream: Array<[number, number]>; water: Set<number>;
  /** where the outcrop stands (its middle) */
  rock: [number, number];
  /** the shelf kept flat for a court (its middle) */
  shelf: [number, number];
}

const W = LAND.i1 - LAND.i0 + 1, H = LAND.j1 - LAND.j0 + 1;
const at = (i: number, j: number) => (j - LAND.j0) * W + (i - LAND.i0);
export const onLand = (i: number, j: number) => i >= LAND.i0 && i <= LAND.i1 && j >= LAND.j0 && j <= LAND.j1;

/** smooth value noise in 2D, 0..1 */
export function noise2(seed: number, x: number, y: number): number {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const r = (a: number, b: number) => hash(seed, a, b) / 4294967296;
  return (r(i, j) * (1 - u) + r(i + 1, j) * u) * (1 - v) + (r(i, j + 1) * (1 - u) + r(i + 1, j + 1) * u) * v;
}

/** a landscape for a seed */
export function makeLand(seed: number): Land {
  const R = (n: number) => hash(seed, n) / 4294967296;
  // (which way it rises, as the seed has it)
  // (only toward the back corners, as it's first seen: its rise behind what's built, not a wall in front of it)
  const turn = 2 + (hash(seed, 1) % 2);
  const uv = (i: number, j: number): [number, number] => {
    const u = (i - LAND.i0 + 0.5) / W, v = (j - LAND.j0 + 0.5) / H;
    return turn === 0 ? [u, v] : turn === 1 ? [1 - v, u] : turn === 2 ? [1 - u, 1 - v] : [v, 1 - u];
  };
  const cellOf = (u: number, v: number): [number, number] => {
    const [a, b] = turn === 0 ? [u, v] : turn === 1 ? [v, 1 - u] : turn === 2 ? [1 - u, 1 - v] : [1 - v, u];
    return [Math.max(LAND.i0, Math.min(LAND.i1, Math.floor(a * W) + LAND.i0)), Math.max(LAND.j0, Math.min(LAND.j1, Math.floor(b * H) + LAND.j0))];
  };
  // (the ravine's line down the rise: wandering a little either side of a line a third or two thirds across)
  const side = R(2) < 0.5 ? 0.36 : 0.64, phase = R(3) * 6.28, ravine = (v: number) => side + 0.09 * Math.sin(v * 5.2 + phase) + 0.05 * Math.sin(v * 11 + phase * 2);
  // (the outcrop: on the far side of the ravine from the court's shelf, partway up)
  const rockU = side < 0.5 ? 0.66 + 0.12 * R(4) : 0.34 - 0.12 * R(4), rockV = 0.4 + 0.25 * R(5);
  const shelfU = side < 0.5 ? 0.14 + 0.06 * R(6) : 0.86 - 0.06 * R(6), shelfV = 0.32 + 0.3 * R(7);
  const g = new Int8Array(W * H);
  const height = (u: number, v: number) => {
    // (the rise: gentle at the front, steeper toward the back, so the levels come as shelves)
    let h = PEAK * 0.92 * smooth(0.04, 1.02, 0.78 * v + 0.22 * Math.abs(u - (1 - side)) * 0.6) + 0.35;
    h += (noise2(seed + 11, u * 4.2, v * 4.2) - 0.5) * 1.1 + (noise2(seed + 12, u * 9, v * 9) - 0.5) * 0.4;
    // (the shelf kept flat for a court)
    const ds = Math.hypot((u - shelfU) * 1.1, v - shelfV);
    if (ds < 0.2) h = h + (Math.round(h) - h) * smooth(0.2, 0.08, ds);
    // (the outcrop)
    h += 1.6 * smooth(0.13, 0.02, Math.hypot(u - rockU, v - rockV));
    // (the ravine, cut down into it)
    h -= 1.5 * smooth(0.1, 0.02, Math.abs(u - ravine(v))) * smooth(0, 0.15, v + 0.05);
    return h;
  };
  for (let j = LAND.j0; j <= LAND.j1; j++) for (let i = LAND.i0; i <= LAND.i1; i++) {
    const [u, v] = uv(i, j);
    g[at(i, j)] = Math.max(0, Math.min(PEAK, Math.round(height(u, v))));
  }
  // (a clean shelf: a court's floor and the walls round it, all at one level)
  const [si, sj] = cellOf(shelfU, shelfV), level = g[at(si, sj)];
  for (let j = sj - 2; j <= sj + 2; j++) for (let i = si - 2; i <= si + 2; i++) if (onLand(i, j)) g[at(i, j)] = level;
  // (the stream: down the ravine's bed, a cell at a time, never climbing, from the top edge to the bottom)
  const stream: Array<[number, number]> = [];
  const steps = 60;
  for (let s = 0; s <= steps; s++) {
    const v = 1 - s / steps, c = cellOf(ravine(v), v), last = stream[stream.length - 1];
    if (last && last[0] === c[0] && last[1] === c[1]) continue;
    if (last && Math.abs(last[0] - c[0]) + Math.abs(last[1] - c[1]) > 1) stream.push([c[0], last[1]]);
    stream.push(c);
  }
  // (its bed lower than its banks, and falling all the way)
  let prev = PEAK;
  for (const [i, j] of stream) {
    const lowest = Math.min(prev, g[at(i, j)]);
    g[at(i, j)] = lowest; prev = lowest;
  }
  for (const [i, j] of stream) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = i + a, z = j + b;
    if (onLand(x, z) && !stream.some((c) => c[0] === x && c[1] === z) && g[at(x, z)] <= g[at(i, j)]) g[at(x, z)] = Math.min(PEAK, g[at(i, j)] + 1);
  }
  // (and the shelf kept flat, whatever the stream's banks did to it)
  const water = new Set(stream.map(([i, j]) => j * 1000 + i));
  let flat = level;
  for (const [i, j] of stream) if (Math.abs(i - si) <= 3 && Math.abs(j - sj) <= 3) flat = Math.max(flat, g[at(i, j)]);
  for (let j = sj - 2; j <= sj + 2; j++) for (let i = si - 2; i <= si + 2; i++) if (onLand(i, j) && !water.has(j * 1000 + i)) g[at(i, j)] = flat;
  return { seed, g, stream, water, rock: cellOf(rockU, rockV), shelf: [si, sj] };
}

/** the ground's level in a column (0 off the land) */
export const groundOf = (land: Land, i: number, j: number) => (onLand(i, j) ? land.g[at(i, j)] : 0);

/**
 * The ground as it's drawn, at a point (x, z: cells, from the land's grid origin, so cell (i, j) spans i..i+1): flat at
 * its column's level through its middle, meeting its neighbours' across the band at its edge, roughened where it slopes.
 * Off the land, nothing (−1).
 */
export function surfaceY(land: Land, x: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(z);
  if (!onLand(i, j)) return -1;
  // (the stream's bed a little under its banks)
  const G = (a: number, b: number) => { const x = Math.max(LAND.i0, Math.min(LAND.i1, a)), y = Math.max(LAND.j0, Math.min(LAND.j1, b)); return land.g[at(x, y)] - (land.water.has(y * 1000 + x) ? 0.3 : 0); };
  const fx = x - i - 0.5, fz = z - j - 0.5, sx = Math.sign(fx) || 1, sz = Math.sign(fz) || 1;
  // (how far into the band toward the neighbour each way: none through the flat middle, a half at the cell's edge)
  const wx = 0.5 * smooth(FLAT * 0.5, 0.5, Math.abs(fx)), wz = 0.5 * smooth(FLAT * 0.5, 0.5, Math.abs(fz));
  const g0 = G(i, j), gx = G(i + sx, j), gz = G(i, j + sz), gd = G(i + sx, j + sz);
  let y = g0 + wx * (gx - g0) + wz * (gz - g0) + wx * wz * (gd - gx - gz + g0);
  // (rough where it slopes: a bank's not a ramp)
  const slope = Math.abs(gx - g0) * wx + Math.abs(gz - g0) * wz + Math.abs(gd - g0) * wx * wz;
  if (slope > 0) y += (noise2(land.seed + 21, x * 2.3, z * 2.3) - 0.5) * 0.32 * Math.min(1, slope) + (noise2(land.seed + 22, x * 6, z * 6) - 0.5) * 0.1 * Math.min(1, slope);
  return y;
}
