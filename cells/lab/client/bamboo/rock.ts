/**
 * Rock that breaks through the mountain, built as rock is (no drawing here: render.ts draws the blocks as they're
 * meshed; footing.ts stands on their tops, and sight is stopped by them).
 *
 * A **formation** has one way it's built: a bedding plane (its dip and roll) and its fractures (one yaw, the joints
 * across it). Its **blocks** are cut along those, so a ledge belongs to the face behind it and a fallen slab is the
 * shape of what's missing above. Three kinds:
 *
 * - **an escarpment**, where a cliff band breaks through (world.ts takes the band's smooth rise out of the ground, so the
 *   blocks are the cliff and the gaps between them go back to the foot): columns along the rim, each split by its bedding
 *   into tiers, the lower ones standing out as ledges, now and then a middle one set back under an overhanging lip, the
 *   crest broken up and down; narrow columns leave clefts; a slab fallen at the foot now and then;
 * - **a rooted outcrop**, out on the slope: a big slab tipped back into the hill, its neighbours along the same joints,
 *   a wedge broken off below, fragments;
 * - **running crowns**: low flat-topped blocks stepping along the contour, a way a fox could take.
 *
 * A block's a box chamfered at its edges and corners, its corners nudged, its top a little narrower; flat faces with
 * their own normals (a fracture is an edge, not a swell), the chamfers the older, rounded edges.
 */
import { hash } from '../kit/rng';

type V3 = [number, number, number];
export type BlockKind = 'column' | 'slab' | 'wedge' | 'crown' | 'fragment';
export interface Block {
  /** its middle; its axes (across, up, out), each unit; its half sizes along them */
  c: V3; ax: [V3, V3, V3]; h: V3;
  kind: BlockKind; seed: number; moss: number;
  /** a circle round it on the ground (for finding it), and its highest point */
  r: number; top: number;
  /** its faces as triangles, world space (x, y, z ×3 each); those facing up (what's stood on) as indices into them */
  tris: Float32Array; ups: Uint16Array;
}
/** what a formation needs of the land */
export interface RockLand {
  seed: number;
  /** the cliff field, its band (where the rise is) and its height there */
  cliffN(x: number, z: number): number; cliffH(x: number, z: number): number;
  /** the land without any cliff's rise; and the ground as it lies */
  under(x: number, z: number): number; ground(x: number, z: number): number;
  trailNear(x: number, z: number): { d: number };
}
/** where in the cliff field the band is (rise from 2% … 98%), and its rim */
export const BAND_LO = 0.6015, BAND_HI = 0.6165, RIM = 0.609;
const CHUNK = 32;

const u01 = (...n: number[]) => hash(...n.map((v) => Math.floor(v))) / 4294967296;
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** v turned about unit axis k by angle a */
function rot(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a), s = Math.sin(a), d = v[0] * k[0] + v[1] * k[1] + v[2] * k[2], x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
}
/** a formation's way of being built: its joints' yaw off the frame, its bedding's dip (about across) and roll */
interface Grain { yaw: number; dip: number; roll: number }
function grainAt(seed: number, x: number, z: number): Grain {
  const i = Math.floor(x / 40), j = Math.floor(z / 40);
  return { yaw: (u01(seed, i, j, 701) - 0.5) * 0.5, dip: -0.1 + u01(seed, i, j, 702) * 0.3, roll: (u01(seed, i, j, 703) - 0.5) * 0.14 };
}
/** axes for a block: the frame (across t, out o, up) turned by the grain and a little of its own */
function axes(t: V3, o: V3, g: Grain, s: number, jit = 1, tip = 0): [V3, V3, V3] {
  const up: V3 = [0, 1, 0];
  const yaw = g.yaw + (u01(s, 1) - 0.5) * 0.16 * jit;
  let X = rot(t, up, yaw), Z = rot(o, up, yaw), Y = up;
  const dip = g.dip + tip + (u01(s, 2) - 0.5) * 0.06 * jit, roll = g.roll + (u01(s, 3) - 0.5) * 0.06 * jit;
  Y = rot(Y, X, dip); Z = rot(Z, X, dip);
  X = rot(X, Z, roll); Y = rot(Y, Z, roll);
  return [nrm(X), nrm(Y), nrm(Z)];
}

/** how a block's broken: its top dropped toward a face (front, back, left, right), as a fraction of its height (a
 * crest stepping down, a wedge); how worn its edges are (0 a fresh fracture … 1 old and rounded) */
