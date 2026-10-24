/**
 * What a block is, read from what's round it: its neighbours, and theirs (two cells each way, 124 cells). Nothing is
 * kept; a block is read again whenever what's round it changes, so the same arrangement is always the same block.
 *
 * From its neighbours, a block knows which of its faces are joined (and melts into what's there) and how dense the
 * build round it is: alone or in a thin run it's soft, pebble-like; deep in a mass it's crisp, a dressed stone. From
 * its neighbours' neighbours it knows what part it plays:
 * - a **column**: stone above or below and nothing beside it. Slender, with a base where its run starts and a capital
 *   where it ends;
 * - a **span**: nothing under it, carried on both sides along a run (up to three cells between supports). An arch is
 *   cut from under it, a part of the one arch the whole span makes; carried both ways, a groin vault;
 * - a **corbel**: nothing under it and carried on one side only. Its underside tapers toward the free end;
 * - a **wall**: stone above or below, beside it along one way only, open both sides across it. Where the wall is
 *   three or more high, windows, in rhythm along its run;
 * - a **roof edge**: nothing above, on a wall or a mass, part of a top at least two wide, open on a side. Battlements
 *   along that side;
 * - on the **ground**: a plinth along its open sides;
 * - **alone**: a pebble.
 */
import { key } from './world';

export type Look = (x: number, y: number, z: number) => boolean;

export const ROLE = { none: 0, pebble: 1, column: 2, span: 3, corbel: 4, wall: 5, mass: 6, plain: 7 } as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

/** a block as read from what's round it (all small integers, so it can name a shape) */
export type Read = {
  role: Role;
  /** which faces are joined to a neighbour: +x −x +y −y +z −z (bits 0..5) */
  joins: number;
  /** how dense the build is round it: 0 (alone) … 3 (deep in a mass) */
  dense: number;
  /** a span: along which ways it's carried (bit 0 x, bit 1 z), and for each, the span's length and this block's place
   * in it (0 … len−1) */
  spanX: number; posX: number; spanZ: number; posZ: number;
  /** a corbel: the way to its support (0 +x, 1 −x, 2 +z, 3 −z) */
  toward: number;
  /** a column: a base under it (bit 0), a capital over it (bit 1) */
  ends: number;
  /** a wall: windows on its open faces (bit per face, as `joins`) */
  windows: number;
  /** a roof edge: battlements along its open sides (bit per side: +x −x +z −z) and which of them stand here (merlon)
   * or are gaps (crenel), by the place along the edge */
  merlons: number;
  /** on the ground with open sides: a plinth (bit per side) */
  plinth: number;
  /** nothing under it, off the ground: bit 25 set, and which cells round it at its level (two each way) stand on
   * something, bit (a + 2) * 5 + (c + 2) for the cell (x + a, z + c): what its underside springs from */
  under: number;
};

const EMPTY: Read = { role: ROLE.none, joins: 0, dense: 0, spanX: 0, posX: 0, spanZ: 0, posZ: 0, toward: 0, ends: 0, windows: 0, merlons: 0, plinth: 0, under: 0 };
export const FACES: Array<[number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const SIDES: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** how many cells round it (two each way) are filled, as a level 0..3 */
export function denseAt(has: Look, x: number, y: number, z: number): number {
  let n = 0;
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) if ((a || b || c) && has(x + a, y + b, z + c)) n++;
  return n < 3 ? 0 : n < 10 ? 1 : n < 26 ? 2 : 3;
}

/** stands on something: the ground, or a filled cell under it */
const standing = (has: Look, x: number, y: number, z: number) => y === 0 || has(x, y - 1, z);

/** along (dx, dz) from a block with nothing under it: the support it reaches through filled cells, within two, or 0 */
function reach(has: Look, x: number, y: number, z: number, dx: number, dz: number): number {
  for (let s = 1; s <= 2; s++) {
    if (!has(x + dx * s, y, z + dz * s)) return 0;
    if (standing(has, x + dx * s, y, z + dz * s)) return s;
  }
  return 0;
}

