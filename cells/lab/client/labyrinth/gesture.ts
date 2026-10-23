/**
 * What a gesture means. The hand decides the large shape; this reads it into an operation on the intended solid
 * (model.ts), and the model's rules work out what it takes to stand.
 *
 * - **Tap** raises: bare stone, a plinth; a top, another course; a side, the stone pushed out that way (if there's
 *   nothing under it, the rules carry it on an arch or a pier). Never into a stair's way (`World.way`): a wall traced
 *   across one leaves a gap there, a connection stops short of one.
 * - **Trace** extends or joins, by where it starts and where it ends:
 *   - from the bare stone to the bare stone: a wall along it;
 *   - from a top (or a side: the course touched), out over anything: a walkway at that height;
 *   - to a top of another height (from the stone, or from a top): steps and landings along it, climbing evenly,
 *     resting on what's beneath or on arches and piers.
 *   Each of those is kept as a connection (model.ts): the intent, its stone worked out on replay, never cutting the
 *   hand's stone (it stops where it meets it). Steps go only where the way runs straight (a stair is climbed from its
 *   foot), so a climb with more levels than straight cells isn't built short: it's refused, and says why.
 * - **Never just refused**: each gesture comes with the other ways it could have been meant (`Op.alts`), shown after
 *   it, so reading it otherwise is a touch, not a redraw; and where the plain reading can't be built, the nearest that
 *   can is built instead: a climb too steep for a flight is a stair tower, a way blocked at its height goes round,
 *   a tap in a stair's way raises the cell beside it instead (the way kept open), and offers itself anyway.
 * - **More of the stroke is read**: one that comes back to where it began walls in a court (a gate where it started);
 *   where the finger paused, a gate in a wall, or a landing in a flight.
 * - **Carving** (the take brush's stroke): each piece of stone it passes over is cut away (a top lowered a course; a
 *   side cut through, so what's over it is carried on an arch).
 */
import { hash } from '../kit/rng';
import { standing, through } from './nav';
import { buildings, underRoof } from './buildings';
import { plantStroke, plantTap } from './green';
import { CEIL, DIRS, DRESS, RULE, World, inGrid, key, straighten, straights, unkey, type Alt, type Cell, type Op } from './model';

/** what a touch struck: the stone slab (`hit[0]` −1), a top, or a side; `hit` the cell struck, `to` the free cell on that
 * face's side; `inset`, how squarely */
export interface Pick { face: 'ground' | 'top' | 'side'; hit: Cell; to: Cell; /** how far inside the face struck the touch is, from its nearest edge (0 at an edge, 0.5 at its middle) */ inset?: number }

/** the height of the surface a touch is on: the slab is 0, a top is the level above its stone, a side is the course
 * touched (what's built from it goes out at that course, not from the top of the column) */
export function surface(w: World, p: Pick): number {
  if (p.face === 'ground') return w.ground(p.hit[1], p.hit[2]);
  if (p.face === 'side') return p.hit[0] + 1;
  return w.topFrom(p.hit[0], p.hit[1], p.hit[2]);
}

/** the cell a tap would raise */
export const tapCell = (w: World, p: Pick): Cell => (p.face === 'ground' ? [w.ground(p.hit[1], p.hit[2]), p.hit[1], p.hit[2]] : p.face === 'top' ? [w.topFrom(p.hit[0], p.hit[1], p.hit[2]), p.hit[1], p.hit[2]] : p.to);

/** a gesture that can't be built as it was meant: why, and what it could be instead */
export interface Refusal { refused: string; alts?: Alt[] }

export function tap(w: World, p: Pick, now: number, anyway = false, intent: Intent = 'mass'): Op | Refusal | null {
  const op = tapRead(w, p, now, anyway, intent);
  // (a plant touched grows, whatever's in hand; and anywhere something could grow, planting it is another reading)
  if (!anyway && isPlant(w, p)) { const g = plantTap(w, p.hit, now); if (g && !('refused' in g)) return { ...g, alts: [...(g.alts ?? []), ...(op && !('refused' in op) ? [{ label: op.reading ?? op.note ?? 'as before', op: { ...op, alts: undefined } }] : [])] }; }
  if (anyway || !op || 'refused' in op) return op;
  const g = plantTap(w, p.face === 'side' ? p.to : p.hit, now);
  return g && !('refused' in g) ? { ...op, alts: [...(op.alts ?? []), { label: `${g.reading ?? g.note} here instead`, op: { ...g, alts: undefined } }] } : op;
}
/** whether a touch is on a plant (its trunk, or the cell it grows in) */
const isPlant = (w: World, p: Pick) => { const [k, i, j] = p.hit; return w.plant(k, i, j) >= 0 || w.plant(k + 1, i, j) >= 0 || w.plant(k - 1, i, j) >= 0; };
function tapRead(w: World, p: Pick, now: number, anyway = false, intent: Intent = 'mass'): Op | Refusal | null {
  // (a way's touch on the land's ground: a place to stand, not a block)
  if (intent === 'way' && w.land && p.face === 'ground' && !anyway) { const op = placeToStand(w, p, now); if (op) return op; }
  // (a way's touch on a top: a way up on to it)
  if (intent === 'way' && p.face === 'top' && !anyway) { const op = wayUp(w, p, now); if (op) return op; }
  const [k, i, j] = tapCell(w, p);
  if (k >= CEIL || !inGrid(i, j) || w.stone(k, i, j) || w.stair(k, i, j) >= 0) return null;
  // (never into a stair's way (its foot, its head, the room over them): refused, but offered anyway)
  // (never into a stair's way (its foot, its head, the room over them): raised beside it instead, keeping the way open;
  // in it anyway, another reading)
  if (!anyway && w.way(k, i, j)) {
    const op = tap(w, p, now, true), anyOp = op && !('refused' in op) ? op : null;
    const alts: Alt[] = anyOp ? [{ label: 'raise it anyway', op: { ...anyOp, note: 'raised in the stair\'s way', reading: 'raise it anyway' } }] : [];
    const beside = DIRS.map(([a, b]) => [k, i + a, j + b] as Cell).filter(([kk, x, z]) => inGrid(x, z) && w.free(kk, x, z) && !w.way(kk, x, z) && w.floor(kk, x, z));
    if (beside.length) return { took: ['moved-beside'], add: [[...beside[0], now]], why: 'raise', note: 'raised beside it: the stair\'s way kept open', reading: 'beside the stair', alts };
    // (nowhere beside it: kept open, the one refusal left; held, it can still be raised anyway)
    return { refused: 'that\'s a stair\'s way: kept open', alts };
  }
  // (a thin wall touched goes on as a thin wall: up, or out along its way)
  const thin = p.face === 'top' ? w.wall(k - 1, i, j) : p.face === 'side' ? w.wall(...p.hit) : -1;
  if (thin >= 0) return { walls: [[k, i, j, p.face === 'side' ? (p.hit[1] !== i ? 0 : 1) : thin, now]], why: p.face === 'side' ? 'extend' : 'course' };
  return { add: [[k, i, j, now]], why: p.face === 'side' ? 'extend' : p.face === 'ground' ? 'raise' : 'course' };
}

/**
 * A touch on the land with a way in hand: somewhere to stand. Near the end of a way already made (three cells or less),
 * the way brought on to it; anywhere else, the ground there paved, and round it where it's as level. Raising a block is
 * the other reading.
 */
function placeToStand(w: World, p: Pick, now: number): Op | null {
  const [, i, j] = p.hit, g = w.ground(i, j);
  if (!standing(w, g, i, j)) return null;
  const raise = tap(w, p, now, true), alts: Alt[] = raise && !('refused' in raise) ? [{ label: 'raise a block', op: { ...raise, note: 'a block raised', reading: 'raise a block' } }] : [];
  if (w.paved(i, j)) return null;
  // (the nearest paving within reach: the way brought on to here)
  let near: [number, number] | null = null, d0 = 4;
  for (let x = i - 3; x <= i + 3; x++) for (let z = j - 3; z <= j + 3; z++) { const d = Math.abs(x - i) + Math.abs(z - j); if (d && d < d0 && w.paved(x, z)) { near = [x, z]; d0 = d; } }
  if (near && d0 === 1) return { pave: [[i, j]], born: now, why: 'place', note: 'the way brought on to here', reading: 'the way brought on to here', alts };
  if (near) {
    const cells = connect([near, [i, j]]), op = way(w, w.ground(near[0], near[1]), cells, null, now, () => false);
    if (op && !('refused' in op)) { const note = 'the way brought on to here'; return { ...op, note, reading: note, alts: [...alts, ...(op.alts ?? [])] }; }
  }
  const pave: Array<[number, number]> = [[i, j], ...DIRS.map(([a, b]) => [i + a, j + b] as [number, number]).filter(([x, z]) => inGrid(x, z) && w.ground(x, z) === g && standing(w, g, x, z) && !w.paved(x, z))];
  return { pave, born: now, why: 'place', note: 'a place to stand, paved', reading: 'a place to stand', alts };
}

/**
 * A top touched with a way in hand: a way up on to it, a flight from the ground beside it, straight in from whichever
 * side one will stand (beginning by a way already made, where there is one), laying least. On a house's roof, the
 * same: arriving there makes the house a tower, its roof a terrace. Another course, the other reading.
 */
function wayUp(w: World, p: Pick, now: number): Op | Refusal | null {
  const [, i, j] = p.hit, T = surface(w, p);
  const course = tap(w, p, now, true), alts: Alt[] = course && !('refused' in course) ? [{ label: 'raise a course', op: { ...course, note: 'a course raised', reading: 'raise a course' } }] : [];
  // (a house's roof touched with a way in hand: a way up on to it, and the house becomes a tower, its roof a terrace)
  const house = roofed(w).has(`${i}.${j}`);
  let best: { op: Op; score: number } | null = null;
  for (const [a, b] of DIRS) {
    const [x1, z1] = [i - a, j - b];
    if (!inGrid(x1, z1) || w.ground(x1, z1) >= T) continue;
    const climb = T - w.ground(x1, z1), line: Array<[number, number]> = [];
    for (let n = Math.min(climb + 2, 10); n >= 1; n--) line.push([i - a * n, j - b * n]);
    if (!line.every(([x, z]) => inGrid(x, z))) continue;
    const [sx, sz] = line[0], op = way(w, w.ground(sx, sz), [...line, [i, j]], [T, i, j], now, () => false, true);
    if (!op || 'refused' in op) continue;
    const v = new World(w.seed, w.landSeed); v.ops = [...w.ops, op]; v.rebuild();
    if (!v.reached.get(op)?.reached) continue;
    const near = DIRS.some(([c, d]) => w.paved(sx + c, sz + d)) || w.paved(sx, sz) ? 0 : 3, score = adds(w, op) + near;
    if (!best || score < best.score) best = { op, score };
  }
  if (!best) return null;
  const note = `a way up on to ${house ? 'its roof: a terrace now' : 'it'}${best.op.note ? `: ${best.op.note.replace(/^a way: /, '')}` : ''}`;
  return { ...best.op, note, reading: house ? 'a way up on to its roof' : 'a way up on to it', alts: [...alts, ...(best.op.alts ?? [])] };
}

/**
 * Stone touched and drawn straight up the screen, or down it: the part pulled made taller or lower, a course for every
 * course's height the finger's gone. (Up and down the screen is the one way no stroke across the ground ever goes: the
 * grid's sides run aslant on it.) What's pulled is what's under the finger: the column touched, so that's what visibly
 * rises with the hand; or, if it's part of what's selected, all of that. The whole piece it's part of (every top joined
 * to it at that height: a terrace, a run of wall) is the other reading, offered, never taken unasked. Lowered, courses
 * come off, never below the ground.
 */
