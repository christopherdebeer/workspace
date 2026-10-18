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
 * 5. **With the palette**: the same, and pieces put by hand: a tall arch, a long bridge, a pool, cypresses on a terrace.
 * 7. **Auto alone, no cap**: the same as 4, and a tower tapped up ten high, a walkway from the terrace to it, a long wall
 *    round the far side; each made and dressed as the rules choose, nothing dressed by hand.
 * 6. **Motifs and dressing**: the same as 4, and a trace from the terrace to a new tower further off (an arcade of three
 *    bays, alike, a parapet along it of its own accord); a flight run up to the terrace with the stair brush; the passage under the
 *    walkway read as a lintel; and dressed: a marble tower with a lantern, the court's wall in brick, moss on the
 *    platform and the old wall, ivy on the terrace, a parapet on the walkway, pots on the terrace.
 */
import { DRESS, RULE, World, type Cell, type Op } from './model';
import { carve, tap, trace, type Pick } from './gesture';
import { place, run, type Hand } from './palette';

const ground = (i: number, j: number): Pick => ({ face: 'ground', hit: [-1, i, j], to: [0, i, j] });
const top = (w: World, i: number, j: number): Pick => { let k = 0; while (w.occupied(k + 1, i, j)) k++; return { face: 'top', hit: [k, i, j], to: [k + 1, i, j] }; };
const side = (k: number, i: number, j: number, di: number, dj: number): Pick => ({ face: 'side', hit: [k, i, j], to: [k, i + di, j + dj] });

export function story(stage: number): World {
  const w = new World(7);
  const t = -100;
  const tapAt = (p: Pick) => { const op = tap(w, p, t); if (op) w.apply(op, t); };
  const traceAt = (start: Pick, cells: Array<[number, number]>, end: Pick | null) => { const op = trace(w, start, cells, end, () => t, t); if (op && !('refused' in op)) w.apply(op, t); };
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
  if (stage <= 4) return w;
  if (stage === 7) {
    // 7: auto alone, no cap: a tower ten high, a walkway from the terrace to it, a long wall round the far side (each as
    // the rules choose to make and dress it)
    for (let q = 0; q < 10; q++) tapAt(q ? top(w, 13, 4) : ground(13, 4));
    traceAt(top(w, 10, 4), [[10, 4], [11, 4], [12, 4], [13, 4]], null);
    traceAt(ground(12, 7), [[12, 7], [12, 8], [12, 9], [12, 10], [12, 11], [12, 12], [11, 12], [10, 12], [9, 12], [8, 12], [7, 12], [6, 12], [5, 12]], null);
    return w;
  }
  if (stage >= 6) {
    const apply = (op: Op | null) => { if (op) w.apply(op, t); };
    // (a tower east of the terrace's far side, and a trace from the terrace to it: an arcade)
    for (let q = 0; q < 3; q++) tapAt(q ? top(w, 10, 14) : ground(10, 14));
    traceAt(top(w, 10, 5), [[10, 5], [10, 6], [10, 7], [10, 8], [10, 9], [10, 10], [10, 11], [10, 12], [10, 13], [10, 14]], top(w, 10, 14));
    // (a flight up to the terrace, run with the stair brush)
    apply(run(w, 'stair', ground(14, 4), [[14, 4], [13, 4], [12, 4], [11, 4]], 1, t));
    // (the passage under the walkway, read as a lintel)
    apply({ rule: [[1, 6, 7, RULE.lintel]], why: 'reading' });
    // (dressed)
    const cells = (k0: number, k1: number, cols: Array<[number, number]>) => cols.flatMap(([i, j]) => Array.from({ length: k1 - k0 + 1 }, (_, q) => [k0 + q, i, j] as Cell)).filter((c) => w.stone(...c));
    const dress = (kind: number, cs: Cell[]) => apply({ dress: cs.map(([k, i, j]) => [k, i, j, kind, 1]), why: 'dress' });
    dress(DRESS.marble, cells(0, 2, [[3, 3], [3, 4], [10, 14]]));
    dress(DRESS.brick, cells(0, 0, [[3, 8], [3, 9], [3, 10], [4, 10], [5, 10], [6, 10], [7, 10], [8, 10], [9, 10], [9, 9], [9, 8]]));
    dress(DRESS.moss, cells(0, 1, [[3, 7], [4, 7], [5, 7], [7, 7], [8, 7]]));
    dress(DRESS.ivy, cells(0, 2, [[9, 4], [10, 4], [9, 5], [10, 5]]));
    dress(DRESS.parapet, cells(1, 1, [[5, 7], [6, 7], [7, 7]]));
    dress(DRESS.lantern, [[2, 3, 3], [2, 10, 14]]);
    dress(DRESS.pot, [[2, 9, 5], [2, 9, 4]]);
    return w;
  }
  // 5: pieces from the palette, put where a touch would put them
  const put = (h: Exclude<Hand, 'auto'>, p: Pick) => { const op = place(w, h, p, 1, t); if (op) w.apply(op, t); };
  put('arch', ground(10, 8)); put('arch', top(w, 10, 8)); put('block', top(w, 10, 8));
  put('block', ground(10, 10)); put('block', top(w, 10, 10)); put('block', top(w, 10, 10));
  put('bridge', side(2, 10, 8, 0, 1));
  put('pool', ground(6, 2)); put('pool', ground(7, 2));
  put('cypress', top(w, 10, 4)); put('cypress', top(w, 3, 3)); put('cypress', ground(1, 9));
  return w;
}
