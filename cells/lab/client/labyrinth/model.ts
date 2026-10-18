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
 * The grid is N × N cells on a stone slab, each 1 across and 1 high, LEVELS high.
 */
import { hash } from '../kit/rng';

export const N = 12, LEVELS = 8;
/** a span's deck: how thick the stone is over its arch's crown */
export const DECK = 0.24;
export const DIRS: ReadonlyArray<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** a cell: its level, then i (x) and j (z) */
export type Cell = [number, number, number];
/** an operation: stone added (and when each was laid), stairs added (which way each climbs, a DIRS index), stone cut */
export interface Op { add?: Array<[number, number, number, number]>; stairs?: Array<[number, number, number, number, number]>; cut?: Cell[]; why?: string }
/** an arch, carrying a run of stone along an axis (0 x, 1 z): its level, first cell, length, and the level it springs from */
export interface Span { k: number; a: number; i: number; j: number; n: number; low: number; born: number }
export interface Decor { kind: 'pool' | 'cypress'; i: number; j: number; born: number }

export const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N;
export const key = (k: number, i: number, j: number) => (k * N + j) * N + i;
const unkey = (v: number): Cell => [Math.floor(v / (N * N)), v % N, Math.floor(v / N) % N];

export class World {
  ops: Op[] = [];
  version = 0;
  /** the intended solid: stone (when laid), and stairs (which way, when) */
  mass = new Map<number, number>();
  stairs = new Map<number, { d: number; born: number }>();
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
  occupied(k: number, i: number, j: number) { return k >= 0 && k < LEVELS && inGrid(i, j) && (this.mass.has(key(k, i, j)) || this.stairs.has(key(k, i, j)) || this.piers.has(key(k, i, j))); }
  /** the air under an arch */
  arched(k: number, i: number, j: number) { return this.under.has(key(k, i, j)); }
  /** a plain block: stone not carried on an arch */
  block(k: number, i: number, j: number) { return this.stone(k, i, j) && !this.span(k, i, j); }
  /** how high a column's stone (or stair) goes, up from a level, without a gap */
  topFrom(k: number, i: number, j: number) { while (k + 1 < LEVELS && (this.stone(k + 1, i, j) || this.stair(k + 1, i, j) >= 0)) k++; return k + 1; }
  /** the highest anything reaches */
  top() { let t = 0; for (const v of [...this.mass.keys(), ...this.stairs.keys()]) t = Math.max(t, unkey(v)[0] + 1); return t + (this.decor.some((d) => d.kind === 'cypress') ? 1 : 0); }
  born(k: number, i: number, j: number) { return this.mass.get(key(k, i, j)) ?? this.stairs.get(key(k, i, j))?.born ?? this.piers.get(key(k, i, j)) ?? -1e3; }

  // ─── what the hand did ───
  apply(op: Op, now = 0) { this.ops.push(op); this.rebuild(now); }
  /** put the last operation as it now is (a trace still under the finger) */
  replaceLast(op: Op, now = 0) { this.ops[this.ops.length - 1] = op; this.rebuild(now); }
  undo(now = 0): Op | null { const op = this.ops.pop() ?? null; if (op) this.rebuild(now); return op; }
  clear() { this.ops = []; this.seen.clear(); this.rebuild(0); }

  /** the operations replayed into the intended solid, and that resolved */
  rebuild(now = 0) {
    this.now = now;
    this.mass.clear(); this.stairs.clear();
    for (const op of this.ops) {
      for (const [k, i, j] of op.cut ?? []) { this.mass.delete(key(k, i, j)); this.stairs.delete(key(k, i, j)); }
      for (const [k, i, j, b] of op.add ?? []) if (k >= 0 && k < LEVELS && inGrid(i, j) && !this.stairs.has(key(k, i, j))) this.mass.set(key(k, i, j), this.mass.get(key(k, i, j)) ?? b);
      for (const [k, i, j, d, b] of op.stairs ?? []) if (k >= 0 && k < LEVELS && inGrid(i, j)) { this.mass.delete(key(k, i, j)); this.stairs.set(key(k, i, j), { d, born: b }); }
    }
    this.resolve();
    this.version++;
  }