export function lift(w: World, p: Pick, n: number, now: number, scope: 'part' | 'whole' | Array<[number, number]> = 'part'): Op | Refusal | null {
  if (!n || p.face === 'ground') return null;
  const [k0, i, j] = p.hit;
  // (a flight's steps aren't lifted: said, as a tap on them is)
  if (w.stair(k0, i, j) >= 0) return { refused: 'that\'s a stair\'s way: kept open' };
  if (!w.stone(k0, i, j)) return null;
  const top = w.topFrom(k0, i, j);
  if (w.stair(top - 1, i, j) >= 0 || w.stair(top, i, j) >= 0) return { refused: 'that\'s a stair\'s way: kept open' };
  // (the piece: tops at this height, joined to it, of stone, no stairs)
  const at = (x: number, z: number) => inGrid(x, z) && w.stone(top - 1, x, z) && !w.stone(top, x, z) && w.stair(top, x, z) < 0 && w.stair(top - 1, x, z) < 0;
  const piece: Array<[number, number]> = [[i, j]];
  for (let q = 0; q < piece.length && piece.length < 64; q++) for (const [a, b] of DIRS) { const c: [number, number] = [piece[q][0] + a, piece[q][1] + b]; if (at(...c) && !piece.some((d) => d[0] === c[0] && d[1] === c[1])) piece.push(c); }
  const chosen = Array.isArray(scope) && scope.some(([x, z]) => x === i && z === j);
  const cells: Array<[number, number]> = scope === 'whole' ? piece : chosen ? (scope as Array<[number, number]>) : [[i, j]];
  // (each column from its own top: what's selected needn't all be one height)
  const topOf = (x: number, z: number) => (x === i && z === j ? top : w.topFrom(w.ground(x, z) - 1, x, z));
  const add: Array<[number, number, number, number]> = [], walls: Array<[number, number, number, number, number]> = [], cut: Cell[] = [];
  if (n > 0) {
    for (const [x, z] of cells) { const t = topOf(x, z); if (t <= w.ground(x, z)) continue; for (let k = t; k < t + n && k < CEIL; k++) {
      if (!w.free(k, x, z)) break;
      const thin = w.wall(t - 1, x, z);
      if (thin >= 0) walls.push([k, x, z, thin, now]); else add.push([k, x, z, now]);
    } }
    if (!add.length && !walls.length) return { refused: 'nothing more will stand there' };
  } else {
    // (never the stone a way the hand made walks on: lowered round it, it's left a causeway, the way kept as it was)
    for (const [x, z] of cells) { const t = topOf(x, z); if (w.passage(t, x, z) >= 0) continue; for (let k = t - 1; k >= t + n && k >= w.ground(x, z); k--) cut.push([k, x, z]); }
    if (!cut.length) return null;
  }
  // (and what it does to a way the hand made across it: raised over it, the way goes on under it, through arches (its
  // reserved void); lowered round it, the way's left on a causeway)
  const ways = cells.filter(([x, z]) => w.passage(topOf(x, z), x, z) >= 0).length;
  const m = Math.abs(n), what = (scope === 'whole' && cells.length > 1 ? `, the whole of it (${cells.length} across)` : chosen && cells.length > 1 ? `, all that's selected (${cells.length} across)` : '') + (ways ? (n > 0 ? ', the way across it kept, under arches' : ', the way across it kept, on a causeway') : '');
  const note = `${n > 0 ? 'raised' : 'lowered'} ${m} course${m > 1 ? 's' : ''}${what}`;
  const op: Op = { ...(add.length ? { add } : {}), ...(walls.length ? { walls } : {}), ...(cut.length ? { cut } : {}), born: now, why: n > 0 ? 'lift' : 'lower', note, reading: note, ...(scope === 'whole' && cells.length > 1 ? { took: ['whole-piece'] } : {}) };
  // (the other readings: the whole piece, pulled from the part; just the column, from what's selected)
  if (scope === 'whole') return op;
  const other = chosen ? lift(w, p, n, now, 'part') : piece.length > 1 ? lift(w, p, n, now, 'whole') : null;
  const label = chosen ? 'just this column' : `the whole of it (${piece.length} across)`;
  return other && !('refused' in other) ? { ...op, alts: [{ label, op: { ...other, alts: undefined } }] } : op;
}

/** what kind of wall a stroke from here makes: plain, gated or arcaded (the rules' choice, seeded by where it starts) */
export function wallKind(w: World, i: number, j: number): 'plain' | 'gated' | 'arcaded' {
  const r = hash(w.seed, i, j, 31) % 100;
  return r < 25 ? 'arcaded' : r < 60 ? 'gated' : 'plain';
}

/**
 * A stroke's cells with its jogs taken out: a step aside and straight back again (a hand's wobble, a cell off the line
 * and back) gone, so it runs straight on there. What it was drawn round, and its turns that stay turned, it keeps.
 */
export function unjog(cells: Array<[number, number]>, deep = true): Array<[number, number]> {
  const out = cells.slice();
  for (let q = 0; q + 3 < out.length; ) {
    const [a, d] = [out[q], out[q + 3]];
    // (each jog taken out, and what that leaves looked at again; not `deep`, a hairpin folded back on purpose is left)
    if (Math.abs(a[0] - d[0]) + Math.abs(a[1] - d[1]) === 1) { out.splice(q + 1, 2); q = deep ? Math.max(0, q - 2) : q + 1; } else q++;
  }
  return out;
}

/** cells, in order, 4-connected: a diagonal step taken as two, the way the stroke leaned */
export const connect = (path: Array<[number, number]>) => walk(path).cells;
/** the same, and whether the stroke came back round to where it began (a ring of eight cells or more: room for a
 * court inside): a loop */
export function walk(path: Array<[number, number]>): { cells: Array<[number, number]>; closed: boolean } {
  const out: Array<[number, number]> = [];
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
  const beside = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
  const round = () => out.length >= 8 && beside(out[out.length - 1], out[0]);
  for (const c of path) {
    const last = out[out.length - 1];
    if (last && same(last, c)) continue;
    // (back at its start, from beside it: closed)
    if (out.length && same(c, out[0]) && round()) return { cells: out, closed: true };
    if (last && Math.abs(last[0] - c[0]) + Math.abs(last[1] - c[1]) > 1) {
      // (walk to it a cell at a time, the longer way first)
      let [x, z] = last;
      while (x !== c[0] || z !== c[1]) {
        if (Math.abs(c[0] - x) >= Math.abs(c[1] - z)) x += Math.sign(c[0] - x); else z += Math.sign(c[1] - z);
        if (same([x, z], out[0]) && round()) return { cells: out, closed: true };
        if (!out.some((o) => o[0] === x && o[1] === z) || (x === c[0] && z === c[1])) out.push([x, z]);
      }
      continue;
    }
    // (a stroke doubling back on itself: what it went over twice, once; but come back across where it went long before,
    // eight cells round or more, it's closed a ring there (a lasso, or a ring drawn on past its start): the ring)
    const back = out.findIndex((o) => o[0] === c[0] && o[1] === c[1]);
    if (back >= 0 && out.length - back >= 8) return { cells: out.slice(back), closed: true };
    if (back >= 0) { out.length = back + 1; continue; }
    out.push(c);
  }
  // (ending beside where it began, it's closed too)
  return { cells: out, closed: round() };
}

/**
 * A trace: from where it started (`start`), over the columns the stroke crossed (`path`, the start's own first), to
 * where it ended (`end`: a top it reached, or null). `born(i, j)` says when a wall's cells were passed over (laid behind
 * the finger); `rest`, the cells the finger paused on. Returns the operation (a wall, a connection, a stair tower) with
 * the other ways it could be read, or why it can't be built.
 */
/** how much an op would lay that isn't there already: stone, steps, paving, piers (worked out on a copy) */
export function adds(w: World, op: Op): number {
  const sim = new World(w.seed, w.landSeed); sim.ops = [...w.ops, op]; sim.rebuild();
  let n = 0;
  // (what it lays itself: not what meetings make of it, laid round it (a way that lays nothing isn't made something by
  // the arch or the floor a meeting puts beside it))
  if (op.connect) { const r = sim.reached.get(op); return (r?.cells.length ?? 0) + op.connect.path.filter(([i, j]) => sim.paved(i, j) && !w.paved(i, j)).length; }
  for (const v of sim.mass.keys()) if (!w.mass.has(v) && !sim.derivedMass.has(v)) n++;
  for (const v of sim.stairs.keys()) if (!w.stairs.has(v)) n++;
  for (const v of sim.paving) if (!w.paving.has(v)) n++;
  for (const v of sim.piers.keys()) if (!w.piers.has(v)) n++;
  for (const v of sim.ladders.keys()) if (!w.ladders.has(v)) n++;
  return n;
}

/**
 * A stroke read (`reading`), and never one that says it's something and lays nothing: if what it would be stands
 * nowhere (a walkway from a step with nothing to carry it, a way over paving already laid), it's said, not built; and
 * its other readings that do lay something are offered with it (held, chosen), not taken in its place: another kind
 * of thing than was drawn is the hand's to choose.
 */
export function trace(w: World, start: Pick, path: Array<[number, number]>, end: Pick | null, born: (i: number, j: number) => number, now = 0, rest: Array<[number, number]> = [], intent: Intent = 'mass'): Op | Refusal | null {
  const op = laid(w, start, path, end, born, now, rest, intent);
  // (on the ground, planting along it (a row, a hedge) or in what it rings (a grove) is another reading (green.ts));
  // where stone would add nothing there, or can't be laid, the planting's offered, never chosen in its place: a stroke
  // for stone that becomes trees is too far from what was drawn)
  if (start.face === 'ground' && (!op || 'refused' in op || op.why === 'wall' || op.why === 'way')) {
    const walked = walk(path), g = plantStroke(w, walked.closed ? walked.cells : unjog(walked.cells), walked.closed, now);
    if (g && !('refused' in g)) {
      const plant = { label: g.reading ?? g.note ?? 'planted along it', op: { ...g, alts: undefined } };
      if (!op) return { refused: 'nothing to lay along that', alts: [plant, ...(g.alts ?? [])] };
      if ('refused' in op) return { ...op, alts: [...(op.alts ?? []), plant, ...(g.alts ?? [])] };
      // (one planting offered, not two: the fan's room is for the other ways it could be built)
      return withMeeting(w, { ...op, alts: [...(op.alts ?? []), { label: g.reading ?? g.note ?? 'planted along it', op: { ...g, alts: undefined } }] });
    }
  }
  return withMeeting(w, op);
}
/**
 * What a stroke is for, with nothing in hand to say: read from where it's drawn. Going somewhere is a way: up or down
 * to a top at another height, along paving, or from or to a place one goes from (a door, a flight's foot, the end of a
 * way, a ladder's foot); a stroke from a top, along it or out from it, is mass. On open ground with neither, the land
 * asks for a way and the slab for a wall.
 */
export function meant(w: World, start: Pick, path: Array<[number, number]>, end: Pick | null): Intent {
  const h0 = surface(w, start), cells = walk(path).cells;
  if (end && end.face !== 'ground' && surface(w, end) !== h0) return 'way';
  if (start.face !== 'ground') return end?.face === 'ground' && surface(w, end) < h0 ? 'way' : 'mass';
  if (cells.filter(([i, j]) => w.paved(i, j)).length >= Math.max(2, cells.length * 0.6)) return 'way';
  const ends = [cells[0], cells[cells.length - 1]].filter(Boolean);
  if (ends.some(([i, j]) => isPlace(w, i, j))) return 'way';
  return w.land ? 'way' : 'mass';
}
/** a place on the ground one goes from or to: paving, a door beside it, a flight's foot, a ladder's foot */
function isPlace(w: World, i: number, j: number): boolean {
  if (!inGrid(i, j)) return false;
  const g = w.ground(i, j), doors = buildings(w).at;
  if (w.paved(i, j) || w.ladders.has(key(g, i, j))) return true;
  return DIRS.some(([a, b], d) => {
    const x = i + a, z = j + b, s = w.stair(g, x, z);
    return (s >= 0 && DIRS[s][0] === -a && DIRS[s][1] === -b) || w.paved(x, z) || doors.get(`${g}.${x}.${z}.${(d + 2) % 4}`)?.kind === 'door';
  });
}
/** the same stone (and the same way) laid, whatever it's called: two readings that are one */
const same = (a: Op, b: Op) => JSON.stringify([a.add, a.walls, a.arches, a.stairs, a.pave, a.connect && [a.connect.from, a.connect.to, a.connect.path]]) === JSON.stringify([b.add, b.walls, b.arches, b.stairs, b.pave, b.connect && [b.connect.from, b.connect.to, b.connect.path]]);
/** two readings made one: the first as it is, the other offered with it (or in its place, if the first won't stand) */
function either(first: Op | Refusal | null, other: Op | Refusal | null): Op | Refusal | null {
  const ok = (o: Op | Refusal | null): o is Op => !!o && !('refused' in o);
  const alt = (o: Op): Alt => ({ label: o.reading ?? o.note ?? o.why ?? 'otherwise', op: { ...o, alts: undefined } });
  if (ok(first)) {
    if (!ok(other) || same(first, other)) return first;
    const alts = [...(first.alts ?? [])];
    if (!alts.some((a) => same(a.op, other))) alts.push(alt(other));
    return { ...first, alts };
  }
  if (ok(other)) { const alts: Alt[] = []; for (const a of [...(other.alts ?? []), ...(first?.alts ?? []).filter((x) => !same(x.op, other))]) if (!alts.some((b) => b.label === a.label)) alts.push(a); return { ...other, alts }; }
  if (first && other) return { refused: first.refused, alts: [...(first.alts ?? []), ...(other.alts ?? [])] };
  return first ?? other;
}
/** a stroke, read as what it's for from where it's drawn (`meant`), the other kind of thing offered with it */
export function stroke(w: World, start: Pick, path: Array<[number, number]>, end: Pick | null, born: (i: number, j: number) => number, now = 0, rest: Array<[number, number]> = [], both = true): Op | Refusal | null {
  const m = meant(w, start, path, end), first = trace(w, start, path, end, born, now, rest, m);
  // (while it's being drawn, only what it's read as (the other's for when it's let go, or held))
  if (!both && first && !('refused' in first)) return first;
  return either(first, trace(w, start, path, end, born, now, rest, m === 'way' ? 'mass' : 'way'));
}
/** a tap, read without an intent: raised, with a way up on to it, or a place to stand, offered with it */
export function touch(w: World, p: Pick, now: number): Op | Refusal | null {
  return either(tap(w, p, now, false, 'mass'), tap(w, p, now, false, 'way'));
}
function withMeeting(w: World, op: Op | Refusal | null): Op | Refusal | null {
  // (only a way can meet another, so far: the rest needn't be tried)
  return op && !('refused' in op) && op.connect ? meeting(w, op) : op;
}

