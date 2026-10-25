/**
 * The labyrinth: what the hand did, what it meant, and what the stone must be for that to stand.
 *
 * Three layers, in order of authority:
 *
 * 1. **Operations**: each gesture, recorded as what it changes in the intended solid: stone added (a cell at a level),
 *    stairs added (a cell, the way it climbs), stone cut away. Kept in order; undo takes the last back; the world is
 *    always these replayed, so an edit never redesigns what came before it except through the rules below.
 * 2. **The intended solid**: the stone and stairs the operations add up to. The hand decides this, and nothing below
 *    changes it.
 * 3. **The resolution** (`resolve`): what the stone has to do so the intended solid stands, decided afresh each time,
 *    the same every time:
 *    - stone with nothing under it, between stone either side (along x or z, three cells at most), is carried on an
 *      **arch**, springing as low as both sides go, down to where a round arch fits;
 *    - a longer run is an **arcade**: a **pier** every few cells, arches between;
 *    - a free end stands on a pier;
 *    - a **flight** (a run of stairs, each a level up from the last) is carried as a whole, as its setting has it
 *      (`Flight`): hung from a wall beside it, its steps cantilevered out of it; on a rampant arch between its foot and
 *      what it climbs to, the space under it left open (a lane goes on under it); solid, a short stoop on the ground;
 *      or, with nothing to spring from or lean on, on piers;
 *    - so cutting under stone opens an arched way through it, and a walkway drawn out over the court comes with its
 *      arcade beneath it;
 *    - ground walled in all round (a gate under an arch still counts as a wall) is a **courtyard**: paved, with water
 *      in it if it's big enough, and a cypress in a corner.
 *
 * Operations come from the hand two ways (main.ts): **auto**, the gestures read (gesture.ts); or a piece from the
 * palette, put where it's touched (palette.ts): a block, an arch (stone with a way through it along an axis; on an arch
 * the same way, one tall arch), a stair, a bridge (stone laid across a gap and marked so: carried on one arch, up to
 * seven cells), a cypress, a pool. Both are operations on the same solid, resolved by the same rules.
 *
 * The grid is N × N cells (LO to HI each way, the first stone's square round 0 to 11), each 1 across and 1 high, and as
 * high as it's built: there's no cap (CEIL is only a guard against the absurd), and everything that goes up through the
 * levels goes only as far as `levels`, what's built and the air over it. The slab under it is only as big as it needs to be: what's built, and MARGIN cells more all round, never less
 * than the square it starts as (`extent`). Build at its edge and it grows.
 */
import { perf } from './perf';
import { hash } from '../kit/rng';
import { DOMAIN, groundOf, makeLand, type Land } from './land';
import { meet, type Meeting, type Round } from './encounters';

export const N = 48, LO = -18, HI = LO + N - 1;
/** far over anything a hand would build: only a guard */
export const CEIL = 512;
/** the cell the slab's centred on to start with (x = i − CENTER), the square it starts as, and how far it reaches past
 * what's built */
export const CENTER = 6, START: [number, number] = [2, 9], MARGIN_CELLS = 2;
/** a span's deck: how thick the stone is over its arch's crown */
export const DECK = 0.24;
export const DIRS: ReadonlyArray<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** a cell: its level, then i (x) and j (z) */
export type Cell = [number, number, number];
/** an operation: stone added (and when each was laid), stairs added (which way each climbs, a DIRS index), stone cut */
export interface Op {
  add?: Array<[number, number, number, number]>; stairs?: Array<[number, number, number, number, number]>; cut?: Cell[]; why?: string;
  /** stone with a way through it: its cell, axis (0 x, 1 z), when */
  arches?: Array<[number, number, number, number, number]>;
  /** ladders: the cell at a ladder's foot (where it stands), the way it leans (a DIRS index, toward the stone it's
   * against), how many levels it climbs (to the top of that stone), when */
  ladders?: Array<[number, number, number, number, number, number]>;
  /** plants of a kind (`PLANT`): the cell it stands in (the level it grows from), its kind, when */
  plants?: Array<[number, number, number, number, number]>;
  /** cypresses (on a floor) and pools (let into the stone): cell, when */
  trees?: Array<[number, number, number, number]>; pools?: Array<[number, number, number]>;
  /** water let into a top, up off the ground: a basin; its cell (the level of the water, over the stone it's let into),
   * when */
  basins?: Array<[number, number, number, number]>;
  /** ground paved, where it can be stood on: a place to stand made by a touch (a way's own paving is worked out from
   * its connection); cells */
  pave?: Array<[number, number]>;
  /** the stone it adds is a bridge's: carried on one arch, however long the gap (to seven cells) */
  bridge?: boolean;
  /** a connection asked for: the intent, kept as the hand gave it; its stone is worked out on replay (`realise`) */
  connect?: Connect;
  /** when it was made (a connection's stone is laid behind the finger from then) */
  born?: number;
  /** what it is, said plainly, while it's under the finger (not kept) */
  note?: string;
  /** what the rules made, read another way by hand (`RULE`), at a cell: a flat lintel for an arch, a pier forced under
   * a run (splitting its arch into bays); none puts it back to the rules' own */
  rule?: Array<[number, number, number, number]>;
  /** thin walls: stone a wall's thickness, not a cell's, full height, along an axis (0 x, 1 z) where nothing beside it
   * says which way it runs; cell, axis, when */
  walls?: Array<[number, number, number, number, number]>;
  /** dressing (`DRESS`) at a cell of stone: what it's made of, moss, ivy, a parapet round its top, a lantern or a pot on
   * it; on (1) or off (0). It never changes what stands */
  dress?: Array<[number, number, number, number, number]>;
  /** what it is as a reading of the gesture that made it, and the other ways that gesture could have been read (a
   * touch after it reads it so instead); neither kept */
  reading?: string; alts?: Alt[];
  /** the hand's choice of how a meeting is resolved (`encounters.ts`): the meeting's anchor cell and the level chosen
   * (0 the smallest sufficient, 1 the obvious, 2 the surprising), kept */
  choose?: Array<[number, number, number, number]>;
  /** laid by an encounter's resolution, not the hand (worked out on every rebuild, never kept) */
  derived?: boolean;
  /** the liberties the reading took with the gesture as it was made (re-routed, begun elsewhere, another kind of thing
   * than drawn: `gesture.ts` names them), so how often a hand gets other than it drew can be counted; not kept */
  took?: string[];
}
/** readings of the rules' work a hand can switch to: an arch read as a lintel, a pier asked for; a building's roof (none, or
 * which kind), kept at the lowest cell of its top */
export const RULE = { none: 0, lintel: 1, pier: 2, colonnade: 3, arch: 4, noPier: 5, noRoof: 10, hipped: 11, gable: 12, shed: 13, dome: 14, tower: 20, solid: 30, rampant: 31, hung: 32, within: 40 } as const;

/**
 * How a flight is carried. Worked out from its setting (the hand can choose another, kept at its foot: `RULE.solid`,
 * `rampant`, `hung`):
 * - **ground**: every step stands on something already (the ground, stone, the land);
 * - **hung**: a wall beside every step that's over nothing: the steps cantilevered out of it, the space under them
 *   open (beside the land's bank instead, it's built up solid against it, unless that can't be);
 * - **rampant**: on an arch rising with it, springing from its foot and leaning on what it climbs to, the space under
 *   it open where it's high enough to walk;
 * - **solid**: a short flight on the ground, filled down to the ground under it (never over a passage the hand made);
 * - **pier**: nothing to spring from or lean on: each step over nothing on a pier, as stone is.
 */
export type Carriage = 'ground' | 'hung' | 'rampant' | 'solid' | 'pier';
export interface Flight {
  /** its stairs, foot to head (each a level up from the last, the next cell on; on the half grid, each square half a
   * level: two to a level), which way they climb, the foot's level, and how many levels each square climbs */
  cells: Cell[]; d: number; k0: number; rise: number;
  carriage: Carriage;
  /** its foot on the ground or on what's there (not on a landing in the air); and, hung, the side it's hung from (a DIRS
   * index, -1 if each step its own) */
  founded: boolean; wall: number;
  /** the carriages its setting allows (the hand can choose among them) */
  options: Carriage[];
}
/** the thickness of a flight over its soffit */
const FLIGHT_T = 0.34;
/**
 * The underside of a flight `u` cells along it (from the back of its foot stair): what's under that is open. Rampant,
 * a quarter-ellipse springing at the foot (from the ground behind its first step, or from under the landing it sets
 * out from), rising to meet what it climbs to just under its head; hung, a little under each step; solid or on the
 * ground, all the way down.
 */
export function soffit(f: Flight, u: number): number {
  const n = f.cells.length;
  if (f.carriage === 'hung') return f.k0 + Math.min(n, Math.max(0, u)) * f.rise - FLIGHT_T - 0.08;
  if (f.carriage !== 'rampant') return -1e3;
  const us = f.founded ? 1 / f.rise : 0, yb = f.founded ? f.k0 : f.k0 - 0.6, ye = f.k0 + n * f.rise - FLIGHT_T;
  if (u <= us) return yb;
  const t = Math.min(1, (u - us) / Math.max(1e-6, n - us));
  return yb + (ye - yb) * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
}
/** a stair tower (kept at its foot): a building however slim, its door at its foot facing the way `tower + d` says */
/**
 * What grows, by size: a **shrub** (waist high, a cell), a **hedge** (clipped, a cell of a row that joins its
 * neighbours), a **cypress** (slender, two levels), an **olive** (a gnarled trunk and a round crown a cell out each way,
 * over head height), a **stone pine** (a tall leaning trunk, an umbrella crown two cells out each way, high over walls).
 * Each stands in its cell (nothing's built or walked there, as a cypress's), and each a size up from the one before it,
 * so a plant made again grows (`gesture.ts`).
 */
export const PLANT = { cypress: 0, shrub: 1, hedge: 2, olive: 3, pine: 4, vine: 5 } as const;
/** how many levels of a plant's cell (and over it) its trunk or body takes, and how high it reaches */
export const PLANT_TALL = [2, 1, 1, 2, 4, 1];
export const isTower = (r: number | undefined) => r !== undefined && r >= RULE.tower && r < RULE.tower + 4;
/** a house climbed inside (the rule kept at a cell of its foot, `RULE.within` + the way its door faces): a door there,
 * its stair inside, out on its top */
export const isWithin = (r: number | undefined) => r !== undefined && r >= RULE.within && r < RULE.within + 4;
/** dressing: three stones (travertine is the stone's own), then what's on it */
export const DRESS = { travertine: 0, brick: 1, marble: 2, moss: 3, ivy: 4, parapet: 5, lantern: 6, pot: 7, balustrade: 8, jali: 9, pergola: 10, mashrabiya: 11, colonnettes: 12, seat: 13, gap: 14 } as const;
/** a cell's dressing: each part set (by the hand, or by the rules' own dressing, character.ts) or not; a part set off
 * by hand stays off whatever the rules would put */
export interface Dress {
  mat?: number; moss?: boolean; ivy?: boolean; parapet?: boolean; prop?: number;
  /** what the edge round a top is, if it has one (DRESS.parapet, balustrade or jali) */
  rail?: number;
  /** a thin wall pierced as a jali screen; a pergola over a place (kept at the place, not the stone); a building's upper
   * windows behind mashrabiya; its doors and arched windows framed with colonnettes */
  screen?: boolean; pergola?: boolean; oriel?: boolean; colonnettes?: boolean;
  /** a low stone seat round a tree (kept at the tree's cell) */
  seat?: boolean;
  /** a flight's step open at its side, stepped off on to what's beside it level with its top */
  gap?: boolean;
}
/**
 * A connection: from a surface (the height stood on, and the column), along the columns the stroke crossed (the start's
 * first), to a surface (a top it reached), or out into the air (a walkway, `to` null). What it takes is worked out when
 * it's replayed, against what's there then: landings and walkways on stone under them, steps spread evenly where it
 * climbs. It never cuts the hand's stone: meeting stone at the height it's walking, it stops there and joins it.
 */
