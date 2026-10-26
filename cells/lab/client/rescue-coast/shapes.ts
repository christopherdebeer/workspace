/**
 * Making meshes: triangles with a normal, a colour, how they move (`part`) and what they're made of (`mat`).
 *
 * Each vertex is 11 floats: position, normal, colour, part, mat.
 * - **part**: 0 still; 1 a left arm, 2 a right arm (turned about the shoulder by the instance); 3 flutters (a flag,
 *   a sail: the fraction is how free it is, 0 at the pole to 1 at the free end).
 * - **mat** = source + 4 × material. The source says where the colour comes from: 0 the vertex's own, 1/2/3 the
 *   instance's colours A/B/C (multiplied by the vertex colour, so a vertex can shade them). Materials: 0 matte,
 *   1 glossy painted plastic, 2 glass or metal, 3 skin and cloth, 4 granite, 5 lit (lamps), 6 foliage, 7 white sail.
 */
export const STRIDE = 11;
export type V3 = [number, number, number];
export type RGB = readonly [number, number, number];
export interface Mesh { data: Float32Array; count: number }
export const M = { MATTE: 0, PAINT: 1, GLASS: 2, SOFT: 3, ROCK: 4, LIT: 5, LEAF: 6, SAIL: 7 } as const;
export const SRC = { OWN: 0, A: 1, B: 2, C: 3 } as const;
export const WHITE: RGB = [1, 1, 1];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export class Builder {
  out: number[] = [];
  /** the current placing: a 3×3 (rotation and scale) and an offset */
  private m = [1, 0, 0, 0, 1, 0, 0, 0, 1]; private o: V3 = [0, 0, 0];
  part = 0; mat = 0;
  /** place what follows: at a point, turned about y (yaw), and scaled */
  at(x = 0, y = 0, z = 0, yaw = 0, s: number | V3 = 1) {
    const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s, c = Math.cos(yaw), n = Math.sin(yaw);
    // (yaw turns +z toward +x, as a heading does)
    this.m = [c * sx, 0, n * sz, 0, sy, 0, -n * sx, 0, c * sz]; this.o = [x, y, z];
    return this;
  }
  /** place by a full basis (columns: where x, y and z go) */
  basis(o: V3, ex: V3, ey: V3, ez: V3) { this.m = [ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]]; this.o = o; return this; }
  use(part: number, src: number, material: number) { this.part = part; this.mat = src + 4 * material; return this; }
  private P(p: V3): V3 { const m = this.m; return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + this.o[0], m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + this.o[1], m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + this.o[2]]; }
  private N(n: V3): V3 {
    // (normals by the inverse transpose; for rotation-and-scale it's enough to divide by the scale squared)
    const m = this.m, sx = m[0] * m[0] + m[3] * m[3] + m[6] * m[6], sy = m[1] * m[1] + m[4] * m[4] + m[7] * m[7], sz = m[2] * m[2] + m[5] * m[5] + m[8] * m[8];
    const q: V3 = [n[0] / sx, n[1] / sy, n[2] / sz];
    return norm([m[0] * q[0] + m[1] * q[1] + m[2] * q[2], m[3] * q[0] + m[4] * q[1] + m[5] * q[2], m[6] * q[0] + m[7] * q[1] + m[8] * q[2]]);
  }
  /** a vertex with its own normal (local coordinates) */
  v(p: V3, n: V3, col: RGB, part = this.part) { const P = this.P(p), N = this.N(n); this.out.push(P[0], P[1], P[2], N[0], N[1], N[2], col[0], col[1], col[2], part, this.mat); }
  /** a triangle whose normal points away from `o` (for closed lumps, whatever the winding) */
  triOut(o: V3, a: V3, b: V3, c: V3, col: RGB) {
    let n = norm(cross(sub(b, a), sub(c, a)));
    const m: V3 = [(a[0] + b[0] + c[0]) / 3 - o[0], (a[1] + b[1] + c[1]) / 3 - o[1], (a[2] + b[2] + c[2]) / 3 - o[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) n = [-n[0], -n[1], -n[2]];
    this.v(a, n, col); this.v(b, n, col); this.v(c, n, col);
  }
  tri(a: V3, b: V3, c: V3, col: RGB) { const n = norm(cross(sub(b, a), sub(c, a))); this.v(a, n, col); this.v(b, n, col); this.v(c, n, col); }
  quad(a: V3, b: V3, c: V3, d: V3, col: RGB) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGB, top: RGB = col) {
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col);
  }
  /** a rounded box (centre, half sizes, corner radius): every face a grid pushed out round its edges */
  roundBox(c: V3, h: V3, r: number, col: RGB, n = 4, shade?: (p: V3, nrm: V3) => RGB) {
    const faces: [number, number, number, number][] = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]];
    for (const [a, u, w, s] of faces) {
      const pt = (i: number, j: number): [V3, V3] => {
        const q: V3 = [0, 0, 0]; q[a] = s * h[a]; q[u] = (2 * i / n - 1) * h[u]; q[w] = (2 * j / n - 1) * h[w];
        const core = q.map((x, k) => Math.max(-h[k] + r, Math.min(h[k] - r, x))) as V3;
        const d = norm(sub(q, core));
        return [[c[0] + core[0] + d[0] * r, c[1] + core[1] + d[1] * r, c[2] + core[2] + d[2] * r], d];
      };
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        let p = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
        if (s < 0) p = [p[0], p[3], p[2], p[1]];
        const tri = (x: [V3, V3], y: [V3, V3], z: [V3, V3]) => { for (const [P, N] of [x, y, z]) this.v(P, N, shade ? shade(P, N) : col); };
        // (wound so the face looks out along the face's axis)
        const flip = (a === 0 && u === 1) || (a === 1 && u === 2) || (a === 2 && u === 0);
        if (flip) { tri(p[0], p[1], p[2]); tri(p[0], p[2], p[3]); } else { tri(p[0], p[2], p[1]); tri(p[0], p[3], p[2]); }
      }
    }
  }
  /** a tube between two points */
  tube(a: V3, b: V3, r: number, col: RGB, sides = 8, r1 = r) {
    const ax = norm(sub(b, a)), ref: V3 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(ax, ref)), w = cross(ax, u);
    const ring = (c: V3, rr: number, t: number): [V3, V3] => { const cs = Math.cos(t), sn = Math.sin(t), n: V3 = [u[0] * cs + w[0] * sn, u[1] * cs + w[1] * sn, u[2] * cs + w[2] * sn]; return [[c[0] + n[0] * rr, c[1] + n[1] * rr, c[2] + n[2] * rr], n]; };
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * 2 * Math.PI, t1 = ((i + 1) / sides) * 2 * Math.PI;
      const p = [ring(a, r, t0), ring(a, r, t1), ring(b, r1, t1), ring(b, r1, t0)];
      for (const k of [0, 1, 2, 0, 2, 3]) this.v(p[k][0], p[k][1], col);
    }
  }
  /** a solid of revolution about y: [radius, height] from bottom to top */
  lathe(profile: [number, number][], col: RGB | ((i: number) => RGB), sides = 12) {
    for (let k = 0; k < profile.length - 1; k++) {
      const [r0, y0] = profile[k], [r1, y1] = profile[k + 1], c = typeof col === 'function' ? col(k) : col;
      const ny = -(r1 - r0), nr = y1 - y0, l = Math.hypot(ny, nr) || 1;
      for (let i = 0; i < sides; i++) {
        const t0 = (i / sides) * 2 * Math.PI, t1 = ((i + 1) / sides) * 2 * Math.PI;
        const P = (r: number, y: number, t: number): V3 => [Math.sin(t) * r, y, Math.cos(t) * r];
        const N = (t: number): V3 => [Math.sin(t) * nr / l, ny / l, Math.cos(t) * nr / l];
        const v = [[P(r0, y0, t0), N(t0)], [P(r0, y0, t1), N(t1)], [P(r1, y1, t1), N(t1)], [P(r1, y1, t0), N(t0)]] as [V3, V3][];
        for (const q of [0, 1, 2, 0, 2, 3]) this.v(v[q][0], v[q][1], c);
      }
    }
  }
  /** a sphere (or a squashed one), optionally only its upper part (to `top`, 0..π from the top) */
  sphere(c: V3, r: number, col: RGB, scale: V3 = [1, 1, 1], rings = 8, segs = 12, top = Math.PI) {
    for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
      const P = (jj: number, ii: number): [V3, V3] => {
        const th = (jj / rings) * top, ph = (ii / segs) * 2 * Math.PI, n: V3 = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
        return [[c[0] + n[0] * r * scale[0], c[1] + n[1] * r * scale[1], c[2] + n[2] * r * scale[2]], norm([n[0] / scale[0], n[1] / scale[1], n[2] / scale[2]])];
      };
      const v = [P(j, i), P(j + 1, i), P(j + 1, i + 1), P(j, i + 1)];
      for (const q of [0, 1, 2, 0, 2, 3]) this.v(v[q][0], v[q][1], col);
    }
  }
  /** a ring (torus) lying in the x-y plane, facing +z; colour by segment */
  torus(c: V3, R: number, r: number, col: (i: number) => RGB, segs = 16, sides = 6) {
    for (let i = 0; i < segs; i++) for (let k = 0; k < sides; k++) {
      const P = (ii: number, kk: number): [V3, V3] => {
        const a = (ii / segs) * 2 * Math.PI, b = (kk / sides) * 2 * Math.PI, n: V3 = [Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b), Math.sin(b)];
        return [[c[0] + Math.cos(a) * (R + r * Math.cos(b)), c[1] + Math.sin(a) * (R + r * Math.cos(b)), c[2] + r * Math.sin(b)], n];
      };
      const v = [P(i, k), P(i + 1, k), P(i + 1, k + 1), P(i, k + 1)];
      for (const q of [0, 1, 2, 0, 2, 3]) this.v(v[q][0], v[q][1], col(i));
    }
  }
  /**
   * a lofted skin: rows of points (each row a section), joined into quads; normals smoothed over the grid, colour per quad
   * (so a stripe keeps a crisp edge). `closed` joins each row's last point to its first.
   */
  loft(rows: V3[][], col: (p: V3, i: number, j: number) => RGB, closed = false) {
    const R = rows.length, C = rows[0].length, nrm: V3[][] = rows.map((row) => row.map(() => [0, 0, 0] as V3));
    const cols = closed ? C : C - 1;
    for (let j = 0; j < R - 1; j++) for (let i = 0; i < cols; i++) {
      const i1 = (i + 1) % C, a = rows[j][i], b = rows[j][i1], c = rows[j + 1][i1], d = rows[j + 1][i];
      const n = cross(sub(b, d), sub(c, a));
      for (const [jj, ii] of [[j, i], [j, i1], [j + 1, i1], [j + 1, i]]) { const q = nrm[jj][ii]; q[0] += n[0]; q[1] += n[1]; q[2] += n[2]; }
    }
    for (let j = 0; j < R - 1; j++) for (let i = 0; i < cols; i++) {
      const i1 = (i + 1) % C, P = [rows[j][i], rows[j][i1], rows[j + 1][i1], rows[j + 1][i]], N = [nrm[j][i], nrm[j][i1], nrm[j + 1][i1], nrm[j + 1][i]].map(norm);
      const mid: V3 = [(P[0][0] + P[2][0]) / 2, (P[0][1] + P[2][1]) / 2, (P[0][2] + P[2][2]) / 2], cc = col(mid, i, j);
      for (const q of [0, 2, 1, 0, 3, 2]) this.v(P[q], N[q], cc);
    }
  }
  /** block capitals on a plane: a 5×7 pixel face; `at` the bottom-left of the first letter, `ex` along, `ey` up (each a pixel's step) */
  text(s: string, at: V3, ex: V3, ey: V3, depth: V3, col: RGB) {
    let x = 0;
    for (const ch of s) {
      const g = GLYPHS[ch];
      if (g) for (let row = 0; row < 7; row++) for (let c = 0; c < 5; c++) if (g[row][c] === '#') {
        const p = (u: number, v: number, d: number): V3 => [at[0] + ex[0] * (x + c + u) + ey[0] * (6 - row + v) + depth[0] * d, at[1] + ex[1] * (x + c + u) + ey[1] * (6 - row + v) + depth[1] * d, at[2] + ex[2] * (x + c + u) + ey[2] * (6 - row + v) + depth[2] * d];
        this.quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1), col);
      }
      x += 6;
    }
  }
  done(): Mesh { const data = new Float32Array(this.out); return { data, count: data.length / STRIDE }; }
}

