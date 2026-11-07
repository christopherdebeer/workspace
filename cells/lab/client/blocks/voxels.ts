/**
 * What fills a cell, in small cubes: twelve a side, each stone of one kind or another, wood, glass, water, leaf, or
 * nothing. Two programs fill them, one for a cell of stone and one for an empty cell, and each sees only its own read
 * and the reads of the 26 cells round it (rules.ts): so what fills a cell depends on the cells two each way round it,
 * as its shape always did, and nothing is named.
 *
 * A cell of stone:
 * - its **section**: each open side drawn in by how open the two sides across are and the run it's in, less under
 *   load; where it meets broader stone over or under it, it steps out to meet it (a capital, a base); on the ground,
 *   its foot steps out;
 * - **nothing under it**: its underside cut from the blocks round it that stand (one arch over a run), the arch's
 *   edge on its faces picked out in tile;
 * - **each open face**, by the empty cell in front of it: under cover with stone beyond it and to its sides, a niche
 *   and the stone round it in tile; under cover and open beyond, the back of a porch: a tall pointed opening, a door
 *   on the ground, a window over it; open to the sky in a court, a window in each block of the wall (a door on the
 *   ground); outside, a slit window up the wall; and ivy, where the empty cell's surroundings say.
 *
 * An empty cell:
 * - **on the ground in a court**: paving; far from its walls, water in a rimmed basin, with lilies; against a wall, a
 *   bed of shrubs and flowers; in a corner, a cypress, growing up through the cells over it;
 * - **beside stone**: at the foot of stone on the ground, a plinth; under the top of a wall, a cornice on dentils;
 * - **over stone**: along a roof's open edges, a low parapet with a crest of dentils; over a roof surrounded by roof, a
 *   dome.
 *
 * And where the mass's top makes it a house or rock (rules.ts): a house's stone is washed render, its open faces
 * windows with a pair of shutters (on its lowest storey, now and then a door), bougainvillea over some; over its top,
 * a pitched roof of clay tile, rising from each eave at the same pitch (hipped where the top's as long as it's wide,
 * gabled where it's longer, the gable washed), now and then a chimney; an empty cell hung off a house's wall, a
 * balcony, and one between two houses' walls, washing on a line. Rock is weathered back, windowless, with a tuft on
 * top. And a harbour's water comes right up to its walls: a plain stone kerb and boats moored along it.
 */
import { SIDES, SIDE_FACE, thinning, type Read } from './rules';

export const M = 12;
export const MAT = { air: 0, stone: 1, trim: 2, tile: 3, wood: 4, glass: 5, water: 6, leaf: 7, bark: 8, paving: 9, soil: 10, plaster: 11, bloom: 12, roof: 13, shutter: 14, rock: 15, wash: 16, cloth: 21 };
/** a house's wash, as a stuff (house 1…5 → 16…20) */
const washOf = (house: number) => MAT.wash + Math.max(0, house - 1);

/** the read of a cell round this one (a, b, c each −1 … 1) */
export type Near = (a: number, b: number, c: number) => Read;
export type Grid = Uint8Array;