  private first(id: string, fallback: number) { if (!this.seen.has(id)) this.seen.set(id, Math.max(fallback, this.now)); return this.seen.get(id)!; }

  // ─── what it takes to stand ───
  private resolve() {
    this.piers.clear(); this.spans = []; this.spanOf.clear(); this.under.clear();
    const below = (k: number, i: number, j: number) => k === 0 || this.occupied(k - 1, i, j);
    const raisePier = (k: number, i: number, j: number, born: number) => {
      for (let kk = k - 1; kk >= 0 && !this.occupied(kk, i, j) && !this.under.has(key(kk, i, j)); kk--) this.piers.set(key(kk, i, j), this.first(`p${kk}.${i}.${j}`, born - 0.15));
    };
    for (let k = 1; k < LEVELS; k++) {
      // (what's at this level with nothing under it)
      const loose = new Set<number>();
      for (const v of [...this.mass.keys(), ...this.stairs.keys()]) { const [kk, i, j] = unkey(v); if (kk === k && !below(k, i, j)) loose.add(v); }
      // (a stair over nothing stands on a pier)
      for (const v of [...loose]) if (this.stairs.has(v)) { const [, i, j] = unkey(v); raisePier(k, i, j, this.born(k, i, j)); loose.delete(v); }
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
        for (const v of loose) { const [, i, j] = unkey(v); for (const a of [0, 1]) { const r = run(i, j, a); if (r.startBound && r.endBound && r.n <= 3 && (!best || r.n < best.n)) best = r; } }
        if (best) { this.arch(k, best.a, best.s[0], best.s[1], best.n, loose); continue; }
        // (else a pier: at a free end, or three cells into a long run, so arches can span the rest)
        let at: [number, number] | null = null;
        for (const v of loose) {
          const [, i, j] = unkey(v);
          for (const a of [0, 1]) {
            const r = run(i, j, a), [di, dj] = DIRS[a];
            if (!r.startBound && r.n >= 1) { at = r.s; break; }
            if (!r.endBound) { at = [r.s[0] + (r.n - 1) * di, r.s[1] + (r.n - 1) * dj]; break; }
            if (r.n > 3) { at = [r.s[0] + 3 * di, r.s[1] + 3 * dj]; break; }
          }
          if (at) break;
        }
        if (!at) { const [, i, j] = unkey(loose.values().next().value!); at = [i, j]; }
        raisePier(k, at[0], at[1], this.born(k, at[0], at[1]));
        loose.delete(key(k, at[0], at[1]));
      }
    }
    this.courtyards();
  }

  /** an arch under a run of stone: springing as low as the stone each side goes, and the air under it kept clear */
  private arch(k: number, a: number, i: number, j: number, n: number, loose: Set<number>) {
    const [di, dj] = DIRS[a];
    const clear = (kk: number) => { for (let s = 0; s < n; s++) if (this.occupied(kk, i + s * di, j + s * dj)) return false; return true; };
    let low = k;
    while (low > 0 && this.occupied(low - 1, i - di, j - dj) && this.occupied(low - 1, i + n * di, j + n * dj) && clear(low - 1) && low > k + 1 - DECK - n / 2) low--;
    let born = -1e3;
    for (let s = 0; s < n; s++) born = Math.max(born, this.born(k, i + s * di, j + s * dj));
    const sp: Span = { k, a, i, j, n, low, born: this.first(`a${k}.${a}.${i}.${j}.${n}`, born) };
    this.spans.push(sp);
    for (let s = 0; s < n; s++) {
      const v = key(k, i + s * di, j + s * dj);
      this.spanOf.set(v, sp); loose.delete(v);
      for (let kk = low; kk < k; kk++) this.under.add(key(kk, i + s * di, j + s * dj));
    }
  }

  /** ground walled in all round: a courtyard, paved, with water and a cypress if there's room */
  private courtyards() {
    this.courts.clear(); this.decor = [];
    // (the ground under an arch is a gateway: it closes a court as a wall does)
    const gate = (i: number, j: number) => { for (let k = 0; k < LEVELS; k++) { if (this.span(k, i, j)) return true; if (this.occupied(k, i, j)) return false; } return false; };
    const open = (i: number, j: number) => !this.occupied(0, i, j) && !this.under.has(key(0, i, j)) && !gate(i, j);
    const out = new Set<number>(), st: Array<[number, number]> = [];
    for (let t = 0; t < N; t++) for (const [i, j] of [[t, 0], [t, N - 1], [0, t], [N - 1, t]]) if (open(i, j) && !out.has(key(0, i, j))) { out.add(key(0, i, j)); st.push([i, j]); }
    while (st.length) { const [i, j] = st.pop()!; for (const [a, b] of DIRS) { const x = i + a, z = j + b; if (inGrid(x, z) && open(x, z) && !out.has(key(0, x, z))) { out.add(key(0, x, z)); st.push([x, z]); } } }
    const seen = new Set<number>();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (!open(i, j) || out.has(key(0, i, j)) || seen.has(key(0, i, j))) continue;
      const region: Array<[number, number]> = [[i, j]], q: Array<[number, number]> = [[i, j]];
      seen.add(key(0, i, j));
      while (q.length) { const [x, z] = q.pop()!; for (const [a, b] of DIRS) { const x2 = x + a, z2 = z + b; if (inGrid(x2, z2) && open(x2, z2) && !out.has(key(0, x2, z2)) && !seen.has(key(0, x2, z2))) { seen.add(key(0, x2, z2)); region.push([x2, z2]); q.push([x2, z2]); } } }
      for (const [x, z] of region) this.courts.add(key(0, x, z));
      // (what grows there: water where it's open on all sides, or at its heart if it's big enough; a cypress in a corner)
      const inside = new Set(region.map(([x, z]) => key(0, x, z)));
      const id = region.map(([x, z]) => key(0, x, z)).sort((p, q2) => p - q2)[0];
      const when = this.first(`c${id}.${region.length}`, -1e3);
      let pools = region.filter(([x, z]) => DIRS.every(([a, b]) => inside.has(key(0, x + a, z + b))));
      if (!pools.length && region.length >= 4) {
        const cx = region.reduce((s, c) => s + c[0], 0) / region.length, cz = region.reduce((s, c) => s + c[1], 0) / region.length;
        pools = [region.reduce((b, c) => (Math.hypot(c[0] - cx, c[1] - cz) < Math.hypot(b[0] - cx, b[1] - cz) ? c : b))];
      }
      for (const [x, z] of pools) this.decor.push({ kind: 'pool', i: x, j: z, born: this.first(`w${x}.${z}`, when) });
      if (region.length >= 3) {
        const corners = region.filter(([x, z]) => !pools.some((p) => p[0] === x && p[1] === z) && DIRS.filter(([a, b]) => !inside.has(key(0, x + a, z + b))).length >= 2);
        if (corners.length) { const [x, z] = corners[hash(this.seed, id) % corners.length]; this.decor.push({ kind: 'cypress', i: x, j: z, born: this.first(`t${x}.${z}`, when) }); }
      }
    }
  }
  /** a pool at a cell of the ground */
  pool(i: number, j: number) { return this.decor.some((d) => d.kind === 'pool' && d.i === i && d.j === j); }

  /** the operations, as text (to keep, and to make again: when they were laid isn't kept) */
  encode(): string { return JSON.stringify(this.ops.map((o) => [o.add?.map((c) => c.slice(0, 3)) ?? 0, o.stairs?.map((c) => c.slice(0, 4)) ?? 0, o.cut ?? 0])); }
}

/** a world made again from its operations (as `encode` wrote them), all laid long ago */
export function replay(text: string, seed = 1): World {
  const w = new World(seed);
  let raw: unknown = [];
  try { raw = JSON.parse(text || '[]'); } catch { raw = []; }
  if (!Array.isArray(raw)) raw = [];
  for (const o of raw as Array<[Cell[] | 0, Array<[number, number, number, number]> | 0, Cell[] | 0]>) {
    if (!Array.isArray(o)) continue;
    w.ops.push({ add: o[0] ? o[0].map((c) => [c[0], c[1], c[2], -100] as [number, number, number, number]) : undefined, stairs: o[1] ? o[1].map((c) => [c[0], c[1], c[2], c[3], -100] as [number, number, number, number, number]) : undefined, cut: o[2] || undefined });
  }
  w.rebuild(-100);
  return w;
}
