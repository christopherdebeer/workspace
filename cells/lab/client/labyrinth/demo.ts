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
 *    round the far side, and a high walkway from halfway up the tower out over the ways below (its slim piers stand aside
 *    where they land on them); each made and dressed as the rules choose, nothing dressed by hand.
 * 8. **A labyrinth**: a compact build made to show what's hidden and what crosses. A cloister (a court walled round, a
 *    gallery of arches on its walls between corner towers, a gate through each side); a stair climbing behind a wall
 *    (its foot hidden, its head showing over the wall) to a landing tower; from there a bridge over the passage below it
 *    to the cloister's corner, so one way crosses another; a tall, narrow slot between two towers bridged high up; and
 *    houses under roofs (hipped, a lean-to, gabled, a marble tower's dome), their doors and windows the rules' own.
 * 6. **Motifs and dressing**: the same as 4, and a trace from the terrace to a new tower further off (an arcade of three
 *    bays, alike, a parapet along it of its own accord); a flight run up to the terrace with the stair brush; the passage under the
 *    walkway read as a lintel; and dressed: a marble tower with a lantern, the court's wall in brick, moss on the
 *    platform and the old wall, ivy on the terrace, a parapet on the walkway, pots on the terrace; and a garden of thin
 *    walls run with the wall piece.
 */
import { DRESS, PLANT, RULE, World, unkey, type Cell, type Op } from './model';
import { carve, tap, trace, type Intent, type Pick } from './gesture';
import { place, run, type Hand } from './palette';

const ground = (i: number, j: number): Pick => ({ face: 'ground', hit: [-1, i, j], to: [0, i, j] });
// (`topOf`, not `top`: the lab's bundle is a classic script, where a module-level `top` would be the window's own, read-only)
const topOf = (w: World, i: number, j: number): Pick => { let k = 0; while (w.occupied(k + 1, i, j)) k++; return { face: 'top', hit: [k, i, j], to: [k + 1, i, j] }; };
const side = (k: number, i: number, j: number, di: number, dj: number): Pick => ({ face: 'side', hit: [k, i, j], to: [k, i + di, j + dj] });

export function story(stage: number): World {
  if (stage === 8) return labyrinth();
  if (stage === 9) return features();
  if (stage === 10) return flow();
  if (stage === 11) return gestures();
  if (stage === 12) return onTheLand();
  if (stage === 13) return forCats();
  if (stage === 14) return water();
  if (stage === 15) return onTheSlope();
  if (stage === 16) return study();
  if (stage === 17) return courtHouse();
  if (stage === 18) return halved(courtHouse());
  if (stage === 19) return halfHouse();
  const w = new World(7);
  const t = -100;
  const tapAt = (p: Pick) => { const op = tap(w, p, t); if (op && !('refused' in op)) w.apply(op, t); };
  const traceAt = (start: Pick, cells: Array<[number, number]>, end: Pick | null) => { const op = trace(w, start, cells, end, () => t, t); if (op && !('refused' in op)) w.apply(op, t); };
  const carveAt = (cells: Cell[]) => { const cut = cells.filter((c) => carve(w, { face: 'side', hit: c, to: c })); if (cut.length) w.apply({ cut, why: 'carve' }, t); };
  // 1: a small raised platform
  tapAt(ground(3, 7)); tapAt(topOf(w, 3, 7)); tapAt(side(0, 3, 7, 1, 0)); tapAt(side(1, 3, 7, 1, 0));
  if (stage <= 1) return w;
  // 2: a wall extending from it, traced across the stone
  traceAt(ground(5, 7), [[5, 7], [6, 7], [7, 7], [8, 7], [9, 7]], null);
  if (stage <= 2) return w;
  // 3: a terrace higher up, and a trace from the platform's top along the wall and up to it
  for (const [i, j] of [[9, 4], [10, 4], [9, 5], [10, 5]]) { tapAt(ground(i, j)); tapAt(topOf(w, i, j)); tapAt(topOf(w, i, j)); }
  traceAt(topOf(w, 4, 7), [[4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [8, 6], [8, 5]], topOf(w, 9, 5));
  if (stage <= 3) return w;
  // 4: a passage cut through the wall beneath the walkway; the court closed in front; a tower, bridged to the terrace
  carveAt([[0, 6, 7]]);
  traceAt(ground(3, 8), [[3, 8], [3, 9], [3, 10], [4, 10], [5, 10], [6, 10], [7, 10], [8, 10], [9, 10], [9, 9], [9, 8]], null);
  for (const [i, j] of [[3, 3], [3, 4]]) { tapAt(ground(i, j)); tapAt(topOf(w, i, j)); tapAt(topOf(w, i, j)); }
  traceAt(topOf(w, 3, 4), [[3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4]], topOf(w, 9, 4));
  if (stage <= 4) return w;
  if (stage === 7) {
    // 7: auto alone, no cap: a tower ten high, a walkway from the terrace to it, a long wall round the far side (each as
    // the rules choose to make and dress it)
    for (let q = 0; q < 10; q++) tapAt(q ? topOf(w, 13, 4) : ground(13, 4));
    traceAt(topOf(w, 10, 4), [[10, 4], [11, 4], [12, 4], [13, 4]], null);
    traceAt(ground(12, 7), [[12, 7], [12, 8], [12, 9], [12, 10], [12, 11], [12, 12], [11, 12], [10, 12], [9, 12], [8, 12], [7, 12], [6, 12], [5, 12]], null);
    // (and from halfway up the tower, a high walkway west over the terrace and the bridge: its piers come down slim, and
    // stand aside where they land on the ways below)
    traceAt(side(4, 13, 4, -1, 0), [[13, 4], [12, 4], [11, 4], [10, 4], [9, 4], [8, 4], [7, 4], [6, 4]], null);
    return w;
  }
  if (stage >= 6) {
    const apply = (op: Op | null) => { if (op) w.apply(op, t); };
    // (a tower east of the terrace's far side, and a trace from the terrace to it: an arcade)
    for (let q = 0; q < 3; q++) tapAt(q ? topOf(w, 10, 14) : ground(10, 14));
    traceAt(topOf(w, 10, 5), [[10, 5], [10, 6], [10, 7], [10, 8], [10, 9], [10, 10], [10, 11], [10, 12], [10, 13], [10, 14]], topOf(w, 10, 14));
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
    // (a garden of thin walls east of the court, run with the wall piece)
    apply(run(w, 'wall', ground(12, 7), [[12, 7], [13, 7], [14, 7], [15, 7], [15, 8], [15, 9], [15, 10], [14, 10], [13, 10], [12, 10]], 1, t));
    return w;
  }
  // 5: pieces from the palette, put where a touch would put them
  const put = (h: Exclude<Hand, 'auto'>, p: Pick) => { const op = place(w, h, p, 1, t); if (op) w.apply(op, t); };
  put('arch', ground(10, 8)); put('arch', topOf(w, 10, 8)); put('block', topOf(w, 10, 8));
  put('block', ground(10, 10)); put('block', topOf(w, 10, 10)); put('block', topOf(w, 10, 10));
  put('bridge', side(2, 10, 8, 0, 1));
  put('pool', ground(6, 2)); put('pool', ground(7, 2));
  put('cypress', topOf(w, 10, 4)); put('cypress', topOf(w, 3, 3)); put('cypress', ground(1, 9));
  return w;
}

/** storyboard 8: a labyrinth, made to show routes crossing at different heights, a stair hidden then seen, a gate
 * framing it, a gallery round a court, and a tall narrow void */
function labyrinth(): World {
  const w = new World(11), t = -100;
  const add = (cells: Array<[number, number, number]>) => w.apply({ add: cells.map(([k, i, j]) => [k, i, j, t] as [number, number, number, number]) }, t);
  const col = (i: number, j: number, h: number) => add(Array.from({ length: h }, (_, k) => [k, i, j] as [number, number, number]));
  // (the cloister: corner towers three high, a wall round between them with a gate through the middle of each side, and
  // a gallery on the wall, carried on arches from tower to tower)
  for (const [i, j] of [[3, 3], [8, 3], [3, 8], [8, 8]]) col(i, j, 3);
  const ring: Array<[number, number]> = [];
  for (let q = 4; q <= 7; q++) ring.push([q, 3], [q, 8], [3, q], [8, q]);
  const gates = new Set(['5.3', '6.8', '3.6', '8.5']);
  add(ring.filter(([i, j]) => !gates.has(`${i}.${j}`)).map(([i, j]) => [0, i, j]));
  w.apply({ arches: ring.filter(([i, j]) => gates.has(`${i}.${j}`)).map(([i, j]) => [0, i, j, j === 3 || j === 8 ? 1 : 0, t] as [number, number, number, number, number]) }, t);
  add(ring.map(([i, j]) => [2, i, j]));
  // (a stair climbing behind a wall to a landing tower; the wall in front hides its foot)
  col(8, 10, 3);
  const ground = (i: number, j: number): Pick => ({ face: 'ground', hit: [-1, i, j], to: [0, i, j] });
  const top = (i: number, j: number): Pick => { let k = 0; while (w.occupied(k + 1, i, j)) k++; return { face: 'top', hit: [k, i, j], to: [k + 1, i, j] }; };
  const go = (start: Pick, cells: Array<[number, number]>, end: Pick | null) => { const op = trace(w, start, cells, end, () => t, t); if (op && !('refused' in op)) w.apply(op, t); };
  go(ground(4, 10), [[4, 10], [5, 10], [6, 10], [7, 10]], top(8, 10));
  for (let i = 3; i <= 8; i++) { col(i, 11, 2); }
  // (from the landing, a bridge over the passage below it to the cloister's corner: one way crosses another)
  go(top(8, 10), [[8, 10], [8, 9], [8, 8]], top(8, 8));
  // (a tall slot: two towers five high, bridged at the top)
  col(0, 4, 5); col(0, 6, 5);
  add([[4, 0, 5]]);
  // (and houses east of the cloister, under roofs: a square one hipped, a lean-to falling away from it, a long one gabled,
  // and a marble tower read with a dome)
  for (const [i, j] of [[11, 6], [12, 6], [11, 7], [12, 7]]) col(i, j, 3);
  for (const [i, j] of [[11, 8], [12, 8], [11, 9], [12, 9]]) col(i, j, 2);
  for (const [i, j] of [[11, 2], [12, 2], [13, 2], [11, 3], [12, 3], [13, 3]]) col(i, j, 2);
  col(14, 6, 4);
  w.apply({ dress: [0, 1, 2, 3].map((k) => [k, 14, 6, DRESS.marble, 1] as [number, number, number, number, number]), rule: [[3, 14, 6, RULE.dome]] }, t);
  return w;
}

/** storyboard 9: the features, each where it belongs, at its own rhythm */
function features(): World {
  const w = new World(13), t = -100;
  const add = (cells: Array<[number, number, number]>) => w.apply({ add: cells.map(([k, i, j]) => [k, i, j, t] as [number, number, number, number]) }, t);
  const col = (i: number, j: number, h: number) => add(Array.from({ length: h }, (_, k) => [k, i, j] as [number, number, number]));
  const dress = (cells: Array<[number, number, number]>, kind: number) => w.apply({ dress: cells.map(([k, i, j]) => [k, i, j, kind, 1] as [number, number, number, number, number]) }, t);
  // (a colonnade along the plaza's north: a run carried high between two towers, read as a colonnade (massive columns,
  // wide and even, under an entablature), a balustrade along its top of its own accord; a jali round one tower's top)
  col(2, 1, 3); col(12, 1, 3);
  const run: Array<[number, number, number]> = Array.from({ length: 9 }, (_, q) => [2, 3 + q, 1]);
  add(run);
  w.apply({ rule: run.map(([k, i, j]) => [k, i, j, RULE.colonnade] as [number, number, number, number]) }, t);
  dress([[2, 12, 1]], DRESS.jali);
  // (a terrace with a balustrade round it, and a flight up to it, balustraded too)
  for (const [i, j] of [[2, 6], [3, 6], [4, 6], [2, 7], [3, 7], [4, 7]]) col(i, j, 2);
  dress([[1, 2, 6], [1, 3, 6], [1, 4, 6], [1, 2, 7], [1, 3, 7], [1, 4, 7]], DRESS.balustrade);
  add([[0, 3, 8]]);
  w.apply({ stairs: [[0, 3, 9, 3, t], [1, 3, 8, 3, t]] }, t);
  dress([[0, 3, 9], [1, 3, 8]], DRESS.balustrade);
  // (a court walled round, a gate on its north; its west side a partition of pierced stone, a jali)
  const ring: Array<[number, number]> = [];
  for (let i = 6; i <= 10; i++) ring.push([i, 5], [i, 10]);
  for (let j = 6; j <= 9; j++) ring.push([6, j], [10, j]);
  const screen = ring.filter(([i, j]) => i === 6 && j >= 6 && j <= 9);
  add(ring.filter(([i, j]) => !(i === 8 && j === 5) && !screen.some(([a, b]) => a === i && b === j)).flatMap(([i, j]) => [[0, i, j], [1, i, j]] as Array<[number, number, number]>));
  w.apply({ arches: [[0, 8, 5, 1, t]], walls: screen.flatMap(([i, j]) => [[0, i, j, 1, t], [1, i, j, 1, t]] as Array<[number, number, number, number, number]>) }, t);
  dress(screen.flatMap(([i, j]) => [[0, i, j], [1, i, j]] as Array<[number, number, number]>), DRESS.jali);
  // (a house, three high under its roof: mashrabiya at its upper windows, colonnettes framing its windows and doors; a
  // pergola over the yard in front of it)
  const house: Array<[number, number]> = [];
  for (let i = 12; i <= 14; i++) for (let j = 8; j <= 10; j++) { col(i, j, 3); house.push([i, j]); }
  const all = house.flatMap(([i, j]) => [[0, i, j], [1, i, j], [2, i, j]] as Array<[number, number, number]>);
  dress(all, DRESS.colonnettes); dress(all.filter(([k]) => k >= 1), DRESS.mashrabiya);
  const yard: Array<[number, number, number]> = [];
  for (let i = 12; i <= 14; i++) for (let j = 6; j <= 7; j++) yard.push([0, i, j]);
  dress(yard, DRESS.pergola);
  return w;
}

/** storyboard 10: flow: walls that curve and run on the diagonal, piers that carry, and stairs whose ways stay open */
function flow(): World {
  const w = new World(17), t = -100;
  const ground = (i: number, j: number): Pick => ({ face: 'ground', hit: [-1, i, j], to: [0, i, j] });
  const top = (i: number, j: number): Pick => { let k = 0; while (w.occupied(k + 1, i, j)) k++; return { face: 'top', hit: [k, i, j], to: [k + 1, i, j] }; };
  const go = (start: Pick, cells: Array<[number, number]>, end: Pick | null) => { const op = trace(w, start, cells, end, () => t, t); if (op && !('refused' in op)) w.apply(op, t); };
  const add = (cells: Array<[number, number, number]>) => w.apply({ add: cells.map(([k, i, j]) => [k, i, j, t] as [number, number, number, number]) }, t);
  const col = (i: number, j: number, h: number) => add(Array.from({ length: h }, (_, k) => [k, i, j] as [number, number, number]));
  // (a wall traced on the diagonal: laid as a stair-step of cells, drawn as one straight diagonal wall, two courses)
  const diag: Array<[number, number]> = [[1, 1], [2, 1], [2, 2], [3, 2], [3, 3], [4, 3], [4, 4], [5, 4], [5, 5], [6, 5]];
  add(diag.flatMap(([i, j]) => [[0, i, j], [1, i, j]] as Array<[number, number, number]>));
  // (a court walled round a cell thick: its corners sweep round, a gate on its west)
  const ring: Array<[number, number]> = [];
  for (let i = 9; i <= 13; i++) ring.push([i, 1], [i, 6]);
  for (let j = 2; j <= 5; j++) ring.push([9, j], [13, j]);
  add(ring.filter(([i, j]) => !(i === 9 && j === 3)).flatMap(([i, j]) => [[0, i, j], [1, i, j]] as Array<[number, number, number]>));
  w.apply({ arches: [[0, 9, 3, 0, t], [1, 9, 3, 0, t]] }, t);
  // (a tower, and a terrace out from it on piers: the piers meet it in coves, arches between them)
  col(2, 9, 3);
  add([[2, 3, 8], [2, 3, 9], [2, 3, 10], [2, 4, 8], [2, 4, 9], [2, 4, 10], [2, 2, 8], [2, 2, 10]]);
  col(1, 9, 2);
  // (a stair up to the terrace, and a wall traced across its foot afterwards: the wall leaves its way open)
  go(top(1, 9), [[1, 9], [1, 10], [1, 11], [1, 12]], null);
  add([[0, 6, 9], [0, 5, 9], [1, 5, 9]]);
  w.apply({ stairs: [[0, 7, 9, 2, t], [1, 6, 9, 2, t], [2, 5, 9, 2, t]] }, t);
  go(ground(8, 6), [[8, 6], [8, 7], [8, 8], [8, 9], [8, 10], [8, 11], [8, 12]], null);
  // (stone two courses high pushed out from a tower over nothing: carried on piers that meet it in coves, an arch
  // between them, rather than a box on stilts)
  col(11, 9, 3); col(11, 10, 3);
  add([[1, 12, 9], [1, 12, 10], [2, 12, 9], [2, 12, 10]]);
  return w;
}

/** storyboard 11: gestures read for more than their ends: a loop, a pause, a climb too steep, a way blocked */
function gestures(): World {
  const w = new World(19), t = -100;
  const ground = (i: number, j: number): Pick => ({ face: 'ground', hit: [-1, i, j], to: [0, i, j] });
  const top = (i: number, j: number): Pick => { let k = 0; while (w.occupied(k + 1, i, j)) k++; return { face: 'top', hit: [k, i, j], to: [k + 1, i, j] }; };
  const go = (start: Pick, cells: Array<[number, number]>, end: Pick | null, rest: Array<[number, number]> = []) => { const op = trace(w, start, cells, end, () => t, t, rest); if (op && !('refused' in op)) w.apply({ ...op, alts: undefined }, t); };
  const col = (i: number, j: number, h: number) => w.apply({ add: Array.from({ length: h }, (_, k) => [k, i, j, t] as [number, number, number, number]) }, t);
  // (a stroke drawn round, back to where it began: a court walled in, a gate where it started)
  const ring: Array<[number, number]> = [];
  for (let i = 1; i <= 5; i++) ring.push([i, 1]);
  for (let j = 2; j <= 5; j++) ring.push([5, j]);
  for (let i = 4; i >= 1; i--) ring.push([i, 5]);
  for (let j = 4; j >= 1; j--) ring.push([1, j]);
  go(ground(3, 1), [...ring.slice(2), ...ring.slice(0, 3)], null);
  // (a wall traced with two pauses: a gate at each)
  go(ground(8, 1), [[8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 6], [8, 7]], null, [[8, 3], [8, 6]]);
  // (a terrace three high, and a stroke from the stone too short to climb it: a stair tower beside it, a stair inside)
  for (const [i, j] of [[11, 2], [12, 2], [11, 3], [12, 3]]) col(i, j, 3);
  go(ground(11, 5), [[11, 5], [11, 4]], top(11, 3));
  // (two towers and a third between them, taller: a bridge traced straight through it goes round)
  col(4, 8, 2); col(4, 12, 2); col(4, 10, 3);
  go(top(4, 8), [[4, 8], [4, 9], [4, 10], [4, 11]], top(4, 12));
  // (a block in the way of a climb: round it to a straight flight up)
  col(9, 11, 2); w.apply({ add: [[0, 8, 11, t]] }, t);
  go(ground(6, 11), [[6, 11], [7, 11], [8, 11]], top(9, 11));
  return w;
}

/**
 * storyboard 12: on the land. Four gestures make a place: a court walled round on the shelf (a stroke drawn round it,
 * mass); a way up to its gate from the low ground in front (it climbs where the land does, through the gate); a house
 * raised across the ravine; and a way over the stream to it (a bridge where it crosses the water).
 */
function onTheLand(): World {
  const w = new World(23, 6), t = -100;
  const ground = (i: number, j: number): Pick => { const g = w.ground(i, j); return { face: 'ground', hit: [g - 1, i, j], to: [g, i, j] }; };
  const go = (start: Pick, cells: Array<[number, number]>, end: Pick | null, intent: Intent) => { const op = trace(w, start, cells, end, () => t, t, [], intent); if (op && !('refused' in op)) w.apply({ ...op, alts: undefined }, t); };
  // (1. a court: a stroke drawn round the shelf, back to where it began: a gate there, facing down the land)
  const ring: Array<[number, number]> = [[1, 6], [2, 6], [3, 6], [3, 5], [3, 4], [3, 3], [3, 2], [2, 2], [1, 2], [0, 2], [-1, 2], [-1, 3], [-1, 4], [-1, 5], [-1, 6], [0, 6], [1, 6]];
  go(ground(1, 6), ring, null, 'mass');
  // (2. a way from the low ground up to its gate and in: flights where the land rises, through the gate)
  go(ground(1, 11), [[1, 11], [1, 10], [1, 9], [1, 8], [1, 7], [1, 6], [1, 5]], ground(1, 5), 'way');
  // (3. a house across the ravine, raised two courses on the level ground there)
  w.apply({ add: [[7, 2], [8, 2], [7, 3], [8, 3]].flatMap(([i, j]) => [0, 1].map((k) => [w.ground(i, j) + k, i, j, t] as [number, number, number, number])) }, t);
  // (4. a way from in front of the court over the stream to the house: a bridge where it crosses the water)
  go(ground(2, 7), [[2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [7, 6], [7, 5], [7, 4]], ground(7, 4), 'way');
  return w;
}

/**
 * storyboard 13: a place for cats (cats.ts). A court walled round low, a gate through its south wall, a taller corner
 * at its south-east; a terrace beside it, a stair up from it to a higher terrace, a thin wall running on from that; and,
 * last, a bridge traced from the higher terrace to the court's tall corner, over a gap too wide to leap: a new way,
 * for the cats to find (`?hold=1` keeps it back, so it can be built in front of them).
 */
function forCats(): World {
  const w = new World(29), t = -100;
  const top = (i: number, j: number): Pick => { let k = 0; while (w.occupied(k + 1, i, j)) k++; return { face: 'top', hit: [k, i, j], to: [k + 1, i, j] }; };
  const add = (cells: Array<[number, number, number]>) => w.apply({ add: cells.map(([k, i, j]) => [k, i, j, t] as [number, number, number, number]) }, t);
  // (the court: walls a level high round it, a gate through the south wall, the south-east corner a level taller)
  const ring: Array<[number, number, number]> = [];
  for (let i = 1; i <= 5; i++) ring.push([0, i, 1], [0, i, 5]);
  for (let j = 2; j <= 4; j++) ring.push([0, 1, j], [0, 5, j]);
  add(ring);
  w.apply({ arches: [[0, 3, 5, 1, t]] }, t);
  add([[1, 5, 5]]);
  // (a terrace beside it; a stair up from it to a higher terrace; a thin wall running on from that)
  add([8, 9, 10].flatMap((i) => [1, 2, 3].map((j) => [0, i, j] as [number, number, number])));
  add([[0, 9, 4]]);
  w.apply({ stairs: [[1, 9, 4, 1, t]] }, t);
  add([8, 9, 10].flatMap((i) => [5, 6, 7].flatMap((j) => [[0, i, j], [1, i, j]] as Array<[number, number, number]>)));
  w.apply({ walls: [11, 12, 13].flatMap((i) => [[0, i, 6, 0, t], [1, i, 6, 0, t]] as Array<[number, number, number, number, number]>) }, t);
  // (last: a bridge from the higher terrace to the court's tall corner)
  const op = trace(w, top(8, 5), [[8, 5], [7, 5], [6, 5], [5, 5]], top(5, 5), () => t, t);
  if (op && !('refused' in op)) w.apply({ ...op, alts: undefined }, t);
  return w;
}

/**
 * storyboard 14: water. A tower with a basin let into its top, beside a lower terrace with one in its: the tower's
 * spills onto the terrace's (water finds water), and the terrace's over its far edge to the ground, into a bowl the
 * rules put there to catch it. A wall with a channel along its top, spilling at its end. And a pond: a stroke of the
 * pool brush drawn round, filling what it closed round.
 */
function water(): World {
  const w = new World(31), t = -100;
  const g = (i: number, j: number): Pick => ({ face: 'ground', hit: [-1, i, j], to: [0, i, j] });
  const top = (i: number, j: number): Pick => { let k = 0; while (w.occupied(k + 1, i, j)) k++; return { face: 'top', hit: [k, i, j], to: [k + 1, i, j] }; };
  const add = (cells: Array<[number, number, number]>) => w.apply({ add: cells.map(([k, i, j]) => [k, i, j, t] as [number, number, number, number]) }, t);
  const apply = (op: Op | null) => { if (op) w.apply(op, t); };
  // (the tower and the terrace, and a basin let into each top)
  add([3, 4].flatMap((i) => [3, 4].flatMap((j) => [0, 1, 2].map((k) => [k, i, j] as [number, number, number]))));
  add([5, 6].flatMap((i) => [3, 4].flatMap((j) => [0, 1].map((k) => [k, i, j] as [number, number, number]))));
  apply(run(w, 'pool', top(3, 3), [[3, 3], [4, 3], [4, 4], [3, 4]], 0, t));
  apply(run(w, 'pool', top(5, 3), [[5, 3], [6, 3], [6, 4], [5, 4]], 0, t));
  // (a wall a level high with a channel along its top)
  add([2, 3, 4, 5, 6, 7, 8].map((i) => [0, i, 8] as [number, number, number]));
  apply(run(w, 'pool', top(2, 8), [[2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8]], 0, t));
  // (a pond: the pool brush drawn round, back to its start)
  apply(run(w, 'pool', g(9, 2), [[9, 2], [10, 2], [11, 2], [11, 3], [11, 4], [11, 5], [10, 5], [9, 5], [9, 4], [9, 3]], 0, t));
  return w;
}

/**
 * storyboard 15: forms chosen by their surroundings, on the land. A house built across a bank, two storeys on each
 * side of it: read as two steps, each under a lean-to, the lower against the higher, the higher's falling away from the
 * hill. A house set into a cliff, three storeys: its roof falls away from the hill and it's come into from the hill
 * above as well as from below. A way up the slope: where it runs along a bank, the bank's held by a wall.
 */
function onTheSlope(): World {
  const w = new World(41, 6), t = -100;
  const g = (i: number, j: number): Pick => { const k = w.ground(i, j); return { face: 'ground', hit: [k - 1, i, j], to: [k, i, j] }; };
  const raise = (i: number, j: number, n: number) => w.apply({ add: Array.from({ length: n }, (_, k) => [w.ground(i, j) + k, i, j, t] as [number, number, number, number]) }, t);
  // (across the bank: two storeys on each side of it)
  for (const i of [10, 11]) for (const j of [4, 5, 6, 7]) raise(i, j, 2);
  // (set into the cliff: three storeys, the hill at its back two storeys up)
  for (const i of [2, 3]) raise(i, 7, 3);
  // (a way from the low ground up past them)
  const op = trace(w, g(7, 10), [[7, 10], [7, 9], [7, 8], [7, 7], [7, 6], [7, 5], [7, 4], [8, 4], [8, 3], [8, 2]], g(8, 2), () => t, t, [], 'way');
  if (op && !('refused' in op)) w.apply({ ...op, alts: undefined }, t);
  return w;
}

/**
 * storyboard 16: the study, the renderer's fixed reference (static/labyrinth-look.md): the slope's two houses, the
 * tower set into the cliff and the way up past them (15), and a third house by the way's foot, an arcade along the
 * shelf, an olive planted by the stair. Every look at the drawing is judged in the same few views of it.
 */
function study(): World {
  const w = onTheSlope(), t = -100;
  const g = (i: number, j: number): Pick => { const k = w.ground(i, j); return { face: 'ground', hit: [k - 1, i, j], to: [k, i, j] }; };
  const raise = (i: number, j: number, n: number) => w.apply({ add: Array.from({ length: n }, (_, k) => [w.ground(i, j) + k, i, j, t] as [number, number, number, number]) }, t);
  for (const i of [9, 10]) for (const j of [11, 12]) raise(i, j, 2);
  const wall = trace(w, g(9, 9), [[9, 9], [10, 9], [11, 9], [12, 9], [13, 9]], null, () => t, t, [], 'mass');
  if (wall && !('refused' in wall)) w.apply({ ...((wall.alts ?? []).find((a) => a.label === 'an arcaded wall')?.op ?? wall), alts: undefined }, t);
  w.apply({ plants: [[w.ground(6, 7), 6, 7, PLANT.olive, t]] }, t);
  // (and a way from the arcade's foot west, across the stream and on out into the land the drawing takes over: for the
  // passage from the picture to the page to be judged along a way, over water)
  const out: Array<[number, number]> = [];
  for (let i = 8; i >= -1; i--) out.push([i, 9]);
  const way = trace(w, g(8, 9), out, g(-1, 9), () => t, t, [], 'way');
  if (way && !('refused' in way)) w.apply({ ...way, alts: undefined }, t);
  return w;
}

/**
 * storyboard 17: a courtyard house, the fronts' fixture (facades.ts). Wings two storeys high round a court five cells by
 * four, the north wing three; a gate through the south wing. The rules make the court (paved, a pool at its heart, a
 * tree in a corner); where a tradition composes round a court, its fronts are galleried at the ground, a portal in the
 * middle of the longest, windows in pairs over it.
 */
function courtHouse(): World {
  const w = new World(43), t = -100;
  const add = (cells: Array<[number, number, number]>) => w.apply({ add: cells.map(([k, i, j]) => [k, i, j, t] as [number, number, number, number]) }, t);
  const wing = (i0: number, i1: number, j0: number, j1: number, h: number) => { const c: Array<[number, number, number]> = []; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = 0; k < h; k++) c.push([k, i, j]); add(c); };
  wing(1, 9, 7, 8, 3);
  wing(1, 9, 1, 2, 2);
  wing(1, 2, 3, 6, 2);
  wing(8, 9, 3, 6, 2);
  w.apply({ arches: [[0, 5, 1, 1, t], [0, 5, 2, 1, t]] }, t);
  return w;
}

/**
 * storyboards 18 and 19: the grid spike (devtools/labyrinth-grid-spike.mjs), the courtyard house on a grid of half
 * cells (each cell four in plan, its storeys as tall), seen in its own proportions with `?plan=0.5`. 18 is 17 put on the
 * finer grid as it stands, each cell made four (what the same house costs to build there); 19 is the house as the finer
 * grid would have it built: its wings a cell and a half deep, a gallery of piers half a cell thick along the north
 * wing's court side, its top storey set back half a cell, the gate recessed half a cell into the south front between
 * pilasters, the court split by a thin wall with a gate in it, and a forecourt walled thin, a path half a cell wide.
 */
function halved(w0: World): World {
  const w = new World(w0.seed), t = -100, add: Array<[number, number, number, number]> = [], arches: Array<[number, number, number, number, number]> = [];
  const arched = [...w0.archways.keys()].map(unkey), solid = [...w0.mass.keys()].filter((c) => !w0.archways.has(c)).map(unkey);
  for (const [k, i, j] of solid) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) add.push([k, 2 * i + a, 2 * j + b, t]);
  for (const [k, i, j] of arched) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) arches.push([k, 2 * i + a, 2 * j + b, 1, t]);
  w.apply({ add }, t);
  w.apply({ arches }, t);
  return w;
}
function halfHouse(): World {
  const w = new World(43), t = -100;
  const cells: Array<[number, number, number, number]> = [];
  const box = (i0: number, i1: number, j0: number, j1: number, k0: number, k1: number) => { for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) cells.push([k, i, j, t]); };
  // (the north wing: three storeys, the top one set back half a cell from the court; along its court side at the
  // ground, piers half a cell thick with a cell between them, a gallery behind)
  box(2, 19, 15, 17, 0, 1); box(2, 19, 16, 17, 2, 2); box(2, 19, 14, 14, 1, 1);
  for (let i = 5; i <= 17; i += 3) box(i, i, 14, 14, 0, 0);
  // (the east and west wings, a cell and a half deep; the south wing two, the gate through it)
  box(2, 4, 6, 13, 0, 1); box(17, 19, 6, 13, 0, 1);
  box(2, 19, 3, 5, 0, 1); box(2, 8, 2, 2, 0, 1); box(13, 19, 2, 2, 0, 1);
  // (pilasters on the south front, half a cell out; either side of the gate's recess, and at the corners)
  for (const i of [2, 8, 13, 19]) box(i, i, 1, 1, 0, 1);
  // (the court split by a thin wall, a gate in it; a forecourt walled thin, a path half a cell wide inside it)
  box(5, 9, 10, 10, 0, 0); box(12, 16, 10, 10, 0, 0);
  box(4, 9, -1, -1, 0, 0); box(12, 17, -1, -1, 0, 0); box(4, 4, 0, 0, 0, 0); box(17, 17, 0, 0, 0, 0);
  const arch: Array<[number, number, number, number, number]> = [];
  for (const i of [10, 11]) for (const j of [3, 4, 5]) arch.push([0, i, j, 1, t]);
  w.apply({ add: cells.filter(([k, i, j]) => !(k === 0 && (i === 10 || i === 11) && j >= 3 && j <= 5)) }, t);
  w.apply({ arches: arch }, t);
  return w;
}
