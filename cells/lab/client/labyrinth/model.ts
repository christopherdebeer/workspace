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
}
/** readings of the rules' work a hand can switch to: an arch read as a lintel, a pier asked for; a building's roof (none, or
 * which kind), kept at the lowest cell of its top */
export const RULE = { none: 0, lintel: 1, pier: 2, noRoof: 10, hipped: 11, gable: 12, shed: 13, dome: 14 } as const;
/** dressing: three stones (travertine is the stone's own), then what's on it */
export const DRESS = { travertine: 0, brick: 1, marble: 2, moss: 3, ivy: 4, parapet: 5, lantern: 6, pot: 7 } as const;
/** a cell's dressing: each part set (by the hand, or by the rules' own dressing, character.ts) or not; a part set off
 * by hand stays off whatever the rules would put */
export interface Dress { mat?: number; moss?: boolean; ivy?: boolean; parapet?: boolean; prop?: number }
/**
 * A connection: from a surface (the height stood on, and the column), along the columns the stroke crossed (the start's
 * first), to a surface (a top it reached), or out into the air (a walkway, `to` null). What it takes is worked out when
 * it's replayed, against what's there then: landings and walkways on stone under them, steps spread evenly where it
 * climbs. It never cuts the hand's stone: meeting stone at the height it's walking, it stops there and joins it.
 */
