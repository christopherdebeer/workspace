/**
 * The shape of the blocks: one distance field over the whole build, the smooth union of every block's own solid, and
 * cut out of it cell by cell (surface nets). Because the field is one function of where you are, two cells that meet
 * agree on their shared face exactly: no seams, whatever was built in what order.
 *
 * Every block's solid comes from one shape program, its measures taken from the block's read (rules.ts) and nothing
 * else:
 * - **its section**: each open side drawn in by how open the two sides across are and by the run the block is part of,
 *   less where stone rests on it. The load is measured from the top of the stone over it, so a stack of blocks tapers
 *   as one, slender at its top and full where it carries; on the ground, its foot flares;
 * - **where it's joined**, it runs on into its neighbour, one way at a time, so the two are one stone. Where their
 *   faces meet at an angle, a fillet, wider between a block and the one over or under it: where a slender stone meets
 *   a broad one it carries, that fillet is its capital;
 * - **nothing under it**: its underside rises from the blocks round it that stand, one arch over a run of them;
 * - **pushed from a side**: it spreads its foot the other way, down to the ground, a buttress;
 * - **its edges**: rounded by how exposed it is, softer where it's alone.
 *
 * A cell's mesh depends on the reads of the cells two each way round it, so it's named by them and kept: the same
 * arrangement anywhere is the same mesh, made once. Each vertex carries what the carving needs (render.ts) of the
 * block whose surface it's on: its code and frame, its joins, how exposed and how drawn in it is.
 */
import { SIDE_FACE, exposure, thinning, type Read } from './rules';

/** samples along a cell's edge */
export const S = 6;
/** how far a side open both ways is drawn in, at most; how far a foot flares on the ground; how far a buttress spreads */
const THIN = 0.27, FLARE = 0.07, BUTTRESS = 0.5;
/** how soft the fillets where blocks meet, from how soft the build is there */
const blendOf = (soft: number) => 0.05 + 0.15 * (soft / 7);

