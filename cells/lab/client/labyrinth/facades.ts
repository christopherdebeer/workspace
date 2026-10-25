/**
 * Façades: a building's faces read as runs of bays, each bay knowing what it looks onto, and composed as a front, not
 * opened one face at a time. Where a tradition composes round a court (regions.ts, the plateau's), worked out from
 * the resolved world and its buildings (buildings.ts), never kept:
 *
 * - **On a court, at the ground**: the run is an arcade cut into the building's own mass (a gallery: piers, pointed
 *   arches, a vaulted bay behind each, a door or a lit window at its back).
 * - **A portal (an iwan)**: one to a building, two storeys high or more, in the middle of its longest run on a court;
 *   with none, at its door onto a way. A deep pointed recess the height of the front, a door at its back and a lattice
 *   lit over it, under a frame faced in tile that stands a little proud of the wall and rises past its top. The faces
 *   over it are the frame's.
 * - **Over a court, above the ground**: windows in pairs, every bay, on one sill course; or (a house in two) its top
 *   storey a loggia, a gallery behind slender columns in pairs, a low parapet along it.
 * - **Over a drop** (an upper face over ground lower than the building's own foot, air all the way down): a timber balcony on brackets, a third of a
 *   cell out at most, its rail a lattice, every other bay along, on the top two storeys; never out into a way, a kept
 *   passage or stone.
 * - **A house turned in on its court** (one with a front on one) keeps its outer walls nearly blank: none at the
 *   ground but its doors, and above only a few high windows under its top, every other bay.
 * - Elsewhere, each face as buildings.ts opens it.
 *
 *
 * Where a tradition composes to the street (the north's): its storeys over the ground jettied out over the one under
 * them, an eighth of a cell, out only into free air, round its corners; at the ground, along the front its door's in, a
 * shopfront to each bay but the door's: a wide opening under a timber beam, a stall board, its window lit, a board
 * hinged up over it.
 *
 * Where a tradition composes on verandas (the east's): at the ground, onto open ground (not a way, a kept passage or
 * stone), under the skirt of tile over it, a deck of boards on posts, the front behind it a lattice of screens, lit.
 *
 * What's built is untouched: a gallery and an iwan are cut into stone already there. What stands out past it does so
 * by a third of a cell at most (the portal's frame), never into a way kept for a stair, a passage the hand kept open,
 * or another building, and isn't walked.
 */
import { DIRS, key, type Cell, type World } from './model';
import { buildings, type Building } from './buildings';
import { grammarOfId } from './regions';
import { hash } from '../kit/rng';

export type BayRole = 'gallery' | 'portal' | 'over' | 'paired' | 'loggia' | 'balcony' | 'blank' | 'jetty' | 'shop' | 'veranda';
export interface Bay { role: BayRole; b: Building; k: number; i: number; j: number; d: number; out: Cell; /** a portal's: the top of its frame's column */ top: number; /** a loggia's, a jetty's, a veranda's: whether it ends at either side (toward s0, toward s1), its own side walls there */ ends?: [boolean, boolean];
  /** a jetty's: how far it runs on past either side, round a corner the next face's jetty meets */ ext?: [number, number] }
/** how far a jettied storey stands out over the one under it; how deep a veranda's deck */
export const JETTY = 0.12, DECK_OUT = 0.22;

/** how far a portal's frame stands out of the wall, and how far it rises past the top */
export const FRAME_OUT = 0.08, FRAME_UP = 0.32;

const cache = new WeakMap<World, { v: number; bays: Map<string, Bay> }>();
/** every bay given a part in a front, by its face (k.i.j.d) */
export function facades(w: World): Map<string, Bay> {
  const c = cache.get(w);
  if (c && c.v === w.version) return c.bays;
  const bays = compose(w);
  if (w.bay === 2) inPairs(w, bays);
  cache.set(w, { v: w.version, bays });
  return bays;
}
/** the bay in a face of a cell, if it has a part in a front */
export const bayAt = (w: World, k: number, i: number, j: number, d: number) => facades(w).get(`${k}.${i}.${j}.${d}`) ?? null;