interface Cut { f?: number; b?: number; l?: number; r?: number; worn?: number }
/** a block, meshed: a box chamfered (edges and corners), its corners nudged, its top drawn in a little and broken down
 * toward a face or two */
function make(c: V3, ax: [V3, V3, V3], h: V3, kind: BlockKind, seed: number, moss: number, cut: Cut = {}): Block {
  const worn = cut.worn ?? 0.5, bev = Math.min(0.03 + 0.14 * worn, Math.min(h[0], h[1], h[2]) * (0.06 + 0.2 * worn)), taper = 0.03 + 0.08 * u01(seed, 10);
  const corner = (sx: number, sy: number, sz: number): V3 => {
    const k = (sx + 1) * 2 + (sy + 1) + (sz + 1) / 2, j = (q: number) => 1 + (u01(seed, k, q) - 0.5) * 0.16;
    const tp = sy > 0 ? 1 - taper : 1;
    // (the top broken down toward the faces it's cut to: the corners on that side lower)
    const drop = sy > 0 ? Math.min(0.88, (sz > 0 ? cut.f ?? 0 : cut.b ?? 0) + (sx > 0 ? cut.r ?? 0 : cut.l ?? 0)) * 2 * h[1] : 0;
    return [sx * h[0] * j(1) * tp, sy * h[1] * j(2) - drop, sz * h[2] * j(3) * tp];
  };
  const C = new Map<string, V3>();
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) C.set(`${sx}${sy}${sz}`, corner(sx, sy, sz));
  // (a corner pulled in along the face it's on: on face a, it's drawn in along the other two axes)
  const Q = (sx: number, sy: number, sz: number, a: number): V3 => {
    const p = C.get(`${sx}${sy}${sz}`)!, s = [sx, sy, sz];
    return p.map((v, i) => (i === a ? v : v - s[i] * bev)) as V3;
  };
  const world = (p: V3): V3 => add(add(add(c, ax[0], p[0]), ax[1], p[1]), ax[2], p[2]);
  const T: number[] = [], ups: number[] = [];
  const tri = (a: V3, b: V3, d: V3) => {
    const A = world(a), B = world(b), D = world(d);
    let n = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [D[0] - A[0], D[1] - A[1], D[2] - A[2]]);
    const m: V3 = [(A[0] + B[0] + D[0]) / 3 - c[0], (A[1] + B[1] + D[1]) / 3 - c[1], (A[2] + B[2] + D[2]) / 3 - c[2]];
    let o = [A, B, D];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) { o = [A, D, B]; n = [-n[0], -n[1], -n[2]]; }
    if (nrm(n)[1] > 0.3) ups.push(T.length / 9);
    for (const p of o) T.push(p[0], p[1], p[2]);
  };
  const quad = (a: V3, b: V3, d: V3, e: V3) => { tri(a, b, d); tri(a, d, e); };
  const S = [-1, 1];
  // (the faces: each a corner's pulled-in points on it, round)
  for (let a = 0; a < 3; a++) for (const s of S) {
    const [b, d] = [0, 1, 2].filter((q) => q !== a), pts: V3[] = [];
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const k = [0, 0, 0]; k[a] = s; k[b] = u; k[d] = v; pts.push(Q(k[0], k[1], k[2], a)); }
    quad(pts[0], pts[1], pts[2], pts[3]);
  }
  // (the chamfers along the edges: between the two faces meeting there)
  for (let a = 0; a < 3; a++) {
    const [b, d] = [0, 1, 2].filter((q) => q !== a);
    for (const sb of S) for (const sd of S) {
      const k0 = [0, 0, 0], k1 = [0, 0, 0]; k0[a] = -1; k1[a] = 1; k0[b] = k1[b] = sb; k0[d] = k1[d] = sd;
      quad(Q(k0[0], k0[1], k0[2], b), Q(k1[0], k1[1], k1[2], b), Q(k1[0], k1[1], k1[2], d), Q(k0[0], k0[1], k0[2], d));
    }
  }
  // (and the corners)
  for (const sx of S) for (const sy of S) for (const sz of S) tri(Q(sx, sy, sz, 0), Q(sx, sy, sz, 1), Q(sx, sy, sz, 2));
  const tris = new Float32Array(T);
  let top = -1e9;
  for (let k = 1; k < tris.length; k += 3) top = Math.max(top, tris[k]);
  return { c, ax, h, kind, seed, moss, r: Math.hypot(h[0], h[1], h[2]) * 1.1, top, tris, ups: Uint16Array.from(ups) };
}

