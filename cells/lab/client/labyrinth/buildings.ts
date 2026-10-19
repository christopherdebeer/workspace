/**
 * Buildings: the solid masses of the labyrinth read as places that are lived in, with doors, windows, a stair inside
 * where one is needed, and a roof where one belongs. Worked out from the resolved world (model.ts) and where a figure
 * could walk (nav.ts), never kept: they follow whatever's built, seeded so the same build always comes out the same.
 *
 * - **A building** is a mass of solid columns (stone from the slab up, nothing carried on arches) all the same height,
 *   two or more high: two cells or more deep each way, or a tower of one or two cells three or more high. A wall a cell
 *   thick isn't one.
 * - **Doors** go where they mean something:
 *   - where a way arrives against a building's wall at height (a walkway, a landing, a bridge's end): a door into it;
 *   - at its foot, facing ground a figure can reach, when a stair inside is needed: when a way up there (at a door, or
 *     on its top) can't be reached from the ground any other way;
 *   - at the foot of a house (a building whose top isn't walked) as a rule, and now and then at the foot of others
 *     facing a court.
 * - **A stair inside** joins a building's doors to each other, and to its top if its top is walked: the way through
 *   that the stone doesn't show (`walkable`).
 * - **Windows**, one style to a building (arched, square, or a slit): on its open faces, alternating along a front and
 *   from one level to the next; on a tower with a stair inside, a slit a level, climbing round it as the stair does.
 * - **A roof** where the top isn't walked and has nothing put on it: hipped on a square plan (a pyramid on a tower),
 *   gabled along a long one, a shed roof falling away from taller stone it leans on, now and then a dome on a marble
 *   tower. Only on a plan that's a plain rectangle, for now. The hand can switch it (select), kept as a rule.
 */
import { hash } from '../kit/rng';
import { DIRS, RULE, key, unkey, type Cell, type World } from './model';
import { navigate, standing, type Nav } from './nav';

export type Roof = 'hipped' | 'gable' | 'shed' | 'dome';
export interface Opening { kind: 'door' | 'window'; style: 'arched' | 'square' | 'slit'; k: number; i: number; j: number; d: number }
export interface Building {
  /** its columns, how high they go (the level over the highest), its plan's bounds, and whether that's a plain rectangle */
  cols: Array<[number, number]>; h: number; i0: number; i1: number; j0: number; j1: number; rect: boolean;
  tower: boolean;
  openings: Opening[];
  /** whether it has a stair inside (doors joined to each other, and to its top if that's walked) */
  inside: boolean;
  /** its top: walked (a way arrives there), and the roof on it if it isn't */
  walked: boolean; roof: Roof | null;
  /** where a roof the hand chose is kept: the lowest cell of its top */
  id: number;
  /** a roof sloping away from (the way it falls, for a shed) */
  fall: number;
}
export interface Buildings { list: Building[]; at: Map<string, Opening>; inside: Array<[Cell, Cell]>; of: Map<number, Building> }

const cache = new WeakMap<World, { v: number; b: Buildings }>();
/** the buildings in a world (worked out once for each state of it) */
export function buildings(w: World): Buildings {
  const c = cache.get(w);
  if (c && c.v === w.version) return c.b;
  const b = find(w);
  cache.set(w, { v: w.version, b });
  return b;
}
/** the opening in a face of a cell, if there is one */
export const opening = (w: World, k: number, i: number, j: number, d: number) => buildings(w).at.get(`${k}.${i}.${j}.${d}`) ?? null;
/** where a figure could walk, ways inside buildings too */
export const walkable = (w: World): Nav => navigate(w, buildings(w).inside);

