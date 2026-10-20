/**
 * The green intent: what a gesture plants (model.ts `PLANT`, plants.ts), read from where it's made, as the other
 * intents read stone and ways from theirs.
 *
 * - **A tap** plants what suits the place: beside a wall or a building's face, a cypress (slender, standing up out of
 *   it); on a top, an olive in a planter (a roof garden); on open ground, an olive. A tap on a plant grows it: a shrub
 *   to an olive, an olive to a stone pine (insisting develops it, as elsewhere).
 * - **A stroke** plants a row along it: beside a wall or a way, an avenue of cypresses a cell apart from each other; in
 *   the open, olives two cells apart. The other readings: a hedge (every cell, clipped), an avenue of stone pines (three
 *   cells apart), shrubs.
 * - **A ring** plants a grove in what it encloses, a tree every other cell; the other readings: an orchard (a regular
 *   grid), a hedge round it (a garden walled in green).
 *
 * Never in a way the hand made, a stair's way, or water: what's planted keeps every claim (`World.claim`), and a plant
 * standing where a way runs would close it.
 */
import { DIRS, PLANT, inGrid, key, type Alt, type Cell, type Op, type World } from './model';

/** where a plant could stand at a column: on what's there (the ground or a top), with nothing in the way there, and no
 * claim on it */
function spot(w: World, i: number, j: number): Cell | null {
  if (!inGrid(i, j) || !w.onSlab(i, j)) return null;
  const k = w.topFrom(w.ground(i, j) - 1, i, j);
  if (w.occupied(k, i, j) || w.tree(k, i, j) || w.tree(k - 1, i, j) || w.claim(k, i, j) || w.stair(k - 1, i, j) >= 0 || w.pier(k, i, j)) return null;
  if (k === w.ground(i, j) && w.pool(i, j)) return null;
  if (k > w.ground(i, j) && !w.stone(k - 1, i, j)) return null;
  return [k, i, j];
}
/** beside stone that stands up past it (a wall, a building's face) */
const byWall = (w: World, [k, i, j]: Cell) => DIRS.some(([a, b]) => w.occupied(k, i + a, j + b) && w.occupied(k + 1, i + a, j + b));
/** beside a way the hand made */
const byWay = (w: World, [k, i, j]: Cell) => DIRS.some(([a, b]) => w.passage(k, i + a, j + b) >= 0);
const plant = (cells: Cell[], kind: number, now: number, note: string): Op => ({ plants: cells.map(([k, i, j]) => [k, i, j, kind, now] as [number, number, number, number, number]), born: now, why: 'plant', note, reading: note });
/** what each kind grows into, made again */
const GROWS: Record<number, number> = { [PLANT.shrub]: PLANT.olive, [PLANT.olive]: PLANT.pine };
const NAME: Record<number, string> = { [PLANT.cypress]: 'a cypress', [PLANT.shrub]: 'a shrub', [PLANT.hedge]: 'a hedge', [PLANT.olive]: 'an olive', [PLANT.pine]: 'a stone pine' };

/** a tap with the green intent: at the column touched */
export function plantTap(w: World, hit: Cell, now: number): Op | { refused: string; alts?: Alt[] } | null {
  const [, i, j] = hit;
  // (on a plant, or its cell: grown a size)
  for (let k = hit[0] + 1; k >= Math.max(0, hit[0] - 3); k--) {
    const kind = w.plant(k, i, j);
    if (kind < 0) continue;
    const next = GROWS[kind];
    if (next === undefined) return { refused: `${NAME[kind]} grows no bigger` };
    const note = `${NAME[kind]} grown: ${NAME[next]}`;
    return { ...plant([[k, i, j]], next, now, note), took: ['again'] };
  }
  const c = spot(w, i, j);
  if (!c) return { refused: 'nothing grows there: it\'s built on, a way\'s, or water' };
  const onTop = c[0] > w.ground(i, j);
  const first = byWall(w, c) ? PLANT.cypress : PLANT.olive;
  const kinds = [first, ...[PLANT.olive, PLANT.cypress, PLANT.pine, PLANT.shrub, PLANT.hedge].filter((q) => q !== first)];
  const say = (q: number) => `${NAME[q]}${onTop ? ', in a planter' : ''}${q === PLANT.cypress && byWall(w, c) ? ', against the wall' : ''}`;
  return { ...plant([c], first, now, say(first)), alts: kinds.slice(1).map((q) => ({ label: say(q), op: plant([c], q, now, say(q)) })) };
}