export interface Connect {
  from: Cell; to: Cell | null; path: Array<[number, number]>;
  /** where the stroke paused (indices along it, after its start): landings there, if the climb leaves room */
  rest?: number[];
  /** a way (not a walkway or a flight): it follows the ground, paved where it walks on the land, a flight where the
   * ground rises or falls along a straight run, a bridge where it must cross low ground or water */
  follow?: boolean;
}
/** another way a gesture could have been meant */
export interface Alt { label: string; op: Op }
/** how a connection came out when it was worked out: whether it reached where it was going, where it stopped */
export interface Reached { reached: boolean; stopped: number; cells: Cell[] }
/** an arch, carrying a run of stone along an axis (0 x, 1 z): its level, first cell, length, and the level it springs from */
export interface Span { k: number; a: number; i: number; j: number; n: number; low: number; born: number; /** a flat lintel, not an arch */ flat?: boolean; /** carried as part of a colonnade: on columns, under an entablature */ order?: 'colonnade' }
export interface Decor { kind: 'pool' | 'cypress' | 'pot' | 'olive'; i: number; j: number; born: number }
/** water falling: from a basin's spout (its cell, the way it spills), down to where it lands (that column's surface,
 * and whether that's water, or a bowl the rules put there to catch it) */
export interface Fall { k: number; i: number; j: number; d: number; land: number; into: 'water' | 'bowl' | 'stone'; born: number }

/** how many rounds of meeting a build goes to: what one round lays can meet things in the next */
export const MEET_ROUNDS = 3;

/** how big a court has to be for water in it, and for a cypress */
export const POOL_COURT = 6, TREE_COURT = 4;
/** where the piers go in a run of n cells, so each bay is at most `most` and they're as even as they can be (the longer
 * bays in the middle) */
export function bays(n: number, most: number): number[] {
  const b = Math.ceil((n + 1) / (most + 1)), total = n - (b - 1), base = Math.floor(total / b), extra = total % b;
  // (which bays take an extra cell: from the middle out)
  const order = Array.from({ length: b }, (_, q) => q).sort((p, q) => Math.abs(p - (b - 1) / 2) - Math.abs(q - (b - 1) / 2) || p - q);
  const len = Array(b).fill(base);
  for (let q = 0; q < extra; q++) len[order[q]]++;
  const at: number[] = [];
  let x = 0;
  for (let q = 0; q < b - 1; q++) { x += len[q]; at.push(x); x++; }
  return at;
}
/** where along a connection's way (`path`, the start's own column first; then `to`, if it goes to one) a stair can go:
 * the cells (indexed from the one after the start) where the way runs straight through, in and out the same way, so
 * a stair is climbed from its foot and left from its head */
export function straights(path: Array<[number, number]>, to: Cell | null): number[] {
  const out: number[] = [];
  for (let s = 1; s < path.length; s++) {
    const p = path[s - 1], c = path[s], n = s + 1 < path.length ? path[s + 1] : to ? [to[1], to[2]] : null;
    if (n && c[0] - p[0] === n[0] - c[0] && c[1] - p[1] === n[1] - c[1]) out.push(s - 1);
  }
  return out;
}
/**
 * A path across the grid with its zigzags gathered into straight runs: each stretch of `w` steps that goes only two
 * ways (a stroke drawn across the grid's axes) re-ordered to go all one way, then all the other, in the order the
 * stroke first went them. It starts and ends where it did, and strays from it by at most half the stretch.
 */
export function straighten(path: Array<[number, number]>, w: number): Array<[number, number]> {
  const steps: Array<[number, number]> = [];
  for (let s = 1; s < path.length; s++) steps.push([path[s][0] - path[s - 1][0], path[s][1] - path[s - 1][1]]);
  const out: Array<[number, number]> = [path[0]];
  for (let a = 0; a < steps.length; a += w) {
    const win = steps.slice(a, a + w), kinds: string[] = [];
    for (const d of win) if (!kinds.includes(d.join())) kinds.push(d.join());
    const order = kinds.length === 2 ? kinds.flatMap((k) => win.filter((d) => d.join() === k)) : win;
    for (const d of order) { const p = out[out.length - 1]; out.push([p[0] + d[0], p[1] + d[1]]); }
  }
  return out;
}
export const inGrid = (i: number, j: number) => i >= LO && j >= LO && i <= HI && j <= HI;
export const key = (k: number, i: number, j: number) => (k * N + (j - LO)) * N + (i - LO);
export const unkey = (v: number): Cell => [Math.floor(v / (N * N)), (v % N) + LO, (Math.floor(v / N) % N) + LO];

export class World {
  ops: Op[] = [];
  version = 0;
  /** how each connection came out, the last time it was worked out (by operation) */
  reached = new Map<Op, Reached>();
  /** stone the rules laid for a connection (not the hand's own) */
  laid = new Set<number>();
  /** the intended solid: stone (when laid), and stairs (which way, when) */
  mass = new Map<number, number>();
  stairs = new Map<number, { d: number; born: number }>();
  /** which stone has a way through it (and which way), what's a bridge's, cypresses and pools put there by hand */
  archways = new Map<number, number>();
  /** which stone is a thin wall (and the way it runs when nothing beside it says) */
  thin = new Map<number, number>();
  /**
   * The void the hand's ways need kept open (the reserved void of `static/labyrinth-connective.md`): each cell a way
   * laid by hand walks through (its paving, a walkway's or a bridge's deck, a landing), and which way it runs (0 along
   * i, 1 along j). Stone laid there after is an archway, the passage kept through it; a pier never stands in it. Only
   * what was authored claims it: the rules' own work (a court's pool, a roof) doesn't.
   */
  passages = new Map<number, number>();
  /** where two of the hand's passages cross, square (`cross`) */
  crossings = new Set<number>();
  /** the hand's stone a way's stair was carved out of (the step, and its headroom) */
  carved = new Set<number>();
  /** for each column, the first of the hand's operations (by its place in `ops`) that laid stone or steps in it: what
   * an assembly's identity is anchored to, so it's never re-rolled by a later neighbour */
  firstOp = new Map<number, number>();
  /** each connection's walking cells (the level it walks at): what encounters read as a way's course and its ends */
  walks = new Map<Op, Cell[]>();
  /** the hand's choices of how meetings are resolved (anchor cell → level), and the meetings found, as resolved */
  choices = new Map<number, number>();
  meetings: Meeting[] = [];
  private bridged = new Set<number>();
  trees = new Map<number, number>();
  /** what each tree is (`PLANT`; a cypress if it isn't said) */
  treeKind = new Map<number, number>();
  /** ladders, by the cell at the foot: the way each leans, how many levels it climbs, when */
  ladders = new Map<number, { d: number; n: number; born: number }>();
  pools = new Map<number, number>();
  basins = new Map<number, number>();
  /** where basins spill (one spout each, over the deepest drop), and the bowls the rules put where they land */
  falls: Fall[] = [];
  bowls = new Map<number, number>();
  /** readings of the rules' work switched by hand (RULE), and dressing (by cell) */
  rules = new Map<number, number>();
  dress = new Map<number, Dress>();
  /** what it takes to stand: piers (when raised), arches, the air under arches, courtyards, what grows in them */
  piers = new Map<number, number>();
  corbels = new Map<number, number>();
  spans: Span[] = [];
  private spanOf = new Map<number, Span>();
  /** the flights, each carried as a whole (`Flight`), which a stair is one of, and what's under them */
  flights: Flight[] = [];
  private flightOf = new Map<number, { f: Flight; q: number }>();
  private fills = new Map<number, 'fill' | 'low'>();
  private under = new Set<number>();
  courts = new Set<number>();
  decor: Decor[] = [];
  /** when each thing the rules made first appeared (so it rises once, and stays risen) */
  private seen = new Map<string, number>();
  private now = 0;
  /** the land it's built on (land.ts), or none: the flat slab */
  readonly land: Land | null;
  /**
   * `bay`: grid squares to a cell. 1, or 2 on the half grid (each cell four squares in plan, a storey still a square
   * high): there a wall or a way can be half a cell, and what's read in cells (an opening, a front's bay, a roof's
   * pitch, a building's least size, the land) is read over two squares (static/labyrinth-grid.md)
   */
  constructor(public seed = 1, readonly landSeed = 0, readonly bay = 1) { perf.count('world.new'); this.land = landSeed ? makeLand(landSeed, bay) : null; if (this.land) this.rebuild(0); else this.ext = this.measure(); }
  /** the ground's level in a column: 0 on the slab; on the land, its column's (`earth` fills it below that) */
  ground(i: number, j: number) { return this.land ? groundOf(this.land, i, j) : 0; }
  /** ground a way walks on, paved (by column) */
  paving = new Set<number>();
  paved(i: number, j: number) { return this.paving.has(key(0, i, j)); }
  /** the land itself, in a cell: under the ground */
  earth(k: number, i: number, j: number) { return k >= 0 && !!this.land && k < groundOf(this.land, i, j); }