function compose(w: World): Map<string, Bay> {
  const bays = new Map<string, Bay>();
  for (const b of buildings(w).list) {
    const fc = grammarOfId(w, b.id).facade;
    if (fc === 'street') { street(w, b, bays); continue; }
    if (fc === 'veranda') { veranda(w, b, bays); continue; }
    if (fc !== 'court') continue;
    const base = (i: number, j: number) => b.base[b.cols.findIndex(([x, z]) => x === i && z === j)];
    const has = new Map(b.faces.map((f) => [`${f.k}.${f.i}.${f.j}.${f.d}`, f]));
    const onCourt = (f: Bay['out']) => w.courts.has(key(0, f[1], f[2])) && f[0] === w.ground(f[1], f[2]);
    const overCourt = (f: Bay['out']) => w.courts.has(key(0, f[1], f[2])) && f[0] > w.ground(f[1], f[2]);
    // (the ground's faces on a court, in runs along each side: consecutive along it, at the same level)
    const ground = b.faces.filter((f) => f.plain && f.k === base(f.i, f.j) && onCourt(f.out));
    const runs: Array<typeof ground> = [];
    for (const d of [0, 1, 2, 3]) {
      const side = ground.filter((f) => f.d === d).sort((p, q) => (d % 2 ? p.i - q.i : p.j - q.j) || p.k - q.k);
      let run: typeof ground = [];
      for (const f of side) {
        const last = run[run.length - 1];
        if (last && (f.k !== last.k || (d % 2 ? f.i - last.i : f.j - last.j) !== 1)) { runs.push(run); run = []; }
        run.push(f);
      }
      if (run.length) runs.push(run);
    }
    // (a portal's column: the faces over it there all the building's own and plain, nothing in front of it a way, a kept
    // passage or stone, at any level, nor over its top)
    const clear = (f: (typeof ground)[number]) => {
      const [a, c] = DIRS[f.d], top = b.h;
      if (top - f.k < 2) return false;
      for (let k = f.k; k <= top; k++) {
        if (k < top && !has.get(`${k}.${f.i}.${f.j}.${f.d}`)?.plain) return false;
        if (w.way(k, f.i + a, f.j + c) || w.passage(k, f.i + a, f.j + c) >= 0 || (k > f.k && w.stone(k, f.i + a, f.j + c))) return false;
      }
      return !w.occupied(top, f.i, f.j) && w.stair(top, f.i, f.j) < 0 && !w.way(top, f.i, f.j);
    };
    let portal: (typeof ground)[number] | null = null;
    for (const run of [...runs].sort((p, q) => q.length - p.length)) { const f = run[Math.floor((run.length - 1) / 2)]; if (clear(f)) { portal = f; break; } }
    // (with no court to face: at its door onto a way, or onto open ground)
    if (!portal) for (const o of b.openings) {
      if (o.kind !== 'door' || o.k !== base(o.i, o.j)) continue;
      const f = has.get(`${o.k}.${o.i}.${o.j}.${o.d}`);
      if (f && clear(f)) { portal = f; break; }
    }
    const put = (f: { k: number; i: number; j: number; d: number; out: Cell }, role: BayRole, top = 0) => bays.set(`${f.k}.${f.i}.${f.j}.${f.d}`, { role, b, k: f.k, i: f.i, j: f.j, d: f.d, out: f.out, top });
    if (portal) {
      put(portal, 'portal', b.h);
      for (let k = portal.k + 1; k < b.h; k++) put(has.get(`${k}.${portal.i}.${portal.j}.${portal.d}`)!, 'over');
    }
    for (const run of runs) for (const f of run) if (!bays.has(`${f.k}.${f.i}.${f.j}.${f.d}`)) put(f, 'gallery');
    // (over the court: the top storey a loggia in a house in two, if it's over the ground's; the rest paired windows)
    const loggia = hash(w.seed, b.id, 61) % 2 === 0;
    for (const f of b.faces) {
      if (!f.plain || f.k <= base(f.i, f.j) || !overCourt(f.out) || bays.has(`${f.k}.${f.i}.${f.j}.${f.d}`)) continue;
      put(f, loggia && f.k === b.h - 1 && f.k - base(f.i, f.j) >= 1 ? 'loggia' : 'paired');
    }
    // (a loggia's ends: where the next face along isn't one)
    for (const by of bays.values()) {
      if (by.b !== b || by.role !== 'loggia') continue;
      const [ta, tb] = DIRS[(by.d + 1) % 4], next = (s: number) => bays.get(`${by.k}.${by.i + ta * s}.${by.j + tb * s}.${by.d}`)?.role === 'loggia';
      by.ends = [!next(-1), !next(1)];
    }
    // (over a drop: a balcony, every other bay along, on the top two storeys, out only into free air)
    for (const f of b.faces) {
      const [, oi, oj] = f.out, k = f.k;
      if (!f.plain || k <= base(f.i, f.j) || k < b.h - 2 || bays.has(`${k}.${f.i}.${f.j}.${f.d}`) || overCourt(f.out)) continue;
      if (Math.floor((f.d % 2 ? f.i : f.j) / w.bay) % 2 !== k % 2) continue;
      // (a drop: the ground out there lower than the building's own foot; air all the way down to it)
      let drop = w.ground(oi, oj) < base(f.i, f.j);
      for (let q = w.ground(oi, oj); q < k && drop; q++) if (w.occupied(q, oi, oj) || w.earth(q, oi, oj)) drop = false;
      if (drop && !w.occupied(k, oi, oj) && !w.way(k, oi, oj) && w.passage(k, oi, oj) < 0 && !w.way(k + 1, oi, oj) && w.passage(k - 1, oi, oj) < 0) put(f, 'balcony');
    }
    // (turned in on its court: its other faces blank, but its doors and a few high windows)
    if (runs.length) for (const f of b.faces) {
      if (!f.plain || bays.has(`${f.k}.${f.i}.${f.j}.${f.d}`) || b.openings.some((o) => o.kind === 'door' && o.k === f.k && o.i === f.i && o.j === f.j && o.d === f.d)) continue;
      const high = f.k === b.h - 1 && f.k > base(f.i, f.j) && Math.floor((f.d % 2 ? f.i : f.j) / w.bay) % 2 === 0;
      if (!high) put(f, 'blank');
    }
  }
  return bays;
}

