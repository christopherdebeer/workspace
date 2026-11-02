/**
 * Switchback's world, as flat facets: every triangle carries one material, and the renderer gives each face one flat
 * colour from that material's few bands. Nothing is smooth; the mountain is a field of big planes.
 *
 * The world is made in chunks along the line (a chunk: 48 m of it): the cross-section at every station, from high up the
 * wall on the left to far down the drop on the right, jittered so its faces break; rock where it's steep and snow where
 * it isn't; the pale track laid over it, with its ruts; the fence along the drop, its posts and tape; flags on the wall
 * side; kickers on black trestles; black pines down the drop. Behind it all a ring of far ranges, blue, their tops snow,
 * that keeps its distance from the eye.
 */
import { Course, hash } from './course';

export const M = { SNOW: 0, TRACK: 1, ROCK: 2, ORANGE: 3, BLACK: 4, WHITE: 5, MTN: 6, MTNSNOW: 7, UMBER: 8, SHADOW: 9, RUT: 10, NAVY: 11 } as const;
/** each material's four bands, lit to unlit (the reference's own colours) */
export const PALETTE: string[][] = [
  ['#f1ece8', '#d9d0ca', '#a399a2', '#6f6c93'], // snow
  ['#e4dad3', '#ccbcb2', '#ab9c9c', '#7d7590'], // track, packed
  ['#5d5e69', '#3d3e46', '#2c2d32', '#1e1f25'], // rock
  ['#ff7a2e', '#e85a0d', '#e85a0d', '#c94a0a'], // orange (flat, nearly: it's the one colour that never goes dull)
  ['#2c2d32', '#1d1e23', '#16171b', '#101114'], // black
  ['#ffffff', '#f1ece8', '#d9d0ca', '#a399a2'], // white
  ['#2457e3', '#1f4ed4', '#1546cd', '#123cb0'], // far range
  ['#f4f1ee', '#e3dee0', '#8c9be0', '#4f6bd8'], // far snow: white where it's lit, blue in its shade
  ['#6b5348', '#4c3b34', '#3d2f2a', '#2c221e'], // umber
  ['#a399a2', '#a399a2', '#a399a2', '#a399a2'], // shadow on snow
  ['#b9aaa6', '#a8999a', '#8f8394', '#6f6c88'], // ruts
  ['#535e8a', '#2c3768', '#162140', '#101a36'], // navy
];

