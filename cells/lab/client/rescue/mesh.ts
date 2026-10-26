/**
 * The rescue race's things, as triangles (pure: arrays, no GL): the big boats, the tiny boats, the little people (big
 * heads, arms that wave), the buoys; and everything that stands about the sea (palms, round trees, boulders, houses, the
 * lighthouses, the pier, the berths' posts, the finish flags), all baked into one mesh of the world.
 *
 * Each vertex is its place, its normal, its colour, and a **part** (what the drawing does with it: its own colour, or
 * the instance's colours A, B, C; an arm that swings round its shoulder; a flag that flutters; a leaf that sways; a lamp
 * that glows), packed as 10 floats (`STRIDE`). Faces are flat (a toy's facets), but for heads, which are smooth.
 */
import { hash, seeded } from '../kit/rng';
import { type Decor, type Sea } from './sea';

export type RGB = [number, number, number];
export type V3 = [number, number, number];
/** what the drawing does with a vertex (render.ts: the object shader) */
export const P = { OWN: 0, A: 1, B: 2, C: 3, ARM_L: 4, ARM_R: 5, FLAG: 6, SWAY: 7, LAMP: 9, GLASS: 10, FLUTTER: 11 } as const;
export const STRIDE = 10;
export interface Mesh { data: Float32Array; count: number }

const WHITE: RGB = [0.96, 0.96, 0.94], TEAK: RGB = [0.86, 0.72, 0.52], GLASSC: RGB = [0.16, 0.24, 0.34], DARK: RGB = [0.18, 0.18, 0.2];
const ANTIFOUL: RGB = [0.62, 0.17, 0.14], WOOD: RGB = [0.62, 0.44, 0.27], STRAW: RGB = [0.95, 0.85, 0.52], TROUSERS: RGB = [0.22, 0.26, 0.38];

