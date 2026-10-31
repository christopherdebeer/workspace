/**
 * Rock that breaks through the mountain, built as rock is (no drawing here: render.ts draws the blocks as they're meshed,
 * strokes.ts inks their edges; footing.ts stands on their pads and sees past them; world.ts cuts the ground where they
 * stand).
 *
 * The **geology** is one field across the mountain, varying smoothly, never by cells: a bedding plane (its tilt, its
 * spacing, where its planes fall) and a grain (the yaw of its joints). Every block takes its up from the bedding and its
 * cut heights from its planes, so bedding runs on from one mass to the next, offset a little where a column has slumped.
 * A fallen fragment is a piece of the tier it came from, the same proportions and bedding, toppled.
 *
 * - **an escarpment**, where a cliff band breaks through. Its columns stand on anchors along the rim, chosen the same way
 *   wherever you ask (a point's kept if it outranks every rim point within 2.6 m), so a chunk's edge doesn't crowd or
 *   gap them. Each column reaches halfway to its neighbours, so together they cover the band; between a pair the pair
 *   decides (so both sides agree): most meet, some leave a **cleft** (a floor ramping up to a block set at its back),
 *   some are **one mass** across both (no joint between their tops). Tiers are cut by the bedding planes that cross the
 *   column; the lower stand out as ledges, a middle one now and then set back under the lip above; crests broken;
 * - **a rooted outcrop** out on the slope: a big slab tipped back into the hill, neighbours along the same joints, a wedge
 *   broken off below, fragments;
 * - **running crowns**: low flat tops stepping along the contour, a way a fox could take.
 *
 * A block's a box chamfered at its edges and corners, its corners nudged, its top drawn in and broken down toward a face,
 * now and then a vertical corner sheared off (a face cut obliquely through). Flat faces with their own normals; the
 * chamfers are its worn edges. Each block knows its corners (its edges, for the ink), its **pads** (where a foot can land:
 * the point, the slope, how much room), and its anchor (one place it asks how far it's drawn, so it's drawn whole).
 */
import { hash } from '../kit/rng';

type V3 = [number, number, number];
export type BlockKind = 'column' | 'slab' | 'wedge' | 'crown' | 'fragment';
/** what a block is in its formation: the top of a column (its crest), a lower tier (its lip a ledge), the back of a
 * cleft, out on the slope, or fallen */
export type Role = 'crest' | 'lip' | 'back' | 'outcrop' | 'fallen';
/** a foothold on a block's top: where, its slope's up-component, how much room round it (0 … 4) */
export interface Pad { x: number; y: number; z: number; ny: number; room: number; b: Block }
export interface Block {
  /** its middle; its axes (across, up, out), each unit; its half sizes along them */
  c: V3; ax: [V3, V3, V3]; h: V3;
  kind: BlockKind; role: Role; seed: number; moss: number;
  /** a circle round it on the ground (for finding it), and its highest point */
  r: number; top: number;
  /** its faces as triangles, world space (x, y, z ×3 each); which are worn edges (chamfers); those facing up (stood on) */
  tris: Float32Array; worn: Uint8Array; ups: Uint16Array;
  /** its eight corners, world space, index (sx > 0) + 2 (sy > 0) + 4 (sz > 0): its edges, for the ink */
  K: V3[];
  /** the one place it's asked how far it's drawn; its bedding (the plane's normal (x, z) and spacing) */
  anchor: V3; bed: [number, number, number];
  pads: Pad[];
}
/** what a formation needs of the land */
export interface RockLand {
  seed: number;
  /** the cliff field, its band (where the rise is) and its height there */
  cliffN(x: number, z: number): number; cliffH(x: number, z: number): number;
  /** the land without any cliff's rise; as it lies before trails; the ground as it lies */
  under(x: number, z: number): number; base(x: number, z: number): number; ground(x: number, z: number): number;
  trailNear(x: number, z: number): { d: number };
}
/** a cleft's floor: a strip across the band (across `t`, out `o`), from its back (v0) to its front (v1), ramping up to the
 * back */
export interface Floor { x: number; z: number; t: V3; o: V3; hu: number; v0: number; v1: number }
/** where in the cliff field the band is (rise from 2% … 98%), and its rim */
export const BAND_LO = 0.6015, BAND_HI = 0.6165, RIM = 0.609;
const CHUNK = 32;

// (fractional arguments kept: a seed of 0.37 is not a seed of 0)
const u01 = (...n: number[]) => hash(...n.map((v) => Math.floor(v * 4096))) / 4294967296;
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function rot(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a), d = dot(v, k), x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
}
/** smooth noise 0 … 1 (for the geology: it varies, never by cells) */
function vn(x: number, z: number, s: number) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number) => hash(a, b, s) / 4294967296;
  const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** the geology at (x, z): the bedding's normal, its spacing and phase; the joints' yaw off the frame */