/**
 * Where a stroke meets another of the hand's things (encounters.ts): what the meeting comes to, said with it, and what
 * else it could be offered as other readings (held, chosen; the choice kept on the stroke as `Op.choose`).
 */
function meeting(w: World, op: Op): Op {
  const sim = new World(w.seed, w.landSeed); sim.ops = [...w.ops, op]; sim.rebuild();
  const m = sim.meetings.find((q) => q.by.includes(w.ops.length) && q.candidates.length > 1);
  if (!m) return op;
  const where = m.where ?? 'where it meets', now = m.candidates.find((c) => c.level === m.laid), note = now ? `${op.note ?? op.reading ?? op.why}; ${where}: ${now.label}` : op.note;
  const others: Alt[] = m.candidates.filter((c) => c.level !== m.laid).map((c) => ({ label: `${where}: ${c.label}`, op: { ...op, alts: undefined, choose: [...(op.choose ?? []), [...m.anchor, c.level] as [number, number, number, number]], note: `${op.note ?? op.why}; ${where}: ${c.label}` } }));
  return { ...op, note, alts: [...(op.alts ?? []), ...others] };
}

/** a stroke read, and what it lays (never something that says it's something and lays nothing) */
function laid(w: World, start: Pick, path: Array<[number, number]>, end: Pick | null, born: (i: number, j: number) => number, now = 0, rest: Array<[number, number]> = [], intent: Intent = 'mass'): Op | Refusal | null {
  const op = reading(w, start, path, end, born, now, rest, intent);
  if (op && ('refused' in op || adds(w, op))) return op;
  // (what it says is there already (or nothing at all, over what's built): drawn again, it's more of it, where the hand
  // drew)
  // (not a stroke going somewhere else: one ending on a top of another height is a climb, not a repetition)
  const elsewhere = !!end && end.face !== 'ground' && surface(w, end) !== surface(w, start);
  const more = path.length > 1 && !elsewhere ? again(w, walk(path).cells, intent, now) : null;
  if (more) return { ...more, ...(op?.alts?.length ? { alts: op.alts.filter((a) => adds(w, a.op)) } : {}) };
  if (!op) return op;
  const others = (op.alts ?? []).filter((a) => adds(w, a.op)).map((a) => ({ ...a, op: { ...a.op, took: [...(a.op.took ?? []), 'chosen-instead'] } }));
  // (a fallback that lays nothing says what it fell back from)
  const why = /^too steep[^:]*/.exec(op.note ?? '')?.[0];
  return { refused: why ? `${why}: draw it longer, or straighter` : `nothing to lay along that: ${op.reading ?? op.note ?? 'it'} would add nothing that isn't there`, ...(others.length ? { alts: others } : {}) };
}

/**
 * A gesture made again over what it made before (what it reads as is there already): not "nothing to lay" but more of
 * it, where the hand drew. A way again is wider (paved alongside, where the ground's as level), and again after that
 * covered (a pergola over it); a wall, a court's ring, any stone drawn along again rises a course. Null if the stroke
 * isn't over anything to develop.
 */
function again(w: World, cells: Array<[number, number]>, intent: Intent, now: number): Op | null {
  const built = (i: number, j: number) => w.topFrom(w.ground(i, j) - 1, i, j) > w.ground(i, j);
  if (intent === 'way') {
    const on = cells.filter(([i, j]) => w.paved(i, j));
    if (on.length < Math.max(2, cells.length * 0.6)) return null;
    // (wider: the cells beside it, across the way it runs, as level as it and free)
    const pave: Array<[number, number]> = [], seen = new Set(cells.map(([i, j]) => `${i}.${j}`));
    on.forEach(([i, j], q) => {
      const nb = on[q + 1] ?? on[q - 1], across = nb && nb[0] !== i ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
      for (const [a, b] of across) { const x = i + a, z = j + b, g = w.ground(i, j); if (seen.has(`${x}.${z}`) || !inGrid(x, z) || w.paved(x, z) || w.ground(x, z) !== g || !standing(w, g, x, z)) continue; seen.add(`${x}.${z}`); pave.push([x, z]); }
    });
    if (pave.length >= 2) return { pave, born: now, why: 'way', note: 'again: the way widened', reading: 'the way widened', took: ['again'] };
    // (wide already: covered, a pergola over it)
    const over = on.map(([i, j]) => [w.ground(i, j), i, j] as Cell).filter(([k, i, j]) => w.free(k, i, j) && w.floor(k, i, j) && !w.dress.get(key(k, i, j))?.pergola);
    if (over.length >= 2) return { dress: over.map(([k, i, j]) => [k, i, j, DRESS.pergola, 1] as [number, number, number, number, number]), born: now, why: 'dress', note: 'again: the way covered, a pergola over it', reading: 'the way covered', took: ['again'] };
    return null;
  }
  // (stone drawn along again: a course higher, each column from its own top, where nothing's in a stair's way. Along it:
  // most of the stroke over what's built, at one height, as a wall or a court's ring is)
  const on = cells.filter(([i, j]) => built(i, j)), tops = new Map<number, number>();
  for (const [i, j] of on) { const t = w.topFrom(w.ground(i, j) - 1, i, j); tops.set(t, (tops.get(t) ?? 0) + 1); }
  if (on.length < Math.max(2, cells.length * 0.8) || Math.max(...tops.values()) < on.length * 0.8) return null;
  const add: Array<[number, number, number, number]> = [], walls: Array<[number, number, number, number, number]> = [];
  for (const [i, j] of on) {
    const t = w.topFrom(w.ground(i, j) - 1, i, j);
    if (t >= CEIL || !w.free(t, i, j) || w.way(t, i, j) || w.stair(t - 1, i, j) >= 0) continue;
    const thin = w.wall(t - 1, i, j);
    if (thin >= 0) walls.push([t, i, j, thin, now]); else add.push([t, i, j, now]);
  }
  if (add.length + walls.length < 2) return null;
  return { ...(add.length ? { add } : {}), ...(walls.length ? { walls } : {}), born: now, why: 'course', note: 'again: a course higher along it', reading: 'a course higher', took: ['again'] };
}

/** a stroke read as it is, with the liberties taken with it (`Op.took`) */
/** a stroke read as drawn, every turn kept (offered when the reading smoothed its jogs away: `smoothed`) */
export function asDrawn(w: World, start: Pick, path: Array<[number, number]>, end: Pick | null, born: (i: number, j: number) => number, now = 0, rest: Array<[number, number]> = [], intent: Intent = 'mass'): Op | null {
  const op = read(w, start, path, end, born, now, rest, intent, [], true);
  return op && !('refused' in op) && adds(w, op) ? { ...op, alts: undefined, note: `${op.note ?? op.why}, as drawn`, reading: `${op.reading ?? op.note ?? op.why}, as drawn` } : null;
}
export function reading(w: World, start: Pick, path: Array<[number, number]>, end: Pick | null, born: (i: number, j: number) => number, now = 0, rest: Array<[number, number]> = [], intent: Intent = 'mass'): Op | Refusal | null {
  const took: string[] = [], op = read(w, start, path, end, born, now, rest, intent, took);
  return op && !('refused' in op) && (took.length || op.took?.length) ? { ...op, took: [...new Set([...took, ...(op.took ?? [])])] } : op;
}

/**
 * The liberties a reading can take, by name (`Op.took`): each a place where what's built isn't the gesture as made.
 * - wobble: a stray off a top and back, kept on the top; begun-where-it-leaves: drawn along a top first, built from its edge;
 * - arrives-first-reach: a climb ended where it first reached the height, the rest of the stroke left;
 * - begun-beside: begun on a roof or a flight, begun on the ground beside it; from-touched: back to where it was touched;
 * - from-foot: from a top, begun on the ground at its foot; jetty: out over water at the top's height;
 * - routed-round: round something in its way; arrives-along: on to the same top a cell or two from where it ended; skirted: a walk round, round a house; from-bank: begun on the bank;
 * - trimmed: its ends in the water left off; begun-on: begun a cell or more along it;
 * - straightened: its zigzags gathered into runs; smoothed: its jogs (a cell aside and back) run straight, the stroke
 *   as drawn offered; foot-back: a flight's foot laid behind where it began;
 * - tower-instead, walkway-instead, wall-instead, court-instead: another kind of thing than drawn;
 * - chosen-instead: offered in place of a reading that lays nothing; moved-beside: a tap moved off a stair's way;
 * - whole-piece: a lift of all the top joined at that height, not just the column touched.
 */