/** the top of a block at (x, z): the highest of its upward faces over the point, or NaN if none is */
export function blockTop(b: Block, x: number, z: number): number {
  if (Math.abs(x - b.c[0]) > b.r || Math.abs(z - b.c[2]) > b.r) return NaN;
  let best = NaN;
  const T = b.tris;
  for (const f of b.ups) {
    const o = f * 9, ax = T[o], az = T[o + 2], bx = T[o + 3], bz = T[o + 5], cx = T[o + 6], cz = T[o + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
    const y = l1 * T[o + 1] + l2 * T[o + 4] + l3 * T[o + 7];
    if (!(y <= best)) best = y;
  }
  return best;
}
/** whether (x, y, z) is in a block (grown by `pad`) */
export function within(b: Block, x: number, y: number, z: number, pad = 0) {
  const d: V3 = [x - b.c[0], y - b.c[1], z - b.c[2]];
  for (let a = 0; a < 3; a++) if (Math.abs(d[0] * b.ax[a][0] + d[1] * b.ax[a][1] + d[2] * b.ax[a][2]) > b.h[a] + pad) return false;
  return true;
}

/** the formations anchored in chunk (ci, cj) */
export function rocksIn(L: RockLand, ci: number, cj: number): Block[] {
  // (each formation belongs to the chunk it's anchored in, though its blocks may reach over the edge)
  const x0 = ci * CHUNK, z0 = cj * CHUNK, out: Block[] = [];
  escarpment(L, x0, z0, out);
  outcrops(L, x0, z0, ci, cj, out);
  return out;
}

/** the trail's clear of a block's footprint */
function clearOfTrails(L: RockLand, c: V3, ax: [V3, V3, V3], h: V3, need: number) {
  for (const [u, v] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const x = c[0] + ax[0][0] * h[0] * u + ax[2][0] * h[2] * v, z = c[2] + ax[0][2] * h[0] * u + ax[2][2] * h[2] * v;
    if (L.trailNear(x, z).d < need) return false;
  }
  return true;
}
/** the lowest of the ground under a footprint (its middle, corners, sides) */
function lowest(L: RockLand, x: number, z: number, t: V3, o: V3, w: number, d: number, f = L.ground.bind(L)) {
  let lo = f(x, z);
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 1], [0, -1], [1, 0], [-1, 0]]) lo = Math.min(lo, f(x + t[0] * w * u + o[0] * d * v, z + t[2] * w * u + o[2] * d * v));
  return lo;
}

