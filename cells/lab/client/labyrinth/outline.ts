/**
 * Outlines reshaped locally: the hand's stone made to give way to what it meets, reach round it, or set back from it,
 * in place, so the outline changes shape there and the rest is as it was. Each is an operation (stone cut, stone added,
 * an arch opened), laid like any other, so what's worked out from the stone after it (the supports, the roofs and
 * their wings, the rails, the walk, buildings and their doors) reads the new outline as it reads one the hand drew:
 *
 * - **cut back** (`cutBack`): columns of the hand's stone taken out from a level up to the sky, the courses under it
 *   kept (a ledge, a plinth). A terrace notched round a tree's crown; a house's roof cut back round one; a tower stepped
 *   back where a pine spreads at its height.
 * - **carried round** (`carryRound`): stone added at a level beside the outline, out in the air, the rules carrying it
 *   (on corbels, or down to the ground). A terrace's edge reaching round a cypress on both sides, a bay for it.
 * - **set back** (`setBack`): a face cell at its foot opened under an arch, its way running into the mass and stopping
 *   there (a porch, a deep reveal), so what's met there (a door) is at its back.
 *
 * The encounters (encounters.ts) say where and why; these say how, for any outline.
 */
import { DIRS, key, type Cell, type Op, type World } from './model';

/** the hand's own stone at a cell: not a way's (a walkway's floor, a flight), not a stair */
export const own = (w: World, k: number, i: number, j: number) => w.stone(k, i, j) && !w.laidBy(k, i, j) && w.stair(k, i, j) < 0;

/**
 * Cut back: in each of `plan`'s columns, the hand's stone from level `k0` up to the sky taken out (the courses under
 * `k0` kept). Null if any of it isn't the hand's own, or carries something that would be left hanging (a way walked on
 * its top, a stair), or if there's nothing there to cut.
 */
export function cutBack(w: World, plan: Array<[number, number]>, k0: number): Op | null {
  const cut: Cell[] = [];
  for (const [i, j] of plan) {
    let k = Math.max(k0, w.ground(i, j));
    if (!own(w, k, i, j)) continue;
    for (; w.stone(k, i, j) || w.stair(k, i, j) >= 0; k++) { if (!own(w, k, i, j) || w.claim(k, i, j) === 'passage') return null; cut.push([k, i, j]); }
    if (w.passage(k, i, j) >= 0 || w.stair(k, i, j) >= 0 || w.tree(k, i, j)) return null;
  }
  return cut.length ? { cut } : null;
}

/** carried round: stone at level `k` in `plan`'s cells, where there's nothing and nobody's claim (the rules carry it) */
export function carryRound(w: World, plan: Array<[number, number]>, k: number, born: number): Op | null {
  const add: Array<[number, number, number, number]> = [];
  for (const [i, j] of plan) {
    if (k < w.ground(i, j) || w.occupied(k, i, j) || w.claim(k, i, j)) return null;
    add.push([k, i, j, born]);
  }
  return add.length ? { add } : null;
}

/**
 * Set back: the face cell `[k, i, j]` (its face out the way `d` looks) opened at its foot under an arch, its way
 * running in, stopped by the hand's stone behind it: a porch. Null unless it's plain stone with plain stone behind it.
 */
export function setBack(w: World, [k, i, j]: Cell, d: number, born: number): Op | null {
  const [a, b] = DIRS[d];
  if (!w.block(k, i, j) || !own(w, k, i, j) || !w.block(k, i - a, j - b) || !w.stone(k + 1, i, j) || w.passage(k, i, j) >= 0) return null;
  return { arches: [[k, i, j, d % 2, born]] };
}

/** the cells of a set of columns, as keys (for asking whether one's among them) */
export const cols = (plan: Array<[number, number]>) => new Set(plan.map(([i, j]) => key(0, i, j)));