export interface Connect { from: Cell; to: Cell | null; path: Array<[number, number]> }
/** how a connection came out when it was worked out: whether it reached where it was going, where it stopped */
export interface Reached { reached: boolean; stopped: number; cells: Cell[] }
/** an arch, carrying a run of stone along an axis (0 x, 1 z): its level, first cell, length, and the level it springs from */
export interface Span { k: number; a: number; i: number; j: number; n: number; low: number; born: number; /** a flat lintel, not an arch */ flat?: boolean }
export interface Decor { kind: 'pool' | 'cypress' | 'pot'; i: number; j: number; born: number }

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
  /** readings of the rules' work switched by hand (RULE), and dressing (by cell) */
  rules = new Map<number, number>();
  dress = new Map<number, Dress>();
  /** what it takes to stand: piers (when raised), arches, the air under arches, courtyards, what grows in them */
  piers = new Map<number, number>();
  spans: Span[] = [];
  private spanOf = new Map<number, Span>();
  private under = new Set<number>();
  courts = new Set<number>();
  decor: Decor[] = [];
  /** when each thing the rules made first appeared (so it rises once, and stays risen) */
  private seen = new Map<string, number>();
  private now = 0;
  constructor(public seed = 1) {}

  // ─── what's where ───
  stone(k: number, i: number, j: number) { return inGrid(i, j) && this.mass.has(key(k, i, j)); }
  stair(k: number, i: number, j: number): number { return inGrid(i, j) ? this.stairs.get(key(k, i, j))?.d ?? -1 : -1; }
  pier(k: number, i: number, j: number) { return inGrid(i, j) && this.piers.has(key(k, i, j)); }
  span(k: number, i: number, j: number): Span | null { return inGrid(i, j) ? this.spanOf.get(key(k, i, j)) ?? null : null; }
  /** anything at a cell: stone, a stair, a pier */
  occupied(k: number, i: number, j: number) { return k >= 0 && k < CEIL && inGrid(i, j) && (this.mass.has(key(k, i, j)) || this.stairs.has(key(k, i, j)) || this.piers.has(key(k, i, j))); }
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
  floor(k: number, i: number, j: number) { return inGrid(i, j) && (k === 0 ? !this.pool(i, j) : this.stone(k - 1, i, j)); }
  /** a cell free to build in */
  /** a cell free to build in (a pier there gives way: it's the rules', and the hand's stone carries what it carried) */
  free(k: number, i: number, j: number) { return k >= 0 && k < CEIL && inGrid(i, j) && !this.stone(k, i, j) && this.stair(k, i, j) < 0 && !this.tree(k, i, j) && !this.tree(k - 1, i, j) && !(k === 0 && this.pool(i, j)); }
  /** how high a column's stone (or stair) goes, up from a level, without a gap */
  topFrom(k: number, i: number, j: number) { while (k + 1 < CEIL && (this.stone(k + 1, i, j) || this.stair(k + 1, i, j) >= 0)) k++; return k + 1; }
  /** the highest anything reaches */
  top() { return this.tall; }
  private tall = 0;
  /** how many levels there are to look through: what's built, and the air over it */
  levels = 1;
  private measureTop() { let t = 0; for (const v of [...this.mass.keys(), ...this.stairs.keys()]) t = Math.max(t, unkey(v)[0] + 1); for (const v of this.trees.keys()) t = Math.max(t, unkey(v)[0] + 2); return t; }
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
    this.mass.clear(); this.stairs.clear(); this.archways.clear(); this.thin.clear(); this.bridged.clear(); this.trees.clear(); this.pools.clear();
    this.laid.clear(); this.reached.clear(); this.rules.clear(); this.dress.clear();
    for (const op of this.ops) {
      if (op.connect) { this.realise(op); continue; }
      for (const [k, i, j] of op.cut ?? []) {
        if (k < 0) { this.pools.delete(key(0, i, j)); continue; }
        for (const m of [this.mass, this.stairs, this.archways, this.thin, this.trees, this.dress]) m.delete(key(k, i, j));
        this.bridged.delete(key(k, i, j)); this.laid.delete(key(k, i, j));
      }
      for (const [k, i, j, a, b] of op.arches ?? []) if (k >= 0 && k < CEIL && inGrid(i, j)) { this.stairs.delete(key(k, i, j)); this.thin.delete(key(k, i, j)); this.mass.set(key(k, i, j), b); this.archways.set(key(k, i, j), a); }
      for (const [k, i, j, a, b] of op.walls ?? []) if (k >= 0 && k < CEIL && inGrid(i, j)) { this.stairs.delete(key(k, i, j)); this.archways.delete(key(k, i, j)); this.mass.set(key(k, i, j), b); this.thin.set(key(k, i, j), a); }
      for (const [k, i, j, b] of op.trees ?? []) if (inGrid(i, j)) this.trees.set(key(k, i, j), b);
      for (const [i, j, b] of op.pools ?? []) if (inGrid(i, j)) this.pools.set(key(0, i, j), b);
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
        else if (kind === DRESS.parapet) d.parapet = !!on;
        else d.prop = on ? kind : 0;
        this.dress.set(v, d);
      }
    }
    this.tall = this.measureTop(); this.levels = this.tall + 2;
    this.resolve();
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
    const c = op.connect!, born = op.born ?? -100, [h0] = c.from, h1 = c.to ? c.to[0] : h0;
    const along = c.path.slice(1), cells: Cell[] = [];
    const taken = (k: number, i: number, j: number) => k >= 0 && (this.mass.has(key(k, i, j)) || this.stairs.has(key(k, i, j)) || this.trees.has(key(k, i, j)) || (k > 0 && this.trees.has(key(k - 1, i, j))));
    // (and nothing to stand on but a stair or a tree beneath: it can't rest there)
    const unsteady = (k: number, i: number, j: number) => k > 0 && (this.stairs.has(key(k - 1, i, j)) || this.trees.has(key(k - 1, i, j)));
    const lay = (k: number, i: number, j: number, s: number) => { if (k < 0 || taken(k, i, j)) return; this.mass.set(key(k, i, j), born + s * 0.05); this.laid.add(key(k, i, j)); if (op.bridge) this.bridged.add(key(k, i, j)); cells.push([k, i, j]); };
    const dirTo = (a: [number, number], b: [number, number]) => DIRS.findIndex(([x, z]) => x === b[0] - a[0] && z === b[1] - a[1]);
    const dz = h1 - h0, steps = Math.abs(dz);
    // (the steps go where the way runs straight, together in flights: the last straight run takes as many as it can,
    // ending where it ends, then the run before it; landings between)
    const straight = straights(c.path, c.to), C = straight.length, step = new Set<number>(), runs: number[][] = [];
    for (const s of straight) { const r = runs[runs.length - 1]; if (r && r[r.length - 1] === s - 1) r.push(s); else runs.push([s]); }
    for (let q = runs.length - 1, left = steps; q >= 0 && left > 0; q--) { const r = runs[q], n = Math.min(left, r.length); for (let t = 0; t < n; t++) step.add(r[r.length - 1 - t]); left -= n; }
    let stopped = steps > C ? 0 : -1;
    let h = h0;
    for (let s = 0; s < along.length && stopped < 0; s++) {
      const [i, j] = along[s], prev = s > 0 ? along[s - 1] : c.path[0];
      if (step.has(s) && dz > 0) {
        if (taken(h, i, j) || unsteady(h, i, j)) { stopped = s; break; }
        this.stairs.set(key(h, i, j), { d: dirTo(prev, [i, j]), born: born + s * 0.05 }); this.laid.add(key(h, i, j)); cells.push([h, i, j]);
        lay(h - 1, i, j, s);
        h++;
      } else if (step.has(s)) {
        if (taken(h - 1, i, j) || unsteady(h - 1, i, j)) { stopped = s; break; }
        h--;
        this.stairs.set(key(h, i, j), { d: dirTo([i, j], prev), born: born + s * 0.05 }); this.laid.add(key(h, i, j)); cells.push([h, i, j]);
        lay(h - 1, i, j, s);
      } else {
        // (a landing, or the walkway: nothing in the way at the height it walks, nor only a stair to stand on)
        if (taken(h, i, j) || unsteady(h, i, j)) { stopped = s; break; }
        lay(h - 1, i, j, s);
      }
    }
    this.reached.set(op, { reached: stopped < 0 && (!c.to || h === h1), stopped, cells });
  }

  private first(id: string, fallback: number) { if (!this.seen.has(id)) this.seen.set(id, Math.max(fallback, this.now)); return this.seen.get(id)!; }

  // ─── what it takes to stand ───
  private resolve() {
    this.piers.clear(); this.spans = []; this.spanOf.clear(); this.under.clear();
    const below = (k: number, i: number, j: number) => k === 0 || this.occupied(k - 1, i, j);
    const raisePier = (k: number, i: number, j: number, born: number) => {
      for (let kk = k - 1; kk >= 0 && !this.occupied(kk, i, j) && !this.under.has(key(kk, i, j)); kk--) this.piers.set(key(kk, i, j), this.first(`p${kk}.${i}.${j}`, born - 0.15));
    };
    for (let k = 1; k < this.levels; k++) {
      // (what's at this level with nothing under it)
      const loose = new Set<number>();
      for (const v of [...this.mass.keys(), ...this.stairs.keys()]) { const [kk, i, j] = unkey(v); if (kk === k && !below(k, i, j)) loose.add(v); }
      // (a stair over nothing stands on a pier; so does stone where the hand asked for one)
      for (const v of [...loose]) if (this.stairs.has(v) || this.rules.get(v) === RULE.pier) { const [, i, j] = unkey(v); raisePier(k, i, j, this.born(k, i, j)); loose.delete(v); }
      const abuts = (i: number, j: number) => (this.stone(k, i, j) || this.stair(k, i, j) >= 0) && !loose.has(key(k, i, j)) && below(k, i, j);
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
  }

  /** an arch under a run of stone: springing as low as the stone each side goes, and the air under it kept clear (or,
   * where the hand asked, a flat lintel) */
  private arch(k: number, a: number, i: number, j: number, n: number, loose: Set<number>) {
    const [di, dj] = DIRS[a];
    const clear = (kk: number) => { for (let s = 0; s < n; s++) if (this.occupied(kk, i + s * di, j + s * dj)) return false; return true; };
    let flat = false;
    for (let s = 0; s < n; s++) if (this.rules.get(key(k, i + s * di, j + s * dj)) === RULE.lintel) flat = true;
    let low = k;
    while (!flat && low > 0 && this.occupied(low - 1, i - di, j - dj) && this.occupied(low - 1, i + n * di, j + n * dj) && clear(low - 1) && low > k + 1 - DECK - n / 2) low--;
    let born = -1e3;
    for (let s = 0; s < n; s++) born = Math.max(born, this.born(k, i + s * di, j + s * dj));
    const sp: Span = { k, a, i, j, n, low, born: this.first(`a${k}.${a}.${i}.${j}.${n}`, born), flat };
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
        const low = Math.max(...row.slice(q, r).map((sp) => sp.low));
        for (const sp of row.slice(q, r)) {
          const [di, dj] = DIRS[sp.a];
          for (let s = 0; s < sp.n; s++) for (let kk = sp.low; kk < low; kk++) this.under.delete(key(kk, sp.i + s * di, sp.j + s * dj));
          sp.low = low;
        }
      }
      q = r;
    }
  }

  /** ground walled in all round: a courtyard, paved, with water and a cypress if there's room */
  private courtyards() {
    this.courts.clear(); this.decor = [];
    // (the ground under a low arch, a passage a level or so high, is a gateway: it closes a court as a wall does; a bridge
    // high over the ground doesn't)
    const gate = (i: number, j: number) => { for (let k = 0; k < this.levels; k++) { const sp = this.span(k, i, j); if (sp) return sp.k <= 1; if (this.occupied(k, i, j)) return false; } return false; };
    // (a pier stands in a court, it doesn't wall it: a cloister's columns)
    const open = (i: number, j: number) => !this.stone(0, i, j) && this.stair(0, i, j) < 0 && !this.under.has(key(0, i, j)) && !gate(i, j);
    const out = new Set<number>(), st: Array<[number, number]> = [];
    for (let t = LO; t <= HI; t++) for (const [i, j] of [[t, LO], [t, HI], [LO, t], [HI, t]]) if (open(i, j) && !out.has(key(0, i, j))) { out.add(key(0, i, j)); st.push([i, j]); }
    while (st.length) { const [i, j] = st.pop()!; for (const [a, b] of DIRS) { const x = i + a, z = j + b; if (inGrid(x, z) && open(x, z) && !out.has(key(0, x, z))) { out.add(key(0, x, z)); st.push([x, z]); } } }
    const seen = new Set<number>();
    for (let j = LO; j <= HI; j++) for (let i = LO; i <= HI; i++) {
      if (!open(i, j) || out.has(key(0, i, j)) || seen.has(key(0, i, j))) continue;
      const region: Array<[number, number]> = [[i, j]], q: Array<[number, number]> = [[i, j]];
      seen.add(key(0, i, j));
      while (q.length) { const [x, z] = q.pop()!; for (const [a, b] of DIRS) { const x2 = x + a, z2 = z + b; if (inGrid(x2, z2) && open(x2, z2) && !out.has(key(0, x2, z2)) && !seen.has(key(0, x2, z2))) { seen.add(key(0, x2, z2)); region.push([x2, z2]); q.push([x2, z2]); } } }
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
      for (const [x, z] of pools) this.decor.push({ kind: 'pool', i: x, j: z, born: this.first(`w${x}.${z}`, when) });
      if (region.length >= TREE_COURT) {
        const corners = region.filter(([x, z]) => !pools.some((p) => p[0] === x && p[1] === z) && DIRS.filter(([a, b]) => !inside.has(key(0, x + a, z + b))).length >= 2);
        if (corners.length) {
          const q = hash(this.seed, id) % corners.length, [x, z] = corners[q];
          this.decor.push({ kind: 'cypress', i: x, j: z, born: this.first(`t${x}.${z}`, when) });
          // (and, as it happens, pots in the other corners)
          for (const [n, [px, pz]] of corners.entries()) if (n !== q && hash(this.seed, px, pz, 77) % 100 < 45) this.decor.push({ kind: 'pot', i: px, j: pz, born: this.first(`o${px}.${pz}`, when) });
        }
      }
    }
  }
  /** the slab: the cells it covers (first and last each way): what's built and MARGIN_CELLS more, at least its start */
  extent() { return this.ext; }
  private ext = { i0: START[0], i1: START[1], j0: START[0], j1: START[1] };
  private measure(): { i0: number; i1: number; j0: number; j1: number } {
    let i0 = START[0], i1 = START[1], j0 = START[0], j1 = START[1];
    for (const m of [this.mass, this.stairs, this.piers, this.trees, this.pools]) for (const v of m.keys()) {
      const [, i, j] = unkey(v);
      i0 = Math.min(i0, i - MARGIN_CELLS); i1 = Math.max(i1, i + MARGIN_CELLS); j0 = Math.min(j0, j - MARGIN_CELLS); j1 = Math.max(j1, j + MARGIN_CELLS);
    }
    return { i0: Math.max(LO, i0), i1: Math.min(HI, i1), j0: Math.max(LO, j0), j1: Math.min(HI, j1) };
  }
  /** a cell on the slab */
  onSlab(i: number, j: number) { const e = this.extent(); return i >= e.i0 && i <= e.i1 && j >= e.j0 && j <= e.j1; }
  /** a pool at a cell of the ground */
  pool(i: number, j: number) { return this.pools.has(key(0, i, j)) || this.decor.some((d) => d.kind === 'pool' && d.i === i && d.j === j); }

  /** the operations, as text (to keep, and to make again: when they were laid isn't kept) */
  encode(): string { return JSON.stringify(this.ops.map((o) => [o.add?.map((c) => c.slice(0, 3)) ?? 0, o.stairs?.map((c) => c.slice(0, 4)) ?? 0, o.cut ?? 0, o.arches?.map((c) => c.slice(0, 4)) ?? 0, o.trees?.map((c) => c.slice(0, 3)) ?? 0, o.pools?.map((c) => c.slice(0, 2)) ?? 0, o.bridge ? 1 : 0, o.connect ? [o.connect.from, o.connect.to, o.connect.path] : 0, o.dress ?? 0, o.rule ?? 0, o.walls?.map((c) => c.slice(0, 4)) ?? 0])); }
}

