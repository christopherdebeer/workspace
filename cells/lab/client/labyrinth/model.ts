/**
 * The labyrinth, piece by piece: a travertine stone, a grid of cells on it (N across, one unit each, one unit high, up
 * to LEVELS high), and what's been built there, one piece at a touch.
 *
 * - **block**: a cube of stone. On the stone, or on stone.
 * - **arch**: a block with an arched way through it, along x or z; an arch on an arch the same way makes one tall arch.
 * - **stair**: a flight up one level, toward a side (it lands on whatever's there: best, a block's top).
 * - **bridge**: across a gap at a level, between two pieces of stone either side of it: a deck on one arch, the whole
 *   gap wide. Made at one touch, the whole span.
 * - **cypress**: a tree, on a floor (the stone, or the top of something).
 * - **pool**: water let into the stone.
 *
 * Every piece stands on something: the stone, or the top of a block, an arch, a bridge's deck. Each is an action, kept
 * in order, so it can be undone, kept, and made again (`replay`). What may be built where is here; what it looks like is
 * mesh.ts's.
 */
export const N = 12, LEVELS = 8;
/** a level's height (a cell's width is 1) */
export const H = 1;
/** a bridge's deck: how thick it is over its arch's crown */
export const DECK = 0.24;
export const DIRS: ReadonlyArray<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export type Kind = 'block' | 'arch' | 'stair' | 'bridge' | 'cypress' | 'pool';
/** one piece, as it was put down: where, which way (an arch's or a bridge's axis, 0 x or 1 z; a stair's DIRS index),
 * a bridge's length, and when */
export interface Piece { kind: Kind; k: number; i: number; j: number; a: number; n: number; born: number; id: number;
  /** a bridge's arch: the level it springs from (as low as stone goes on both sides, when it's built); the air under
   * it is the bridge's too, so nothing's built through it */
  low?: number }
/** what a cell holds: the piece, and (a bridge's) which of its cells */
interface Cell { p: Piece; at: number }

export const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N;
const key = (k: number, i: number, j: number) => (k * N + j) * N + i;

export class Labyrinth {
  pieces: Piece[] = [];
  private cells = new Map<number, Cell>();
  /** the ground's pools, by cell */
  private pools = new Set<number>();
  version = 0;
  private nextId = 1;
  constructor(public seed = 1) {}

  at(k: number, i: number, j: number): Cell | undefined { return k < 0 || k >= LEVELS || !inGrid(i, j) ? undefined : this.cells.get(key(k, i, j)); }
  kindAt(k: number, i: number, j: number): Kind | null { return this.at(k, i, j)?.p.kind ?? null; }
  pool(i: number, j: number) { return this.pools.has(key(0, i, j)); }
  /** stone a thing can stand on or against: a block or an arch */
  solid(k: number, i: number, j: number) { const c = this.kindAt(k, i, j); return c === 'block' || c === 'arch'; }
  /** something to stand on at the foot of level k: the stone (not a pool), or the top of a block, an arch, a bridge */
  floor(k: number, i: number, j: number): boolean {
    if (!inGrid(i, j)) return false;
    if (k === 0) return !this.pool(i, j);
    const c = this.at(k - 1, i, j);
    return !!c && (c.p.kind === 'block' || c.p.kind === 'arch' || (c.p.kind === 'bridge' && c.at >= 0));
  }
  free(k: number, i: number, j: number) { return k >= 0 && k < LEVELS && inGrid(i, j) && !this.cells.has(key(k, i, j)) && !(k === 0 && this.pool(i, j)); }
  /** the highest level anything reaches */
  top(): number { let t = 0; for (const p of this.pieces) t = Math.max(t, p.k + (p.kind === 'cypress' ? 2 : 1)); return t; }