interface Geo { bedN: V3; S: number; phase: number; yaw: number }
function geoAt(seed: number, x: number, z: number): Geo {
  const a = vn(x / 90, z / 90, seed + 701) * 6.283, tilt = 0.04 + 0.2 * vn(x / 110, z / 110, seed + 702);
  return { bedN: nrm([Math.sin(a) * Math.tan(tilt), 1, Math.cos(a) * Math.tan(tilt)]), S: 1.7 + 1.4 * vn(x / 70, z / 70, seed + 703), phase: vn(x / 130, z / 130, seed + 704) * 3, yaw: (vn(x / 60, z / 60, seed + 705) - 0.5) * 0.5 };
}
/** a bedding plane's height at (x, z): plane n of the field */
function planeY(g: Geo, x: number, z: number, n: number) { return (g.S * (n + g.phase / 3) - g.bedN[0] * x - g.bedN[2] * z) / g.bedN[1]; }
/** axes for a block: its up the bedding's normal; across, the frame's across turned by the joints' yaw (and a little of
 * its own), laid in the bedding; out, square to both; tipped about across by `tip` */
function axes(t: V3, g: Geo, s: number, jit = 1, tip = 0): [V3, V3, V3] {
  const yaw = g.yaw + (u01(s, 1) - 0.5) * 0.16 * jit;
  let Y = g.bedN;
  let X = rot(t, [0, 1, 0], yaw);
  X = nrm(sub(X, [Y[0] * dot(X, Y), Y[1] * dot(X, Y), Y[2] * dot(X, Y)]));
  let Z = cross(X, Y);
  const roll = (u01(s, 3) - 0.5) * 0.05 * jit;
  if (tip || roll) { Y = rot(Y, X, tip); Z = rot(Z, X, tip); X = rot(X, Z, roll); Y = rot(Y, Z, roll); }
  return [nrm(X), nrm(Y), nrm(Z)];
}

/** how a block's broken: its top dropped toward a face (front, back, left, right), as a fraction of its height; a vertical
 * corner sheared off (which: sx, sz; how far in, as a fraction); how worn its edges are (0 a fresh fracture … 1 old) */
