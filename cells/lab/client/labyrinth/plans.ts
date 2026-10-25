/**
 * Floor plans: what's inside a building, worked out from what's built (buildings.ts, facades.ts), never kept, never yet
 * drawn. Each storey of a building is laid out in rooms, each room knowing its size, its light, how it's come into and
 * left, and what it opens on to; so what's built can be read for what it's good for (uses.ts), and what it took to
 * build (ladder.ts).
 *
 * - **Measures**: a cell is 3 m across and a storey 3 m high; on the half grid (`w.bay` 2) a square is half a cell.
 * - **A storey's floor**: the building's squares at that height that are its own stone, not a passage through it.
 * - **Rooms**: the floor in the fewest largest rectangles (its wings), each cut along its length into rooms no longer
 *   than `ROOM` (two cells); a room deeper than `SPAN` across both ways is a **hall**, its floor or roof over it carried
 *   on more than a beam can span (a vault, or posts).
 * - **Its openings**: the building's doors and windows in a room's outer faces (on the half grid, a bay's leading face
 *   holds them), and the parts its front gives it (a gallery or a shopfront it opens on to, a balcony or a loggia it
 *   steps out on to, a portal it's entered by).
 * - **Light**: the share of a room's floor within `LIGHT` (two cells) of a face that lets light in (a window, a door, an
 *   open bay).
 * - **Ways in and out**: each door of a storey, by what it gives on to: the ground (or a way laid on it), a court, a
 *   way at height (a walkway, a bridge's end, a landing), another building's top, a passage under it.
 * - **The stair**: in the room of the ground storey that touches the most others (a stair hall), shown where the
 *   building's doors are joined by it (buildings.ts `inside`), else implied wherever there's a storey over another; up
 *   to its top if that's walked.
 */
import { DIRS, key, type World } from './model';
import { buildings, type Building } from './buildings';
import { facades, type BayRole } from './facades';

/** a cell, and a storey, in metres; rooms no longer than ROOM, a beam's reach SPAN, daylight's LIGHT (in cells) */
export const CELL_M = 3, STOREY_M = 3, ROOM = 2, SPAN = 2, LIGHT = 2;

export type ExitTo = 'ground' | 'way' | 'court' | 'height' | 'top' | 'passage';
export interface Exit { k: number; i: number; j: number; d: number; to: ExitTo; room: number }
export interface Room {
  id: number; k: number; squares: Array<[number, number]>;
  /** its floor (m²), its two sides (m), the longer first */
  area: number; long: number; short: number;
  windows: number; doors: number;
  /** the parts of its front it opens on to (a gallery, a shopfront, a veranda, a portal), or steps out on to (a
   * balcony, a loggia) */
  open: BayRole[];
  /** the rooms it shares a wall with (an inner door between, as there would be) */
  next: number[];
  /** the share of its floor in daylight */
  lit: number;
  /** wider than a beam spans both ways: its floor (or roof) on a vault or on posts */
  hall: boolean;
  stair: boolean;
}
export interface Storey { k: number; rooms: Room[]; area: number }
export interface Plan {
  b: Building; storeys: Storey[]; rooms: Room[]; exits: Exit[];
  /** floor in all (m²), and how much of it is lit */
  area: number; lit: number;
  /** its stair: drawn (its doors joined: buildings.ts), implied (a storey over another), or none (one storey) */
  stair: 'shown' | 'implied' | null;
  /** where it's open to the sky to be stood on: a walked top, a terrace beside its roof, balconies, loggias */
  outdoor: { top: boolean; terrace: number; balconies: number; loggias: number };
  /** a court it faces, at its foot */
  court: boolean;
}

const cache = new WeakMap<World, { v: number; p: Plan[] }>();
/** every building's plan (worked out once for each state of the world) */
export function plans(w: World): Plan[] {
  const c = cache.get(w);
  if (c && c.v === w.version) return c.p;
  const p = buildings(w).list.map((b) => planOf(w, b));
  cache.set(w, { v: w.version, p });
  return p;
}