export class Mesh {
  v: number[] = [];
  /** a face's own tone (0…1, carried in the material's fraction): it nudges which band the face falls in, so planes lit
   * alike still break into different greys, as a painter would set them */
  private n = 0;
  tri(a: number[], b: number[], c: number[], m: number, tone = -1) {
    const t = m + (tone >= 0 ? tone : hash(a[0] * 0.37 + this.n++, a[2] * 0.53, b[1])) * 0.9;
    this.v.push(a[0], a[1], a[2], t, b[0], b[1], b[2], t, c[0], c[1], c[2], t);
  }
  quad(a: number[], b: number[], c: number[], d: number[], m: number, tone = hash(a[0] * 0.37 + this.n++, a[2] * 0.53, c[1])) { this.tri(a, b, c, m, tone); this.tri(a, c, d, m, tone); }
  /** a triangle whose material is chosen by its slope: rock where it's steeper than `steep`, else `flat` */
  slope(a: number[], b: number[], c: number[], flat: number, steep = M.ROCK, k = 0.72) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    this.tri(a, b, c, Math.abs(ny) / Math.hypot(nx, ny, nz) < k ? steep : flat);
  }
  /** a box from its centre and half-sizes in a frame (origin o, axes x, y, z) */
  box(o: number[], X: number[], Y: number[], Z: number[], c: number[], h: number[], m: number) {
    const p = (i: number, j: number, k: number) => [0, 1, 2].map((d) => o[d] + X[d] * (c[0] + i * h[0]) + Y[d] * (c[1] + j * h[1]) + Z[d] * (c[2] + k * h[2]));
    const P = [p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1), p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)];
    for (const [a, b, cc, d] of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) this.quad(P[a], P[b], P[cc], P[d], m);
  }
  /** a prism (an n-gon swept along an axis): wheels, posts */
  prism(o: number[], X: number[], Y: number[], Z: number[], c: number[], r: number, w: number, n: number, m: number, axis: 'x' | 'y' = 'x', ry = r) {
    const at = (a: number, s: number) => {
      const q = axis === 'x' ? [c[0] + s * w, c[1] + Math.sin(a) * ry, c[2] + Math.cos(a) * r] : [c[0] + Math.cos(a) * r, c[1] + s * w, c[2] + Math.sin(a) * ry];
      return [0, 1, 2].map((d) => o[d] + X[d] * q[0] + Y[d] * q[1] + Z[d] * q[2]);
    };
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      this.quad(at(a0, -1), at(a1, -1), at(a1, 1), at(a0, 1), m);
      this.tri(at(a0, 1), at(a1, 1), at(0, 1).map((_, d) => o[d] + X[d] * (c[0] + (axis === 'x' ? w : 0)) + Y[d] * (c[1] + (axis === 'y' ? w : 0)) + Z[d] * c[2]), m);
      this.tri(at(a1, -1), at(a0, -1), at(0, -1).map((_, d) => o[d] + X[d] * (c[0] - (axis === 'x' ? w : 0)) + Y[d] * (c[1] - (axis === 'y' ? w : 0)) + Z[d] * c[2]), m);
    }
  }
  /** a low-poly pine: a few stacked cones, black */
  pine(x: number, y: number, z: number, h: number, seed: number, m: number = M.BLACK) {
    const n = 5 + Math.floor(hash(seed, 1) * 2), tiers = h > 9 ? 4 : 3, a0 = hash(seed, 2) * 6;
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers, base = y + h * (0.12 + f * 0.62), top = base + h * (0.5 - f * 0.12), r = h * 0.3 * (1 - f * 0.55);
      const ring = Array.from({ length: n }, (_, i) => { const a = a0 + t + (i / n) * Math.PI * 2, rr = r * (0.8 + 0.4 * hash(seed, t, i)); return [x + Math.cos(a) * rr, base - h * 0.04 * hash(seed, i, t, 3), z + Math.sin(a) * rr]; });
      const tip = [x + (hash(seed, t, 9) - 0.5) * 0.3, top, z];
      for (let i = 0; i < n; i++) this.tri(ring[i], ring[(i + 1) % n], tip, m);
    }
    this.box([x, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, h * 0.08, 0], [h * 0.03, h * 0.09, h * 0.03], m);
  }
  /** a faceted rock: a jittered octahedron */
  rock(x: number, y: number, z: number, r: number, seed: number, m: number = M.ROCK) {
    const j = (i: number) => 0.7 + 0.6 * hash(seed, i);
    const P = [[x + r * j(1), y + r * 0.2, z], [x, y + r * 0.2, z + r * j(2)], [x - r * j(3), y + r * 0.2, z], [x, y + r * 0.2, z - r * j(4)]];
    const top = [x + (hash(seed, 5) - 0.5) * r, y + r * (0.7 + 0.6 * hash(seed, 6)), z + (hash(seed, 7) - 0.5) * r], bot = [x, y - r * 0.4, z];
    for (let i = 0; i < 4; i++) { this.tri(P[i], P[(i + 1) % 4], top, m); this.tri(P[(i + 1) % 4], P[i], bot, m); }
  }
}

/** the cross-section, wall side then drop side: how far out from the track's edge, and how far up (or down) */
const WALL: [number, number][] = [[1.4, 0], [2.2, 2.6], [3.4, 7], [5.2, 13], [7.6, 20], [11, 28], [16, 38], [24, 50], [36, 64], [54, 80]];
const DROP: [number, number][] = [[2.6, -0.05], [3.6, -1.2], [7, -5.5], [13, -13], [22, -25], [36, -42], [58, -66], [95, -100], [150, -150]];
export const CHUNK = 48, STEP = 3;