  // ─── what's where ───
  stone(k: number, i: number, j: number) { return inGrid(i, j) && this.mass.has(key(k, i, j)); }
  stair(k: number, i: number, j: number): number { return inGrid(i, j) ? this.stairs.get(key(k, i, j))?.d ?? -1 : -1; }
  /**
   * On the half grid a flight climbs a level in two squares, as it does in a cell: the first square the lower half of the
   * rise (its foot behind it, at its level), the second the upper half (its head ahead, a level up). Which half a stair
   * is: the count of stairs the same way behind it at its level, odd or even (on cells, always the whole: 0).
   */
  stairHalf(k: number, i: number, j: number): number {
    if (this.bay === 1) return 0;
    const d = this.stair(k, i, j);
    if (d < 0) return 0;
    const [a, b] = DIRS[d];
    let n = 0; while (n < 8 && this.stair(k, i - a * (n + 1), j - b * (n + 1)) === d) n++;
    return n % 2;
  }
  /** the square the step after this one is in (up its flight), and the one before (down it) */
  stepAfter(k: number, i: number, j: number): Cell { const d = Math.max(0, this.stair(k, i, j)), [a, b] = DIRS[d]; return this.bay === 1 || this.stairHalf(k, i, j) === 1 ? [k + 1, i + a, j + b] : [k, i + a, j + b]; }
  stepBefore(k: number, i: number, j: number): Cell { const d = Math.max(0, this.stair(k, i, j)), [a, b] = DIRS[d]; return this.bay === 1 || this.stairHalf(k, i, j) === 0 ? [k - 1, i - a, j - b] : [k, i - a, j - b]; }
  pier(k: number, i: number, j: number) { return inGrid(i, j) && this.piers.has(key(k, i, j)); }
  span(k: number, i: number, j: number): Span | null { return inGrid(i, j) ? this.spanOf.get(key(k, i, j)) ?? null : null; }
  /** anything at a cell: stone, a stair, a pier, the fill under a flight */
  occupied(k: number, i: number, j: number) { return k >= 0 && k < CEIL && inGrid(i, j) && (this.mass.has(key(k, i, j)) || this.stairs.has(key(k, i, j)) || this.piers.has(key(k, i, j)) || this.earth(k, i, j) || this.fills.get(key(k, i, j)) === 'fill'); }
  /** under a flight: filled (its masonry), or too low to stand in (`low`), or nothing ('') */
  underFlight(k: number, i: number, j: number): 'fill' | 'low' | '' { return inGrid(i, j) ? this.fills.get(key(k, i, j)) ?? '' : ''; }
  /** the flight a stair is one of, and which step of it */
  flight(k: number, i: number, j: number) { return inGrid(i, j) ? this.flightOf.get(key(k, i, j)) ?? null : null; }
  /** stone held out on corbels: the way to the stone it's held from, or −1 */
  corbel(k: number, i: number, j: number): number { return inGrid(i, j) ? this.corbels.get(key(k, i, j)) ?? -1 : -1; }
  /** the air under an arch */
  arched(k: number, i: number, j: number) { return this.under.has(key(k, i, j)); }
  /** a plain block: stone not carried on an arch */
  block(k: number, i: number, j: number) { return this.stone(k, i, j) && !this.span(k, i, j) && !this.archways.has(key(k, i, j)) && !this.thin.has(key(k, i, j)); }
  /** a thin wall: the way it runs when nothing beside it says (0 x, 1 z), or −1 */
  wall(k: number, i: number, j: number): number { return inGrid(i, j) ? this.thin.get(key(k, i, j)) ?? -1 : -1; }
  /** stone with a way through it: which way (0 x, 1 z), or −1 */
  archway(k: number, i: number, j: number): number { return inGrid(i, j) ? this.archways.get(key(k, i, j)) ?? -1 : -1; }
  /** whether two of the hand's passages cross here (stone over it a cross vault, open all four ways) */
  cross(k: number, i: number, j: number) { return inGrid(i, j) && this.crossings.has(key(k, i, j)) && this.archways.has(key(k, i, j)); }
  tree(k: number, i: number, j: number) { return inGrid(i, j) && this.trees.has(key(k, i, j)); }
  /** whether a cell's in a tree's trunk or its crown over it: nothing a way lays goes through or over a tree (it bows
   * round it); a shrub or a hedge, its own height only */
  crown(k: number, i: number, j: number) {
    if (!inGrid(i, j)) return false;
    for (let q = 0; q <= 4 && k - q >= 0; q++) { const v = key(k - q, i, j); if (this.trees.has(v)) return q <= Math.max(1, PLANT_TALL[this.treeKind.get(v) ?? 0]); }
    return false;
  }
  /** the kind of plant growing from a cell (`PLANT`), or -1 */
  plant(k: number, i: number, j: number): number { return this.tree(k, i, j) ? this.treeKind.get(key(k, i, j)) ?? PLANT.cypress : -1; }
  /** stone laid as a bridge's */
  bridge(k: number, i: number, j: number) { return inGrid(i, j) && this.bridged.has(key(k, i, j)); }
  /** stone a connection laid (not the hand's own) */
  laidBy(k: number, i: number, j: number) { return inGrid(i, j) && this.laid.has(key(k, i, j)); }
  /** a cell's dressing, if it has any */
  dressed(k: number, i: number, j: number): Dress | null { return inGrid(i, j) ? this.dress.get(key(k, i, j)) ?? null : null; }
  /** a floor to stand on at the foot of level k: the stone (not a pool), or the top of stone */
  floor(k: number, i: number, j: number) { if (!inGrid(i, j)) return false; const g = this.ground(i, j); return k === g ? !this.pool(i, j) && !this.bowl(k, i, j) : k > g && this.stone(k - 1, i, j) && !this.basin(k, i, j) && !this.bowl(k, i, j); }
  /** water let into the top of the stone under a cell (a basin): only a plain block takes one (an arch's deck, a thin
   * wall, an arched way through haven't the depth) */
  basin(k: number, i: number, j: number) { return inGrid(i, j) && this.basins.has(key(k, i, j)) && this.block(k - 1, i, j) && !this.stone(k, i, j); }
  /** a bowl the rules put where falling water lands */
  bowl(k: number, i: number, j: number) { return inGrid(i, j) && this.bowls.has(key(k, i, j)); }
  /**
   * A cell a stair needs kept open: the place at its foot, the place at its head, and the headroom over it and over its
   * head. Auto never builds into one (a tap there is refused, a wall traced across one leaves a way through it, a
   * connection stops short of one), and the rules' dressing never stands in one.
   */
  way(k: number, i: number, j: number): boolean {
    for (let d = 0; d < 4; d++) {
      const [a, b] = DIRS[d];
      if (this.stair(k, i + a, j + b) === d || this.stair(k - 1, i - a, j - b) === d || this.stair(k - 2, i - a, j - b) === d) return true;
    }
    return this.stair(k - 1, i, j) >= 0;
  }
  /** a cell free to build in (a pier there gives way: it's the rules', and the hand's stone carries what it carried) */
  free(k: number, i: number, j: number) { return k >= 0 && k < CEIL && inGrid(i, j) && !this.stone(k, i, j) && this.stair(k, i, j) < 0 && !this.tree(k, i, j) && !this.tree(k - 1, i, j) && !this.earth(k, i, j) && !(k === this.ground(i, j) && this.pool(i, j)) && !this.basin(k, i, j) && !this.bowl(k, i, j); }
  /** how high a column's stone (or stair) goes, up from a level, without a gap */
  topFrom(k: number, i: number, j: number) { while (k + 1 < CEIL && (this.stone(k + 1, i, j) || this.stair(k + 1, i, j) >= 0)) k++; return k + 1; }
  /** the highest anything reaches */
  top() { return this.tall; }
  private tall = 0;
  /** how many levels there are to look through: what's built, and the air over it */
  levels = 1;
  private measureTop() { let t = this.land ? Math.max(...this.land.g) : 0; for (const v of [...this.mass.keys(), ...this.stairs.keys()]) t = Math.max(t, unkey(v)[0] + 1); for (const [v] of this.trees) t = Math.max(t, unkey(v)[0] + PLANT_TALL[this.treeKind.get(v) ?? 0]); return t; }
  born(k: number, i: number, j: number) { return this.mass.get(key(k, i, j)) ?? this.stairs.get(key(k, i, j))?.born ?? this.piers.get(key(k, i, j)) ?? this.trees.get(key(k, i, j)) ?? -1e3; }

  // ─── what the hand did ───
  apply(op: Op, now = 0) { const seen = new Set(this.derivedMass); this.ops.push(op); this.rebuild(now); this.adopt(op, now, seen); }
  /** put the last operation as it now is (a trace still under the finger) */
  replaceLast(op: Op, now = 0) { const seen = new Set(this.derivedMass); this.ops[this.ops.length - 1] = op; this.rebuild(now); this.adopt(op, now, seen); }
  undo(now = 0): Op | null { const op = this.ops.pop() ?? null; if (op) this.rebuild(now); return op; }
  clear() { this.ops = []; this.seen.clear(); this.rebuild(0); }

  /** the operations replayed into the intended solid, and that resolved */
  /**
   * The operations replayed into the intended solid, and resolved; then what the hand's pieces make of meeting
   * (`encounters.ts`), worked out on that and laid as operations of their own, and the whole resolved again with them.
   */
  rebuild(now = 0) { perf.count('world.rebuild'); const t0 = performance.now(); try { this.rebuildNow(now); } finally { perf.add('world.rebuild', performance.now() - t0); } }
  private rebuildNow(now = 0) {
    this.build(this.ops, now);
    const round: Round = { ops: [], found: [], taken: new Set() };
    let met = meet(this, round);
    this.derivedMass.clear();
    if (met.length) {
      const before = new Set(this.mass.keys());
      // (what the meetings laid can meet what's beside it in turn: built with it, and met again, a few rounds at most)
      for (let n = 0; met.length && n < MEET_ROUNDS; n++) {
        round.ops.push(...met);
        this.build([...this.ops, ...round.ops], now);
        met = n + 1 < MEET_ROUNDS ? meet(this, round) : [];
      }
      this.meetings = round.found;
      for (const v of this.mass.keys()) if (!before.has(v)) this.derivedMass.add(v);
    }
    this.version++;
  }
  /** the stone meetings laid (not the hand): what's built on it is adopted by what's built on it (`adopt`) */
  derivedMass = new Set<number>();
  /**
   * What the hand builds on, it makes its own: where an operation stands on stone a meeting laid (a way walking over a
   * meeting's landing, a block set on its slab), that stone is put in the operation, so it no longer hangs on how the
   * meeting is read (which can change as more is built round it).
   */
  private adopt(op: Op, now: number, seen: Set<number>) {
    if (!seen.size && !this.derivedMass.size) return;
    // (against the meetings as the hand saw them when it made this, and as they are now)
    const derived = (v: number) => seen.has(v) || this.derivedMass.has(v);
    const c = op.connect, ends: Cell[] = c ? [[c.from[0], c.path[0][0], c.path[0][1]], ...(c.to ? [c.to] : [])] : [];
    const rests: Cell[] = [...(this.walks.get(op) ?? []), ...ends, ...[...(op.add ?? []), ...(op.walls ?? []), ...(op.stairs ?? [])].map((q) => [q[0], q[1], q[2]] as Cell)];
    const need = [...new Set(rests.map(([k, i, j]) => key(k - 1, i, j)).filter(derived))].filter((v) => !(op.add ?? []).some((q) => key(q[0], q[1], q[2]) === v));
    if (!need.length) return;
    op.add = [...(op.add ?? []), ...need.map((v) => { const [k, i, j] = unkey(v); return [k, i, j, op.born ?? now] as [number, number, number, number]; })];
    this.rebuild(now);
  }

  /** `list` replayed into the intended solid, and that resolved */
  private build(list: Op[], now: number) {
    this.now = now;
    this.mass.clear(); this.stairs.clear(); this.archways.clear(); this.thin.clear(); this.bridged.clear(); this.trees.clear(); this.treeKind.clear(); this.pools.clear(); this.basins.clear(); this.passages.clear(); this.crossings.clear(); this.carved.clear(); this.firstOp.clear(); this.walks.clear(); this.choices.clear();
    this.laid.clear(); this.reached.clear(); this.rules.clear(); this.dress.clear(); this.paving.clear();
    // (and what was worked out from them last time (piers, spans, courts and their pools, basins' water), so nothing laid
    // now is laid against what was there before: a world rebuilt is the same world, however often)
    this.piers.clear(); this.spans = []; this.spanOf.clear(); this.under.clear(); this.corbels.clear(); this.courts.clear(); this.decor = []; this.bowls.clear(); this.falls = [];
    // (how high a way may be looked for, from what's asked for, not from what was built last time)
    let hi = this.land ? Math.max(...this.land.g) : 0;
    for (const op of list) {
      for (const c of [...(op.add ?? []), ...(op.walls ?? []), ...(op.arches ?? []), ...(op.stairs ?? []), ...(op.trees ?? [])]) hi = Math.max(hi, c[0] + 1);
      if (op.connect) hi = Math.max(hi, op.connect.from[0], op.connect.to?.[0] ?? 0);
    }
    this.levels = Math.min(CEIL - 4, hi + 2);
    // (the columns each operation laid in, marked as the next begins: the first to lay in a column keeps it)
    const mark = (n: number) => {
      const o = list[n]; if (!o || o.derived) return;
      const at = (i: number, j: number) => { if (inGrid(i, j) && !this.firstOp.has(key(0, i, j))) this.firstOp.set(key(0, i, j), n); };
      for (const c of [...(o.add ?? []), ...(o.walls ?? []), ...(o.arches ?? []), ...(o.stairs ?? [])]) at(c[1], c[2]);
      for (const c of this.reached.get(o)?.cells ?? []) at(c[1], c[2]);
    };
    /** ladders taken, by the cell at the foot: the place in the list of the last op that took one there */
    const ladderCut = new Map<number, number>();
    for (const [n, op] of list.entries()) {
      mark(n - 1);
      for (const [k, i, j, lv] of op.choose ?? []) this.choices.set(key(k, i, j), lv);
      if (op.connect) {
        // (stone and rules laid with it, first: a stair tower it walks to)
        for (const [k, i, j, b] of op.add ?? []) if (k >= 0 && k < CEIL && inGrid(i, j) && !this.stairs.has(key(k, i, j))) this.place(k, i, j, b);
        for (const [k, i, j, r] of op.rule ?? []) if (inGrid(i, j)) { if (r) this.rules.set(key(k, i, j), r); else this.rules.delete(key(k, i, j)); }
        this.realise(op); continue;
      }
      for (const [k, i, j] of op.cut ?? []) {
        // (k −1: a pool; −2: paving on the ground, and the way it ran)
        if (k === -2) { this.paving.delete(key(0, i, j)); this.passages.delete(key(this.ground(i, j), i, j)); continue; }
        if (k < 0) { this.pools.delete(key(0, i, j)); continue; }
        ladderCut.set(key(k, i, j), n);
        for (const m of [this.mass, this.stairs, this.archways, this.thin, this.trees, this.dress, this.basins]) m.delete(key(k, i, j));
        this.bridged.delete(key(k, i, j)); this.laid.delete(key(k, i, j));
      }
      for (const [k, i, j, a, b] of op.arches ?? []) if (k >= 0 && k < CEIL && inGrid(i, j)) { this.stairs.delete(key(k, i, j)); this.thin.delete(key(k, i, j)); this.mass.set(key(k, i, j), b); this.archways.set(key(k, i, j), a); }
      for (const [k, i, j, a, b] of op.walls ?? []) if (k >= 0 && k < CEIL && inGrid(i, j)) { this.stairs.delete(key(k, i, j)); this.archways.delete(key(k, i, j)); if (this.passages.has(key(k, i, j))) { this.place(k, i, j, b); continue; } this.mass.set(key(k, i, j), b); this.thin.set(key(k, i, j), a); }
      for (const [k, i, j, b] of op.trees ?? []) if (inGrid(i, j)) { this.trees.set(key(k, i, j), b); this.treeKind.delete(key(k, i, j)); }
      for (const [k, i, j, kind, b] of op.plants ?? []) if (inGrid(i, j) && !this.mass.has(key(k, i, j))) { this.trees.set(key(k, i, j), this.trees.get(key(k, i, j)) ?? b); this.treeKind.set(key(k, i, j), kind); }
      for (const [i, j, b] of op.pools ?? []) if (inGrid(i, j)) this.pools.set(key(0, i, j), b);
      for (const [k, i, j, b] of op.basins ?? []) if (inGrid(i, j) && k > 0 && k < CEIL) this.basins.set(key(k, i, j), b);
      for (const [i, j] of op.pave ?? []) if (inGrid(i, j) && !this.pool(i, j) && !this.occupied(this.ground(i, j), i, j)) this.paving.add(key(0, i, j));
      // (paving laid by hand is a passage: which way it runs, from the paving beside it)
      for (const [i, j] of op.pave ?? []) if (this.paving.has(key(0, i, j))) { const along = this.paving.has(key(0, i - 1, j)) || this.paving.has(key(0, i + 1, j)); this.passages.set(key(this.ground(i, j), i, j), along ? 0 : 1); }
      if (op.bridge) for (const [k, i, j] of op.add ?? []) this.bridged.add(key(k, i, j));
      for (const [k, i, j, b] of op.add ?? []) if (k >= 0 && k < CEIL && inGrid(i, j) && !this.stairs.has(key(k, i, j))) this.place(k, i, j, b);
      for (const [k, i, j, d, b] of op.stairs ?? []) if (k >= 0 && k < CEIL && inGrid(i, j)) { this.mass.delete(key(k, i, j)); this.thin.delete(key(k, i, j)); this.stairs.set(key(k, i, j), { d, born: b }); }
      for (const [k, i, j, r] of op.rule ?? []) if (inGrid(i, j)) { if (r) this.rules.set(key(k, i, j), r); else this.rules.delete(key(k, i, j)); }
      for (const [k, i, j, kind, on] of op.dress ?? []) {
        if (!inGrid(i, j) || k < 0 || k >= CEIL) continue;
        const v = key(k, i, j), d = this.dress.get(v) ?? {};
        if (kind <= DRESS.marble) d.mat = kind;
        else if (kind === DRESS.moss) d.moss = !!on;
        else if (kind === DRESS.ivy) d.ivy = !!on;
        else if (kind === DRESS.parapet || kind === DRESS.balustrade) { d.parapet = !!on; d.rail = on ? kind : 0; }
        else if (kind === DRESS.jali) { if (this.thin.has(v)) d.screen = !!on; else { d.parapet = !!on; d.rail = on ? kind : 0; } }
        else if (kind === DRESS.pergola) d.pergola = !!on;
        else if (kind === DRESS.mashrabiya) d.oriel = !!on;
        else if (kind === DRESS.colonnettes) d.colonnettes = !!on;
        else if (kind === DRESS.seat) d.seat = !!on;
        else if (kind === DRESS.gap) d.gap = !!on;
        else d.prop = on ? kind : 0;
        this.dress.set(v, d);
      }
    }
    mark(list.length - 1);
    // (ladders, where they still stand: a floor at the foot, nothing in the way up, the stone they lean on there, and a
    // place to step off on to at its top)
    this.ladders.clear();
    for (const [at, op] of list.entries()) for (const [k, i, j, d, n, b] of op.ladders ?? []) {
      const [a, c] = DIRS[d], x = i + a, z = j + c;
      if ((ladderCut.get(key(k, i, j)) ?? -1) > at) continue;
      if (!inGrid(i, j) || !(k === this.ground(i, j) || this.stone(k - 1, i, j))) continue;
      let ok = true;
      for (let q = 0; q < n && ok; q++) if (this.occupied(k + q, i, j) || !(this.stone(k + q, x, z) || this.earth(k + q, x, z))) ok = false;
      if (ok && !this.occupied(k + n, x, z)) this.ladders.set(key(k, i, j), { d, n, born: b });
    }
    this.tall = this.measureTop(); this.levels = this.tall + 2;
    this.resolve();
    this.spill();
    if (this.decor.some((d) => d.kind === 'cypress')) this.tall = Math.max(this.tall, 2);
    this.ext = this.measure();
  }