const at = (i: number, j: number, k: number) => (i * M + j) * M + k;
/** a small cube of a cell by its side: side s (+x −x +z −z), across it u, up j, in from that side d */
function side(s: number, u: number, j: number, d: number): number {
  return s === 0 ? at(M - 1 - d, j, u) : s === 1 ? at(d, j, M - 1 - u) : s === 2 ? at(M - 1 - u, j, M - 1 - d) : at(u, j, d);
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** chance, fixed by a number and a place */
function chance(seed: number, i: number, j: number, k: number): number {
  let h = (seed ^ Math.imul(i + 1, 0x27d4eb2d) ^ Math.imul(j + 7, 0x165667b1) ^ Math.imul(k + 13, 0x9e3779b1)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** smooth chance over a face, fixed by a number: blotches a few cubes across */
function blotch(seed: number, u: number, v: number, scale: number): number {
  const fu = u / scale, fv = v / scale, iu = Math.floor(fu), iv = Math.floor(fv), tu = fu - iu, tv = fv - iv;
  const su = tu * tu * (3 - 2 * tu), sv = tv * tv * (3 - 2 * tv);
  const a = chance(seed, iu, iv, 0), b = chance(seed, iu + 1, iv, 0), c = chance(seed, iu, iv + 1, 0), d = chance(seed, iu + 1, iv + 1, 0);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
const bits = (n: number) => { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; };

/** how far a stone block's side s is drawn in at row j, in cubes: as shape was (rules.ts thinning), under load less */
export function insetOf(r: Read, s: number, j: number): number {
  if (!r.solid || (r.joins >> SIDE_FACE[s]) & 1) return 0;
  const [tx, tz] = thinning(r), t = s < 2 ? tx : tz;
  const y = (j + 0.5) / M - 0.5, L = clamp01((r.above + 0.5 - y) / 1.5), load = L * L * (3 - 2 * L);
  return Math.round(4 * t * (1 - 0.45 * load));
}

/** how far the underside of a block with nothing under it is cut: from each block round it that stands, a quarter
 * ellipse, flat W from it, so blocks under one arch agree on it (positive: under it, not stone) */
const SOFFIT = 0.68, W = 1.25;
function soffit(under: number, x: number, y: number, z: number): number {
  let near = W;
  for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) {
    if (!(under & (1 << ((a + 2) * 5 + (c + 2))))) continue;
    near = Math.min(near, Math.hypot(Math.max(Math.abs(x - a) - 0.5, 0), Math.max(Math.abs(z - c) - 0.5, 0)));
  }
  const v = y + 0.5, u = W - near;
  if (u <= 0) return SOFFIT - v;
  return 1 - Math.hypot(u / W, Math.max(v, 0) / SOFFIT);
}

/** a pointed arch on a face: across u, up j; half its width hw, springing at row spring */
function inArch(u: number, j: number, hw: number, spring: number): boolean {
  const uc = Math.abs(u + 0.5 - M / 2), dy = j + 0.5 - spring, R = hw * 1.6;
  return dy <= 0 ? uc <= hw : (uc + R - hw) ** 2 + dy * dy <= R * R;
}

export function voxels(N: Near): Grid {
  const g = new Uint8Array(M * M * M);
  if (N(0, 0, 0).solid) stoneCell(g, N); else emptyCell(g, N);
  return g;
}

// ─── a cell of stone ───
function stoneCell(g: Grid, N: Near) {
  const r = N(0, 0, 0), up = N(0, 1, 0), dn = N(0, -1, 0), [tx, tz] = thinning(r), slender = tx > 0.5 && tz > 0.5 && !r.house;
  const body = r.rock ? MAT.rock : r.house ? washOf(r.house) : MAT.stone;
  // (each row's section: drawn in, stepping out to broader stone over or under it, and to the ground)
  const ins: number[][] = [];
  for (let j = 0; j < M; j++) {
    const row = [0, 1, 2, 3].map((s) => insetOf(r, s, j));
    for (let s = 0; s < 4; s++) {
      if (up.solid && j >= M - 2) { const o = insetOf(up, s, 0); if (o < row[s]) row[s] = j === M - 1 ? o : Math.round((o + row[s]) / 2); }
      if (dn.solid && j <= 1) { const o = insetOf(dn, s, M - 1); if (o < row[s]) row[s] = j === 0 ? o : Math.round((o + row[s]) / 2); }
      if (!dn.solid && r.level === 0 && j <= 1 && row[s]) row[s] = Math.max(0, row[s] - (2 - j));
    }
    ins.push(row);
    for (let i = row[1]; i < M - row[0]; i++) for (let k = row[3]; k < M - row[2]; k++) {
      // (a slender stone's corners taken off)
      if (slender) { const ei = Math.min(i - row[1], M - 1 - row[0] - i), ek = Math.min(k - row[3], M - 1 - row[2] - k); if (ei + ek < 1) continue; }
      g[at(i, j, k)] = body;
    }
  }
  // (rock: weathered back a cube or two in blotches on its open faces, no openings, a tuft on top)
  if (r.rock) { weather(g, r, ins); return; }
  // (a slender stone fluted: every other cube of its faces cut back)
  if (slender) for (let j = 2; j < M - 2; j++) for (let s = 0; s < 4; s++) {
    const a = s < 2 ? 3 : 1, b = s < 2 ? 2 : 0, lo = ins[j][a], hi = M - ins[j][b];
    for (let u = lo + 1; u < hi - 1; u += 2) g[side(s, s === 1 || s === 2 ? M - 1 - u : u, j, ins[j][s])] = MAT.air;
  }
  // (nothing under it: its underside cut, the arch's edge on its open faces in tile)
  if (r.under) {
    for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) for (let k = 0; k < M; k++) if (soffit(r.under, (i + 0.5) / M - 0.5, (j + 0.5) / M - 0.5, (k + 0.5) / M - 0.5) > 0) g[at(i, j, k)] = MAT.air;
    for (let s = 0; s < 4; s++) {
      if ((r.joins >> SIDE_FACE[s]) & 1) continue;
      for (let u = 0; u < M; u++) for (let j = 1; j < M; j++) {
        const q = side(s, u, j, ins[j][s]);
        if (g[q] && (!g[side(s, u, j - 1, ins[j][s])] || (j > 1 && !g[side(s, u, j - 2, ins[j][s])]))) g[q] = MAT.tile;
      }
    }
    return;
  }
  // (each open face, by the empty cell in front of it)
  SIDES.forEach(([dx, dz], s) => {
    if ((r.joins >> SIDE_FACE[s]) & 1) return;
    const v = N(dx, 0, dz), covered = (v.joins & 4) !== 0, beyond = (v.joins >> SIDE_FACE[s]) & 1, walled = bits(v.joins & 0b110011);
    const a = s < 2 ? 3 : 1, b = s < 2 ? 2 : 0;
    const wide = M - ins[M >> 1][a] - ins[M >> 1][b] >= 8;
    if (!wide) return;
    // (on the ground facing a court, a house keeps the court's openings: the porch door, the pointed windows)
    if (r.house && !covered && !(v.court >= 3 && r.level === 0)) {
      // (a house: a window with shutters in each block of the wall; on its lowest storey, where the ground or stone in
      // front would take a step, now and then a door; bougainvillea over some)
      const lowest = !dn.solid || !dn.house, floor = v.level === 0 || N(dx, -1, dz).solid;
      if (lowest && floor && (r.code >> 3) % 3 === 0) door(g, s, ins, body);
      else window(g, s, ins, (r.code >> 5) & 1);
      if (v.code && (v.code & 7) < 2) climber(g, s, ins, v.code, r.level, body);
      return;
    }
    if (covered && beyond) panel(g, s, ins);
    else if (covered && walled >= 2) opening(g, s, ins, 3, r.level === 0 ? 0 : 2, 6, MAT.glass, MAT.wood, r.level === 0 ? 6 : 2, MAT.tile);
    else if (covered) opening(g, s, ins, 2, r.level === 0 ? 0 : 3, 6, MAT.glass, MAT.wood, r.level === 0 ? 6 : 0, MAT.trim);
    else if (v.court >= 3 && r.above >= 1) opening(g, s, ins, 2, r.level === 0 ? 0 : 3, 6, MAT.glass, MAT.wood, r.level === 0 ? 6 : 1, MAT.trim);
    else if (r.level >= 1 && r.above >= 1) opening(g, s, ins, 1, 4, 7, MAT.glass, MAT.glass, 0, 0);
    if (!covered && v.code && (v.code & 7) < 2) ivy(g, s, ins, v.code, r.level);
  });
}

/** a pointed opening let into the face s: half as wide as hw, from the sill up; at its back glass, the lower rows
 * wood; round it, a frame */
function opening(g: Grid, s: number, ins: number[][], hw: number, sill: number, spring: number, back: number, low: number, lowRows: number, frame: number) {
  const depth = 2;
  for (let j = sill; j < M; j++) for (let u = 0; u < M; u++) {
    const d0 = ins[j][s];
    if (inArch(u, j, hw, spring)) {
      for (let d = 0; d < depth; d++) g[side(s, u, j, d0 + d)] = MAT.air;
      if (g[side(s, u, j, d0 + depth)]) g[side(s, u, j, d0 + depth)] = j < sill + lowRows ? low : back;
    } else if (frame && inArch(u, j, hw + 1, spring + 0.5) && g[side(s, u, j, d0)]) g[side(s, u, j, d0)] = frame;
  }
}
/** a window with a pair of shutters, let into the face s: four cubes wide, five high; glass at its back; a sill of trim;
 * shutters open against the wall either side (or, now and then, closed over it) */
function window(g: Grid, s: number, ins: number[][], closed: number) {
  const lo = 4, hi = 9, u0 = 4, u1 = 8;
  for (let j = lo; j < hi; j++) for (let u = u0; u < u1; u++) {
    const d0 = ins[j][s];
    g[side(s, u, j, d0)] = closed ? MAT.shutter : MAT.air;
    if (!closed && g[side(s, u, j, d0 + 1)]) g[side(s, u, j, d0 + 1)] = MAT.glass;
  }
  for (let u = u0 - 1; u <= u1; u++) { const d0 = ins[lo - 1][s]; if (g[side(s, u, lo - 1, d0)]) g[side(s, u, lo - 1, d0)] = MAT.trim; }
  // (open, the shutters lie flat on the wall either side, two cubes each)
  if (!closed) for (let j = lo; j < hi; j++) for (const u of [u0 - 2, u0 - 1, u1, u1 + 1]) { const q = side(s, u, j, ins[j][s]); if (g[q]) g[q] = MAT.shutter; }
}
/** a door let into the face s: four wide, eight high, of wood, under a lintel of trim */
function door(g: Grid, s: number, ins: number[][], body: number) {
  for (let j = 0; j < 9; j++) for (let u = 4; u < 8; u++) {
    const d0 = ins[j][s];
    if (j === 8) { if (g[side(s, u, j, d0)] === body) g[side(s, u, j, d0)] = MAT.trim; continue; }
    g[side(s, u, j, d0)] = MAT.air;
    if (g[side(s, u, j, d0 + 1)]) g[side(s, u, j, d0 + 1)] = MAT.wood;
  }
}
/** bougainvillea over a washed face: leaf in blotches thick with flowers, spilling down from the top */
function climber(g: Grid, s: number, ins: number[][], seed: number, level: number, body: number) {
  for (let j = 0; j < M; j++) for (let u = 0; u < M; u++) {
    const q = side(s, u, j, ins[j][s]);
    if (g[q] !== body) continue;
    const b = blotch(seed, u, j + level * M, 3.5);
    if (b > 0.6 - 0.025 * j) g[q] = chance(seed, u, j, level) < 0.55 ? MAT.bloom : MAT.leaf;
  }
}
/** rock weathered: its open faces cut back a cube or two in blotches; on top, where nothing stands, a few tufts */
function weather(g: Grid, r: Read, ins: number[][]) {
  for (let s = 0; s < 4; s++) {
    if ((r.joins >> SIDE_FACE[s]) & 1) continue;
    for (let j = 0; j < M; j++) for (let u = 0; u < M; u++) {
      const cut = Math.floor(3 * blotch(r.code + s * 31, u, j, 2.5) - 0.6);
      for (let d = 0; d < cut; d++) g[side(s, u, j, ins[j][s] + d)] = MAT.air;
    }
  }
  if (!((r.joins >> 2) & 1)) for (let i = 1; i < M - 1; i++) for (let k = 1; k < M - 1; k++) {
    if (blotch(r.code, i, k, 2) > 0.72 && g[at(i, M - 1, k)]) g[at(i, M - 1, k)] = MAT.leaf;
  }
}
/** a sunk panel of tile on the face s */
function panel(g: Grid, s: number, ins: number[][]) {
  for (let j = 1; j < M - 1; j++) for (let u = 1; u < M - 1; u++) {
    const d0 = ins[j][s], q = side(s, u, j, d0);
    if (!g[q]) continue;
    if (u >= 2 && u < M - 2 && j >= 2 && j < M - 2) { g[q] = MAT.air; if (g[side(s, u, j, d0 + 1)]) g[side(s, u, j, d0 + 1)] = MAT.tile; }
    else g[q] = MAT.tile;
  }
}
/** ivy over the face s, in blotches, thicker low down */
function ivy(g: Grid, s: number, ins: number[][], seed: number, level: number) {
  for (let j = 0; j < M; j++) for (let u = 0; u < M; u++) {
    const q = side(s, u, j, ins[j][s]);
    if (g[q] !== MAT.stone) continue;
    if (blotch(seed, u, j + level * M, 4) > 0.42 + 0.03 * level + 0.1 * (j / M)) g[q] = MAT.leaf;
  }
}

// ─── an empty cell ───
function emptyCell(g: Grid, N: Near) {
  const v = N(0, 0, 0), below = N(0, -1, 0);
  if (v.level === 0) {
    if (v.pool) pool(g, N, v);
    else if (v.court >= 3 || v.bed) for (let i = 0; i < M; i++) for (let k = 0; k < M; k++) g[at(i, 0, k)] = MAT.paving;
    if (v.bed) bed(g, N, v);
  }
  if (v.tree) cypress(g, v);
  if (v.roof) { roof(g, v, below); return; }
  // (hung off a house's wall over nothing: now and then a balcony; between two houses' walls, washing on a line)
  if (v.level >= 1 && !below.solid && !(v.joins & 4)) {
    const walls = SIDES.map(([dx, dz]) => N(dx, 0, dz)), houses = walls.map((w) => w.solid && w.house > 0);
    if ((houses[0] && houses[1]) || (houses[2] && houses[3])) washing(g, v, houses[0] && houses[1] ? 0 : 2);
    else { const s = houses.findIndex(Boolean); if (s >= 0 && houses.filter(Boolean).length === 1 && (v.code & 15) < 5) balcony(g, s); }
  }
  // (beside stone: at its foot on the ground, a plinth; under the top of a wall, a cornice on dentils)
  SIDES.forEach(([dx, dz], s) => {
    const w = N(dx, 0, dz);
    if (!w.solid || w.under) return;
    const runs = bits(w.joins & 0b110011) >= 1;
    if (v.level === 0 && w.standing && runs && !v.bed) {
      for (let u = 0; u < M; u++) { g[side(s, u, 0, 0)] = MAT.trim; g[side(s, u, 1, 0)] = MAT.trim; g[side(s, u, 0, 1)] = MAT.trim; }
    }
    if (w.above === 0 && runs && w.level >= 1 && !(v.joins & 4)) {
      for (let u = 0; u < M; u++) {
        g[side(s, u, M - 1, 0)] = MAT.trim; g[side(s, u, M - 2, 0)] = MAT.trim; g[side(s, u, M - 1, 1)] = MAT.trim;
        if (u % 2 === 0) g[side(s, u, M - 3, 0)] = MAT.trim;
      }
    }
  });
  // (over stone: along a roof's open edges, a parapet; over a roof that's roof all round, a dome)
  if (below.solid && !below.under && !below.house) {
    const hj = bits(below.joins & 0b110011);
    if (hj >= 1 && below.level >= 1) SIDES.forEach(([dx, dz], s) => {
      if ((below.joins >> SIDE_FACE[s]) & 1) return;
      const d0 = insetOf(below, s, M - 1);
      for (let u = 0; u < M; u++) for (let j = 0; j < 4; j++) {
        if (j === 3 && u % 2) continue;
        g[side(s, u, j, d0)] = MAT.trim;
        if (j < 3) g[side(s, u, j, d0 + 1)] = MAT.trim;
      }
    });
    let roof = hj === 4;
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) roof = roof && N(dx, -1, dz).solid;
    for (const [dx, dz] of SIDES) roof = roof && !N(dx, 0, dz).solid;
    if (roof) {
      const mat = below.code & 1 ? MAT.tile : MAT.plaster;
      for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) for (let k = 0; k < M; k++) {
        const x = i + 0.5 - M / 2, z = k + 0.5 - M / 2, y = j + 0.5;
        if ((x * x + z * z) / 25 + (y * y) / 20 <= 1) g[at(i, j, k)] = j === 0 ? MAT.trim : mat;
        else if (Math.abs(x) < 1 && Math.abs(z) < 1 && y < 6.2) g[at(i, j, k)] = MAT.trim;
      }
    }
  }
}