function read(w: World, start: Pick, path: Array<[number, number]>, end: Pick | null, born: (i: number, j: number) => number, now: number, rest: Array<[number, number]>, intent: Intent, took: string[], exact = false): Op | Refusal | null {
  // (a stroke ending on a top at another height than it began climbs (or goes down): folded back on itself, to gain the
  // length its steps need, its fold's meant, not a jog to smooth away, nor a ring drawn round)
  const climbs = !!end && end.face === 'top' && surface(w, end) !== surface(w, start);
  const walked = walk(path), cells = walked.closed || exact ? walked.cells.slice() : unjog(walked.cells, !climbs);
  if (cells.length < walked.cells.length) took.push('smoothed');
  // (a way drawn round, back to within a cell or two of its start: round, too; the gap closed)
  const gap = Math.max(Math.abs(cells[cells.length - 1][0] - cells[0][0]), Math.abs(cells[cells.length - 1][1] - cells[0][1]));
  // (nearly closed: a ring drawn round, its ends a cell or so apart; not one that ends on a top at another height than it
  // began: that's a climb, folded back to gain the length its steps need)
  const nearly = !walked.closed && !climbs && cells.length >= 10 && gap <= (intent === 'way' ? 3 : 2);
  if (nearly) cells.push(...connect([cells[cells.length - 1], cells[0]]).slice(1, -1));
  const closed = walked.closed || nearly;
  const h0 = surface(w, start);
  // (from a top, along it: a stray off its edge and back (a cell or two, beside it) is the hand's wobble, kept on the top)
  if (start.face === 'top' && !closed) {
    const on = (i: number, j: number) => w.stone(h0 - 1, i, j) && !w.stone(h0, i, j) && w.stair(h0, i, j) < 0;
    for (let q = 1; q < cells.length - 1; q++) {
      if (on(...cells[q]) || !on(...cells[q - 1])) continue;
      let r = q; while (r < cells.length && !on(...cells[r]) && r - q < 3) r++;
      // (back on the top and going on along it: a stroke that ends as it comes back is going there, not wobbling)
      if (r < cells.length - 1 && on(...cells[r])) {
        const bridge = connect([cells[q - 1], cells[r]]);
        if (bridge.every(([i, j]) => on(i, j))) { cells.splice(q, r - q, ...bridge.slice(1, -1)); took.push('wobble'); }
      }
    }
  }
  const resting = (i: number, j: number) => rest.some((r) => r[0] === i && r[1] === j);
  // (drawn along the top before it leaves it: what's built goes out from where it leaves, not from where the finger
  // first touched (a connection stops at the first stone it meets, so begun back along the top it would stop at once))
  if (intent === 'mass' && start.face === 'top' && !closed) {
    const on = (i: number, j: number) => w.stone(h0 - 1, i, j) && !w.occupied(h0, i, j);
    const q = cells.findIndex(([i, j]) => !on(i, j));
    if (q > 1) { cells.splice(0, q - 1); took.push('begun-where-it-leaves'); }
  }
  // (where it ends counts if it's a top, not its own start; ending on one, the stroke's a connection the hand insists on)
  let to: Cell | null = null;
  const aimed = !!end && end.face !== 'ground' && !closed;
  // (from a top down to lower ground: going down to it, not out at the top's height)
  // (the stroke's end over open ground, a couple of cells or more clear of the stone it left, and nothing at its height
  // on the way to meet: where it's going down to. No top under the finger at the end counts as nothing in particular,
  // so it's the last cell's ground)
  const last = cells[cells.length - 1], clear = cells.filter(([i, j]) => !w.stone(w.ground(i, j), i, j)).length;
  const q0 = cells.findIndex(([i, j]) => !w.stone(w.ground(i, j), i, j)), meets = q0 > 0 && cells.slice(q0).some(([i, j]) => w.stone(h0, i, j) || w.stone(h0 - 1, i, j));
  // (after the blind reviews: and up to it, where it ends over ground higher than the top it left; read so in either
  // intent, not only with mass in hand: a stroke from a top to ground at another height goes there)
  const lastGround = !end && clear >= 2 && !meets && standing(w, w.ground(last[0], last[1]), last[0], last[1]) && w.ground(last[0], last[1]) !== h0;
  const descent = start.face === 'top' && !closed && ((end?.face === 'ground' && surface(w, end) !== h0) || lastGround);
  if (!closed && end && (end.face !== 'ground' || intent === 'way' || descent) && !(end.hit[1] === cells[0][0] && end.hit[2] === cells[0][1])) {
    to = [surface(w, end), end.hit[1], end.hit[2]];
    // (climbing to a top it crossed onto earlier: it arrives where it first reached it, from the side it came)
    if (to[0] > h0) {
      const top = (i: number, j: number) => w.topFrom(w.ground(i, j) - 1, i, j);
      const q = cells.findIndex(([i, j], n) => n > 0 && n < cells.length - 1 && top(i, j) === to![0] && w.stone(to![0] - 1, i, j));
      // (only if, so shortened, it still has the room to climb there)
      if (q > 0 && straights(cells.slice(0, q), [to[0], cells[q][0], cells[q][1]]).length >= to[0] - h0) { to = [to[0], cells[q][0], cells[q][1]]; cells.length = q + 1; took.push('arrives-first-reach'); }
    }
    // (the way goes in at the first column it passes beside the destination, not on round it)
    const at = cells.findIndex((c) => Math.abs(c[0] - to![1]) + Math.abs(c[1] - to![2]) <= 1);
    if (at >= 0) { cells.length = at + 1; if (cells[at][0] !== to[1] || cells[at][1] !== to[2]) cells.push([to[1], to[2]]); }
    else cells.push(...connect([cells[cells.length - 1], [to[1], to[2]]]).slice(1));
  }
  if (descent && !to) to = [w.ground(last[0], last[1]), last[0], last[1]];
  if (cells.length < 2) return null;
  if (intent === 'way') {
    // (begun on a house's roof, or on a flight's steps: the house, or the flight, is where it's from, not what it's on.
    // It begins on the ground beside it, where the stroke leaves it: never unroofing a house, nor starting halfway up
    // a stair to come down again over stone)
    let wh = h0, wc = cells;
    if (start.face !== 'ground') {
      const [k, i, j] = start.hit, b = buildings(w).of.get(key(k, i, j)), flight = w.stair(k, i, j) >= 0 || w.stair(h0 - 1, i, j) >= 0;
      if ((b && b.roof) || flight) {
        const on = (x: number, z: number) => (b ? b.cols.some((c) => c[0] === x && c[1] === z) : w.stair(w.topFrom(w.ground(x, z) - 1, x, z) - 1, x, z) >= 0);
        const q = cells.findIndex(([x, z]) => !on(x, z));
        if (q > 0 && standing(w, w.ground(cells[q][0], cells[q][1]), cells[q][0], cells[q][1])) { wc = cells.slice(q); wh = w.ground(wc[0][0], wc[0][1]); }
      }
    }
    if (wc !== cells) took.push('begun-beside');
    if (closed) return circuit(w, wh, wc, born, now, resting);
    if (wc.length < 2) return null;
    const off = way(w, wh, wc, to, now, resting);
    // (begun beside it and nothing will stand from there: from where it was touched, then, the flight's own height)
    if ((!off || 'refused' in off) && wc !== cells) { const on = way(w, h0, cells, to, now, resting); if (on && !('refused' in on)) { took.splice(took.indexOf('begun-beside'), 1); return on; } }
    // (from a top, over more stone, and nothing made of it from up there that lays anything and reaches: the way's on the
    // ground it comes down to, from the foot of what it was drawn from)
    const good = (o: Op | Refusal | null): o is Op => !!o && !('refused' in o) && adds(w, o) > 0;
    const there = (o: Op) => { const v = new World(w.seed, w.landSeed); v.ops = [...w.ops, o]; v.rebuild(); return !!v.reached.get(o)?.reached; };
    if (start.face !== 'ground' && !(good(off) && there(off))) {
      const q = cells.findIndex(([i, j], n) => n > 0 && !w.stone(w.ground(i, j), i, j) && w.stair(w.ground(i, j), i, j) < 0 && standing(w, w.ground(i, j), i, j));
      const foot = q > 0 && cells.length - q >= 3 ? way(w, w.ground(...cells[q]), cells.slice(q), to, now, resting) : null;
      if (good(foot) && (there(foot) || !good(off))) return { ...foot, took: [...(foot.took ?? []), 'from-foot'], note: `${foot.note}, from the foot of it`, reading: `${foot.reading ?? foot.note}, from the foot of it` };
    }
    // (from a top out over where nothing stands (water, a drop): out at its height, a jetty, a pier, to walk out on)
    if ((!off || 'refused' in off) && start.face !== 'ground' && cells.length > 2) {
      const out: Op = { connect: { from: [h0, cells[0][0], cells[0][1]], to: null, path: cells }, born: now, why: 'walkway', note: 'a walkway out at its height', reading: 'a walkway out at its height' };
      if (adds(w, out)) return { ...out, took: ['jetty'] };
    }
    return off ?? (wc.length > 2 ? { refused: 'no way along that: nowhere to stand at its ends' } : null);
  }
  // (on the ground, to the ground: a wall along it, each cell on its own column's ground)
  if (start.face === 'ground' && (!to || to[0] === w.ground(to[1], to[2]) && end?.face === 'ground')) return wall(w, cells, closed, born, resting);
  // (from a top out over ground as high as it (a shelf, the land level with the top): a walkway there would lay
  // nothing; it's a wall along that ground, as a stroke on the ground is)
  if (start.face === 'top' && !to && !closed && cells.length > 2 && cells.slice(1).every(([i, j]) => w.ground(i, j) >= h0 && !w.stone(w.ground(i, j), i, j))) {
    const along = wall(w, cells.slice(1), false, born, resting);
    if (along) return { ...along, took: ['wall-instead'] };
  }
  let path2 = to ? cells.slice(0, -1) : cells;
  const climb = to ? Math.abs(to[0] - h0) : 0;
  let room = straights(path2, to).length;
  // (drawn across the grid's axes, a zigzag has no straight run to step on: its zigzags gathered into runs, as a way's are)
  if (to && climb > room) for (const n of [4, 6, 8]) {
    const s = straighten(path2, n), r = straights(s, to).length;
    if (r >= climb && s.every(([i, j]) => inGrid(i, j))) { path2 = s; cells.splice(0, cells.length, ...s, cells[cells.length - 1]); room = r; took.push('straightened'); break; }
  }
  // (begun right at the foot of what it climbs to, a step short: the flight's foot laid back behind where it began,
  // over ground as level as the start's, the way the stroke came)
  if (to && to[0] > h0 && climb > room && climb - room === 1 && start.face === 'ground') {
    const [a, b] = path2[0], [c, d] = path2.length > 1 ? path2[1] : [to[1], to[2]], back: Array<[number, number]> = [];
    back.push([a - (c - a), b - (d - b)]);
    const free = back.every(([i, j]) => inGrid(i, j) && w.ground(i, j) === h0 && standing(w, h0, i, j)) && path2.every(([i, j]) => standing(w, w.ground(i, j), i, j));
    const s = [...back, ...path2];
    if (free && straights(s, to).length >= climb) { path2 = s; cells.unshift(...back); room = straights(s, to).length; took.push('foot-back'); }
  }
  if (path2.length < 2 && !to) return null;
  const levels = climb;
  const make = (p: Array<[number, number]>, great: boolean, note?: string): Op => {
    const restAt = p.slice(1).map(([i, j], q) => (resting(i, j) ? q : -1)).filter((q) => q >= 0);
    const said = note ?? (!to ? 'a walkway' : to[0] === h0 ? (great ? 'a bridge, on one great arch' : 'a bridge') : `${to[0] > h0 ? 'climbing' : 'going down'} ${levels} level${levels > 1 ? 's' : ''}${restAt.length ? ', a landing where you paused' : ''}`);
    return { connect: { from: [h0, p[0][0], p[0][1]], to, path: p, ...(restAt.length && to && to[0] !== h0 ? { rest: restAt } : {}) }, born: now, why: !to ? 'walkway' : to[0] === h0 ? 'bridge' : 'stairs', note: said, reading: said, ...(great ? { bridge: true } : {}) };
  };
  const reaches = (o: Op) => { const sim = new World(w.seed, w.landSeed); sim.ops = [...w.ops, o]; sim.rebuild(); return !!sim.reached.get(o)?.reached; };
  /** a flight round what's in the way, straight into the destination; or else on to the same top a cell or two along
   * (the top's what the hand went to, as surely as the column): no more than `extra` cells longer than the stroke (a
   * route round much longer is more the reader's than the hand's: a tower's nearer what was drawn); null if none */
  const round = (extra: number): Op | null => {
    if (!to || to[0] === h0) return null;
    const say = (rest: string) => `${to[0] > h0 ? 'climbing' : 'going down'} ${levels} level${levels > 1 ? 's' : ''}, ${rest}`;
    const near = (r: Array<[number, number]>) => r.length <= path2.length + extra && (extra === Infinity || r.every((c) => cells.some((d) => Math.max(Math.abs(c[0] - d[0]), Math.abs(c[1] - d[1])) <= 1)));
    const route = approach(w, h0, path2, to), routed = route && near(route) ? make(route, false, say('round what\'s in the way')) : null;
    if (routed && reaches(routed)) return { ...routed, took: ['routed-round'] };
    for (const d of sameTop(w, to, 2)) {
      const r2 = approach(w, h0, path2, [to[0], d[0], d[1]]);
      if (!r2 || !near(r2)) continue;
      const o = make(r2, false, say('on to the top a cell along')), there2: Op = { ...o, connect: { ...o.connect!, to: [to[0], d[0], d[1]] }, took: ['arrives-along'] };
      if (reaches(there2)) return there2;
    }
    return null;
  };
  const tower = to && to[0] !== h0 ? stairTower(w, h0, cells, to, now) : null;
  if (climb > room) {
    // (too steep for a flight along it: round what's in the way to one that fits, or a stair tower, climbing inside, if one
    // will stand; else it's refused, saying why)
    const fits = round(2), far = fits ? null : round(Infinity);
    if (fits) return tower ? { ...fits, alts: [{ label: 'a stair tower', op: tower }] } : fits;
    // (folded back on itself beside the stroke, still a flight: a switchback; the tower the other reading)
    const sw = to && to[0] > h0 ? switchback(w, h0, cells, to, now) : null;
    const lad = to && to[0] > h0 ? ladder(w, h0, cells, to, now) : null;
    const light = [...(lad ? [{ label: 'a ladder', op: lad }] : []), ...(tower ? [{ label: 'a stair tower', op: tower }] : [])];
    if (sw) return { ...sw, took: ['switchback'], alts: [...light, ...(far ? [{ label: 'a flight round what\'s in the way, further off', op: far }] : [])] };
    // (else the lightest way up: a ladder against it; the stair tower the other reading)
    if (lad) return { ...lad, took: ['ladder-instead'], alts: [...(tower ? [{ label: 'a stair tower', op: tower }] : []), ...(far ? [{ label: 'a flight round what\'s in the way, further off', op: far }] : [])] };
    if (tower) return { ...tower, took: ['tower-instead'], ...(far ? { alts: [{ label: 'a flight round what\'s in the way, further off', op: far }] } : {}) };
    // (ending on a top: the connection's what the hand insisted on, how it gets there the world's; round, further off)
    if (aimed && far) return far;
    // (going down from a top, too steep for a flight here: out at the top's height, as it would be read without the drop)
    if (descent) return { took: ['walkway-instead'], connect: { from: [h0, cells[0][0], cells[0][1]], to: null, path: cells }, born: now, why: 'walkway', note: `too steep to go down here (${climb} level${climb > 1 ? 's' : ''}): a walkway out at its height`, reading: 'a walkway' };
    // (and if no tower will stand: a walkway out toward it at the height it starts from, to climb from later)
    const said = `too steep to climb here (${climb} level${climb > 1 ? 's' : ''}, room for ${room} step${room === 1 ? '' : 's'}): a walkway out toward it`;
    return path2.length >= 2 ? { took: ['walkway-instead'], connect: { from: [h0, path2[0][0], path2[0][1]], to: null, path: path2 }, born: now, why: 'walkway', note: said, reading: 'a walkway toward it' } : { refused: `too steep: ${climb} level${climb > 1 ? 's' : ''} to climb, and room for ${room} step${room === 1 ? '' : 's'}; draw it longer, or straighter` };
  }
  // (a bridge four to seven long: one great arch, or an arcade, as the rules choose for where it runs; the other offered)
  const spans = !!to && to[0] === h0 && path2.length >= 5 && path2.length <= 8;
  const great = spans && hash(w.seed, cells[0][0], cells[0][1], to![1], to![2]) % 100 < 50;
  const alts: Alt[] = [];
  let op = make(path2, great);
  if (descent) alts.push({ label: 'a walkway at the height it starts', op: { connect: { from: [h0, cells[0][0], cells[0][1]], to: null, path: cells }, born: now, why: 'walkway', note: 'a walkway', reading: 'a walkway' } });
  if (spans) alts.push({ label: great ? 'a bridge on an arcade' : 'a bridge on one great arch', op: make(path2, !great, great ? 'a bridge, on an arcade' : 'a bridge, on one great arch') });
  // (at one height, and something in the way: round it, the way through it offered. Unless it goes through as drawn,
  // a passage through what's in the way at that height (a tower a cell to three thick): then through, round offered)
  const piercing = !!to && to[0] === h0 && reaches(op) && (() => { const v = new World(w.seed, w.landSeed); v.ops = [...w.ops, op]; v.rebuild(); return path2.some(([i, j]) => v.archway(h0, i, j) >= 0 && w.stone(h0, i, j) && (w.archway(h0, i, j) < 0 || v.cross(h0, i, j))); })();
  if (piercing) {
    const round0 = around(w, h0, path2, to!);
    if (round0) alts.push({ label: 'a bridge round it', op: { ...make(round0, false, 'a bridge, round what\'s in the way'), took: ['routed-round'] } });
    op = { ...op, note: `${op.note ?? 'a bridge'}, through what's in its way`, reading: `${op.reading ?? op.note ?? 'a bridge'}, through what's in its way` };
  } else if (to && to[0] === h0) {
    const round0 = around(w, h0, path2, to), close = !!round0 && round0.every((c) => cells.some((d) => Math.max(Math.abs(c[0] - d[0]), Math.abs(c[1] - d[1])) <= 1));
    if (round0 && !close) alts.push({ label: 'a bridge round it, further off', op: { ...make(round0, false, 'a bridge, round what\'s in the way'), took: ['routed-round'] } });
    const round = close ? round0 : null;
    if (round) {
      const through = op; op = { ...make(round, false, 'a bridge, round what\'s in the way'), took: ['routed-round'] };
      // (its arch offered round the same way, not through what's in it)
      const arch = alts.findIndex((a) => a.label.startsWith('a bridge on'));
      if (arch >= 0) alts.splice(arch, 1, ...(round.length >= 5 && round.length <= 8 ? [{ label: 'a bridge round it, on one great arch', op: make(round, true, 'a bridge, round what\'s in the way, on one great arch') }] : []));
      alts.unshift({ label: 'joining what it meets', op: { ...through, note: 'joining what it meets', reading: 'joining what it meets' } });
    }
  }
  if (to && to[0] !== h0) {
    // (a climb that would stop short of where it's going, on something in its way: round it to a straight flight into
    // the destination, or else the tower, if either will stand; the flight as drawn offered, joining what it meets)
    if (!reaches(op)) {
      const flight = op, near = round(2), far = near ? null : round(Infinity);
      // (a flight further round than a cell off the stroke is another place: offered, never built unasked)
      const sw = near ? null : switchback(w, h0, cells, to, now), lad = near || sw ? null : ladder(w, h0, cells, to, now);
      const better = near ?? (sw ? { ...sw, took: ['switchback'] } : lad ? { ...lad, took: ['ladder-instead'] } : tower ? { ...tower, took: ['tower-instead'] } : aimed ? far : null);
      if (better) {
        op = better; alts.unshift({ label: 'joining what it meets', op: { ...flight, note: 'joining what it meets', reading: 'joining what it meets' } });
        if (better.why !== 'tower' && tower) alts.push({ label: 'a stair tower', op: tower });
      }
      if (far && better !== far) alts.push({ label: 'a flight round what\'s in the way, further off', op: far });
    } else if (tower) alts.push({ label: 'a stair tower', op: tower });
  }
  return alts.length ? { ...op, alts } : op;
}

