/**
 * The shape of the blocks: one distance field over the whole build, the smooth union of every block's own solid, each
 * as its read (rules.ts) makes it, and cut out of it cell by cell (surface nets). Because the field is one function
 * of where you are, two cells that meet agree on their shared face exactly: no seams, whatever was built in what order.
 *
 * A block's own solid: a box, rounded where it's open and running on into a neighbour where it's joined (so a join is
 * no groove, and the union fills the corner between them with a fillet); how round, and how soft the fillets, from how
 * dense the build is round it. Then what it plays: a column narrowed, with a base and a capital; a span with its share
 * of an arch cut from under it; a corbel tapered; a wall thinner across, with windows let into it; a roof edge with a
 * parapet and battlements; a plinth along the ground; a pebble alone.
 *
 * A cell's mesh depends on the reads of the cells two each way round it, so it's named by them and kept: the same
 * arrangement anywhere is the same mesh, made once.
 */
import { ROLE, code, type Read } from './rules';

/** how round a block's open edges, by how dense the build round it is */
const ROUND = [0.3, 0.19, 0.11, 0.06];
/** how soft the fillets where blocks meet */
const BLEND = [0.22, 0.14, 0.085, 0.05];
/** samples along a cell's edge */
export const S = 6;

const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
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
/** an ellipse's distance (near enough), in the plane (u, v), half-axes a, b */
const ellipse = (u: number, v: number, a: number, b: number) => (Math.sqrt((u / a) * (u / a) + (v / b) * (v / b)) - 1) * Math.min(a, b);

/** a block's own solid, at p relative to its centre */
export function solid(r: Read, px: number, py: number, pz: number): number {
  if (r.role === ROLE.none) return 1e3;
  const rr = ROUND[r.dense], j = r.joins, ext = rr + 0.04;
  if (r.role === ROLE.pebble) { facing(px, py, pz, -0.44, 0.44, -0.5, 0.36, -0.44, 0.44); return box(px, py, pz, -0.44, 0.44, -0.5, 0.36, -0.44, 0.44, 0.3); }
  // (its own box: a column narrowed, a wall thinner across)
  let x0 = -0.5, x1 = 0.5, z0 = -0.5, z1 = 0.5;
  const y0 = -0.5, y1 = 0.5;
  if (r.role === ROLE.column) { x0 = -0.3; x1 = 0.3; z0 = -0.3; z1 = 0.3; }
  if (r.role === ROLE.wall) {
    // (its open faces drawn in)
    if (!(j & 3)) { x0 = -0.4; x1 = 0.4; }
    if (!(j & 48)) { z0 = -0.4; z1 = 0.4; }
  }
  const rb = r.role === ROLE.column ? Math.min(rr, 0.08) : rr;
  // (on into each neighbour it's joined to, one way at a time (so the rounding's inside the join, and nothing's put in
  // the corner between two neighbours that isn't theirs); the nearest of these is its surface)
  const ex0 = j & 2 ? -0.5 - ext : x0, ex1 = j & 1 ? 0.5 + ext : x1, ey0 = j & 8 ? -0.5 - ext : y0, ey1 = j & 4 ? 0.5 + ext : y1, ez0 = j & 32 ? -0.5 - ext : z0, ez1 = j & 16 ? 0.5 + ext : z1;
  const dx = box(px, py, pz, ex0, ex1, y0, y1, z0, z1, rb), dy = box(px, py, pz, x0, x1, ey0, ey1, z0, z1, rb), dz = box(px, py, pz, x0, x1, y0, y1, ez0, ez1, rb);
  let d = Math.min(dx, dy, dz);
  // (which way it faces: those of the boxes nearest it, weighed, so it turns from one to another without a jump)
  let gx = 0, gy = 0, gz = 0;
  const wx = 1 - (dx - d) / 0.08, wy = 1 - (dy - d) / 0.08, wz = 1 - (dz - d) / 0.08;
  if (wx > 0) { facing(px, py, pz, ex0, ex1, y0, y1, z0, z1); gx += GX * wx; gy += GY * wx; gz += GZ * wx; }
  if (wy > 0) { facing(px, py, pz, x0, x1, ey0, ey1, z0, z1); gx += GX * wy; gy += GY * wy; gz += GZ * wy; }
  if (wz > 0) { facing(px, py, pz, x0, x1, y0, y1, ez0, ez1); gx += GX * wz; gy += GY * wz; gz += GZ * wz; }
  const gl = len3(gx, gy, gz) || 1;
  GX = gx / gl; GY = gy / gl; GZ = gz / gl;
  // ─── what it adds ───
  if (r.role === ROLE.column) {
    if (r.ends & 1) d = smin(d, box(px, py, pz, -0.43, 0.43, -0.5, -0.32, -0.43, 0.43, 0.05), 0.08);
    if (r.ends & 2) d = smin(d, box(px, py, pz, -0.45, 0.45, 0.3, 0.5, -0.45, 0.45, 0.05), 0.08);
  }
  if (r.plinth) {
    if (r.plinth & 1) d = smin(d, box(px, py, pz, 0.3, 0.58, -0.5, -0.32, -0.5, 0.5, 0.04), 0.05);
    if (r.plinth & 2) d = smin(d, box(px, py, pz, -0.58, -0.3, -0.5, -0.32, -0.5, 0.5, 0.04), 0.05);
    if (r.plinth & 4) d = smin(d, box(px, py, pz, -0.5, 0.5, -0.5, -0.32, 0.3, 0.58, 0.04), 0.05);
    if (r.plinth & 8) d = smin(d, box(px, py, pz, -0.5, 0.5, -0.5, -0.32, -0.58, -0.3, 0.04), 0.05);
  }
  if (r.merlons) {
    for (let s = 0; s < 4; s++) {
      if (!(r.merlons & (1 << (s + 4)))) continue;
      // (a parapet along the open side; a merlon on it, or the gap)
      const sx = s === 0 ? 1 : s === 1 ? -1 : 0, sz = s === 2 ? 1 : s === 3 ? -1 : 0;
      const n0 = 0.3, n1 = 0.5, top = r.merlons & (1 << s) ? 0.86 : 0.64;
      const [ax0, ax1, az0, az1] = sx ? (sx > 0 ? [n0, n1, -0.5, 0.5] : [-n1, -n0, -0.5, 0.5]) : sz > 0 ? [-0.5, 0.5, n0, n1] : [-0.5, 0.5, -n1, -n0];
      d = smin(d, box(px, py, pz, ax0, ax1, 0.3, top, az0, az1, 0.04), 0.05);
    }
  }
  // ─── what it takes away ───
  if (r.windows) {
    for (let f = 0; f < 6; f++) {
      if (!(r.windows & (1 << f))) continue;
      const nx = f === 0 ? 1 : f === 1 ? -1 : 0, nz = f === 4 ? 1 : f === 5 ? -1 : 0;
      // (a window let into the face: a slot with a rounded head)
      const cx = nx * 0.4, cz = nz * 0.4;
      const w = nx ? box(px, py, pz, cx - 0.16, cx + 0.16, -0.22, 0.2, -0.13, 0.13, 0.11) : box(px, py, pz, -0.13, 0.13, -0.22, 0.2, cz - 0.16, cz + 0.16, 0.11);
      d = Math.max(d, -w);
    }
  }
  // (nothing under it: its own underside too, so no sliver of it is left where its neighbour's cell is empty)
  if (r.under) d = Math.max(d, soffit(r.under, px, py, pz));
  return d;
}

