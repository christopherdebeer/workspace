/**
 * What a block is, read from what's round it: the cells two each way (124 of them). No block is given a part to play
 * and no form has a name. A block is read as a few plain quantities over its neighbourhood, and its shape (shape.ts)
 * and its carving (render.ts) are made from those alone:
 * - **joins**: which of its faces meet stone;
 * - **softness**: how little stone there is round it (alone, soft; deep in a mass, crisp);
 * - **openness**, face by face: open, sheltered (stone two out), or closed;
 * - **load**: how much stone rests on it, straight up;
 * - **support**: whether it stands on something, and if it doesn't, which blocks round it at its level do (its
 *   underside springs from them);
 * - **thrust**: whether something carried over nothing pushes on it from one side, low enough that it can spread its
 *   foot the other way, down to the ground.
 *
 * A column is what stone open all round and lightly loaded makes; an arch, what stone over nothing between stones
 * that stand makes; a buttress, what a pier pushed from one side makes. Where the quantities fall that way, those
 * forms come; where they fall between, something between.
 *
 * And the neighbourhood itself, turned to a canonical orientation (the least of its eight turns and mirrors about the
 * vertical), as a code: blocks with the same surroundings, however turned, get the same code, and the carving that
 * comes of it, turned with them. Nothing is kept: a block is read again whenever what's round it changes.
 */
import { key } from './world';

export type Look = (x: number, y: number, z: number) => boolean;

/** a block as read from what's round it */
export type Read = {
  solid: boolean;
  /** faces joined to stone: +x −x +y −y +z −z (bits 0..5) */
  joins: number;
  /** how little stone is round it: 0 (deep in a mass) … 7 (alone) */
  soft: number;
  /** each face (as `joins`), in quarters: 0 closed (stone, or the ground), 3 sheltered (stone two out), 4 open */
  open: number[];
  /** stone resting on it, straight up: 0, 1, 2 (or more) */
  above: number;
  /** on stone or on the ground */
  standing: boolean;
  /** how high over the ground: 0 … 3 (or more) */
  level: number;
  /** nothing under it, held by stone beside it: bit 25, and which cells round it at its level stand (bit
   * (a + 2) * 5 + (c + 2) for the cell (x + a, z + c)); 0 otherwise */
  under: number;
  /** pushed from one side by stone over nothing: for each side +x −x +z −z, the level it's pushed at, plus one, when
   * the push is from the opposite side and this side is open down to the ground (so it spreads its foot this way) */
  thrust: number[];
  /** its surroundings, turned to their canonical orientation: 12 bits from the 26 cells round it, 12 from all 124 */
  code: number;
  /** which of the eight turns and mirrors about the vertical brings it to that orientation */
  frame: number;
  /** the read in short, and two hashes of that (to name shapes by) */
  name: string;
  h1: number;
  h2: number;
};

export const FACES: Array<[number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** the four sides: +x −x +z −z, as (dx, dz), and their faces */
export const SIDES: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const SIDE_FACE = [0, 1, 4, 5];

// ─── the neighbourhood, gathered once a read: 0 empty, 1 stone, 2 the ground ───
const G = new Uint8Array(125);
const gi = (a: number, b: number, c: number) => ((a + 2) * 5 + (b + 2)) * 5 + (c + 2);
const stone = (a: number, b: number, c: number) => G[gi(a, b, c)] === 1;
const occupied = (a: number, b: number, c: number) => G[gi(a, b, c)] !== 0;

// ─── turns and mirrors about the vertical ───
/** the 124 cells round a block, in a fixed order: the 26 next to it, then the 98 beyond */
const ROUND: Array<[number, number, number]> = [];
for (const ring of [1, 2]) for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) if (Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) === ring) ROUND.push([a, b, c]);
/** the turn g (a mirror of x if g & 4, then a quarter turn, g & 3 times) of a horizontal offset */
export function turn(g: number, a: number, c: number): [number, number] {
  if (g & 4) a = -a;
  for (let k = 0; k < (g & 3); k++) [a, c] = [-c, a];
  return [a, c];
}
function unturn(g: number, a: number, c: number): [number, number] {
  for (let k = 0; k < (g & 3); k++) [a, c] = [c, -a];
  if (g & 4) a = -a;
  return [a, c];
}
/** for each turn, where each cell of the canonical order comes from */
const FROM = Array.from({ length: 8 }, (_, g) => Int16Array.from(ROUND.map(([a, b, c]) => { const [u, w] = unturn(g, a, c); return gi(u, b, w); })));

