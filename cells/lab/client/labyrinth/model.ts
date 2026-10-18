/**
 * The labyrinth, as stone: a square of voxels (N across, one unit each), in levels (each H high), on a flat stone.
 *
 * Each level is a block maze: its rooms one voxel, its walls one voxel thick, posts at the walls' crossings. A level's
 * rooms and posts change places from the level below (its grid is offset by a voxel each way), so:
 *
 * - a room sits on a post below: it has a floor;
 * - a post stands over a room below, on a cross vault springing from that room's four corner posts;
 * - a wall or a passage over a wall below sits on it; over a passage below, the passage is spanned by an arch (a barrel
 *   vault between the posts either side), and what's above stands on that: a wall on an arch, or a walkway over one.
 *
 * So every open voxel with anything built over it is vaulted, and the lower labyrinth runs on under the upper. Each level
 * is a perfect maze (one way between any two of its rooms): a touch adds rooms round it, joined into the level's maze by
 * a randomised Kruskal, with one gate into each part of the level it meets. A level above the first gets a gate out
 * onto the wall tops of the one below; and dead ends nothing's built over may have a stair, climbing onto the wall at
 * the end: the tops of the walls are walkways too.
 */
import { seeded, hash, type Rand } from '../kit/rng';

/** rooms each way, voxels each way (2n + 1), the most levels */
export const ROOMS = 8, N = 2 * ROOMS + 1, LEVELS = 7;
/** a level's height (a voxel's width is 1) */
export const H = 1.25;

/** what a voxel is, at a level: not built, stone, open (a room, a passage: a floor, and maybe a stair; see `stair`),
 * or a pier (stone, standing alone: one of the columns a bridge stands on, not part of this level's maze) */
export const EMPTY = 0, SOLID = 1, OPEN = 2, PIER = 3;
/** the four ways, as voxel steps: +x, +z, −x, −z */
export const DIRS: ReadonlyArray<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export interface Level {
  kind: Uint8Array;
  /** when each voxel was built (s) */
  born: Float32Array;
}

/** a room of level k? (k even: both odd; k odd: both even) */
export const isRoom = (k: number, i: number, j: number) => (k % 2 === 0 ? (i & 1) === 1 && (j & 1) === 1 : (i & 1) === 0 && (j & 1) === 0);
/** a post of level k: the rooms of the level above and below */
export const isPost = (k: number, i: number, j: number) => isRoom(k + 1, i, j);
export const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N;
const at = (i: number, j: number) => i + j * N;

export class Labyrinth {
  levels: Level[] = [];
  /** every touch so far, as the column touched (for the address, and to make it again) */
  taps: Array<[number, number]> = [];
  /** goes up with every change, for whoever draws it */
  version = 0;
  constructor(public seed: number) {
    for (let k = 0; k < LEVELS; k++) this.levels.push({ kind: new Uint8Array(N * N), born: new Float32Array(N * N) });
  }
  kind(k: number, i: number, j: number): number { return k < 0 || k >= LEVELS || !inGrid(i, j) ? EMPTY : this.levels[k].kind[at(i, j)]; }
  born(k: number, i: number, j: number): number { return this.levels[k].born[at(i, j)]; }
  solid(k: number, i: number, j: number) { const c = this.kind(k, i, j); return c === SOLID || c === PIER; }
  built(k: number, i: number, j: number) { return this.kind(k, i, j) !== EMPTY; }
  /** an open voxel carrying what's built over it: an arch, a vault */
  vaulted(k: number, i: number, j: number) { return this.kind(k, i, j) === OPEN && this.built(k + 1, i, j); }
  /** nothing here, but a bridge over it: an arch from pier to pier, the open air beneath */
  arched(k: number, i: number, j: number) { return this.kind(k, i, j) === EMPTY && k + 1 < LEVELS && this.kind(k + 1, i, j) !== EMPTY && this.kind(k + 1, i, j) !== PIER; }
  /** a ceiling here: a vault over a room or passage, or a bridge's arch */
  ceiled(k: number, i: number, j: number) { return this.vaulted(k, i, j) || this.arched(k, i, j); }
  /**
   * A stair, if a room has one: which way it climbs (an index into DIRS), or −1. Not every dead end has one, but about
   * half of those with nothing built over them do, climbing onto the wall at the end: the walls' tops are walkways. Build
   * over it, or open the wall at its end, and it's gone.
   */
  stair(k: number, i: number, j: number): number {
    if (!isRoom(k, i, j) || this.kind(k, i, j) !== OPEN || this.built(k + 1, i, j)) return -1;
    let open = -1;
    for (let d = 0; d < 4; d++) if (this.kind(k, i + DIRS[d][0], j + DIRS[d][1]) === OPEN) { if (open >= 0) return -1; open = d; }
    if (open < 0) return -1;
    const d = (open + 2) % 4;
    if (!this.solid(k, i + DIRS[d][0], j + DIRS[d][1]) || (hash(this.seed, k, i, j, 31) & 1023) > 520) return -1;
    return d;
  }
  /** how many levels stand on a column */
  height(i: number, j: number): number { let k = 0; while (k < LEVELS && this.built(k, i, j)) k++; return k; }
  /** the highest level built anywhere */
  top(): number { let t = 0; for (let k = 0; k < LEVELS; k++) if (this.levels[k].kind.some((c) => c !== EMPTY)) t = k + 1; return t; }