interface Cut { f?: number; b?: number; l?: number; r?: number; worn?: number; notch?: [number, number, number] }
/** a block, meshed */
function make(c: V3, ax: [V3, V3, V3], h: V3, kind: BlockKind, role: Role, seed: number, moss: number, g: Geo, cut: Cut = {}): Block {
  const worn = cut.worn ?? 0.5, bev = Math.min(0.03 + 0.14 * worn, Math.min(h[0], h[1], h[2]) * (0.06 + 0.2 * worn)), taper = 0.03 + 0.08 * u01(seed, 10);
  const corner = (sx: number, sy: number, sz: number): V3 => {
    const k = (sx + 1) * 2 + (sy + 1) + (sz + 1) / 2, j = (q: number) => 1 + (u01(seed, k, q) - 0.5) * 0.16;
    const tp = sy > 0 ? 1 - taper : 1;
    const drop = sy > 0 ? Math.min(0.88, (sz > 0 ? cut.f ?? 0 : cut.b ?? 0) + (sx > 0 ? cut.r ?? 0 : cut.l ?? 0)) * 2 * h[1] : 0;
    // (a vertical corner sheared off: both its ends drawn in across and out, so that face is cut obliquely)
    const n = cut.notch && cut.notch[0] === sx && cut.notch[1] === sz ? cut.notch[2] : 0;
    return [sx * h[0] * j(1) * tp * (1 - n), sy * h[1] * j(2) - drop, sz * h[2] * j(3) * tp * (1 - n)];
  };
  const C = new Map<string, V3>();
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) C.set(`${sx}${sy}${sz}`, corner(sx, sy, sz));
  const Q = (sx: number, sy: number, sz: number, a: number): V3 => {
    const p = C.get(`${sx}${sy}${sz}`)!, s = [sx, sy, sz];
    return p.map((v, i) => (i === a ? v : v - s[i] * bev)) as V3;
  };
  const world = (p: V3): V3 => add(add(add(c, ax[0], p[0]), ax[1], p[1]), ax[2], p[2]);
  const T: number[] = [], W: number[] = [], ups: number[] = [];
  const tri = (a: V3, b: V3, d: V3, w: number) => {
    const A = world(a), B = world(b), D = world(d);
    let n = cross(sub(B, A), sub(D, A));
    const m: V3 = [(A[0] + B[0] + D[0]) / 3 - c[0], (A[1] + B[1] + D[1]) / 3 - c[1], (A[2] + B[2] + D[2]) / 3 - c[2]];
    let o = [A, B, D];
    if (dot(n, m) < 0) { o = [A, D, B]; n = [-n[0], -n[1], -n[2]]; }
    if (nrm(n)[1] > 0.3) ups.push(T.length / 9);
    for (const p of o) T.push(p[0], p[1], p[2]);
    W.push(w);
  };
  const quad = (a: V3, b: V3, d: V3, e: V3, w: number) => { tri(a, b, d, w); tri(a, d, e, w); };
  const S = [-1, 1];
  for (let a = 0; a < 3; a++) for (const s of S) {
    const [b, d] = [0, 1, 2].filter((q) => q !== a), pts: V3[] = [];
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const k = [0, 0, 0]; k[a] = s; k[b] = u; k[d] = v; pts.push(Q(k[0], k[1], k[2], a)); }
    quad(pts[0], pts[1], pts[2], pts[3], 0);
  }
  for (let a = 0; a < 3; a++) {
    const [b, d] = [0, 1, 2].filter((q) => q !== a);
    for (const sb of S) for (const sd of S) {
      const k0 = [0, 0, 0], k1 = [0, 0, 0]; k0[a] = -1; k1[a] = 1; k0[b] = k1[b] = sb; k0[d] = k1[d] = sd;
      quad(Q(k0[0], k0[1], k0[2], b), Q(k1[0], k1[1], k1[2], b), Q(k1[0], k1[1], k1[2], d), Q(k0[0], k0[1], k0[2], d), 1);
    }
  }
  for (const sx of S) for (const sy of S) for (const sz of S) tri(Q(sx, sy, sz, 0), Q(sx, sy, sz, 1), Q(sx, sy, sz, 2), 1);
  const tris = new Float32Array(T);
  let top = -1e9;
  for (let k = 1; k < tris.length; k += 3) top = Math.max(top, tris[k]);
  const K: V3[] = [];
  for (let i = 0; i < 8; i++) K.push(world(C.get(`${i & 1 ? 1 : -1}${i & 2 ? 1 : -1}${i & 4 ? 1 : -1}`)!));
  const b: Block = { c, ax, h, kind, role, seed, moss, r: Math.hypot(h[0], h[1], h[2]) * 1.1, top, tris, worn: Uint8Array.from(W), ups: Uint16Array.from(ups), K, anchor: [c[0], top, c[2]], bed: [g.bedN[0], g.bedN[2], g.S], pads: [] };
  b.pads = padsOf(b);
  return b;
}