function find(w: World): Buildings {
  const list: Building[] = [], at = new Map<string, Opening>(), inside: Array<[Cell, Cell]> = [], of = new Map<number, Building>();
  const e = w.extent();
  /** a column of solid stone from the slab up, h high */
  const height = (i: number, j: number) => { let k = 0; while (w.block(k, i, j)) k++; return k; };
  const solid = (i: number, j: number, h: number) => h >= 2 && height(i, j) === h && !w.stone(h, i, j) && w.stair(h, i, j) < 0;
  const seen = new Set<number>();
  // (the walk as the stone shows it, and what of it can be reached from the slab)
  const nav = navigate(w), ground = new Set<number>(), st: number[] = [];
  for (const v of nav.places) if (unkey(v)[0] === 0) { ground.add(v); st.push(v); }
  while (st.length) { const v = st.pop()!; for (const u of nav.next.get(v) ?? []) if (!ground.has(u)) { ground.add(u); st.push(u); } }
  const chance = (p: number, ...n: number[]) => hash(w.seed, ...n) % 1000 < p * 1000;

  for (let j = e.j0; j <= e.j1; j++) for (let i = e.i0; i <= e.i1; i++) {
    const h = height(i, j);
    if (!solid(i, j, h) || seen.has(key(0, i, j))) continue;
    const cols: Array<[number, number]> = [[i, j]], q: Array<[number, number]> = [[i, j]];
    seen.add(key(0, i, j));
    while (q.length) { const [x, z] = q.pop()!; for (const [a, b] of DIRS) { const x2 = x + a, z2 = z + b; if (!seen.has(key(0, x2, z2)) && solid(x2, z2, h)) { seen.add(key(0, x2, z2)); cols.push([x2, z2]); q.push([x2, z2]); } } }
    const i0 = Math.min(...cols.map((c) => c[0])), i1 = Math.max(...cols.map((c) => c[0])), j0 = Math.min(...cols.map((c) => c[1])), j1 = Math.max(...cols.map((c) => c[1]));
    const deep = Math.min(i1 - i0, j1 - j0) >= 1, tower = cols.length <= 2 && h >= 3;
    if (!deep && !tower) continue;
    const mine = new Set(cols.map(([x, z]) => `${x}.${z}`)), id = Math.min(...cols.map(([x, z]) => key(h - 1, x, z)));
    const b: Building = { cols, h, i0, i1, j0, j1, rect: cols.length === (i1 - i0 + 1) * (j1 - j0 + 1), tower, openings: [], inside: false, walked: false, roof: null, id, fall: -1 };
    // (its faces: each column's sides that look out, at each level, and what's outside them)
    const faces: Array<{ k: number; i: number; j: number; d: number; out: Cell }> = [];
    for (const [x, z] of cols) for (let d = 0; d < 4; d++) {
      const [a, bb] = DIRS[d];
      if (mine.has(`${x + a}.${z + bb}`)) continue;
      for (let k = 0; k < h; k++) if (!w.stone(k, x + a, z + bb) && w.stair(k, x + a, z + bb) < 0) faces.push({ k, i: x, j: z, d, out: [k, x + a, z + bb] });
    }
    // (its top: walked if a way arrives there from beyond it)
    const tops = cols.map(([x, z]) => key(h, x, z)).filter((v) => nav.places.has(v)), topSet = new Set(tops);
    const arrives = tops.some((v) => (nav.next.get(v) ?? []).some((u) => !topSet.has(u)));
    // (doors where ways arrive against its walls, at height)
    const placeAt = (c: Cell) => key(...c);
    const upper = faces.filter((f) => f.k >= 1 && standing(w, ...f.out));
    // (a stair inside, if a way at one of those doors, or on its top, can't be reached from the slab otherwise)
    const unreached = upper.some((f) => !ground.has(placeAt(f.out))) || (arrives && tops.some((v) => !ground.has(v)));
    const foot = faces.filter((f) => f.k === 0 && standing(w, ...f.out) && ground.has(placeAt(f.out)));
    const court = foot.filter((f) => w.courts.has(key(0, f.out[1], f.out[2])));
    const style = (['arched', 'square', 'slit'] as const)[hash(w.seed, id, 1) % 3];
    const doors: typeof faces = [...upper];
    // (a house (its top not walked, so lived in under a roof) has a door at its foot too, as a rule)
    if (foot.length && (unreached || (!arrives && chance(0.85, id, 7)) || ((upper.length || court.length) && chance(0.4, id, 2)))) {
      const pickFrom = court.length ? court : foot;
      doors.push(pickFrom[hash(w.seed, id, 3) % pickFrom.length]);
    }
    for (const f of doors) b.openings.push({ kind: 'door', style: 'arched', k: f.k, i: f.i, j: f.j, d: f.d });
    // (the stair inside: every door to the next, and up to the top if the top's walked)
    if (doors.length >= 2 || (doors.length && arrives)) {
      const ends: Cell[] = doors.map((f) => f.out);
      if (arrives && tops.length) ends.push([h, cols[0][0], cols[0][1]]);
      for (let n = 1; n < ends.length; n++) inside.push([ends[0], ends[n]]);
      b.inside = ends.length >= 2;
    }
    b.walked = arrives;
    // (windows: one style to a building; alternating along a front and from level to level; climbing round a tower
    // with a stair inside, a slit a level)
    const isDoor = (f: (typeof faces)[number]) => doors.some((g) => g.k === f.k && g.i === f.i && g.j === f.j && g.d === f.d);
    for (const f of faces) {
      if (isDoor(f) || (f.k === 0 && arrives && !w.courts.has(key(0, f.out[1], f.out[2])))) continue;
      const along = f.d % 2 ? f.i : f.j;
      const want = b.tower && b.inside ? f.d === f.k % 4 : (along + f.k) % 2 === 0 && (f.k < h - 1 || h <= 2 || hash(w.seed, f.i, f.j, f.k, f.d) % 3 > 0);
      if (want) b.openings.push({ kind: 'window', style: b.tower && b.inside ? 'slit' : style, k: f.k, i: f.i, j: f.j, d: f.d });
    }
    // (a roof, where the top isn't walked and nothing's been put on it)
    const rule = w.rules.get(id) ?? 0;
    const dressedTop = cols.some(([x, z]) => { const d = w.dressed(h - 1, x, z); return !!(d?.prop || d?.parapet); });
    if (rule === RULE.noRoof || (!rule && (b.walked || dressedTop || !b.rect))) b.roof = null;
    else if (rule >= RULE.hipped && rule <= RULE.dome) b.roof = (['hipped', 'gable', 'shed', 'dome'] as const)[rule - RULE.hipped];
    else {
      // (the rules' choice: leaning on taller stone, a shed roof falling away from it; square, hipped (now and then a dome
      // on a tower); long, a gable along it)
      const W = i1 - i0 + 1, D = j1 - j0 + 1;
      const taller = [0, 1, 2, 3].filter((d) => { const [a, bb] = DIRS[d]; return cols.every(([x, z]) => mine.has(`${x + a}.${z + bb}`) || height(x + a, z + bb) > h) && cols.some(([x, z]) => !mine.has(`${x + a}.${z + bb}`)); });
      b.roof = taller.length === 1 ? 'shed' : W === D ? (tower && chance(0.35, id, 4) ? 'dome' : 'hipped') : chance(0.25, id, 5) ? 'hipped' : 'gable';
      if (taller.length === 1) b.fall = (taller[0] + 2) % 4;
    }
    if (b.roof === 'shed' && b.fall < 0) b.fall = (hash(w.seed, id, 6) % 4);
    if (b.roof && b.roof !== 'shed') b.fall = -1;
    for (const o of b.openings) at.set(`${o.k}.${o.i}.${o.j}.${o.d}`, o);
    for (const [x, z] of cols) for (let k = 0; k < h; k++) of.set(key(k, x, z), b);
    list.push(b);
  }
  return { list, at, inside, of };
}