/** what a stroke's for: mass (raise, extend, enclose: a stroke on the ground is a wall) or a way (it connects places,
 * and the land says how: paving, flights, a bridge) */
export type Intent = 'mass' | 'way';

/**
 * A way, along the stroke as it was drawn, from where it started to where it ended (a top, or the ground: the end of
 * the stroke if it ended on nothing): following the ground (`Connect.follow`), paved where it walks on it, a flight
 * where it rises or falls along a straight run, a bridge where it must cross low ground or water. What it comes to is
 * said before it's let go; a stair tower and a walkway at the start's height are offered, and where it can't be made to
 * reach as drawn, the tower is what's offered first.
 */
function way(w: World, h0: number, cells: Array<[number, number]>, to: Cell | null, now: number, resting: (i: number, j: number) => boolean, direct = false): Op | Refusal | null {
  // (the liberties taken with the stroke on the way, marked on what it comes to)
  const lib: string[] = [], mark = (o: Op, ...t: string[]): Op => { const all = [...new Set([...(o.took ?? []), ...lib, ...t])]; return all.length ? { ...o, took: all } : o; };
  const n0 = cells.length;
  // (it starts at the first place along it that can be stood on, and ends at the last: begun in the water, or run off
  // into it, it's the way to and from its banks)
  if (h0 === w.ground(cells[0][0], cells[0][1]) && !standing(w, h0, cells[0][0], cells[0][1])) {
    // (begun in the water at its edge: from the bank behind it, across it, the way the stroke went)
    const [i0, j0] = cells[0], next = cells[1], back = DIRS.map(([a, b]) => [i0 + a, j0 + b] as [number, number])
      .filter(([x, z]) => inGrid(x, z) && standing(w, w.ground(x, z), x, z) && !cells.some((c) => c[0] === x && c[1] === z))
      .sort((p, q) => (next ? Math.hypot(q[0] - next[0], q[1] - next[1]) - Math.hypot(p[0] - next[0], p[1] - next[1]) : 0));
    if (back.length) { cells = [back[0], ...cells]; h0 = w.ground(...back[0]); lib.push('from-bank'); }
  }
  if (h0 === w.ground(cells[0][0], cells[0][1]) && !standing(w, h0, cells[0][0], cells[0][1])) {
    const q = cells.findIndex(([i, j]) => standing(w, w.ground(i, j), i, j));
    if (q < 0) return { refused: 'that\'s all water: a way wants somewhere to stand' };
    cells = cells.slice(q); h0 = w.ground(cells[0][0], cells[0][1]); lib.push('trimmed');
  }
  if (!to) while (cells.length > 2) { const [i, j] = cells[cells.length - 1]; if (standing(w, w.ground(i, j), i, j)) break; cells = cells.slice(0, -1); }
  if (!to && cells.length < n0 && !lib.includes('from-bank')) lib.push('trimmed');
  // (drawn through a tree on the ground: bowed round it there, a cell out and back, before it's followed, so it gives
  // way to the tree wherever it is, in a court or out (yield); the rest of it as drawn)
  const crowned = (i: number, j: number) => w.crown(w.ground(i, j), i, j);
  for (let q = 1; q < cells.length - 1; q++) {
    if (!crowned(...cells[q])) continue;
    let e = q; while (e + 1 < cells.length - 1 && crowned(...cells[e + 1])) e++;
    const sub = detour(w, cells.slice(q - 1, e + 2), new Set(cells.slice(q, e + 1).map(([i, j]) => `${i}.${j}`)), 1);
    if (sub && !sub.some(([i, j]) => crowned(i, j))) { cells = [...cells.slice(0, q - 1), ...sub, ...cells.slice(e + 2)]; q += sub.length - 3; if (!lib.includes('bowed')) lib.push('bowed'); }
    else q = e;
  }
  const last = cells[cells.length - 1];
  const dest: Cell = to ?? [w.ground(last[0], last[1]), last[0], last[1]];
  const path = cells.slice(0, -1);
  if (!path.length || (path.length === 1 && dest[0] === h0 && !to)) return null;
  // (from a place to stand, to one: never from the water, or into it)
  // (ending on somewhere that can't be stood on (in the water, under a tree): it ends at the last place along it that can)
  if (!(standing(w, ...dest) || through(w, ...dest))) {
    let q = cells.length - 2;
    while (q > 0 && !standing(w, w.ground(cells[q][0], cells[q][1]), cells[q][0], cells[q][1])) q--;
    if (q > 0 && q < cells.length - 1) { const short = way(w, h0, cells.slice(0, q + 1), null, now, resting); return short && !('refused' in short) ? mark(short, 'trimmed') : short; }
  }
  if (!standing(w, h0, path[0][0], path[0][1]) || !(standing(w, ...dest) || through(w, ...dest))) return null;
  const restAt = path.slice(1).map(([i, j], q) => (resting(i, j) ? q : -1)).filter((q) => q >= 0);
  const op: Op = { connect: { from: [h0, path[0][0], path[0][1]], to: dest, path, follow: true, ...(restAt.length ? { rest: restAt } : {}) }, born: now, why: 'way' };
  // (what it comes to, worked out on a copy: said under the finger)
  const sim = new World(w.seed, w.landSeed); sim.ops = [...w.ops, op]; sim.rebuild();
  const r = sim.reached.get(op), stairs = (r?.cells ?? []).filter((c) => sim.stair(...c) >= 0).length;
  const paved = path.slice(1).filter(([i, j]) => sim.paved(i, j)).length, bridge = (r?.cells ?? []).filter((c) => sim.bridge(...c)).length;
  // (and how its flight is carried, if over anything: the setting's answer said, so a hand knows it can choose another)
  const carried: Record<string, string> = { hung: ', hung from the wall', rampant: ', on a rampant arch', solid: ', solid', pier: ', on piers' };
  const fc = (r?.cells ?? []).map((c) => sim.flight(...c)?.f.carriage).find((c) => c && c !== 'ground');
  const parts = [paved ? `${paved} paved` : '', stairs ? `a flight of ${stairs}${fc ? carried[fc] : ''}` : '', bridge ? `a bridge of ${bridge}` : ''].filter(Boolean);
  const note = r?.reached ? `a way${parts.length ? ': ' + parts.join(', ') : ''}` : 'a way that can\'t reach as drawn: joining what it meets';
  const alts: Alt[] = [];
  const tower = dest[0] !== h0 ? stairTower(w, h0, [...path, [dest[1], dest[2]]], dest, now) : null;
  const walkway: Op = { connect: { from: [h0, path[0][0], path[0][1]], to: dest[0] === h0 ? dest : null, path: dest[0] === h0 ? path : cells }, born: now, why: 'walkway', note: 'a walkway at the height it starts', reading: 'a walkway at the height it starts' };
  // (stopped by what's in its way, or walking over a house's roof: round it, near the stroke, through any gate; as drawn,
  // the other reading)
  if (!direct) {
    const roofs = roofed(w), over = path.slice(1).some(([i, j]) => roofs.has(`${i}.${j}`));
    // (drawn over a house to its top: in at a door at its foot where the stroke meets it, up its stair inside, out on its
    // top (which is a terrace then))
    const house = to && over ? buildings(w).of.get(key(to[0] - 1, to[1], to[2])) : undefined;
    if (house && to![0] === house.h) {
      const mineH = new Set(house.cols.map(([x, z]) => `${x}.${z}`)), q = path.findIndex(([x, z]) => mineH.has(`${x}.${z}`));
      const [ox, oz] = q > 0 ? path[q - 1] : [-1, -1], [hx, hz] = q > 0 ? path[q] : [-1, -1], d = DIRS.findIndex(([a, b]) => a === ox - hx && b === oz - hz);
      if (q > 0 && d >= 0 && standing(w, w.ground(ox, oz), ox, oz)) {
        const base = house.base[house.cols.findIndex(([x, z]) => x === hx && z === hz)];
        const rule: Op['rule'] = [[base, hx, hz, RULE.within + d]];
        const up = q > 1 ? way(w, h0, path.slice(0, q), null, now, resting, true) : null;
        const approach: Op = up && !('refused' in up) ? { ...up, alts: undefined } : { pave: [[ox, oz]], born: now, why: 'way' };
        const label = 'in at a door, up its stair inside, out on its top';
        const inside: Op = { ...approach, rule: [...(approach.rule ?? []), ...rule], note: `a way: ${label}`, reading: label, why: 'way' };
        return { ...mark(inside, 'within'), alts: [{ label: 'the way as drawn, joining what it meets', op: { ...op, note, reading: note } }] };
      }
    }
    if (!r?.reached || over) {
      // (round it within a cell of the stroke: where the hand drew, still; further round than that is another place, so
      // it's offered, not built)
      const round = detour(w, cells, roofs, 1), wide = round ? null : detour(w, cells, roofs, 4);
      const alt = round ? way(w, h0, round, to, now, resting, true) : null;
      const farther = wide ? way(w, h0, wide, to, now, resting, true) : null;
      // (going to a top: the connection's the hand's, the way round the world's, further off if need be)
      if (to && farther && !('refused' in farther) && !r?.cells.length && !paved) { const v = new World(w.seed, w.landSeed); v.ops = [...w.ops, farther]; v.rebuild(); if (v.reached.get(farther)?.reached) return { ...mark(farther, 'routed-round'), note: `${farther.note}, round what's in the way`, reading: `${farther.reading ?? farther.note}, round what's in the way`, alts: [{ label: 'as drawn', op: { ...op, note, reading: note } }] }; }
      if (farther && !('refused' in farther)) { const v = new World(w.seed, w.landSeed); v.ops = [...w.ops, farther]; v.rebuild(); if (v.reached.get(farther)?.reached) alts.push({ label: 'round what\'s in the way, further off', op: { ...mark(farther, 'routed-round'), alts: undefined, note: `${farther.note}, round what's in the way`, reading: 'round what\'s in the way, further off' } }); }
      if (alt && !('refused' in alt)) {
        const v = new World(w.seed, w.landSeed); v.ops = [...w.ops, alt]; v.rebuild();
        const rr = v.reached.get(alt);
        if (rr?.reached) return { ...mark(alt, 'routed-round'), note: `${alt.note}, round what's in the way`, reading: `${alt.reading ?? alt.note}, round what's in the way`, alts: [{ label: 'as drawn', op: { ...op, note, reading: note } }, ...(alt.alts ?? [])] };
      }
    }
  }
  // (too steep for a flight along it: folded back beside it, a switchback, still a way; else a stair tower. And drawn
  // folding back on itself, climbing: the fold's the hand's, so both legs climb, sharing a landing at the turn)
  // (only where, followed as drawn, it climbs in one flight, the fold flattened: drawn climbing both ways, as drawn)
  const oneFlight = new Set((r?.cells ?? []).map((c) => sim.flight(...c)?.f).filter(Boolean)).size <= 1;
  const folded = folds([...path, [dest[1], dest[2]]]) && dest[0] - h0 >= 2 && oneFlight;
  const sw = (!r?.reached || folded) && dest[0] > h0 ? switchback(w, h0, [...path, [dest[1], dest[2]]], dest, now) : null;
  const lad = dest[0] > h0 ? ladder(w, h0, [...path, [dest[1], dest[2]]], dest, now) : null;
  const light = [...(lad ? [{ label: 'a ladder', op: lad }] : []), ...(tower ? [{ label: 'a stair tower', op: tower }] : [])];
  if (sw) return { ...mark(sw, 'switchback'), alts: [{ label: 'the way as drawn, joining what it meets', op: { ...op, note, reading: note } }, ...light, ...alts] };
  if (!r?.reached && lad) return { ...mark(lad, 'ladder-instead'), alts: [{ label: 'the way as drawn, joining what it meets', op: { ...op, note, reading: note } }, ...(tower ? [{ label: 'a stair tower', op: tower }] : []), ...alts] };
  // (reached by a flight: a ladder offered too, the lighter way up)
  if (r?.reached && lad) alts.push({ label: 'a ladder instead', op: lad });
  if (!r?.reached && tower) return { ...mark(tower, 'tower-instead'), alts: [{ label: 'the way as drawn, joining what it meets', op: { ...op, note, reading: note } }, { label: 'a walkway at the height it starts', op: walkway }, ...alts] };
  // (nothing of it can be made from where it starts (begun on a rock, or the foot of a bank too steep to climb there):
  // begun a cell or two on, where it can; and if nothing at all, said, not built empty)
  if (!r?.reached && !r?.cells.length && !paved) {
    for (let q = 1; q <= 3 && q < cells.length - 1; q++) {
      const [i, j] = cells[q], g = w.ground(i, j);
      if (!standing(w, g, i, j)) continue;
      const on = way(w, g, cells.slice(q), to, now, resting, direct);
      if (on && !('refused' in on)) { const sim2 = new World(w.seed, w.landSeed); sim2.ops = [...w.ops, on]; sim2.rebuild(); if (sim2.reached.get(on)?.cells.length || cells.slice(q + 1).some(([x, z]) => sim2.paved(x, z))) return { ...mark(on, 'begun-on'), note: `${on.note}, begun a step on`, reading: `${on.reading ?? on.note}, begun a step on` }; }
    }
    return { refused: 'no way along that: it climbs too steeply for its length' };
  }
  if (tower) alts.push({ label: 'a stair tower', op: tower });
  if (h0 > w.ground(path[0][0], path[0][1])) alts.push({ label: 'a walkway at the height it starts', op: walkway });
  // (ending on a top well above the ground there: on the ground to its foot instead, the other reading)
  if (to && to[0] > w.ground(to[1], to[2]) + 1) {
    const low = way(w, h0, [...path, [to[1], to[2]]], null, now, resting);
    if (low && !('refused' in low)) alts.push({ label: 'on the ground, to its foot', op: { ...low, alts: undefined, note: 'a way on the ground, to its foot', reading: 'on the ground, to its foot' } });
  }
  return { ...mark(op), note, reading: note, ...(alts.length ? { alts } : {}) };
}

