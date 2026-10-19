/**
 * A cat's body, as triangles, for each moment: soft and rounded, a few facets left in it (sculpted, not furred), its
 * ears, paws and tail readable from the usual distance, hardly a face. Drawn with the stone (the same vertices, its own
 * material, render.ts), so it takes the sun's shadows, casts its own, and is inked like everything else.
 *
 * - **A pose** says where the body's parts are, in the cat's own frame: its spine (rump, middle, chest, the neck's
 *   base), its head (where, which way it faces), its four feet, how its hind feet's long bones stand, how its tail is
 *   carried, its ears. Poses are blended (`mix`), so it goes from one to the next through the ones between.
 * - **Its legs** are found from where its feet are: each from its hip or shoulder to its foot, bending at the knee (or
 *   elbow) the way a cat's do (`knee`).
 * - **Its body** is a tube along a curve through the spine, round at the rump, deepest at the chest, narrowing to the
 *   neck; it breathes. Its tail's a tube too, carried from the rump and curving as the pose says, lying along the
 *   ground where it reaches it.
 * - **Walking** moves the feet in a cat's order (left hind, left fore, right hind, right fore), each planted while the
 *   body passes over it and lifted forward (`gait`).
 *
 * The frame: forward +x, up +y, the cat's left +z (its own units: a body ≈ 1 long from rump to nose, its shoulder 0.4
 * high standing); in the room it's scaled by `S` and turned to face `yaw` (and tipped by `pitch`, going up a stair).
 */
import { STRIDE } from './mesh';

export type V3 = [number, number, number];
/** a cat's material: marked over the stone's (render.ts reads `FUR + coat`) */
export const FUR = 512;
/** how big a cat is in the room, against a cell (1 across, 1 high, a storey): as a cat is against a storey, so it walks a
 * balustrade's rail (0.17 wide, a third of a level up) as a cat walks a rail */
export const S = 0.14;

export interface Pose {
  /** the spine: rump, middle, chest, the neck's base; and the head's middle */
  R: V3; M: V3; C: V3; N: V3; H: V3;
  /** which way the head faces (yaw: + to its left; pitch: + up) and its tilt */
  hy: number; hp: number; ht: number;
  /** the feet: left hind, right hind, left fore, right fore (where each paw meets what it stands on) */
  f: [V3, V3, V3, V3];
  /** how steep the hind feet's long bones stand: 0 flat along the ground (sitting), 1 upright */
  hock: number;
  /** the tail: how high it's carried at its root (radians up from straight back), how it curves up along it, how it
   * swings to the side along it (wrapping round), how its tip curls */
  tl: number; tc: number; ts: number; tk: number;
  /** its ears: 0 up and forward, 1 back */
  ear: number;
}

const P = (R: V3, M: V3, C: V3, N: V3, H: V3, head: [number, number, number], f: [V3, V3, V3, V3], hock: number, tail: [number, number, number, number], ear: number): Pose =>
  ({ R, M, C, N, H, hy: head[0], hp: head[1], ht: head[2], f, hock, tl: tail[0], tc: tail[1], ts: tail[2], tk: tail[3], ear });

