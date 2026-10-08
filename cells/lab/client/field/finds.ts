/**
 * The anomalies in a wood: crystals erupting out of the ground and fungi grown gigantic, each
 * changing the wood about it. Few, and far between: one in most 190 m cells of a grid laid from the
 * wood's seed, set beside a path, so walking you come on them — the same in the same places for
 * anyone in that wood. Each carries its own seed, which is the seed of the specimen the Crystals
 * or the Hat-throwers experiment grows for it, and so its name. And one is always ahead of you as
 * you arrive: up the path from where the wood begins. Pure.
 */
import { hash } from '../kit/rng';
import { pick } from '../crystals/mineral';
import { Wood } from '../mistwood/world';
import { formOf, mushroomSpecies } from './mushrooms';

export type FindKind = 'crystal' | 'fungus';
export interface Find {
  id: string;
  kind: FindKind;
  /** its heart */
  x: number;
  z: number;
  /** the specimen's seed (Crystals' or Hat-throwers') */
  seed: number;
  name: string;
  /** how far its presence reaches (m): the wood is changed out to here, cleared in its heart */
  reach: number;
  /** a crystal's species kind (Crystals' `mineral`) */
  mineral?: string;
  /** a fungus's form (the Hat-throwers' capped ones: inkcap, mottlegill, fieldcap) */
  form?: string;
}

/** a cell's side (m), and the share of cells that hold an anomaly */
export const CELL = 190;
export const SHARE = 0.75;
/** the first: how far up the path from where you arrive */
const FIRST = 64;

const woods = new Map<number, Wood>();
const woodOf = (seed: number) => { let w = woods.get(seed); if (!w) { w = new Wood(seed); woods.set(seed, w); } return w; };

/** a cell's candidate, before it is set beside a path */
function candidate(wood: number, i: number, j: number): { x: number; z: number; h: number } | null {
  const h = hash(wood, 0xa70, i, j);
  if ((h % 1000) / 1000 >= SHARE) return null;
  const u = ((h >>> 10) % 1000) / 1000, v = ((h >>> 20) % 1000) / 1000;
  return { x: (i + 0.22 + 0.56 * u) * CELL, z: (j + 0.22 + 0.56 * v) * CELL, h };
}

const memo = new Map<string, Find | null>();
/** the anomaly in a cell, if it has one */
export function findIn(wood: number, i: number, j: number): Find | null {
  const key = `${wood}:${i}:${j}`;
  if (memo.has(key)) return memo.get(key)!;
  const f = place(wood, i, j);
  memo.set(key, f);
  return f;
}
/** the nearest point on a path (searching out in rings), and the path's way there; null if none
 *  within `max` m */
