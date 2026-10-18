/**
 * The storyboard (the index's card, and the README's views): the brief's first test, made with the same gestures a
 * hand would make, read by the same rules.
 *
 * 1. **First touch**: a small raised platform: the stone tapped, tapped again, pushed out a side.
 * 2. **A traced wall**: a wall drawn across the stone from it, and on round the court.
 * 3. **An elevated connection**: a terrace higher up, and a trace from the platform's top to it: steps and landings,
 *    carried on an arcade where there's nothing under them.
 * 4. **A resolved labyrinth**: a walkway out over the court, a passage cut beneath it, the court closed (so it's paved,
 *    with water and a cypress), and a second tower bridged to the first.
 */
import { World, type Cell } from './model';
import { carve, tap, trace, type Pick } from './gesture';

const ground = (i: number, j: number): Pick => ({ face: 'ground', hit: [-1, i, j], to: [0, i, j] });
const top = (w: World, i: number, j: number): Pick => { let k = 0; while (w.occupied(k + 1, i, j)) k++; return { face: 'top', hit: [k, i, j], to: [k + 1, i, j] }; };
const side = (k: number, i: number, j: number, di: number, dj: number): Pick => ({ face: 'side', hit: [k, i, j], to: [k, i + di, j + dj] });

export function story(stage: number): World {
  const w = new World(7);
  const t = -100;
  const tapAt = (p: Pick) => { const op = tap(w, p, t); if (op) w.apply(op, t); };
  const traceAt = (start: Pick, cells: Array<[number, number]>, end: Pick | null) => { const op = trace(w, start, cells, end, () => t); if (op) w.apply(op, t); };
  const carveAt = (cells: Cell[]) => { const cut = cells.filter((c) => carve(w, { face: 'side', hit: c, to: c })); if (cut.length) w.apply({ cut, why: 'carve' }, t); };
  // 1: a small raised platform
  tapAt(ground(3, 7)); tapAt(top(w, 3, 7)); tapAt(side(0, 3, 7, 1, 0)); tapAt(side(1, 3, 7, 1, 0));
  if (stage <= 1) return w;
  // 2: a wall extending from it, traced across the stone
  traceAt(ground(5, 7), [[5, 7], [6, 7], [7, 7], [8, 7], [9, 7]], null);
  if (stage <= 2) return w;
  // 3: a terrace higher up, and a trace from the platform's top along the wall and up to it
  for (const [i, j] of [[9, 4], [10, 4], [9, 5], [10, 5]]) { tapAt(ground(i, j)); tapAt(top(w, i, j)); tapAt(top(w, i, j)); }
  traceAt(top(w, 4, 7), [[4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [8, 6], [8, 5]], top(w, 9, 5));
  if (stage <= 3) return w;
  // 4: a passage cut through the wall beneath the walkway; the court closed in front; a tower, bridged to the terrace
  carveAt([[0, 6, 7]]);
  traceAt(ground(3, 8), [[3, 8], [3, 9], [3, 10], [4, 10], [5, 10], [6, 10], [7, 10], [8, 10], [9, 10], [9, 9], [9, 8]], null);
  for (const [i, j] of [[3, 3], [3, 4]]) { tapAt(ground(i, j)); tapAt(top(w, i, j)); tapAt(top(w, i, j)); }
  traceAt(top(w, 3, 4), [[3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4]], top(w, 9, 4));
  return w;
}