  /**
   * A connection, worked out against what's there now: a walkway at its height (on stone laid under it), or steps and
   * landings climbing evenly from one height to the other. Where it meets anything at the height it walks (the hand's
   * stone, a stair, a tree), it stops: it joins what it meets, and cuts nothing.
   */
  /** stone laid by hand: where it's in a passage, an archway, the way kept through it (its arch springing from what's
   * either side); elsewhere, stone */
  private place(k: number, i: number, j: number, born: number) {
    const v = key(k, i, j);
    // (round a tree's trunk, a pit left for it: stone laid where it grows goes round it, as a passage's goes over it)
    if (this.trees.has(v) || this.crown(k, i, j)) return;
    this.mass.set(v, this.mass.get(v) ?? born);
    const a = this.passages.get(v);
    if (a !== undefined) { this.archways.set(v, a); this.thin.delete(v); }
  }
  /** a cell a way laid by hand walks through, at `k`, come to from `prev`: kept open after (`passages`) */
  private reserve(k: number, i: number, j: number, prev: [number, number] | null) {
    if (k < 0 || k >= CEIL || !inGrid(i, j)) return;
    const v = key(k, i, j);
    const a = prev && prev[0] !== i ? 0 : 1, had = this.passages.get(v);
    if (had === undefined) this.passages.set(v, a);
    // (a second way across the first, square to it: a crossing, and stone over it a vault open all four ways)
    else if (prev && had !== a) this.crossings.add(v);
  }
  private walked(op: Op, c: Cell) { const l = this.walks.get(op); if (l) l.push(c); else this.walks.set(op, [c]); }
  /**
   * Who has a claim on a cell, that anything added must keep: a passage the hand made (`passages`), a stair's way, a
   * tree's trunk and crown, water. The one place encounters (and anything else) ask before laying there.
   */
  claim(k: number, i: number, j: number): 'passage' | 'stair' | 'tree' | 'water' | null {
    if (!inGrid(i, j)) return null;
    if (this.passages.has(key(k, i, j))) return 'passage';
    if (this.stairs.has(key(k, i, j)) || this.way(k, i, j) || this.onLadder(k, i, j)) return 'stair';
    for (let kk = k - 2; kk <= k; kk++) if (kk >= 0 && this.trees.has(key(kk, i, j))) return 'tree';
    if ((k === this.ground(i, j) && this.pool(i, j)) || this.basins.has(key(k, i, j))) return 'water';
    return null;
  }
  /** whether a stair at a cell, come to from `prev`, would stand across another way's walk (cutting it) */
  private crosses(k: number, i: number, j: number, prev: [number, number]) { const a = this.passages.get(key(k, i, j)); return a !== undefined && a !== (prev[0] !== i ? 0 : 1); }
  /** whether a cell is in a ladder's way: the levels it climbs through, over its foot */
  onLadder(k: number, i: number, j: number) { for (let q = 0; q <= k; q++) { const l = this.ladders.get(key(k - q, i, j)); if (l && q < l.n) return true; } return false; }
  /** the passage a cell keeps open, and which way it runs (-1 if none) */
  passage(k: number, i: number, j: number): number { return inGrid(i, j) ? this.passages.get(key(k, i, j)) ?? -1 : -1; }

  private realise(op: Op) {
    if (op.connect!.follow && op.connect!.to && this.follow(op)) return;
    const c = op.connect!, born = op.born ?? -100, [h0] = c.from, h1 = c.to ? c.to[0] : h0;
    const along = c.path.slice(1), cells: Cell[] = [];
    const taken = (k: number, i: number, j: number) => k >= 0 && (this.earth(k, i, j) || this.mass.has(key(k, i, j)) || this.stairs.has(key(k, i, j)) || this.crown(k, i, j));
    // (and nothing to stand on but a stair or a tree beneath: it can't rest there)
    // (stone it would lay where another stair needs its way open: it stops short)
    const blocks = (k: number, i: number, j: number) => k >= 0 && !taken(k, i, j) && this.way(k, i, j);
    const unsteady = (k: number, i: number, j: number) => k > 0 && (this.stairs.has(key(k - 1, i, j)) || this.trees.has(key(k - 1, i, j)));
    const stairAt = new Map<number, number>(), laidHere = new Set<number>();
    const lay = (k: number, i: number, j: number, s: number) => { if (k < 0 || taken(k, i, j)) return; laidHere.add(key(k, i, j)); this.mass.set(key(k, i, j), born + s * 0.05); this.laid.add(key(k, i, j)); if (op.bridge) this.bridged.add(key(k, i, j)); cells.push([k, i, j]); };
    const dirTo = (a: [number, number], b: [number, number]) => DIRS.findIndex(([x, z]) => x === b[0] - a[0] && z === b[1] - a[1]);
    // (a level a cell: on the half grid, two squares)
    const dz = h1 - h0, steps = Math.abs(dz) * this.bay;
    let half = 0;
    // (the steps go where the way runs straight, together in flights: the last straight run takes as many as it can,
    // ending where it ends, then the run before it; landings between)
    const straight = straights(c.path, c.to), C = straight.length, step = new Set<number>(), runs: number[][] = [];
    for (const s of straight) { const r = runs[runs.length - 1]; if (r && r[r.length - 1] === s - 1) r.push(s); else runs.push([s]); }
    // (where the stroke paused, a landing, if there's room for the steps without it)
    const rest = new Set(c.rest ?? []), spare = straight.filter((s) => !rest.has(s));
    if (rest.size && spare.length >= steps) { runs.length = 0; for (const s of spare) { const r = runs[runs.length - 1]; if (r && r[r.length - 1] === s - 1) r.push(s); else runs.push([s]); } }
    // (on the half grid, a level's two squares together in one run: never a landing between a step's halves)
    for (let q = runs.length - 1, left = steps; q >= 0 && left > 0; q--) { const r = runs[q], n = Math.min(left, r.length - (r.length % this.bay)); for (let t = 0; t < n; t++) step.add(r[r.length - 1 - t]); left -= n; }
    let stopped = steps > C ? 0 : -1;
    let h = h0;
    for (let s = 0; s < along.length && stopped < 0; s++) {
      const [i, j] = along[s], prev = s > 0 ? along[s - 1] : c.path[0];
      // (never past the grid's edge)
      if (!inGrid(i, j)) { stopped = s; break; }
      if (step.has(s) && dz > 0) {
        if (taken(h, i, j) || unsteady(h, i, j) || blocks(h - 1, i, j) || this.crosses(h, i, j, prev)) { stopped = s; break; }
        // (no stone laid under it: the flight is carried as a whole, as its setting has it (`carry`))
        this.stairs.set(key(h, i, j), { d: dirTo(prev, [i, j]), born: born + s * 0.05 }); this.laid.add(key(h, i, j)); cells.push([h, i, j]); stairAt.set(key(h, i, j), s);
        if (++half === this.bay) { h++; half = 0; }
      } else if (step.has(s)) {
        const hd = half === 0 ? h - 1 : h;
        if (taken(hd, i, j) || unsteady(hd, i, j) || blocks(hd - 1, i, j) || this.crosses(hd, i, j, prev)) { stopped = s; break; }
        h = hd; if (++half === this.bay) half = 0;
        this.stairs.set(key(h, i, j), { d: dirTo([i, j], prev), born: born + s * 0.05 }); this.laid.add(key(h, i, j)); cells.push([h, i, j]); stairAt.set(key(h, i, j), s);
      } else {
        // (through the hand's stone at the height it walks, straight, a cell to three thick and clear where it comes out:
        // a passage through it, the stone kept over it (a walkway through a tower))
        const solid = (q: number) => { const [x, z] = along[q]; return this.mass.has(key(h, x, z)) && !this.laid.has(key(h, x, z)) && !this.stairs.has(key(h, x, z)) && this.stone(h - 1, x, z) && this.mass.has(key(h + 1, x, z)); };
        const dirAt = (q: number) => { const a = q > 0 ? along[q - 1] : c.path[0]; return `${along[q][0] - a[0]}.${along[q][1] - a[1]}`; };
        if (taken(h, i, j) && solid(s) && h > this.ground(i, j)) {
          let e = s; while (e + 1 < along.length && e - s < 3 * this.bay && solid(e + 1) && dirAt(e + 1) === dirAt(s)) e++;
          const out = along[e + 1];
          if (e - s < 3 * this.bay && out && dirAt(e + 1) === dirAt(s) && !taken(h, out[0], out[1]) && !step.has(e + 1)) {
            for (let q = s; q <= e; q++) { const [x, z] = along[q], p2 = q > 0 ? along[q - 1] : c.path[0]; this.archways.set(key(h, x, z), p2[0] !== x ? 0 : 1); this.thin.delete(key(h, x, z)); this.reserve(h, x, z, p2); this.walked(op, [h, x, z]); }
            s = e;
            continue;
          }
        }
        // (a landing, or the walkway: nothing in the way at the height it walks, nor only a stair to stand on, nor a stair
        // just over it (no room to walk under a flight's steps))
        if (taken(h, i, j) || unsteady(h, i, j) || blocks(h - 1, i, j) || this.stairs.has(key(h + 1, i, j))) { stopped = s; break; }
        lay(h - 1, i, j, s);
        this.reserve(h, i, j, prev);
        this.walked(op, [h, i, j]);
      }
    }
    // (a stair that would lead straight into what stopped the way is no stair: it's taken back, and the stone laid under
    // it, so no stair ever climbs into a wall)
    for (let n = cells.length - 1; stopped > 0 && n >= 0; n--) {
      const v = key(...cells[n]);
      if (!this.stairs.has(v)) continue;
      const [x, z] = along[stopped];
      if (n >= cells.length - 2 && stairAt.get(v) === stopped - 1 && (taken(h, x, z) || unsteady(h, x, z))) {
        for (const c of cells.splice(n)) {
          const u = key(...c);
          if (this.stairs.has(u)) this.stairs.delete(u);
          else if (laidHere.has(u)) { this.mass.delete(u); this.bridged.delete(u); }
          this.laid.delete(u);
        }
        stopped--;
      }
      break;
    }
    this.reached.set(op, { reached: stopped < 0 && (!c.to || h === h1), stopped, cells });
  }