// ─── an escarpment: columns along the rim of a cliff band ───
function escarpment(L: RockLand, x0: number, z0: number, out: Block[]) {
  const s = L.seed, G = 2, n = (x: number, z: number) => L.cliffN(x, z);
  // (where the rim crosses a two-metre grid over the chunk: each a column's place, a column every couple of metres)
  const pts: [number, number][] = [];
  for (let j = 0; j <= CHUNK / G; j++) for (let i = 0; i <= CHUNK / G; i++) {
    const x = x0 + i * G, z = z0 + j * G, a = n(x, z) - RIM;
    for (const [dx, dz] of [[G, 0], [0, G]]) {
      const b = n(x + dx, z + dz) - RIM;
      if (a * b < 0) { const t = a / (a - b); pts.push([x + dx * t, z + dz * t]); }
    }
  }
  const kept: [number, number][] = [];
  for (const p of pts) if (!kept.some((q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < 2.3 * 2.3)) kept.push(p);
  for (const [px, pz] of kept) {
    if (px < x0 || px >= x0 + CHUNK || pz < z0 || pz >= z0 + CHUNK) continue;
    const e = 0.5, gx = (n(px + e, pz) - n(px - e, pz)) / (2 * e), gz = (n(px, pz + e) - n(px, pz - e)) / (2 * e), gl = Math.hypot(gx, gz);
    if (gl < 1e-6) continue;
    // (out: toward the foot; across: along the rim)
    const o: V3 = [-gx / gl, 0, -gz / gl], t: V3 = [o[2], 0, -o[0]];
    const hw = Math.min(6, Math.max(0.4, (BAND_HI - BAND_LO) / 2 / gl));
    if (L.trailNear(px, pz).d < 4.6) continue;
    const k = Math.round(px * 7.3) * 31 + Math.round(pz * 5.1);
    const g = grainAt(s, px, pz);
    const fx = px + o[0] * (hw + 0.4), fz = pz + o[2] * (hw + 0.4), bx = px - o[0] * (hw + 0.4), bz = pz - o[2] * (hw + 0.4);
    const foot = Math.min(L.under(fx, fz), L.under(px, pz)) - 0.6, crest = L.under(bx, bz) + L.cliffH(bx, bz);
    const H = crest - foot;
    // (its width: most broad, some narrow, so a cleft opens beside it, going back to the foot)
    const cleft = u01(s, k, 710) < 0.2, W = cleft ? 0.6 + u01(s, k, 711) * 0.3 : 0.9 + u01(s, k, 711) ** 1.5 * 2.2;
    // (its tiers, by the bedding: one, two or three, the lower standing out as ledges, a middle one now and then set back
    // under the lip of the one above; the top broken up and down)
    // (most a whole slab, or two; the joints between tiers each column's own, so they don't run on as courses)
    const tq = u01(s, k, 712), tiers = H > 6.5 ? (tq < 0.35 ? 1 : tq < 0.8 ? 2 : 3) : H > 3.6 ? (tq < 0.55 ? 1 : 2) : 1;
    const cuts = [0]; for (let m = 1; m < tiers; m++) cuts.push((m / tiers + (u01(s, k, 713 + m) - 0.5) * 0.45 / tiers) * H); cuts.push(H);
    const crown = (u01(s, k, 720) - 0.35) * 2.2;
    // (and the whole column leaning a little out or back, as it's parted from the rock behind)
    const lean = (u01(s, k, 719) - 0.4) * 0.16;
    const back = hw + 1.2;
    for (let m = 0; m < tiers; m++) {
      const lo = foot + cuts[m], hi = m === tiers - 1 ? foot + H + crown : foot + cuts[m + 1];
      const recess = m > 0 && m < tiers - 1 && u01(s, k, 730 + m) < 0.3;
      const front = m === 0 ? hw + 0.2 + u01(s, k, 721) * 1.1 : recess ? hw - 0.9 : hw - m * 0.45 + (u01(s, k, 722 + m) - 0.4) * 0.9;
      const dep = (front + back) / 2, mid = (front - back) / 2, hy = (hi - lo) / 2;
      if (hy < 0.15) continue;
      const ww = W * (1 - 0.08 * m) + (u01(s, k, 740 + m) - 0.5) * 0.3;
      const sd = s * 977 + k * 13 + m;
      const ax = axes(t, o, g, sd, 2.5, -lean);
      const c: V3 = [px + o[0] * mid + t[0] * (u01(s, k, 750 + m) - 0.5) * 0.4, (lo + hi) / 2, pz + o[2] * mid + t[2] * (u01(s, k, 750 + m) - 0.5) * 0.4];
      // (the top tier's crest broken: stepping down toward its face, or to a side; the lower ones' tops nearly level, a
      // ledge's)
      const top = m === tiers - 1, r = (q: number) => u01(sd, q);
      const side = r(22) < 0.4 ? r(23) * 0.22 : 0, cut: Cut = top ? { f: r(20) < 0.5 ? 0.06 + r(21) * 0.24 : 0, l: r(24) < 0.5 ? side : 0, r: r(24) >= 0.5 ? side : 0, worn: 0.3 + r(26) * 0.5 } : { f: r(20) * 0.06, l: r(22) * 0.05, worn: 0.15 + r(26) * 0.4 };
      // (a broad top tier split now and then along a joint into two, one standing higher)
      if (top && ww > 1.4 && r(30) < 0.45) {
        const a = ww * (0.35 + r(31) * 0.3), lift = (r(32) - 0.5) * 1.6;
        for (const [sg, half, dy] of [[-1, a, 0], [1, ww - a, lift]] as const) {
          const cc = add(add(c, ax[0], sg * (sg < 0 ? ww - half : ww - half) * 1), [0, 1, 0], dy / 2);
          out.push(make(cc, ax, [half - 0.06, hy + dy / 2, dep], 'column', r(33 + sg), 0.6 + 0.4 * r(4), { ...cut, f: (cut.f ?? 0) * (sg > 0 ? 1 : 0.4) }));
        }
        continue;
      }
      out.push(make(c, ax, [ww, hy, dep], 'column', r(3), top ? 0.6 + 0.4 * r(4) : 0.2 + 0.5 * r(4), cut));
    }
    // (a slab fallen from it, at the foot, tipped)
    if (u01(s, k, 760) < 0.3) {
      const d = hw + 1.2 + u01(s, k, 761) * 2, sz = 0.5 + u01(s, k, 762) * 0.7;
      const cx = px + o[0] * d + t[0] * (u01(s, k, 763) - 0.5) * 2, cz = pz + o[2] * d + t[2] * (u01(s, k, 763) - 0.5) * 2;
      if (L.trailNear(cx, cz).d > 1.4 + sz * 1.5) {
        const sd = s * 991 + k * 17, ax = axes(t, o, g, sd, 3, 0.35 + u01(sd, 5) * 0.4), h: V3 = [sz * 1.2, sz * 0.6, sz];
        const gy = lowest(L, cx, cz, t, o, h[0], h[2]);
        out.push(make([cx, gy + h[1] * 0.35, cz], ax, h, 'fragment', u01(sd, 3), 0.5 * u01(sd, 4), { f: 0.2 + u01(sd, 20) * 0.4, l: u01(sd, 21) * 0.3, worn: 0.2 + u01(sd, 22) * 0.4 }));
      }
    }
  }
}

// ─── outcrops out on the slope: rooted, and running crowns ───
function outcrops(L: RockLand, x0: number, z0: number, ci: number, cj: number, out: Block[]) {
  const s = L.seed, S = 8;
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
    // (out: down the fall; across: along the contour)
    const o: V3 = [-gx / sl, 0, -gz / sl], t: V3 = [o[2], 0, -o[0]], g = grainAt(s, px, pz), k = ci * 977 + cj * 131 + i * 7 + j;
    if (rooted) {
      // (a big slab tipped back into the hill; its neighbours along the same joints; a wedge broken off below)
      const W = 1.3 + u01(s, k, 810) * 1.1, H = 1.2 + u01(s, k, 811) * 1.2, D = 0.8 + u01(s, k, 812) * 0.7, tip = 0.35 + u01(s, k, 813) * 0.35;
      const parts: { u: number; v: number; w: number; hh: number; d: number; kind: BlockKind; tip: number }[] = [{ u: 0, v: 0, w: W, hh: H, d: D, kind: 'slab', tip }];
      const nb = 1 + Math.floor(u01(s, k, 814) * 3);
      for (let m = 0; m < nb; m++) {
        const side = m % 2 ? 1 : -1, f = 0.55 + u01(s, k, 815 + m) * 0.4;
        parts.push({ u: side * (W + W * f + 0.12 + u01(s, k, 820 + m) * 0.25) * (1 + Math.floor(m / 2)), v: (u01(s, k, 825 + m) - 0.4) * 1.2, w: W * f, hh: H * (0.5 + 0.45 * u01(s, k, 830 + m)), d: D * (0.8 + 0.3 * u01(s, k, 835 + m)), kind: 'slab', tip: tip * (0.6 + 0.6 * u01(s, k, 840 + m)) });
      }
      if (u01(s, k, 845) < 0.7) parts.push({ u: (u01(s, k, 846) - 0.5) * W, v: D + 0.9 + u01(s, k, 847) * 0.8, w: W * 0.45, hh: H * 0.4, d: D * 0.5, kind: 'wedge', tip: 0.5 + u01(s, k, 848) * 0.4 });
      for (let m = 0; m < 3; m++) if (u01(s, k, 850 + m) < 0.6) parts.push({ u: (u01(s, k, 853 + m) - 0.5) * W * 3, v: D + 0.5 + u01(s, k, 856 + m) * 2.5, w: 0.2 + u01(s, k, 859 + m) * 0.3, hh: 0.12 + u01(s, k, 862 + m) * 0.15, d: 0.2 + u01(s, k, 865 + m) * 0.25, kind: 'fragment', tip: u01(s, k, 868 + m) });
      parts.forEach((p, m) => {
        const cx = px + t[0] * p.u + o[0] * p.v, cz = pz + t[2] * p.u + o[2] * p.v, sd = s * 1013 + k * 19 + m, ax = axes(t, o, g, sd, p.kind === 'slab' ? 1 : 3, -p.tip);
        const h: V3 = [p.w, p.hh, p.d];
        if (!clearOfTrails(L, [cx, 0, cz], ax, h, 1.3)) return;
        const gy = lowest(L, cx, cz, t, o, p.w, p.d);
        // (set in: a third or more of it under, its downhill side deepest)
        // (broken: a slab's face cut back from its crest, a side dropped; a wedge most of the way; fragments anyhow)
        const r = (q: number) => u01(sd, q);
        const cut: Cut = p.kind === 'wedge' ? { f: 0.6 + r(20) * 0.25, l: r(21) * 0.2, worn: 0.2 + r(22) * 0.3 } : p.kind === 'fragment' ? { f: r(20) * 0.5, r: r(21) * 0.4, worn: r(22) * 0.6 } : { f: 0.12 + r(20) * 0.35, l: r(21) < 0.4 ? r(23) * 0.35 : 0, r: r(24) < 0.4 ? r(25) * 0.35 : 0, worn: 0.25 + r(22) * 0.45 };
        out.push(make([cx, gy + p.hh * (p.kind === 'fragment' ? 0.3 : 0.25), cz], ax, h, p.kind, r(3), 0.3 + 0.7 * r(4), cut));
      });
    } else {
      // (running crowns: a line of low flat tops stepping along the contour, a little apart, a little up and down)
      const n = 3 + Math.floor(u01(s, k, 870) * 4), dir = u01(s, k, 871) < 0.5 ? 1 : -1;
      let u = 0, rise = 0.6 + u01(s, k, 872) * 0.6;
      for (let m = 0; m < n; m++) {
        const w = 0.45 + u01(s, k, 873 + m) * 0.4, d = 0.5 + u01(s, k, 880 + m) * 0.35, v = (u01(s, k, 887 + m) - 0.5) * 0.6;
        const cx = px + t[0] * u * dir + o[0] * v, cz = pz + t[2] * u * dir + o[2] * v, sd = s * 1031 + k * 23 + m, ax = axes(t, o, g, sd, 0.6, 0);
        rise = Math.max(0.45, Math.min(1.5, rise + (u01(s, k, 894 + m) - 0.5) * 0.6));
        const gy = lowest(L, cx, cz, t, o, w, d), top = L.ground(cx, cz) + rise, hy = (top - (gy - 0.4)) / 2, h: V3 = [w, hy, d];
        if (clearOfTrails(L, [cx, 0, cz], ax, h, 1.1)) out.push(make([cx, top - hy, cz], ax, h, 'crown', u01(sd, 3), 0.4 + 0.6 * u01(sd, 4), { f: u01(sd, 20) * 0.05, l: u01(sd, 21) * 0.05, worn: 0.4 + u01(sd, 22) * 0.4 }));
        u += w * 2 + 0.25 + u01(s, k, 901 + m) * 0.55;
      }
    }
  }
}