/** a mesh made a face at a time, through a transform (place, turn about y, scale) */
export class Builder {
  out: number[] = [];
  private tx = 0; private ty = 0; private tz = 0; private c = 1; private s = 0; private k = 1;
  /** where what follows goes: at (x, y, z), turned by yaw (about y), scaled */
  at(x = 0, y = 0, z = 0, yaw = 0, scale = 1) { this.tx = x; this.ty = y; this.tz = z; this.c = Math.cos(yaw); this.s = Math.sin(yaw); this.k = scale; return this; }
  private vert(p: V3, n: V3, col: RGB, part: number) {
    const x = p[0] * this.k, y = p[1] * this.k, z = p[2] * this.k;
    this.out.push(this.tx + x * this.c + z * this.s, this.ty + y, this.tz - x * this.s + z * this.c, n[0] * this.c + n[2] * this.s, n[1], -n[0] * this.s + n[2] * this.c, col[0], col[1], col[2], part);
  }
  /** a triangle, flat (its own normal, facing the way its corners turn, counter-clockwise seen from outside) */
  tri(a: V3, b: V3, c: V3, col: RGB, part = 0) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.vert(a, [nx, ny, nz], col, part); this.vert(b, [nx, ny, nz], col, part); this.vert(c, [nx, ny, nz], col, part);
  }
  /** a quad a-b-c-d (counter-clockwise from outside) */
  quad(a: V3, b: V3, c: V3, d: V3, col: RGB, part = 0) { this.tri(a, b, c, col, part); this.tri(a, c, d, col, part); }
  /** a quad with a part for each corner (a flag fluttering more toward its free end, a leaf swaying more toward its tip) */
  quadP(a: V3, b: V3, c: V3, d: V3, col: RGB, pa: number, pb: number, pc: number, pd: number) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1, n: V3 = [nx / l, ny / l, nz / l];
    this.vert(a, n, col, pa); this.vert(b, n, col, pb); this.vert(c, n, col, pc);
    this.vert(a, n, col, pa); this.vert(c, n, col, pc); this.vert(d, n, col, pd);
  }
  /**
   * A flag on a pole at the origin: in the plane x = 0, from the pole (z = 0) out to z = -w, from y = top - h to top;
   * in cells, coloured by `col(i, j)`, each corner's part `base` + how far out it is (it flutters more there)
   */
  flag(top: number, w: number, h: number, ni: number, nj: number, col: (i: number, j: number) => RGB, base: number, z0 = 0) {
    const f = (i: number) => base + Math.min(0.99, i / ni);
    for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
      const za = z0 - (w * i) / ni, zb = z0 - (w * (i + 1)) / ni, ya = top - (h * (j + 1)) / nj, yb = top - (h * j) / nj, c = col(i, j);
      this.quadP([0, ya, za], [0, ya, zb], [0, yb, zb], [0, yb, za], c, f(i), f(i + 1), f(i + 1), f(i));
      this.quadP([0, ya, za], [0, yb, za], [0, yb, zb], [0, ya, zb], c, f(i), f(i), f(i + 1), f(i + 1));
    }
  }
  /** both sides of a quad (a leaf, a sheet) */
  sheet(a: V3, b: V3, c: V3, d: V3, col: RGB, part = 0) { this.quad(a, b, c, d, col, part); this.quad(a, d, c, b, col, part); }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGB, part = 0, bottom = false) {
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], col, part);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, part);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, part);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, part);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, part);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, part);
  }
  /** turned round a vertical axis at (cx, cz): rings of (radius, height), faceted; closed at the ends where the radius is 0 */
  lathe(cx: number, cz: number, rings: Array<[number, number]>, seg: number, col: RGB | ((q: number) => RGB), part = 0, y0 = 0) {
    for (let q = 0; q + 1 < rings.length; q++) {
      const [r0, h0] = rings[q], [r1, h1] = rings[q + 1], cc = typeof col === 'function' ? col(q) : col;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
        const p = (r: number, h: number, a: number): V3 => [cx + Math.sin(a) * r, y0 + h, cz + Math.cos(a) * r];
        if (r0 < 1e-6) this.tri(p(r0, h0, a0), p(r1, h1, a1), p(r1, h1, a0), cc, part);
        else if (r1 < 1e-6) this.tri(p(r0, h0, a0), p(r0, h0, a1), p(r1, h1, a0), cc, part);
        else this.quad(p(r0, h0, a0), p(r0, h0, a1), p(r1, h1, a1), p(r1, h1, a0), cc, part);
      }
    }
  }
  /** a sphere (or the part of one between two latitudes, 0 at the top to π at the bottom), smooth */
  sphere(c: V3, r: number, segU: number, segV: number, col: RGB, part = 0, v0 = 0, v1 = Math.PI, squash: V3 = [1, 1, 1], ua = 0, ub = Math.PI * 2) {
    const pt = (u: number, v: number): [V3, V3] => {
      const n: V3 = [Math.sin(v) * Math.sin(u), Math.cos(v), Math.sin(v) * Math.cos(u)];
      return [[c[0] + n[0] * r * squash[0], c[1] + n[1] * r * squash[1], c[2] + n[2] * r * squash[2]], n];
    };
    for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
      const u0 = ua + ((ub - ua) * i) / segU, u1 = ua + ((ub - ua) * (i + 1)) / segU, va = v0 + ((v1 - v0) * j) / segV, vb = v0 + ((v1 - v0) * (j + 1)) / segV;
      const A = pt(u0, va), B = pt(u0, vb), C = pt(u1, vb), D = pt(u1, va);
      this.vert(A[0], A[1], col, part); this.vert(B[0], B[1], col, part); this.vert(C[0], C[1], col, part);
      this.vert(A[0], A[1], col, part); this.vert(C[0], C[1], col, part); this.vert(D[0], D[1], col, part);
    }
  }
  /** a lumpy, faceted ball (a bush, a boulder, a tree's crown) */
  lump(c: V3, r: number, seed: number, col: RGB, part = 0, squash: V3 = [1, 1, 1], segU = 7, segV = 5) {
    const rnd = seeded(seed), jit = Array.from({ length: (segU + 1) * (segV + 1) }, () => 0.82 + rnd() * 0.3);
    const pt = (i: number, j: number): V3 => {
      const u = ((i % segU) / segU) * Math.PI * 2, v = (j / segV) * Math.PI, k = j === 0 || j === segV ? 1 : jit[(i % segU) * (segV + 1) + j];
      return [c[0] + Math.sin(v) * Math.sin(u) * r * k * squash[0], c[1] + Math.cos(v) * r * k * squash[1], c[2] + Math.sin(v) * Math.cos(u) * r * k * squash[2]];
    };
    for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) this.quad(pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j), col, part);
  }
  done(): Mesh { return { data: new Float32Array(this.out), count: this.out.length / STRIDE }; }
}

/**
 * A big boat: a rescue launch eleven metres long (bow at +z), its hull in the boat's colour (A) above a white band and
 * red below the waterline, a teak deck inside a low bulwark, the wheelhouse aft (white, dark windows, its roof in the
 * boat's colour), life rings either side, a mast with a light and the boat's flag. Its waterline is y = 0.
 */