  /**
   * A way that follows the ground (`Connect.follow`): the height it walks at along the stroke, chosen as the cheapest
   * over the whole of it. On the ground costs nothing (and it's paved there); raised over it costs by how high (stone
   * laid under it, carried on arches over anything low: a bridge); a step up or down costs more, and goes only where
   * the way runs straight (a stair is climbed from its foot). It never goes into the land or into what's built, never
   * stands in water, and never lays stone in another stair's way. Where there's no way to make it reach as drawn, it
   * goes as far along the stroke as it can, and stops on the level there.
   */
  private follow(op: Op): boolean {
    const c = op.connect!, born = op.born ?? -100, h0 = c.from[0], h1 = c.to![0];
    if (c.path.length < 2) return false;
    const taken = (k: number, i: number, j: number) => k >= 0 && (this.earth(k, i, j) || this.mass.has(key(k, i, j)) || this.stairs.has(key(k, i, j)) || this.crown(k, i, j));
    const unsteady = (k: number, i: number, j: number) => k > 0 && (this.stairs.has(key(k - 1, i, j)) || this.trees.has(key(k - 1, i, j)));
    // (how it was last moved: on the level (0), a step up (1) or down (−1); on the half grid a level's two squares, the
    // first half of a step up (2) or down (−2) and the second half down (−3), each move's height the one walked at after it)
    const top = this.levels + 4, INF = 1e9, NM = 6, half = this.bay === 2, idx = (h: number, m: number) => h * NM + m + 3;
    /**
     * The search along one path: by cell along it, the height walked at after it and how it was last moved (on the
     * level, or a step up or down): a flight turns about only after a landing, so it can always be walked. Where there's
     * no way to make it reach as drawn, as far along it as it can go, on the level, and it stops there.
     */
    // (where the finger paused: a landing, never a stair; by the cells paused over, so a stroke straightened keeps them)
    const restAt = new Set((c.rest ?? []).map((q) => c.path[q + 1]).filter(Boolean).map(([i, j]) => `${i}.${j}`));
    const search = (path: Array<[number, number]>) => {
      const along = path.slice(1), n = along.length;
      /** the run of the hand's stone a straight stretch of the way goes through at `k`, about `s`: open-able if it's three
       * cells or fewer, the way straight through it, and clear where it goes in and comes out */
      const step = (q: number) => { const p = q > 0 ? along[q - 1] : path[0]; return `${along[q][0] - p[0]}.${along[q][1] - p[1]}`; };
      const solidAt = (k: number, q: number) => { const [x, z] = along[q]; return this.mass.has(key(k, x, z)) && !this.laid.has(key(k, x, z)) && !this.stairs.has(key(k, x, z)) && (k === this.ground(x, z) || this.stone(k - 1, x, z)); };
      const thru = (k: number, s: number) => {
        const d = step(s);
        let a = s, b = s;
        while (a > 0 && step(a) === d && solidAt(k, a - 1) && step(a - 1) === d) a--;
        while (b + 1 < n && solidAt(k, b + 1) && step(b + 1) === d) b++;
        if (b - a + 1 > 3 * this.bay || b + 1 >= n || step(b + 1) !== d) return false;
        return !taken(k, ...(a > 0 ? along[a - 1] : path[0])) && !taken(k, ...along[b + 1]);
      };
      const rested = new Set(along.map(([i, j], s) => (restAt.has(`${i}.${j}`) ? s : -1)).filter((s) => s >= 0));
      /** whether a step can be carved into the hand's stone at `k` (standing on stone or the ground, its headroom the
       * hand's stone or clear) */
      const handStone = (k: number, i: number, j: number) => this.mass.has(key(k, i, j)) && !this.laid.has(key(k, i, j)) && !this.stairs.has(key(k, i, j)) && !this.earth(k, i, j);
      const carve = (k: number, i: number, j: number) => k >= this.ground(i, j) && handStone(k, i, j) && (k === this.ground(i, j) || this.stone(k - 1, i, j)) && (handStone(k + 1, i, j) || !taken(k + 1, i, j)) && !unsteady(k, i, j);
      const straight = new Set(straights(path, c.to).filter((s) => !rested.has(s)));
      // (a level a cell can be walked at, or a stair stand at: over the ground, nothing in it, not in water, and the
      // stone under it not in another stair's way; and what it costs to raise it there)
      const at = (k: number, i: number, j: number, s = -1) => {
        const g = this.ground(i, j);
        // (through a gate: stone with a way through it the way the way goes)
        if (s >= 0 && this.archways.has(key(k, i, j)) && !this.stairs.has(key(k, i, j))) { const prev = s > 0 ? along[s - 1] : path[0]; return this.archways.get(key(k, i, j)) === (prev[0] !== i ? 0 : 1) && this.floor(k, i, j) ? 0 : -1; }
        // (the hand's stone across the way, drawn straight through: a wall a cell thick, or a building's foot up to three
        // cells deep: a passage opened in it, the stone kept over and round the opening (a route through a wall opens a
        // gate, not a way round it; through a house, a passage under it, as if the way had been there first))
        if (s >= 0 && s < n - 1 && this.mass.has(key(k, i, j)) && !this.laid.has(key(k, i, j)) && k >= g && (k === g || this.stone(k - 1, i, j)) && thru(k, s)) return 1;
        if (k < g || taken(k, i, j) || unsteady(k, i, j) || (k === g && this.pool(i, j)) || this.stairs.has(key(k + 1, i, j))) return -1;
        if (k > g && !taken(k - 1, i, j) && this.way(k - 1, i, j)) return -1;
        // (raised over the ground costs more than a step down and back up again: a way on the land goes with the
        // ground, and stands up off it only where it must (low ground, water), not as a causeway over every dip. On stone
        // the hand's already laid there (a wall's top, a terrace), nothing's laid: the top's walked as it is)
        if (k > g && this.mass.has(key(k - 1, i, j)) && !this.laid.has(key(k - 1, i, j))) return 0.3;
        return (k - g) * 1.2;
      };
      const cost: number[][] = Array.from({ length: n + 1 }, () => new Array((top + 1) * NM).fill(INF));
      const from: Array<Array<{ h: number; m: number }>> = Array.from({ length: n + 1 }, () => new Array((top + 1) * NM));
      cost[0][idx(h0, 0)] = 0;
      for (let s = 0; s < n; s++) {
        const [i, j] = along[s];
        for (let p = 0; p <= top; p++) for (let m = -3; m <= 2; m++) {
          const here = cost[s][idx(p, m)];
          if (here >= INF) continue;
          const go = (h: number, kind: number, extra: number) => { if (h < 0 || h > top) return; const v = here + extra, q = idx(h, kind); if (v < cost[s + 1][q]) { cost[s + 1][q] = v; from[s + 1][q] = { h: p, m }; } };
          // (half way up or down a level: on along the flight, its second half at the same level, straight on)
          if (m === 2 || m === -2) {
            if (!straight.has(s)) continue;
            const prev = s > 0 ? along[s - 1] : path[0], ax = prev[0] !== i ? 0 : 1, a2 = this.passages.get(key(p, i, j));
            const on = taken(p + 1, i, j) || (a2 !== undefined && a2 !== ax) ? -1 : at(p, i, j);
            if (on >= 0) go(m === 2 ? p + 1 : p, m === 2 ? 1 : -3, 0.5 + on);
            continue;
          }
          const walk = at(p, i, j, s);
          if (walk >= 0) go(p, 0, walk);
          if (straight.has(s)) {
            // (a stair needs room over it: the level it climbs into, or comes down from)
            // (and never across another way's walk: a stair there would cut it (along it, it's that way going on up))
            const prev = s > 0 ? along[s - 1] : path[0], ax = prev[0] !== i ? 0 : 1, across = (q: number) => { const a = this.passages.get(key(q, i, j)); return a !== undefined && a !== ax; };
            const cameDown = m === -1 || m === -3;
            const up = cameDown || taken(p + 1, i, j) || across(p) ? -1 : at(p, i, j);
            if (up >= 0) go(half ? p : p + 1, half ? 2 : 1, (half ? 0.5 : 1) + up);
            // (or carved up through the hand's stone where the stroke's drawn over or through it: a stair in the wall's
            // thickness, its headroom cut, the stone over it kept (carried on an arch); dearer than any open step)
            else if (!half && !cameDown && !across(p) && carve(p, i, j)) go(p + 1, 1, 3.5 + Math.max(0, p - this.ground(i, j)) * 1.2);
            const down = m === 1 || p < 1 || taken(p, i, j) || across(p - 1) ? -1 : at(p - 1, i, j);
            if (down >= 0) go(p - 1, half ? -2 : -1, (half ? 0.5 : 1) + down);
          }
        }
      }
      let end = -1, last = n, endH = h1;
      for (const m of [0, 1, -1, -3]) if (cost[n][idx(h1, m)] < INF && (end < 0 || cost[n][idx(h1, m)] < cost[n][idx(h1, end)])) end = m;
      if (end < 0) {
        for (last = n - 1; last > 0 && end < 0; last--) for (let h = 0; h <= top; h++) if (cost[last][idx(h, 0)] < INF && (end < 0 || cost[last][idx(h, 0)] < cost[last][idx(endH, 0)])) { end = 0; endH = h; }
        if (end < 0) return { path, along, plan: [] as Array<{ h: number; kind: number }>, last: 0, n, cost: 0 };
        last++;
      }
      const plan: Array<{ h: number; kind: number }> = new Array(last);
      for (let s = last, h = endH, m = end; s > 0; s--) { const f = from[s][idx(h, m)]; plan[s - 1] = { h: f.h, kind: m }; h = f.h; m = f.m; }
      return { path, along, plan, last, n, cost: cost[last][idx(endH, end)] };
    };
    // (as drawn; and drawn again with its zigzags gathered into short straight runs, never more than a cell or two off
    // the stroke (a stair wants a straight run to its foot, and a hand's stroke across the grid is a zigzag of cells
    // with none): whichever goes furthest, then costs clearly least, the stroke as drawn kept where it's as good)
    let best = search(c.path);
    for (const w of [4, 6, 8]) {
      const t = search(straighten(c.path, w * this.bay));
      if (t.last / t.n > best.last / best.n + 1e-9 || (t.last === t.n && best.last === best.n && t.cost < best.cost - 0.5)) best = t;
    }
    const { path, along, plan, last, n } = best;
    if (!last) { this.reached.set(op, { reached: false, stopped: 0, cells: [] }); return true; }
    // (laid as it was chosen)
    const cells: Cell[] = [];
    const dirTo = (a: [number, number], b: [number, number]) => DIRS.findIndex(([x, z]) => x === b[0] - a[0] && z === b[1] - a[1]);
    const lay = (k: number, i: number, j: number, s: number) => {
      if (k < 0 || taken(k, i, j) || k < this.ground(i, j)) return;
      this.mass.set(key(k, i, j), born + s * 0.05); this.laid.add(key(k, i, j)); cells.push([k, i, j]);
      // (over low ground or water: a bridge's stone, carried on one arch from bank to bank)
      if (k > this.ground(i, j)) this.bridged.add(key(k, i, j));
    };
    plan.forEach(({ h, kind }, s) => {
      const [i, j] = along[s], prev = s > 0 ? along[s - 1] : path[0];
      // (a step's level: down a level, the one under; the second half of a step down, the level it's already at)
      const k = kind === -1 || kind === -2 ? h - 1 : h;
      // (a step carved into the hand's stone: it and its headroom cut out of it, what's over them kept)
      if (kind === 1 && this.mass.has(key(k, i, j))) {
        const cut = (kk: number) => { this.mass.delete(key(kk, i, j)); this.thin.delete(key(kk, i, j)); this.archways.delete(key(kk, i, j)); this.carved.add(key(kk, i, j)); };
        for (const kk of [k, k + 1]) if (this.mass.has(key(kk, i, j)) && !this.laid.has(key(kk, i, j))) cut(kk);
        // (and above, where what's kept over it would have nothing to span to along the flight: open to the sky there)
        const [a, b] = DIRS[this.stairs.get(key(k, i, j))?.d ?? dirTo(prev, [i, j])];
        for (let kk = k + 2; this.mass.has(key(kk, i, j)) && !this.laid.has(key(kk, i, j)); kk++) { if (this.stone(kk, i - a, j - b) && this.stone(kk, i + a, j + b)) break; cut(kk); }
      }
      if (kind !== 0) { this.stairs.set(key(k, i, j), { d: kind > 0 ? dirTo(prev, [i, j]) : dirTo([i, j], prev), born: born + s * 0.05 }); this.laid.add(key(k, i, j)); cells.push([k, i, j]); }
      if (kind === 0) {
        // (walked through: kept open; and a wall it went through, opened, a gate)
        this.reserve(k, i, j, prev);
        this.walked(op, [k, i, j]);
        if (this.mass.has(key(k, i, j)) && !this.archways.has(key(k, i, j))) { this.archways.set(key(k, i, j), prev[0] !== i ? 0 : 1); this.thin.delete(key(k, i, j)); }
      }
      if (this.archways.has(key(k, i, j))) return;
      // (a stair's carried as its flight is, with no stone laid under it (`carry`))
      if (kind !== 0) return;
      if (k === this.ground(i, j)) this.paving.add(key(0, i, j));
      else lay(k - 1, i, j, s);
    });
    // (its ends kept open too: where it sets out from, and, if it got there, where it arrives (the cell a door's to open on))
    if (along.length) { this.reserve(h0, path[0][0], path[0][1], along[0]); this.walks.set(op, [[h0, path[0][0], path[0][1]], ...(this.walks.get(op) ?? [])]); }
    if (last === n && c.to && !this.occupied(h1, c.to[1], c.to[2])) { this.reserve(h1, c.to[1], c.to[2], along[n - 1] ?? path[0]); this.walked(op, [h1, c.to[1], c.to[2]]); }
    this.reached.set(op, { reached: last === n, stopped: last === n ? -1 : last, cells });
    return true;
  }