export function read(has: Look, x: number, y: number, z: number): Read {
  if (!has(x, y, z)) return { ...EMPTY, dense: denseAt(has, x, y, z) };
  let joins = 0;
  FACES.forEach(([a, b, c], f) => { if (has(x + a, y + b, z + c)) joins |= 1 << f; });
  const r: Read = { ...EMPTY, joins, dense: denseAt(has, x, y, z) };
  const up = (joins & 4) !== 0;
  const hx = joins & 3, hz = (joins >> 4) & 3, sides = hx | (hz << 2);
  if (joins === 63) { r.role = ROLE.mass; return r; }
  if (!joins && y > 0) { r.role = ROLE.pebble; return r; }
  // (nothing under it, off the ground: carried, or held out)
  if (y > 0 && !(joins & 8)) {
    let u = 1 << 25;
    for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) if ((a || c) && has(x + a, y, z + c) && standing(has, x + a, y, z + c)) u |= 1 << ((a + 2) * 5 + (c + 2));
    r.under = u;
    const px = reach(has, x, y, z, 1, 0), nx = reach(has, x, y, z, -1, 0), pz = reach(has, x, y, z, 0, 1), nz = reach(has, x, y, z, 0, -1);
    if ((px && nx) || (pz && nz)) {
      r.role = ROLE.span;
      if (px && nx) { r.spanX = px + nx - 1; r.posX = nx - 1; }
      if (pz && nz) { r.spanZ = pz + nz - 1; r.posZ = nz - 1; }
      return r;
    }
    if (sides) { r.role = ROLE.corbel; r.toward = joins & 1 ? 0 : joins & 2 ? 1 : joins & 16 ? 2 : 3; return r; }
  }
  // (a column: a run up and down, nothing beside)
  if (!sides && (up || (joins & 8))) {
    r.role = ROLE.column;
    if (!(joins & 8)) r.ends |= 1;
    if (!up) r.ends |= 2;
    return r;
  }
  // (a wall: beside it along one way only, open across it, stone above or below; windows where it's three high)
  if ((hx && !hz) || (hz && !hx)) {
    if (up || (joins & 8)) {
      r.role = ROLE.wall;
      let run = 1;
      for (let s = 1; s <= 2 && has(x, y + s, z); s++) run++;
      for (let s = 1; s <= 2 && y - s >= 0 && has(x, y - s, z); s++) run++;
      // (in rhythm along the wall: every other block, counted from where the wall begins (within two), else by place)
      const [dx, dz] = hx ? [1, 0] : [0, 1];
      let from = 0;
      while (from < 2 && has(x - dx * (from + 1), y, z - dz * (from + 1))) from++;
      const at = from < 2 ? from : (x * dx + z * dz) & 1;
      if (run >= 3 && up && (joins & 8) && at % 2 === 0) r.windows = hx ? (1 << 4) | (1 << 5) : 3;
    }
  }
  if (r.role === ROLE.none) r.role = ROLE.plain;
  // (a roof edge: nothing over it, a top at least two wide, battlements along its open sides)
  // (on a wall or a mass, that is: not the head of a column, or a span)
  const onWall = has(x, y - 1, z) && (has(x + 1, y - 1, z) || has(x - 1, y - 1, z) || has(x, y - 1, z + 1) || has(x, y - 1, z - 1));
  if (!up && countBits(sides) >= 2 && y > 0 && onWall) {
    let m = 0;
    SIDES.forEach(([dx, dz], s) => {
      if (sides & (1 << s)) return;
      // (merlon or crenel by the place along that edge)
      const along = dx ? z : x;
      if ((along & 1) === 0) m |= 1 << s;
      m |= 1 << (s + 4);
    });
    r.merlons = m;
  }
  if (y === 0) SIDES.forEach(([, ], s) => { if (!(sides & (1 << s))) r.plinth |= 1 << s; });
  return r;
}

const countBits = (n: number) => { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; };

/** a read as a short code, to name the shape it gives with its neighbours' */
export function code(r: Read): string {
  if (r.role === ROLE.none) return `.${r.dense}`;
  return `${r.role}${r.joins.toString(36)}${r.dense}${r.spanX}${r.posX}${r.spanZ}${r.posZ}${r.toward}${r.ends}${r.windows.toString(36)}${r.merlons.toString(36)}${r.plinth.toString(36)}u${r.under.toString(36)}`;
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
