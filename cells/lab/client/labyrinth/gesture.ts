/**
 * What a gesture means. The hand decides the large shape; this reads it into an operation on the intended solid
 * (model.ts), and the model's rules work out what it takes to stand.
 *
 * - **Tap** raises: bare stone, a plinth; a top, another course; a side, the stone pushed out that way (if there's
 *   nothing under it, the rules carry it on an arch or a pier).
 * - **Trace** extends or joins, by where it starts and where it ends:
 *   - from the bare stone to the bare stone: a wall along it;
 *   - from a top (or a side: the course touched), out over anything: a walkway at that height;
 *   - to a top of another height (from the stone, or from a top): steps and landings along it, climbing evenly,
 *     resting on what's beneath or on arches and piers.
 *   Each of those is kept as a connection (model.ts): the intent, its stone worked out on replay, never cutting the
 *   hand's stone (it stops where it meets it). Steps go only where the way runs straight (a stair is climbed from its
 *   foot), so a climb with more levels than straight cells isn't built short: it's refused, and says why.
 * - **Carving** (the take brush's stroke): each piece of stone it passes over is cut away (a top lowered a course; a
 *   side cut through, so what's over it is carried on an arch).
 */
import { hash } from '../kit/rng';
import { CEIL, inGrid, straights, type Cell, type Op, type World } from './model';

/** what a touch struck: the stone slab (`hit[0]` −1), a top, or a side; `hit` the cell struck, `to` the free cell on that
 * face's side; `inset`, how squarely */
export interface Pick { face: 'ground' | 'top' | 'side'; hit: Cell; to: Cell; /** how far inside the face struck the touch is, from its nearest edge (0 at an edge, 0.5 at its middle) */ inset?: number }

/** the height of the surface a touch is on: the slab is 0, a top is the level above its stone, a side is the course
 * touched (what's built from it goes out at that course, not from the top of the column) */
export function surface(w: World, p: Pick): number {
  if (p.face === 'ground') return 0;
  if (p.face === 'side') return p.hit[0] + 1;
  return w.topFrom(p.hit[0], p.hit[1], p.hit[2]);
}

export function tap(w: World, p: Pick, now: number): Op | null {
  const [k, i, j] = p.face === 'ground' ? [0, p.hit[1], p.hit[2]] : p.face === 'top' ? [w.topFrom(p.hit[0], p.hit[1], p.hit[2]), p.hit[1], p.hit[2]] : p.to;
  if (k >= CEIL || !inGrid(i, j) || w.stone(k, i, j) || w.stair(k, i, j) >= 0) return null;
  // (a thin wall touched goes on as a thin wall: up, or out along its way)
  const thin = p.face === 'top' ? w.wall(k - 1, i, j) : p.face === 'side' ? w.wall(...p.hit) : -1;
  if (thin >= 0) return { walls: [[k, i, j, p.face === 'side' ? (p.hit[1] !== i ? 0 : 1) : thin, now]], why: p.face === 'side' ? 'extend' : 'course' };
  return { add: [[k, i, j, now]], why: p.face === 'side' ? 'extend' : k === 0 ? 'raise' : 'course' };
}

/** cells, in order, 4-connected: a diagonal step taken as two, the way the stroke leaned */
export function connect(path: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const c of path) {
    const last = out[out.length - 1];
    if (last && last[0] === c[0] && last[1] === c[1]) continue;
    if (last && Math.abs(last[0] - c[0]) + Math.abs(last[1] - c[1]) > 1) {
      // (walk to it a cell at a time, the longer way first)
      let [x, z] = last;
      while (x !== c[0] || z !== c[1]) {
        if (Math.abs(c[0] - x) >= Math.abs(c[1] - z)) x += Math.sign(c[0] - x); else z += Math.sign(c[1] - z);
        if (!out.some((o) => o[0] === x && o[1] === z) || (x === c[0] && z === c[1])) out.push([x, z]);
      }
      continue;
    }
    // (a stroke doubling back on itself: what it went over twice, once)
    const back = out.findIndex((o) => o[0] === c[0] && o[1] === c[1]);
    if (back >= 0) { out.length = back + 1; continue; }
    out.push(c);
  }
  return out;
}

/**
 * A trace: from where it started (`start`), over the columns the stroke crossed (`path`, the start's own first), to
 * where it ended (`end`: a top it reached, or null). `born(i, j)` says when a wall's cells were passed over (laid behind
 * the finger). Returns the operation (a wall, or a connection), or why it can't be built.
 */