/** the ground's height across the section at station i (no track lift; a kicker's gap is a ravine), for placing things */
export function section(c: Course, i: number) {
  const st = c.at(i), half = st.width / 2, out: { u: number; y: number; ds: number }[] = [];
  const j = (k: number, amp: number) => (hash(c.seed, i, k) - 0.5) * amp;
  for (let k = WALL.length - 1; k >= 0; k--) { const [du, dy] = WALL[k]; out.push({ u: -half - du + (k ? j(k, du * 0.3) : 0), y: st.y + dy + (k ? j(k + 20, 0.6 + dy * 0.3) : 0), ds: k > 1 ? j(k + 80, STEP * 0.7) : 0 }); }
  const gap = st.feature === 'gap';
  out.push({ u: -half, y: st.y, ds: 0 }, { u: -half * 0.3, y: st.y - (gap ? 7 : 0), ds: 0 }, { u: half * 0.3, y: st.y - (gap ? 7 : 0), ds: 0 }, { u: half, y: st.y, ds: 0 });
  for (let k = 0; k < DROP.length; k++) { const [du, dy] = DROP[k]; out.push({ u: half + du + (k ? j(k + 40, du * 0.2) : 0), y: st.y + dy + (k > 1 ? j(k + 60, 0.5 - dy * 0.18) : 0), ds: k > 1 ? j(k + 90, STEP * 0.7) : 0 }); }
  return out;
}

/** build chunk n of the world (stations n·CHUNK … (n+1)·CHUNK) */
export function buildChunk(c: Course, n: number) {
  const m = new Mesh(), s0 = n * CHUNK, s1 = s0 + CHUNK;
  c.ensure(s1 + 8);
  const W = (s: number, u: number, y: number) => { const p = c.point(s, u); return [p.x, y, p.z]; };
  // (the ground: section beside section, each face its own plane; the rows under the track only where it's lifted off them)
  for (let s = s0; s < s1; s += STEP) {
    const A = section(c, s), B = section(c, s + STEP), a = c.at(s), b = c.at(s + STEP);
    const under = a.feature !== 'none' || b.feature !== 'none';
    for (let k = 0; k < A.length - 1; k++) {
      const trackRow = k >= WALL.length && k < WALL.length + 3;
      if (trackRow && !under) continue;
      const p00 = W(s + A[k].ds, A[k].u, A[k].y), p01 = W(s + A[k + 1].ds, A[k + 1].u, A[k + 1].y), p10 = W(s + STEP + B[k].ds, B[k].u, B[k].y), p11 = W(s + STEP + B[k + 1].ds, B[k + 1].u, B[k + 1].y);
      const flip = hash(c.seed, s, k, 77) < 0.5;
      // (the shoulders, the strips beside the track, stay snow; the wall and the drop go to rock where they're steep)
      const flat = M.SNOW;
      if (flip) { m.slope(p00, p10, p11, flat); m.slope(p00, p11, p01, flat); } else { m.slope(p00, p10, p01, flat); m.slope(p10, p11, p01, flat); }
    }
    // (things on the ground here)
    for (let t = 0; t < STEP; t++) dress(c, m, s + t, A);
  }
  // (the track: a metre a row, three facets across, its ruts; a kicker's ramp and deck carried on trestles)
  for (let s = s0; s < s1; s++) {
    const a = c.at(s);
    if (a.feature === 'gap') continue;
    const e = c.at(s + 1).feature === 'gap' ? s + 0.999 : s + 1;
    const cols = [-1, -0.35, 0.3, 1];
    const row = (ss: number) => { const half = a.width / 2, r = Math.round(ss); return cols.map((f, k) => { const p = c.point(ss, f * half); return [p.x, p.y + 0.02 + (k % 3 ? (hash(c.seed, r, k) - 0.5) * 0.12 : 0), p.z]; }); };
    const R0 = row(s), R1 = row(e);
    const deck = a.feature === 'ramp' || a.feature === 'deck';
    for (let k = 0; k < 3; k++) m.quad(R0[k], R0[k + 1], R1[k + 1], R1[k], M.TRACK);
    // (ruts: two worn lines, a shade down, a hair above)
    if (!deck) for (const u of [-1.3, 1.1]) {
      const q = (ss: number, du: number) => { const p = c.point(ss, u + du + Math.sin(ss * 0.07 + u) * 0.4); return [p.x, p.y + 0.05, p.z]; };
      m.quad(q(s, -0.22), q(s, 0.22), q(e, 0.22), q(e, -0.22), M.RUT);
    }
    if (deck) kickerPiece(c, m, s, e, a.feature === 'ramp');
  }
  return new Float32Array(m.v);
}

