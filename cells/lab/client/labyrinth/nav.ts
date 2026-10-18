/**
 * Where a figure could walk, worked out from the resolved world (model.ts): the places to stand, and which lead to which.
 * A connection the hand drew is meant to be walked, so this is how it's checked that one was.
 *
 * - **A place to stand** is a cell with a floor under it (the slab, the top of stone, the deck over an arch) and nothing
 *   in it: not stone, a stair, a pier or a tree. The air under an arch counts, so a passage cut under stone is walked.
 * - **A stair** is a place too, between its foot (the cell behind it, at its level) and its head (the cell ahead, a
 *   level up), or the next stair of a flight.
 * - **Places lead to places** beside them at the same height, and a stair from its foot to its head.
 *
 * Places are keyed as cells are given (`[k, i, j]`: the height stood at, then the column).
 */
import { DIRS, LEVELS, inGrid, key, unkey, type Cell, type World } from './model';

export interface Nav { places: Set<number>; next: Map<number, number[]> }

/** a place to stand at height k on a column */
export const standing = (w: World, k: number, i: number, j: number) => k >= 0 && k < LEVELS && inGrid(i, j) && w.floor(k, i, j) && !w.occupied(k, i, j) && !w.tree(k, i, j) && !(k > 0 && w.tree(k - 1, i, j)) && (k > 0 || !w.pool(i, j));

export function navigate(w: World): Nav {
  const places = new Set<number>(), next = new Map<number, number[]>();
  const link = (a: number, b: number) => { if (!places.has(a) || !places.has(b)) return; (next.get(a) ?? next.set(a, []).get(a)!).push(b); (next.get(b) ?? next.set(b, []).get(b)!).push(a); };
  const e = w.extent();
  for (let k = 0; k < LEVELS; k++) for (let j = e.j0; j <= e.j1; j++) for (let i = e.i0; i <= e.i1; i++) if (standing(w, k, i, j) || w.stair(k, i, j) >= 0) places.add(key(k, i, j));
  for (const v of places) {
    const [k, i, j] = unkey(v);
    const d = w.stair(k, i, j);
    if (d >= 0) {
      const [di, dj] = DIRS[d];
      // (its foot: a place at its level behind it, or a stair of the same flight below; its head: the next place up)
      if (standing(w, k, i - di, j - dj)) link(v, key(k, i - di, j - dj));
      if (w.stair(k - 1, i - di, j - dj) === d) link(v, key(k - 1, i - di, j - dj));
      if (standing(w, k + 1, i + di, j + dj) || w.stair(k + 1, i + di, j + dj) === d) link(v, key(k + 1, i + di, j + dj));
      continue;
    }
    for (const [a, b] of DIRS.slice(0, 2)) if (standing(w, k, i + a, j + b)) link(v, key(k, i + a, j + b));
  }
  return { places, next };
}

/** whether one place leads to another */
export function reaches(n: Nav, from: Cell, to: Cell): boolean {
  const a = key(...from), b = key(...to);
  if (!n.places.has(a) || !n.places.has(b)) return false;
  const seen = new Set([a]), q = [a];
  while (q.length) { const v = q.pop()!; if (v === b) return true; for (const u of n.next.get(v) ?? []) if (!seen.has(u)) { seen.add(u); q.push(u); } }
  return false;
}