/**
 * On the half grid, a front's bays two faces wide: each part moved to its bay's leading face (buildings.ts `pairOf`),
 * which draws it across both, its partner left to it (`over`); a face with no partner in its bay (an odd one at a
 * front's end) plain, but a jetty's (the storey stands out whole). A run's ends looked for a bay along, not a face.
 */
function inPairs(w: World, bays: Map<string, Bay>) {
  const { pairs, partners } = buildings(w);
  for (const [id, by] of [...bays]) {
    const lead = partners.get(id);
    if (lead && !bays.has(lead)) { const [k, i, j, d] = lead.split('.').map(Number); bays.set(lead, { ...by, k, i, j, d, out: [k, i + DIRS[d][0], j + DIRS[d][1]] }); }
  }
  for (const [id, by] of [...bays]) {
    const p = pairs.get(id);
    if (p) bays.set(p, { ...by, role: 'over', k: by.k, ends: undefined, ext: undefined });
    else if (!partners.has(id) && by.role !== 'jetty') bays.set(id, { ...by, role: 'blank' });
  }
  for (const by of bays.values()) if ((by.role === 'loggia' || by.role === 'veranda') && pairs.has(`${by.k}.${by.i}.${by.j}.${by.d}`)) {
    const [ta, tb] = DIRS[(by.d + 1) % 4], same = (s: number) => bays.get(`${by.k}.${by.i + ta * s}.${by.j + tb * s}.${by.d}`)?.role === by.role;
    by.ends = [!same(-2), !same(2)];
  }
}