  // ─── what may go where ───
  /** a bridge across level k through a cell: along an axis, the cells free between stone either side, if there's stone
   * both sides within reach (the shorter way, if both axes span it); its first cell and length */
  span(k: number, i: number, j: number, only?: number): { a: number; i: number; j: number; n: number } | null {
    let best: { a: number; i: number; j: number; n: number } | null = null;
    if (!this.free(k, i, j)) return null;
    for (const a of only === undefined ? [0, 1] : [only]) {
      const [di, dj] = DIRS[a];
      let lo = 0, hi = 0;
      while (lo < 7 && this.free(k, i - (lo + 1) * di, j - (lo + 1) * dj)) lo++;
      while (hi < 7 && this.free(k, i + (hi + 1) * di, j + (hi + 1) * dj)) hi++;
      const n = lo + hi + 1;
      if (!this.solid(k, i - (lo + 1) * di, j - (lo + 1) * dj) || !this.solid(k, i + (hi + 1) * di, j + (hi + 1) * dj) || n > 7) continue;
      if (!best || n < best.n) best = { a, i: i - lo * di, j: j - lo * dj, n };
    }
    return best;
  }
  /** can a piece go here (as it'd be put down) */
  can(kind: Kind, k: number, i: number, j: number, a = 0, n = 1): boolean {
    if (kind === 'pool') return k === 0 && inGrid(i, j) && !this.pool(i, j) && !this.cells.has(key(0, i, j));
    if (kind === 'bridge') {
      const [di, dj] = DIRS[a];
      for (let s = 0; s < n; s++) if (!this.free(k, i + s * di, j + s * dj)) return false;
      return this.solid(k, i - di, j - dj) && this.solid(k, i + n * di, j + n * dj);
    }
    if (!this.free(k, i, j) || !this.floor(k, i, j)) return false;
    if (kind === 'cypress') return this.free(k + 1, i, j) || k + 1 >= LEVELS;
    return true;
  }
  /** put a piece down, if it can go there; it's built `now` */
  place(kind: Kind, k: number, i: number, j: number, a = 0, n = 1, now = 0): Piece | null {
    if (!this.can(kind, k, i, j, a, n)) return null;
    const p: Piece = { kind, k, i, j, a, n: kind === 'bridge' ? n : 1, born: now, id: this.nextId++ };
    if (kind === 'bridge') {
      const [di, dj] = DIRS[a];
      let low = k;
      const clear = (kk: number) => { for (let s = 0; s < n; s++) if (!this.free(kk, i + s * di, j + s * dj)) return false; return true; };
      while (low > 0 && this.solid(low - 1, i - di, j - dj) && this.solid(low - 1, i + n * di, j + n * dj) && clear(low - 1) && low > k + 1 - DECK - n / 2) low--;
      p.low = low;
    }
    this.pieces.push(p);
    this.occupy(p);
    this.version++;
    return p;
  }
  private occupy(p: Piece) {
    if (p.kind === 'pool') { this.pools.add(key(0, p.i, p.j)); return; }
    if (p.kind === 'bridge') {
      const [di, dj] = DIRS[p.a];
      for (let s = 0; s < p.n; s++) for (let kk = p.low ?? p.k; kk <= p.k; kk++) this.cells.set(key(kk, p.i + s * di, p.j + s * dj), { p, at: kk === p.k ? s : -1 });
      return;
    }
    this.cells.set(key(p.k, p.i, p.j), { p, at: 0 });
    if (p.kind === 'cypress' && p.k + 1 < LEVELS) this.cells.set(key(p.k + 1, p.i, p.j), { p, at: 1 });
  }
  private vacate(p: Piece) {
    if (p.kind === 'pool') { this.pools.delete(key(0, p.i, p.j)); return; }
    for (const [kk, c] of [...this.cells]) if (c.p === p) this.cells.delete(kk);
  }
  /** whether anything rests on a piece (and so would fall if it went) */
  carries(p: Piece): boolean {
    const cells = p.kind === 'bridge' ? Array.from({ length: p.n }, (_, s) => [p.i + s * DIRS[p.a][0], p.j + s * DIRS[p.a][1]]) : p.kind === 'pool' ? [] : [[p.i, p.j]];
    for (const [i, j] of cells) { const up = this.at(p.k + 1, i, j); if (up && up.p !== p) return true; }
    // (a bridge resting against it)
    if (p.kind === 'block' || p.kind === 'arch') for (const q of this.pieces) if (q.kind === 'bridge' && q.k === p.k) {
      const [di, dj] = DIRS[q.a];
      if ((q.i - di === p.i && q.j - dj === p.j) || (q.i + q.n * di === p.i && q.j + q.n * dj === p.j)) return true;
    }
    return false;
  }
  /** take a piece away (if nothing rests on it) */
  remove(p: Piece): boolean {
    if (this.carries(p)) return false;
    this.vacate(p);
    this.pieces = this.pieces.filter((q) => q !== p);
    this.version++;
    return true;
  }
  undo(): Piece | null { const p = this.pieces[this.pieces.length - 1]; if (!p) return null; this.vacate(p); this.pieces.pop(); this.version++; return p; }
  /** the piece a cell holds (a pool's, at the ground) */
  pieceAt(k: number, i: number, j: number): Piece | null { return this.at(k, i, j)?.p ?? (k === 0 && this.pool(i, j) ? this.pieces.find((p) => p.kind === 'pool' && p.i === i && p.j === j) ?? null : null); }