/** the poses it's put together from (the motion sheet: assess, gather, reach, land; watch, groom, curl, stretch) */
export const POSES = {
  stand: P([-0.3, 0.42, 0], [-0.03, 0.41, 0], [0.22, 0.4, 0], [0.34, 0.47, 0], [0.43, 0.56, 0], [0, -0.15, 0], [[-0.31, 0, 0.065], [-0.31, 0, -0.065], [0.24, 0, 0.055], [0.24, 0, -0.055]], 0.75, [1.15, 0.6, 0, 0.7], 0),
  walk: P([-0.3, 0.41, 0], [-0.03, 0.4, 0], [0.22, 0.39, 0], [0.35, 0.45, 0], [0.45, 0.52, 0], [0, -0.2, 0], [[-0.31, 0, 0.065], [-0.31, 0, -0.065], [0.24, 0, 0.055], [0.24, 0, -0.055]], 0.75, [1.0, 0.7, 0, 0.6], 0),
  sit: P([-0.16, 0.13, 0], [-0.07, 0.28, 0], [0, 0.43, 0], [0.04, 0.53, 0], [0.09, 0.64, 0], [0, -0.05, 0], [[0.04, 0, 0.09], [0.04, 0, -0.09], [0.1, 0, 0.045], [0.1, 0, -0.045]], 0.05, [-0.15, 0, 2.2, 0.3], 0),
  loaf: P([-0.27, 0.12, 0], [-0.02, 0.13, 0], [0.2, 0.14, 0], [0.31, 0.25, 0], [0.39, 0.33, 0], [0, -0.1, 0], [[-0.1, 0, 0.1], [-0.1, 0, -0.1], [0.36, 0, 0.05], [0.36, 0, -0.05]], 0, [-0.2, 0, 1.6, 0.3], 0.1),
  curl: P([-0.18, 0.11, -0.1], [0.03, 0.12, -0.16], [0.21, 0.12, -0.07], [0.25, 0.1, 0.07], [0.13, 0.09, 0.15], [2.4, -0.3, 0.5], [[-0.1, 0, -0.02], [-0.12, 0, -0.14], [0.1, 0, -0.02], [0.17, 0, -0.1]], 0, [-0.3, 0, 2.8, 0.4], 0.3),
  groom: P([-0.16, 0.13, 0], [-0.07, 0.28, 0], [0, 0.43, 0], [0.04, 0.52, 0], [0.13, 0.56, 0.04], [0.3, -0.7, 0.3], [[0.04, 0, 0.09], [0.04, 0, -0.09], [0.17, 0.42, 0.05], [0.1, 0, -0.045]], 0.05, [-0.15, 0, 2.2, 0.3], 0.1),
  stretch: P([-0.3, 0.46, 0], [-0.04, 0.34, 0], [0.2, 0.2, 0], [0.34, 0.22, 0], [0.44, 0.3, 0], [0, 0.35, 0], [[-0.36, 0, 0.065], [-0.36, 0, -0.065], [0.56, 0, 0.055], [0.56, 0, -0.055]], 0.85, [1.4, 0.9, 0, 0.8], 0.4),
  gather: P([-0.25, 0.25, 0], [0, 0.24, 0], [0.22, 0.25, 0], [0.33, 0.31, 0], [0.43, 0.37, 0], [0, -0.05, 0], [[-0.2, 0, 0.07], [-0.2, 0, -0.07], [0.28, 0, 0.05], [0.28, 0, -0.05]], 0.25, [-0.05, 0.15, 0, 0.1], 0.2),
  reach: P([-0.32, 0.42, 0], [-0.02, 0.45, 0], [0.26, 0.46, 0], [0.39, 0.52, 0], [0.49, 0.57, 0], [0, -0.1, 0], [[-0.62, 0.32, 0.06], [-0.6, 0.36, -0.06], [0.62, 0.33, 0.05], [0.6, 0.3, -0.05]], 0.3, [0.25, 0.2, 0, 0.3], 0.3),
  land: P([-0.3, 0.5, 0], [-0.02, 0.42, 0], [0.24, 0.3, 0], [0.36, 0.33, 0], [0.46, 0.38, 0], [0, -0.25, 0], [[-0.45, 0.2, 0.065], [-0.42, 0.24, -0.065], [0.34, 0, 0.055], [0.32, 0, -0.055]], 0.5, [1.2, 0.5, 0, 0.5], 0.2),
  assess: P([-0.32, 0.4, 0], [-0.05, 0.4, 0], [0.2, 0.38, 0], [0.33, 0.42, 0], [0.45, 0.44, 0], [0, -0.55, 0], [[-0.31, 0, 0.065], [-0.31, 0, -0.065], [0.27, 0, 0.055], [0.27, 0, -0.055]], 0.75, [0.5, 0.5, 0, 0.6], 0),
  sniff: P([-0.3, 0.42, 0], [-0.03, 0.39, 0], [0.22, 0.34, 0], [0.34, 0.33, 0], [0.45, 0.25, 0], [0, -0.75, 0], [[-0.31, 0, 0.065], [-0.31, 0, -0.065], [0.26, 0, 0.055], [0.26, 0, -0.055]], 0.75, [0.8, 0.5, 0, 0.6], 0),
} satisfies Record<string, Pose>;
export type PoseName = keyof typeof POSES;

