/**
 * Forms chosen by their surroundings: what the land and what's built beside it ask of each other, worked out from the
 * resolved world (model.ts), the same every time.
 *
 * - **Retaining walls**: where the land steps down a bank (one to three levels) and either side of it is used (a way, a
 *   court's or a way's paving, something built at the ground, a pool, a bowl), the bank is held by a wall of dressed
 *   stone instead of falling away: the ground either side flat to it, its face battered, coped along its top (a low
 *   upstand where the ground above is open). Not where a stair climbs the bank (its own steps hold it), nor along water.
 * - **Buildings stepping with the slope** (buildings.ts): a mass built across ground at different levels is read as
 *   steps, each its own building at its own height, the lower against the higher under a lean-to; set into a bank, a
 *   house's roof falls away from the hill, and it's come into from the hill above as well as from below; the wall a
 *   building's downhill side stands on carried down to the lower ground (a retaining wall under it).
 */
import { DIRS, key, type World } from './model';
import { surfaceY } from './land';

/** a bank held by a wall: the high cell, the way to the low one, the two grounds */
export interface Retain { i: number; j: number; d: number; lo: number; hi: number }
const cache = new WeakMap<World, { v: number; r: Map<string, Retain>; sharp: (i: number, j: number, d: number) => boolean }>();

/** where the land's banks are held by walls (keyed from both sides: `i.j.d`) */
export function retaining(w: World): Map<string, Retain> { return worked(w).r; }
function worked(w: World) {
  const c = cache.get(w);
  if (c && c.v === w.version) return c;
  const r = new Map<string, Retain>();
  if (w.land) {
    const e = w.extent(), wet = (i: number, j: number) => !!w.land?.water.has(j * 1000 + i);
    const used = (i: number, j: number) => {
      const g = w.ground(i, j);
      return w.paved(i, j) || w.courts.has(key(0, i, j)) || w.occupied(g, i, j) || w.way(g, i, j) || w.bowl(g, i, j) || w.pools.has(key(0, i, j)) || w.tree(g, i, j);
    };
    for (let j = e.j0; j <= e.j1; j++) for (let i = e.i0; i <= e.i1; i++) {
      const hi = w.ground(i, j);
      if (wet(i, j)) continue;
      for (let d = 0; d < 4; d++) {
        const [a, b] = DIRS[d], x = i + a, z = j + b;
        if (!w.onSlab(x, z) || wet(x, z)) continue;
        const lo = w.ground(x, z), drop = hi - lo;
        if (drop < 1 || drop > 3 || !(used(i, j) || used(x, z))) continue;
        // (not where a stair climbs it: its steps hold it)
        if (w.stair(lo, x, z) === (d + 2) % 4 || w.stair(hi - 1, x, z) === (d + 2) % 4) continue;
        const it = { i, j, d, lo, hi };
        r.set(`${i}.${j}.${d}`, it); r.set(`${x}.${z}.${(d + 2) % 4}`, it);
      }
    }
  }
  const out = { v: w.version, r, sharp: (i: number, j: number, d: number) => r.has(`${i}.${j}.${d}`) };
  cache.set(w, out);
  return out;
}
/** the ground as it's drawn (grid units: cell (i, j) spans i..i+1), its banks held where they're walled */
export function groundY(w: World, x: number, z: number): number {
  if (!w.land) return 0;
  const s = worked(w).sharp, y = surfaceY(w.land, x, z, s);
  // (on a cell's edge, where a wall holds the bank, the higher side's)
  const fx = x - Math.round(x), fz = z - Math.round(z);
  if (Math.abs(fx) < 1e-6 || Math.abs(fz) < 1e-6) return Math.max(y, surfaceY(w.land, x - 1e-4, z - 1e-4, s), surfaceY(w.land, x + 1e-4, z + 1e-4, s), surfaceY(w.land, x - 1e-4, z + 1e-4, s), surfaceY(w.land, x + 1e-4, z - 1e-4, s));
  return y;
}