/** the top of a block at (x, z), and its slope's up-component there: the highest of its upward faces over the point */
export function topAt(b: Block, x: number, z: number): [number, number] {
  if (Math.abs(x - b.c[0]) > b.r || Math.abs(z - b.c[2]) > b.r) return [NaN, 0];
  let best = NaN, ny = 0;
  const T = b.tris;
  for (const f of b.ups) {
    const o = f * 9, ax = T[o], az = T[o + 2], bx = T[o + 3], bz = T[o + 5], cx = T[o + 6], cz = T[o + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
    const y = l1 * T[o + 1] + l2 * T[o + 4] + l3 * T[o + 7];
    if (!(y <= best)) { best = y; const n = nrm(cross([bx - ax, T[o + 4] - T[o + 1], bz - az], [cx - ax, T[o + 7] - T[o + 1], cz - az])); ny = Math.abs(n[1]); }
  }
  return [best, ny];
}
export function blockTop(b: Block, x: number, z: number): number { return topAt(b, x, z)[0]; }
/** where a foot can land on a block: points over its top (its middle and round it), each kept if level enough, with
 * room (its neighbours a hand's breadth off on the same top) */
function padsOf(b: Block): Pad[] {
  const out: Pad[] = [], fx = Math.min(0.7, b.h[0] * 0.6), fz = Math.min(0.7, b.h[2] * 0.6);
  for (const [u, w] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
    const x = b.c[0] + b.ax[0][0] * fx * u + b.ax[2][0] * fz * w, z = b.c[2] + b.ax[0][2] * fx * u + b.ax[2][2] * fz * w, [y, ny] = topAt(b, x, z);
    if (!(ny >= 0.72)) continue;
    let room = 0;
    for (const [ox, oz] of [[0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) { const yy = blockTop(b, x + ox, z + oz); if (Math.abs(yy - y) < 0.1) room++; }
    if (room >= 2) out.push({ x, y, z, ny, room, b });
  }
  return out;
}
/** whether a segment from a to b passes through a block (through its faces: so what's under an overhang is open) */
export function blocksSegment(bl: Block, a: V3, b: V3): boolean {
  const d = sub(b, a), L2 = dot(d, d) || 1;
  const t = Math.max(0, Math.min(1, dot(sub(bl.c, a), d) / L2)), p = add(a, d, t);
  if (Math.hypot(p[0] - bl.c[0], p[1] - bl.c[1], p[2] - bl.c[2]) > bl.r) return false;
  const T = bl.tris;
  for (let o = 0; o < T.length; o += 9) {
    const e1: V3 = [T[o + 3] - T[o], T[o + 4] - T[o + 1], T[o + 5] - T[o + 2]], e2: V3 = [T[o + 6] - T[o], T[o + 7] - T[o + 1], T[o + 8] - T[o + 2]];
    const pv = cross(d, e2), det = dot(e1, pv);
    if (Math.abs(det) < 1e-9) continue;
    const tv: V3 = [a[0] - T[o], a[1] - T[o + 1], a[2] - T[o + 2]], u = dot(tv, pv) / det;
    if (u < 0 || u > 1) continue;
    const qv = cross(tv, e1), v = dot(d, qv) / det;
    if (v < 0 || u + v > 1) continue;
    const s = dot(e2, qv) / det;
    if (s > 0.001 && s < 0.999) return true;
  }
  return false;
}
/** whether (x, z) is inside a block's footprint, drawn in by `inset` */
export function covers(b: Block, x: number, z: number, inset = 0.2) {
  const dx = x - b.c[0], dz = z - b.c[2];
  const ux = b.ax[0][0], uz = b.ax[0][2], ul = Math.hypot(ux, uz) || 1, vx = b.ax[2][0], vz = b.ax[2][2], vl = Math.hypot(vx, vz) || 1;
  return Math.abs((dx * ux + dz * uz) / ul) < b.h[0] - inset && Math.abs((dx * vx + dz * vz) / vl) < b.h[2] - inset;
}
/** the floor of a cleft at (x, z), or NaN if it isn't one: ramping up from its front to its back */
export function floorAt(f: Floor, L: RockLand, x: number, z: number) {
  const dx = x - f.x, dz = z - f.z, u = dx * f.t[0] + dz * f.t[2], v = dx * f.o[0] + dz * f.o[2];
  if (Math.abs(u) > f.hu || v < f.v0 || v > f.v1) return NaN;
  return L.under(x, z) - 0.25 + 0.7 * ((f.v1 - v) / (f.v1 - f.v0)) ** 1.5;
}

/** the trail's clear of a block's footprint */
function clearOfTrails(L: RockLand, c: V3, ax: [V3, V3, V3], h: V3, need: number) {
  for (const [u, v] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const x = c[0] + ax[0][0] * h[0] * u + ax[2][0] * h[2] * v, z = c[2] + ax[0][2] * h[0] * u + ax[2][2] * h[2] * v;
    if (L.trailNear(x, z).d < need) return false;
  }
  return true;
}
function lowest(f: (x: number, z: number) => number, x: number, z: number, t: V3, o: V3, w: number, d: number) {
  let lo = f(x, z);
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) lo = Math.min(lo, f(x + t[0] * w * u + o[0] * d * v, z + t[2] * w * u + o[2] * d * v));
  return lo;
}

// ─── an escarpment ───
export interface Anchor { x: number; z: number; pr: number }
/** the rim's anchors in a box: where the rim crosses a two-metre grid laid on the world, each kept if it outranks every
 * other rim point within 2.6 m (so the same anchors whoever asks) */
export function anchors(L: RockLand, x0: number, z0: number, x1: number, z1: number): Anchor[] {
  const G = 2, R = 2.6, s = L.seed, n = (x: number, z: number) => L.cliffN(x, z) - RIM;
  const i0 = Math.floor((x0 - 3) / G), i1 = Math.ceil((x1 + 3) / G), j0 = Math.floor((z0 - 3) / G), j1 = Math.ceil((z1 + 3) / G);
  const W = i1 - i0 + 2, N = new Float32Array(W * (j1 - j0 + 2));
  for (let j = j0; j <= j1 + 1; j++) for (let i = i0; i <= i1 + 1; i++) N[i - i0 + (j - j0) * W] = n(i * G, j * G);
  const pts: Anchor[] = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const a = N[i - i0 + (j - j0) * W];
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const b = N[i + di - i0 + (j + dj - j0) * W];
      if (a * b < 0) { const t = a / (a - b); pts.push({ x: (i + di * t) * G, z: (j + dj * t) * G, pr: hash(i, j, di, s + 706) / 4294967296 }); }
    }
  }
  const cell = new Map<string, Anchor[]>(), key = (x: number, z: number) => `${Math.floor(x / 3)},${Math.floor(z / 3)}`;
  for (const p of pts) { const k = key(p.x, p.z); (cell.get(k) ?? cell.set(k, []).get(k)!).push(p); }
  return pts.filter((p) => {
    if (p.x < x0 || p.x >= x1 || p.z < z0 || p.z >= z1) return false;
    const ci = Math.floor(p.x / 3), cj = Math.floor(p.z / 3);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of cell.get(`${ci + a},${cj + b}`) ?? []) {
      if (q !== p && (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < R * R && q.pr > p.pr) return false;
    }
    return true;
  });
}
/** a pair of neighbours' shared decision: 0 … 1, the same from either side */
const pairOf = (s: number, p: Anchor, q: Anchor) => (p.pr < q.pr ? u01(s, p.pr * 1e3, q.pr * 1e3, 707) : u01(s, q.pr * 1e3, p.pr * 1e3, 707));