/** the largest rectangles that cover a set of squares, without overlapping: the largest there is, then the largest
 * of what's left, and on (each from a corner square, as wide as it goes, then as deep as each width allows) */
function rectangles(cells: Array<[number, number]>): Array<{ i0: number; i1: number; j0: number; j1: number }> {
  const left = new Set(cells.map(([i, j]) => `${i}.${j}`)), out: Array<{ i0: number; i1: number; j0: number; j1: number }> = [];
  const from = (i: number, j: number) => {
    let best = { i0: i, i1: i, j0: j, j1: j }, area = 1, wmax = 0;
    while (left.has(`${i + wmax + 1}.${j}`)) wmax++;
    for (let wd = 0, dp = 1e9; wd <= wmax; wd++) {
      // (each wider one no deeper than the narrower: the column at its new edge limits it)
      let d = 0; while (d < dp && left.has(`${i + wd}.${j + d + 1}`)) d++;
      dp = Math.min(dp, d);
      const a = (wd + 1) * (dp + 1);
      if (a > area) { area = a; best = { i0: i, i1: i + wd, j0: j, j1: j + dp }; }
    }
    return { best, area };
  };
  while (left.size) {
    let top = { best: { i0: 0, i1: 0, j0: 0, j1: 0 }, area: 0 };
    for (const s of [...left].sort()) { const [i, j] = s.split('.').map(Number), r = from(i, j); if (r.area > top.area) top = r; }
    for (let x = top.best.i0; x <= top.best.i1; x++) for (let z = top.best.j0; z <= top.best.j1; z++) left.delete(`${x}.${z}`);
    out.push(top.best);
  }
  return out;
}