/** water in a rimmed basin: a rim of tile where the next cell isn't water too, lilies, and a jet where it's water all
 * round */
function pool(g: Grid, N: Near, v: Read) {
  const harbour = v.harbour;
  for (let i = 0; i < M; i++) for (let k = 0; k < M; k++) g[at(i, 0, k)] = !harbour && chance(v.code, i, 0, k) < 0.07 ? MAT.leaf : MAT.water;
  let round = 0, edge = -1;
  SIDES.forEach(([dx, dz], s) => {
    if (N(dx, 0, dz).pool) { round++; return; }
    edge = s;
    for (let u = 0; u < M; u++) { g[side(s, u, 0, 0)] = harbour ? MAT.trim : MAT.tile; g[side(s, u, 1, 0)] = harbour ? MAT.paving : MAT.tile; g[side(s, u, 0, 1)] = MAT.trim; }
  });
  // (a harbour: a boat moored in each cell along a quay, its bow to it)
  if (harbour) { if (round === 3) boat(g, edge < 2 ? 1 : 0); return; }
  if (round === 4) for (let j = 0; j < 4; j++) for (const [i, k] of [[5, 5], [5, 6], [6, 5], [6, 6]]) g[at(i, j, k)] = j === 3 ? MAT.water : MAT.trim;
}
/** a rowing boat moored: a hull ten cubes long and five across, white outside with a coloured strake, wood within, a
 * thwart; lying along x (along 1) or along z */