/** the escarpment anchored in chunk (ci, cj): its blocks, and its clefts' floors (none of it asks the ground, so the
 * ground can ask it where it stands) */
export function escarpIn(L: RockLand, ci: number, cj: number): { blocks: Block[]; floors: Floor[] } {
  const s = L.seed, x0 = ci * CHUNK, z0 = cj * CHUNK, blocks: Block[] = [], floors: Floor[] = [];
  const near = anchors(L, x0 - 8, z0 - 8, x0 + CHUNK + 8, z0 + CHUNK + 8).filter((p) => L.trailNear(p.x, p.z).d >= 4.6);
  const n = (x: number, z: number) => L.cliffN(x, z);
  for (const p of near) {
    if (p.x < x0 || p.x >= x0 + CHUNK || p.z < z0 || p.z >= z0 + CHUNK) continue;
    const { x: px, z: pz } = p, e = 0.5, gx = (n(px + e, pz) - n(px - e, pz)) / (2 * e), gz = (n(px, pz + e) - n(px, pz - e)) / (2 * e), gl = Math.hypot(gx, gz);
    if (gl < 1e-6) continue;
    const o: V3 = [-gx / gl, 0, -gz / gl], t: V3 = [o[2], 0, -o[0]];
    const hw = Math.min(6, Math.max(0.4, (BAND_HI - BAND_LO) / 2 / gl)), g = geoAt(s, px, pz), k = p.pr * 1e4;
    // (its neighbours along the rim, either side: it reaches halfway to each, or where the pair leaves a cleft, short of it)
    let L0: Anchor | null = null, R0: Anchor | null = null, sL = -1e9, sR = 1e9;
    for (const q of near) {
      if (q === p) continue;
      const dx = q.x - px, dz = q.z - pz, al = dx * t[0] + dz * t[2], ac = dx * o[0] + dz * o[2];
      if (Math.abs(ac) > 3 || Math.abs(al) > 7) continue;
      if (al < 0 && al > sL) { sL = al; L0 = q; } else if (al > 0 && al < sR) { sR = al; R0 = q; }
    }
    const side = (q: Anchor | null, d: number) => {
      if (!q) return { reach: 1.6, cleft: 0, merge: false };
      const pk = pairOf(s, p, q), gap = 0.55 + 0.6 * u01(s, pk * 1e3, 708);
      return pk < 0.17 ? { reach: Math.max(0.35, Math.abs(d) / 2 - gap / 2), cleft: gap, merge: false } : { reach: Math.abs(d) / 2 + 0.12, cleft: 0, merge: pk < 0.3 };
    };
    const left = side(L0, sL), right = side(R0, sR);
    const w = Math.min(3.4, (left.reach + right.reach) / 2), shift = (right.reach - left.reach) / 2;
    const fx = px + o[0] * (hw + 0.4), fz = pz + o[2] * (hw + 0.4), bx = px - o[0] * (hw + 0.4), bz = pz - o[2] * (hw + 0.4);
    const foot = Math.min(L.under(fx, fz), L.under(px, pz)) - 0.6, crest = L.under(bx, bz) + L.cliffH(bx, bz);
    // (tiers cut by the bedding's planes where they cross it, some of them; each column slumped a little its own way)
    const slump = (u01(s, k, 709) - 0.5) * 0.35, cuts: number[] = [];
    for (let m = -60; m <= 60 && cuts.length < 2; m++) {
      const y = planeY(g, px, pz, m) + slump;
      if (y > foot + 1 && y < crest - 0.8 && u01(s, k, m + 70, 710) < 0.7) cuts.push(y);
    }
    const ys = [foot, ...cuts, crest + (u01(s, k, 720) - 0.35) * 2];
    const lean = (u01(s, k, 719) - 0.4) * 0.14, back = hw + 1.2;
    // (one mass with its right neighbour across their tops: this top reaches over both, and that one has none of its own)
    const merged = right.merge && R0 !== null && p.pr > R0.pr, skipTop = left.merge && L0 !== null && L0.pr > p.pr;
    let top: Block | null = null;
    for (let m = 0; m < ys.length - 1; m++) {
      const isTop = m === ys.length - 2;
      if (isTop && skipTop) continue;
      const lo = ys[m], hi = ys[m + 1], hy = (hi - lo) / 2;
      if (hy < 0.15) continue;
      const recess = m > 0 && !isTop && u01(s, k, 730 + m) < 0.3;
      const front = m === 0 ? hw + 0.2 + u01(s, k, 721) * 1.1 : recess ? hw - 0.9 : hw - m * 0.45 + (u01(s, k, 722 + m) - 0.4) * 0.9;
      const dep = (front + back) / 2, mid = (front - back) / 2;
      const ww = (w + (isTop && merged ? Math.abs(sR) / 2 : 0)) * (1 - 0.06 * m), sh = shift + (isTop && merged ? Math.abs(sR) / 2 : 0);
      const sd = s * 977 + k * 13 + m, r = (q: number) => u01(sd, q);
      const ax = axes(t, g, sd, 2.5, -lean);
      const c: V3 = [px + o[0] * mid + t[0] * sh, (lo + hi) / 2, pz + o[2] * mid + t[2] * sh];
      const sideCut = r(22) < 0.4 ? r(23) * 0.22 : 0;
      const cut: Cut = isTop ? { f: r(20) < 0.5 ? 0.06 + r(21) * 0.24 : 0, l: r(24) < 0.5 ? sideCut : 0, r: r(24) >= 0.5 ? sideCut : 0, worn: 0.3 + r(26) * 0.5 } : { f: r(20) * 0.06, l: r(22) * 0.05, worn: 0.15 + r(26) * 0.4 };
      if (r(27) < 0.3) cut.notch = [r(28) < 0.5 ? -1 : 1, 1, 0.2 + r(29) * 0.3];
      const b = make(c, ax, [ww, hy, dep], 'column', isTop ? 'crest' : 'lip', r(3), isTop ? 0.6 + 0.4 * r(4) : 0.35 + 0.5 * r(4), g, cut);
      blocks.push(b);
      if (isTop) top = b;
    }
    // (a cleft beside it, if it's the pair's owner (the one that outranks the other): a floor up the gap ramping to a block
    // set at its back)
    for (const [sd0, q, d, gap] of [[1, R0, sR, right.cleft], [-1, L0, sL, left.cleft]] as const) {
      if (!gap || !q || p.pr < q.pr) continue;
      const gc = d / 2, cx = px + t[0] * gc, cz = pz + t[2] * gc, bk = hw * 0.25;
      floors.push({ x: cx, z: cz, t, o, hu: gap / 2 + 0.3, v0: -bk - 0.3, v1: hw + 1.4 });
      const sd = s * 991 + k * 31 + sd0, ax = axes(t, g, sd, 1);
      const lo = foot - 0.4, hi = crest + (u01(sd, 5) - 0.5) * 0.6, dep = (back - bk) / 2;
      blocks.push(make([cx - o[0] * (bk + dep), (lo + hi) / 2, cz - o[2] * (bk + dep)], ax, [gap / 2 + 0.35, (hi - lo) / 2, dep], 'column', 'back', u01(sd, 3), 0.7, g, { f: u01(sd, 20) * 0.1, worn: 0.4 }));
    }
    // (a piece of its top tier fallen at the foot: its proportions and bedding, toppled)
    if (top && u01(s, k, 760) < 0.3) {
      const f = 0.3 + u01(s, k, 762) * 0.25, h: V3 = [Math.min(1.2, top.h[0] * f), Math.min(0.7, top.h[1] * f * 0.6), Math.min(1, top.h[2] * f)];
      const d = hw + 1.2 + u01(s, k, 761) * 2, cx = px + o[0] * d + t[0] * (u01(s, k, 763) - 0.5) * 2, cz = pz + o[2] * d + t[2] * (u01(s, k, 763) - 0.5) * 2;
      if (L.trailNear(cx, cz).d > 1.4 + h[0] * 1.5) {
        const topple = (u01(s, k, 764) < 0.5 ? -1 : 1) * (0.6 + u01(s, k, 765) * 0.7), ax: [V3, V3, V3] = [top.ax[0], rot(top.ax[1], top.ax[0], topple), rot(top.ax[2], top.ax[0], topple)];
        const gy = lowest((x, z) => L.base(x, z), cx, cz, t, o, h[0], h[2]);
        blocks.push(make([cx, gy + h[1] * 0.4, cz], ax, h, 'fragment', 'fallen', u01(s, k, 766), 0.5 * u01(s, k, 767), g, { f: 0.2 + u01(s, k, 768) * 0.3, worn: 0.25 + u01(s, k, 769) * 0.4 }));
      }
    }
  }
  return { blocks, floors };
}