export function join(...meshes: Mesh[]): Mesh {
  const n = meshes.reduce((s, m) => s + m.data.length, 0), data = new Float32Array(n);
  let o = 0;
  for (const m of meshes) { data.set(m.data, o); o += m.data.length; }
  return { data, count: n / STRIDE };
}

/** smooth the normals of vertices that share a place (and a material), within a crease angle */
export function smooth(mesh: Mesh, crease = 0.6): Mesh {
  const d = mesh.data, at = new Map<string, number[]>(), n = new Float32Array(d);
  for (let i = 0; i < d.length; i += STRIDE) {
    const k = `${Math.round(d[i] * 200)},${Math.round(d[i + 1] * 200)},${Math.round(d[i + 2] * 200)},${d[i + 10]}`;
    (at.get(k) ?? at.set(k, []).get(k)!).push(i);
  }
  for (const ids of at.values()) for (const i of ids) {
    let x = 0, y = 0, z = 0;
    for (const j of ids) if (n[i + 3] * n[j + 3] + n[i + 4] * n[j + 4] + n[i + 5] * n[j + 5] >= crease) { x += n[j + 3]; y += n[j + 4]; z += n[j + 5]; }
    const l = Math.hypot(x, y, z);
    if (l > 0) { d[i + 3] = x / l; d[i + 4] = y / l; d[i + 5] = z / l; }
  }
  return mesh;
}

/** 5×7 capitals, enough for the boats, the banner and the station */
const GLYPHS: Record<string, string[]> = {
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
};