function boat(g: Grid, along: number) {
  const off = 0;
  for (let a = 0; a < M; a++) for (let c = 0; c < M; c++) {
    const L = (a + 0.5 - M / 2) / 5, W = (c + 0.5 - M / 2 - off) / 2.6;
    const e = L * L + W * W * (1 + 0.6 * L * L);
    if (e > 1) continue;
    const [i, k] = along ? [a, c] : [c, a];
    const rim = e > 0.55;
    for (let j = 1; j <= 3; j++) {
      if (!rim && j > 1) { if (j === 2 && Math.abs(L) < 0.12) g[at(i, j, k)] = MAT.wood; continue; }
      g[at(i, j, k)] = rim ? (j === 2 ? MAT.shutter : MAT.trim) : MAT.wood;
    }
  }
}
/** a pitched roof of clay tile over a house's top block: rising from each eave at one pitch (half a cell for a cell
 * in); where the top runs further one way than the other, the ridge runs that way (a gable, washed under the tile);
 * now and then a chimney */
function roof(g: Grid, v: Read, below: Read) {
  const e = v.roof - 1, run = [e & 3, (e >> 2) & 3, (e >> 4) & 3, (e >> 6) & 3];
  const sx = 1 + run[0] + run[1], sz = 1 + run[2] + run[3], wash = washOf(below.house), PITCH = 0.5;
  for (let i = 0; i < M; i++) for (let k = 0; k < M; k++) {
    const x = (i + 0.5) / M, z = (k + 0.5) / M;
    const ex = Math.min(run[0] + x, run[1] + 1 - x), ez = Math.min(run[2] + z, run[3] + 1 - z);
    const d = sx > sz ? ez : sz > sx ? ex : Math.min(ex, ez), h = Math.min(M - 1, Math.round(PITCH * d * M));
    for (let j = 0; j <= h; j++) g[at(i, j, k)] = j >= h - 1 ? MAT.roof : wash;
  }
  if ((v.code & 31) < 4) for (let j = 0; j < M; j++) for (const [i, k] of [[3, 3], [3, 4], [4, 3], [4, 4]]) g[at(i, j, k)] = j > M - 3 ? MAT.trim : wash;
}
/** a balcony off the wall s: a slab three cubes out, a railing at its edge */
function balcony(g: Grid, s: number) {
  for (let u = 2; u < M - 2; u++) for (let d = 0; d < 3; d++) {
    g[side(s, u, 0, d)] = MAT.trim;
    if (d === 2 || u === 2 || u === M - 3) for (let j = 1; j <= 4; j++) if (j === 4 || u % 2 === 0) g[side(s, u, j, d)] = MAT.wood;
  }
}
/** washing on a line across from wall to wall along the side s (0: along x, 2: along z): the line, and cloths of
 * several colours pegged on it, some long, some short */