export function bigBoat(): Mesh {
  const m = new Builder();
  // (sections, stern to bow: z, half-width at the deck, deck height, the chine's height, the keel's)
  const S: Array<[number, number, number, number, number]> = [
    [-5.5, 1.82, 1.0, 0.1, -0.3], [-4.6, 2.02, 1.0, 0.05, -0.5], [-3.0, 2.1, 1.0, 0, -0.6], [-1.0, 2.1, 1.0, 0, -0.62], [1.0, 2.08, 1.02, 0, -0.6],
    [2.6, 1.92, 1.06, 0.05, -0.5], [3.7, 1.6, 1.12, 0.15, -0.3], [4.6, 1.12, 1.2, 0.35, 0], [5.2, 0.62, 1.26, 0.6, 0.35], [5.55, 0.14, 1.3, 0.95, 0.85],
  ];
  const BULL = 0.32;
  for (let k = 0; k + 1 < S.length; k++) {
    const [z0, w0, d0, c0, b0] = S[k], [z1, w1, d1, c1, b1] = S[k + 1];
    for (const sd of [1, -1]) {
      const f = (x: number) => x * sd;
      const q = (a: V3, b: V3, c: V3, d: V3, col: RGB, part = 0) => (sd > 0 ? m.quad(a, b, c, d, col, part) : m.quad(d, c, b, a, col, part));
      // (the bulwark's outside, the white band, the side in the boat's colour, the bottom red)
      q([f(w0), d0, z0], [f(w1), d1, z1], [f(w1), d1 + BULL, z1], [f(w0), d0 + BULL, z0], [1, 1, 1], P.A);
      q([f(w0), d0 - 0.22, z0], [f(w1), d1 - 0.22, z1], [f(w1), d1, z1], [f(w0), d0, z0], WHITE);
      q([f(w0 * 0.93), c0 + 0.08, z0], [f(w1 * 0.93), c1 + 0.08, z1], [f(w1), d1 - 0.22, z1], [f(w0), d0 - 0.22, z0], [1, 1, 1], P.A);
      q([f(w0 * 0.93), c0 - 0.02, z0], [f(w1 * 0.93), c1 - 0.02, z1], [f(w1 * 0.93), c1 + 0.08, z1], [f(w0 * 0.93), c0 + 0.08, z0], WHITE);
      q([0, b0, z0], [0, b1, z1], [f(w1 * 0.93), c1 - 0.02, z1], [f(w0 * 0.93), c0 - 0.02, z0], ANTIFOUL);
      // (the bulwark's top and its inside)
      const wi0 = Math.max(0, w0 - 0.09), wi1 = Math.max(0, w1 - 0.09);
      q([f(w0), d0 + BULL, z0], [f(w1), d1 + BULL, z1], [f(wi1), d1 + BULL, z1], [f(wi0), d0 + BULL, z0], WHITE);
      q([f(wi0), d0 + BULL, z0], [f(wi1), d1 + BULL, z1], [f(wi1), d1, z1], [f(wi0), d0, z0], WHITE);
    }
    // (the deck)
    const wi0 = Math.max(0, w0 - 0.09), wi1 = Math.max(0, w1 - 0.09);
    m.quad([-wi0, d0, z0], [-wi1, d1, z1], [wi1, d1, z1], [wi0, d0, z0], TEAK);
  }
  // (the transom)
  const [zs, ws, ds, cs, bs] = S[0];
  m.quad([ws, ds + BULL, zs], [-ws, ds + BULL, zs], [-ws, ds - 0.22, zs], [ws, ds - 0.22, zs], [1, 1, 1], P.A);
  m.quad([ws, ds - 0.22, zs], [-ws, ds - 0.22, zs], [-ws * 0.93, cs, zs], [ws * 0.93, cs, zs], WHITE);
  m.tri([ws * 0.93, cs, zs], [-ws * 0.93, cs, zs], [0, bs, zs], ANTIFOUL);
  // (the wheelhouse: white walls, windows round it, the roof in the boat's colour, life rings either side)
  const X = 1.15, Z0 = -4.1, Z1 = -1.3, Y0 = 1.0, Y1 = 2.8;
  m.box(-X, X, Y0, Y1, Z0, Z1, WHITE);
  m.quad([-0.95, 2.02, Z1 + 0.012], [0.95, 2.02, Z1 + 0.012], [0.95, 2.55, Z1 + 0.012], [-0.95, 2.55, Z1 + 0.012], GLASSC, P.GLASS);
  m.quad([0.8, 2.02, Z0 - 0.012], [-0.8, 2.02, Z0 - 0.012], [-0.8, 2.5, Z0 - 0.012], [0.8, 2.5, Z0 - 0.012], GLASSC, P.GLASS);
  for (const sd of [1, -1]) {
    const x = sd * (X + 0.012);
    const q = (a: V3, b: V3, c: V3, d: V3, col: RGB, part = 0) => (sd > 0 ? m.quad(a, b, c, d, col, part) : m.quad(d, c, b, a, col, part));
    q([x, 2.02, -1.75], [x, 2.02, -2.55], [x, 2.55, -2.55], [x, 2.55, -1.75], GLASSC, P.GLASS);
    q([x, 2.02, -2.85], [x, 2.02, -3.65], [x, 2.55, -3.65], [x, 2.55, -2.85], GLASSC, P.GLASS);
    // (a life ring on the wall, below the windows: a ring of short segments, red and white by turns)
    const cz = -2.7, cy = 1.55, R = 0.3, rr = 0.07;
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2, col: RGB = k % 3 === 0 ? WHITE : [0.95, 0.35, 0.2];
      const at = (a: number, r: number, o: number): V3 => [x + sd * o, cy + Math.cos(a) * r, cz + Math.sin(a) * r];
      q(at(a0, R + rr, 0.02), at(a1, R + rr, 0.02), at(a1, R + rr, 0.11), at(a0, R + rr, 0.11), col);
      q(at(a0, R + rr, 0.11), at(a1, R + rr, 0.11), at(a1, R - rr, 0.11), at(a0, R - rr, 0.11), col);
    }
  }
  m.box(-1.3, 1.3, Y1, 2.95, -4.25, -1.15, [1, 1, 1], P.A);
  // (the mast: a light at the top, the boat's flag flying aft from it)
  m.lathe(0, -3.7, [[0.07, 0], [0.05, 2.3], [0, 2.3]], 6, DARK, 0, 2.95);
  m.lathe(0, -3.7, [[0, 0], [0.11, 0], [0.11, 0.16], [0, 0.16]], 6, [1, 0.95, 0.75], P.LAMP, 5.25);
  m.box(-0.55, 0.55, 4.55, 4.6, -3.74, -3.66, DARK);
  m.flag(5.12, 1.15, 0.52, 4, 2, () => [1, 1, 1], P.FLAG, -3.72);
  // (a searchlight on the roof, forward)
  m.box(-0.18, 0.18, 2.95, 3.2, -1.6, -1.3, DARK);
  m.box(-0.13, 0.13, 3.0, 3.16, -1.3, -1.27, [1, 0.95, 0.8], P.LAMP);
  return m.done();
}