// ─── outcrops out on the slope: rooted, and running crowns ───
export function outcropsIn(L: RockLand, ci: number, cj: number): Block[] {
  const s = L.seed, S = 8, x0 = ci * CHUNK, z0 = cj * CHUNK, out: Block[] = [];
  for (let j = 0; j < CHUNK / S; j++) for (let i = 0; i < CHUNK / S; i++) {
    const r = u01(s, ci * 4 + i, cj * 4 + j, 800);
    const rooted = r < 0.07, crowns = !rooted && r < 0.12;
    if (!rooted && !crowns) continue;
    const px = x0 + (i + 0.2 + 0.6 * u01(s, ci * 4 + i, cj * 4 + j, 801)) * S, pz = z0 + (j + 0.2 + 0.6 * u01(s, ci * 4 + i, cj * 4 + j, 802)) * S;
    const nn = L.cliffN(px, pz);
    if (nn > BAND_LO - 0.006 && nn < BAND_HI + 0.006) continue;
    const q = L.trailNear(px, pz);
    if (q.d < (crowns ? 2.6 : 4)) continue;
    const e = 1, gx = (L.ground(px + e, pz) - L.ground(px - e, pz)) / 2, gz = (L.ground(px, pz + e) - L.ground(px, pz - e)) / 2, sl = Math.hypot(gx, gz);
    if (sl < 0.08 || sl > 1.1) continue;
    const o: V3 = [-gx / sl, 0, -gz / sl], t: V3 = [o[2], 0, -o[0]], g = geoAt(s, px, pz), k = ci * 977 + cj * 131 + i * 7 + j;
    const gr = (x: number, z: number) => L.ground(x, z);
    if (rooted) {
      // (a big slab tipped back into the hill; its neighbours along the same joints; a wedge broken off below)
      const W = 1.3 + u01(s, k, 810) * 1.1, H = 1.2 + u01(s, k, 811) * 1.2, D = 0.8 + u01(s, k, 812) * 0.7, tip = 0.35 + u01(s, k, 813) * 0.35;
      const parts: { u: number; v: number; w: number; hh: number; d: number; kind: BlockKind; tip: number }[] = [{ u: 0, v: 0, w: W, hh: H, d: D, kind: 'slab', tip }];
      const nb = 1 + Math.floor(u01(s, k, 814) * 3);
      for (let m = 0; m < nb; m++) {
        const sd = m % 2 ? 1 : -1, f = 0.55 + u01(s, k, 815 + m) * 0.4;
        parts.push({ u: sd * (W + W * f + 0.12 + u01(s, k, 820 + m) * 0.25) * (1 + Math.floor(m / 2)), v: (u01(s, k, 825 + m) - 0.4) * 1.2, w: W * f, hh: H * (0.5 + 0.45 * u01(s, k, 830 + m)), d: D * (0.8 + 0.3 * u01(s, k, 835 + m)), kind: 'slab', tip: tip * (0.6 + 0.6 * u01(s, k, 840 + m)) });
      }
      if (u01(s, k, 845) < 0.7) parts.push({ u: (u01(s, k, 846) - 0.5) * W, v: D + 0.9 + u01(s, k, 847) * 0.8, w: W * 0.45, hh: H * 0.4, d: D * 0.5, kind: 'wedge', tip: 0.5 + u01(s, k, 848) * 0.4 });
      for (let m = 0; m < 3; m++) if (u01(s, k, 850 + m) < 0.6) parts.push({ u: (u01(s, k, 853 + m) - 0.5) * W * 3, v: D + 0.5 + u01(s, k, 856 + m) * 2.5, w: 0.2 + u01(s, k, 859 + m) * 0.3, hh: 0.12 + u01(s, k, 862 + m) * 0.15, d: 0.2 + u01(s, k, 865 + m) * 0.25, kind: 'fragment', tip: u01(s, k, 868 + m) });
      parts.forEach((pt, m) => {
        const cx = px + t[0] * pt.u + o[0] * pt.v, cz = pz + t[2] * pt.u + o[2] * pt.v, sd = s * 1013 + k * 19 + m, ax = axes(t, g, sd, pt.kind === 'slab' ? 1 : 3, -pt.tip);
        const h: V3 = [pt.w, pt.hh, pt.d];
        if (!clearOfTrails(L, [cx, 0, cz], ax, h, 1.3)) return;
        const gy = lowest(gr, cx, cz, t, o, pt.w, pt.d), rr = (q: number) => u01(sd, q);
        const cut: Cut = pt.kind === 'wedge' ? { f: 0.6 + rr(20) * 0.25, l: rr(21) * 0.2, worn: 0.2 + rr(22) * 0.3 } : pt.kind === 'fragment' ? { f: rr(20) * 0.5, r: rr(21) * 0.4, worn: rr(22) * 0.6 } : { f: 0.12 + rr(20) * 0.35, l: rr(21) < 0.4 ? rr(23) * 0.35 : 0, r: rr(24) < 0.4 ? rr(25) * 0.35 : 0, worn: 0.25 + rr(22) * 0.45 };
        if (pt.kind === 'slab' && rr(27) < 0.35) cut.notch = [rr(28) < 0.5 ? -1 : 1, rr(30) < 0.5 ? -1 : 1, 0.25 + rr(29) * 0.3];
        out.push(make([cx, gy + pt.hh * (pt.kind === 'fragment' ? 0.3 : 0.25), cz], ax, h, pt.kind, pt.kind === 'fragment' ? 'fallen' : 'outcrop', rr(3), 0.3 + 0.7 * rr(4), g, cut));
      });
    } else {
      // (running crowns: a line of low flat tops stepping along the contour, a little apart, a little up and down)
      const n = 3 + Math.floor(u01(s, k, 870) * 4), dir = u01(s, k, 871) < 0.5 ? 1 : -1;
      let u = 0, rise = 0.6 + u01(s, k, 872) * 0.6;
      for (let m = 0; m < n; m++) {
        const w = 0.45 + u01(s, k, 873 + m) * 0.4, d = 0.5 + u01(s, k, 880 + m) * 0.35, v = (u01(s, k, 887 + m) - 0.5) * 0.6;
        const cx = px + t[0] * u * dir + o[0] * v, cz = pz + t[2] * u * dir + o[2] * v, sd = s * 1031 + k * 23 + m, ax = axes(t, g, sd, 0.6, 0);
        rise = Math.max(0.45, Math.min(1.5, rise + (u01(s, k, 894 + m) - 0.5) * 0.6));
        const gy = lowest(gr, cx, cz, t, o, w, d), top = L.ground(cx, cz) + rise, hy = (top - (gy - 0.4)) / 2, h: V3 = [w, hy, d];
        if (clearOfTrails(L, [cx, 0, cz], ax, h, 1.1)) out.push(make([cx, top - hy, cz], ax, h, 'crown', 'outcrop', u01(sd, 3), 0.4 + 0.6 * u01(sd, 4), g, { f: u01(sd, 20) * 0.05, l: u01(sd, 21) * 0.05, worn: 0.4 + u01(sd, 22) * 0.4 }));
        u += w * 2 + 0.25 + u01(s, k, 901 + m) * 0.55;
      }
    }
  }
  return out;
}

