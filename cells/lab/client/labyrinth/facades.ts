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
 * - **Over a court, above the ground**: windows in pairs, every bay, on one sill course.
 * - **A house turned in on its court** (one with a front on one) keeps its outer walls nearly blank: none at the
 *   ground but its doors, and above only a few high windows under its top, every other bay.
 * - Elsewhere, each face as buildings.ts opens it.
 *
 * What's built is untouched: a gallery and an iwan are cut into stone already there. What stands out past it does so
 * by a third of a cell at most (the portal's frame), never into a way kept for a stair, a passage the hand kept open,
 * or another building, and isn't walked.
 */
import { DIRS, key, type Cell, type World } from './model';
import { buildings, type Building } from './buildings';
import { grammarOfId } from './regions';

export type BayRole = 'gallery' | 'portal' | 'over' | 'paired' | 'blank';
export interface Bay { role: BayRole; b: Building; k: number; i: number; j: number; d: number; out: Cell; /** a portal's: the top of its frame's column */ top: number }

/** how far a portal's frame stands out of the wall, and how far it rises past the top */
export const FRAME_OUT = 0.08, FRAME_UP = 0.32;

const cache = new WeakMap<World, { v: number; bays: Map<string, Bay> }>();
/** every bay given a part in a front, by its face (k.i.j.d) */
export function facades(w: World): Map<string, Bay> {
  const c = cache.get(w);
  if (c && c.v === w.version) return c.bays;
  const bays = compose(w);
  cache.set(w, { v: w.version, bays });
  return bays;
}
/** the bay in a face of a cell, if it has a part in a front */
export const bayAt = (w: World, k: number, i: number, j: number, d: number) => facades(w).get(`${k}.${i}.${j}.${d}`) ?? null;

function compose(w: World): Map<string, Bay> {
  const bays = new Map<string, Bay>();
  for (const b of buildings(w).list) {
    if (grammarOfId(w, b.id).facade !== 'court') continue;
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
    for (const f of b.faces) if (f.plain && f.k > base(f.i, f.j) && overCourt(f.out) && !bays.has(`${f.k}.${f.i}.${f.j}.${f.d}`)) put(f, 'paired');
    // (turned in on its court: its other faces blank, but its doors and a few high windows)
    if (runs.length) for (const f of b.faces) {
      if (!f.plain || bays.has(`${f.k}.${f.i}.${f.j}.${f.d}`) || b.openings.some((o) => o.kind === 'door' && o.k === f.k && o.i === f.i && o.j === f.j && o.d === f.d)) continue;
      const high = f.k === b.h - 1 && f.k > base(f.i, f.j) && (f.d % 2 ? f.i : f.j) % 2 === 0;
      if (!high) put(f, 'blank');
    }
  }
  return bays;
}