/** the reads of the cells round a cell (two each way), as a little array, and the cell's own name from them */
/** `floor`: how high the cell is over the ground (up to 3: higher, the ground's out of reach) */
export type Patch = { reads: Read[]; name: string; floor: number };
export const PATCH = 5;
const at = (a: number, b: number, c: number) => ((a + 2) * PATCH + (b + 2)) * PATCH + (c + 2);

/** what the field at a point needs, made once for a cell: for each cell the point can be in (the cell and those round
 * it), how soft the union there, and the filled cells within one of it, that one first, each with the box its solid
 * lies in */
type Near = { r: Read; a: number; b: number; c: number; x0: number; x1: number; y0: number; z0: number; z1: number };
type Hood = { k: number[]; near: Near[][]; own: Read[]; ground: number };
function hood(P: Read[], floor = 3): Hood {
  const k: number[] = [], near: Near[][] = [], owns: Read[] = [];
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
    const list: Near[] = [], own = P[at(ox, oy, oz)];
    k.push(BLEND[own.dense]); owns.push(own);
    for (let a = ox - 1; a <= ox + 1; a++) for (let b = oy - 1; b <= oy + 1; b++) for (let c = oz - 1; c <= oz + 1; c++) {
      const r = P[at(a, b, c)];
      if (r.role === ROLE.none) continue;
      // (the box its solid lies in, a little over, for the fillets its additions are blended in with)
      const j = r.joins;
      const n: Near = { r, a, b, c, x0: (j & 2 ? -0.84 : -0.58) - 0.03, x1: (j & 1 ? 0.84 : 0.58) + 0.03, y0: (j & 8 ? -0.84 : -0.5) - 0.03, z0: (j & 32 ? -0.84 : -0.58) - 0.03, z1: (j & 16 ? 0.84 : 0.58) + 0.03 };
      if (a === ox && b === oy && c === oz) list.unshift(n); else list.push(n);
    }
    near.push(list);
  }
  // (where the ground is, under the cell's centre: the stone goes no lower)
  return { k, near, own: owns, ground: floor < 3 ? -0.5 - floor : -1e9 };
}