export function trace(w: World, start: Pick, path: Array<[number, number]>, end: Pick | null, born: (i: number, j: number) => number, now = 0): Op | { refused: string } | null {
  const cells = connect(path);
  const h0 = surface(w, start);
  // (where it ends counts if it's a top, not its own start)
  let to: Cell | null = null;
  if (end && end.face !== 'ground' && !(end.hit[1] === cells[0][0] && end.hit[2] === cells[0][1])) {
    to = [surface(w, end), end.hit[1], end.hit[2]];
    // (the way goes in at the first column it passes beside the destination, not on round it)
    const at = cells.findIndex((c) => Math.abs(c[0] - to![1]) + Math.abs(c[1] - to![2]) <= 1);
    if (at >= 0) { cells.length = at + 1; if (cells[at][0] !== to[1] || cells[at][1] !== to[2]) cells.push([to[1], to[2]]); }
    else cells.push(...connect([cells[cells.length - 1], [to[1], to[2]]]).slice(1));
  }
  if (cells.length < 2) return null;
  if (h0 === 0 && (!to || to[0] === 0)) {
    // (a wall along it: the hand's own stone. What kind of wall is the rules' choice, seeded by where it runs, so the
    // same stroke always makes the same wall: plain; gated, a way through it near its middle (and every six cells or so,
    // if it's long); or arcaded, a way through every other cell. A long wall is never left plain)
    const free = cells.filter(([i, j]) => !w.stone(0, i, j) && w.stair(0, i, j) < 0 && !w.tree(0, i, j));
    if (!free.length) return null;
    const [a0, a1] = cells[0], [b0, b1] = cells[cells.length - 1], r = hash(w.seed, a0, a1, b0, b1, cells.length) % 100;
    const kind = cells.length >= 5 && r < 30 ? 'arcaded' : (cells.length >= 3 && r < 60) || cells.length >= 8 ? 'gated' : 'plain';
    const across = (q: number) => { const n = cells[Math.min(cells.length - 1, q + 1)], p = cells[Math.max(0, q - 1)]; return n[0] !== p[0] ? 1 : 0; };
    const straight = (q: number) => q > 0 && q < cells.length - 1 && cells[q - 1][0] - cells[q][0] === cells[q][0] - cells[q + 1][0] && cells[q - 1][1] - cells[q][1] === cells[q][1] - cells[q + 1][1];
    const gate = new Set<number>();
    if (kind === 'gated') {
      const n = Math.max(1, Math.round(cells.length / 6));
      for (let g = 0; g < n; g++) { const at = Math.floor(((g + 0.5) * cells.length) / n); for (const q of [at, at - 1, at + 1, at - 2, at + 2]) if (straight(q)) { gate.add(q); break; } }
    }
    if (kind === 'arcaded') for (let q = 1; q < cells.length - 1; q += 2) if (straight(q)) gate.add(q);
    const add: Array<[number, number, number, number]> = [], arches: Array<[number, number, number, number, number]> = [];
    cells.forEach(([i, j], q) => {
      if (!free.some((c) => c[0] === i && c[1] === j)) return;
      if (gate.has(q)) arches.push([0, i, j, across(q), born(i, j)]); else add.push([0, i, j, born(i, j)]);
    });
    return { add, ...(arches.length ? { arches } : {}), why: 'wall' };
  }
  const path2 = to ? cells.slice(0, -1) : cells, climb = to ? Math.abs(to[0] - h0) : 0, room = straights(path2, to).length;
  if (climb > room) return { refused: `too steep: ${climb} level${climb > 1 ? 's' : ''} to climb, and room for ${room} step${room === 1 ? '' : 's'}; draw it longer, or straighter` };
  if (path2.length < 2 && !to) return null;
  // (a bridge four to seven long: one great arch, or an arcade, as the rules choose for where it runs)
  const great = !!to && to[0] === h0 && path2.length >= 5 && path2.length <= 8 && hash(w.seed, cells[0][0], cells[0][1], to[1], to[2]) % 100 < 50;
  return { connect: { from: [h0, cells[0][0], cells[0][1]], to, path: path2 }, born: now, why: !to ? 'walkway' : to[0] === h0 ? 'bridge' : 'stairs', ...(great ? { bridge: true } : {}) };
}

/** what carving takes where it touches: the stone (or stair) struck, if it's the hand's (piers and arches are the rules') */
export function carve(w: World, p: Pick): Cell | null {
  if (p.face === 'ground') return null;
  const [k, i, j] = p.hit;
  return w.stone(k, i, j) || w.stair(k, i, j) >= 0 ? [k, i, j] : null;
}
