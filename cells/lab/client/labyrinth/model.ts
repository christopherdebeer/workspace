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
 *    - a free end, or a stair over nothing, stands on a pier;
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
import { hash } from '../kit/rng';
import { DOMAIN, LAND, groundOf, makeLand, type Land } from './land';

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
}
/** readings of the rules' work a hand can switch to: an arch read as a lintel, a pier asked for; a building's roof (none, or
 * which kind), kept at the lowest cell of its top */
export const RULE = { none: 0, lintel: 1, pier: 2, colonnade: 3, arch: 4, noRoof: 10, hipped: 11, gable: 12, shed: 13, dome: 14, tower: 20 } as const;
/** a stair tower (kept at its foot): a building however slim, its door at its foot facing the way `tower + d` says */
export const isTower = (r: number | undefined) => r !== undefined && r >= RULE.tower && r < RULE.tower + 4;
/** dressing: three stones (travertine is the stone's own), then what's on it */
export const DRESS = { travertine: 0, brick: 1, marble: 2, moss: 3, ivy: 4, parapet: 5, lantern: 6, pot: 7, balustrade: 8, jali: 9, pergola: 10, mashrabiya: 11, colonnettes: 12 } as const;
/** a cell's dressing: each part set (by the hand, or by the rules' own dressing, character.ts) or not; a part set off
 * by hand stays off whatever the rules would put */
export interface Dress {
  mat?: number; moss?: boolean; ivy?: boolean; parapet?: boolean; prop?: number;
  /** what the edge round a top is, if it has one (DRESS.parapet, balustrade or jali) */
  rail?: number;
  /** a thin wall pierced as a jali screen; a pergola over a place (kept at the place, not the stone); a building's upper
   * windows behind mashrabiya; its doors and arched windows framed with colonnettes */
  screen?: boolean; pergola?: boolean; oriel?: boolean; colonnettes?: boolean;
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
export interface Decor { kind: 'pool' | 'cypress' | 'pot'; i: number; j: number; born: number }
/** water falling: from a basin's spout (its cell, the way it spills), down to where it lands (that column's surface,
 * and whether that's water, or a bowl the rules put there to catch it) */
export interface Fall { k: number; i: number; j: number; d: number; land: number; into: 'water' | 'bowl' | 'stone'; born: number }

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
  private bridged = new Set<number>();
  trees = new Map<number, number>();
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
  private under = new Set<number>();
  courts = new Set<number>();
  decor: Decor[] = [];
  /** when each thing the rules made first appeared (so it rises once, and stays risen) */
  private seen = new Map<string, number>();
  private now = 0;
  /** the land it's built on (land.ts), or none: the flat slab */
  readonly land: Land | null;
  constructor(public seed = 1, readonly landSeed = 0) { this.land = landSeed ? makeLand(landSeed) : null; if (this.land) this.rebuild(0); }
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
  pier(k: number, i: number, j: number) { return inGrid(i, j) && this.piers.has(key(k, i, j)); }
  span(k: number, i: number, j: number): Span | null { return inGrid(i, j) ? this.spanOf.get(key(k, i, j)) ?? null : null; }
  /** anything at a cell: stone, a stair, a pier */
  occupied(k: number, i: number, j: number) { return k >= 0 && k < CEIL && inGrid(i, j) && (this.mass.has(key(k, i, j)) || this.stairs.has(key(k, i, j)) || this.piers.has(key(k, i, j)) || this.earth(k, i, j)); }
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
  tree(k: number, i: number, j: number) { return inGrid(i, j) && this.trees.has(key(k, i, j)); }
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
  private measureTop() { let t = this.land ? Math.max(...this.land.g) : 0; for (const v of [...this.mass.keys(), ...this.stairs.keys()]) t = Math.max(t, unkey(v)[0] + 1); for (const v of this.trees.keys()) t = Math.max(t, unkey(v)[0] + 2); return t; }
  born(k: number, i: number, j: number) { return this.mass.get(key(k, i, j)) ?? this.stairs.get(key(k, i, j))?.born ?? this.piers.get(key(k, i, j)) ?? this.trees.get(key(k, i, j)) ?? -1e3; }