/** a stroke with the green intent: a row along it, or, closed, a grove in what it rings */
export function plantStroke(w: World, cells: Array<[number, number]>, closed: boolean, now: number): Op | { refused: string } | null {
  if (closed) {
    // (what it rings: the cells inside, not reached from outside its bounds without crossing it)
    const ring = new Set(cells.map(([i, j]) => `${i}.${j}`));
    const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]), i0 = Math.min(...xs) - 1, i1 = Math.max(...xs) + 1, j0 = Math.min(...zs) - 1, j1 = Math.max(...zs) + 1;
    const out = new Set<string>([`${i0}.${j0}`]), st: Array<[number, number]> = [[i0, j0]];
    while (st.length) { const [x, z] = st.pop()!; for (const [a, b] of DIRS) { const x2 = x + a, z2 = z + b, id = `${x2}.${z2}`; if (x2 < i0 || x2 > i1 || z2 < j0 || z2 > j1 || out.has(id) || ring.has(id)) continue; out.add(id); st.push([x2, z2]); } }
    const inside: Array<[number, number]> = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (!out.has(`${i}.${j}`) && !ring.has(`${i}.${j}`)) inside.push([i, j]);
    const spots = (pick: (c: [number, number]) => boolean) => inside.filter(pick).map(([i, j]) => spot(w, i, j)).filter((c): c is Cell => !!c);
    const grove = spots(([i, j]) => (i + j) % 2 === 0), orchard = spots(([i, j]) => i % 2 === 0 && j % 2 === 0);
    const hedge = cells.map(([i, j]) => spot(w, i, j)).filter((c): c is Cell => !!c);
    const alts: Alt[] = [];
    if (orchard.length) alts.push({ label: 'an orchard, in rows', op: plant(orchard, PLANT.olive, now, `an orchard of ${orchard.length} olives`) });
    if (hedge.length) alts.push({ label: 'a hedge round it', op: plant(hedge, PLANT.hedge, now, 'a hedge round it') });
    if (!grove.length) return hedge.length ? { ...alts[alts.length - 1].op, alts: alts.slice(0, -1) } : { refused: 'nothing grows there' };
    return { ...plant(grove, PLANT.olive, now, `a grove of ${grove.length} olives`), alts };
  }
  // (a row along it: what's beside it says what)
  const along = cells.map(([i, j]) => spot(w, i, j));
  const ok = along.map((c, n) => [c, n] as const).filter(([c]) => !!c) as Array<readonly [Cell, number]>;
  if (!ok.length) return { refused: 'nothing grows along there: it\'s built on, a way\'s, or water' };
  const edged = ok.filter(([c]) => byWall(w, c) || byWay(w, c)).length * 2 >= ok.length;
  const every = (n: number) => ok.filter(([, q]) => q % n === 0).map(([c]) => c);
  const rows: Array<[number, number, string]> = edged
    ? [[PLANT.cypress, 2, 'an avenue of cypresses'], [PLANT.hedge, 1, 'a hedge'], [PLANT.pine, 3, 'an avenue of stone pines'], [PLANT.olive, 2, 'a row of olives'], [PLANT.shrub, 1, 'shrubs']]
    : [[PLANT.olive, 2, 'a row of olives'], [PLANT.hedge, 1, 'a hedge'], [PLANT.pine, 3, 'an avenue of stone pines'], [PLANT.cypress, 2, 'a row of cypresses'], [PLANT.shrub, 1, 'shrubs']];
  const [k0, n0, s0] = rows[0];
  return { ...plant(every(n0), k0, now, s0), alts: rows.slice(1).map(([k, n, s]) => ({ label: s, op: plant(every(n), k, now, s) })) };
}

/** whether a plant stands at a column (for the page to say what a green touch is on) */
export const plantAt = (w: World, i: number, j: number) => { for (let k = 0; k < w.levels; k++) if (w.plant(k, i, j) >= 0) return key(k, i, j); return -1; };