/** a chunk's blocks as one mesh for the renderer: per corner its place, its face's normal, its place in its block
 * (for the shader's fractures and marks, about ±1), its moss, its seed */
export const ROCK_STRIDE = 13;
export function rockMesh(blocks: Block[]): Float32Array {
  let n = 0;
  for (const b of blocks) n += b.tris.length / 3;
  const out = new Float32Array(n * ROCK_STRIDE);
  let o = 0;
  for (const b of blocks) {
    const T = b.tris, sc = Math.max(b.h[0], b.h[1], b.h[2]);
    for (let f = 0; f < T.length; f += 9) {
      const A: V3 = [T[f], T[f + 1], T[f + 2]], B: V3 = [T[f + 3], T[f + 4], T[f + 5]], C: V3 = [T[f + 6], T[f + 7], T[f + 8]];
      const N = nrm(cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]));
      for (const p of [A, B, C]) {
        const d: V3 = [p[0] - b.c[0], p[1] - b.c[1], p[2] - b.c[2]];
        out.set([p[0], p[1], p[2], N[0], N[1], N[2], (d[0] * b.ax[0][0] + d[1] * b.ax[0][1] + d[2] * b.ax[0][2]) / sc, (d[0] * b.ax[1][0] + d[1] * b.ax[1][1] + d[2] * b.ax[1][2]) / sc, (d[0] * b.ax[2][0] + d[1] * b.ax[2][1] + d[2] * b.ax[2][2]) / sc, 1, 1, b.moss, b.seed], o);
        o += ROCK_STRIDE;
      }
    }
  }
  return out;
}