  // ─── what the hand did ───
  apply(op: Op, now = 0) { this.ops.push(op); this.rebuild(now); }
  /** put the last operation as it now is (a trace still under the finger) */
  replaceLast(op: Op, now = 0) { this.ops[this.ops.length - 1] = op; this.rebuild(now); }
  undo(now = 0): Op | null { const op = this.ops.pop() ?? null; if (op) this.rebuild(now); return op; }
  clear() { this.ops = []; this.seen.clear(); this.rebuild(0); }

  /** the operations replayed into the intended solid, and that resolved */
  rebuild(now = 0) {
    this.now = now;
    this.mass.clear(); this.stairs.clear(); this.archways.clear(); this.thin.clear(); this.bridged.clear(); this.trees.clear(); this.pools.clear(); this.basins.clear();
    this.laid.clear(); this.reached.clear(); this.rules.clear(); this.dress.clear(); this.paving.clear();
    for (const op of this.ops) {
      if (op.connect) {
        // (stone and rules laid with it, first: a stair tower it walks to)
        for (const [k, i, j, b] of op.add ?? []) if (k >= 0 && k < CEIL && inGrid(i, j) && !this.stairs.has(key(k, i, j))) this.mass.set(key(k, i, j), this.mass.get(key(k, i, j)) ?? b);
        for (const [k, i, j, r] of op.rule ?? []) if (inGrid(i, j)) { if (r) this.rules.set(key(k, i, j), r); else this.rules.delete(key(k, i, j)); }
        this.realise(op); continue;
      }
      for (const [k, i, j] of op.cut ?? []) {
        if (k < 0) { this.pools.delete(key(0, i, j)); continue; }
        for (const m of [this.mass, this.stairs, this.archways, this.thin, this.trees, this.dress, this.basins]) m.delete(key(k, i, j));
        this.bridged.delete(key(k, i, j)); this.laid.delete(key(k, i, j));
      }
      for (const [k, i, j, a, b] of op.arches ?? []) if (k >= 0 && k < CEIL && inGrid(i, j)) { this.stairs.delete(key(k, i, j)); this.thin.delete(key(k, i, j)); this.mass.set(key(k, i, j), b); this.archways.set(key(k, i, j), a); }
      for (const [k, i, j, a, b] of op.walls ?? []) if (k >= 0 && k < CEIL && inGrid(i, j)) { this.stairs.delete(key(k, i, j)); this.archways.delete(key(k, i, j)); this.mass.set(key(k, i, j), b); this.thin.set(key(k, i, j), a); }
      for (const [k, i, j, b] of op.trees ?? []) if (inGrid(i, j)) this.trees.set(key(k, i, j), b);
      for (const [i, j, b] of op.pools ?? []) if (inGrid(i, j)) this.pools.set(key(0, i, j), b);
      for (const [k, i, j, b] of op.basins ?? []) if (inGrid(i, j) && k > 0 && k < CEIL) this.basins.set(key(k, i, j), b);
      for (const [i, j] of op.pave ?? []) if (inGrid(i, j) && !this.pool(i, j) && !this.occupied(this.ground(i, j), i, j)) this.paving.add(key(0, i, j));
      if (op.bridge) for (const [k, i, j] of op.add ?? []) this.bridged.add(key(k, i, j));
      for (const [k, i, j, b] of op.add ?? []) if (k >= 0 && k < CEIL && inGrid(i, j) && !this.stairs.has(key(k, i, j))) this.mass.set(key(k, i, j), this.mass.get(key(k, i, j)) ?? b);
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
        else d.prop = on ? kind : 0;
        this.dress.set(v, d);
      }
    }
    this.tall = this.measureTop(); this.levels = this.tall + 2;
    this.resolve();
    this.spill();
    if (this.decor.some((d) => d.kind === 'cypress')) this.tall = Math.max(this.tall, 2);
    this.ext = this.measure();
    this.version++;
  }

  /**
   * A connection, worked out against what's there now: a walkway at its height (on stone laid under it), or steps and
   * landings climbing evenly from one height to the other. Where it meets anything at the height it walks (the hand's
   * stone, a stair, a tree), it stops: it joins what it meets, and cuts nothing.
   */
  private realise(op: Op) {
    if (op.connect!.follow && op.connect!.to && this.follow(op)) return;
    const c = op.connect!, born = op.born ?? -100, [h0] = c.from, h1 = c.to ? c.to[0] : h0;
    const along = c.path.slice(1), cells: Cell[] = [];
    const taken = (k: number, i: number, j: number) => k >= 0 && (this.earth(k, i, j) || this.mass.has(key(k, i, j)) || this.stairs.has(key(k, i, j)) || this.trees.has(key(k, i, j)) || (k > 0 && this.trees.has(key(k - 1, i, j))));
    // (and nothing to stand on but a stair or a tree beneath: it can't rest there)
    // (stone it would lay where another stair needs its way open: it stops short)
    const blocks = (k: number, i: number, j: number) => k >= 0 && !taken(k, i, j) && this.way(k, i, j);
    const unsteady = (k: number, i: number, j: number) => k > 0 && (this.stairs.has(key(k - 1, i, j)) || this.trees.has(key(k - 1, i, j)));
    const stairAt = new Map<number, number>(), laidHere = new Set<number>();
    const lay = (k: number, i: number, j: number, s: number) => { if (k < 0 || taken(k, i, j)) return; laidHere.add(key(k, i, j)); this.mass.set(key(k, i, j), born + s * 0.05); this.laid.add(key(k, i, j)); if (op.bridge) this.bridged.add(key(k, i, j)); cells.push([k, i, j]); };
    const dirTo = (a: [number, number], b: [number, number]) => DIRS.findIndex(([x, z]) => x === b[0] - a[0] && z === b[1] - a[1]);
    const dz = h1 - h0, steps = Math.abs(dz);
    // (the steps go where the way runs straight, together in flights: the last straight run takes as many as it can,
    // ending where it ends, then the run before it; landings between)
    const straight = straights(c.path, c.to), C = straight.length, step = new Set<number>(), runs: number[][] = [];
    for (const s of straight) { const r = runs[runs.length - 1]; if (r && r[r.length - 1] === s - 1) r.push(s); else runs.push([s]); }
    // (where the stroke paused, a landing, if there's room for the steps without it)
    const rest = new Set(c.rest ?? []), spare = straight.filter((s) => !rest.has(s));
    if (rest.size && spare.length >= steps) { runs.length = 0; for (const s of spare) { const r = runs[runs.length - 1]; if (r && r[r.length - 1] === s - 1) r.push(s); else runs.push([s]); } }
    for (let q = runs.length - 1, left = steps; q >= 0 && left > 0; q--) { const r = runs[q], n = Math.min(left, r.length); for (let t = 0; t < n; t++) step.add(r[r.length - 1 - t]); left -= n; }
    let stopped = steps > C ? 0 : -1;
    let h = h0;
    for (let s = 0; s < along.length && stopped < 0; s++) {
      const [i, j] = along[s], prev = s > 0 ? along[s - 1] : c.path[0];
      if (step.has(s) && dz > 0) {
        if (taken(h, i, j) || unsteady(h, i, j) || blocks(h - 1, i, j)) { stopped = s; break; }
        this.stairs.set(key(h, i, j), { d: dirTo(prev, [i, j]), born: born + s * 0.05 }); this.laid.add(key(h, i, j)); cells.push([h, i, j]); stairAt.set(key(h, i, j), s);
        lay(h - 1, i, j, s);
        h++;
      } else if (step.has(s)) {
        if (taken(h - 1, i, j) || unsteady(h - 1, i, j) || blocks(h - 2, i, j)) { stopped = s; break; }
        h--;
        this.stairs.set(key(h, i, j), { d: dirTo([i, j], prev), born: born + s * 0.05 }); this.laid.add(key(h, i, j)); cells.push([h, i, j]); stairAt.set(key(h, i, j), s);
        lay(h - 1, i, j, s);
      } else {
        // (a landing, or the walkway: nothing in the way at the height it walks, nor only a stair to stand on)
        if (taken(h, i, j) || unsteady(h, i, j) || blocks(h - 1, i, j)) { stopped = s; break; }
        lay(h - 1, i, j, s);
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
    const taken = (k: number, i: number, j: number) => k >= 0 && (this.earth(k, i, j) || this.mass.has(key(k, i, j)) || this.stairs.has(key(k, i, j)) || this.trees.has(key(k, i, j)) || (k > 0 && this.trees.has(key(k - 1, i, j))));
    const unsteady = (k: number, i: number, j: number) => k > 0 && (this.stairs.has(key(k - 1, i, j)) || this.trees.has(key(k - 1, i, j)));
    const top = this.levels + 4, INF = 1e9, idx = (h: number, m: number) => h * 3 + m + 1;
    /**
     * The search along one path: by cell along it, the height walked at after it and how it was last moved (on the
     * level, or a step up or down): a flight turns about only after a landing, so it can always be walked. Where there's
     * no way to make it reach as drawn, as far along it as it can go, on the level, and it stops there.
     */
    // (where the finger paused: a landing, never a stair; by the cells paused over, so a stroke straightened keeps them)
    const restAt = new Set((c.rest ?? []).map((q) => c.path[q + 1]).filter(Boolean).map(([i, j]) => `${i}.${j}`));
    const search = (path: Array<[number, number]>) => {
      const along = path.slice(1), n = along.length, rested = new Set(along.map(([i, j], s) => (restAt.has(`${i}.${j}`) ? s : -1)).filter((s) => s >= 0));
      const straight = new Set(straights(path, c.to).filter((s) => !rested.has(s)));
      // (a level a cell can be walked at, or a stair stand at: over the ground, nothing in it, not in water, and the
      // stone under it not in another stair's way; and what it costs to raise it there)
      const at = (k: number, i: number, j: number, s = -1) => {
        const g = this.ground(i, j);
        // (through a gate: stone with a way through it the way the way goes)
        if (s >= 0 && this.archways.has(key(k, i, j)) && !this.stairs.has(key(k, i, j))) { const prev = s > 0 ? along[s - 1] : path[0]; return this.archways.get(key(k, i, j)) === (prev[0] !== i ? 0 : 1) && this.floor(k, i, j) ? 0 : -1; }
        if (k < g || taken(k, i, j) || unsteady(k, i, j) || (k === g && this.pool(i, j))) return -1;
        if (k > g && !taken(k - 1, i, j) && this.way(k - 1, i, j)) return -1;
        // (raised over the ground costs more than a step down and back up again: a way on the land goes with the
        // ground, and stands up off it only where it must (low ground, water), not as a causeway over every dip)
        return (k - g) * 1.2;
      };
      const cost: number[][] = Array.from({ length: n + 1 }, () => new Array((top + 1) * 3).fill(INF));
      const from: Array<Array<{ h: number; m: number }>> = Array.from({ length: n + 1 }, () => new Array((top + 1) * 3));
      cost[0][idx(h0, 0)] = 0;
      for (let s = 0; s < n; s++) {
        const [i, j] = along[s];
        for (let p = 0; p <= top; p++) for (let m = -1; m <= 1; m++) {
          const here = cost[s][idx(p, m)];
          if (here >= INF) continue;
          const go = (h: number, kind: number, extra: number) => { if (h < 0 || h > top) return; const v = here + extra, q = idx(h, kind); if (v < cost[s + 1][q]) { cost[s + 1][q] = v; from[s + 1][q] = { h: p, m }; } };
          const walk = at(p, i, j, s);
          if (walk >= 0) go(p, 0, walk);
          if (straight.has(s)) {
            // (a stair needs room over it: the level it climbs into, or comes down from)
            const up = m === -1 || taken(p + 1, i, j) ? -1 : at(p, i, j);
            if (up >= 0) go(p + 1, 1, 1 + up);
            const down = m === 1 || p < 1 || taken(p, i, j) ? -1 : at(p - 1, i, j);
            if (down >= 0) go(p - 1, -1, 1 + down);
          }
        }
      }
      let end = -1, last = n, endH = h1;
      for (const m of [0, 1, -1]) if (cost[n][idx(h1, m)] < INF && (end < 0 || cost[n][idx(h1, m)] < cost[n][idx(h1, end)])) end = m;
      if (end < 0) {
        for (last = n - 1; last > 0 && end < 0; last--) for (let h = 0; h <= top; h++) if (cost[last][idx(h, 0)] < INF && (end < 0 || cost[last][idx(h, 0)] < cost[last][idx(endH, 0)])) { end = 0; endH = h; }
        if (end < 0) return { path, along, plan: [] as Array<{ h: number; kind: 0 | 1 | -1 }>, last: 0, n, cost: 0 };
        last++;
      }
      const plan: Array<{ h: number; kind: 0 | 1 | -1 }> = new Array(last);
      for (let s = last, h = endH, m = end; s > 0; s--) { const f = from[s][idx(h, m)]; plan[s - 1] = { h: f.h, kind: m as 0 | 1 | -1 }; h = f.h; m = f.m; }
      return { path, along, plan, last, n, cost: cost[last][idx(endH, end)] };
    };
    // (as drawn; and drawn again with its zigzags gathered into short straight runs, never more than a cell or two off
    // the stroke (a stair wants a straight run to its foot, and a hand's stroke across the grid is a zigzag of cells
    // with none): whichever goes furthest, then costs clearly least, the stroke as drawn kept where it's as good)
    let best = search(c.path);
    for (const w of [4, 6, 8]) {
      const t = search(straighten(c.path, w));
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
      const k = kind === -1 ? h - 1 : h;
      if (kind !== 0) { this.stairs.set(key(k, i, j), { d: kind === 1 ? dirTo(prev, [i, j]) : dirTo([i, j], prev), born: born + s * 0.05 }); this.laid.add(key(k, i, j)); cells.push([k, i, j]); }
      if (this.archways.has(key(k, i, j))) return;
      if (k === this.ground(i, j)) { if (kind === 0) this.paving.add(key(0, i, j)); }
      else lay(k - 1, i, j, s);
    });
    this.reached.set(op, { reached: last === n, stopped: last === n ? -1 : last, cells });
    return true;
  }

  private first(id: string, fallback: number) { if (!this.seen.has(id)) this.seen.set(id, Math.max(fallback, this.now)); return this.seen.get(id)!; }

  // ─── what it takes to stand ───
  private resolve() {
    this.piers.clear(); this.spans = []; this.spanOf.clear(); this.under.clear(); this.corbels.clear();
    // (stone stands on what's under it; not on water, at the ground's level: there it's carried over the stream)
    const below = (k: number, i: number, j: number) => (k === 0 || this.occupied(k - 1, i, j)) && !(k === this.ground(i, j) && this.pool(i, j));
    const raisePier = (k: number, i: number, j: number, born: number) => {
      for (let kk = k - 1; kk >= 0 && !this.occupied(kk, i, j) && !this.under.has(key(kk, i, j)); kk--) this.piers.set(key(kk, i, j), this.first(`p${kk}.${i}.${j}`, born - 0.15));
    };
    for (let k = this.land ? 0 : 1; k < this.levels; k++) {
      // (what's at this level with nothing under it)
      const loose = new Set<number>();
      for (const v of [...this.mass.keys(), ...this.stairs.keys()]) { const [kk, i, j] = unkey(v); if (kk === k && !below(k, i, j)) loose.add(v); }
      // (a stair over nothing stands on a pier; so does stone where the hand asked for one)
      for (const v of [...loose]) if (this.stairs.has(v) || this.rules.get(v) === RULE.pier) { const [, i, j] = unkey(v); raisePier(k, i, j, this.born(k, i, j)); loose.delete(v); }
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
        const most = (r: ReturnType<typeof run>) => { const [di, dj] = DIRS[r.a]; for (let q = 0; q < r.n; q++) if (!this.bridged.has(key(k, r.s[0] + q * di, r.s[1] + q * dj))) return 3; return 7; };
        for (const v of loose) { const [, i, j] = unkey(v); for (const a of [0, 1]) { const r = run(i, j, a); if (r.startBound && r.endBound && r.n <= most(r) && (!best || r.n < best.n)) best = r; } }
        if (best) { this.arch(k, best.a, best.s[0], best.s[1], best.n, loose); continue; }
        // (stone pushed out a cell from stone that stands, with nothing beyond it: held out on corbels from that stone,
        // not on piers to the ground, so the way under it stays open)
        let corbelled = false;
        for (const v of [...loose]) {
          if (!this.mass.has(v) || this.bridged.has(v) || this.rules.get(v) === RULE.pier) continue;
          const [, i, j] = unkey(v);
          const d = [0, 1, 2, 3].find((q) => { const [a, b] = DIRS[q]; return ((this.stone(k, i + a, j + b) && !loose.has(key(k, i + a, j + b)) && below(k, i + a, j + b)) || this.earth(k, i + a, j + b)) && !this.occupied(k, i - a, j - b); });
          if (d === undefined) continue;
          this.corbels.set(v, d); loose.delete(v); corbelled = true;
        }
        if (corbelled) continue;
        // (a long run with stone either end: an arcade, its piers spaced evenly, the bays as alike as they can be)
        let arcade: ReturnType<typeof run> | null = null;
        for (const v of loose) { const [, i, j] = unkey(v); for (const a of [0, 1]) { const r = run(i, j, a); if (r.startBound && r.endBound && (!arcade || r.n < arcade.n)) arcade = r; } }
        if (arcade) {
          const [di, dj] = DIRS[arcade.a];
          for (const q of bays(arcade.n, most(arcade))) { const pi = arcade.s[0] + q * di, pj = arcade.s[1] + q * dj; raisePier(k, pi, pj, this.born(k, pi, pj)); loose.delete(key(k, pi, pj)); }
          continue;
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
        raisePier(k, at[0], at[1], this.born(k, at[0], at[1]));
        loose.delete(key(k, at[0], at[1]));
      }
      this.alike(k);
    }
    this.courtyards();
    this.colonnades();
  }

  /** an arch under a run of stone: springing as low as the stone each side goes, and the air under it kept clear (or,
   * where the hand asked, a flat lintel) */
  private arch(k: number, a: number, i: number, j: number, n: number, loose: Set<number>) {
    const [di, dj] = DIRS[a];
    const clear = (kk: number) => { for (let s = 0; s < n; s++) if (this.occupied(kk, i + s * di, j + s * dj)) return false; return true; };
    let flat = false, order: 'colonnade' | undefined;
    for (let s = 0; s < n; s++) { const r = this.rules.get(key(k, i + s * di, j + s * dj)); if (r === RULE.lintel) flat = true; if (r === RULE.colonnade) { flat = true; order = 'colonnade'; } }
    let low = k;
    while (!flat && low > 0 && this.occupied(low - 1, i - di, j - dj) && this.occupied(low - 1, i + n * di, j + n * dj) && clear(low - 1) && low > k + 1 - DECK - n / 2) low--;
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
      let pools = region.length >= POOL_COURT ? region.filter(([x, z]) => DIRS.every(([a, b]) => inside.has(key(0, x + a, z + b)))) : [];
      if (pools.length > 4) { const cx = region.reduce((s, c) => s + c[0], 0) / region.length, cz = region.reduce((s, c) => s + c[1], 0) / region.length; pools = pools.sort((p, q2) => Math.hypot(p[0] - cx, p[1] - cz) - Math.hypot(q2[0] - cx, q2[1] - cz)).slice(0, 4); }
      if (!pools.length && region.length >= POOL_COURT) {
        const cx = region.reduce((s, c) => s + c[0], 0) / region.length, cz = region.reduce((s, c) => s + c[1], 0) / region.length;
        pools = [region.reduce((b, c) => (Math.hypot(c[0] - cx, c[1] - cz) < Math.hypot(b[0] - cx, b[1] - cz) ? c : b))];
      }
      // (nothing the rules put in a court stands in a stair's way)
      // (nor in a pier's cell: a cloister's columns stand in it)
      pools = pools.filter(([x, z]) => !this.way(this.ground(x, z), x, z) && !this.pier(this.ground(x, z), x, z));
      for (const [x, z] of pools) this.decor.push({ kind: 'pool', i: x, j: z, born: this.first(`w${x}.${z}`, when) });
      if (region.length >= TREE_COURT) {
        const corners = region.filter(([x, z]) => !this.way(this.ground(x, z), x, z) && !this.pier(this.ground(x, z), x, z) && !pools.some((p) => p[0] === x && p[1] === z) && DIRS.filter(([a, b]) => !inside.has(key(0, x + a, z + b))).length >= 2);
        if (corners.length) {
          const q = hash(this.seed, id) % corners.length, [x, z] = corners[q];
          this.decor.push({ kind: 'cypress', i: x, j: z, born: this.first(`t${x}.${z}`, when) });
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
      const b: { i0: number; i1: number; j0: number; j1: number } = { i0: LAND.i0, i1: LAND.i1, j0: LAND.j0, j1: LAND.j1 }, cells: Array<[number, number]> = [];
      for (const m of [this.mass, this.stairs, this.piers, this.paving, this.trees]) for (const v of m.keys()) { const [, i, j] = unkey(v); cells.push([i, j]); }
      for (let grew = true; grew;) {
        grew = false;
        for (const [i, j] of cells) {
          if (i <= b.i0 + 1 && b.i0 > DOMAIN.i0) { b.i0 = Math.max(DOMAIN.i0, b.i0 - 4); grew = true; }
          if (i >= b.i1 - 1 && b.i1 < DOMAIN.i1) { b.i1 = Math.min(DOMAIN.i1, b.i1 + 4); grew = true; }
          if (j <= b.j0 + 1 && b.j0 > DOMAIN.j0) { b.j0 = Math.max(DOMAIN.j0, b.j0 - 4); grew = true; }
          if (j >= b.j1 - 1 && b.j1 < DOMAIN.j1) { b.j1 = Math.min(DOMAIN.j1, b.j1 + 4); grew = true; }
        }
      }
      return b;
    }
    let i0 = START[0], i1 = START[1], j0 = START[0], j1 = START[1];
    for (const m of [this.mass, this.stairs, this.piers, this.trees, this.pools, this.basins]) for (const v of m.keys()) {
      const [, i, j] = unkey(v);
      i0 = Math.min(i0, i - MARGIN_CELLS); i1 = Math.max(i1, i + MARGIN_CELLS); j0 = Math.min(j0, j - MARGIN_CELLS); j1 = Math.max(j1, j + MARGIN_CELLS);
    }
    return { i0: Math.max(LO, i0), i1: Math.min(HI, i1), j0: Math.max(LO, j0), j1: Math.min(HI, j1) };
  }
  /** a cell on the slab */
  onSlab(i: number, j: number) { const e = this.extent(); return i >= e.i0 && i <= e.i1 && j >= e.j0 && j <= e.j1; }
  /** a pool at a cell of the ground */
  pool(i: number, j: number) { return this.pools.has(key(0, i, j)) || (!!this.land && this.land.water.has(j * 1000 + i)) || this.decor.some((d) => d.kind === 'pool' && d.i === i && d.j === j); }

  /** the operations, as text (to keep, and to make again: when they were laid isn't kept) */
  /** what's been done, written down (on the land, with the land's seed) */
  encode(): string { const ops = this.ops.map((o) => [o.add?.map((c) => c.slice(0, 3)) ?? 0, o.stairs?.map((c) => c.slice(0, 4)) ?? 0, o.cut ?? 0, o.arches?.map((c) => c.slice(0, 4)) ?? 0, o.trees?.map((c) => c.slice(0, 3)) ?? 0, o.pools?.map((c) => c.slice(0, 2)) ?? 0, o.bridge ? 1 : 0, o.connect ? [o.connect.from, o.connect.to, o.connect.path, ...(o.connect.rest?.length || o.connect.follow ? [o.connect.rest ?? 0] : []), ...(o.connect.follow ? [1] : [])] : 0, o.dress ?? 0, o.rule ?? 0, o.walls?.map((c) => c.slice(0, 4)) ?? 0, ...(o.basins?.length || o.pave?.length ? [o.basins?.map((c) => c.slice(0, 3)) ?? 0] : []), ...(o.pave?.length ? [o.pave] : [])]); return JSON.stringify(this.land ? { land: this.landSeed, ops } : ops); }
}

/** a world made again from its operations (as `encode` wrote them), all laid long ago */
export function replay(text: string, seed = 1): World {
  let raw: unknown = [];
  try { raw = JSON.parse(text || '[]'); } catch { raw = []; }
  // (on the land: its seed, and what was done on it)
  let land = 0;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) { land = Number((raw as { land?: number }).land) || 0; raw = (raw as { ops?: unknown }).ops; }
  if (!Array.isArray(raw)) raw = [];
  const w = new World(seed, land);
  for (const o of raw as unknown[][]) {
    if (!Array.isArray(o)) continue;
    const at = (q: number) => (Array.isArray(o[q]) ? (o[q] as number[][]) : null);
    w.ops.push({
      add: at(0)?.map((c) => [c[0], c[1], c[2], -100] as [number, number, number, number]), stairs: at(1)?.map((c) => [c[0], c[1], c[2], c[3], -100] as [number, number, number, number, number]), cut: (at(2) as Cell[] | null) ?? undefined,
      connect: Array.isArray(o[7]) ? { from: (o[7] as unknown[])[0] as Cell, to: ((o[7] as unknown[])[1] as Cell | null) ?? null, path: (o[7] as unknown[])[2] as Array<[number, number]>, ...(Array.isArray((o[7] as unknown[])[3]) ? { rest: (o[7] as unknown[])[3] as number[] } : {}), ...((o[7] as unknown[])[4] ? { follow: true } : {}) } : undefined, born: -100,
      dress: (at(8) as Op['dress'] | null) ?? undefined, rule: (at(9) as Op['rule'] | null) ?? undefined, walls: at(10)?.map((c) => [c[0], c[1], c[2], c[3], -100] as [number, number, number, number, number]),
      arches: at(3)?.map((c) => [c[0], c[1], c[2], c[3], -100] as [number, number, number, number, number]), trees: at(4)?.map((c) => [c[0], c[1], c[2], -100] as [number, number, number, number]), pools: at(5)?.map((c) => [c[0], c[1], -100] as [number, number, number]), bridge: o[6] === 1, basins: at(11)?.map((c) => [c[0], c[1], c[2], -100] as [number, number, number, number]),
      pave: (at(12) as Array<[number, number]> | null) ?? undefined,
    });
  }
  w.rebuild(-100);
  return w;
}