function nearestPath(W: Wood, x: number, z: number, max = 90): { x: number; z: number; heading: number } | null {
  const on = W.path[2] * 0.35;
  for (let r = 0; r <= max; r += 0.75) {
    const n = Math.max(1, Math.ceil((r * Math.PI * 2) / 0.75));
    let best: [number, number, number] | null = null;
    for (let a = 0; a < n; a++) {
      const px = x + Math.cos((a / n) * Math.PI * 2) * r, pz = z + Math.sin((a / n) * Math.PI * 2) * r;
      const d = W.pathDist(px, pz);
      if (d < on && (!best || d < best[2])) best = [px, pz, d];
    }
    if (best) {
      let heading = 0, hd = Infinity;
      for (let k = 0; k < 32; k++) {
        const h = (k / 32) * Math.PI * 2;
        let s = 0;
        for (const step of [3, 6, 9]) s += W.pathDist(best[0] + Math.sin(h) * step, best[1] + Math.cos(h) * step);
        if (s < hd) { hd = s; heading = h; }
      }
      return { x: best[0], z: best[1], heading };
    }
  }
  return null;
}
/** where you arrive in a wood (Mistwood's start: the path nearest the origin, and its way) */
export const startOf = (wood: number) => woodOf(wood).findPath(0, 0);
function place(wood: number, i: number, j: number): Find | null {
  const W = woodOf(wood);
  const first = i === 0 && j === 0;
  const c = first ? null : candidate(wood, i, j);
  if (!first && !c) return null;
  const h = first ? hash(wood, 0xa71) : c!.h;
  const kind: FindKind = hash(h, 7) % 2 ? 'crystal' : 'fungus';
  const seed = (hash(h, 11) % 9000) + 1;
  const reach = (kind === 'crystal' ? 34 : 30) + (hash(h, 13) % 13);
  // how far off the path its heart is: a crystal's dome and its leaning crystals clear of the
  // path; a fungus's giants beside it, its ring across it
  const off = kind === 'crystal' ? reach * 0.6 + ((h >>> 5) % 5) : reach * 0.45 + ((h >>> 5) % 6);
  let x: number, z: number;
  if (first) {
    // the first: up the path from where the wood begins (Mistwood's start, the path nearest the
    // origin), off to one side of it
    const at = startOf(wood);
    const side = h % 2 ? 1 : -1;
    x = at.x + Math.sin(at.heading) * FIRST + Math.cos(at.heading) * off * side;
    z = at.z + Math.cos(at.heading) * FIRST - Math.sin(at.heading) * off * side;
  } else {
    // (none too near one placed before it, in the cells before this one)
    for (const [di, dj] of [[-1, -1], [-1, 0], [-1, 1], [0, -1]]) {
      const o = i + di === 0 && j + dj === 0 ? findIn(wood, 0, 0) : candidate(wood, i + di, j + dj);
      if (o && Math.hypot(o.x - c!.x, o.z - c!.z) < CELL * 0.55) return null;
    }
    // beside a path, if one is near: off to the side of it, so the path passes by
    const at = nearestPath(W, c!.x, c!.z, 70);
    if (at) {
      const side = (h >>> 3) % 2 ? 1 : -1;
      x = at.x + Math.cos(at.heading) * off * side;
      z = at.z - Math.sin(at.heading) * off * side;
    } else { x = c!.x; z = c!.z; }
    // (and, set there, still clear of those before it and of the first)
    for (const [di, dj] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [-i, -j]]) {
      if (di === 0 && dj === 0) continue;
      const o = i + di === 0 && j + dj === 0 ? findIn(wood, 0, 0) : candidate(wood, i + di, j + dj);
      if (o && Math.hypot(o.x - x, o.z - z) < CELL * 0.45) return null;
    }
  }
  const id = `${i},${j}`;
  if (kind === 'crystal') { const sp = pick(seed); return { id, kind, x, z, seed, name: sp.name, reach, mineral: sp.kind }; }
  return { id, kind, x, z, seed, name: mushroomSpecies(seed).name, reach, form: formOf(seed) };
}

/** where the path passes an anomaly: the point on it nearest its heart, and from there the way to
 *  the heart (unit) and how far */
export function gateOf(wood: number, f: Find): { x: number; z: number; to: [number, number]; d: number } {
  const at = nearestPath(woodOf(wood), f.x, f.z) ?? woodOf(wood).findPath(f.x, f.z);
  const d = Math.hypot(f.x - at.x, f.z - at.z) || 1;
  return { x: at.x, z: at.z, to: [(f.x - at.x) / d, (f.z - at.z) / d], d };
}
/** every anomaly whose heart is within r metres of (x, z) */
export function findsNear(wood: number, x: number, z: number, r: number): Find[] {
  const out: Find[] = [];
  const pad = 40;
  const i0 = Math.floor((x - r - pad) / CELL), i1 = Math.floor((x + r + pad) / CELL), j0 = Math.floor((z - r - pad) / CELL), j1 = Math.floor((z + r + pad) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const f = findIn(wood, i, j);
    if (f && Math.hypot(f.x - x, f.z - z) <= r) out.push(f);
  }
  return out;
}
/** how cleared the wood is at (x, z) by the anomalies there: 1 in a heart (nothing grows where
 *  the crystals break out or the giants stand), thinning out to none at a third of the reach */
export function clearedAt(wood: number, x: number, z: number): number {
  let c = 0;
  const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const f = findIn(wood, i + di, j + dj);
    if (!f) continue;
    const d = Math.hypot(f.x - x, f.z - z) / f.reach;
    if (d >= 0.5) continue;
    const t = Math.min(1, Math.max(0, (d - (f.kind === 'crystal' ? 0.3 : 0.24)) / 0.2));
    c = Math.max(c, 1 - t * t * (3 - 2 * t));
  }
  return c;
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