const baseOf = (b: Building, i: number, j: number) => b.base[b.cols.findIndex(([x, z]) => x === i && z === j)];
const putIn = (bays: Map<string, Bay>, b: Building, f: { k: number; i: number; j: number; d: number; out: Cell }, role: BayRole) => { const by: Bay = { role, b, k: f.k, i: f.i, j: f.j, d: f.d, out: f.out, top: 0 }; bays.set(`${f.k}.${f.i}.${f.j}.${f.d}`, by); return by; };
/** each of a run's ends (toward s0, toward s1): open (the next face along isn't of the same role) */
function endsOf(bays: Map<string, Bay>, by: Bay): [boolean, boolean] {
  const [ta, tb] = DIRS[(by.d + 1) % 4], same = (s: number) => bays.get(`${by.k}.${by.i + ta * s}.${by.j + tb * s}.${by.d}`)?.role === by.role;
  return [!same(-1), !same(1)];
}
/** air a thing may stand out into: nothing there, no way kept for a stair, no passage kept open */
const free = (w: World, k: number, i: number, j: number) => !w.occupied(k, i, j) && !w.way(k, i, j) && w.passage(k, i, j) < 0 && !w.earth(k, i, j);

/** the north's: jettied storeys, shopfronts along the door's front */
function street(w: World, b: Building, bays: Map<string, Bay>) {
  for (const f of b.faces) if (f.plain && f.k > baseOf(b, f.i, f.j) && free(w, ...f.out)) putIn(bays, b, f, 'jetty');
  for (const by of bays.values()) {
    if (by.b !== b || by.role !== 'jetty') continue;
    by.ends = endsOf(bays, by);
    // (round a corner: the face whose far end meets the next face's jetty runs on to meet it)
    const turn = bays.get(`${by.k}.${by.i}.${by.j}.${(by.d + 1) % 4}`)?.role === 'jetty';
    by.ext = [0, by.ends[1] && turn ? JETTY : 0];
    if (by.ends[1] && turn) by.ends = [by.ends[0], false];
    if (by.ends[0] && bays.get(`${by.k}.${by.i}.${by.j}.${(by.d + 3) % 4}`)?.role === 'jetty') by.ends = [false, by.ends[1]];
  }
  // (shopfronts: the door's front at the ground, each bay of it but the door's, onto open ground)
  for (const o of b.openings) {
    if (o.kind !== 'door' || o.k !== baseOf(b, o.i, o.j)) continue;
    const [ta, tb] = DIRS[(o.d + 1) % 4];
    for (const sg of [-1, 1]) for (let s = 1; s < 8; s++) {
      const f = b.faces.find((q) => q.k === o.k && q.d === o.d && q.i === o.i + ta * s * sg && q.j === o.j + tb * s * sg);
      if (!f || !f.plain || !free(w, ...f.out) || b.openings.some((q) => q.kind === 'door' && q.k === f.k && q.i === f.i && q.j === f.j && q.d === f.d)) break;
      putIn(bays, b, f, 'shop');
    }
  }
}

/** the east's: a veranda along each front at the ground onto open ground, under the skirt over it */
function veranda(w: World, b: Building, bays: Map<string, Bay>) {
  if (b.h - Math.min(...b.base) < 2) return;
  for (const f of b.faces) if (f.plain && f.k === baseOf(b, f.i, f.j) && b.h - f.k >= 2 && free(w, ...f.out)) putIn(bays, b, f, 'veranda');
  for (const by of bays.values()) if (by.b === b && by.role === 'veranda') by.ends = endsOf(bays, by);
}
