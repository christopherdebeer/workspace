/**
 * A mesh as the look builds it: unindexed triangles, each vertex its place, its normal, its colour and what it's made
 * of (a material number: see MAT). Most surfaces are faceted on purpose (one normal a face): white cloth reads as the
 * painted study's quiet planes, and the light picks out an elbow by the turn of its facets.
 */
import { type V, add, cross, dot, len, madd, norm, scale, sub } from '../v3';

/** floats a vertex: place, normal, colour, material, and two for a fabric's own coordinates (metres across, along) */
export const STRIDE = 12;
/** what a surface is made of (the shader's branches) */
export const MAT = {
  cloth: 0, blade: 1, bell: 2, piste: 3, floor: 4, paint: 5, window: 6, mesh: 7, rubber: 8, skin: 9, line: 10,
  lamp: 11, button: 12, glove: 13, wood: 14,
  /** simulated cloth: its colour slots carry (fold shade, distance to a seam in m, 0), its uv the weave's coordinates */
  fabric: 15, maskFront: 16, endWall: 17,
} as const;
export type C = [number, number, number];

export class Mesh {
  data: Float32Array;
  n = 0;
  constructor(size = 60000) { this.data = new Float32Array(STRIDE * size); }
  reset() { this.n = 0; }
  private grow() { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
  vert(p: V, nr: V, c: C, mat: number, u = 0, w = 0) {
    if ((this.n + 1) * STRIDE > this.data.length) this.grow();
    const o = this.n++ * STRIDE, d = this.data;
    d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = nr[0]; d[o + 4] = nr[1]; d[o + 5] = nr[2];
    d[o + 6] = c[0]; d[o + 7] = c[1]; d[o + 8] = c[2]; d[o + 9] = mat; d[o + 10] = u; d[o + 11] = w;
  }
  /** a vertex straight from flat arrays (the cloth's hot path) */
  vraw(x: number, y: number, z: number, nx: number, ny: number, nz: number, c0: number, c1: number, c2: number, mat: number, u: number, w: number) {
    if ((this.n + 1) * STRIDE > this.data.length) this.grow();
    const o = this.n++ * STRIDE, d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = nx; d[o + 4] = ny; d[o + 5] = nz;
    d[o + 6] = c0; d[o + 7] = c1; d[o + 8] = c2; d[o + 9] = mat; d[o + 10] = u; d[o + 11] = w;
  }
  /** a flat triangle (its own normal, facing away from `out` if given the wrong way round) */
  tri(a: V, b: V, c: V, col: C, mat: number) {
    const n = norm(cross(sub(b, a), sub(c, a)));
    this.vert(a, n, col, mat); this.vert(b, n, col, mat); this.vert(c, n, col, mat);
  }
  /** a flat quad a b c d (counter-clockwise seen from its front) */
  quad(a: V, b: V, c: V, d: V, col: C, mat: number) { this.tri(a, b, c, col, mat); this.tri(a, c, d, col, mat); }
  /** a smooth triangle with given normals */
  stri(a: V, b: V, c: V, na: V, nb: V, nc: V, col: C, mat: number) { this.vert(a, na, col, mat); this.vert(b, nb, col, mat); this.vert(c, nc, col, mat); }
  /** an axis-aligned box (for the room's furniture) */
  box(lo: V, hi: V, col: C, mat: number) {
    const [x0, y0, z0] = lo, [x1, y1, z1] = hi;
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], col, mat);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, mat);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, mat);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, mat);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, mat);
  }
  /** an oriented box: centre, three half-axes */
  obox(c: V, ax: V, ay: V, az: V, col: C, mat: number, top?: C) {
    const P = (i: number, j: number, k: number): V => add(add(add(c, scale(ax, i)), scale(ay, j)), scale(az, k));
    const q = (a: V, b: V, cc: V, d: V, cl = col) => this.quad(a, b, cc, d, cl, mat);
    q(P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), top ?? col);
    q(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1));
    q(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1));
    q(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1));
    q(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1));
    q(P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1));
  }
  /**
   * A faceted tube through rings: each ring a centre, two axes (u, w) and radii along them, `seg` sides; the faces flat.
   * `jit` breaks each ring's radii a little, ring by ring (folds in cloth). Closes the ends if asked.
   */
  tube(rings: { c: V; u: V; w: V; ru: number; rw: number }[], seg: number, col: C, mat: number, opt: { jit?: number; seed?: number; capA?: boolean; capB?: boolean; shade?: (i: number, j: number) => number; soft?: number } = {}) {
    const pts: V[][] = rings.map((r, i) => {
      const out: V[] = [];
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2, k = opt.jit ? 1 + (hash3(opt.seed ?? 0, i, j) - 0.5) * opt.jit : 1;
        out.push(add(r.c, add(scale(r.u, Math.cos(a) * r.ru * k), scale(r.w, Math.sin(a) * r.rw * k))));
      }
      return out;
    });
    // (soft: each vertex's normal leans from its face's toward the round of the ring: planes, but a rounded silhouette
    // in the light)
    const soft = opt.soft ?? 0;
    const rad = (i: number, j: number): V => norm(sub(pts[i][j], rings[i].c));
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg, s = opt.shade ? opt.shade(i, j) : 1, cl: C = [col[0] * s, col[1] * s, col[2] * s];
      if (!soft) { this.quad(pts[i][j], pts[i][j1], pts[i + 1][j1], pts[i + 1][j], cl, mat); continue; }
      const a = pts[i][j], b = pts[i][j1], c = pts[i + 1][j1], d = pts[i + 1][j];
      const fn = norm(cross(sub(b, a), sub(c, a)));
      const sgn = dot(fn, rad(i, j)) < 0 ? -1 : 1, fo = scale(fn, sgn);
      const mix = (v: V): V => norm(add(scale(fo, 1 - soft), scale(v, soft)));
      const na = mix(rad(i, j)), nb = mix(rad(i, j1)), nc = mix(rad(i + 1, j1)), nd = mix(rad(i + 1, j));
      this.stri(a, b, c, na, nb, nc, cl, mat); this.stri(a, c, d, na, nc, nd, cl, mat);
    }
    if (opt.capA) { const c = rings[0].c; for (let j = 0; j < seg; j++) this.tri(c, pts[0][(j + 1) % seg], pts[0][j], col, mat); }
    if (opt.capB) { const L = rings.length - 1, c = rings[L].c; for (let j = 0; j < seg; j++) this.tri(c, pts[L][j], pts[L][(j + 1) % seg], col, mat); }
  }
  /** a smooth ellipsoid: centre, three half-axes; `colOf` colours each vertex by its unit direction in (ax, ay, az) */
  ellipsoid(c: V, ax: V, ay: V, az: V, seg: number, rings: number, colOf: (d: V) => [C, number]) {
    const P = (i: number, j: number) => {
      const th = (i / rings) * Math.PI, ph = (j / seg) * Math.PI * 2;
      const d: V = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      const p = add(add(add(c, scale(ax, d[0])), scale(ay, d[1])), scale(az, d[2]));
      // (the normal of an ellipsoid: the direction divided by each half-axis' length, squared)
      const la = dot(ax, ax), lb = dot(ay, ay), lc = dot(az, az);
      const n = norm(add(add(scale(ax, d[0] / la), scale(ay, d[1] / lb)), scale(az, d[2] / lc)));
      return { p, n, d };
    };
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
      const [col, mat] = colOf(scale(add(add(a.d, b.d), add(cc.d, d.d)), 0.25));
      this.stri(a.p, b.p, cc.p, a.n, b.n, cc.n, col, mat);
      this.stri(a.p, cc.p, d.p, a.n, cc.n, d.n, col, mat);
    }
  }
}

/** a frame about an axis: two unit vectors square to `d` (the first as near `hint` as it can be) */
export function around(d: V, hint: V = [0, 1, 0]): [V, V] {
  let u = sub(hint, scale(d, dot(hint, d)));
  if (len(u) < 1e-4) u = sub([1, 0, 0], scale(d, d[0]));
  u = norm(u);
  return [u, cross(d, u)];
}
export const hash3 = (a: number, b: number, c: number) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export { madd };