const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, v: number) => { const t = clamp01((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
/** a box from (x0, y0, z0) to (x1, y1, z1), its edges rounded by r */
function box(px: number, py: number, pz: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const qx = Math.abs(px - cx) - (x1 - x0) / 2 + r, qy = Math.abs(py - cy) - (y1 - y0) / 2 + r, qz = Math.abs(pz - cz) - (z1 - z0) / 2 + r;
  return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
/** which way a box's distance grows at a point, near enough and without a jump anywhere (so a blend that hangs on it
 * has none either): each face weighed by how near it is. Left here by `facing`. */
let GX = 0, GY = 0, GZ = 0;
function facing(px: number, py: number, pz: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const qx = Math.abs(px - cx) - (x1 - x0) / 2, qy = Math.abs(py - cy) - (y1 - y0) / 2, qz = Math.abs(pz - cz) - (z1 - z0) / 2;
  const m = Math.max(qx, qy, qz) - 0.15;
  const wx = Math.max(qx - m, 0), wy = Math.max(qy - m, 0), wz = Math.max(qz - m, 0);
  const ax = wx * wx, ay = wy * wy, az = wz * wz, l = len3(ax, ay, az) || 1;
  GX = ((px < cx ? -1 : 1) * ax) / l; GY = ((py < cy ? -1 : 1) * ay) / l; GZ = ((pz < cz ? -1 : 1) * az) / l;
}
/** smooth union, polynomial (k: how wide the fillet) */
function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
/** smooth intersection: a cut with its edge rounded (k: how much), so the lattice can follow it */
const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

/** a block's measures, worked out once from its read */
type Prep = {
  rr: number; ext: number;
  /** each side +x −x +z −z: joined (it runs on into the neighbour there), and how far it's drawn in when unloaded */
  joined: boolean[]; thin: number[];
  above: number; level: number; ground: boolean;
  /** how far it reaches up and down (on into the blocks over and under it where it's joined) */
  y0: number; y1: number;
  thrust: number[]; under: number;
  /** the box all of it lies in */
  bx0: number; bx1: number; by0: number; by1: number; bz0: number; bz1: number;
};
const preps = new WeakMap<Read, Prep>();
function prep(r: Read): Prep {
  const had = preps.get(r);
  if (had) return had;
  const [tx, tz] = thinning(r);
  const thin = [tx, tx, tz, tz].map((t) => THIN * t), joined = SIDE_FACE.map((f) => ((r.joins >> f) & 1) === 1);
  // (round by how exposed, softer alone; never rounder than it's thick)
  const narrow = Math.min(...thin.map((t, i) => (joined[i] ? 0.5 : 0.5 - t)));
  const rr = Math.min((0.05 + 0.25 * Math.pow(exposure(r), 1.2)) * (0.7 + 0.6 * (r.soft / 7)), 0.85 * narrow, 0.34);
  const ext = rr + 0.04, ground = r.level === 0;
  const y0 = r.joins & 8 ? -0.5 - ext : -0.5, y1 = r.joins & 4 ? 0.5 + ext : 0.5;
  const out = (i: number) => (joined[i] ? 0.5 + ext : 0.5 + (ground ? FLARE : 0) + (r.thrust[i] ? BUTTRESS + 0.06 : 0)) + 0.03;
  const p: Prep = { rr, ext, joined, thin, above: r.above, level: r.level, ground, y0, y1, thrust: r.thrust, under: r.under, bx1: out(0), bx0: -out(1), bz1: out(2), bz0: -out(3), by0: y0 - 0.03, by1: y1 + 0.03 };
  preps.set(r, p);
  return p;
}
/** how far the side i of a block reaches at height y in it: drawn in where open, less under load (measured from the
 * top of the stone over it, so blocks stacked agree where they overlap), flared at the foot on the ground */
function reach(P: Prep, i: number, y: number): number {
  if (P.joined[i]) return 0.5;
  const load = smooth(0, 1.5, Math.min(1.5, Math.max(0, P.above + 0.5 - y)));
  let w = 0.5 - P.thin[i] * (1 - 0.45 * load);
  if (P.ground) { const g = 1 - smooth(-0.5, 0.05, y); w += FLARE * g * g; }
  return w;
}

/** a block's own solid, at p relative to its centre */
export function solid(r: Read, px: number, py: number, pz: number): number {
  const P = prep(r), rr = P.rr;
  const fx1 = reach(P, 0, py), fx0 = -reach(P, 1, py), fz1 = reach(P, 2, py), fz0 = -reach(P, 3, py);
  const ex1 = P.joined[0] ? 0.5 + P.ext : fx1, ex0 = P.joined[1] ? -0.5 - P.ext : fx0, ez1 = P.joined[2] ? 0.5 + P.ext : fz1, ez0 = P.joined[3] ? -0.5 - P.ext : fz0;
  // (on into each neighbour it's joined to, one way at a time (so the rounding's inside the join, and nothing's put in
  // the corner between two neighbours that isn't theirs); the nearest of these is its surface)
  const dx = box(px, py, pz, ex0, ex1, -0.5, 0.5, fz0, fz1, rr), dy = box(px, py, pz, fx0, fx1, P.y0, P.y1, fz0, fz1, rr), dz = box(px, py, pz, fx0, fx1, -0.5, 0.5, ez0, ez1, rr);
  let d = Math.min(dx, dy, dz);
  // (which way it faces: those of the boxes nearest it, weighed, so it turns from one to another without a jump)
  let gx = 0, gy = 0, gz = 0;
  const wx = 1 - (dx - d) / 0.08, wy = 1 - (dy - d) / 0.08, wz = 1 - (dz - d) / 0.08;
  if (wx > 0) { facing(px, py, pz, ex0, ex1, -0.5, 0.5, fz0, fz1); gx += GX * wx; gy += GY * wx; gz += GZ * wx; }
  if (wy > 0) { facing(px, py, pz, fx0, fx1, P.y0, P.y1, fz0, fz1); gx += GX * wy; gy += GY * wy; gz += GZ * wy; }
  if (wz > 0) { facing(px, py, pz, fx0, fx1, -0.5, 0.5, ez0, ez1); gx += GX * wz; gy += GY * wz; gz += GZ * wz; }
  const gl = len3(gx, gy, gz) || 1;
  GX = gx / gl; GY = gy / gl; GZ = gz / gl;
  // (pushed from one side: a buttress the other way, a wedge whose sloping face runs from the pier where the push comes
  // in to its full spread on the ground)
  for (let i = 0; i < 4; i++) {
    if (!P.thrust[i]) continue;
    const spring = P.thrust[i] - 1, top = spring + 0.5, slope = BUTTRESS / (spring + 1), y = P.level + py;
    const u = i === 0 ? px : i === 1 ? -px : i === 2 ? pz : -pz, v = i < 2 ? pz : px;
    // (from one line for the whole pier, not each block's own face, so the pieces of it meet without a step)
    const wedge = smax(smax(smax(Math.abs(v) - 0.16, (u - 0.3 - slope * (top - y)) / Math.sqrt(1 + slope * slope), 0.04), 0.15 - u, 0.04), y - top, 0.04);
    d = smin(d, wedge, 0.05);
  }
  // (nothing under it: its own underside too, so no sliver of it is left where its neighbour's cell is empty)
  if (P.under) d = smax(d, soffit(P.under, px, py, pz), 0.08);
  return d;
}

/** the reads of the cells round a cell (two each way), as a little array, and the cell's own name from them;
 * `floor`: how high the cell is over the ground (up to 3: higher, the ground's out of reach) */
export type Patch = { reads: Read[]; name: string; floor: number };
export const PATCH = 5;
const at = (a: number, b: number, c: number) => ((a + 2) * PATCH + (b + 2)) * PATCH + (c + 2);

/** what the field at a point needs, made once for a cell: for each cell the point can be in (the cell and those round
 * it), how soft the union there, and the blocks within one of it, that one first, each with the box it lies in and
 * how wide its fillets (wider with the block over or under) */
type Near = { r: Read; a: number; b: number; c: number; kMul: number; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
type Hood = { k: number[]; near: Near[][]; own: Read[]; ground: number };
function hood(P: Read[], floor = 3): Hood {
  const k: number[] = [], near: Near[][] = [], owns: Read[] = [];
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
    const list: Near[] = [], own = P[at(ox, oy, oz)];
    k.push(blendOf(own.soft)); owns.push(own);
    for (let a = ox - 1; a <= ox + 1; a++) for (let b = oy - 1; b <= oy + 1; b++) for (let c = oz - 1; c <= oz + 1; c++) {
      const r = P[at(a, b, c)];
      if (!r.solid) continue;
      const p = prep(r);
      const n: Near = { r, a, b, c, kMul: a === ox && c === oz && b !== oy ? 1.35 : 1, x0: p.bx0, x1: p.bx1, y0: p.by0, y1: p.by1, z0: p.bz0, z1: p.bz1 };
      if (a === ox && b === oy && c === oz) list.unshift(n); else list.push(n);
    }
    near.push(list);
  }
  // (where the ground is, under the cell's centre: the stone goes no lower)
  return { k, near, own: owns, ground: floor < 3 ? -0.5 - floor : -1e9 };
}

/** the field at a point of a cell (x/D, y/D, z/D relative to its centre): the cell whose region the point is in decides
 * how soft the union; every block within one of that is in it, that one first, the others unless too far off to touch
 * the union. The samples are given as whole numbers of steps (D = S), so two cells reckon a sample they share with the
 * same arithmetic, to the last bit: a face lying on a sample plane (as every open face does) is on the same side of it
 * from both. */
function field(H: Hood, x: number, y: number, z: number, D = 1): number {
  // (the cell the point is in: the one above, on a boundary, so both sides agree)
  const half = D / 2;
  const ox = Math.floor((x + half) / D + 1e-7), oy = Math.floor((y + half) / D + 1e-7), oz = Math.floor((z + half) / D + 1e-7);
  const o = ((ox + 1) * 3 + (oy + 1)) * 3 + (oz + 1), k = H.k[o], list = H.near[o], own = H.own[o];
  let d = 1e3, gx = 0, gy = 0, gz = 0;
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    const px = (x - n.a * D) / D, py = (y - n.b * D) / D, pz = (z - n.c * D) / D;
    if (d < 1e3 && Math.max(n.x0 - px, px - n.x1, n.y0 - py, py - n.y1, n.z0 - pz, pz - n.z1) >= d + k * n.kMul) continue;
    const s = solid(n.r, px, py, pz);
    if (d >= 1e3) { d = s; gx = GX; gy = GY; gz = GZ; continue; }
    // (a fillet only where surfaces meet at an angle: two faces running on in one plane are one face, not a seam with
    // a ridge along it, as a smooth union would make of them)
    const kk = Math.max(k * n.kMul * clamp01(1 - (gx * GX + gy * GY + gz * GZ)), 1e-6);
    const h = clamp01(0.5 + (0.5 * (s - d)) / kk);
    d = s + (d - s) * h - kk * h * (1 - h);
    gx = GX + (gx - GX) * h; gy = GY + (gy - GY) * h; gz = GZ + (gz - GZ) * h;
    const gl = len3(gx, gy, gz) || 1; gx /= gl; gy /= gl; gz /= gl;
  }
  // (nothing below the ground: every block's foot is cut level with it, in the cell it stands in)
  if (d < 1e3) d = Math.max(d, H.ground - y / D);
  // (a block with nothing under it: its underside rises from what stands round it, whatever reaches into it)
  if (own.under && d < 1e3) {
    const lx = (x - ox * D) / D, ly = (y - oy * D) / D, lz = (z - oz * D) / D;
    d = smax(d, soffit(own.under, lx, ly, lz), 0.08);
  }
  return d;
}
/** the block whose surface a point of a cell is on: the block in the cell it's in, if there is one; else the block
 * whose solid is nearest, and how plainly (0, as near one as another: the carving fades there, so where it goes from
 * one block's to another's doesn't show) */
function owner(H: Hood, P: Read[], x: number, y: number, z: number): [Near | null, number] {
  const ox = Math.floor(x + 0.5 + 1e-7), oy = Math.floor(y + 0.5 + 1e-7), oz = Math.floor(z + 0.5 + 1e-7);
  const list = H.near[((ox + 1) * 3 + (oy + 1)) * 3 + (oz + 1)] ?? [];
  if (list.length && list[0].a === ox && list[0].b === oy && list[0].c === oz) return [list[0], 1];
  let best: Near | null = null, bd = Infinity, next = Infinity;
  for (const n of list) {
    const s = solid(n.r, x - n.a, y - n.b, z - n.c);
    if (s < bd) { next = bd; bd = s; best = n; } else if (s < next) next = s;
  }
  return [best, clamp01((next - bd) / 0.1)];
}

/** how far a point of a block with nothing under it is into the space under its underside (positive: under it, so
 * not stone). The underside rises from each cell round it that stands on something, a quarter ellipse, flat W from it;
 * reckoned from where those cells are, so two blocks that meet agree on it at their boundary (both see every one near
 * enough to matter): one arch over a run of them. Between two standing a cell apart, two arcs meet in a point; held on
 * one side, a bracket. */
const SOFFIT = 0.68, W = 1.25;
function soffit(under: number, x: number, y: number, z: number): number {
  let near = W;
  for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) {
    if (!(under & (1 << ((a + 2) * 5 + (c + 2))))) continue;
    const qx = Math.max(Math.abs(x - a) - 0.5, 0), qz = Math.max(Math.abs(z - c) - 0.5, 0);
    near = Math.min(near, Math.hypot(qx, qz));
  }
  // (over the foot v, across from where the arch springs u: under the flat, or inside the ellipse, by its distance)
  const v = y + 0.5, u = W - near;
  if (u <= 0) return SOFFIT - v;
  const ea = u / W, eb = Math.max(v, 0) / SOFFIT, r = Math.hypot(ea, eb) || 1e-6;
  const gx = ea / W / r, gy = eb / SOFFIT / r;
  return -(r - 1) / (Math.hypot(gx, gy) || 1);
}

/** a cell's mesh, in its own coordinates, 11 floats a vertex: position, normal, occlusion, then of the block whose
 * surface it's on: how exposed and drawn in (packed), its code, its place, frame and joins (packed), and how plainly
 * it's that block's; and triangles */
export type Mesh = { v: Float32Array; i: Uint32Array };
export const VERTEX = 11;
const cache = new Map<string, Mesh>();
export const cacheStats = { hits: 0, made: 0 };
const NONE: Mesh = { v: new Float32Array(0), i: new Uint32Array(0) };

/** a cell's patch: the reads of the cells two each way round it, named by their names */
export function patch(readAt: (x: number, y: number, z: number) => Read, x: number, y: number, z: number): Patch {
  const reads: Read[] = new Array(PATCH ** 3);
  let h1 = 0x811c9dc5, h2 = 0x9747b28c, any = false;
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) {
    const r = readAt(x + a, y + b, z + c);
    reads[at(a, b, c)] = r;
    if (r.solid && Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) <= 1) any = true;
    h1 = Math.imul(h1 ^ r.h1, 0x01000193) >>> 0;
    h2 = Math.imul((h2 ^ r.h2) + 0x9e3779b9, 0x85ebca77) >>> 0;
  }
  const floor = Math.max(0, Math.min(y, 3));
  return { reads, name: any ? `${floor}|${h1.toString(36)}.${h2.toString(36)}` : '', floor };
}

