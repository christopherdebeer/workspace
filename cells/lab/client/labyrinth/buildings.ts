/**
 * Buildings: the solid masses of the labyrinth read as places that are lived in, with doors, windows, a stair inside
 * where one is needed, and a roof where one belongs. Worked out from the resolved world (model.ts) and where a figure
 * could walk (nav.ts), never kept: they follow whatever's built, seeded so the same build always comes out the same.
 *
 * - **A building** is a mass of solid columns all the same height, two or more high: two cells by two somewhere in it,
 *   or a tower of one or two cells three or more high. A wall a cell thick isn't one, however it runs (round a court,
 *   on the diagonal). A stair tower (the rules' answer to a climb too steep for a flight, `RULE.tower`) is one however
 *   slim: its door at its foot facing the way it was come to, a level higher than the top it serves, entered from that
 *   top by a door in its face there, roofed over (a turret, not a stub of terrace).
 * - **A solid column** is plain stone, and stone with a passage through it (an archway: the reserved void of
 *   static/labyrinth-connective.md), standing on the ground, or on a deck (a bridge, an arcade): there it starts at the
 *   passage the deck carries, the stone under it the bridge's, not the building's. So the void a way keeps open through
 *   what's built over it makes the building, with no rule of its own: a tower over a way is a **gatehouse** (the way
 *   through its foot, its roof whole over it); rooms over a bridge are an **inhabited bridge** (a run of them a cell
 *   wide is a building as a wall isn't: it's covered, the passage along under it).
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
 *   tower. Only on a plan that's a plain rectangle, for now. The hand can switch it (select), kept as a rule. On the
 *   plateau (regions.ts) a top is left flat, and a tower now and then domed; its windows tall, arched or square.
 */
import { hash } from '../kit/rng';
import { DIRS, RULE, isTower, isWithin, key, unkey, type Cell, type World } from './model';
import { navigate, standing, type Nav } from './nav';
import { grammarAt, grammarOfId, type Grammar } from './regions';

export type Roof = 'hipped' | 'gable' | 'shed' | 'dome';
export interface Opening { kind: 'door' | 'window'; style: 'arched' | 'square' | 'slit'; k: number; i: number; j: number; d: number }
export interface Building {
  /** its columns, how high they go (the level over the highest), its plan's bounds, and whether that's a plain rectangle */
  cols: Array<[number, number]>; h: number;
  /** where each column of it starts (by `cols`): its ground, or the passage over a deck it stands on */
  base: number[];
  /** the passage through its foot, if one goes through it: those columns, and which way it runs (0 along i, 1 along j) */
  through: Array<[number, number, number]>; i0: number; i1: number; j0: number; j1: number; rect: boolean;
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
  /** a plan that isn't a rectangle (an L, a T, a U), roofed in wings: rectangles covering it, each with its own roof,
   * meeting the others' in valleys */
  wings?: Array<{ i0: number; i1: number; j0: number; j1: number }>;
  /** its faces that look out: each column's sides at each level, what's outside them, and whether it's plain stone
   * (facades.ts reads them as runs of bays) */
  faces: Array<{ k: number; i: number; j: number; d: number; out: Cell; plain: boolean }>;
}

/** a plan's wings: the fewest largest rectangles that cover it (overlapping where they meet), two cells wide or more;
 * what's too thin to roof left flat beside them, a terrace (`flat`). Null if it takes more than four, or more of it's
 * flat than roofed (a plan that ragged is left a terrace) */