const L3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** a pose part way to another */
export function mix(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const n = (x: number, y: number) => x + (y - x) * t;
  return {
    R: L3(a.R, b.R, t), M: L3(a.M, b.M, t), C: L3(a.C, b.C, t), N: L3(a.N, b.N, t), H: L3(a.H, b.H, t),
    hy: n(a.hy, b.hy), hp: n(a.hp, b.hp), ht: n(a.ht, b.ht),
    f: [L3(a.f[0], b.f[0], t), L3(a.f[1], b.f[1], t), L3(a.f[2], b.f[2], t), L3(a.f[3], b.f[3], t)],
    hock: n(a.hock, b.hock), tl: n(a.tl, b.tl), tc: n(a.tc, b.tc), ts: n(a.ts, b.ts), tk: n(a.tk, b.tk), ear: n(a.ear, b.ear),
  };
}
/** a pose with the head turned toward something (yaw to its left, pitch up), the neck taking a little of it */
export function look(p: Pose, yaw: number, pitch: number): Pose {
  if (!yaw && !pitch) return p;
  const y = Math.max(-1.6, Math.min(1.6, yaw)), dx = p.H[0] - p.N[0], dz = p.H[2] - p.N[2], a = y * 0.55, c = Math.cos(a), s = Math.sin(a);
  return { ...p, H: [p.N[0] + dx * c - dz * s, p.H[1] + pitch * 0.04, p.N[2] + dx * s + dz * c], hy: p.hy + y, hp: p.hp + pitch };
}
/**
 * Walking: the feet in a cat's order, each planted while the body passes over it, then lifted and swung forward;
 * `phase` is how far it's gone (in strides), `stride` how long a stride is (in its units). The body rises a little
 * over each planted foot; the head nods.
 */
export function gait(p: Pose, phase: number, stride = 0.3, lift = 0.07): Pose {
  const off = [0, 0.5, 0.25, 0.75], DUTY = 0.62;
  const f = p.f.map((v, q) => {
    const ph = (((phase + off[q]) % 1) + 1) % 1;
    let x: number, y = v[1];
    if (ph < DUTY) x = stride / 2 - (ph / DUTY) * stride;
    else { const s = (ph - DUTY) / (1 - DUTY); x = -stride / 2 + s * stride; y += Math.sin(s * Math.PI) * lift; }
    return [v[0] + x, y, v[2]] as V3;
  }) as Pose['f'];
  const bob = Math.cos(phase * Math.PI * 4) * 0.008, up = (v: V3): V3 => [v[0], v[1] + bob, v[2]];
  return { ...p, R: up(p.R), M: up(p.M), C: up(p.C), N: up(p.N), H: [p.H[0], p.H[1] + bob * 1.6, p.H[2]], f, ts: p.ts + Math.sin(phase * Math.PI * 2) * 0.25 };
}

/** where a joint bends between a root and a target, for two bones (lengths l1, l2), toward `pole` */
export function knee(a: V3, b: V3, l1: number, l2: number, pole: V3): V3 {
  const d = sub(b, a), L = Math.max(1e-6, len(d)), u = scale(d, 1 / L);
  if (L >= l1 + l2) return add(a, scale(u, l1 * L / (l1 + l2)));
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  // (the pole, square to the line from root to target)
  let q = sub(pole, scale(u, dot(pole, u)));
  if (len(q) < 1e-6) q = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return add(add(a, scale(u, x)), scale(norm(q), h));
}

/** how the body moves at this moment: breathing (its phase), the tail's tip twitching, an ear flicking (0..1 each) */
export interface Stir { t: number; breath: number; twitch: number; flick: number }
/** where it is and how it's coloured: its ground point, which way it faces, tipped how, its coat and its own shade */
export interface Place { x: number; y: number; z: number; yaw: number; pitch: number; coat: number; tone: number; scale?: number }