/**
 * A tiny boat: a dinghy three metres long (bow at +z) in its own colour (A), white inside, a darker rim, wooden
 * thwarts to sit on, a pair of oars shipped across it. Its waterline is y = 0.
 */
export function tinyBoat(): Mesh {
  const m = new Builder();
  const S: Array<[number, number, number, number]> = [[-1.6, 0.6, 0.42, -0.04], [-1.0, 0.74, 0.43, -0.13], [0, 0.78, 0.44, -0.16], [0.9, 0.7, 0.47, -0.12], [1.35, 0.46, 0.53, 0.0], [1.62, 0.06, 0.6, 0.24]];
  const IN = 0.06, FLOOR = 0.02, RIM: RGB = [0.35, 0.3, 0.28];
  for (let k = 0; k + 1 < S.length; k++) {
    const [z0, w0, g0, b0] = S[k], [z1, w1, g1, b1] = S[k + 1];
    for (const sd of [1, -1]) {
      const f = (x: number) => x * sd, q = (a: V3, b: V3, c: V3, d: V3, col: RGB, part = 0) => (sd > 0 ? m.quad(a, b, c, d, col, part) : m.quad(d, c, b, a, col, part));
      q([0, b0, z0], [0, b1, z1], [f(w1 * 0.85), (b1 + g1) * 0.35, z1], [f(w0 * 0.85), (b0 + g0) * 0.35, z0], [1, 1, 1], P.A);
      q([f(w0 * 0.85), (b0 + g0) * 0.35, z0], [f(w1 * 0.85), (b1 + g1) * 0.35, z1], [f(w1), g1, z1], [f(w0), g0, z0], [1, 1, 1], P.A);
      const i0 = Math.max(0, w0 - IN), i1 = Math.max(0, w1 - IN);
      q([f(w0), g0, z0], [f(w1), g1, z1], [f(i1), g1, z1], [f(i0), g0, z0], RIM);
      q([f(i0), g0, z0], [f(i1), g1, z1], [f(i1 * 0.9), FLOOR, z1], [f(i0 * 0.9), FLOOR, z0], WHITE);
    }
    const i0 = Math.max(0, w0 - IN) * 0.9, i1 = Math.max(0, w1 - IN) * 0.9;
    m.quad([-i0, FLOOR, z0], [-i1, FLOOR, z1], [i1, FLOOR, z1], [i0, FLOOR, z0], [0.8, 0.66, 0.46]);
  }
  const [zs, ws, gs, bs] = S[0];
  m.quad([ws, gs, zs], [-ws, gs, zs], [-ws * 0.85, (bs + gs) * 0.35, zs], [ws * 0.85, (bs + gs) * 0.35, zs], [1, 1, 1], P.A);
  m.tri([ws * 0.85, (bs + gs) * 0.35, zs], [-ws * 0.85, (bs + gs) * 0.35, zs], [0, bs, zs], [1, 1, 1], P.A);
  for (const z of [-0.85, 0, 0.85]) { const w = z > 0.5 ? 0.62 : 0.7; m.box(-w, w, 0.2, 0.26, z - 0.13, z + 0.13, WOOD); }
  // (the oars, shipped)
  for (const sd of [1, -1]) { m.box(sd * 0.55 - 0.03, sd * 0.55 + 0.03, 0.46, 0.5, -1.25, 1.05, WOOD); m.box(sd * 0.55 - 0.07, sd * 0.55 + 0.07, 0.45, 0.49, 0.75, 1.15, WOOD); }
  return m.done();
}