/**
 * A way drawn round, back to where it began: a walk all the way round, following the ground, back to its start; walled
 * round, a court, the other reading. (Begun in the water, it's begun at the first place on it that can be stood on.)
 */
function circuit(w: World, h0: number, cells: Array<[number, number]>, born: (i: number, j: number) => number, now: number, resting: (i: number, j: number) => boolean): Op | Refusal | null {
  const q = cells.findIndex(([i, j]) => standing(w, w.ground(i, j), i, j));
  const court = wall(w, cells, true, born, resting), alts: Alt[] = court ? [{ label: 'a court, walled round', op: { ...court, alts: undefined } }] : [];
  if (q < 0) return court ? { ...court, alts: undefined } : null;
  const ring = [...cells.slice(q), ...cells.slice(0, q)], [i0, j0] = ring[0], g0 = w.ground(i0, j0);
  // (a walk round never goes over a house's roof: each stretch of the ring over one goes round it, near the stroke)
  let round: Array<[number, number]> = [...ring, [i0, j0]];
  const roofs = roofed(w);
  let skirted = false;
  for (let a = 1; a < round.length - 1; a++) {
    if (!roofs.has(`${round[a][0]}.${round[a][1]}`)) continue;
    let b = a; while (b < round.length - 1 && roofs.has(`${round[b][0]}.${round[b][1]}`)) b++;
    const by = detour(w, round.slice(a - 1, b + 1), roofs, 2);
    if (by) { round = [...round.slice(0, a - 1), ...by, ...round.slice(b + 1)]; a += by.length - 2; skirted = true; } else a = b;
  }
  const op = way(w, q ? g0 : h0, round, [g0, i0, j0], now, resting);
  // (a walk that can't get most of the way round isn't round at all: the court, then)
  const sim = op && !('refused' in op) ? (() => { const v = new World(w.seed, w.landSeed); v.ops = [...w.ops, op]; v.rebuild(); return v.reached.get(op); })() : null;
  if (!op || 'refused' in op || !sim || (!sim.reached && sim.stopped < ring.length * 0.6)) return court ? { ...court, took: ['court-instead'], alts: op && !('refused' in op) ? [{ label: 'as far round as a walk will go', op: { ...op, alts: undefined } }] : undefined, note: 'a court, walled round (no walk round it would stand)', reading: 'a court, walled round' } : op;
  const note = 'a walk all the way round';
  return { ...op, ...(skirted ? { took: [...(op.took ?? []), 'skirted'] } : {}), note, reading: note, alts: [...alts, ...(op.alts ?? [])] };
}

/** the cells of the same top as `to` (stone under its height, nothing at it), within `r` of it, nearest first */
function sameTop(w: World, to: Cell, r: number): Array<[number, number]> {
  const [k, i0, j0] = to, on = (i: number, j: number) => inGrid(i, j) && w.stone(k - 1, i, j) && !w.occupied(k, i, j);
  const seen = new Set([key(0, i0, j0)]), q: Array<[number, number]> = [[i0, j0]], out: Array<[number, number]> = [];
  while (q.length) {
    const [i, j] = q.shift()!;
    for (const [a, b] of DIRS) {
      const x = i + a, z = j + b;
      if (seen.has(key(0, x, z)) || Math.abs(x - i0) + Math.abs(z - j0) > r || !on(x, z)) continue;
      seen.add(key(0, x, z)); out.push([x, z]); q.push([x, z]);
    }
  }
  return out;
}

/** the columns of the houses that are roofed (`i.j`): what a way walks round, never over */
const roofed = (w: World) => new Set(buildings(w).list.flatMap((b) => underRoof(b).map(([i, j]) => `${i}.${j}`)));

/**
 * A way round what's in a stroke's way: the cheapest walk from its first cell to its last over the ground near it (four
 * cells round the stroke at most, or `reach`), never through stone standing on the ground (but through a gate), nor a house's
 * columns (`avoid`); dearer the further from the stroke and the more it climbs, so it keeps to what was drawn. Null if
 * there's none.
 */
/** a wall drawn across water, carried over it: its stone laid, the cells over the water arched across the wall's run */
function wallOver(w: World, cells: Array<[number, number]>, born: (i: number, j: number) => number): Op | null {
  const add: Array<[number, number, number, number]> = [], arches: Array<[number, number, number, number, number]> = [];
  cells.forEach(([i, j], q) => {
    const g = w.ground(i, j), p = cells[Math.max(0, q - 1)], n = cells[Math.min(cells.length - 1, q + 1)];
    if (w.stone(g, i, j) || w.stair(g, i, j) >= 0 || w.crown(g, i, j)) return;
    if (w.pool(i, j)) arches.push([g, i, j, n[0] !== p[0] ? 1 : 0, born(i, j)]);
    else add.push([g, i, j, born(i, j)]);
  });
  return arches.length ? { add, arches, born: born(cells[0][0], cells[0][1]), why: 'wall', note: 'a wall, carried over the water on an arch', reading: 'a wall, carried over the water on an arch' } : null;
}
function detour(w: World, cells: Array<[number, number]>, avoid: Set<string>, reach = 4): Array<[number, number]> | null {
  const [s, e] = [cells[0], cells[cells.length - 1]], M = reach;
  const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]), x0 = Math.min(...xs) - M, x1 = Math.max(...xs) + M, z0 = Math.min(...zs) - M, z1 = Math.max(...zs) + M;
  const drawn = (i: number, j: number) => Math.min(...cells.map((c) => Math.abs(c[0] - i) + Math.abs(c[1] - j)));
  const off = (i: number, j: number) => Math.min(...cells.map((c) => Math.max(Math.abs(c[0] - i), Math.abs(c[1] - j))));
  const open = (i: number, j: number) => {
    if ((i === s[0] && j === s[1]) || (i === e[0] && j === e[1])) return true;
    if (!inGrid(i, j) || i < x0 || i > x1 || j < z0 || j > z1 || avoid.has(`${i}.${j}`) || off(i, j) > reach) return false;
    const g = w.ground(i, j);
    return (!w.stone(g, i, j) && w.stair(g, i, j) < 0 && !w.tree(g, i, j)) || through(w, g, i, j);
  };
  const id = (i: number, j: number) => `${i}.${j}`, cost = new Map<string, number>([[id(...s), 0]]), from = new Map<string, [number, number]>(), todo: Array<[number, [number, number]]> = [[0, s]];
  while (todo.length) {
    todo.sort((a, b) => a[0] - b[0]);
    const [c, [i, j]] = todo.shift()!;
    if (i === e[0] && j === e[1]) break;
    if (c > (cost.get(id(i, j)) ?? Infinity)) continue;
    for (const [a, b] of DIRS) {
      const x = i + a, z = j + b;
      if (!open(x, z)) continue;
      const v = c + 1 + 0.6 * drawn(x, z) + 0.5 * Math.abs(w.ground(x, z) - w.ground(i, j));
      if (v < (cost.get(id(x, z)) ?? Infinity)) { cost.set(id(x, z), v); from.set(id(x, z), [i, j]); todo.push([v, [x, z]]); }
    }
  }
  if (!from.has(id(...e))) return null;
  const out: Array<[number, number]> = [e];
  for (let c = e; c[0] !== s[0] || c[1] !== s[1]; ) { c = from.get(id(...c))!; out.unshift(c); }
  return out.length > 1 && out.some((c, n) => !cells[n] || c[0] !== cells[n][0] || c[1] !== cells[n][1]) ? out : null;
}

const DIR = (a: [number, number], b: [number, number]) => DIRS.findIndex(([x, z]) => a[0] + x === b[0] && a[1] + z === b[1]);

/** a wall along the stroke (on the stone, from the stone to the stone), as the rules choose it, the others offered: a
 * wall's kind; a ring of it, where the stroke came round, walling in a court */