  private first(id: string, fallback: number) { if (!this.seen.has(id)) this.seen.set(id, Math.max(fallback, this.now)); return this.seen.get(id)!; }

  // ─── what it takes to stand ───
  private resolve() {
    this.piers.clear(); this.spans = []; this.spanOf.clear(); this.under.clear(); this.corbels.clear();
    this.carry();
    // (stone stands on what's under it; not on water, at the ground's level: there it's carried over the stream)
    const below = (k: number, i: number, j: number) => (k === 0 || this.occupied(k - 1, i, j)) && !(k === this.ground(i, j) && this.pool(i, j));
    /** whether a pier can come down here from `k` without standing in a passage the hand made */
    const pierable = (k: number, i: number, j: number) => { if (this.rules.get(key(k, i, j)) === RULE.noPier) return false; for (let kk = k - 1; kk >= 0 && !this.occupied(kk, i, j) && !this.under.has(key(kk, i, j)); kk--) if (this.passages.has(key(kk, i, j))) return false; return true; };
    const raisePier = (k: number, i: number, j: number, born: number, anyway = false) => {
      if (!anyway && !pierable(k, i, j)) return false;
      for (let kk = k - 1; kk >= 0 && !this.occupied(kk, i, j) && !this.under.has(key(kk, i, j)); kk--) this.piers.set(key(kk, i, j), this.first(`p${kk}.${i}.${j}`, born - 0.15));
      return true;
    };
    for (let k = this.land ? 0 : 1; k < this.levels; k++) {
      // (what's at this level with nothing under it)
      const loose = new Set<number>();
      for (const v of [...this.mass.keys(), ...this.stairs.keys()]) { const [kk, i, j] = unkey(v); if (kk === k && !below(k, i, j)) loose.add(v); }
      // (a stair over nothing is carried by its flight, or, if that's on piers, stands on a pier; so does stone where the
      // hand asked for one)
      for (const v of [...loose]) {
        if (this.stairs.has(v) && this.flightOf.get(v)?.f.carriage !== 'pier') { loose.delete(v); continue; }
        if (this.stairs.has(v) || this.rules.get(v) === RULE.pier) { const [, i, j] = unkey(v); raisePier(k, i, j, this.born(k, i, j), true); loose.delete(v); }
      }
      const abuts = (i: number, j: number) => ((this.stone(k, i, j) || this.stair(k, i, j) >= 0) && !loose.has(key(k, i, j)) && below(k, i, j)) || this.earth(k, i, j);
      /** the run of loose stone through a cell along an axis, and whether stone that stands bounds it each end */
      const run = (i: number, j: number, a: number) => {
        const [di, dj] = DIRS[a];
        let lo = 0, hi = 0;
        while (loose.has(key(k, i - (lo + 1) * di, j - (lo + 1) * dj)) && inGrid(i - (lo + 1) * di, j - (lo + 1) * dj)) lo++;
        while (loose.has(key(k, i + (hi + 1) * di, j + (hi + 1) * dj)) && inGrid(i + (hi + 1) * di, j + (hi + 1) * dj)) hi++;
        const s: [number, number] = [i - lo * di, j - lo * dj], n = lo + hi + 1;
        return { s, n, a, startBound: abuts(s[0] - di, s[1] - dj), endBound: abuts(s[0] + n * di, s[1] + n * dj) };
      };
      let guard = 0;
      while (loose.size && guard++ < 400) {
        // (arches first: the shortest bounded run there is, three cells at most)
        let best: ReturnType<typeof run> | null = null;
        // (a bridge's stone, all of a run: one arch, to seven cells)
        // (in cells: on the half grid, twice the squares)
        const most = (r: ReturnType<typeof run>) => { const [di, dj] = DIRS[r.a]; for (let q = 0; q < r.n; q++) if (!this.bridged.has(key(k, r.s[0] + q * di, r.s[1] + q * dj))) return 3 * this.bay; return 7 * this.bay; };
        for (const v of loose) { const [, i, j] = unkey(v); for (const a of [0, 1]) { const r = run(i, j, a); if (r.startBound && r.endBound && r.n <= most(r) && (!best || r.n < best.n)) best = r; } }
        if (best) { this.arch(k, best.a, best.s[0], best.s[1], best.n, loose); continue; }
        // (stone pushed out a cell from stone that stands, with nothing beyond it: held out on corbels from that stone,
        // not on piers to the ground, so the way under it stays open)
        let corbelled = false;
        for (const v of [...loose]) {
          if (!this.mass.has(v) || this.bridged.has(v) || this.rules.get(v) === RULE.pier) continue;
          const [, i, j] = unkey(v);
          // (from stone with a face under it to spring from; from stone that stands on a pier only where a pier of its
          // own would come down on something below, not to the ground: a deck's corner over open ground is on a pier)
          let clear = true;
          for (let kk = k - 1; kk >= this.ground(i, j); kk--) if (this.occupied(kk, i, j)) clear = false;
          const d = [0, 1, 2, 3].find((q) => { const [a, b] = DIRS[q]; return ((this.stone(k, i + a, j + b) && !loose.has(key(k, i + a, j + b)) && below(k, i + a, j + b) && !(clear && this.piers.has(key(k - 1, i + a, j + b)))) || this.earth(k, i + a, j + b)) && !this.occupied(k, i - a, j - b); });
          if (d === undefined) continue;
          this.corbels.set(v, d); loose.delete(v); corbelled = true;
        }
        if (corbelled) continue;
        // (a long run with stone either end: an arcade, its piers spaced evenly, the bays as alike as they can be)
        let arcade: ReturnType<typeof run> | null = null;
        for (const v of loose) { const [, i, j] = unkey(v); for (const a of [0, 1]) { const r = run(i, j, a); if (r.startBound && r.endBound && (!arcade || r.n < arcade.n)) arcade = r; } }
        if (arcade) {
          const [di, dj] = DIRS[arcade.a];
          // (a bay's pier never in a passage: one cell along, if that's clear, else the arch spans it)
          let placed = 0;
          for (const q of bays(arcade.n, most(arcade))) {
            for (const dq of [0, 1, -1]) {
              const qq = q + dq; if (qq < 0 || qq >= arcade.n) continue;
              const pi = arcade.s[0] + qq * di, pj = arcade.s[1] + qq * dj;
              if (!loose.has(key(k, pi, pj)) || !raisePier(k, pi, pj, this.born(k, pi, pj))) continue;
              loose.delete(key(k, pi, pj)); placed++; break;
            }
          }
          if (placed) continue;
        }
        // (else a pier: at a free end, so arches can span the rest)
        let at: [number, number] | null = null;
        for (const v of loose) {
          const [, i, j] = unkey(v);
          for (const a of [0, 1]) {
            const r = run(i, j, a), [di, dj] = DIRS[a];
            if (!r.startBound && r.n >= 1) { at = r.s; break; }
            if (!r.endBound) { at = [r.s[0] + (r.n - 1) * di, r.s[1] + (r.n - 1) * dj]; break; }
          }
          if (at) break;
        }
        if (!at) { const [, i, j] = unkey(loose.values().next().value!); at = [i, j]; }
        // (not down into a passage: another loose cell, if any will take a pier; only if none, there anyway)
        if (!pierable(k, at[0], at[1])) for (const v of loose) { const [, i, j] = unkey(v); if (pierable(k, i, j)) { at = [i, j]; break; } }
        // (where the hand took the pier, held out from what stands beside it if anything does, before a pier anyway)
        if (this.rules.get(key(k, at[0], at[1])) === RULE.noPier) {
          const [i, j] = at, d = [0, 1, 2, 3].find((q) => abuts(i + DIRS[q][0], j + DIRS[q][1]));
          if (d !== undefined) { this.corbels.set(key(k, i, j), d); loose.delete(key(k, i, j)); continue; }
        }
        raisePier(k, at[0], at[1], this.born(k, at[0], at[1]), true);
        loose.delete(key(k, at[0], at[1]));
      }
      this.alike(k);
    }
    this.courtyards();
    this.colonnades();
  }