/**
 * A little person (feet at y = 0, facing +z): a big head (skin: B), hair (C) or a straw sun hat, a shirt (A), dark
 * trousers, arms (skin) that swing out and up from the shoulder (the drawing turns them: parts ARM_L, ARM_R), two dots
 * for eyes. About 1.4 m tall: a toy's proportions, so they read from the camera's height.
 */
export function person(hat: boolean): Mesh {
  const m = new Builder();
  m.lathe(0, 0, [[0, 0], [0.17, 0], [0.18, 0.24], [0, 0.24]], 8, TROUSERS);
  m.lathe(0, 0, [[0, 0.2], [0.22, 0.2], [0.27, 0.32], [0.27, 0.56], [0.24, 0.72], [0.13, 0.8], [0, 0.82]], 10, [1, 1, 1], P.A);
  m.sphere([0, 1.06, 0], 0.29, 12, 8, [1, 1, 1], P.B);
  // (eyes, looking forward (+z))
  for (const sd of [-1, 1]) m.box(sd * 0.1 - 0.03, sd * 0.1 + 0.03, 1.05, 1.12, 0.268, 0.29, [0.08, 0.08, 0.1]);
  if (hat) {
    m.sphere([0, 1.08, -0.01], 0.3, 12, 4, [1, 1, 1], P.C, 0, Math.PI * 0.42);
    m.lathe(0, 0, [[0, 1.24], [0.46, 1.24], [0.46, 1.27], [0.25, 1.27], [0.24, 1.46], [0, 1.47]], 12, STRAW);
    m.lathe(0, 0, [[0.262, 1.27], [0.258, 1.34]], 12, [0.9, 0.35, 0.3]);
  } else {
    // (hair: over the top and down the back, the face left clear)
    m.sphere([0, 1.08, -0.02], 0.305, 12, 5, [1, 1, 1], P.C, 0, Math.PI * 0.45);
    m.sphere([0, 1.06, -0.04], 0.3, 8, 4, [1, 1, 1], P.C, Math.PI * 0.45, Math.PI * 0.72, [1, 1, 0.92], Math.PI * 0.55, Math.PI * 1.45);
  }
  // (arms from the shoulders (±0.3, 0.72) down, and hands)
  for (const [sd, part] of [[-1, P.ARM_L], [1, P.ARM_R]] as const) {
    const x = sd * 0.31;
    m.box(x - 0.055, x + 0.055, 0.34, 0.74, -0.055, 0.055, [1, 1, 1], part);
    m.lump([x, 0.3, 0], 0.075, 3 + sd, [1, 1, 1], part, [1, 1, 1], 6, 4);
  }
  return m.done();
}

