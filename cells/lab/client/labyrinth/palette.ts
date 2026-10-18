/**
 * The palette: a piece in hand, put where it's touched (the free cell on the touched face's side), as an operation on
 * the same solid the gestures build (model.ts), resolved by the same rules. **auto** is the gestures (gesture.ts).
 *
 * - **wall**: a thin wall, a wall's thickness and full height, running away from what it's put against (or across the
 *   view), and on to the stone beside it;
 * - **block**: stone, there; against a side, out from it even over nothing (as a tap does: the rules carry it).
 * - **arch**: stone with a way through it, running where it's open either side (on an arch, the same way: one tall arch).
 * - **stair**: a flight up a level, climbing toward the stone it was put against (or onto a neighbour's top).
 * - **bridge**: across the gap at that level, from stone to stone, the whole span at once (up to seven cells), carried
 *   on one arch.
 * - **cypress**: on a floor, with room above it.
 * - **pool**: let into the stone itself.
 * - **take**: what was touched, taken away (the rules then carry what was on it, on an arch or a pier).
 */
import { CEIL, DIRS, DRESS, inGrid, key, straights, type Cell, type Op, type World } from './model';
import { connect, surface, type Pick } from './gesture';
import { look } from './character';

/** the pieces a specific brush can hold, and the dressing */
export type Piece = 'block' | 'wall' | 'arch' | 'stair' | 'bridge' | 'cypress' | 'pool';
export type Dressing = keyof typeof DRESS;
export type Hand = 'auto' | Piece | 'take';
export const PIECES: Piece[] = ['block', 'wall', 'arch', 'stair', 'bridge', 'cypress', 'pool'];
export const DRESSINGS: Dressing[] = ['travertine', 'brick', 'marble', 'moss', 'ivy', 'parapet', 'lantern', 'pot'];

/** a bridge across level k through a cell: along an axis, the free cells between stone either side (the shorter way) */
export function span(w: World, k: number, i: number, j: number, only?: number): { a: number; i: number; j: number; n: number } | null {
  if (!w.free(k, i, j)) return null;
  let best: { a: number; i: number; j: number; n: number } | null = null;
  for (const a of only === undefined ? [0, 1] : [only]) {
    const [di, dj] = DIRS[a];
    let lo = 0, hi = 0;
    while (lo < 7 && w.free(k, i - (lo + 1) * di, j - (lo + 1) * dj)) lo++;
    while (hi < 7 && w.free(k, i + (hi + 1) * di, j + (hi + 1) * dj)) hi++;
    const n = lo + hi + 1;
    if (n > 7 || !w.stone(k, i - (lo + 1) * di, j - (lo + 1) * dj) || !w.stone(k, i + (hi + 1) * di, j + (hi + 1) * dj)) continue;
    if (!best || n < best.n) best = { a, i: i - lo * di, j: j - lo * dj, n };
  }
  return best;
}

/** the operation a piece in hand makes where it's touched (`view`: the way the eye looks, a DIRS index), or null */
export function place(w: World, hand: Exclude<Hand, 'auto'>, p: Pick, view: number, now: number): Op | null {
  const [hk, hi, hj] = p.hit;
  if (hand === 'take') {
    if (p.face === 'ground') return w.pools.has(key(0, hi, hj)) ? { cut: [[-1, hi, hj]], why: 'take' } : null;
    // (a lantern or a pot on what was touched, before the stone itself)
    const prop = look(w, hk, hi, hj)?.prop;
    if (prop && p.face === 'top') return { dress: [[hk, hi, hj, prop, 0]], why: 'take' };
    for (let k = hk; k >= 0; k--) if (w.stone(k, hi, hj) || w.stair(k, hi, hj) >= 0 || w.tree(k, hi, hj)) return { cut: [[k, hi, hj]], why: 'take' };
    return null;
  }
  if (hand === 'pool') return p.face === 'ground' && !w.pool(hi, hj) && w.free(0, hi, hj) ? { pools: [[hi, hj, now]], why: 'pool' } : null;
  const [k, i, j] = p.face === 'ground' ? [0, hi, hj] : p.face === 'top' ? [w.topFrom(hk, hi, hj), hi, hj] : p.to;
  if (k >= CEIL || !inGrid(i, j)) return null;
  const side = p.face === 'side', toward = side ? DIRS.findIndex(([a, b]) => a === hi - i && b === hj - j) : -1;
  if (hand === 'bridge') {
    const s = (side ? span(w, k, i, j, toward % 2) : null) ?? span(w, k, i, j);
    if (!s) return null;
    const [di, dj] = DIRS[s.a];
    return { add: Array.from({ length: s.n }, (_, q) => [k, s.i + q * di, s.j + q * dj, now + q * 0.06] as [number, number, number, number]), bridge: true, why: 'bridge' };
  }
  if (!w.free(k, i, j)) return null;
  // (a block against a side goes out that way as an auto tap does, carried by the rules if there's nothing under it)
  if (hand === 'block' && (side || w.floor(k, i, j))) return { add: [[k, i, j, now]], why: 'block' };
  if (hand === 'wall' && (side || w.floor(k, i, j))) return { walls: [[k, i, j, side ? toward % 2 : w.wall(k - 1, i, j) >= 0 ? w.wall(k - 1, i, j) : (view + 1) % 2, now]], why: 'wall piece' };
  if (!w.floor(k, i, j)) return null;
  if (hand === 'cypress') return w.free(k + 1, i, j) ? { trees: [[k, i, j, now]], why: 'cypress' } : null;
  if (hand === 'stair') {
    let d = toward;
    if (d < 0) for (let q = 0; q < 4 && d < 0; q++) if (w.stone(k, i + DIRS[q][0], j + DIRS[q][1]) && w.free(k + 1, i + DIRS[q][0], j + DIRS[q][1])) d = q;
    return { stairs: [[k, i, j, d < 0 ? view : d, now]], why: 'stair' };
  }
  // (an arch: its way through runs where it's open either side; on an arch, the same way)
  const under = w.archway(k - 1, i, j);
  const open = (a: number) => [1, -1].every((s) => !w.stone(k, i + s * DIRS[a][0], j + s * DIRS[a][1]));
  const want = side ? toward % 2 : view % 2;
  const a = under >= 0 ? under : open(want) ? want : 1 - want;
  return { arches: [[k, i, j, a, now]], why: 'arch' };
}

