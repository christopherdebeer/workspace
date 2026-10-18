/**
 * The palette: a piece in hand, put where it's touched (the free cell on the touched face's side), as an operation on
 * the same solid the gestures build (model.ts), resolved by the same rules. **auto** is the gestures (gesture.ts).
 *
 * - **block**: stone, there.
 * - **arch**: stone with a way through it, running where it's open either side (on an arch, the same way: one tall arch).
 * - **stair**: a flight up a level, climbing toward the stone it was put against (or onto a neighbour's top).
 * - **bridge**: across the gap at that level, from stone to stone, the whole span at once (up to seven cells), carried
 *   on one arch.
 * - **cypress**: on a floor, with room above it.
 * - **pool**: let into the stone itself.
 * - **take**: what was touched, taken away (the rules then carry what was on it, on an arch or a pier).
 */
import { DIRS, LEVELS, inGrid, key, type Op, type World } from './model';
import type { Pick } from './gesture';

export type Hand = 'auto' | 'block' | 'arch' | 'stair' | 'bridge' | 'cypress' | 'pool' | 'take';

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
    for (let k = hk; k >= 0; k--) if (w.stone(k, hi, hj) || w.stair(k, hi, hj) >= 0 || w.tree(k, hi, hj)) return { cut: [[k, hi, hj]], why: 'take' };
    return null;
  }
  if (hand === 'pool') return p.face === 'ground' && !w.pool(hi, hj) && w.free(0, hi, hj) ? { pools: [[hi, hj, now]], why: 'pool' } : null;
  const [k, i, j] = p.face === 'ground' ? [0, hi, hj] : p.face === 'top' ? [w.topFrom(hk, hi, hj), hi, hj] : p.to;
  if (k >= LEVELS || !inGrid(i, j)) return null;
  const side = p.face === 'side', toward = side ? DIRS.findIndex(([a, b]) => a === hi - i && b === hj - j) : -1;
  if (hand === 'bridge') {
    const s = (side ? span(w, k, i, j, toward % 2) : null) ?? span(w, k, i, j);
    if (!s) return null;
    const [di, dj] = DIRS[s.a];
    return { add: Array.from({ length: s.n }, (_, q) => [k, s.i + q * di, s.j + q * dj, now + q * 0.06] as [number, number, number, number]), bridge: true, why: 'bridge' };
  }
  if (!w.free(k, i, j) || !w.floor(k, i, j)) return null;
  if (hand === 'block') return { add: [[k, i, j, now]], why: 'block' };
  if (hand === 'cypress') return k + 1 >= LEVELS || w.free(k + 1, i, j) ? { trees: [[k, i, j, now]], why: 'cypress' } : null;
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
