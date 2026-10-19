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
import { buildings } from './buildings';
import { CEIL, DIRS, RULE, World, inGrid, key, straights, unkey, type Alt, type Cell, type Op } from './model';

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
  // (a way's touch on the land's ground: a place to stand, not a block)
  if (intent === 'way' && w.land && p.face === 'ground' && !anyway) { const op = placeToStand(w, p, now); if (op) return op; }
  const [k, i, j] = tapCell(w, p);
  if (k >= CEIL || !inGrid(i, j) || w.stone(k, i, j) || w.stair(k, i, j) >= 0) return null;
  // (never into a stair's way (its foot, its head, the room over them): refused, but offered anyway)
  // (never into a stair's way (its foot, its head, the room over them): raised beside it instead, keeping the way open;
  // in it anyway, another reading)
  if (!anyway && w.way(k, i, j)) {
    const op = tap(w, p, now, true), anyOp = op && !('refused' in op) ? op : null;
    const alts: Alt[] = anyOp ? [{ label: 'raise it anyway', op: { ...anyOp, note: 'raised in the stair\'s way', reading: 'raise it anyway' } }] : [];
    const beside = DIRS.map(([a, b]) => [k, i + a, j + b] as Cell).filter(([kk, x, z]) => inGrid(x, z) && w.free(kk, x, z) && !w.way(kk, x, z) && w.floor(kk, x, z));
    if (beside.length) return { add: [[...beside[0], now]], why: 'raise', note: 'raised beside it: the stair\'s way kept open', reading: 'beside the stair', alts };
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
 * Stone touched and drawn straight up the screen, or down it: the piece it's part of made taller or lower, a course for
 * every course's height the finger's gone. (Up and down the screen is the one way no stroke across the ground ever
 * goes: the grid's sides run aslant on it.) The piece: its top, and every top joined to it at that height (a terrace, a
 * run of wall), raised together; lowered, courses taken off it, never below the ground. Just the column touched, the
 * other reading.
 */
export function lift(w: World, p: Pick, n: number, now: number, whole = true): Op | Refusal | null {
  if (!n || p.face === 'ground') return null;
  const [k0, i, j] = p.hit;
  if (!w.stone(k0, i, j)) return null;
  const top = w.topFrom(k0, i, j);
  if (w.stair(top - 1, i, j) >= 0) return null;
  // (the piece: tops at this height, joined to it, of stone, no stairs)
  const at = (x: number, z: number) => inGrid(x, z) && w.stone(top - 1, x, z) && !w.stone(top, x, z) && w.stair(top, x, z) < 0 && w.stair(top - 1, x, z) < 0;
  const cells: Array<[number, number]> = [[i, j]];
  if (whole) for (let q = 0; q < cells.length && cells.length < 64; q++) for (const [a, b] of DIRS) { const c: [number, number] = [cells[q][0] + a, cells[q][1] + b]; if (at(...c) && !cells.some((d) => d[0] === c[0] && d[1] === c[1])) cells.push(c); }
  const add: Array<[number, number, number, number]> = [], walls: Array<[number, number, number, number, number]> = [], cut: Cell[] = [];
  if (n > 0) {
    for (const [x, z] of cells) for (let k = top; k < top + n && k < CEIL; k++) {
      if (!w.free(k, x, z)) break;
      const thin = w.wall(top - 1, x, z);
      if (thin >= 0) walls.push([k, x, z, thin, now]); else add.push([k, x, z, now]);
    }
    if (!add.length && !walls.length) return { refused: 'nothing more will stand there' };
  } else {
    for (const [x, z] of cells) for (let k = top - 1; k >= top + n && k >= w.ground(x, z); k--) cut.push([k, x, z]);
    if (!cut.length) return null;
  }
  const m = Math.abs(n), what = cells.length > 1 ? `, the whole of it (${cells.length} across)` : '';
  const note = `${n > 0 ? 'raised' : 'lowered'} ${m} course${m > 1 ? 's' : ''}${what}`;
  const op: Op = { ...(add.length ? { add } : {}), ...(walls.length ? { walls } : {}), ...(cut.length ? { cut } : {}), born: now, why: n > 0 ? 'lift' : 'lower', note, reading: note };
  if (whole && cells.length > 1) { const one = lift(w, p, n, now, false); if (one && !('refused' in one)) return { ...op, alts: [{ label: 'just this column', op: one }] }; }
  return op;
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
export function unjog(cells: Array<[number, number]>): Array<[number, number]> {
  const out = cells.slice();
  for (let q = 0; q + 3 < out.length; ) {
    const [a, d] = [out[q], out[q + 3]];
    if (Math.abs(a[0] - d[0]) + Math.abs(a[1] - d[1]) === 1) { out.splice(q + 1, 2); q = Math.max(0, q - 2); } else q++;
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
    // (a stroke doubling back on itself: what it went over twice, once)
    const back = out.findIndex((o) => o[0] === c[0] && o[1] === c[1]);
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
export function trace(w: World, start: Pick, path: Array<[number, number]>, end: Pick | null, born: (i: number, j: number) => number, now = 0, rest: Array<[number, number]> = [], intent: Intent = 'mass'): Op | Refusal | null {
  const walked = walk(path), cells = walked.closed ? walked.cells : unjog(walked.cells);
  // (a way drawn round, back to within a cell or two of its start: round, too; the gap closed)
  const nearly = intent === 'way' && !walked.closed && cells.length >= 10 && Math.max(Math.abs(cells[cells.length - 1][0] - cells[0][0]), Math.abs(cells[cells.length - 1][1] - cells[0][1])) <= 3;
  if (nearly) cells.push(...connect([cells[cells.length - 1], cells[0]]).slice(1, -1));
  const closed = walked.closed || nearly;
  const h0 = surface(w, start);
  // (from a top, along it: a stray off its edge and back (a cell or two, beside it) is the hand's wobble, kept on the top)
  if (start.face === 'top' && !closed) {
    const on = (i: number, j: number) => w.stone(h0 - 1, i, j) && !w.stone(h0, i, j) && w.stair(h0, i, j) < 0;
    for (let q = 1; q < cells.length - 1; q++) {
      if (on(...cells[q]) || !on(...cells[q - 1])) continue;
      let r = q; while (r < cells.length && !on(...cells[r]) && r - q < 3) r++;
      if (r < cells.length && on(...cells[r])) {
        const bridge = connect([cells[q - 1], cells[r]]);
        if (bridge.every(([i, j]) => on(i, j))) cells.splice(q, r - q, ...bridge.slice(1, -1));
      }
    }
  }
  const resting = (i: number, j: number) => rest.some((r) => r[0] === i && r[1] === j);
  // (where it ends counts if it's a top, not its own start)
  let to: Cell | null = null;
  // (from a top down to lower ground: going down to it, not out at the top's height)
  // (the stroke's end over open ground, a couple of cells or more clear of the stone it left, and nothing at its height
  // on the way to meet: where it's going down to. No top under the finger at the end counts as nothing in particular,
  // so it's the last cell's ground)
  const last = cells[cells.length - 1], clear = cells.filter(([i, j]) => !w.stone(w.ground(i, j), i, j)).length;
  const q0 = cells.findIndex(([i, j]) => !w.stone(w.ground(i, j), i, j)), meets = q0 > 0 && cells.slice(q0).some(([i, j]) => w.stone(h0, i, j) || w.stone(h0 - 1, i, j));
  const lastGround = !end && clear >= 2 && !meets && standing(w, w.ground(last[0], last[1]), last[0], last[1]) && w.ground(last[0], last[1]) < h0;
  const descent = intent === 'mass' && start.face === 'top' && ((end?.face === 'ground' && surface(w, end) < h0) || lastGround);
  if (!closed && end && (end.face !== 'ground' || intent === 'way' || descent) && !(end.hit[1] === cells[0][0] && end.hit[2] === cells[0][1])) {
    to = [surface(w, end), end.hit[1], end.hit[2]];
    // (climbing to a top it crossed onto earlier: it arrives where it first reached it, from the side it came)
    if (to[0] > h0) {
      const top = (i: number, j: number) => w.topFrom(w.ground(i, j) - 1, i, j);
      const q = cells.findIndex(([i, j], n) => n > 0 && n < cells.length - 1 && top(i, j) === to![0] && w.stone(to![0] - 1, i, j));
      // (only if, so shortened, it still has the room to climb there)
      if (q > 0 && straights(cells.slice(0, q), [to[0], cells[q][0], cells[q][1]]).length >= to[0] - h0) { to = [to[0], cells[q][0], cells[q][1]]; cells.length = q + 1; }
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
    if (closed) return circuit(w, wh, wc, born, now, resting);
    if (wc.length < 2) return null;
    return way(w, wh, wc, to, now, resting) ?? (wc.length > 2 ? { refused: 'no way along that: nowhere to stand at its ends' } : null);
  }
  // (on the ground, to the ground: a wall along it, each cell on its own column's ground)
  if (start.face === 'ground' && (!to || to[0] === w.ground(to[1], to[2]) && end?.face === 'ground')) return wall(w, cells, closed, born, resting);
  const path2 = to ? cells.slice(0, -1) : cells, climb = to ? Math.abs(to[0] - h0) : 0, room = straights(path2, to).length;
  const tower = to && to[0] !== h0 ? stairTower(w, h0, cells, to, now) : null;
  if (climb > room) {
    // (too steep for a flight along it: a stair tower, climbing inside, if one will stand; else it's refused, saying why)
    if (tower) return tower;
    // (going down from a top, too steep for a flight here: out at the top's height, as it would be read without the drop)
    if (descent) return { connect: { from: [h0, cells[0][0], cells[0][1]], to: null, path: cells }, born: now, why: 'walkway', note: `too steep to go down here (${climb} level${climb > 1 ? 's' : ''}): a walkway out at its height`, reading: 'a walkway' };
    // (and if no tower will stand: a walkway out toward it at the height it starts from, to climb from later)
    const said = `too steep to climb here (${climb} level${climb > 1 ? 's' : ''}, room for ${room} step${room === 1 ? '' : 's'}): a walkway out toward it`;
    return path2.length >= 2 ? { connect: { from: [h0, path2[0][0], path2[0][1]], to: null, path: path2 }, born: now, why: 'walkway', note: said, reading: 'a walkway toward it' } : { refused: `too steep: ${climb} level${climb > 1 ? 's' : ''} to climb, and room for ${room} step${room === 1 ? '' : 's'}; draw it longer, or straighter` };
  }
  if (path2.length < 2 && !to) return null;
  const levels = climb;
  const make = (p: Array<[number, number]>, great: boolean, note?: string): Op => {
    const restAt = p.slice(1).map(([i, j], q) => (resting(i, j) ? q : -1)).filter((q) => q >= 0);
    const said = note ?? (!to ? 'a walkway' : to[0] === h0 ? (great ? 'a bridge, on one great arch' : 'a bridge') : `${to[0] > h0 ? 'climbing' : 'going down'} ${levels} level${levels > 1 ? 's' : ''}${restAt.length ? ', a landing where you paused' : ''}`);
    return { connect: { from: [h0, p[0][0], p[0][1]], to, path: p, ...(restAt.length && to && to[0] !== h0 ? { rest: restAt } : {}) }, born: now, why: !to ? 'walkway' : to[0] === h0 ? 'bridge' : 'stairs', note: said, reading: said, ...(great ? { bridge: true } : {}) };
  };
  // (a bridge four to seven long: one great arch, or an arcade, as the rules choose for where it runs; the other offered)
  const spans = !!to && to[0] === h0 && path2.length >= 5 && path2.length <= 8;
  const great = spans && hash(w.seed, cells[0][0], cells[0][1], to![1], to![2]) % 100 < 50;
  const alts: Alt[] = [];
  let op = make(path2, great);
  if (descent) alts.push({ label: 'a walkway at the height it starts', op: { connect: { from: [h0, cells[0][0], cells[0][1]], to: null, path: cells }, born: now, why: 'walkway', note: 'a walkway', reading: 'a walkway' } });
  if (spans) alts.push({ label: great ? 'a bridge on an arcade' : 'a bridge on one great arch', op: make(path2, !great, great ? 'a bridge, on an arcade' : 'a bridge, on one great arch') });
  // (at one height, and something in the way: round it, the way through it offered)
  if (to && to[0] === h0) {
    const round = around(w, h0, path2, to);
    if (round) { const through = op; op = make(round, false, 'a bridge, round what\'s in the way'); alts.unshift({ label: 'joining what it meets', op: { ...through, note: 'joining what it meets', reading: 'joining what it meets' } }); }
  }
  if (to && to[0] !== h0) {
    // (a climb that would stop short of where it's going, on something in its way: round it to a straight flight into
    // the destination, or else the tower, if either will stand; the flight as drawn offered, joining what it meets)
    const reaches = (o: Op) => { const sim = new World(w.seed, w.landSeed); sim.ops = [...w.ops, o]; sim.rebuild(); return !!sim.reached.get(o)?.reached; };
    if (!reaches(op)) {
      const route = approach(w, h0, path2, to), flight = op, routed = route ? make(route, false, `${to[0] > h0 ? 'climbing' : 'going down'} ${levels} level${levels > 1 ? 's' : ''}, round what's in the way`) : null;
      const better = routed && reaches(routed) ? routed : tower;
      if (better) { op = better; alts.unshift({ label: 'joining what it meets', op: { ...flight, note: 'joining what it meets', reading: 'joining what it meets' } }); if (better === routed && tower) alts.push({ label: 'a stair tower', op: tower }); }
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
function way(w: World, h0: number, cells: Array<[number, number]>, to: Cell | null, now: number, resting: (i: number, j: number) => boolean): Op | Refusal | null {
  // (it starts at the first place along it that can be stood on, and ends at the last: begun in the water, or run off
  // into it, it's the way to and from its banks)
  if (h0 === w.ground(cells[0][0], cells[0][1]) && !standing(w, h0, cells[0][0], cells[0][1])) {
    const q = cells.findIndex(([i, j]) => standing(w, w.ground(i, j), i, j));
    if (q < 0) return { refused: 'that\'s all water: a way wants somewhere to stand' };
    cells = cells.slice(q); h0 = w.ground(cells[0][0], cells[0][1]);
  }
  if (!to) while (cells.length > 2) { const [i, j] = cells[cells.length - 1]; if (standing(w, w.ground(i, j), i, j)) break; cells = cells.slice(0, -1); }
  const last = cells[cells.length - 1];
  const dest: Cell = to ?? [w.ground(last[0], last[1]), last[0], last[1]];
  const path = cells.slice(0, -1);
  if (!path.length || (path.length === 1 && dest[0] === h0 && !to)) return null;
  // (from a place to stand, to one: never from the water, or into it)
  // (ending on somewhere that can't be stood on (in the water, under a tree): it ends at the last place along it that can)
  if (!(standing(w, ...dest) || through(w, ...dest))) {
    let q = cells.length - 2;
    while (q > 0 && !standing(w, w.ground(cells[q][0], cells[q][1]), cells[q][0], cells[q][1])) q--;
    if (q > 0 && q < cells.length - 1) return way(w, h0, cells.slice(0, q + 1), null, now, resting);
  }
  if (!standing(w, h0, path[0][0], path[0][1]) || !(standing(w, ...dest) || through(w, ...dest))) return null;
  const restAt = path.slice(1).map(([i, j], q) => (resting(i, j) ? q : -1)).filter((q) => q >= 0);
  const op: Op = { connect: { from: [h0, path[0][0], path[0][1]], to: dest, path, follow: true, ...(restAt.length ? { rest: restAt } : {}) }, born: now, why: 'way' };
  // (what it comes to, worked out on a copy: said under the finger)
  const sim = new World(w.seed, w.landSeed); sim.ops = [...w.ops, op]; sim.rebuild();
  const r = sim.reached.get(op), stairs = (r?.cells ?? []).filter((c) => sim.stair(...c) >= 0).length;
  const paved = path.slice(1).filter(([i, j]) => sim.paved(i, j)).length, bridge = (r?.cells ?? []).filter((c) => sim.bridge(...c)).length;
  const parts = [paved ? `${paved} paved` : '', stairs ? `a flight of ${stairs}` : '', bridge ? `a bridge of ${bridge}` : ''].filter(Boolean);
  const note = r?.reached ? `a way${parts.length ? ': ' + parts.join(', ') : ''}` : 'a way that can\'t reach as drawn: joining what it meets';
  const alts: Alt[] = [];
  const tower = dest[0] !== h0 ? stairTower(w, h0, [...path, [dest[1], dest[2]]], dest, now) : null;
  const walkway: Op = { connect: { from: [h0, path[0][0], path[0][1]], to: dest[0] === h0 ? dest : null, path: dest[0] === h0 ? path : cells }, born: now, why: 'walkway', note: 'a walkway at the height it starts', reading: 'a walkway at the height it starts' };
  if (!r?.reached && tower) return { ...tower, alts: [{ label: 'the way as drawn, joining what it meets', op: { ...op, note, reading: note } }, { label: 'a walkway at the height it starts', op: walkway }] };
  // (nothing of it can be made from where it starts (begun on a rock, or the foot of a bank too steep to climb there):
  // begun a cell or two on, where it can; and if nothing at all, said, not built empty)
  if (!r?.cells.length) {
    for (let q = 1; q <= 3 && q < cells.length - 1; q++) {
      const [i, j] = cells[q], g = w.ground(i, j);
      if (!standing(w, g, i, j)) continue;
      const on = way(w, g, cells.slice(q), to, now, resting);
      if (on && !('refused' in on)) { const sim2 = new World(w.seed, w.landSeed); sim2.ops = [...w.ops, on]; sim2.rebuild(); if (sim2.reached.get(on)?.cells.length) return { ...on, note: `${on.note}, begun a step on`, reading: `${on.reading ?? on.note}, begun a step on` }; }
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
  return { ...op, note, reading: note, ...(alts.length ? { alts } : {}) };
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
  const op = way(w, q ? g0 : h0, [...ring, [i0, j0]], [g0, i0, j0], now, resting);
  // (a walk that can't get most of the way round isn't round at all: the court, then)
  const sim = op && !('refused' in op) ? (() => { const v = new World(w.seed, w.landSeed); v.ops = [...w.ops, op]; v.rebuild(); return v.reached.get(op); })() : null;
  if (!op || 'refused' in op || !sim || (!sim.reached && sim.stopped < ring.length * 0.6)) return court ? { ...court, alts: op && !('refused' in op) ? [{ label: 'as far round as a walk will go', op: { ...op, alts: undefined } }] : undefined, note: 'a court, walled round (no walk round it would stand)', reading: 'a court, walled round' } : op;
  const note = 'a walk all the way round';
  return { ...op, note, reading: note, alts: [...alts, ...(op.alts ?? [])] };
}

const DIR = (a: [number, number], b: [number, number]) => DIRS.findIndex(([x, z]) => a[0] + x === b[0] && a[1] + z === b[1]);

/** a wall along the stroke (on the stone, from the stone to the stone), as the rules choose it, the others offered: a
 * wall's kind; a ring of it, where the stroke came round, walling in a court */
function wall(w: World, cells: Array<[number, number]>, closed: boolean, born: (i: number, j: number) => number, resting: (i: number, j: number) => boolean): Op | null {
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
  const build = (kind: Kind): Op => {
    const gate = new Set<number>();
    if (kind === 'gated') for (let q = 2; q < n - 1; q += 6) if (straight(q)) gate.add(q);
    if (kind === 'arcaded') for (let q = closed ? 0 : 1; q < (closed ? n : n - 1); q += 2) if (straight(q)) gate.add(q);
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
    const note = label[kind] + (gate.size && kind !== 'gated' && kind !== 'arcaded' && kind !== 'court' ? ', a gate where you paused' : '');
    return { add, ...(arches.length ? { arches } : {}), ...(walls.length ? { walls } : {}), why: 'wall', note, reading: note };
  };
  const first: Kind = closed ? 'court' : wallKind(w, cells[0][0], cells[0][1]);
  const kinds: Kind[] = closed ? ['court', 'ring', 'arcaded', 'thin'] : [first, ...(['plain', 'gated', 'arcaded', 'thin'] as Kind[]).filter((k) => k !== first)];
  const op = build(first);
  return { ...op, alts: kinds.slice(1).map((k) => ({ label: label[k] === label.arcaded && closed ? 'an arcaded court' : label[k], op: build(k) })) };
}

/**
 * A stair tower, for a climb a flight along the stroke can't make: a tower at the high end, as high as it, a stair
 * inside it (buildings.ts), its door at its foot facing the way it was come to, its top joined to the top it's beside.
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
  for (let k = w.ground(e[0], e[1]); k < H; k++) {
    if (w.stair(k, e[0], e[1]) >= 0 || w.tree(k, e[0], e[1]) || w.pier(k, e[0], e[1]) || (k === w.ground(e[0], e[1]) && w.pool(e[0], e[1])) || (w.way(k, e[0], e[1]) && !w.stone(k, e[0], e[1]))) return null;
    if (!w.stone(k, e[0], e[1])) add.push([k, e[0], e[1], now]);
  }
  if (w.occupied(H, e[0], e[1]) || w.tree(H, e[0], e[1])) return null;
  // (its door: toward the way it's come to by, at its foot)
  const toward = up ? (path2.length >= 2 ? path2[path2.length - 2] : null) : (path2[2] ?? (h1 === w.ground(dest[0], dest[1]) ? dest : null));
  const d = toward ? DIR(e, toward) : (DIR(e, dest) + 2) % 4;
  const note = `a stair tower, climbing ${Math.abs(h1 - h0)} level${Math.abs(h1 - h0) > 1 ? 's' : ''} inside it`;
  const op: Op = { add, rule: [[0, e[0], e[1], RULE.tower + Math.max(0, d)]], why: 'tower', note, reading: note, born: now };
  // (from a top, a walkway to it at the start's height: a door where it arrives)
  if (up && h0 > 0) return { ...op, connect: { from: [h0, cells[0][0], cells[0][1]], to: null, path: path2 } };
  return op;
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