/** a buoy: a float in its colour (A) with a white band, a cone on top */
export function buoy(): Mesh {
  const m = new Builder();
  m.lathe(0, 0, [[0, -0.5], [0.42, -0.5], [0.46, 0.2], [0.46, 0.45], [0.38, 0.85], [0, 1.3]], 10, (q) => (q === 2 ? WHITE : [1, 1, 1]) as RGB, 0);
  // (the band's white is its own; the rest takes the buoy's colour)
  const d = m.out;
  for (let k = 0; k < d.length; k += STRIDE) if (!(d[k + 6] > 0.95 && d[k + 7] > 0.95 && d[k + 8] > 0.9 && d[k + 6] < 0.97)) d[k + 9] = P.A;
  return m.done();
}

// ─── what stands about: baked into one mesh of the world ───
const PALM_TRUNK: RGB = [0.55, 0.4, 0.26], PALM_RING: RGB = [0.45, 0.32, 0.2];
const LEAVES: RGB[] = [[0.24, 0.6, 0.26], [0.3, 0.68, 0.28], [0.2, 0.52, 0.24]];
const CROWNS: RGB[] = [[0.3, 0.6, 0.27], [0.38, 0.66, 0.3], [0.26, 0.54, 0.3]];
const WALLS: RGB[] = [[0.97, 0.95, 0.9], [0.98, 0.9, 0.78], [0.86, 0.93, 0.96], [0.98, 0.86, 0.84], [0.9, 0.96, 0.86]];
const ROOFS: RGB[] = [[0.78, 0.3, 0.22], [0.25, 0.45, 0.72], [0.85, 0.5, 0.2], [0.3, 0.58, 0.48], [0.6, 0.3, 0.5]];

function palm(m: Builder, d: Decor) {
  const rnd = seeded(hash(Math.round(d.x * 10), Math.round(d.z * 10), 3)), lean = 0.6 + rnd() * 1.4, la = rnd() * Math.PI * 2, H = 5.2 + rnd() * 1.6, n = 5;
  m.at(d.x, d.y - 0.2, d.z, 0, d.s);
  const pt = (t: number): V3 => [Math.sin(la) * lean * t * t, H * t, Math.cos(la) * lean * t * t];
  for (let k = 0; k < n; k++) {
    const a = pt(k / n), b = pt((k + 1) / n), r0 = 0.24 - 0.1 * (k / n), r1 = 0.24 - 0.1 * ((k + 1) / n);
    for (let q = 0; q < 5; q++) {
      const a0 = (q / 5) * Math.PI * 2, a1 = ((q + 1) / 5) * Math.PI * 2;
      m.quad([a[0] + Math.sin(a0) * r0, a[1], a[2] + Math.cos(a0) * r0], [a[0] + Math.sin(a1) * r0, a[1], a[2] + Math.cos(a1) * r0], [b[0] + Math.sin(a1) * r1, b[1], b[2] + Math.cos(a1) * r1], [b[0] + Math.sin(a0) * r1, b[1], b[2] + Math.cos(a0) * r1], k % 2 ? PALM_RING : PALM_TRUNK);
    }
  }
  const top = pt(1);
  for (let k = 0; k < 2; k++) m.lump([top[0] + Math.sin(k * 3.1) * 0.2, top[1] - 0.2, top[2] + Math.cos(k * 3.1) * 0.2], 0.15, k, [0.42, 0.3, 0.16], 0, [1, 1, 1], 5, 3);
  // (the fronds: arching out and down from the top, each a strip narrowing to its tip, swaying more toward it)
  const nf = 6;
  for (let f = 0; f < nf; f++) {
    const a = (f / nf) * Math.PI * 2 + rnd() * 0.4, len = 2.6 + rnd() * 0.9, col = LEAVES[Math.floor(rnd() * 3)], droop = 0.6 + rnd() * 0.5;
    const dir: V3 = [Math.sin(a), 0, Math.cos(a)], side: V3 = [Math.cos(a), 0, -Math.sin(a)];
    let prev: V3 | null = null, pw = 0, pt0 = 0;
    for (let s = 0; s <= 4; s++) {
      const t = s / 4, along = len * t, y = top[1] + 0.25 + 0.7 * t - droop * 1.9 * t * t, w = 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.1)) + 0.04;
      const c: V3 = [top[0] + dir[0] * along, y, top[2] + dir[2] * along];
      if (prev) {
        const sa = P.SWAY + Math.min(0.99, pt0), sb = P.SWAY + Math.min(0.99, t);
        const A: V3 = [prev[0] - side[0] * pw, prev[1], prev[2] - side[2] * pw], B: V3 = [c[0] - side[0] * w, c[1], c[2] - side[2] * w], C: V3 = [c[0] + side[0] * w, c[1] + 0.06, c[2] + side[2] * w], D: V3 = [prev[0] + side[0] * pw, prev[1] + 0.06, prev[2] + side[2] * pw];
        m.quadP(A, B, C, D, col, sa, sb, sb, sa); m.quadP(A, D, C, B, col, sa, sa, sb, sb);
      }
      prev = c; pw = w; pt0 = t;
    }
  }
}