/** the mesh of the surface within a cell (surface nets on S samples an edge), named by its patch and kept */
export function cellMesh(p: Patch): Mesh {
  if (!p.name) return NONE;
  const hit = cache.get(p.name);
  if (hit) { cacheStats.hits++; return hit; }
  cacheStats.made++;
  const m = surface(p.reads, p.floor);
  if (cache.size > 20000) cache.clear();
  cache.set(p.name, m);
  return m;
}

// (a cube's corners (bit 2 x, bit 1 y, bit 0 z) and its edges, as pairs of corners)
const CORNER = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => [(n >> 2) & 1, (n >> 1) & 1, n & 1]);
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

export function surface(P: Read[], floor = 3): Mesh {
  const H = hood(P, floor);
  // (samples from one step before the cell to its far face, so the cubes either side of its boundary are known; sample
  // a at (a − 1 − S/2) steps from the centre: −½ − h … ½ + h)
  const G = S + 2, h = 1 / S, o = -0.5 - h, n0 = -1 - S / 2;
  const f = new Float32Array(G * G * G);
  const ix = (a: number, b: number, c: number) => (a * G + b) * G + c;
  for (let a = 0; a < G; a++) for (let b = 0; b < G; b++) for (let c = 0; c < G; c++) f[ix(a, b, c)] = field(H, n0 + a, n0 + b, n0 + c, S);
  // (a vertex in each cube the surface crosses: where its edges cross it, averaged)
  const C = G - 1, vid = new Int32Array(C * C * C).fill(-1), vs: number[] = [];
  const cix = (a: number, b: number, c: number) => (a * C + b) * C + c;
  const val = new Float64Array(8);
  for (let a = 0; a < C; a++) for (let b = 0; b < C; b++) for (let c = 0; c < C; c++) {
    let inside = 0;
    for (let n = 0; n < 8; n++) { const q = CORNER[n], v = f[ix(a + q[0], b + q[1], c + q[2])]; val[n] = v; if (v < 0) inside++; }
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (let e = 0; e < 12; e++) {
      const e0 = EDGES[e][0], e1 = EDGES[e][1], v0 = val[e0], v1 = val[e1];
      if ((v0 < 0) === (v1 < 0)) continue;
      const t = v0 / (v0 - v1), p0 = CORNER[e0], p1 = CORNER[e1];
      sx += p0[0] + (p1[0] - p0[0]) * t; sy += p0[1] + (p1[1] - p0[1]) * t; sz += p0[2] + (p1[2] - p0[2]) * t; cnt++;
    }
    let px = o + (a + sx / cnt) * h, py = o + (b + sy / cnt) * h, pz = o + (c + sz / cnt) * h;
    // (its normal, from the field round it; then onto the surface along it (a step, kept within its cube): flat faces
    // flat and edges where they are, not the lattice's average of them)
    const e = 0.02;
    let nx = field(H, px + e, py, pz) - field(H, px - e, py, pz), ny = field(H, px, py + e, pz) - field(H, px, py - e, pz), nz = field(H, px, py, pz + e) - field(H, px, py, pz - e);
    const gl = Math.hypot(nx, ny, nz) / (2 * e), nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (gl > 0.2) {
      const f0 = field(H, px, py, pz), step = f0 / gl;
      const cx0 = o + a * h, cy0 = o + b * h, cz0 = o + c * h;
      px = Math.min(cx0 + h, Math.max(cx0, px - nx * step)); py = Math.min(cy0 + h, Math.max(cy0, py - ny * step)); pz = Math.min(cz0 + h, Math.max(cz0, pz - nz * step));
    }
    const a1 = field(H, px + nx * 0.18, py + ny * 0.18, pz + nz * 0.18), a2 = field(H, px + nx * 0.42, py + ny * 0.42, pz + nz * 0.42);
    const ao = Math.max(0, Math.min(1, 0.35 + 0.65 * (Math.min(a1 / 0.18, 1) * 0.45 + Math.min(a2 / 0.42, 1) * 0.55)));
    // (what the carving needs of the block whose surface this is)
    const [m, plain] = owner(H, P, px, py, pz);
    let q = 0, code = 0, aux = 13;
    if (m) {
      const r = m.r, [tx, tz] = thinning(r);
      q = Math.round(exposure(r) * 7) + 8 * Math.round(Math.min(tx, tz) * 7) + 64 * Math.round(Math.max(tx, tz) * 7) + 512 * (r.under ? 1 : 0) + 1024 * (r.level === 0 ? 1 : 0) + 2048 * (r.open[2] ? 1 : 0);
      code = r.code;
      aux = (m.a + 1) * 9 + (m.b + 1) * 3 + (m.c + 1) + 27 * r.frame + 216 * r.joins;
    }
    vid[cix(a, b, c)] = vs.length / VERTEX;
    vs.push(px, py, pz, nx, ny, nz, ao, q, code, aux, plain);
  }
  // (a quad across each edge the surface crosses, for the edges the cell owns: those from its lattice points 1..S)
  const is: number[] = [];
  for (let a = 1; a <= S; a++) for (let b = 1; b <= S; b++) for (let c = 1; c <= S; c++) {
    const v0 = f[ix(a, b, c)];
    for (let ax = 0; ax < 3; ax++) {
      const v1 = ax === 0 ? f[ix(a + 1, b, c)] : ax === 1 ? f[ix(a, b + 1, c)] : f[ix(a, b, c + 1)];
      if ((v0 < 0) === (v1 < 0)) continue;
      // (the four cubes round this edge)
      let i0, i1, i2, i3;
      if (ax === 0) { i0 = vid[cix(a, b - 1, c - 1)]; i1 = vid[cix(a, b, c - 1)]; i2 = vid[cix(a, b, c)]; i3 = vid[cix(a, b - 1, c)]; }
      else if (ax === 1) { i0 = vid[cix(a - 1, b, c - 1)]; i1 = vid[cix(a - 1, b, c)]; i2 = vid[cix(a, b, c)]; i3 = vid[cix(a, b, c - 1)]; }
      else { i0 = vid[cix(a - 1, b - 1, c)]; i1 = vid[cix(a, b - 1, c)]; i2 = vid[cix(a, b, c)]; i3 = vid[cix(a - 1, b, c)]; }
      if (i0 < 0 || i1 < 0 || i2 < 0 || i3 < 0) continue;
      if (v0 < 0) is.push(i0, i1, i2, i0, i2, i3);
      else is.push(i0, i2, i1, i0, i3, i2);
    }
  }
  return { v: new Float32Array(vs), i: new Uint32Array(is) };
}

export const clearShapes = () => cache.clear();
/** a shape already made, by its patch's name */
export const known = (name: string) => cache.get(name);
/** a shape made elsewhere (a worker), kept */
export function keep(name: string, m: Mesh) { if (cache.size > 20000) cache.clear(); cache.set(name, m); cacheStats.made++; }
/** the field at a point of a cell, from its patch (for tests) */
export const fieldAt = (p: Patch, x: number, y: number, z: number, D = 1) => field(hood(p.reads, p.floor), x, y, z, D);
/** a block's solid at a point relative to its centre, and the reach of its sides (for tests) */
export const solidAt = solid;
export const sideAt = (r: Read, i: number, y: number) => reach(prep(r), i, y);