const fnv = (seq: ArrayLike<number>, n: number, seed: number) => {
  let h = seed >>> 0;
  for (let i = 0; i < n; i++) { h ^= seq[i]; h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return h >>> 0;
};
const textHash = (s: string, seed: number) => {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return h >>> 0;
};

/** the surroundings in canonical orientation: the least of the eight turns of them, cell by cell; which turn that is */
const SEQ = new Uint8Array(124);
function canonical(): [number, number] {
  let best = 0;
  for (let g = 1; g < 8; g++) {
    const A = FROM[g], B = FROM[best];
    for (let i = 0; i < 124; i++) { const u = G[A[i]], w = G[B[i]]; if (u !== w) { if (u < w) best = g; break; } }
  }
  const F = FROM[best];
  for (let i = 0; i < 124; i++) SEQ[i] = G[F[i]];
  return [((fnv(SEQ, 26, 2166136261) & 0xfff) | ((fnv(SEQ, 124, 0x9e3779b9) & 0xfff) << 12)) >>> 0, best];
}

/** how much a block's open sides are drawn in along x and along z (0 … 1): by how open both sides are, and by the
 * run it's part of across them (a block in a run is drawn in less than one alone, and the end of a run least: it
 * stands as a pier); a block held by nothing at all, hardly */
const RUN = [1, 0.35, 0.5];
export function thinning(r: Read): [number, number] {
  if (!r.solid) return [0, 0];
  const held = r.standing || (r.joins & 0b110011) !== 0 ? 1 : 0.3;
  const zj = ((r.joins >> 4) & 1) + ((r.joins >> 5) & 1), xj = (r.joins & 1) + ((r.joins >> 1) & 1);
  return [(r.open[0] / 4) * (r.open[1] / 4) * RUN[zj] * held, (r.open[4] / 4) * (r.open[5] / 4) * RUN[xj] * held];
}
/** how exposed a block is: its faces' openness, averaged (0 … 1) */
export const exposure = (r: Read) => r.open.reduce((s, o) => s + o, 0) / 24;

const EMPTY_OPEN = [0, 0, 0, 0, 0, 0], NO_THRUST = [0, 0, 0, 0];

export function read(has: Look, x: number, y: number, z: number): Read {
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) G[gi(a, b, c)] = y + b < 0 ? 2 : has(x + a, y + b, z + c) ? 1 : 0;
  let n = 0;
  for (let i = 0; i < 125; i++) if (G[i] === 1) n++;
  if (G[gi(0, 0, 0)] === 1) n--;
  const soft = Math.round(7 * Math.min(1, Math.max(0, 1 - n / 36)));
  if (!stone(0, 0, 0)) {
    const name = `.${soft}`;
    return { solid: false, joins: 0, soft, open: EMPTY_OPEN, above: 0, standing: false, level: Math.min(Math.max(y, 0), 3), under: 0, thrust: NO_THRUST, code: 0, frame: 0, name, h1: textHash(name, 1), h2: textHash(name, 7) };
  }
  let joins = 0;
  const open = FACES.map(([a, b, c], f) => {
    if (stone(a, b, c)) joins |= 1 << f;
    return occupied(a, b, c) ? 0 : occupied(2 * a, 2 * b, 2 * c) ? 3 : 4;
  });
  const above = stone(0, 1, 0) ? (stone(0, 2, 0) ? 2 : 1) : 0;
  const standing = occupied(0, -1, 0);
  // (nothing under it, but held beside: which blocks round it at its level stand)
  let under = 0;
  if (!standing && joins & 0b110011) {
    for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) if ((a || c) && stone(a, 0, c) && occupied(a, -1, c)) under |= 1 << ((a + 2) * 5 + (c + 2));
    if (under) under |= 1 << 25;
  }
  // (pushed from one side by stone over nothing, low enough to reach the ground: a pier, from the ground up to where
  // the push comes in, open all the way down on the other side)
  const thrust = NO_THRUST.slice();
  let pier = standing && y <= 2;
  for (let k = 1; k <= y && pier; k++) pier = stone(0, -k, 0);
  if (pier) {
    SIDES.forEach(([dx, dz], s) => {
      for (let t = 2; t >= Math.max(y, 1); t--) {
        let up = true;
        for (let b = 1; b <= t - y && up; b++) up = stone(0, b, 0);
        if (!up || !stone(-dx, t - y, -dz) || occupied(-dx, t - y - 1, -dz)) continue;
        let free = true;
        for (let b = -y; b <= t - y && free; b++) free = !occupied(dx, b, dz);
        if (free) { thrust[s] = t + 1; return; }
      }
    });
  }
  const [code, frame] = canonical();
  const level = Math.min(y, 3);
  const name = `${joins}.${soft}.${open.join('')}.${above}${standing ? 1 : 0}${level}.${under.toString(36)}.${thrust.join('')}.${code.toString(36)}.${frame}`;
  return { solid: true, joins, soft, open, above, standing, level, under, thrust, code, frame, name, h1: textHash(name, 1), h2: textHash(name, 7) };
}

/** reads, remembered until what's round them changes */
export class Reads {
  private memo = new Map<number, Read>();
  constructor(private has: Look) {}
  at(x: number, y: number, z: number): Read {
    const k = key(x, y, z);
    let r = this.memo.get(k);
    if (!r) { r = read(this.has, x, y, z); this.memo.set(k, r); }
    return r;
  }
  /** what's round a changed cell reads differently: forget those (two cells each way) */
  changed(x: number, y: number, z: number) {
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) this.memo.delete(key(x + a, y + b, z + c));
  }
  clear() { this.memo.clear(); }
}
