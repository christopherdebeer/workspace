/**
 * Outlines reshaped locally, and junctions rebuilt: the hand's stone made to give way to what it meets, reach round it,
 * or set back from it, in place, so the outline changes shape there and the rest is as it was. Each is an operation
 * (stone cut, stone added, an arch opened), laid like any other, so what's worked out from the stone after it (the
 * supports, the roofs and their wings, the rails, the walk, buildings and their doors) reads the new outline as it reads
 * one the hand drew:
 *
 * - **cut back** (`cutBack`): columns of the hand's stone taken out from a level up to the sky, the courses under it
 *   kept (a ledge, a plinth). A terrace notched round a tree's crown; a house's roof cut back round one; a tower stepped
 *   back where a pine spreads at its height.
 * - **carried round** (`carryRound`): stone added at a level beside the outline, out in the air, the rules carrying it
 *   (on corbels, or down to the ground). A terrace's edge reaching round a cypress on both sides, a bay for it.
 * - **set back** (`setBack`): a face cell at its foot opened under an arch, its way running into the mass and stopping
 *   there (a porch, a deep reveal), so what's met there (a door) is at its back.
 *
 * And where two things meet, the piece they share worked out as one and both rebuilt to it, rather than one cut open
 * for the other:
 *
 * - **a landing let into a flight** (`landingIn`): the flight re-laid with a landing at one of its steps, the steps
 *   below it moved back a cell to make room, so it arrives on the landing level with what's beside it (a terrace) and
 *   goes on up from it;
 * - **flights drawn together** (`alongside`): a flight re-laid beside another, step for step, so the two are one broad
 *   flight;
 * - **built up solid** (`solidUnder`): stone filled under a flight to the ground, so it and what's beside it (a cascade's
 *   columns) are one mass.
 *
 * Each says which cells it rebuilds (`Rebuilt.within`): the encounters let it lay there, where the old piece was.
 * The encounters (encounters.ts) say where and why; these say how, for any outline.
 */
import { DIRS, key, type Cell, type Flight, type Op, type World } from './model';

/** an operation that rebuilds what's there: the cells it may lay in because it takes out what was in them, or claims
 * them for the same thing (a flight's own way) */
export interface Rebuilt { op: Op; within: Cell[] }

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

/** whether a cell can be stood at: the ground, or stone under it */
const floored = (w: World, k: number, i: number, j: number) => k === w.ground(i, j) || w.stone(k - 1, i, j);

/**
 * A landing let into flight `f` at its step `s` (not its first or last): the steps up to it moved back a cell (its foot
 * a cell further out, where there's room on the level it starts from), and that step a landing, stone at its level, so
 * the flight arrives on it a level higher and goes on up from it as it did. Null where there's no room.
 */
export function landingIn(w: World, f: Flight, s: number, born: number): Rebuilt | null {
  if (s < 1 || s >= f.cells.length - 1) return null;
  const [a, b] = DIRS[f.d], [k0, i0, j0] = f.cells[0], foot: Cell = [k0, i0 - a, j0 - b];
  // (the new foot: free, stood on, room over it, and somewhere to come to it from)
  if (w.occupied(...foot) || !floored(w, ...foot) || w.occupied(k0 + 1, foot[1], foot[2]) || w.occupied(k0, foot[1] - a, foot[2] - b) || !floored(w, k0, foot[1] - a, foot[2] - b)) return null;
  if (w.passage(...foot) >= 0 && w.passage(...foot) !== f.d % 2) return null;
  const cut = f.cells.slice(0, s + 1), [k, i, j] = f.cells[s];
  const stairs = cut.map(([kk], q) => { const [, x, z] = q ? f.cells[q - 1] : foot; return [kk, x, z, f.d, born] as [number, number, number, number, number]; });
  // (each moved step's room over it is the flight's own)
  const within: Cell[] = [...cut, ...stairs.map(([kk, x, z]) => [kk, x, z] as Cell), ...stairs.map(([kk, x, z]) => [kk + 1, x, z] as Cell), [k + 1, i, j]];
  return { op: { cut, stairs, add: [[k, i, j, born]] }, within };
}

/**
 * Flight `g` re-laid beside flight `f`, step for step (the same levels, the cells beside `f`'s on `g`'s side), so the
 * two are one broad flight. Null unless they climb the same way from the same level as far, side by side a cell apart
 * across, and there's room.
 */
export function alongside(w: World, f: Flight, g: Flight, born: number): Rebuilt | null {
  if (f.d !== g.d || f.cells.length !== g.cells.length || f.cells[0][0] !== g.cells[0][0]) return null;
  const [a, b] = DIRS[f.d], [, fi, fj] = f.cells[0], [, gi, gj] = g.cells[0];
  // (across: g's line is a cell to one side of f's)
  const di = gi - fi, dj = gj - fj, side = a ? dj : di, ahead = a ? di * a : dj * b;
  if (Math.abs(side) !== 1 || !ahead || Math.abs(ahead) > 2) return null;
  const off: [number, number] = a ? [0, side] : [side, 0], gone = new Set(g.cells.map((c) => key(...c)));
  const stairs = f.cells.map(([k, i, j]) => [k, i + off[0], j + off[1], f.d, born] as [number, number, number, number, number]);
  for (const [k, i, j] of stairs) if ((w.occupied(k, i, j) && !gone.has(key(k, i, j))) || (w.occupied(k + 1, i, j) && !gone.has(key(k + 1, i, j)))) return null;
  // (come to at its foot, and on to what's at its head, as f is)
  const [kf, xf, zf] = stairs[0], [kh, xh, zh] = stairs[stairs.length - 1];
  if (!floored(w, kf, xf - a, zf - b) || w.occupied(kf, xf - a, zf - b) || !floored(w, kh + 1, xh + a, zh + b) || w.occupied(kh + 1, xh + a, zh + b)) return null;
  const within: Cell[] = [...g.cells, ...stairs.map(([k, i, j]) => [k, i, j] as Cell), ...stairs.map(([k, i, j]) => [k + 1, i, j] as Cell)];
  return { op: { cut: g.cells, stairs }, within };
}

/** stone filled under flight `f`'s steps down to the ground (or what's there), so it stands as one mass */
export function solidUnder(w: World, f: Flight, born: number): Rebuilt | null {
  const add: Array<[number, number, number, number]> = [];
  for (const [k, i, j] of f.cells) for (let kk = k - 1; kk >= w.ground(i, j) && !w.occupied(kk, i, j); kk--) { if (w.claim(kk, i, j) === 'passage' || w.claim(kk, i, j) === 'water') return null; add.push([kk, i, j, born]); }
  return add.length ? { op: { add }, within: add.map(([k, i, j]) => [k, i, j] as Cell) } : null;
}