/** a kicker's ramp or deck, from s to s+2: its sides, its trestle, and on the ramp the painted arrow */
function kickerPiece(c: Course, m: Mesh, s: number, e: number, ramp: boolean) {
  const half = c.at(s).width / 2, line = (ss: number) => c.at(ss).y, top = (ss: number, u: number) => { const p = c.point(ss, u); return [p.x, p.y, p.z]; };
  const foot = (ss: number, u: number) => { const p = c.point(ss, u); return [p.x, line(ss) - 0.1, p.z]; };
  // (side boards, black; the edge rail orange)
  for (const u of [-half, half]) {
    const dy = (p: number[], d: number) => [p[0], p[1] + d, p[2]];
    m.quad(top(s, u), top(e, u), dy(top(e, u), -0.35), dy(top(s, u), -0.35), M.BLACK);
    m.quad(dy(top(s, u), 0.12), dy(top(e, u), 0.12), top(e, u), top(s, u), M.ORANGE);
  }
  // (the trestle: a leg each side every other metre pair, cross-braced)
  if (Math.round(s) % 4 === 0) for (const u of [-half + 0.3, half - 0.3]) {
    const t = top(s, u), f = foot(s, u);
    if (t[1] - f[1] < 0.3) continue;
    const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
    m.box([(t[0] + f[0]) / 2, (t[1] + f[1]) / 2, (t[2] + f[2]) / 2], X, Y, Z, [0, 0, 0], [0.12, (t[1] - f[1]) / 2, 0.12], M.BLACK);
    const t2 = top(s + 4, u);
    if (c.at(s + 4).feature === 'ramp' || c.at(s + 4).feature === 'deck') m.quad([f[0], f[1], f[2]], [f[0], f[1] + 0.2, f[2]], [t2[0], t2[1] - 0.3, t2[2]], [t2[0], t2[1] - 0.5, t2[2]], M.BLACK);
  }
  // (on the ramp, the arrow: a chevron and its shaft, orange, laid on the boards)
  if (ramp && c.at(s - 1).feature !== 'ramp') {
    const L = 14, mid = (f: number, u: number) => { const p = c.point(s + f * L, u); return [p.x, p.y + 0.06, p.z]; };
    m.quad(mid(0.08, -0.55), mid(0.08, 0.55), mid(0.55, 0.55), mid(0.55, -0.55), M.ORANGE);
    m.tri(mid(0.5, -2.1), mid(0.5, 2.1), mid(0.92, 0), M.ORANGE);
  }
}