function wingsOf(cols: Array<[number, number]>, bay = 1): { wings: Array<{ i0: number; i1: number; j0: number; j1: number }>; flat: Array<[number, number]> } | null {
  const has = new Set(cols.map(([x, z]) => `${x}.${z}`)), left = new Set(has), out: Array<{ i0: number; i1: number; j0: number; j1: number }> = [], flat: Array<[number, number]> = [];
  const full = (i0: number, i1: number, j0: number, j1: number) => { for (let x = i0; x <= i1; x++) for (let z = j0; z <= j1; z++) if (!has.has(`${x}.${z}`)) return false; return true; };
  while (left.size) {
    // (the largest rectangle in the plan over the first cell not yet roofed)
    const [x0, z0] = [...left][0].split('.').map(Number);
    let best: { i0: number; i1: number; j0: number; j1: number } | null = null, area = 0, gain = 0;
    for (const [x, z] of cols) for (const [u, v] of cols) {
      const i0 = Math.min(x, u), i1 = Math.max(x, u), j0 = Math.min(z, v), j1 = Math.max(z, v);
      if (x0 < i0 || x0 > i1 || z0 < j0 || z0 > j1 || !full(i0, i1, j0, j1)) continue;
      let g = 0; for (let p = i0; p <= i1; p++) for (let q = j0; q <= j1; q++) if (left.has(`${p}.${q}`)) g++;
      const a = (i1 - i0 + 1) * (j1 - j0 + 1);
      if (g > gain || (g === gain && a > area)) { best = { i0, i1, j0, j1 }; area = a; gain = g; }
    }
    if (!best || Math.min(best.i1 - best.i0, best.j1 - best.j0) < bay) { left.delete(`${x0}.${z0}`); flat.push([x0, z0]); continue; }
    if (out.length >= 4 * bay) return null;
    out.push(best);
    for (let p = best.i0; p <= best.i1; p++) for (let q = best.j0; q <= best.j1; q++) left.delete(`${p}.${q}`);
  }
  // (a thin piece flat only where a wing's beside it: never a strip of terrace on its own out of a roofed plan)
  const under = (x: number, z: number) => out.some((g) => x >= g.i0 && x <= g.i1 && z >= g.j0 && z <= g.j1);
  if (!out.length || flat.length * 2 > cols.length) return null;
  const near = new Set<string>(), todo = flat.filter(([x, z]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => under(x + a, z + b)));
  for (const [x, z] of todo) near.add(`${x}.${z}`);
  while (todo.length) { const [x, z] = todo.pop()!; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const c = flat.find(([p, q]) => p === x + a && q === z + b); if (c && !near.has(`${c[0]}.${c[1]}`)) { near.add(`${c[0]}.${c[1]}`); todo.push(c); } } }
  if (near.size < flat.length) return null;
  return { wings: out, flat };
}
export interface Buildings { list: Building[]; at: Map<string, Opening>; inside: Array<[Cell, Cell]>; of: Map<number, Building>;
  /** on the half grid: each face that leads a bay of two (both its building's, plain), by its key (k.i.j.d), to its
   * partner's key; and back */
  pairs: Map<string, string>; partners: Map<string, string>;
  /** the raised tops a way the hand made arrives on, and what's walked on from there at its height (a wall's top become a
   * promenade): places, by key */
  promenade: Set<number> }

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
/** every cell of a building, from each column's base up */
export const cellsOf = (b: Building): Cell[] => b.cols.flatMap(([x, z], n) => Array.from({ length: b.h - b.base[n] }, (_, q) => [b.base[n] + q, x, z] as Cell));

/** whether a plan has a square n by n at (x, z) */
const square = (has: Set<string>, x: number, z: number, n: number) => { for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) if (!has.has(`${x + a}.${z + c}`)) return false; return true; };
/** on the half grid (`w.bay` 2), a face's partner in its bay: the faces two to a bay along a front, the one at the even
 * square leading (an opening, a front's bay, drawn across both from it); the other, and which way along it lies */
export function pairOf(i: number, j: number, d: number): { lead: boolean; i: number; j: number; s: number } {
  const [ta, tb] = DIRS[(d + 1) % 4], c = ta !== 0 ? i : j, lead = ((c % 2) + 2) % 2 === 0, o = lead ? 1 : -1;
  return { lead, i: i + Math.abs(ta) * o, j: j + Math.abs(tb) * o, s: (ta + tb) * o };
}