  /**
   * A touch on a column: the stone raised round it a level, as a stepped mound. The next level up from the column's own
   * is built round it, and every level below it spreads a little wider than the one above, so there's something for it
   * to stand on. `now` is when (for the stone's rising), `spread` how far round the top level reaches (in voxels; a
   * touch's own when not given). Returns how many rooms it made.
   */
  touch(ci: number, cj: number, now = 0, spread?: number): number {
    const top = this.height(ci, cj);
    if (top >= LEVELS) return 0;
    const rnd = seeded(hash(this.seed, this.taps.length, ci, cj, 77));
    const R = spread ?? 3.4 + rnd() * 2;
    let made = 0;
    // (the ground level a broad labyrinth; above it, a core over the touch (wider the lower it is, so the one above has
    // something to stand on) and arms out from it: walled walkways on arches, over the labyrinth below)
    for (let L = 0; L <= top; L++) {
      const shape = L === 0 ? { core: R + top * 2.1, arms: 0 } : { core: 1.5 + (top - L) * 2.1, arms: L === top ? 3 : 2 };
      made += this.grow(L, ci, cj, shape.core, shape.arms, now + L * 0.35, rnd);
    }
    if (made) { this.taps.push([ci, cj]); this.version++; }
    return made;
  }
  /** can a room of level L stand here: all round it (the room, its walls, its posts) on what's below */
  private stands(L: number, i: number, j: number): boolean {
    if (i < 1 || j < 1 || i > N - 2 || j > N - 2 || !isRoom(L, i, j)) return false;
    if (L === 0) return true;
    const below = this.levels[L - 1].kind;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (below[at(i + di, j + dj)] === EMPTY) return false;
    return true;
  }
  /** could a pier rise to level L−1 at a column: down through nothing to the stone, or to stone to stand on */
  private pierable(L: number, i: number, j: number): boolean {
    let k = L - 1;
    while (k >= 0 && this.kind(k, i, j) === EMPTY) k--;
    return k < 0 || this.solid(k, i, j);
  }
  /**
   * Can a room of level L stand here as a bridge, where some of what's under it is open air: on piers at its posts (to
   * the stone, or to stone below), and arches between them. Each post of it over nothing must have a pier to stand on;
   * each wall or floor over nothing, posts either side of it that are stone or piers (not an open room's floor).
   */
  private bridges(L: number, i: number, j: number): boolean {
    if (L === 0 || i < 1 || j < 1 || i > N - 2 || j > N - 2 || !isRoom(L, i, j)) return false;
    const below = (a: number, b: number) => this.kind(L - 1, a, b);
    const postOk = (a: number, b: number) => (below(a, b) === EMPTY ? this.pierable(L, a, b) : this.solid(L - 1, a, b));
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      // (a post over a room below stands on that room's vault, as any post does; over nothing, on a pier)
      if (isPost(L, a, b)) { if (below(a, b) === EMPTY && !this.pierable(L, a, b)) return false; continue; }
      if (below(a, b) !== EMPTY) continue;
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (inGrid(a + x, b + z) && isPost(L, a + x, b + z) && Math.abs(a + x - i) <= 1 && Math.abs(b + z - j) <= 1 && !postOk(a + x, b + z)) return false;
    }
    return true;
  }
  /** a bridge's piers: stone up from what it stands on, at its posts over nothing */
  private raisePiers(L: number, i: number, j: number, born: number) {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (!isPost(L, a, b)) continue;
      for (let k = L - 1; k >= 0 && this.kind(k, a, b) === EMPTY; k--) { this.levels[k].kind[at(a, b)] = PIER; this.levels[k].born[at(a, b)] = born; }
    }
  }
  /** one level spread round a column: every room it can have within `core` voxels, and `arms` walkways reaching out */
  private grow(L: number, ci: number, cj: number, core: number, arms: number, now: number, rnd: () => number): number {
    const lev = this.levels[L], below = L > 0 ? this.levels[L - 1] : null;
    const fresh: number[] = [], chosen = new Set<number>();
    const bridged = new Set<number>();
    const take = (i: number, j: number, bridge = false) => {
      const v = at(i, j);
      if (chosen.has(v) || !inGrid(i, j) || lev.kind[v] !== EMPTY) return false;
      if (!this.stands(L, i, j)) { if (!bridge || !this.bridges(L, i, j)) return false; bridged.add(v); }
      chosen.add(v); fresh.push(v); return true;
    };
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) if (Math.hypot(i - ci, j - cj) <= core + 0.01) take(i, j);
    // (each arm a walk from the core, room by room, mostly straight on, as far as there's stone under it to stand on)
    const starts = fresh.length ? fresh.slice() : [];
    if (!starts.length) { for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) if (isRoom(L, i, j) && lev.kind[at(i, j)] !== EMPTY && Math.hypot(i - ci, j - cj) <= core + 2.1) starts.push(at(i, j)); }
    for (let a = 0; a < arms && starts.length; a++) {
      const s0 = starts[Math.floor(rnd() * starts.length)];
      let i = s0 % N, j = (s0 / N) | 0, d = Math.floor(rnd() * 4);
      const len = 2 + Math.floor(rnd() * 4);
      for (let step = 0; step < len; step++) {
        if (rnd() < 0.3) d = (d + (rnd() < 0.5 ? 1 : 3)) % 4;
        const [di, dj] = DIRS[d], ni = i + 2 * di, nj = j + 2 * dj;
        if (!inGrid(ni, nj)) break;
        // (an arm may go on as a bridge, over open air)
        if (!take(ni, nj, true) && lev.kind[at(ni, nj)] === EMPTY) break;
        i = ni; j = nj;
      }
    }
    if (!fresh.length) return 0;
    // (rising in a ripple out from the touch)
    const when = (i: number, j: number) => now + Math.hypot(i - ci, j - cj) * 0.07;
    const isFresh = new Set(fresh);
    for (const r of bridged) this.raisePiers(L, r % N, (r / N) | 0, when(r % N, (r / N) | 0) - 0.25);
    for (const r of fresh) {
      const i = r % N, j = (r / N) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const v = at(i + di, j + dj);
        if (lev.kind[v] !== EMPTY) continue;
        lev.kind[v] = di === 0 && dj === 0 ? OPEN : SOLID;
        lev.born[v] = when(i + di, j + dj);
      }
    }
    // (the level's maze: what's already open joined up as it is, then walls opened at random between rooms not yet joined)
    const parent = new Map<number, number>();
    const find = (a: number): number => { let p = parent.get(a) ?? a; if (p !== a) { p = find(p); parent.set(a, p); } return p; };
    const union = (a: number, b: number) => { const x = find(a), y = find(b); if (x === y) return false; parent.set(x, y); return true; };
    // (an old gate out of the level the new rooms land on is a join already)
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      if (!isRoom(L, i, j) || lev.kind[at(i, j)] === EMPTY) continue;
      for (const [di, dj] of [[1, 0], [0, 1]]) if (lev.kind[at(i + di, j + dj)] === OPEN && inGrid(i + 2 * di, j + 2 * dj)) union(at(i, j), at(i + 2 * di, j + 2 * dj));
    }
    const walls: Array<[number, number, number]> = [];
    for (const r of fresh) {
      const i = r % N, j = (r / N) | 0;
      for (const [di, dj] of DIRS) {
        const i2 = i + 2 * di, j2 = j + 2 * dj;
        if (!inGrid(i2, j2) || lev.kind[at(i2, j2)] === EMPTY) continue;
        const e = at(i + di, j + dj);
        // (a wall something's already built on stays a wall)
        if (lev.kind[e] !== SOLID || (L + 1 < LEVELS && this.levels[L + 1].kind[e] !== EMPTY)) continue;
        if (isFresh.has(at(i2, j2)) && at(i2, j2) < r) continue;
        walls.push([e, r, at(i2, j2)]);
      }
    }
    for (let k = walls.length - 1; k > 0; k--) { const m = Math.floor(rnd() * (k + 1)); [walls[k], walls[m]] = [walls[m], walls[k]]; }
    for (const [e, a, b] of walls) if (union(a, b)) { lev.kind[e] = OPEN; lev.born[e] = Math.max(lev.born[e], now); }
    // (above the first: a gate out of it onto the tops of the walls below, where they're not built over)
    if (L > 0) {
      const gates: number[] = [];
      for (const r of fresh) {
        const i = r % N, j = (r / N) | 0;
        for (const [di, dj] of DIRS) {
          const e = at(i + di, j + dj), oi = i + 2 * di, oj = j + 2 * dj;
          if (!inGrid(oi, oj) || lev.kind[at(oi, oj)] !== EMPTY || lev.kind[e] !== SOLID) continue;
          if (L + 1 < LEVELS && this.levels[L + 1].kind[e] !== EMPTY) continue;
          if (below!.kind[at(oi, oj)] !== SOLID) continue;
          // (and not where another gate already leads: when that's built on, it'd make a loop)
          if (DIRS.some(([a2, b2]) => inGrid(oi + a2, oj + b2) && lev.kind[at(oi + a2, oj + b2)] === OPEN)) continue;
          gates.push(e);
        }
      }
      if (gates.length) { const e = gates[Math.floor(rnd() * gates.length)]; lev.kind[e] = OPEN; }
    }
    return fresh.length;
  }
}

/** a labyrinth made again from its seed and its touches */
export function replay(seed: number, taps: Array<[number, number]>): Labyrinth {
  const m = new Labyrinth(seed);
  for (const [i, j] of taps) m.touch(i, j, -100);
  return m;
}
export type { Rand };