function planOf(w: World, b: Building): Plan {
  const B = w.bay, sq = CELL_M / B, bs = buildings(w), bays = facades(w);
  const baseOf = (i: number, j: number) => b.base[b.cols.findIndex(([x, z]) => x === i && z === j)];
  const k0 = Math.min(...b.base), rooms: Room[] = [], storeys: Storey[] = [], exits: Exit[] = [];
  for (let k = k0; k < b.h; k++) {
    // (its floor: its own stone at this height, not a passage through it)
    const floor = b.cols.filter(([i, j]) => baseOf(i, j) <= k && w.stone(k, i, j) && w.archway(k, i, j) < 0);
    if (!floor.length) continue;
    const at = new Map<string, Room>(), here: Room[] = [];
    // (a piece narrower than a cell (on the half grid: a pilaster, a wall's thickness beside a recess) is wall, not a room)
    for (const r of rectangles(floor).filter((r) => Math.min(r.i1 - r.i0, r.j1 - r.j0) + 1 >= B)) {
      // (cut along its length into rooms no longer than ROOM cells, as even as they'll go)
      const alongI = r.i1 - r.i0 >= r.j1 - r.j0, len = alongI ? r.i1 - r.i0 + 1 : r.j1 - r.j0 + 1, n = Math.ceil(len / (ROOM * B));
      for (let q = 0; q < n; q++) {
        const a = Math.round((q * len) / n), e = Math.round(((q + 1) * len) / n) - 1;
        const sqs: Array<[number, number]> = [];
        for (let x = alongI ? r.i0 + a : r.i0; x <= (alongI ? r.i0 + e : r.i1); x++) for (let z = alongI ? r.j0 : r.j0 + a; z <= (alongI ? r.j1 : r.j0 + e); z++) sqs.push([x, z]);
        const wi = alongI ? e - a + 1 : r.i1 - r.i0 + 1, dj = alongI ? r.j1 - r.j0 + 1 : e - a + 1;
        const room: Room = { id: rooms.length + here.length, k, squares: sqs, area: sqs.length * sq * sq, long: Math.max(wi, dj) * sq, short: Math.min(wi, dj) * sq, windows: 0, doors: 0, open: [], next: [], lit: 0, hall: Math.min(wi, dj) > SPAN * B, stair: false };
        here.push(room);
        for (const [x, z] of sqs) at.set(`${x}.${z}`, room);
      }
    }
    // (each room's faces: out to the world (its openings and its front's parts), or on to the room beside it)
    const bright = new Set<string>();
    for (const room of here) for (const [i, j] of room.squares) for (let d = 0; d < 4; d++) {
      const [a, c] = DIRS[d], nb = at.get(`${i + a}.${j + c}`);
      if (nb) { if (nb !== room && !room.next.includes(nb.id)) room.next.push(nb.id); continue; }
      // (a door into a passage through the building is set in the passage's side: buildings.ts)
      const side = w.archway(k, i + a, j + c) >= 0 ? bs.at.get(`${k}.${i + a}.${j + c}.${(d + 2) % 4}`) : null;
      if (side?.kind === 'door') { room.doors++; bright.add(`${i}.${j}`); exits.push({ k, i, j, d, to: 'passage', room: room.id }); continue; }
      const op = bs.at.get(`${k}.${i}.${j}.${d}`), by = bays.get(`${k}.${i}.${j}.${d}`);
      if (op?.kind === 'window') { room.windows++; bright.add(`${i}.${j}`); }
      if (op?.kind === 'door') {
        room.doors++; bright.add(`${i}.${j}`);
        const ox = i + a, oz = j + c;
        const to: ExitTo = w.archway(k, ox, oz) >= 0 ? 'passage' : w.courts.has(key(0, ox, oz)) && k === w.ground(ox, oz) ? 'court' : k === w.ground(ox, oz) ? (w.way(k, ox, oz) ? 'way' : 'ground') : w.way(k, ox, oz) || w.passage(k, ox, oz) >= 0 ? 'height' : 'top';
        exits.push({ k, i, j, d, to, room: room.id });
      }
      if (by && by.role !== 'blank' && by.role !== 'over' && by.role !== 'jetty') { if (!room.open.includes(by.role)) room.open.push(by.role); bright.add(`${i}.${j}`); }
      // (a portal's the way in: its door at the back of the recess)
      if (by?.role === 'portal' || by?.role === 'gallery' || by?.role === 'shop' || by?.role === 'veranda') {
        const ox = i + a, oz = j + c;
        if (by.role === 'portal' || (by.role === 'gallery' && (i + j) % 2 === 0)) { room.doors++; exits.push({ k, i, j, d, to: w.courts.has(key(0, ox, oz)) ? 'court' : 'ground', room: room.id }); }
      }
    }
    // (daylight: the share of each room's floor within LIGHT cells of a face that lets it in)
    const lights = [...bright].map((s) => s.split('.').map(Number));
    for (const room of here) {
      const near = room.squares.filter(([i, j]) => lights.some(([x, z]) => Math.max(Math.abs(x - i), Math.abs(z - j)) < LIGHT * B)).length;
      room.lit = near / room.squares.length;
    }
    rooms.push(...here);
    storeys.push({ k, rooms: here, area: here.reduce((t, r) => t + r.area, 0) });
  }
  // (the stair: in the ground storey's room that touches the most others)
  const many = storeys.length > 1 || b.walked;
  const stair: Plan['stair'] = b.inside ? 'shown' : many ? 'implied' : null;
  if (stair && storeys.length) { const g = storeys[0].rooms.slice().sort((p, q) => q.next.length - p.next.length || q.area - p.area)[0]; if (g) g.stair = true; }
  const area = rooms.reduce((t, r) => t + r.area, 0), lit = area ? rooms.reduce((t, r) => t + r.lit * r.area, 0) / area : 0;
  const roles = rooms.flatMap((r) => r.open);
  return {
    b, storeys, rooms, exits, area, lit, stair,
    outdoor: { top: b.walked, terrace: b.terrace?.length ?? 0, balconies: roles.filter((r) => r === 'balcony').length, loggias: roles.filter((r) => r === 'loggia').length },
    court: b.faces.some((f) => w.courts.has(key(0, f.out[1], f.out[2])) && f.out[0] === w.ground(f.out[1], f.out[2])),
  };
}