/** what stands on the ground at station i: the fence on the drop side, a flag on the wall side, pines down the drop, rocks */
function dress(c: Course, m: Mesh, i: number, sec: { u: number; y: number; ds: number }[]) {
  const st = c.at(i), half = st.width / 2, X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const at = (u: number, dy = 0) => { const p = c.point(i, u); return [p.x, st.y + dy, p.z]; };
  // (the fence: a post every five metres, tape between, both orange; none across a gap)
  if (st.post && st.feature === 'none') {
    const nx = c.at(i + 5), uF = half + 1.9;
    const p = at(uF);
    m.box(p, X, Y, Z, [0, 0.55, 0], [0.07, 0.6, 0.07], M.ORANGE);
    if (nx.feature === 'none') {
      const q = c.point(i + 5, uF), qy = nx.y;
      for (const [y0, y1] of [[0.78, 1.02], [0.34, 0.5]]) m.quad([p[0], st.y + y0, p[2]], [q.x, qy + y0, q.z], [q.x, qy + y1, q.z], [p[0], st.y + y1, p[2]], y0 > 0.5 ? M.ORANGE : M.WHITE);
    }
  }
  // (a flag: a tall black pole on the wall side, an orange banner hung out over the shoulder)
  if (st.flag) {
    const base = at(-half - 0.9), fw = c.point(i, 0), fx = Math.sin(fw.heading), fz = Math.cos(fw.heading), rx = -Math.cos(fw.heading), rz = Math.sin(fw.heading);
    m.box(base, X, Y, Z, [0, 3, 0], [0.06, 3, 0.06], M.BLACK);
    const P = (out: number, up: number, back: number) => [base[0] + rx * out - fx * back, base[1] + up, base[2] + rz * out - fz * back];
    m.quad(P(0, 5.9, 0), P(1.3, 5.6, 0.5), P(1.3, 3.5, 0.5), P(0, 3.7, 0), M.ORANGE);
    m.quad(P(1.3, 5.6, 0.5), P(2.7, 5.75, 0.2), P(2.7, 3.7, 0.2), P(1.3, 3.5, 0.5), M.ORANGE);
  }
  // (pines down the drop, a few up the wall's top; rocks bedded in the snow)
  const r = hash(c.seed, i, 101);
  if (i % 2 === 0 && r < 0.42) {
    const du = 6 + hash(c.seed, i, 102) * 70, u = half + du, y = groundAt(sec, u);
    const p = c.point(i, u);
    m.pine(p.x, y - 0.3, p.z, 6 + hash(c.seed, i, 103) * 9 * (du > 30 ? 1.4 : 1), c.seed * 9973 + i);
  }
  if (i % 3 === 0 && r > 0.9) {
    const u = -half - 9 - hash(c.seed, i, 104) * 25, y = groundAt(sec, u), p = c.point(i, u);
    m.pine(p.x, y - 0.3, p.z, 5 + hash(c.seed, i, 105) * 6, c.seed * 7919 + i);
  }
  if (r > 0.55 && r < 0.62) {
    const side = hash(c.seed, i, 106) < 0.5 ? -1 : 1, u = side < 0 ? -half - 1.2 - hash(c.seed, i, 107) * 2 : half + 3 + hash(c.seed, i, 108) * 14, p = c.point(i, u);
    m.rock(p.x, groundAt(sec, u) - 0.1, p.z, 0.4 + hash(c.seed, i, 109) * 1.4, c.seed + i * 31);
  }
}
function groundAt(sec: { u: number; y: number }[], u: number) {
  for (let k = 0; k < sec.length - 1; k++) if (u >= sec[k].u && u <= sec[k + 1].u) { const f = (u - sec[k].u) / (sec[k + 1].u - sec[k].u || 1); return sec[k].y + (sec[k + 1].y - sec[k].y) * f; }
  return sec[u < sec[0].u ? 0 : sec.length - 1].y;
}

/** the far ranges: a ring of faceted peaks round the origin (drawn about the eye), bodies blue, tops snow; and the valley
 * floor far below, pale, with its river */
