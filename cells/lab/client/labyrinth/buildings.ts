/**
 * Buildings: the solid masses of the labyrinth read as places that are lived in, with doors, windows, a stair inside
 * where one is needed, and a roof where one belongs. Worked out from the resolved world (model.ts) and where a figure
 * could walk (nav.ts), never kept: they follow whatever's built, seeded so the same build always comes out the same.
 *
 * - **A building** is a mass of solid columns (stone from the slab up, nothing carried on arches) all the same height,
 *   two or more high: two cells by two somewhere in it, or a tower of one or two cells three or more high. A wall a cell
 *   thick isn't one, however it runs (round a court, on the diagonal). A stair tower (the rules' answer to a climb too
 *   steep for a flight, `RULE.tower`) is one however slim: its door at its foot facing the way it was come to.
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
 * - **A roof** where the top isn't walked and has nothing put on it (nor water let into it): hipped on a square plan (a pyramid on a tower),
 *   gabled along a long one, a shed roof falling away from taller stone it leans on, now and then a dome on a marble
 *   tower. Only on a plan that's a plain rectangle, for now. The hand can switch it (select), kept as a rule.
 */
import { hash } from '../kit/rng';
import { DIRS, RULE, isTower, key, unkey, type Cell, type World } from './model';
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
  /** walked along one edge only: that edge a terrace, the roof over the rest of the plan (these bounds) */
  roofPlan?: { i0: number; i1: number; j0: number; j1: number }; terrace?: Array<[number, number]>;
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
/** the columns a building's roof is over (none if it has none; not those of a terrace beside it) */
export const underRoof = (b: Building): Array<[number, number]> => (b.roof ? b.cols.filter(([x, z]) => !b.terrace?.some(([p, q]) => p === x && q === z)) : []);