/** a chunk's blocks as one mesh for the renderer, per corner: its place, its face's normal, its place in its block (about
 * ±1) [0–8]; its bedding's normal (x, z), its moss (by what the block is and where the face looks), its seed [9–12]; its
 * block's anchor [13–15]; whether it's a worn edge, and the bedding's spacing [16–17] */
export const ROCK_STRIDE = 18;
export function rockMesh(blocks: Block[]): Float32Array {
  let n = 0;
  for (const b of blocks) n += b.tris.length / 3;
  const out = new Float32Array(n * ROCK_STRIDE);
  let o = 0;
  for (const b of blocks) {
    const T = b.tris, sc = Math.max(b.h[0], b.h[1], b.h[2]);
    for (let f = 0, ti = 0; f < T.length; f += 9, ti++) {
      const A: V3 = [T[f], T[f + 1], T[f + 2]], B: V3 = [T[f + 3], T[f + 4], T[f + 5]], C: V3 = [T[f + 6], T[f + 7], T[f + 8]];
      const N = nrm(cross(sub(B, A), sub(C, A)));
      // (moss where it's held: a ledge's top (under the lip above), a cleft's back block; little on faces, none beneath)
      const moss = b.moss * (N[1] > 0.6 ? (b.role === 'lip' || b.role === 'back' ? 1.3 : 1) : N[1] < -0.2 ? 0 : b.role === 'lip' ? 0.5 : 0.25);
      for (const p of [A, B, C]) {
        const d = sub(p, b.c);
        out.set([p[0], p[1], p[2], N[0], N[1], N[2], dot(d, b.ax[0]) / sc, dot(d, b.ax[1]) / sc, dot(d, b.ax[2]) / sc, b.bed[0], b.bed[1], moss, b.seed, b.anchor[0], b.anchor[1], b.anchor[2], b.worn[ti], b.bed[2]], o);
        o += ROCK_STRIDE;
      }
    }
  }
  return out;
}