/** the wall a stroke's drawn on from: in line with it behind its first cell, a cell across; its kind (thin; arcaded,
 * arches every other cell; gated, any; plain) and how many cells back its last arch is (`since`) */
function runOf(w: World, cells: Array<[number, number]>): { kind: 'plain' | 'gated' | 'arcaded' | 'thin'; since: number; di: number; dj: number } | null {
  if (cells.length < 2) return null;
  const [i0, j0] = cells[0], di = i0 - cells[1][0], dj = j0 - cells[1][1];
  if (Math.abs(di) + Math.abs(dj) !== 1) return null;
  const seq: Array<'arch' | 'solid' | 'thin'> = [];
  for (let q = 1; q <= 12; q++) {
    const x = i0 + di * q, z = j0 + dj * q, g = w.ground(x, z);
    if (!inGrid(x, z) || !w.stone(g, x, z) || w.stone(g, x + dj, z + di) || w.stone(g, x - dj, z - di)) break;
    seq.push(w.archway(g, x, z) >= 0 ? 'arch' : w.thin.has(key(g, x, z)) ? 'thin' : 'solid');
  }
  if (!seq.length) return null;
  const arches = seq.map((c, q) => (c === 'arch' ? q : -1)).filter((q) => q >= 0);
  const kind = seq[0] === 'thin' ? 'thin' : arches.length >= 2 && arches.every((q, m) => m === 0 || q - arches[m - 1] === 2) ? 'arcaded' : arches.length ? 'gated' : 'plain';
  return { kind, since: arches.length ? arches[0] : seq.length, di, dj };
}
function wall(w: World, cells: Array<[number, number]>, closed: boolean, born: (i: number, j: number) => number, resting: (i: number, j: number) => boolean): Op | null {
  // (drawn through a tree, or across water: bowed round it, a cell out and back, what it meets kept (yield); and across
  // water, carried over it on an arch, the other reading)
  const kept = (i: number, j: number) => w.crown(w.ground(i, j), i, j) || w.pool(i, j);
  if (!closed && cells.length > 2 && cells.slice(1, -1).some(([i, j]) => kept(i, j))) {
    const avoid = new Set(cells.filter(([i, j]) => kept(i, j)).map(([i, j]) => `${i}.${j}`)), round = detour(w, cells, avoid, 1);
    const bowed = round && !round.some(([i, j]) => kept(i, j)) ? wall(w, round, false, born, resting) : null;
    if (bowed) {
      const wet = cells.filter(([i, j]) => w.pool(i, j) && !w.crown(w.ground(i, j), i, j));
      const over = wet.length && wet.length === avoid.size ? (() => { const o = wallOver(w, cells, born); return o ? [{ label: 'carried over the water on an arch', op: o }] : []; })() : [];
      return { ...bowed, took: [...(bowed.took ?? []), 'bowed'], note: `${bowed.note}, bowed round ${wet.length === avoid.size ? 'the water' : 'the tree'}`, reading: `${bowed.reading ?? bowed.note}, bowed round ${wet.length === avoid.size ? 'the water' : 'the tree'}`, alts: [...over, ...(bowed.alts ?? [])] };
    }
  }
  // (what kind of wall is the rules' choice, seeded by where it starts, so it's chosen once and kept as the stroke goes
  // on: plain; gated, a way through it two cells in and every six after; or arcaded, a way through every other cell.
  // Its openings count from the start, so going on never moves them; and where the finger paused, a gate)
  const G = (i: number, j: number) => w.ground(i, j);
  const free = cells.filter(([i, j]) => !w.stone(G(i, j), i, j) && w.stair(G(i, j), i, j) < 0 && !w.tree(G(i, j), i, j) && !w.pool(i, j));
  if (!free.length) return null;
  const n = cells.length, at = (q: number) => cells[((q % n) + n) % n];
  const next = (q: number) => (closed ? at(q + 1) : cells[Math.min(n - 1, q + 1)]), prev = (q: number) => (closed ? at(q - 1) : cells[Math.max(0, q - 1)]);
  const across = (q: number) => (next(q)[0] !== prev(q)[0] ? 1 : 0);
  const straight = (q: number) => (closed || (q > 0 && q < n - 1)) && prev(q)[0] - at(q)[0] === at(q)[0] - next(q)[0] && prev(q)[1] - at(q)[1] === at(q)[1] - next(q)[1];
  type Kind = 'plain' | 'gated' | 'arcaded' | 'thin' | 'court' | 'ring';
  const label: Record<Kind, string> = { plain: 'a wall', gated: 'a gated wall', arcaded: 'an arcaded wall', thin: 'a thin wall', court: 'a court, walled round', ring: 'a ring of wall' };
  // (drawn on from the end of a wall, in line with it: it goes on as that wall goes (reconcile), its kind and its beat
  // kept across the join: an arcade's arches every other cell counted from its last, a gated wall's gates six apart)
  const on = closed ? null : runOf(w, cells);
  const beat = (q: number) => straight(q) || (q === 0 && !!on);
  // (and drawn up to a gate or an arcade's arch square to it, its end where the arch's way comes out: it lands on a
  // pier, that bay filled solid, the arches either side kept. Never a way's gate the hand made: that's kept open)
  const lands: Cell[] = [];
  if (!closed) for (const [c, d] of [[cells[n - 1], cells[n - 2]], [cells[0], cells[1]]] as Array<[[number, number], [number, number] | undefined]>) {
    if (!d) continue;
    const a = c[0] - d[0], b = c[1] - d[1], x = c[0] + a, z = c[1] + b;
    if (!inGrid(x, z) || Math.abs(a) + Math.abs(b) !== 1 || cells.some((e) => e[0] === x && e[1] === z)) continue;
    if (w.archway(G(x, z), x, z) === (a !== 0 ? 0 : 1) && !w.passages.has(key(G(x, z), x, z))) lands.push([G(x, z), x, z]);
  }
  const build = (kind: Kind): Op => {
    const gate = new Set<number>();
    const cont = !!on && on.kind === kind;
    if (kind === 'gated') for (let q = cont ? Math.max(0, 5 - on!.since) : 2; q < n - 1; q += 6) if (beat(q)) gate.add(q);
    if (kind === 'arcaded') for (let q = cont ? (on!.since % 2 + 1) % 2 : closed ? 0 : 1; q < (closed ? n : n - 1); q += 2) if (cont ? beat(q) : straight(q)) gate.add(q);
    // (an arcade's end pier, no longer its end: opened again in the beat, so the arches run on through the join)
    const reopen: Array<[number, number, number, number, number]> = [];
    if (cont && kind === 'arcaded') for (let m = on!.since - 2; m >= 0; m -= 2) { const x = cells[0][0] + on!.di * (m + 1), z = cells[0][1] + on!.dj * (m + 1); reopen.push([G(x, z), x, z, on!.di ? 1 : 0, born(x, z)]); }
    if (kind === 'court') { const q = Array.from({ length: n }, (_, q2) => q2).find(straight); if (q !== undefined) gate.add(q); }
    if (kind !== 'thin' && kind !== 'arcaded') cells.forEach(([i, j], q) => { if (resting(i, j) && straight(q)) gate.add(q); });
    const add: Array<[number, number, number, number]> = [], arches: Array<[number, number, number, number, number]> = [], walls: Array<[number, number, number, number, number]> = [];
    // (where it stands: not in a stair's way (a gap in it there: the wall never shuts a stair off), nor where it can't;
    // nor where it runs alongside a wall already there, a cell off and the same way: that's walled already, and the new
    // one joins it rather than doubling it into a slab)
    const alongside = (q: number) => {
      const [i, j] = at(q), [pi, pj] = prev(q), [ni, nj] = next(q), di = Math.sign(ni - pi), dj = Math.sign(nj - pj);
      if (!di === !dj) return false;
      return [[dj, di], [-dj, -di]].some(([a, b]) => { const x = i + a, z = j + b; return w.stone(G(x, z), x, z) && (w.stone(G(x + di, z + dj), x + di, z + dj) || w.stone(G(x - di, z - dj), x - di, z - dj)) && !cells.some((c) => c[0] === x && c[1] === z); });
    };
    const stands = cells.map(([i, j], q) => free.some((c) => c[0] === i && c[1] === j) && !w.way(G(i, j), i, j) && !alongside(q));
    // (on the land, one line of coping along it: where it dips between its neighbours (the ground falling away a cell
    // or two), it stands taller there, up to the lower of them, so it reads as one wall stepping with the ground and
    // not a row of blocks at odd heights)
    const tops = cells.map(([i, j]) => G(i, j) + 1);
    if (w.land) for (let pass = 0; pass < n; pass++) {
      let moved = false;
      for (let q = 0; q < n; q++) {
        if (!stands[q]) continue;
        const a = closed ? (q - 1 + n) % n : q - 1, b = closed ? (q + 1) % n : q + 1;
        if (a < 0 || b >= n || !stands[a] || !stands[b]) continue;
        const want = Math.min(tops[a], tops[b], G(...cells[q]) + 2);
        if (want > tops[q]) { tops[q] = want; moved = true; }
      }
      if (!moved) break;
    }
    cells.forEach(([i, j], q) => {
      if (!stands[q]) return;
      for (let k = G(i, j); k < tops[q]; k++) {
        if (w.occupied(k, i, j) && k > G(i, j)) break;
        if (k === G(i, j) && gate.has(q)) arches.push([k, i, j, across(q), born(i, j)]);
        else if (kind === 'thin') walls.push([k, i, j, 1 - across(q), born(i, j)]);
        else add.push([k, i, j, born(i, j)]);
      }
    });
    const landed = kind === 'thin' || !lands.length ? [] : lands;
    for (const [k, i, j] of landed) add.push([k, i, j, born(i, j)]);
    const note = label[kind] + (gate.size && kind !== 'gated' && kind !== 'arcaded' && kind !== 'court' ? ', a gate where you paused' : '') + (cont ? ', going on as the wall it meets' : '') + (landed.length ? ', landing on a pier' : '');
    arches.push(...reopen);
    return { add, ...(arches.length ? { arches } : {}), ...(walls.length ? { walls } : {}), ...(landed.length ? { cut: landed.map(([k, i, j]) => [k, i, j] as Cell) } : {}), why: 'wall', note, reading: note };
  };
  const first: Kind = closed ? 'court' : on?.kind ?? wallKind(w, cells[0][0], cells[0][1]);
  const kinds: Kind[] = closed ? ['court', 'ring', 'arcaded', 'thin'] : [first, ...(['plain', 'gated', 'arcaded', 'thin'] as Kind[]).filter((k) => k !== first)];
  const op = build(first);
  const alts: Alt[] = kinds.slice(1).map((k) => ({ label: label[k] === label.arcaded && closed ? 'an arcaded court' : label[k], op: build(k) }));
  // (drawn round: filled, too, the other reading of a ring: a terrace, what it was drawn round raised with it)
  if (closed) {
    const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]), x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, z0 = Math.min(...zs) - 1, z1 = Math.max(...zs) + 1;
    const ring = new Set(cells.map(([i, j]) => `${i}.${j}`)), out = new Set<string>([`${x0}.${z0}`]), todo: Array<[number, number]> = [[x0, z0]];
    while (todo.length) { const [i, j] = todo.pop()!; for (const [a, b] of DIRS) { const x = i + a, z = j + b, k = `${x}.${z}`; if (x < x0 || x > x1 || z < z0 || z > z1 || out.has(k) || ring.has(k)) continue; out.add(k); todo.push([x, z]); } }
    const fill: Array<[number, number, number, number]> = [];
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) if (!out.has(`${i}.${j}`) && inGrid(i, j) && !w.stone(G(i, j), i, j) && w.stair(G(i, j), i, j) < 0 && !w.pool(i, j) && !w.way(G(i, j), i, j)) fill.push([G(i, j), i, j, born(i, j)]);
    if (fill.length > cells.length) alts.push({ label: 'a terrace, filled', op: { add: fill, why: 'wall', note: 'a terrace: what it was drawn round, filled', reading: 'a terrace, filled' } });
  }
  return { ...op, alts };
}

/**
 * A stair tower, for a climb a flight along the stroke can't make: a tower at the high end, a level higher than it, a
 * stair inside it (buildings.ts), its door at its foot facing the way it was come to, and a door into it from the top it
 * serves; roofed over.
 * Climbing, it stands beside the destination (a walkway at the start's height leads to it, if the start's a top);
 * going down, beside the start, its foot on the stone or beside the destination. Null where one won't stand.
 */