  /**
   * The flights, and how each is carried (`Carriage`), from its setting: a wall beside it, its foot and what it climbs
   * to, a passage under it; and what that leaves under it (the fill of a solid one, the air too low to stand in under a
   * rampant or hung one).
   */
  private carry() {
    this.flights = []; this.flightOf.clear(); this.fills.clear();
    const solidAt = (k: number, i: number, j: number) => this.mass.has(key(k, i, j)) || this.earth(k, i, j);
    for (const [v, s] of this.stairs) {
      const [k, i, j] = unkey(v), [a, b] = DIRS[s.d];
      if (this.stair(...this.stepBefore(k, i, j)) === s.d) continue;
      const cells: Cell[] = [[k, i, j]];
      for (let c = this.stepAfter(k, i, j); this.stair(...c) === s.d && cells.length < CEIL; c = this.stepAfter(...c)) cells.push(c);
      const n = cells.length, over = (c: Cell) => c[0] > this.ground(c[1], c[2]) && !solidAt(c[0] - 1, c[1], c[2]) && this.stair(c[0] - 1, c[1], c[2]) < 0;
      const loose = cells.filter(over);
      // (its foot on the ground or what's there; and what's at its two ends to spring from and lean on)
      const founded = !over(cells[0]), [hk, hi, hj] = cells[n - 1];
      const headRests = solidAt(hk, hi + a, hj + b) || this.stair(...this.stepAfter(hk, hi, hj)) >= 0;
      const footRests = founded || solidAt(k - 1, i - a, j - b);
      // (a passage the hand made under it: never filled)
      const passageUnder = loose.some(([kk, x, z]) => { for (let q = this.ground(x, z); q < kk; q++) if (this.passages.has(key(q, x, z))) return true; return false; });
      // (a wall beside every step over nothing: the same side for all, if there is one)
      // (a thin wall can't carry steps cantilevered out of it: beside one, the flight stands free, and the wall becomes
      // a screen beside it (character.ts))
      const sideOf = (c: Cell) => [(s.d + 1) % 4, (s.d + 3) % 4].filter((q) => solidAt(c[0], c[1] + DIRS[q][0], c[2] + DIRS[q][1]) && !this.thin.has(key(c[0], c[1] + DIRS[q][0], c[2] + DIRS[q][1])));
      const common = [(s.d + 1) % 4, (s.d + 3) % 4].find((q) => loose.every((c) => sideOf(c).includes(q)));
      const hangs = loose.length > 0 && loose.every((c) => sideOf(c).length > 0);
      // (beside the land's bank, not a wall: built up solid against it, a retaining stair, not hung out of the earth)
      const byBank = hangs && !loose.every((c) => sideOf(c).some((q) => this.mass.has(key(c[0], c[1] + DIRS[q][0], c[2] + DIRS[q][1]))));
      const asked = this.rules.get(v);
      const options: Carriage[] = !loose.length ? ['ground'] : [...(hangs ? ['hung' as const] : []), ...(footRests && headRests ? ['rampant' as const] : []), ...(founded && !passageUnder ? ['solid' as const] : []), 'pier'];
      let carriage: Carriage;
      if (!loose.length) carriage = 'ground';
      else if (asked === RULE.hung && hangs) carriage = 'hung';
      else if (asked === RULE.rampant && footRests && headRests) carriage = 'rampant';
      else if (asked === RULE.solid && founded && !passageUnder) carriage = 'solid';
      else if (asked === RULE.pier) carriage = 'pier';
      else if (byBank && founded && !passageUnder) carriage = 'solid';
      else if (hangs) carriage = 'hung';
      else if (footRests && headRests && (n >= 3 || passageUnder || !founded)) carriage = 'rampant';
      else if (founded && !passageUnder) carriage = 'solid';
      else carriage = 'pier';
      const f: Flight = { cells, d: s.d, k0: k, rise: 1 / this.bay, carriage, founded, wall: carriage === 'hung' ? common ?? -1 : -1, options };
      this.flights.push(f);
      cells.forEach((c, q) => this.flightOf.set(key(...c), { f, q }));
      // (what's under it: filled, solid; under a rampant or hung one, what's under the soffit is open, what it cuts into
      // too low to stand in, and above it, the arch's own masonry)
      if (carriage === 'ground' || carriage === 'pier') continue;
      cells.forEach(([kk, x, z], q) => {
        if (!over([kk, x, z])) return;
        const y = carriage === 'solid' ? -1e3 : soffit(f, q + 0.5);
        for (let L = kk - 1; L >= this.ground(x, z) && !solidAt(L, x, z) && this.stair(L, x, z) < 0; L--) {
          const c = key(L, x, z);
          if (carriage === 'solid' || L >= y) this.fills.set(c, 'fill');
          else if (L + 1 > y) this.fills.set(c, 'low');
        }
      });
    }
  }

  /** an arch under a run of stone: springing as low as the stone each side goes, and the air under it kept clear (or,
   * where the hand asked, a flat lintel) */
  private arch(k: number, a: number, i: number, j: number, n: number, loose: Set<number>) {
    const [di, dj] = DIRS[a];
    const clear = (kk: number) => { for (let s = 0; s < n; s++) if (this.occupied(kk, i + s * di, j + s * dj)) return false; return true; };
    let flat = false, order: 'colonnade' | undefined;
    for (let s = 0; s < n; s++) { const r = this.rules.get(key(k, i + s * di, j + s * dj)); if (r === RULE.lintel) flat = true; if (r === RULE.colonnade) { flat = true; order = 'colonnade'; } }
    let low = k;
    while (!flat && low > 0 && this.occupied(low - 1, i - di, j - dj) && this.occupied(low - 1, i + n * di, j + n * dj) && clear(low - 1) && low > k + 1 - DECK - n / (2 * this.bay)) low--;
    let born = -1e3;
    for (let s = 0; s < n; s++) born = Math.max(born, this.born(k, i + s * di, j + s * dj));
    const sp: Span = { k, a, i, j, n, low, born: this.first(`a${k}.${a}.${i}.${j}.${n}`, born), flat, ...(order ? { order } : {}) };
    this.spans.push(sp);
    for (let s = 0; s < n; s++) {
      const v = key(k, i + s * di, j + s * dj);
      this.spanOf.set(v, sp); loose.delete(v);
      for (let kk = low; kk < k; kk++) this.under.add(key(kk, i + s * di, j + s * dj));
    }
  }

  /** an arcade's bays alike: the arches of a row at a level, end to end over piers, all spring from the same height */
  private alike(k: number) {
    const row = this.spans.filter((sp) => sp.k === k && !sp.flat);
    const along = (sp: Span) => (sp.a === 0 ? sp.i : sp.j), line = (sp: Span) => (sp.a === 0 ? sp.j : sp.i);
    row.sort((p, q) => p.a - q.a || line(p) - line(q) || along(p) - along(q));
    for (let q = 0; q < row.length;) {
      let r = q + 1;
      while (r < row.length) {
        const p = row[r - 1], c = row[r], [di, dj] = DIRS[p.a], gi = p.i + p.n * di, gj = p.j + p.n * dj;
        if (c.a !== p.a || line(c) !== line(p) || along(c) !== along(p) + p.n + 1 || !this.piers.has(key(k - 1, gi, gj))) break;
        r++;
      }
      if (r - q > 1) {
        const group = row.slice(q, r), cells = group.flatMap((sp) => Array.from({ length: sp.n }, (_, s) => key(k, sp.i + s * DIRS[sp.a][0], sp.j + s * DIRS[sp.a][1])));
        const low = Math.max(...group.map((sp) => sp.low));
        this.lower(group, low);
        // (a long raised row, nobody having said otherwise: now and then, once the courts are known, a colonnade)
        if (group.length >= 3 && k >= 1 && cells.every((v) => !this.rules.has(v))) this.rows.push({ group, cells });
      }
      q = r;
    }
  }

  /** the bays of a row all springing from the same height, the air under each down to it kept clear */
  private lower(group: Span[], low: number) {
    for (const sp of group) {
      const [di, dj] = DIRS[sp.a];
      for (let s = 0; s < sp.n; s++) for (let kk = sp.low; kk < low; kk++) this.under.delete(key(kk, sp.i + s * di, sp.j + s * dj));
      sp.low = low;
    }
  }
  /** raised rows, alike, that might be colonnades */
  private rows: Array<{ group: Span[]; cells: number[] }> = [];
  /**
   * Colonnades: a raised row of wide bays along a plaza or a facade (not by a court: a court's is a cloister's arcade,
   * rolling), now and then made a colonnade by the rules, flat on massive columns: the grand, slow rhythm, rather than the arcade's.
   */
  private colonnades() {
    for (const { group, cells } of this.rows) {
      const byCourt = cells.some((v) => { const [, i, j] = unkey(v); return [[0, 0], ...DIRS].some(([a, b]) => this.courts.has(key(0, i + a, j + b))); });
      // (wide bays only, three cells or more: a colonnade's spacing is slow)
      if (byCourt || group.some((sp) => sp.n < 3) || hash(this.seed, cells[0], 41) % 100 >= 35) continue;
      this.lower(group, group[0].k);
      for (const sp of group) { sp.flat = true; sp.order = 'colonnade'; }
    }
    this.rows = [];
  }