function find(w: World): Buildings {
  const list: Building[] = [], at = new Map<string, Opening>(), inside: Array<[Cell, Cell]> = [], of = new Map<number, Building>(), pairs = new Map<string, string>(), partners = new Map<string, string>();
  const e = w.extent();
  /**
   * A column's stack: its highest run of plain stone or archways (a passage through), and where it starts: the ground,
   * if it goes down to it; else (standing on a deck: a bridge, an arcade's run) the lowest passage in it, the stone
   * under that the deck's. Nothing over its top but air.
   */
  const part = (k: number, i: number, j: number) => w.block(k, i, j) || (w.archway(k, i, j) >= 0 && !w.span(k, i, j));
  const stacks = new Map<string, { base: number; h: number } | null>();
  const stack = (i: number, j: number) => {
    const id = `${i}.${j}`;
    if (stacks.has(id)) return stacks.get(id)!;
    // (the lowest that's two high or more with air over it, if there are several (a house under a way carried over it))
    const g = w.ground(i, j);
    let s: { base: number; h: number } | null = null;
    for (let k = g; k <= w.levels; k++) {
      if (!part(k, i, j)) continue;
      let t = k;
      while (part(t + 1, i, j)) t++;
      if (!w.stone(t + 1, i, j) && w.stair(t + 1, i, j) < 0) {
        let b = k;
        if (b > g) for (let q = k; q <= t; q++) if (w.archway(q, i, j) >= 0) { b = q; break; }
        s = { base: b, h: t + 1 };
        if (t + 1 - b >= 2) break;
      }
      k = t;
    }
    stacks.set(id, s);
    return s;
  };
  /** how high a column goes, as a building's would (its ground, if it has none) */
  const height = (i: number, j: number) => stack(i, j)?.h ?? w.ground(i, j);
  const baseOf = (i: number, j: number) => stack(i, j)?.base ?? w.ground(i, j);
  const solid = (i: number, j: number, h: number) => { const s = stack(i, j); return !!s && s.h === h && h - s.base >= 2; };
  const seen = new Set<number>();
  // (the walk as the stone shows it, and what of it can be reached from the slab)
  const nav = navigate(w), ground = new Set<number>(), st: number[] = [];
  // (on the land, its ground at each column's own level)
  for (const v of nav.places) { const [k, i, j] = unkey(v); if (k === w.ground(i, j)) { ground.add(v); st.push(v); } }
  while (st.length) { const v = st.pop()!; for (const u of nav.next.get(v) ?? []) if (!ground.has(u)) { ground.add(u); st.push(u); } }
  // (promenades: from where the hand's ways walk, up off the ground, on along the tops at that height (never down a
  // stair or up one: a promenade is a level walk))
  const promenade = new Set<number>(), pst: number[] = [];
  for (const op of w.ops) if (!op.derived) for (const c of w.walks.get(op) ?? []) { const v = key(...c); if (c[0] > w.ground(c[1], c[2]) && nav.places.has(v) && !promenade.has(v)) { promenade.add(v); pst.push(v); } }
  while (pst.length) { const v = pst.pop()!, [k] = unkey(v); for (const u of nav.next.get(v) ?? []) { const [ku, iu, ju] = unkey(u); if (ku === k && !promenade.has(u) && ku > w.ground(iu, ju) && w.stair(ku, iu, ju) < 0) { promenade.add(u); pst.push(u); } } }
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
    m.deep = cs.some(([x, z]) => square(has, x, z, 2 * w.bay));
  }

  // (the tops a stair tower serves: beside its top level, a place on stone, come into from it by a door; walked, so the
  // building it's on isn't roofed over it, and a door onto it is the tower's own)
  const served = new Set<number>();
  for (const [v, r] of w.rules) {
    if (!isTower(r)) continue;
    const [, x, z] = unkey(v), t = height(x, z);
    for (const [a, b] of DIRS) if (standing(w, t - 1, x + a, z + b) && w.stone(t - 2, x + a, z + b)) served.add(key(t - 1, x + a, z + b));
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
    const deep = cols.some(([x, z]) => square(has, x, z, 2 * w.bay)), tower = (cols.length <= 2 * w.bay * w.bay && h - baseOf(i, j) >= 3) || !!stairTower;
    // (a passage through its foot: covered, if it runs under two cells of it or more (a gate in a wall is one))
    const through = cols.filter(([x, z]) => w.archway(baseOf(x, z), x, z) >= 0).map(([x, z]) => [x, z, w.archway(baseOf(x, z), x, z)] as [number, number, number]);
    const whole = massOf.get(`${i}.${j}`);
    if (!deep && !tower && through.length < 2 && !(whole?.deep && whole.heights.size > 1)) continue;
    // (its identity: the column first laid by the hand, the lowest of those if several (not the lowest of all its cells:
    // a neighbour added later never re-rolls its windows, door or roof))
    const first = Math.min(...cols.map(([x, z]) => w.firstOp.get(key(0, x, z)) ?? 1e9));
    const mine = new Set(cols.map(([x, z]) => `${x}.${z}`)), id = Math.min(...cols.filter(([x, z]) => (w.firstOp.get(key(0, x, z)) ?? 1e9) === first).map(([x, z]) => key(h - 1, x, z)));
    const b: Building = { cols, h, base: cols.map(([x, z]) => baseOf(x, z)), through, i0, i1, j0, j1, rect: cols.length === (i1 - i0 + 1) * (j1 - j0 + 1), tower, openings: [], inside: false, walked: false, roof: null, id, fall: -1, faces: [] };
    // (its faces: each column's sides that look out, at each level, and what's outside them; not where a passage
    // through it comes out (that's open), and an opening only in plain stone)
    const faces: Array<{ k: number; i: number; j: number; d: number; out: Cell; plain: boolean }> = [];
    for (const [x, z] of cols) for (let d = 0; d < 4; d++) {
      const [a, bb] = DIRS[d];
      if (mine.has(`${x + a}.${z + bb}`)) continue;
      for (let k = baseOf(x, z); k < h; k++) {
        if (w.archway(k, x, z) === d % 2) continue;
        if (!w.stone(k, x + a, z + bb) && w.stair(k, x + a, z + bb) < 0 && !w.earth(k, x + a, z + bb)) faces.push({ k, i: x, j: z, d, out: [k, x + a, z + bb], plain: w.block(k, x, z) });
      }
    }
    b.faces = faces;
    // (on the half grid, its bays of two: a plain face at an even square and the plain one beside it along the front)
    const fkey = (f: { k: number; i: number; j: number; d: number }) => `${f.k}.${f.i}.${f.j}.${f.d}`, faceAt = new Map(faces.map((f) => [fkey(f), f]));
    if (w.bay === 2) for (const f of faces) {
      const p = pairOf(f.i, f.j, f.d);
      if (!p.lead || !f.plain) continue;
      const q = faceAt.get(`${f.k}.${p.i}.${p.j}.${f.d}`);
      if (q?.plain) { pairs.set(fkey(f), fkey(q)); partners.set(fkey(q), fkey(f)); }
    }
    const foot = (f: (typeof faces)[number]) => f.k === baseOf(f.i, f.j);
    // (its top: walked if a way arrives there from beyond it)
    const tops = cols.map(([x, z]) => key(h, x, z)).filter((v) => nav.places.has(v)), topSet = new Set(tops);
    // (a stair tower's top is always come to: that's what it's for, even where it's become part of what it climbs to)
    // (and one the hand climbs inside (`RULE.within`): its top walked, come to by its stair, its door where it was asked)
    const within = cols.flatMap(([x, z]) => { const r = w.rules.get(key(baseOf(x, z), x, z)); return isWithin(r) ? [{ x, z, d: r! - RULE.within }] : []; });
    // (on the half grid, the top of a gallery carried along its own front (a span against it, level with its top) is its
    // own: a way there doesn't make it walked)
    const gallery = (u: number) => { const [ku, x, z] = unkey(u); return w.bay === 2 && ku === h && w.span(h - 1, x, z) && DIRS.some(([a, c]) => mine.has(`${x + a}.${z + c}`)); };
    const arrives = tops.some((v) => (nav.next.get(v) ?? []).some((u) => !topSet.has(u) && !gallery(u)) || served.has(v)) || within.length > 0;
    // (doors where ways arrive against its walls, at height)
    const placeAt = (c: Cell) => key(...c);
    // (above its own foot: a door from a way at height, or (set into a bank) from the hill above)
    // (not out onto another building's top: that's under its roof)
    // (and onto a wall's top level with it only where that's walked, a promenade: never a door on to a wall that isn't)
    const twoDeep = (x: number, z: number) => { const h = height(x, z); return [[1, 1], [1, -1], [-1, 1], [-1, -1]].some(([a, c]) => [[x + a, z], [x, z + c], [x + a, z + c]].every(([p, q]) => anyH(p, q) && height(p, q) === h)); };
    const wallTop = (f: (typeof faces)[number]) => anyH(f.out[1], f.out[2]) && height(f.out[1], f.out[2]) === f.k && !twoDeep(f.out[1], f.out[2]);
    const upper = faces.filter((f) => f.plain && f.k > baseOf(f.i, f.j) && standing(w, ...f.out) && (!(anyH(f.out[1], f.out[2]) && height(f.out[1], f.out[2]) === f.k) || (wallTop(f) && promenade.has(placeAt(f.out))) || (!!stairTower && served.has(placeAt(f.out)))));
    // (a stair inside, if a way at one of those doors, or on its top, can't be reached from the slab otherwise)
    const unreached = upper.some((f) => !ground.has(placeAt(f.out))) || (arrives && tops.some((v) => !ground.has(v)));
    const atFoot = faces.filter((f) => f.plain && foot(f) && standing(w, ...f.out) && ground.has(placeAt(f.out)));
    const court = atFoot.filter((f) => w.courts.has(key(0, f.out[1], f.out[2])));
    // (one style to a building; framed with colonnettes by hand, arched, so there's an arch for them to carry)
    const framed = cols.some(([x, z]) => Array.from({ length: h }, (_, k) => w.dressed(k, x, z)?.colonnettes).some(Boolean));
    // (its tradition's windows (regions.ts): the plateau's tall, mostly arched; the north's and the east's square)
    const g = grammarOfId(w, id);
    const style = framed ? 'arched' : g.windows[hash(w.seed, id, 1) % g.windows.length];
    const doors: typeof faces = [...upper];
    // (a porch: a passage in at its foot that stops at its stone, the door at its back)
    const porch = through.flatMap(([x, z, a]) => [0, 1, 2, 3].filter((d) => d % 2 === a).map((d) => ({ x, z, d })))
      .filter(({ x, z, d }) => { const [p, q] = DIRS[d]; return !mine.has(`${x + p}.${z + q}`) && mine.has(`${x - p}.${z - q}`) && w.block(baseOf(x, z), x - p, z - q); });
    for (const { x, z, d } of porch) { const [p, q] = DIRS[d]; doors.push({ k: baseOf(x, z), i: x - p, j: z - q, d, out: [baseOf(x, z), x, z], plain: true }); }
    // (a stair tower's door at its foot, facing the way it was come to)
    if (stairTower) {
      const d = w.rules.get(key(0, ...stairTower))! - RULE.tower, f = faces.find((q) => foot(q) && q.i === stairTower[0] && q.j === stairTower[1] && q.d === d && standing(w, ...q.out));
      if (f) doors.push(f);
    }
    // (a way laid by hand that runs up to its foot, square on to the wall: a door where it arrives, never a blank face
    // (the tower landing of static/labyrinth-connective.md))
    const landed = atFoot.filter((f) => w.passage(...f.out) === f.d % 2 || within.some((q) => q.x === f.i && q.z === f.j && q.d === f.d));
    for (const f of landed) if (!doors.includes(f)) doors.push(f);
    // (a house (its top not walked, so lived in under a roof) has a door at its foot too, as a rule; not one with a
    // passage through it: that's its way in)
    if (!stairTower && !landed.length && !through.length && atFoot.length && (unreached || (!arrives && chance(0.85, id, 7)) || ((upper.length || court.length) && chance(0.4, id, 2)))) {
      const pickFrom = court.length ? court : atFoot;
      doors.push(pickFrom[hash(w.seed, id, 3) % pickFrom.length]);
    }
    // (on the half grid, a door in its bay's leading face, so it's drawn across the bay)
    if (w.bay === 2) doors.forEach((f, n) => { const lead = partners.get(fkey(f)); if (lead && !doors.some((g) => fkey(g) === lead)) doors[n] = faceAt.get(lead)!; });
    for (const f of doors) b.openings.push({ kind: 'door', style: 'arched', k: f.k, i: f.i, j: f.j, d: f.d });
    // (a passage through its foot: its rooms' door is in the passage's side, under the vault, where it's come in from)
    if (through.length > porch.length) {
      const side = through.filter(([x, z]) => !porch.some((q) => q.x === x && q.z === z)).flatMap(([x, z, a]) => [0, 1, 2, 3].filter((d) => d % 2 !== a && !w.cross(baseOf(x, z), x, z)).map((d) => ({ x, z, d }))).filter(({ x, z, d }) => mine.has(`${x + DIRS[d][0]}.${z + DIRS[d][1]}`) && w.block(baseOf(x, z), x + DIRS[d][0], z + DIRS[d][1]));
      if (side.length) { const s = side[hash(w.seed, id, 9) % side.length]; b.openings.push({ kind: 'door', style: 'arched', k: baseOf(s.x, s.z), i: s.x, j: s.z, d: s.d }); }
    }
    // (the stair inside: every door to the next, and to the passage through it (the way in from under it), and up to
    // the top if the top's walked)
    const ends: Cell[] = doors.map((f) => f.out);
    if (through.length) ends.push([baseOf(through[0][0], through[0][1]), through[0][0], through[0][1]]);
    if (arrives && tops.length) ends.push([h, cols[0][0], cols[0][1]]);
    if (ends.length >= 2 && (doors.length || arrives)) {
      for (let n = 1; n < ends.length; n++) inside.push([ends[0], ends[n]]);
      b.inside = true;
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
      if (!f.plain || isDoor(f) || (foot(f) && arrives && !w.courts.has(key(0, f.out[1], f.out[2])))) continue;
      // (on the half grid, a window to a bay of two, in its leading face (its partner no door), counted by bays along)
      if (w.bay === 2) { const p = pairs.get(fkey(f)); if (!p || doors.some((g) => fkey(g) === p)) continue; }
      const along = Math.floor((f.d % 2 ? f.i : f.j) / w.bay);
      const want = b.tower && b.inside ? f.d === f.k % 4 : (along + f.k) % 2 === 0 && (f.k < h - 1 || h <= 2 || hash(w.seed, f.i, f.j, f.k, f.d) % 3 > 0);
      if (want) b.openings.push({ kind: 'window', style: b.tower && b.inside ? 'slit' : style, k: f.k, i: f.i, j: f.j, d: f.d });
    }
    // (a roof, where the top isn't walked and nothing's been put on it)
    const rule = w.rules.get(id) ?? 0;
    // (or something's growing up there: a roof garden, never a roof over a tree)
    const dressedTop = cols.some(([x, z]) => { const d = w.dressed(h - 1, x, z); return !!(d?.prop || d?.parapet) || w.tree(h, x, z); });
    // (and never over water let into its top)
    const watered = cols.some(([x, z]) => w.basin(h, x, z));
    // (the part of its plan a roof would go over: all of it, or what's left beside a terrace)
    const R = b.roofPlan ?? { i0, i1, j0, j1 }, rcols = cols.filter(([x, z]) => x >= R.i0 && x <= R.i1 && z >= R.j0 && z <= R.j1), rmine = new Set(rcols.map(([x, z]) => `${x}.${z}`));
    // (a plan that isn't a rectangle: roofed in wings, if it's no more than four of them two cells wide or more)
    const wings = !b.rect && !b.roofPlan ? wingsOf(cols, w.bay) : null;
    if (rule === RULE.noRoof || watered || (!rule && ((b.walked && !b.roofPlan) || dressedTop || (!b.rect && !wings)))) b.roof = null;
    // (each wing hipped, so where one runs into another its end slopes down under the other's roof)
    // (where a tradition's tops are flat, a plan in wings is too)
    else if (!rule && g.roof === 'flat' && wings) b.roof = null;
    else if (wings) { b.wings = wings.wings; b.roof = 'hipped'; if (wings.flat.length) b.terrace = wings.flat; }
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
      // (by its tradition: on the plateau flat tops, now and then a dome on a tower; in the north a steep gable (a spire
      // on a tower); in the east hipped, under deep eaves)
      // (and where a tradition's roofs stand clear of the slope (the north's, the east's), a lean-to only against taller
      // stone, never against the hill: set into a bank, its roof its own, gabled or hipped)
      const byStone = [0, 1, 2, 3].some((d) => { const [a, bb] = DIRS[d]; const out = rcols.filter(([x, z]) => !mine.has(`${x + a}.${z + bb}`)); return out.length > 0 && out.filter(([x, z]) => height(x + a, z + bb) > h).length * 2 >= out.length; });
      if (g.roof === 'flat') b.roof = tower && chance(0.5, id, 4) ? 'dome' : null;
      else if (g.roof === 'steep') b.roof = taller.length && byStone ? 'shed' : tower ? 'hipped' : 'gable';
      else if (g.roof === 'eave') b.roof = taller.length && byStone ? 'shed' : 'hipped';
      else b.roof = taller.length ? 'shed' : W === D ? (tower && chance(0.35, id, 4) ? 'dome' : 'hipped') : chance(0.25, id, 5) ? 'hipped' : 'gable';
      if (taller.length && b.roof === 'shed') b.fall = (lean + 2) % 4;
    }
    if (b.roof === 'shed' && b.fall < 0) b.fall = (hash(w.seed, id, 6) % 4);
    if (b.roof && b.roof !== 'shed') b.fall = -1;
    for (const o of b.openings) at.set(`${o.k}.${o.i}.${o.j}.${o.d}`, o);
    for (const [x, z] of cols) for (let k = baseOf(x, z); k < h; k++) of.set(key(k, x, z), b);
    list.push(b);
  }
  // (a flight aimed at a wall that's no building's, and no arch through it (encounters.ts opens one where there's
  // somewhere to go beyond): a blind door in its face where the stair arrives, so a stair never just runs at a blank wall)
  for (const f of w.flights) {
    const [a, b2] = DIRS[f.d], [kt, it, jt] = f.cells[f.cells.length - 1], H: Cell = [kt + 1, it + a, jt + b2], B: Cell = [kt + 1, H[1] + a, H[2] + b2];
    if (!standing(w, ...H) || !w.block(...B) || of.has(key(...B))) continue;
    const d = (f.d + 2) % 4, id = `${B[0]}.${B[1]}.${B[2]}.${d}`;
    if (!at.has(id)) at.set(id, { kind: 'door', style: 'arched', k: B[0], i: B[1], j: B[2], d });
  }
  return { list, at, inside, of, promenade, pairs, partners };
}
/** the manner a cell's built in: its building's (the cell's, or the one over it: an arch carrying it), else its district's
 * (regions.ts) */
export function grammarHere(w: World, k: number, i: number, j: number): Grammar {
  const of = buildings(w).of, b = of.get(key(k, i, j)) ?? of.get(key(k + 1, i, j));
  return b ? grammarOfId(w, b.id) : grammarAt(w, i, j);
}