/** the field at a point of a cell (x/D, y/D, z/D relative to its centre): the cell whose region the point is in decides
 * how soft the union; every filled cell within one of that is in it, that one first, the others unless too far off to
 * touch the union. The samples are given as whole numbers of steps (D = S), so two cells reckon a sample they share
 * with the same arithmetic, to the last bit: a face lying on a sample plane (as every open face does) is on the same
 * side of it from both. */
function field(H: Hood, x: number, y: number, z: number, D = 1): number {
  // (the cell the point is in: the one above, on a boundary, so both sides agree)
  const half = D / 2;
  const ox = Math.floor((x + half) / D + 1e-7), oy = Math.floor((y + half) / D + 1e-7), oz = Math.floor((z + half) / D + 1e-7);
  const o = ((ox + 1) * 3 + (oy + 1)) * 3 + (oz + 1), k = H.k[o], list = H.near[o], own = H.own[o];
  let d = 1e3, gx = 0, gy = 0, gz = 0;
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    const px = (x - n.a * D) / D, py = (y - n.b * D) / D, pz = (z - n.c * D) / D;
    if (d < 1e3 && Math.max(n.x0 - px, px - n.x1, n.y0 - py, py - 0.9, n.z0 - pz, pz - n.z1) >= d + k) continue;
    const s = solid(n.r, px, py, pz);
    if (d >= 1e3) { d = s; gx = GX; gy = GY; gz = GZ; continue; }
    // (a fillet only where surfaces meet at an angle: two faces running on in one plane are one face, not a seam with
    // a ridge along it, as a smooth union would make of them)
    const kk = k * Math.min(1, Math.max(0, 1 - (gx * GX + gy * GY + gz * GZ)));
    if (kk < 1e-4) { if (s < d) { d = s; gx = GX; gy = GY; gz = GZ; } continue; }
    const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (s - d)) / kk));
    d = s + (d - s) * h - kk * h * (1 - h);
    gx = GX + (gx - GX) * h; gy = GY + (gy - GY) * h; gz = GZ + (gz - GZ) * h;
    const gl = len3(gx, gy, gz) || 1; gx /= gl; gy /= gl; gz /= gl;
  }
  // (nothing below the ground: every block's foot is cut level with it, in the cell it stands in)
  if (d < 1e3) d = Math.max(d, H.ground - y / D);
  // (a block with nothing under it: its underside rises from what stands round it, whatever reaches into it)
  if (own.under && d < 1e3) {
    const lx = (x - ox * D) / D, ly = (y - oy * D) / D, lz = (z - oz * D) / D;
    d = Math.max(d, soffit(own.under, lx, ly, lz));
  }
  return d;
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

/** a cell's mesh, in its own coordinates: positions, normals, occlusion and tint (8 floats a vertex), and triangles */
export type Mesh = { v: Float32Array; i: Uint32Array };
const cache = new Map<string, Mesh>();
export const cacheStats = { hits: 0, made: 0 };
const NONE: Mesh = { v: new Float32Array(0), i: new Uint32Array(0) };

/** a cell's patch: the reads of the cells two each way round it */
export function patch(readAt: (x: number, y: number, z: number) => Read, x: number, y: number, z: number): Patch {
  const reads: Read[] = new Array(PATCH ** 3);
  let name = '', any = false;
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) {
    const r = readAt(x + a, y + b, z + c);
    reads[at(a, b, c)] = r;
    if (r.role !== ROLE.none && Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) <= 1) any = true;
    name += code(r) + ',';
  }
  const floor = Math.max(0, Math.min(y, 3));
  return { reads, name: any ? `${floor}|${name}` : '', floor };
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
    // (its tint: what the block it's on plays, from the cell it's in)
    const ocx = Math.max(-1, Math.min(1, Math.round(px))), ocy = Math.max(-1, Math.min(1, Math.round(py))), ocz = Math.max(-1, Math.min(1, Math.round(pz)));
    const r = P[at(ocx, ocy, ocz)].role !== ROLE.none ? P[at(ocx, ocy, ocz)] : P[at(0, 0, 0)];
    vid[cix(a, b, c)] = vs.length / 8;
    vs.push(px, py, pz, nx, ny, nz, ao, r.role + r.dense * 0.1);
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