// ─── a little vector arithmetic ───
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** a smooth curve through points: each span cut into `n` */
function smoothThrough(p: V3[], n: number): V3[] {
  const out: V3[] = [];
  for (let s = 0; s < p.length - 1; s++) {
    const p0 = p[Math.max(0, s - 1)], p1 = p[s], p2 = p[s + 1], p3 = p[Math.min(p.length - 1, s + 2)];
    for (let q = 0; q < n; q++) {
      const t = q / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)) as V3);
    }
  }
  out.push(p[p.length - 1]);
  return out;
}
const lerpTable = (tab: Array<[number, number]>, t: number) => {
  for (let q = 1; q < tab.length; q++) if (t <= tab[q][0]) { const [a, va] = tab[q - 1], [b, vb] = tab[q]; return va + (vb - va) * ((t - a) / (b - a)); }
  return tab[tab.length - 1][1];
};
/** the body's depth along it (rump 0 .. the head's base 1) */
const BODY: Array<[number, number]> = [[0, 0.12], [0.14, 0.135], [0.42, 0.13], [0.66, 0.138], [0.82, 0.105], [0.93, 0.078], [1, 0.072]];

/** where the triangles go: a buffer that grows (STRIDE floats a vertex), and how much of it's used */
export class Out {
  data = new Float32Array(1 << 16); n = 0;
  room(k: number) { if (this.n + k > this.data.length) { const d = new Float32Array(Math.max(this.data.length * 2, this.n + k)); d.set(this.data.subarray(0, this.n)); this.data = d; } }
  get count() { return this.n / STRIDE; }
}
// (one cat's vertices in its own frame, and its triangles, before they're turned into the room's)
const VP = new Float64Array(3 * 4096), VN = new Float64Array(3 * 4096), VC = new Float64Array(4096), IX = new Uint16Array(3 * 8192);
let nv = 0, ni = 0;
const vtx = (p: V3, n: V3, c: number) => { VP[nv * 3] = p[0]; VP[nv * 3 + 1] = p[1]; VP[nv * 3 + 2] = p[2]; VN[nv * 3] = n[0]; VN[nv * 3 + 1] = n[1]; VN[nv * 3 + 2] = n[2]; VC[nv] = c; return nv++; };
const tri3 = (a: number, b: number, c: number) => { IX[ni++] = a; IX[ni++] = b; IX[ni++] = c; };
/** the triangles from `from` on wound so their faces are outward, as the normals say (each part's are wound alike, so
 * the first says for all) */
function orient(from: number, each = false) {
  for (let t = from; t < ni; t += 3) {
    const a = IX[t] * 3, b = IX[t + 1] * 3, c = IX[t + 2] * 3;
    const ux = VP[b] - VP[a], uy = VP[b + 1] - VP[a + 1], uz = VP[b + 2] - VP[a + 2], vx = VP[c] - VP[a], vy = VP[c + 1] - VP[a + 1], vz = VP[c + 2] - VP[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * fx + fy * fy + fz * fz < 1e-14 && !each) continue;
    const flip = fx * (VN[a] + VN[b] + VN[c]) + fy * (VN[a + 1] + VN[b + 1] + VN[c + 1]) + fz * (VN[a + 2] + VN[b + 2] + VN[c + 2]) < 0;
    if (!each) { if (flip) for (let q = from; q < ni; q += 3) { const x = IX[q + 1]; IX[q + 1] = IX[q + 2]; IX[q + 2] = x; } return; }
    if (flip) { const x = IX[t + 1]; IX[t + 1] = IX[t + 2]; IX[t + 2] = x; }
  }
}

/**
 * A cat, as it's posed now, into `out` (STRIDE floats a vertex: the stone's own layout, its material `FUR + coat`, and
 * where on the body each vertex is (`part × 10 + along`) in the slot the stone uses for how it rises).
 */