  /** ground walled in all round: a courtyard, paved, with water and a cypress if there's room */
  private courtyards() {
    this.courts.clear(); this.decor = [];
    // (the ground under a low arch, a passage a level or so high, is a gateway: it closes a court as a wall does; a bridge
    // high over the ground doesn't)
    const gate = (i: number, j: number) => { const g = this.ground(i, j); for (let k = g; k < this.levels; k++) { const sp = this.span(k, i, j); if (sp) return sp.k <= g + 1; if (this.occupied(k, i, j)) return false; } return false; };
    // (a pier stands in a court, it doesn't wall it: a cloister's columns)
    const open = (i: number, j: number) => { const g = this.ground(i, j); return !this.stone(g, i, j) && this.stair(g, i, j) < 0 && !this.under.has(key(g, i, j)) && !gate(i, j); };
    // (on the land: the open ground reached from outside reaches a neighbour a level up or down, no more (a cliff stops
    // it); a court is all at one level, and walled round by what's built at least half the way round, not by the land)
    const step = (i: number, j: number, x: number, z: number, court: boolean) => (court ? this.ground(x, z) === this.ground(i, j) : Math.abs(this.ground(x, z) - this.ground(i, j)) <= 1);
    const out = new Set<number>(), st: Array<[number, number]> = [];
    for (let t = LO; t <= HI; t++) for (const [i, j] of [[t, LO], [t, HI], [LO, t], [HI, t]]) if (open(i, j) && !out.has(key(0, i, j))) { out.add(key(0, i, j)); st.push([i, j]); }
    while (st.length) { const [i, j] = st.pop()!; for (const [a, b] of DIRS) { const x = i + a, z = j + b; if (inGrid(x, z) && open(x, z) && step(i, j, x, z, false) && !out.has(key(0, x, z))) { out.add(key(0, x, z)); st.push([x, z]); } } }
    const seen = new Set<number>();
    for (let j = LO; j <= HI; j++) for (let i = LO; i <= HI; i++) {
      if (!open(i, j) || out.has(key(0, i, j)) || seen.has(key(0, i, j))) continue;
      const region: Array<[number, number]> = [[i, j]], q: Array<[number, number]> = [[i, j]];
      seen.add(key(0, i, j));
      while (q.length) { const [x, z] = q.pop()!; for (const [a, b] of DIRS) { const x2 = x + a, z2 = z + b; if (inGrid(x2, z2) && open(x2, z2) && step(x, z, x2, z2, true) && !out.has(key(0, x2, z2)) && !seen.has(key(0, x2, z2))) { seen.add(key(0, x2, z2)); region.push([x2, z2]); q.push([x2, z2]); } } }
      if (this.land) {
        let built = 0, edges = 0;
        for (const [x, z] of region) for (const [a, b] of DIRS) { const x2 = x + a, z2 = z + b; if (region.some((c) => c[0] === x2 && c[1] === z2)) continue; edges++; if (this.occupied(this.ground(x, z), x2, z2) && !this.earth(this.ground(x, z), x2, z2)) built++; }
        if (built * 2 < edges) continue;
      }
      for (const [x, z] of region) this.courts.add(key(0, x, z));
      // (what grows there: water where it's open on all sides, or at its heart if it's big enough; a cypress in a corner)
      const inside = new Set(region.map(([x, z]) => key(0, x, z)));
      const id = region.map(([x, z]) => key(0, x, z)).sort((p, q2) => p - q2)[0];
      const when = this.first(`c${id}.${region.length}`, -1e3);
      // (and only where there's room for it: a small court is just paved; a big one keeps its water to its heart)
      // (a court's size in cells: on the half grid, four squares to one)
      const cells = region.length / (this.bay * this.bay);
      let pools = cells >= POOL_COURT ? region.filter(([x, z]) => DIRS.every(([a, b]) => inside.has(key(0, x + a, z + b)))) : [];
      if (pools.length > 4 * this.bay * this.bay) { const cx = region.reduce((s, c) => s + c[0], 0) / region.length, cz = region.reduce((s, c) => s + c[1], 0) / region.length; pools = pools.sort((p, q2) => Math.hypot(p[0] - cx, p[1] - cz) - Math.hypot(q2[0] - cx, q2[1] - cz)).slice(0, 4 * this.bay * this.bay); }
      if (!pools.length && cells >= POOL_COURT) {
        const cx = region.reduce((s, c) => s + c[0], 0) / region.length, cz = region.reduce((s, c) => s + c[1], 0) / region.length;
        pools = [region.reduce((b, c) => (Math.hypot(c[0] - cx, c[1] - cz) < Math.hypot(b[0] - cx, b[1] - cz) ? c : b))];
      }
      // (nothing the rules put in a court stands in a stair's way)
      // (nor in a pier's cell: a cloister's columns stand in it)
      pools = pools.filter(([x, z]) => !this.way(this.ground(x, z), x, z) && !this.pier(this.ground(x, z), x, z));
      for (const [x, z] of pools) this.decor.push({ kind: 'pool', i: x, j: z, born: this.first(`w${x}.${z}`, when) });
      if (cells >= TREE_COURT) {
        const corners = region.filter(([x, z]) => !this.way(this.ground(x, z), x, z) && !this.pier(this.ground(x, z), x, z) && !pools.some((p) => p[0] === x && p[1] === z) && DIRS.filter(([a, b]) => !inside.has(key(0, x + a, z + b))).length >= 2);
        if (corners.length) {
          const q = hash(this.seed, id) % corners.length, [x, z] = corners[q];
          // (a big court, an olive spreading over its corner; a smaller one, a cypress standing up out of it)
          this.decor.push({ kind: cells >= 20 ? 'olive' : 'cypress', i: x, j: z, born: this.first(`t${x}.${z}`, when) });
          // (and, as it happens, pots in the other corners)
          for (const [n, [px, pz]] of corners.entries()) if (n !== q && hash(this.seed, px, pz, 77) % 100 < 45) this.decor.push({ kind: 'pot', i: px, j: pz, born: this.first(`o${px}.${pz}`, when) });
        }
      }
    }
  }
  /**
   * Where the water goes: each basin (cells of water let in at one level, side by side) spills from one spout, at the
   * edge over water if there's water below one, else over the deepest drop (where there's no stone beside it at its level, nor a floor there to run out onto),
   * and falls to what's below that edge: into water if it's water (a pool, the stream, a lower basin, which spills in
   * turn), else into a bowl the rules put there to catch it, on the ground or a top; onto a stair or a way, it just
   * lands. A basin walled all round holds its water.
   */
  private spill() {
    this.falls = []; this.bowls.clear();
    const seen = new Set<number>();
    for (const v of [...this.basins.keys()].sort((a, b) => a - b)) {
      const [k0, i0, j0] = unkey(v);
      if (seen.has(v) || !this.basin(k0, i0, j0)) continue;
      const region: Array<[number, number]> = [], q: Array<[number, number]> = [[i0, j0]];
      seen.add(v);
      while (q.length) { const [i, j] = q.pop()!; region.push([i, j]); for (const [a, b] of DIRS) { const u = key(k0, i + a, j + b); if (!seen.has(u) && this.basin(k0, i + a, j + b)) { seen.add(u); q.push([i + a, j + b]); } } }
      let best: { i: number; j: number; d: number; land: number; h: number; into: Fall['into'] } | null = null, bestScore = -Infinity;
      for (const [i, j] of region) for (let d = 0; d < 4; d++) {
        const [a, b] = DIRS[d], x = i + a, z = j + b;
        if (!inGrid(x, z) || this.basin(k0, x, z) || this.stone(k0, x, z) || this.stair(k0, x, z) >= 0 || this.stone(k0 - 1, x, z) || this.stair(k0 - 1, x, z) >= 0) continue;
        // (what's under that edge: the first thing down the column)
        let h = k0 - 1;
        while (h > this.ground(x, z) && !this.stone(h - 1, x, z) && this.stair(h - 1, x, z) < 0) h--;
        if (this.stair(h - 1, x, z) >= 0 || this.occupied(h, x, z)) continue;
        const water = h === this.ground(x, z) ? this.pool(x, z) : this.basin(h, x, z);
        // (water finds water: a spout over water first, then over the deepest drop)
        const score = (water ? 10 : 0) + k0 - h + (hash(this.seed, i, j, d) % 100) / 1000;
        if (score > bestScore) { bestScore = score; best = { i, j, d, land: h, h, into: water ? 'water' : this.way(h, x, z) || this.paved(x, z) ? 'stone' : 'bowl' }; }
      }
      if (!best) continue;
      const born = Math.max(...region.map(([i, j]) => this.basins.get(key(k0, i, j)) ?? -1e3));
      this.falls.push({ k: k0, i: best.i, j: best.j, d: best.d, land: best.land, into: best.into, born });
      if (best.into === 'bowl') this.bowls.set(key(best.land, best.i + DIRS[best.d][0], best.j + DIRS[best.d][1]), born);
    }
  }
  /** the slab: the cells it covers (first and last each way): what's built and MARGIN_CELLS more, at least its start */
  extent() { return this.ext; }
  private ext = { i0: START[0], i1: START[1], j0: START[0], j1: START[1] };
  private measure(): { i0: number; i1: number; j0: number; j1: number } {
    // (on the land: as much of it as is shown: its first square, and more of it, from the same seed, four cells at a
    // time toward what's built within two of its edge, as far as the grid goes)
    if (this.land) {
      const b: { i0: number; i1: number; j0: number; j1: number } = { ...this.land.box }, cells: Array<[number, number]> = [], G = 4 * this.bay, E = this.bay;
      for (const m of [this.mass, this.stairs, this.piers, this.paving, this.trees]) for (const v of m.keys()) { const [, i, j] = unkey(v); cells.push([i, j]); }
      for (let grew = true; grew;) {
        grew = false;
        for (const [i, j] of cells) {
          if (i <= b.i0 + E && b.i0 > DOMAIN.i0) { b.i0 = Math.max(DOMAIN.i0, b.i0 - G); grew = true; }
          if (i >= b.i1 - E && b.i1 < DOMAIN.i1) { b.i1 = Math.min(DOMAIN.i1, b.i1 + G); grew = true; }
          if (j <= b.j0 + E && b.j0 > DOMAIN.j0) { b.j0 = Math.max(DOMAIN.j0, b.j0 - G); grew = true; }
          if (j >= b.j1 - E && b.j1 < DOMAIN.j1) { b.j1 = Math.min(DOMAIN.j1, b.j1 + G); grew = true; }
        }
      }
      return b;
    }
    const B = this.bay, M = MARGIN_CELLS * B;
    let i0 = START[0] * B, i1 = (START[1] + 1) * B - 1, j0 = START[0] * B, j1 = (START[1] + 1) * B - 1;
    for (const m of [this.mass, this.stairs, this.piers, this.trees, this.pools, this.basins]) for (const v of m.keys()) {
      const [, i, j] = unkey(v);
      i0 = Math.min(i0, i - M); i1 = Math.max(i1, i + M); j0 = Math.min(j0, j - M); j1 = Math.max(j1, j + M);
    }
    return { i0: Math.max(LO, i0), i1: Math.min(HI, i1), j0: Math.max(LO, j0), j1: Math.min(HI, j1) };
  }
  /** a cell on the slab */
  onSlab(i: number, j: number) { const e = this.extent(); return i >= e.i0 && i <= e.i1 && j >= e.j0 && j <= e.j1; }
  /** a pool at a cell of the ground */
  pool(i: number, j: number) { return this.pools.has(key(0, i, j)) || (!!this.land && this.land.water.has(j * 1000 + i)) || this.decor.some((d) => d.kind === 'pool' && d.i === i && d.j === j); }

  /** the operations, as text (to keep, and to make again: when they were laid isn't kept) */
  /** what's been done, written down (on the land, with the land's seed) */
  encode(): string {
    // (the fields after the eleventh only as far as the last one there is: an encoding made before a field existed reads
    // the same)
    const z = <T,>(a: T[] | undefined) => (a?.length ? a : 0);
    const ops = this.ops.map((o) => {
      const e: unknown[] = [o.add?.map((c) => c.slice(0, 3)) ?? 0, o.stairs?.map((c) => c.slice(0, 4)) ?? 0, o.cut ?? 0, o.arches?.map((c) => c.slice(0, 4)) ?? 0, o.trees?.map((c) => c.slice(0, 3)) ?? 0, o.pools?.map((c) => c.slice(0, 2)) ?? 0, o.bridge ? 1 : 0, o.connect ? [o.connect.from, o.connect.to, o.connect.path, ...(o.connect.rest?.length || o.connect.follow ? [o.connect.rest ?? 0] : []), ...(o.connect.follow ? [1] : [])] : 0, o.dress ?? 0, o.rule ?? 0, o.walls?.map((c) => c.slice(0, 4)) ?? 0,
        z(o.basins?.map((c) => c.slice(0, 3))), z(o.pave), z(o.choose), z(o.ladders?.map((c) => c.slice(0, 5))), z(o.plants?.map((c) => c.slice(0, 4)))];
      while (e.length > 11 && e[e.length - 1] === 0) e.pop();
      return e;
    });
    // (on the half grid, saying so)
    return JSON.stringify(this.land || this.bay !== 1 ? { ...(this.land ? { land: this.landSeed } : {}), ...(this.bay !== 1 ? { bay: this.bay } : {}), ops } : ops);
  }
}

/** a world made again from its operations (as `encode` wrote them), all laid long ago */
export function replay(text: string, seed = 1): World {
  let raw: unknown = [];
  try { raw = JSON.parse(text || '[]'); } catch { raw = []; }
  // (on the land: its seed, and what was done on it)
  let land = 0, bay = 1;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) { land = Number((raw as { land?: number }).land) || 0; bay = Number((raw as { bay?: number }).bay) === 2 ? 2 : 1; raw = (raw as { ops?: unknown }).ops; }
  if (!Array.isArray(raw)) raw = [];
  const w = new World(seed, land, bay);
  for (const o of raw as unknown[][]) {
    if (!Array.isArray(o)) continue;
    const at = (q: number) => (Array.isArray(o[q]) ? (o[q] as number[][]) : null);
    w.ops.push({
      add: at(0)?.map((c) => [c[0], c[1], c[2], -100] as [number, number, number, number]), stairs: at(1)?.map((c) => [c[0], c[1], c[2], c[3], -100] as [number, number, number, number, number]), cut: (at(2) as Cell[] | null) ?? undefined,
      connect: Array.isArray(o[7]) ? { from: (o[7] as unknown[])[0] as Cell, to: ((o[7] as unknown[])[1] as Cell | null) ?? null, path: (o[7] as unknown[])[2] as Array<[number, number]>, ...(Array.isArray((o[7] as unknown[])[3]) ? { rest: (o[7] as unknown[])[3] as number[] } : {}), ...((o[7] as unknown[])[4] ? { follow: true } : {}) } : undefined, born: -100,
      dress: (at(8) as Op['dress'] | null) ?? undefined, rule: (at(9) as Op['rule'] | null) ?? undefined, walls: at(10)?.map((c) => [c[0], c[1], c[2], c[3], -100] as [number, number, number, number, number]),
      arches: at(3)?.map((c) => [c[0], c[1], c[2], c[3], -100] as [number, number, number, number, number]), trees: at(4)?.map((c) => [c[0], c[1], c[2], -100] as [number, number, number, number]), pools: at(5)?.map((c) => [c[0], c[1], -100] as [number, number, number]), bridge: o[6] === 1, basins: at(11)?.map((c) => [c[0], c[1], c[2], -100] as [number, number, number, number]),
      pave: (at(12) as Array<[number, number]> | null) ?? undefined,
      choose: (at(13) as Array<[number, number, number, number]> | null) ?? undefined,
      ladders: at(14)?.map((c) => [c[0], c[1], c[2], c[3], c[4], -100] as [number, number, number, number, number, number]),
      plants: at(15)?.map((c) => [c[0], c[1], c[2], c[3], -100] as [number, number, number, number, number]),
    });
  }
  w.rebuild(-100);
  return w;
}