function tree(m: Builder, d: Decor) {
  const rnd = seeded(hash(Math.round(d.x * 10), Math.round(d.z * 10), 4));
  m.at(d.x, d.y - 0.2, d.z, d.yaw, d.s);
  m.lathe(0, 0, [[0.3, 0], [0.22, 1.8], [0, 1.9]], 6, [0.45, 0.33, 0.22]);
  const col = CROWNS[d.c % CROWNS.length];
  m.lump([0, 2.8, 0], 1.55, hash(d.c, 1, Math.round(d.x)), col, P.SWAY + 0.12, [1, 0.9, 1], 6, 4);
  m.lump([0.8 * (rnd() - 0.5) * 2, 3.6, 0.5], 1.05, hash(d.c, 2, Math.round(d.z)), [col[0] * 1.08, col[1] * 1.06, col[2]], P.SWAY + 0.18, [1, 1, 1], 6, 4);
  m.lump([-0.7, 2.4, -0.6], 1.0, hash(d.c, 3, Math.round(d.x)), [col[0] * 0.92, col[1] * 0.93, col[2] * 0.95], P.SWAY + 0.12, [1, 1, 1], 6, 4);
}

function house(m: Builder, d: Decor) {
  m.at(d.x, d.y - 0.4, d.z, d.yaw, d.s);
  const w = 2.2, dd = 2.0, h = 3.0, wall = WALLS[d.c % WALLS.length], roof = ROOFS[(d.c * 3 + 1) % ROOFS.length];
  m.box(-w, w, 0, h, -dd, dd, wall);
  // (a pitched roof, its ridge along x, eaves out past the walls)
  const o = 0.35, rh = 1.7;
  m.quad([-w - o, h - 0.1, dd + o], [w + o, h - 0.1, dd + o], [w + o, h + rh, 0], [-w - o, h + rh, 0], roof);
  m.quad([w + o, h - 0.1, -dd - o], [-w - o, h - 0.1, -dd - o], [-w - o, h + rh, 0], [w + o, h + rh, 0], roof);
  m.tri([w, h, dd], [w, h, -dd], [w, h + rh - 0.2, 0], wall);
  m.tri([-w, h, -dd], [-w, h, dd], [-w, h + rh - 0.2, 0], wall);
  // (a door and windows on the front (+z), a window either side of the door, shutters in the roof's colour)
  m.quad([-0.45, 0, dd + 0.02], [0.45, 0, dd + 0.02], [0.45, 1.9, dd + 0.02], [-0.45, 1.9, dd + 0.02], [0.42, 0.28, 0.2]);
  for (const x of [-1.45, 1.45]) {
    m.quad([x - 0.4, 1.1, dd + 0.02], [x + 0.4, 1.1, dd + 0.02], [x + 0.4, 2.0, dd + 0.02], [x - 0.4, 2.0, dd + 0.02], GLASSC, P.GLASS);
    for (const s of [-1, 1]) m.quad([x + s * 0.4, 1.05, dd + 0.03], [x + s * 0.62, 1.05, dd + 0.03], [x + s * 0.62, 2.05, dd + 0.03], [x + s * 0.4, 2.05, dd + 0.03], roof);
  }
  m.box(1.0, 1.5, h + 0.6, h + rh + 0.4, -0.9, -0.4, [0.75, 0.5, 0.4]);
}