export function cat(out: Out, at: Place, pose: Pose, stir: Stir): void {
  nv = 0; ni = 0;
  /** a tube along points, its radius at each (up and across, so it can be deeper than it's wide), round at the ends */
  const tube = (pts: V3[], rv: number[], rh: number[], sides: number, ref: V3, part: number, caps: [boolean, boolean]) => {
    const t0 = ni, n = pts.length, tan: V3[] = pts.map((_, q) => norm(sub(pts[Math.min(n - 1, q + 1)], pts[Math.max(0, q - 1)])));
    // (frames carried along it, so it doesn't twist)
    const ups: V3[] = [];
    let up = sub(ref, scale(tan[0], dot(ref, tan[0])));
    if (len(up) < 1e-4) up = Math.abs(tan[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    up = norm(up);
    for (let q = 0; q < n; q++) { let u = sub(up, scale(tan[q], dot(up, tan[q]))); if (len(u) < 1e-5) u = up; up = norm(u); ups.push(up); }
    const ring = (c: V3, t: V3, u: V3, v: number, h: number, cap: number, code: number) => {
      const sd = cross(t, u), first = nv, iv = 1 / Math.max(1e-4, v), ih = 1 / Math.max(1e-4, h), cc = Math.sqrt(1 - cap * cap);
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const p: V3 = [c[0] + u[0] * ca * v + sd[0] * sa * h, c[1] + u[1] * ca * v + sd[1] * sa * h, c[2] + u[2] * ca * v + sd[2] * sa * h];
        let nn = norm([u[0] * ca * iv + sd[0] * sa * ih, u[1] * ca * iv + sd[1] * sa * ih, u[2] * ca * iv + sd[2] * sa * ih]);
        if (cap) nn = norm([nn[0] * cc + t[0] * cap, nn[1] * cc + t[1] * cap, nn[2] * cc + t[2] * cap]);
        vtx(p, nn, code);
      }
      return first;
    };
    const rings: number[] = [];
    const code = (q: number) => part * 10 + Math.min(0.999, q / Math.max(1, n - 1));
    const capRings = (q: number, sgn: number) => {
      const t = scale(tan[q], sgn), r = Math.max(rv[q], rh[q]);
      return [0.45, 0.8].map((s) => ring(add(pts[q], scale(t, s * r)), tan[q], ups[q], rv[q] * Math.sqrt(1 - s * s), rh[q] * Math.sqrt(1 - s * s), s * sgn, code(q)));
    };
    if (caps[0]) rings.push(...capRings(0, -1).reverse());
    for (let q = 0; q < n; q++) rings.push(ring(pts[q], tan[q], ups[q], rv[q], rh[q], 0, code(q)));
    if (caps[1]) rings.push(...capRings(n - 1, 1));
    for (let q = 0; q + 1 < rings.length; q++) for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides, a = rings[q] + s, b = rings[q] + s1, c = rings[q + 1] + s1, d = rings[q + 1] + s;
      tri3(a, b, c); tri3(a, c, d);
    }
    orient(t0);
    const apex = (q: number, sgn: number, rg: number) => {
      const a0 = ni, t = scale(tan[q], sgn), r = Math.max(rv[q], rh[q]), tip = vtx(add(pts[q], scale(t, r)), t, code(q));
      for (let s = 0; s < sides; s++) tri3(rg + s, rg + ((s + 1) % sides), tip);
      orient(a0);
    };
    if (caps[0]) apex(0, -1, rings[0]);
    if (caps[1]) apex(n - 1, 1, rings[rings.length - 1]);
  };
  /** an ellipsoid: its middle, its three half-axes (square to each other) */
  const blob = (c: V3, ax: V3, ay: V3, az: V3, part: number, la = 6, lo = 9) => {
    const t0 = ni, lx = len(ax), ly = len(ay), lz = len(az), ux = norm(ax), uy = norm(ay), uz = norm(az), first = nv;
    for (let i = 0; i <= la; i++) for (let j = 0; j < lo; j++) {
      const ph = -Math.PI / 2 + (i / la) * Math.PI, th = (j / lo) * Math.PI * 2, a = Math.cos(ph) * Math.cos(th), b = Math.sin(ph), d = Math.cos(ph) * Math.sin(th);
      vtx(add(c, add(add(scale(ax, a), scale(ay, b)), scale(az, d))), norm(add(add(scale(ux, a / lx), scale(uy, b / ly)), scale(uz, d / lz))), part * 10 + (i / la) * 0.999);
    }
    const V = (i: number, j: number) => first + i * lo + (j % lo);
    for (let i = 0; i < la; i++) for (let j = 0; j < lo; j++) {
      if (i > 0) tri3(V(i, j), V(i, j + 1), V(i + 1, j + 1));
      if (i < la - 1) tri3(V(i, j), V(i + 1, j + 1), V(i + 1, j));
    }
    orient(t0);
  };

  // ─── the head: which way it faces ───
  const ch = Math.cos(pose.hp), F: V3 = [ch * Math.cos(pose.hy), Math.sin(pose.hp), ch * Math.sin(pose.hy)];
  const U0: V3 = [-Math.sin(pose.hp) * Math.cos(pose.hy), ch, -Math.sin(pose.hp) * Math.sin(pose.hy)], Sd0 = cross(F, U0);
  const U = add(scale(U0, Math.cos(pose.ht)), scale(Sd0, Math.sin(pose.ht))), Sd = cross(F, U);

  // ─── the body: rump to the head's base, breathing ───
  const base = add(pose.H, add(scale(F, -0.06), scale(U, -0.02)));
  const spine = smoothThrough([pose.R, pose.M, pose.C, pose.N, base], 3);
  let arc = 0; const at01 = [0];
  for (let q = 1; q < spine.length; q++) { arc += len(sub(spine[q], spine[q - 1])); at01.push(arc); }
  const breathe = 1 + 0.035 * Math.sin(stir.breath * Math.PI * 2);
  const rv = at01.map((a) => { const t = a / arc; return lerpTable(BODY, t) * (t > 0.35 && t < 0.8 ? breathe : 1); });
  const rh = rv.map((r, q) => r * (at01[q] / arc < 0.25 ? 0.95 : 0.86));
  tube(spine, rv, rh, 10, [0, 1, 0], 0, [true, false]);

  // ─── the head: round, a short muzzle, ears ───
  blob(pose.H, scale(F, 0.105), scale(U, 0.095), scale(Sd, 0.11), 1);
  blob(add(pose.H, add(scale(F, 0.075), scale(U, -0.03))), scale(F, 0.048), scale(U, 0.04), scale(Sd, 0.05), 5, 4, 7);
  for (const side of [1, -1]) {
    const flick = side === 1 ? stir.flick : 0, back = Math.min(1, pose.ear + flick * 0.6);
    const c = add(pose.H, add(add(scale(U, 0.062), scale(Sd, side * 0.052)), scale(F, -0.005)));
    const tip = add(c, add(add(scale(U, 0.075 * (1 - back * 0.45)), scale(Sd, side * 0.022)), scale(F, -0.05 * back)));
    const a = add(c, scale(F, 0.03)), b = add(c, scale(F, -0.028)), o = add(c, add(scale(Sd, side * 0.03), scale(U, -0.01)));
    for (const [p, q] of [[a, b], [b, o], [o, a]] as Array<[V3, V3]>) {
      const n = norm(cross(sub(q, p), sub(tip, p))), mid = scale(add(add(p, q), tip), 1 / 3), on = dot(n, sub(mid, pose.H)) < 0 ? scale(n, -1) : n;
      const t0 = ni;
      tri3(vtx(p, on, 40), vtx(q, on, 40), vtx(tip, on, 40.9));
      orient(t0, true);
    }
  }

  // ─── the legs, from where the feet are ───
  const t0 = norm(sub(pose.C, pose.R)), side0 = norm(cross(t0, [0, 1, 0])), up0 = norm(cross(side0, t0));
  const flat = norm([t0[0], 0, t0[2]]);
  for (let q = 0; q < 4; q++) {
    const hind = q < 2, sgn = q % 2 === 0 ? 1 : -1, foot = pose.f[q];
    const paw: V3 = [foot[0], foot[1] + 0.032, foot[2]];
    if (hind) {
      const hip = add(pose.R, add(add(scale(side0, sgn * 0.062), scale(up0, -0.035)), scale(t0, 0.03)));
      const a = pose.hock * 1.35, hock = add(paw, add(scale(flat, -0.15 * Math.cos(a)), [0, 0.15 * Math.sin(a), 0]));
      const kn = knee(hip, hock, 0.17, 0.17, add(flat, scale(side0, sgn * 0.15)));
      kn[1] = Math.max(0.03, kn[1]);
      tube([hip, kn, hock, paw, add(paw, scale(flat, 0.035))], [0.075, 0.05, 0.03, 0.03, 0.028], [0.07, 0.045, 0.028, 0.034, 0.03], 6, flat, 3, [true, true]);
    } else {
      const sh = add(pose.C, add(scale(side0, sgn * 0.056), scale(up0, -0.05)));
      const wrist: V3 = [paw[0] - flat[0] * 0.01, paw[1] + 0.045, paw[2] - flat[2] * 0.01];
      const el = knee(sh, wrist, 0.15, 0.15, add(scale(flat, -1), scale(side0, sgn * 0.1)));
      el[1] = Math.max(0.03, el[1]);
      tube([sh, el, wrist, paw, add(paw, scale(flat, 0.035))], [0.06, 0.042, 0.03, 0.03, 0.028], [0.055, 0.038, 0.028, 0.034, 0.03], 6, flat, 3, [true, true]);
    }
  }

  // ─── the tail: from the top of the rump, carried, curving, lying along the ground where it reaches it ───
  {
    const back = scale(flat, -1), root = add(pose.R, add(scale(back, 0.075), scale(up0, 0.04)));
    const n = 9, seg = 0.66 / n, pts: V3[] = [root];
    let pitch = pose.tl, yaw = Math.atan2(back[2], back[0]);
    for (let q = 0; q < n; q++) {
      const tip = q >= n - 3 ? pose.tk / 3 : 0, wave = Math.sin(stir.t * 1.3 + q * 0.55) * 0.05 + (q >= n - 3 ? Math.sin(stir.t * 11) * 0.22 * stir.twitch : 0);
      pitch += pose.tc / n + tip; yaw += pose.ts / n + wave;
      const p = pts[pts.length - 1], d: V3 = [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
      const nx = add(p, scale(d, seg));
      nx[1] = Math.max(0.026, nx[1]);
      pts.push(nx);
    }
    const r = pts.map((_, q) => 0.042 - 0.016 * (q / n));
    tube(pts, r, r, 6, [0, 1, 0], 2, [false, true]);
  }

  // ─── into the room: turned, tipped, scaled, placed; each triangle's three corners ───
  const sc = S * (at.scale ?? 1), cy = Math.cos(at.yaw), sy = Math.sin(at.yaw), cp = Math.cos(at.pitch), spt = Math.sin(at.pitch), mat = FUR + at.coat;
  const WP = new Float32Array(nv * 3), WN = new Float32Array(nv * 3), AO = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    const px = VP[v * 3], py = VP[v * 3 + 1], pz = VP[v * 3 + 2], x = px * cp - py * spt, y = px * spt + py * cp;
    WP[v * 3] = at.x + (x * cy - pz * sy) * sc; WP[v * 3 + 1] = at.y + y * sc; WP[v * 3 + 2] = at.z + (x * sy + pz * cy) * sc;
    const nx0 = VN[v * 3], ny0 = VN[v * 3 + 1], nz = VN[v * 3 + 2], nx = nx0 * cp - ny0 * spt, ny = nx0 * spt + ny0 * cp;
    WN[v * 3] = nx * cy - nz * sy; WN[v * 3 + 1] = ny; WN[v * 3 + 2] = nx * sy + nz * cy;
    // (shut in underneath; open on top)
    AO[v] = 0.62 + 0.38 * Math.max(0, Math.min(1, ny * 0.6 + 0.55));
  }
  out.room(ni * STRIDE);
  const D = out.data;
  let o = out.n;
  for (let t = 0; t < ni; t++) {
    const v = IX[t];
    D[o] = WP[v * 3]; D[o + 1] = WP[v * 3 + 1]; D[o + 2] = WP[v * 3 + 2];
    D[o + 3] = WN[v * 3]; D[o + 4] = WN[v * 3 + 1]; D[o + 5] = WN[v * 3 + 2];
    D[o + 6] = AO[v]; D[o + 7] = mat; D[o + 8] = -1e3; D[o + 9] = 0; D[o + 10] = VC[v]; D[o + 11] = at.tone;
    o += STRIDE;
  }
  out.n = o;
}