function find(w: World): Buildings {
  const list: Building[] = [], at = new Map<string, Opening>(), inside: Array<[Cell, Cell]> = [], of = new Map<number, Building>();
  const e = w.extent();
  /** a column of solid stone from the slab up, h high */
  const height = (i: number, j: number) => { let k = w.ground(i, j); while (w.block(k, i, j)) k++; return k; };
  const solid = (i: number, j: number, h: number) => h - w.ground(i, j) >= 2 && height(i, j) === h && !w.stone(h, i, j) && w.stair(h, i, j) < 0;
  const seen = new Set<number>();
  // (the walk as the stone shows it, and what of it can be reached from the slab)
  const nav = navigate(w), ground = new Set<number>(), st: number[] = [];
  // (on the land, its ground at each column's own level)
  for (const v of nav.places) { const [k, i, j] = unkey(v); if (k === w.ground(i, j)) { ground.add(v); st.push(v); } }
  while (st.length) { const v = st.pop()!; for (const u of nav.next.get(v) ?? []) if (!ground.has(u)) { ground.add(u); st.push(u); } }
  const chance = (p: number, ...n: number[]) => hash(w.seed, ...n) % 1000 < p * 1000;
  // (masses as a whole, whatever height each column of them reaches: one built across a slope, steps of it at
  // different heights, is read as stepping, each step a building of its own if the whole is deep)
  const anyH = (i: number, j: number) => solid(i, j, height(i, j));
  const massOf = new Map<string, { deep: boolean; heights: Set<number> }>();
  for (let j = e.j0; j <= e.j1; j++) for (let i = e.i0; i <= e.i1; i++) {
    if (!anyH(i, j) || massOf.has(`${i}.${j}`)) continue;
    const m = { deep: false, heights: new Set<number>() }, q: Array<[number, number]> = [[i, j]], cs: Array<[number, number]> = [];
    massOf.set(`${i}.${j}`, m);
    while (q.length) { const [x, z] = q.pop()!; cs.push([x, z]); m.heights.add(height(x, z)); for (const [a, b] of DIRS) if (anyH(x + a, z + b) && !massOf.has(`${x + a}.${z + b}`)) { massOf.set(`${x + a}.${z + b}`, m); q.push([x + a, z + b]); } }
    const has = new Set(cs.map(([x, z]) => `${x}.${z}`));
    m.deep = cs.some(([x, z]) => has.has(`${x + 1}.${z}`) && has.has(`${x}.${z + 1}`) && has.has(`${x + 1}.${z + 1}`));
  }

  for (let j = e.j0; j <= e.j1; j++) for (let i = e.i0; i <= e.i1; i++) {
    const h = height(i, j);
    if (!solid(i, j, h) || seen.has(key(0, i, j))) continue;
    const cols: Array<[number, number]> = [[i, j]], q: Array<[number, number]> = [[i, j]];
    seen.add(key(0, i, j));
    while (q.length) { const [x, z] = q.pop()!; for (const [a, b] of DIRS) { const x2 = x + a, z2 = z + b; if (!seen.has(key(0, x2, z2)) && solid(x2, z2, h)) { seen.add(key(0, x2, z2)); cols.push([x2, z2]); q.push([x2, z2]); } } }
    const i0 = Math.min(...cols.map((c) => c[0])), i1 = Math.max(...cols.map((c) => c[0])), j0 = Math.min(...cols.map((c) => c[1])), j1 = Math.max(...cols.map((c) => c[1]));
    // (deep: a true mass, two by two somewhere in it; a ring of wall, or a wall on the diagonal, spans as wide but isn't)
    const has = new Set(cols.map(([x, z]) => `${x}.${z}`));
    // (a stair tower, put where a climb was too steep for a flight: a building however slim, two high or more)
    const stairTower = cols.find(([x, z]) => isTower(w.rules.get(key(0, x, z))));
    const deep = cols.some(([x, z]) => has.has(`${x + 1}.${z}`) && has.has(`${x}.${z + 1}`) && has.has(`${x + 1}.${z + 1}`)), tower = (cols.length <= 2 && h >= 3) || !!stairTower;
    const whole = massOf.get(`${i}.${j}`);
    if (!deep && !tower && !(whole?.deep && whole.heights.size > 1)) continue;
    // (its identity: the column first laid by the hand, the lowest of those if several (not the lowest of all its cells:
    // a neighbour added later never re-rolls its windows, door or roof))
    const first = Math.min(...cols.map(([x, z]) => w.firstOp.get(key(0, x, z)) ?? 1e9));
    const mine = new Set(cols.map(([x, z]) => `${x}.${z}`)), id = Math.min(...cols.filter(([x, z]) => (w.firstOp.get(key(0, x, z)) ?? 1e9) === first).map(([x, z]) => key(h - 1, x, z)));
    const b: Building = { cols, h, i0, i1, j0, j1, rect: cols.length === (i1 - i0 + 1) * (j1 - j0 + 1), tower, openings: [], inside: false, walked: false, roof: null, id, fall: -1 };
    // (its faces: each column's sides that look out, at each level, and what's outside them)
    const faces: Array<{ k: number; i: number; j: number; d: number; out: Cell }> = [];
    for (const [x, z] of cols) for (let d = 0; d < 4; d++) {
      const [a, bb] = DIRS[d];
      if (mine.has(`${x + a}.${z + bb}`)) continue;
      for (let k = w.ground(x, z); k < h; k++) if (!w.stone(k, x + a, z + bb) && w.stair(k, x + a, z + bb) < 0 && !w.earth(k, x + a, z + bb)) faces.push({ k, i: x, j: z, d, out: [k, x + a, z + bb] });
    }
    // (its top: walked if a way arrives there from beyond it)
    const tops = cols.map(([x, z]) => key(h, x, z)).filter((v) => nav.places.has(v)), topSet = new Set(tops);
    // (a stair tower's top is always come to: that's what it's for, even where it's become part of what it climbs to)
    const arrives = tops.some((v) => (nav.next.get(v) ?? []).some((u) => !topSet.has(u))) || (!!stairTower && tops.length > 0);
    // (doors where ways arrive against its walls, at height)
    const placeAt = (c: Cell) => key(...c);
    // (above its own foot: a door from a way at height, or (set into a bank) from the hill above)
    // (not out onto another building's top: that's under its roof)
    const upper = faces.filter((f) => f.k > w.ground(f.i, f.j) && standing(w, ...f.out) && !(anyH(f.out[1], f.out[2]) && height(f.out[1], f.out[2]) === f.k));
    // (a stair inside, if a way at one of those doors, or on its top, can't be reached from the slab otherwise)
    const unreached = upper.some((f) => !ground.has(placeAt(f.out))) || (arrives && tops.some((v) => !ground.has(v)));
    const foot = faces.filter((f) => f.k === w.ground(f.i, f.j) && standing(w, ...f.out) && ground.has(placeAt(f.out)));
    const court = foot.filter((f) => w.courts.has(key(0, f.out[1], f.out[2])));
    // (one style to a building; framed with colonnettes by hand, arched, so there's an arch for them to carry)
    const framed = cols.some(([x, z]) => Array.from({ length: h }, (_, k) => w.dressed(k, x, z)?.colonnettes).some(Boolean));
    const style = framed ? 'arched' : (['arched', 'square', 'slit'] as const)[hash(w.seed, id, 1) % 3];
    const doors: typeof faces = [...upper];
    // (a stair tower's door at its foot, facing the way it was come to)
    if (stairTower) {
      const d = w.rules.get(key(0, ...stairTower))! - RULE.tower, f = faces.find((q) => q.k === w.ground(q.i, q.j) && q.i === stairTower[0] && q.j === stairTower[1] && q.d === d && standing(w, ...q.out));
      if (f) doors.push(f);
    }
    // (a way laid by hand that runs up to its foot, square on to the wall: a door where it arrives, never a blank face
    // (the tower landing of static/labyrinth-connective.md))
    const landed = foot.filter((f) => w.passage(...f.out) === f.d % 2);
    for (const f of landed) if (!doors.includes(f)) doors.push(f);
    // (a house (its top not walked, so lived in under a roof) has a door at its foot too, as a rule)
    if (!stairTower && !landed.length && foot.length && (unreached || (!arrives && chance(0.85, id, 7)) || ((upper.length || court.length) && chance(0.4, id, 2)))) {
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
    // (come on to along one edge only (a way arriving on its top there): that edge a terrace, and the rest still under
    // its roof, if two cells or more are left (the roof terrace seam of static/labyrinth-connective.md: never the whole
    // roof lost to a step on to part of it))
    if (arrives && b.rect && !stairTower) {
      const come = cols.filter(([x, z]) => (nav.next.get(key(h, x, z)) ?? []).some((u) => !topSet.has(u)));
      const sides: Array<[(c: [number, number]) => boolean, { i0: number; i1: number; j0: number; j1: number }]> = [
        [([x]) => x === i0, { i0: i0 + 1, i1, j0, j1 }], [([x]) => x === i1, { i0, i1: i1 - 1, j0, j1 }],
        [([, z]) => z === j0, { i0, i1, j0: j0 + 1, j1 }], [([, z]) => z === j1, { i0, i1, j0, j1: j1 - 1 }],
      ];
      for (const [on, rest] of sides) {
        if (!come.length || !come.every(on) || (rest.i1 - rest.i0 + 1) * (rest.j1 - rest.j0 + 1) < 2) continue;
        b.roofPlan = rest; b.terrace = cols.filter(on); break;
      }
    }
    // (windows: one style to a building; alternating along a front and from level to level; climbing round a tower
    // with a stair inside, a slit a level)
    const isDoor = (f: (typeof faces)[number]) => doors.some((g) => g.k === f.k && g.i === f.i && g.j === f.j && g.d === f.d);
    for (const f of faces) {
      if (isDoor(f) || (f.k === w.ground(f.i, f.j) && arrives && !w.courts.has(key(0, f.out[1], f.out[2])))) continue;
      const along = f.d % 2 ? f.i : f.j;
      const want = b.tower && b.inside ? f.d === f.k % 4 : (along + f.k) % 2 === 0 && (f.k < h - 1 || h <= 2 || hash(w.seed, f.i, f.j, f.k, f.d) % 3 > 0);
      if (want) b.openings.push({ kind: 'window', style: b.tower && b.inside ? 'slit' : style, k: f.k, i: f.i, j: f.j, d: f.d });
    }
    // (a roof, where the top isn't walked and nothing's been put on it)
    const rule = w.rules.get(id) ?? 0;
    const dressedTop = cols.some(([x, z]) => { const d = w.dressed(h - 1, x, z); return !!(d?.prop || d?.parapet); });
    // (and never over water let into its top)
    const watered = cols.some(([x, z]) => w.basin(h, x, z));
    // (the part of its plan a roof would go over: all of it, or what's left beside a terrace)
    const R = b.roofPlan ?? { i0, i1, j0, j1 }, rcols = cols.filter(([x, z]) => x >= R.i0 && x <= R.i1 && z >= R.j0 && z <= R.j1), rmine = new Set(rcols.map(([x, z]) => `${x}.${z}`));
    if (rule === RULE.noRoof || watered || (!rule && ((b.walked && !b.roofPlan) || dressedTop || !b.rect))) b.roof = null;
    else if (rule >= RULE.hipped && rule <= RULE.dome) b.roof = (['hipped', 'gable', 'shed', 'dome'] as const)[rule - RULE.hipped];
    else {
      // (the rules' choice: leaning on taller stone, a shed roof falling away from it; square, hipped (now and then a dome
      // on a tower); long, a gable along it)
      const W = R.i1 - R.i0 + 1, D = R.j1 - R.j0 + 1;
      // (against taller stone, or set into a bank whose ground comes up to its eaves: the hill)
      const taller = [0, 1, 2, 3].filter((d) => { const [a, bb] = DIRS[d]; const out = rcols.filter(([x, z]) => !mine.has(`${x + a}.${z + bb}`)); return out.length > 0 && out.filter(([x, z]) => height(x + a, z + bb) > h || (!!w.land && w.ground(x + a, z + bb) >= h - 1)).length * 2 >= out.length; });
      // (leaning on more than one side, it falls away from the highest)
      const rise = (d: number) => { const [a, bb] = DIRS[d], o = rcols.filter(([x, z]) => !rmine.has(`${x + a}.${z + bb}`)); return o.reduce((t, [x, z]) => t + Math.max(height(x + a, z + bb), w.ground(x + a, z + bb)), 0) / Math.max(1, o.length); };
      const lean = taller.sort((p, q) => rise(q) - rise(p) || p - q)[0];
      b.roof = taller.length ? 'shed' : W === D ? (tower && chance(0.35, id, 4) ? 'dome' : 'hipped') : chance(0.25, id, 5) ? 'hipped' : 'gable';
      if (taller.length) b.fall = (lean + 2) % 4;
    }
    if (b.roof === 'shed' && b.fall < 0) b.fall = (hash(w.seed, id, 6) % 4);
    if (b.roof && b.roof !== 'shed') b.fall = -1;
    for (const o of b.openings) at.set(`${o.k}.${o.i}.${o.j}.${o.d}`, o);
    for (const [x, z] of cols) for (let k = w.ground(x, z); k < h; k++) of.set(key(k, x, z), b);
    list.push(b);
  }
  return { list, at, inside, of };
}