export function stairTower(w: World, h0: number, cells: Array<[number, number]>, to: Cell, now: number): Op | null {
  const h1 = to[0], path2 = cells.slice(0, -1), dest: [number, number] = [to[1], to[2]], up = h1 > h0, H = Math.max(h0, h1);
  if (H < 2) return null;
  const e = up ? path2[path2.length - 1] : path2[1];
  if (!e || (up && h0 > 0 && path2.length < 2)) return null;
  if (!up && h1 > w.ground(dest[0], dest[1]) && DIR(e, dest) < 0) return null;
  const add: Array<[number, number, number, number]> = [];
  if (H - w.ground(e[0], e[1]) < 2) return null;
  // (a level higher than the top it serves: come into from that top by a door, roofed over, a turret, not a stub of
  // terrace beside it)
  for (let k = w.ground(e[0], e[1]); k <= H; k++) {
    if (w.stair(k, e[0], e[1]) >= 0 || w.tree(k, e[0], e[1]) || w.pier(k, e[0], e[1]) || (k === w.ground(e[0], e[1]) && w.pool(e[0], e[1])) || (w.way(k, e[0], e[1]) && !w.stone(k, e[0], e[1]))) return null;
    if (!w.stone(k, e[0], e[1])) add.push([k, e[0], e[1], now]);
  }
  if (w.occupied(H + 1, e[0], e[1]) || w.tree(H + 1, e[0], e[1])) return null;
  // (its door: toward the way it's come to by, at its foot)
  const toward = up ? (path2.length >= 2 ? path2[path2.length - 2] : null) : (path2[2] ?? (h1 === w.ground(dest[0], dest[1]) ? dest : null));
  const d = toward ? DIR(e, toward) : (DIR(e, dest) + 2) % 4;
  const note = `a stair tower, climbing ${Math.abs(h1 - h0)} level${Math.abs(h1 - h0) > 1 ? 's' : ''} inside it`;
  const op: Op = { add, rule: [[0, e[0], e[1], RULE.tower + Math.max(0, d)]], why: 'tower', note, reading: note, born: now };
  // (from a top, a walkway to it at the start's height: a door where it arrives)
  if (up && h0 > 0) return { ...op, connect: { from: [h0, cells[0][0], cells[0][1]], to: null, path: path2 } };
  return op;
}

/**
 * A switchback, for a climb too steep for a flight along the stroke: folded back on itself beside where it was drawn. A
 * lower flight climbs away from the destination in the lane beside the stroke's, a landing across both lanes turns it
 * about, and the upper flight climbs on in the stroke's own lane, into the destination. Each flight's carried as its
 * setting has it (model.ts `carry`): the upper leans from the landing to the top it climbs to; the lower springs from the
 * ground to the landing. Its foot is beside the destination's face, on the ground. Null where one won't fit.
 */
/** whether a stroke folds back on itself: a run one way, a cell or two across, and a run back the other way */
function folds(cells: Array<[number, number]>): boolean {
  const dirs: number[] = [];
  for (let q = 1; q < cells.length; q++) dirs.push(DIRS.findIndex(([a, b]) => a === cells[q][0] - cells[q - 1][0] && b === cells[q][1] - cells[q - 1][1]));
  for (let q = 0; q < dirs.length; q++) {
    let a = q; while (a + 1 < dirs.length && dirs[a + 1] === dirs[q]) a++;
    if (a - q < 1) continue;
    let b = a + 1; while (b < dirs.length && b - a <= 2 && dirs[b] !== (dirs[q] + 2) % 4) b++;
    if (b >= dirs.length || dirs[b] !== (dirs[q] + 2) % 4 || b === a + 1) continue;
    let c = b; while (c + 1 < dirs.length && dirs[c + 1] === dirs[b]) c++;
    if (c - b >= 1) return true;
  }
  return false;
}
export function switchback(w: World, h0: number, cells: Array<[number, number]>, to: Cell, now: number): Op | null {
  const H = to[0], N = H - h0, e = cells[cells.length - 2];
  if (N < 2 || !e) return null;
  const n2 = Math.ceil(N / 2), n1 = N - n2, L = H - n2;
  const clear = (k: number, i: number, j: number) => inGrid(i, j) && w.onSlab(i, j) && k >= w.ground(i, j) && !w.occupied(k, i, j) && !w.tree(k, i, j) && !(k > 0 && w.tree(k - 1, i, j)) && !(k > 0 && w.stair(k - 1, i, j) >= 0) && !w.claim(k, i, j) && !(k === w.ground(i, j) && w.pool(i, j));
  // (near what was drawn: every cell of it within two of the stroke)
  const near = ([i, j]: [number, number]) => cells.some(([x, z]) => Math.max(Math.abs(x - i), Math.abs(z - j)) <= 2);
  // (into the cell drawn to, the way the stroke came first; then its other faces; then the same top a cell along)
  const d0 = DIR(e, [to[1], to[2]]), dests: Array<[number, number]> = [[to[1], to[2]], ...sameTop(w, to, 1)];
  for (const dest of dests) for (const d of [d0, 0, 1, 2, 3].filter((q, n, a) => q >= 0 && a.indexOf(q) === n)) {
    const [a, b] = DIRS[d];
    for (const t of [(d + 1) % 4, (d + 3) % 4]) {
      const [ta, tb] = DIRS[t];
      const LU: [number, number] = [dest[0] - (n2 + 1) * a, dest[1] - (n2 + 1) * b], LD: [number, number] = [LU[0] + ta, LU[1] + tb];
      const stairs: Array<[number, number, number, number, number]> = [];
      // (the upper flight, into the destination; the lower, in the lane beside it, climbing away to the landing)
      for (let q = 1; q <= n2; q++) stairs.push([H - q, dest[0] - q * a, dest[1] - q * b, d, now]);
      for (let q = 1; q <= n1; q++) stairs.push([L - q, LD[0] + q * a, LD[1] + q * b, (d + 2) % 4, now]);
      const foot: Cell = [h0, LD[0] + (n1 + 1) * a, LD[1] + (n1 + 1) * b];
      if (![...stairs.map(([, i, j]) => [i, j] as [number, number]), LU, LD, [foot[1], foot[2]] as [number, number]].every(near)) continue;
      // (each step with room over it; the landing clear, with room to stand, and stone under it; the foot a place to stand)
      if (!stairs.every(([k, i, j]) => clear(k, i, j) && clear(k + 1, i, j))) continue;
      if (![LU, LD].every(([i, j]) => clear(L, i, j) && clear(L + 1, i, j) && L - 1 >= w.ground(i, j) && (w.stone(L - 1, i, j) || clear(L - 1, i, j)))) continue;
      if (!standing(w, ...foot)) continue;
      const add = [LU, LD].filter(([i, j]) => !w.stone(L - 1, i, j)).map(([i, j]) => [L - 1, i, j, now] as [number, number, number, number]);
      const note = `a switchback, climbing ${N} level${N > 1 ? 's' : ''}, a landing between its flights`;
      return { add, stairs, born: now, why: 'stairs', note, reading: note };
    }
  }
  return null;
}

/**
 * A ladder, the lightest way up: from the place at the foot of what the stroke climbs to, leaning on it, to its top.
 * Where the stroke comes to it, or beside any face of it near the stroke. Null where none will stand.
 */
export function ladder(w: World, h0: number, cells: Array<[number, number]>, to: Cell, now: number): Op | null {
  const H = to[0], dest: [number, number] = [to[1], to[2]], e = cells[cells.length - 2];
  if (!e || H <= h0) return null;
  const solid = (k: number, i: number, j: number) => w.stone(k, i, j) || w.earth(k, i, j);
  const near = ([i, j]: [number, number]) => cells.some(([x, z]) => Math.max(Math.abs(x - i), Math.abs(z - j)) <= 1);
  const feet: Array<[number, number]> = [e, ...DIRS.map(([a, b]) => [dest[0] - a, dest[1] - b] as [number, number]).filter((c) => (c[0] !== e[0] || c[1] !== e[1]) && near(c))];
  for (const f of feet) {
    const d = DIR(f, dest);
    if (d < 0) continue;
    const k = w.ground(f[0], f[1]), n = H - k;
    if (n < 1 || !standing(w, k, f[0], f[1]) || w.claim(k, f[0], f[1])) continue;
    let ok = true;
    for (let q = 0; q < n && ok; q++) if (w.occupied(k + q, f[0], f[1]) || w.claim(k + q, f[0], f[1]) || !solid(k + q, dest[0], dest[1])) ok = false;
    if (!ok || !standing(w, H, dest[0], dest[1])) continue;
    const note = `a ladder up to it, ${n} level${n > 1 ? 's' : ''}`;
    return { ladders: [[k, f[0], f[1], d, n, now]], born: now, why: 'ladder', note, reading: note };
  }
  return null;
}

/** a climb (up or down) from the stroke's start round whatever's in its way to a straight flight into the destination,
 * as many cells long as it climbs, the shortest there is (null if none) */
function approach(w: World, h0: number, path: Array<[number, number]>, to: Cell): Array<[number, number]> | null {
  const n = Math.abs(to[0] - h0), up = to[0] > h0, dest: [number, number] = [to[1], to[2]], s = path[0];
  const clear = (k: number, i: number, j: number) => inGrid(i, j) && w.onSlab(i, j) && !w.occupied(k, i, j) && !w.tree(k, i, j) && !(k > 0 && w.tree(k - 1, i, j)) && !(k > 0 && w.stair(k - 1, i, j) >= 0) && !(k === 0 && w.pool(i, j)) && !(k > 0 && w.way(k - 1, i, j) && !w.stone(k - 1, i, j));
  let best: Array<[number, number]> | null = null;
  for (const [a, b] of DIRS) {
    // (the flight: n cells in a line into the destination, each step at its height with room over it; and a cell before it)
    const run: Array<[number, number]> = Array.from({ length: n }, (_, q) => [dest[0] - a * (n - q), dest[1] - b * (n - q)]);
    const p: [number, number] = [dest[0] - a * (n + 1), dest[1] - b * (n + 1)];
    const fits = run.every(([i, j], q) => { const k = up ? h0 + q : h0 - q - 1; return clear(k, i, j) && clear(k + 1, i, j); }) && clear(h0, ...p);
    if (!fits) continue;
    const skip = new Set(run.map(([i, j]) => key(0, i, j)).concat(key(0, ...dest)));
    const lead = (p[0] === s[0] && p[1] === s[1]) ? [s] : bfs(s, p, (i, j) => clear(h0, i, j) && !skip.has(key(0, i, j)));
    if (!lead) continue;
    const route = [...lead, ...run];
    if (!best || route.length < best.length) best = route;
  }
  return best;
}
/** the shortest way across cells that pass, from a to b (b must pass too), or null */
function bfs(a: [number, number], b: [number, number], ok: (i: number, j: number) => boolean): Array<[number, number]> | null {
  const from = new Map<number, number>([[key(0, ...a), -1]]), q: Array<[number, number]> = [a];
  for (let n = 0; n < q.length; n++) {
    const c = q[n];
    if (c[0] === b[0] && c[1] === b[1]) { const out: Array<[number, number]> = []; for (let v = key(0, ...c); v !== -1; v = from.get(v)!) { const [, x, z] = unkey(v); out.unshift([x, z]); } return out; }
    for (const [da, db] of DIRS) { const x = c[0] + da, z = c[1] + db; if (!from.has(key(0, x, z)) && ok(x, z)) { from.set(key(0, x, z), key(0, ...c)); q.push([x, z]); } }
  }
  return null;
}

/** a way at height h from the stroke's start to beside its destination, round whatever's at that height, the shortest
 * there is (null if there's nothing in the way, or no way round) */
function around(w: World, h: number, path: Array<[number, number]>, to: Cell): Array<[number, number]> | null {
  const ok = (i: number, j: number) => inGrid(i, j) && w.onSlab(i, j) && !w.occupied(h, i, j) && !w.tree(h, i, j) && !w.tree(h - 1, i, j) && w.stair(h - 1, i, j) < 0 && !(h === 1 && w.pool(i, j)) && !(w.way(h - 1, i, j) && !w.stone(h - 1, i, j));
  if (path.slice(1).every(([i, j]) => ok(i, j))) return null;
  const s = path[0], dest: [number, number] = [to[1], to[2]], from = new Map<number, number>(), q: Array<[number, number]> = [s];
  from.set(key(0, ...s), -1);
  for (let n = 0; n < q.length; n++) {
    const c = q[n];
    if (n > 0 && DIR(c, dest) >= 0) {
      const out: Array<[number, number]> = [];
      for (let v = key(0, ...c); v !== -1; v = from.get(v)!) { const [, x, z] = unkey(v); out.unshift([x, z]); }
      return [...out, dest];
    }
    for (const [a, b] of DIRS) { const x = c[0] + a, z = c[1] + b; if (!from.has(key(0, x, z)) && ok(x, z) && !(x === dest[0] && z === dest[1])) { from.set(key(0, x, z), key(0, ...c)); q.push([x, z]); } }
  }
  return null;
}
/** what carving takes where it touches: the stone (or stair) struck, if it's the hand's (piers and arches are the rules') */
export function carve(w: World, p: Pick): Cell | null {
  if (p.face === 'ground') return null;
  const [k, i, j] = p.hit;
  return w.stone(k, i, j) || w.stair(k, i, j) >= 0 ? [k, i, j] : null;
}