function lighthouse(m: Builder, d: Decor) {
  m.at(d.x, d.y - 0.6, d.z, 0, 1);
  m.lathe(0, 0, [[3.0, 0], [3.2, 0.6], [2.4, 1.4], [0, 1.4]], 9, [0.62, 0.58, 0.54]);
  const bands = 5, H = 13;
  const rings: Array<[number, number]> = [];
  for (let k = 0; k <= bands; k++) rings.push([1.75 - 0.55 * (k / bands), 1.4 + (H * k) / bands]);
  m.lathe(0, 0, rings, 14, (q) => (q % 2 ? [0.9, 0.22, 0.18] : WHITE));
  m.lathe(0, 0, [[1.65, H + 1.4], [1.65, H + 1.6], [0, H + 1.6]], 14, DARK);
  m.lathe(0, 0, [[0.95, H + 1.6], [0.95, H + 3.0], [0, H + 3.0]], 10, [1, 0.92, 0.6], P.LAMP);
  m.lathe(0, 0, [[1.15, H + 3.0], [0.7, H + 3.6], [0.1, H + 4.1], [0, H + 4.2]], 10, [0.9, 0.22, 0.18]);
}

/** a tall pole with a flag: chequered (finish), or bunting colours */
function flag(m: Builder, d: Decor) {
  m.at(d.x, d.y - 0.2, d.z, d.yaw, 1);
  m.lathe(0, 0, [[0.09, 0], [0.06, 8], [0.12, 8], [0, 8.25]], 6, WHITE);
  m.flag(7.9, 3.2, 2.0, 6, 4, (i, j) => ((i + j) % 2 ? WHITE : [0.08, 0.08, 0.1]), P.FLUTTER);
}

/** the pier at the berths: planks on posts, running along x */
function pier(m: Builder, d: Decor, sea: Sea) {
  const x0 = sea.berths[4].x - 18, x1 = sea.berths[0].x + 18;
  m.at(0, 0, 0, 0, 1);
  m.box(x0, x1, 1.0, 1.25, d.z - 2.2, d.z + 2.2, [0.72, 0.56, 0.38]);
  for (let x = x0 + 1; x < x1; x += 4) for (const z of [d.z - 2, d.z + 2]) m.box(x - 0.18, x + 0.18, -3, 1.0, z - 0.18, z + 0.18, [0.5, 0.38, 0.26]);
  for (let x = x0; x < x1; x += 0.9) m.box(x, x + 0.02, 1.25, 1.26, d.z - 2.2, d.z + 2.2, [0.6, 0.45, 0.3]);
}

/** a berth's post: wood, its top in the berth's colour (the boats', by place) */
function post(m: Builder, d: Decor) {
  m.at(d.x, 0, d.z, 0, 1);
  m.lathe(0, 0, [[0.32, -2], [0.32, 2.4], [0, 2.45]], 8, (q) => (q === 0 ? [0.55, 0.42, 0.28] : [0.55, 0.42, 0.28]));
  m.lathe(0, 0, [[0.36, 2.0], [0.36, 2.5], [0, 2.55]], 8, [0.98, 0.84, 0.25]);
}

function boulder(m: Builder, d: Decor) {
  m.at(d.x, d.y - 0.3, d.z, d.yaw, d.s);
  m.lump([0, 0.3, 0], 0.9, hash(Math.round(d.x), Math.round(d.z), 5), [0.6, 0.57, 0.52], 0, [1.2, 0.7, 1]);
}

/** how long a stretch of the course each piece of the world's mesh covers (the drawing draws only those near the camera) */
export const CHUNK = 100;
/**
 * Everything that stands about the sea, in pieces along the course (`CHUNK` metres of z each); the buoys left out
 * (they float, so they're drawn on their own, bobbing).
 */
export function worldMesh(sea: Sea): Array<{ z0: number; z1: number; mesh: Mesh }> {
  const pieces = new Map<number, Builder>();
  for (const d of sea.decor) {
    const k = Math.floor(d.z / CHUNK), m = pieces.get(k) ?? pieces.set(k, new Builder()).get(k)!;
    if (d.kind === 'palm') palm(m, d);
    else if (d.kind === 'tree') tree(m, d);
    else if (d.kind === 'house') house(m, d);
    else if (d.kind === 'lighthouse') lighthouse(m, d);
    else if (d.kind === 'flag') flag(m, d);
    else if (d.kind === 'pier') pier(m, d, sea);
    else if (d.kind === 'post') post(m, d);
    else if (d.kind === 'boulder') boulder(m, d);
  }
  // (each piece's reach a little longer than its stretch: a palm leans, a flag flies, a pier runs out)
  return [...pieces.entries()].map(([k, m]) => ({ z0: k * CHUNK - 12, z1: (k + 1) * CHUNK + 12, mesh: m.done() }));
}