function washing(g: Grid, v: Read, s: number) {
  for (let u = 0; u < M; u++) {
    const [i, k] = s === 0 ? [u, M >> 1] : [M >> 1, u];
    g[at(i, 9, k)] = MAT.wood;
    const piece = Math.floor(u / 3), len = 2 + Math.floor(3 * chance(v.code, piece, 0, 0));
    if (u % 3 !== 2 && chance(v.code, piece, 1, 0) < 0.5) for (let j = 9 - len; j < 9; j++) g[at(i, j, k)] = MAT.cloth;
  }
}
/** a bed against the walls: earth in a kerb, shrubs and flowers, higher by the wall */
function bed(g: Grid, N: Near, v: Read) {
  const walls = SIDES.map(([dx, dz]) => N(dx, 0, dz).solid);
  for (let i = 0; i < M; i++) for (let k = 0; k < M; k++) g[at(i, 0, k)] = MAT.soil;
  SIDES.forEach(([dx, dz], s) => {
    if (walls[s] || N(dx, 0, dz).bed) return;
    for (let u = 0; u < M; u++) { g[side(s, u, 0, 0)] = MAT.trim; g[side(s, u, 1, 0)] = MAT.trim; }
  });
  if (v.tree) return;
  for (let i = 1; i < M - 1; i++) for (let k = 1; k < M - 1; k++) {
    // (how near a wall: shrubs grow up it)
    let near = 1;
    if (walls[0]) near = Math.max(near, i / M); if (walls[1]) near = Math.max(near, 1 - i / M);
    if (walls[2]) near = Math.max(near, k / M); if (walls[3]) near = Math.max(near, 1 - k / M);
    const h = Math.round(2 + 6 * near * blotch(v.code, i, k, 3));
    for (let j = 1; j <= h && j < M; j++) g[at(i, j, k)] = j === h && chance(v.code, i, j, k) < 0.3 ? MAT.bloom : MAT.leaf;
  }
}
/** a cypress: a trunk, and a spindle of leaf two cells and a half high, through the cells over its foot */
function cypress(g: Grid, v: Read) {
  const base = (v.tree - 1) * M, high = 2.6 * M;
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) for (let k = 0; k < M; k++) {
    const y = base + j + 0.5, x = i + 0.5 - M / 2, z = k + 0.5 - M / 2, d = Math.hypot(x, z);
    if (y < 5 && d < 1.2 && y > 1) { g[at(i, j, k)] = MAT.bark; continue; }
    const t = clamp01((y - 3) / (high - 3)), rad = 3.6 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.25, 1)), 0.7) * (1 - 0.35 * t);
    if (t > 0 && d < rad + 0.7 * (chance(v.code, i, j + base, k) - 0.5)) g[at(i, j, k)] = MAT.leaf;
  }
}