export function buildRanges(seed: number) {
  const m = new Mesh();
  const ring = (R: number, n: number, hMin: number, hMax: number, k: number, body: number, cap: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash(seed, i, k) * 0.3, r = R * (0.9 + 0.25 * hash(seed, i, k, 1));
      const cx = Math.sin(a) * r, cz = Math.cos(a) * r, h = hMin + (hMax - hMin) * hash(seed, i, k, 2), w = h * (1.1 + hash(seed, i, k, 3));
      const sides = 5 + Math.floor(hash(seed, i, k, 4) * 3), peak = [cx + (hash(seed, i, k, 5) - 0.5) * w * 0.4, h, cz];
      const base = Array.from({ length: sides }, (_, j) => { const b = (j / sides) * Math.PI * 2; return [cx + Math.cos(b) * w * (0.7 + 0.5 * hash(seed, i, j, k)), -60, cz + Math.sin(b) * w * (0.7 + 0.5 * hash(seed, i, j, k, 9))]; });
      // (the snow line, a band partway up each face, jagged)
      const sl = 0.52 + 0.18 * hash(seed, i, k, 6);
      const mid = base.map((b, j) => { const f = sl + (hash(seed, i, j, k, 7) - 0.5) * 0.16; return [b[0] + (peak[0] - b[0]) * f, b[1] + (peak[1] - b[1]) * f, b[2] + (peak[2] - b[2]) * f]; });
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        m.quad(base[j], base[j1], mid[j1], mid[j], body);
        m.tri(mid[j], mid[j1], peak, cap);
      }
    }
  };
  ring(3000, 24, 520, 900, 1, M.MTN, M.MTNSNOW);
  ring(2300, 18, 260, 520, 2, M.MTN, M.MTNSNOW);
  return new Float32Array(m.v);
}

/** the valley floor far below: a faceted blue plain, foothills rising toward the ranges, a white river winding down it */
export function buildValley(seed: number) {
  const m = new Mesh(), F = -260, R = [0, 260, 450, 700, 1000, 1400, 1900, 2500], n = 30;
  const at = (i: number, j: number) => {
    const a = (j / n) * Math.PI * 2 + (i ? (hash(seed, i, j, 3) - 0.5) * 0.12 : 0), r = R[i] * (i ? 0.9 + 0.2 * hash(seed, i, j, 4) : 0);
    const rise = Math.max(0, (R[i] - 900) / 1600) ** 1.5 * 260;
    return [Math.sin(a) * r, F + rise + (i ? (hash(seed, i, j, 5) - 0.5) * (14 + rise * 0.5) : 0), Math.cos(a) * r];
  };
  for (let i = 0; i < R.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j), d = at(i + 1, j + 1);
    if (i) m.tri(a, c, b, M.MTN); m.tri(b, c, d, i > 4 ? M.NAVY : M.MTN);
  }
  // (the river: a ribbon winding across the plain, wide and pale, from the far ranges down past the foot of the mountain)
  const rv: number[][] = [];
  for (let k = 0; k <= 40; k++) { const z = -2200 + k * 110, x = -520 + Math.sin(k * 0.55 + seed) * 160 + Math.sin(k * 1.7) * 50; rv.push([x, F + 3, z]); }
  for (let k = 0; k < rv.length - 1; k++) {
    const p = rv[k], q = rv[k + 1], dx = q[0] - p[0], dz = q[2] - p[2], L = Math.hypot(dx, dz), w = 16 + 8 * hash(seed, k, 7);
    const nx = (-dz / L) * w, nz = (dx / L) * w;
    m.quad([p[0] - nx, p[1], p[2] - nz], [p[0] + nx, p[1], p[2] + nz], [q[0] + nx, q[1], q[2] + nz], [q[0] - nx, q[1], q[2] - nz], M.WHITE, 0.95);
  }
  return new Float32Array(m.v);
}