/** a world made again from its operations (as `encode` wrote them), all laid long ago */
export function replay(text: string, seed = 1): World {
  const w = new World(seed);
  let raw: unknown = [];
  try { raw = JSON.parse(text || '[]'); } catch { raw = []; }
  if (!Array.isArray(raw)) raw = [];
  for (const o of raw as unknown[][]) {
    if (!Array.isArray(o)) continue;
    const at = (q: number) => (Array.isArray(o[q]) ? (o[q] as number[][]) : null);
    w.ops.push({
      add: at(0)?.map((c) => [c[0], c[1], c[2], -100] as [number, number, number, number]), stairs: at(1)?.map((c) => [c[0], c[1], c[2], c[3], -100] as [number, number, number, number, number]), cut: (at(2) as Cell[] | null) ?? undefined,
      connect: Array.isArray(o[7]) ? { from: (o[7] as unknown[])[0] as Cell, to: ((o[7] as unknown[])[1] as Cell | null) ?? null, path: (o[7] as unknown[])[2] as Array<[number, number]> } : undefined, born: -100,
      dress: (at(8) as Op['dress'] | null) ?? undefined, rule: (at(9) as Op['rule'] | null) ?? undefined, walls: at(10)?.map((c) => [c[0], c[1], c[2], c[3], -100] as [number, number, number, number, number]),
      arches: at(3)?.map((c) => [c[0], c[1], c[2], c[3], -100] as [number, number, number, number, number]), trees: at(4)?.map((c) => [c[0], c[1], c[2], -100] as [number, number, number, number]), pools: at(5)?.map((c) => [c[0], c[1], -100] as [number, number, number]), bridge: o[6] === 1,
    });
  }
  w.rebuild(-100);
  return w;
}