/**
 * A piece traced rather than tapped: a run of it along the stroke, at the height it started from (`cells`, the start's
 * column first). Blocks, a wall; walls, a thin wall along it; arches, an arcaded wall, each way through across the stroke; stairs, a flight climbing
 * a level a cell along the straight of it. The rest are put once, where the stroke began.
 */
export function run(w: World, piece: Piece, start: Pick, path: Array<[number, number]>, view: number, now: number): Op | null {
  const cells = connect(path), h0 = surface(w, start);
  if (cells.length < 2) return place(w, piece, start, view, now);
  if (piece === 'block' || piece === 'arch' || piece === 'wall') {
    const out: Array<[number, number, number, number, number]> = [];
    cells.forEach(([i, j], s) => {
      if (!w.free(h0, i, j)) return;
      const n = cells[Math.min(cells.length - 1, s + 1)], p = cells[Math.max(0, s - 1)], a = n[0] !== p[0] ? 1 : 0;
      out.push([h0, i, j, a, now + s * 0.05]);
    });
    if (!out.length) return null;
    if (piece === 'wall') return { walls: out.map(([k, i, j, a, b]) => [k, i, j, 1 - a, b]), why: 'thin wall' };
    return piece === 'block' ? { add: out.map(([k, i, j, , b]) => [k, i, j, b]), why: 'wall' } : { arches: out, why: 'arcade' };
  }
  if (piece === 'stair') {
    // (a flight: every straight cell a step, to wherever its last step leads)
    const last = cells[cells.length - 1], prev = cells[cells.length - 2], ahead: [number, number] = [2 * last[0] - prev[0], 2 * last[1] - prev[1]];
    const m = straights(cells, [0, ahead[0], ahead[1]]).length;
    if (!m || h0 + m >= CEIL) return null;
    return { connect: { from: [h0, cells[0][0], cells[0][1]], to: [h0 + m, ahead[0], ahead[1]], path: cells }, born: now, why: 'flight' };
  }
  return place(w, piece, start, view, now);
}

/** the cell a dressing goes on, where a touch struck: the stone (or stair, or pier) struck */
export function dressAt(w: World, p: Pick): Cell | null {
  if (p.face === 'ground') return null;
  const [k, i, j] = p.hit;
  return w.stone(k, i, j) || w.stair(k, i, j) >= 0 || w.pier(k, i, j) ? [k, i, j] : null;
}
/**
 * Dressing, over the cells a stroke struck (or one tapped): a stone for them all; or moss, ivy, a parapet, a lantern or
 * a pot, put on if the first cell hasn't one and taken off if it has (so a stroke over what's dressed undresses it).
 * A lantern or a pot only goes on a top with room over it.
 */
export function dress(w: World, kind: Dressing, cells: Cell[]): Op | null {
  const id = DRESS[kind], seen = new Set<number>(), out: Array<[number, number, number, number, number]> = [];
  const first = cells[0] && look(w, ...cells[0]);
  const has = (d: ReturnType<typeof look>) => !!d && (id === DRESS.moss ? d.moss : id === DRESS.ivy ? d.ivy : id === DRESS.parapet ? d.parapet : d.prop === id);
  const on = id <= DRESS.marble ? 1 : has(first) ? 0 : 1;
  for (const [k, i, j] of cells) {
    const v = key(k, i, j);
    if (seen.has(v)) continue;
    seen.add(v);
    if ((id === DRESS.lantern || id === DRESS.pot) && on && (w.occupied(k + 1, i, j) || w.tree(k + 1, i, j) || !w.stone(k, i, j))) continue;
    out.push([k, i, j, id, on]);
  }
  return out.length ? { dress: out, why: 'dress' } : null;
}
