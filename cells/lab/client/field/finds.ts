/**
 * The finds in a wood: crystals in the stone and fungi in the litter, scattered from the wood's
 * seed over a grid of cells — the same finds in the same places for anyone in that wood. Each
 * carries its own seed, which is the seed of the specimen the Crystals or the Hat-throwers
 * experiment grows for it, and so its name. Pure.
 */
import { hash } from '../kit/rng';
import { pick } from '../crystals/mineral';
import { species } from '../fungi/genome';

export type FindKind = 'crystal' | 'fungus';
export interface Find {
  id: string;
  kind: FindKind;
  x: number;
  z: number;
  /** the specimen's seed (Crystals' or Hat-throwers') */
  seed: number;
  name: string;
  /** a crystal's species kind (Crystals' `mineral`) */
  mineral?: string;
}

/** a cell's side (m), and the share of cells that hold a find */
export const CELL = 46;
export const SHARE = 0.42;

const memo = new Map<string, Find | null>();
/** the find in a cell, if it has one */
export function findIn(wood: number, i: number, j: number): Find | null {
  const key = `${wood}:${i}:${j}`;
  if (memo.has(key)) return memo.get(key)!;
  const h = hash(wood, 0xf1d, i, j);
  let f: Find | null = null;
  // (none at the start: the first cell is the clearing you arrive in)
  if (!(i === 0 && j === 0) && (h % 1000) / 1000 < SHARE) {
    const u = ((h >>> 10) % 1000) / 1000, v = ((h >>> 20) % 1000) / 1000;
    const kind: FindKind = (hash(h, 7) % 100) < 38 ? 'crystal' : 'fungus';
    const seed = (hash(h, 11) % 9000) + 1;
    const x = (i + 0.15 + 0.7 * u) * CELL, z = (j + 0.15 + 0.7 * v) * CELL;
    if (kind === 'crystal') { const sp = pick(seed); f = { id: `${i},${j}`, kind, x, z, seed, name: sp.name, mineral: sp.kind }; }
    else f = { id: `${i},${j}`, kind, x, z, seed, name: species(seed).name };
  }
  memo.set(key, f);
  return f;
}
/** every find within r metres of (x, z) */
export function findsNear(wood: number, x: number, z: number, r: number): Find[] {
  const out: Find[] = [];
  const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const f = findIn(wood, i, j);
    if (f && Math.hypot(f.x - x, f.z - z) <= r) out.push(f);
  }
  return out;
}

/** where a world point falls on the wood's screen (canvas pixels, y down), or null if behind or
 *  off the sides — the world's own projection (mistwood/render.ts): across the screen is the
 *  angle, up it the height over the horizontal distance */
export interface View { x: number; z: number; eye: number; yaw: number; f: number; horizon: number; W: number; H: number }
export function project(v: View, x: number, z: number, h: number): { px: number; py: number; r: number } | null {
  const dx = x - v.x, dz = z - v.z;
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
  const cx = dx * cy - dz * sy, cz = dx * sy + dz * cy;
  const r = Math.hypot(dx, dz);
  if (r < 0.3) return null;
  const th = Math.atan2(cx, cz);
  if (Math.abs(th) > (v.W / 2) / v.f + 0.15 || Math.abs(th) > 1.4) return null;
  const px = v.W / 2 + th * v.f;
  const pyGL = v.horizon + ((h - v.eye) / r) * v.f;
  return { px, py: v.H - pyGL, r };
}