/** the rider and the bike, at the rider's pose: built fresh each frame (a few hundred triangles) */
export function buildRider(r: { x: number; y: number; z: number; heading: number; pitch: number; lean: number; squash: number; steerK: number; crashT: number }, t: number) {
  const m = new Mesh();
  const ch = Math.cos(r.heading), sh = Math.sin(r.heading);
  const fw = [sh, 0, ch], rt = [-ch, 0, sh];
  // (pitch about the right axis, then lean about the forward axis)
  const rot = (v: number[], ax: number[], a: number) => { const c = Math.cos(a), s = Math.sin(a), d = v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2]; const cr = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]]; return [0, 1, 2].map((i) => v[i] * c + cr[i] * s + ax[i] * d * (1 - c)); };
  const tumble = r.crashT > 0 ? t * 9 : 0;
  let F = rot(fw, rt, r.pitch + tumble), U = rot([0, 1, 0], rt, r.pitch + tumble), R = rt;
  U = rot(U, F, r.lean); R = rot(R, F, r.lean);
  const o = [r.x, r.y, r.z], X = R, Y = U, Z = F, sq = r.squash * 0.18;
  const B = (c: number[], h: number[], mat: number) => m.box(o, X, Y, Z, c, h, mat);
  // (wheels: knobbly octagons, black; their hubs white)
  m.prism(o, X, Y, Z, [0, 0.36, 0.74], 0.36, 0.09, 9, M.BLACK);
  m.prism(o, X, Y, Z, [0, 0.36, -0.7], 0.37, 0.11, 9, M.BLACK);
  m.prism(o, X, Y, Z, [0, 0.36, 0.74], 0.1, 0.1, 5, M.WHITE);
  m.prism(o, X, Y, Z, [0, 0.36, -0.7], 0.1, 0.12, 5, M.WHITE);
  // (the fork, raked; the swingarm)
  const steer = r.steerK * 0.25;
  m.box(o, X, Y, Z, [Math.sin(steer) * 0.1, 0.72 - sq * 0.5, 0.6], [0.05, 0.34, 0.05], M.WHITE);
  B([0, 0.45, -0.32], [0.05, 0.05, 0.38], M.BLACK);
  // (the body: engine, tank, side plates, fenders: orange, black, white)
  B([0, 0.58 - sq * 0.3, 0.05], [0.13, 0.17, 0.22], M.ROCK);
  B([0, 0.86 - sq, 0.26], [0.17, 0.11, 0.26], M.ORANGE);
  B([0, 0.88 - sq, -0.3], [0.15, 0.06, 0.34], M.BLACK);
  B([0.16, 0.8 - sq, -0.42], [0.02, 0.1, 0.18], M.WHITE);
  B([-0.16, 0.8 - sq, -0.42], [0.02, 0.1, 0.18], M.WHITE);
  B([0, 0.96 - sq, -0.72], [0.1, 0.03, 0.3], M.ORANGE);
  B([0, 0.82, 0.9], [0.09, 0.025, 0.24], M.ORANGE);
  B([0, 1.08 - sq, 0.48], [0.32, 0.025, 0.025], M.BLACK); // the bars
  B([0, 1.0 - sq, 0.56], [0.12, 0.09, 0.03], M.WHITE); // number plate
  // (the rider: standing, knees bent, weight forward; jersey orange and black, pants black, boots white, helmet orange)
  const k = 1 - sq * 0.6;
  for (const side of [-1, 1]) {
    B([side * 0.2, 0.86 + 0.12 * k, -0.08], [0.07, 0.17 * k, 0.07], M.BLACK); // shin
    B([side * 0.2, 1.12 + 0.2 * k, 0.0], [0.08, 0.17 * k, 0.09], M.BLACK); // thigh
    B([side * 0.2, 0.74, -0.06], [0.07, 0.06, 0.13], M.WHITE); // boot
    B([side * 0.25, 1.62 * k + 0.12, 0.3], [0.06, 0.06, 0.22], M.ORANGE); // forearm
  }
  B([0, 1.58 * k + 0.08, 0.06], [0.2, 0.2, 0.14], M.ORANGE); // torso
  B([0, 1.66 * k + 0.08, 0.0], [0.21, 0.08, 0.15], M.BLACK); // shoulders
  B([0, 1.36 * k + 0.08, -0.04], [0.18, 0.08, 0.12], M.BLACK); // hips
  B([0, 1.96 * k + 0.08, 0.2], [0.15, 0.15, 0.17], M.ORANGE); // helmet
  B([0, 1.94 * k + 0.08, 0.36], [0.11, 0.05, 0.03], M.BLACK); // visor
  B([0, 2.06 * k + 0.08, 0.4], [0.13, 0.02, 0.07], M.WHITE); // peak
  return new Float32Array(m.v);
}