  /** as text, to keep and to make again: `kind.k.i.j.a.n` each, comma between */
  encode(): string { return this.pieces.map((p) => `${CODES[p.kind]}.${p.k}.${p.i}.${p.j}.${p.a}.${p.n}`).join(','); }
}

const CODES: Record<Kind, string> = { block: 'b', arch: 'a', stair: 's', bridge: 'br', cypress: 'cy', pool: 'p' };
const KINDS = Object.fromEntries(Object.entries(CODES).map(([k, v]) => [v, k])) as Record<string, Kind>;
/** a labyrinth made again from its pieces, as `encode` wrote them (built long ago: grown) */
export function replay(text: string, seed = 1): Labyrinth {
  const m = new Labyrinth(seed);
  for (const t of text.split(',').filter(Boolean)) {
    const [h, k, i, j, a, n] = t.split('.');
    const kind = KINDS[h];
    if (kind) m.place(kind, +k, +i, +j, +a || 0, +n || 1, -100);
  }
  return m;
}

/**
 * What a touch builds, given what it touched: `hit` the cell it struck (k = −1: the stone), `to` the free cell on the
 * touched face's side, and the piece in hand. 'auto' reads the place: the stone takes a block; a block's top, a block on
 * it; a block's side, a stair up onto it where there's a floor, or a bridge out from it where there isn't.
 * `view` is the way the eye looks (a DIRS index), for a stair or an arch with nothing else to go by.
 */
export function decide(m: Labyrinth, hand: Kind | 'auto', hit: [number, number, number], to: [number, number, number], view: number): { kind: Kind; k: number; i: number; j: number; a: number; n: number } | null {
  const [hk, hi, hj] = hit, [k, i, j] = to;
  const side = hk === k && (hi !== i || hj !== j);
  const toward = side ? DIRS.findIndex(([a, b]) => a === hi - i && b === hj - j) : -1;
  // (a stair climbs toward the stone it's against; failing that, onto a neighbour's top; failing that, away from the eye)
  const stairDir = () => {
    if (toward >= 0) return toward;
    for (let d = 0; d < 4; d++) if (m.solid(k, i + DIRS[d][0], j + DIRS[d][1]) && m.free(k + 1, i + DIRS[d][0], j + DIRS[d][1])) return d;
    return view;
  };
  // (an arch's way through runs where it's open either side: an arch on an arch keeps its way)
  const archAxis = () => {
    const below = m.at(k - 1, i, j)?.p;
    if (below?.kind === 'arch') return below.a;
    const open = (a: number) => [1, -1].every((s) => !m.solid(k, i + s * DIRS[a][0], j + s * DIRS[a][1]));
    const want = side ? toward % 2 : view % 2;
    return open(want) ? want : 1 - want;
  };
  const bridge = () => { const s = (side ? m.span(k, i, j, toward % 2) : null) ?? m.span(k, i, j); return s ? { kind: 'bridge' as Kind, k, i: s.i, j: s.j, a: s.a, n: s.n } : null; };
  const one = (kind: Kind, a = 0) => (m.can(kind, k, i, j, a) ? { kind, k, i, j, a, n: 1 } : null);
  if (hand === 'pool') return hk < 0 ? one('pool') : null;
  if (hand === 'bridge') return bridge();
  if (hand === 'stair') return one('stair', stairDir());
  if (hand === 'arch') return one('arch', archAxis());
  if (hand === 'block' || hand === 'cypress') return one(hand);
  // (auto)
  if (side) {
    if (m.floor(k, i, j)) return (m.free(k + 1, hi, hj) ? one('stair', toward) : null) ?? one('block');
    return bridge();
  }
  return one('block');
}
