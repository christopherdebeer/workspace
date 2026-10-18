/**
 * What a gesture means. The hand decides the large shape; this reads it into an operation on the intended solid
 * (model.ts), and the model's rules work out what it takes to stand.
 *
 * - **Tap** raises: bare stone, a plinth; a top, another course; a side, the stone pushed out that way (if there's
 *   nothing under it, the rules carry it on an arch or a pier).
 * - **Trace** extends or joins, by where it starts and where it ends:
 *   - from the bare stone to the bare stone: a wall along it;
 *   - from a top, out over anything: a walkway at that height (cut through any wall in its way: what's left over the
 *     cut stands on an arch);
 *   - to a top of another height (from the stone, or from a top): steps and landings along it, climbing evenly,
 *     resting on what's beneath or on arches and piers.
 * - **Hold, then trace** carves: each piece of stone it passes over is cut away (a top lowered a course; a side cut
 *   through, so what's over it is carried on an arch).
 */
import { DIRS, LEVELS, inGrid, type Cell, type Op, type World } from './model';

/** what a touch struck: the stone slab (`hit[0]` −1), a top, or a side; `hit` the cell struck, `to` the free cell on that
 * face's side */
export interface Pick { face: 'ground' | 'top' | 'side'; hit: Cell; to: Cell }

/** the height of the surface a touch is on: the slab is 0, a top is the level above its stone */
export function surface(w: World, p: Pick): number {
  if (p.face === 'ground') return 0;
  return w.topFrom(p.hit[0], p.hit[1], p.hit[2]);
}

export function tap(w: World, p: Pick, now: number): Op | null {
  const [k, i, j] = p.face === 'ground' ? [0, p.hit[1], p.hit[2]] : p.face === 'top' ? [w.topFrom(p.hit[0], p.hit[1], p.hit[2]), p.hit[1], p.hit[2]] : p.to;
  if (k >= LEVELS || !inGrid(i, j) || w.stone(k, i, j) || w.stair(k, i, j) >= 0) return null;
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
 * A trace: from where it started (`start`), over cells (`path`, the start's own column first), to where it ended
 * (`end`: a top it reached, or null). `born(i, j)` says when each cell along it was first passed over (the stone is laid
 * behind the finger). Returns the operation, and what it read the trace as.
 */
export function trace(w: World, start: Pick, path: Array<[number, number]>, end: Pick | null, born: (i: number, j: number) => number): Op | null {
  const cells = connect(path);
  if (cells.length < 2) return null;
  const h0 = surface(w, start);
  // (where it ends counts if it's a top of another height, not the bare stone from up high)
  let h1 = h0, endCell: [number, number] | null = null;
  if (end && end.face !== 'ground') {
    const c: [number, number] = [end.hit[1], end.hit[2]], h = surface(w, end);
    if (!(c[0] === cells[0][0] && c[1] === cells[0][1])) { endCell = c; h1 = h; }
  } else if (end && end.face === 'ground' && h0 === 0) endCell = null;
  if (endCell) {
    // (the path runs on to the cell it ended on, which it doesn't build on)
    const last = cells[cells.length - 1];
    if (last[0] !== endCell[0] || last[1] !== endCell[1]) cells.push(...connect([last, endCell]).slice(1));
    cells.pop();
  }
  const add: Array<[number, number, number, number]> = [], stairs: Array<[number, number, number, number, number]> = [], cut: Cell[] = [];
  const free = (k: number, i: number, j: number) => !w.stone(k, i, j) && w.stair(k, i, j) < 0;
  const dirTo = (a: [number, number], b: [number, number]) => DIRS.findIndex(([x, z]) => x === b[0] - a[0] && z === b[1] - a[1]);
  if (h0 === 0 && h1 === 0) {
    // (a wall along it)
    for (const [i, j] of cells) if (free(0, i, j)) add.push([0, i, j, born(i, j)]);
    return add.length ? { add, why: 'wall' } : null;
  }
  const along = cells.slice(1);
  if (h1 === h0) {
    // (a walkway at its height, through whatever wall's in the way)
    for (const [i, j] of along) {
      if (free(h0 - 1, i, j)) add.push([h0 - 1, i, j, born(i, j)]);
      if (h0 < LEVELS && !free(h0, i, j)) cut.push([h0, i, j]);
    }
    return add.length || cut.length ? { add, cut, why: endCell ? 'bridge' : 'walkway' } : null;
  }
  // (steps and landings: climbing (or going down) evenly along it, a level a step)
  const L = along.length, dz = h1 - h0, steps = Math.min(Math.abs(dz), L);
  let h = h0;
  for (let s = 0; s < L; s++) {
    const [i, j] = along[s], step = Math.floor(((s + 1) * steps) / L) > Math.floor((s * steps) / L);
    const next = s + 1 < L ? along[s + 1] : endCell ?? along[s], prev = s > 0 ? along[s - 1] : cells[0];
    if (step && dz > 0) {
      // (a step up: its floor is where we are, it climbs toward the next cell)
      stairs.push([h, i, j, dirTo([i, j], next) >= 0 ? dirTo([i, j], next) : dirTo(prev, [i, j]), born(i, j)]);
      if (h > 0 && free(h - 1, i, j)) add.push([h - 1, i, j, born(i, j)]);
      for (let k = h + 1; k <= h + 1 && k < LEVELS; k++) if (!free(k, i, j)) cut.push([k, i, j]);
      h++;
    } else if (step) {
      // (a step down: it climbs back toward where we came from)
      h--;
      stairs.push([h, i, j, dirTo([i, j], prev), born(i, j)]);
      if (h > 0 && free(h - 1, i, j)) add.push([h - 1, i, j, born(i, j)]);
    } else {
      // (a landing)
      if (h > 0 && free(h - 1, i, j)) add.push([h - 1, i, j, born(i, j)]);
      if (h < LEVELS && !free(h, i, j)) cut.push([h, i, j]);
    }
  }
  return { add, stairs, cut, why: 'stairs' };
}

/** what carving takes where it touches: the stone (or stair) struck, if it's the hand's (piers and arches are the rules') */
export function carve(w: World, p: Pick): Cell | null {
  if (p.face === 'ground') return null;
  const [k, i, j] = p.hit;
  return w.stone(k, i, j) || w.stair(k, i, j) >= 0 ? [k, i, j] : null;
}
