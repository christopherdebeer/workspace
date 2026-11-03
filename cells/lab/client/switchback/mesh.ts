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
  /** a crag: a few tall jagged rock towers leaning together */
  crag(x: number, y: number, z: number, h: number, seed: number) {
    const n = 2 + Math.floor(hash(seed, 1) * 3);
    for (let t = 0; t < n; t++) {
      const a = hash(seed, t, 2) * 6.28, d = t ? h * 0.25 * hash(seed, t, 3) : 0, hh = h * (t ? 0.45 + 0.4 * hash(seed, t, 4) : 1), r = hh * (0.28 + 0.14 * hash(seed, t, 5));
      const cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d, sides = 4 + Math.floor(hash(seed, t, 6) * 2), lean = (hash(seed, t, 7) - 0.5) * r;
      const base = Array.from({ length: sides }, (_, k) => { const b = (k / sides) * 6.28 + hash(seed, t, k, 8); const rr = r * (0.7 + 0.5 * hash(seed, t, k, 9)); return [cx + Math.cos(b) * rr, y - 1, cz + Math.sin(b) * rr]; });
      const mid = base.map((p, k) => [cx + (p[0] - cx) * 0.55 + lean * 0.5, y + hh * (0.5 + 0.2 * hash(seed, t, k, 10)), cz + (p[2] - cz) * 0.55]);
      const tip = [cx + lean, y + hh, cz + (hash(seed, t, 11) - 0.5) * r * 0.5];
      for (let k = 0; k < sides; k++) { const k1 = (k + 1) % sides; this.quad(base[k], base[k1], mid[k1], mid[k], M.ROCK); this.tri(mid[k], mid[k1], tip, M.ROCK); }
    }
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
const WALL: [number, number][] = [[1.4, 0], [2.8, 3.8], [5.5, 12], [10, 24], [18, 39], [31, 58], [52, 84]];
const DROP: [number, number][] = [[2.6, -0.05], [4.2, -2], [10, -10], [20, -24], [36, -44], [62, -74], [104, -114], [165, -165]];
export const CHUNK = 48, STEP = 4;

/** the ground's height across the section at station i (no track lift; a kicker's gap is a ravine), for placing things */
/** a smooth value noise along the course (for how the mountain's character changes as you go down it) */
export function drift(seed: number, x: number, salt: number) {
  const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
  return hash(seed, i, salt) * (1 - s) + hash(seed, i + 1, salt) * s;
}
/** the mountain's character at station i: how sheer the wall is (0 a snowy bank, 1 a cliff), how sheer the drop is (0 a
 * shelf, 1 straight down), and how much of a rock outcrop stands between the route and the drop */
export function character(c: Course, i: number) {
  const wall = drift(c.seed, i / 70, 1), drop = drift(c.seed, i / 90, 2), k = drift(c.seed, i / 34, 3);
  return { wall, drop, knob: Math.max(0, Math.min(1, (k - 0.6) / 0.25)) };
}

export function section(c: Course, i: number) {
  const st = c.at(i), half = st.width / 2, out: { u: number; y: number; ds: number }[] = [];
  const j = (k: number, amp: number) => (hash(c.seed, i, k) - 0.5) * amp;
  const ch = character(c, i), wy = 0.25 + 0.95 * ch.wall, wu = 1.9 - 0.9 * ch.wall, dyk = 0.3 + 0.7 * ch.drop, duk = 1.9 - 0.9 * ch.drop;
  for (let k = WALL.length - 1; k >= 0; k--) { const [du0, dy0] = WALL[k], du = du0 * (k ? wu : 1), dy = dy0 * wy; out.push({ u: -half - du + (k ? j(k, du * 0.3) : 0), y: st.y + dy + (k ? j(k + 20, 0.6 + dy * 0.35) : 0), ds: k > 1 ? j(k + 80, STEP * 0.9) : 0 }); }
  const gap = st.feature === 'gap';
  const under = st.feature === 'none' || st.feature === 'whoop' ? -0.08 : 0;
  out.push({ u: -half, y: st.y + under, ds: 0 }, { u: -half * 0.3, y: st.y - (gap ? 7 : -under), ds: 0 }, { u: half * 0.3, y: st.y - (gap ? 7 : -under), ds: 0 }, { u: half, y: st.y + under, ds: 0 });
  // (the drop: a shelf where it's gentle, straight down where it's sheer; an outcrop of rock rising beside the route where
  // the knob's up, the valley beyond it)
  const knob = [0, 4.5, 7, 3, 0, 0, 0, 0];
  for (let k = 0; k < DROP.length; k++) { const [du0, dy0] = DROP[k], du = du0 * (k ? duk : 1), dy = dy0 * (k ? dyk : 1) + knob[k] * ch.knob; out.push({ u: half + du + (k ? j(k + 40, du * 0.25) : 0), y: st.y + dy + (k > 1 ? j(k + 60, 0.6 - dy * 0.22) : 0), ds: k > 1 ? j(k + 90, STEP * 0.9) : 0 }); }
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
      // (under the track too, a little below it, so a kink's outside never shows a hole)
      void under;
      const p00 = W(s + A[k].ds, A[k].u, A[k].y), p01 = W(s + A[k + 1].ds, A[k + 1].u, A[k + 1].y), p10 = W(s + STEP + B[k].ds, B[k].u, B[k].y), p11 = W(s + STEP + B[k + 1].ds, B[k + 1].u, B[k + 1].y);
      const flip = hash(c.seed, s, k, 77) < 0.5;
      // (the shoulders, the strips beside the track, stay snow; the wall and the drop go to rock where they're steep)
      const flat = M.SNOW;
      if (flip) { m.slope(p00, p10, p11, flat, M.ROCK, 0.84); m.slope(p00, p11, p01, flat, M.ROCK, 0.84); } else { m.slope(p00, p10, p01, flat, M.ROCK, 0.84); m.slope(p10, p11, p01, flat, M.ROCK, 0.84); }
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
    const row = (ss: number) => { const half = a.width / 2, r = Math.round(ss); return cols.map((f, k) => { const p = c.point(ss, f * half + (k % 3 ? 0 : (hash(c.seed, r, k, 5) - 0.5) * 1.1)); return [p.x, p.y + 0.02 + (k % 3 ? (hash(c.seed, r, k) - 0.5) * 0.12 : 0), p.z]; }); };
    const R0 = row(s), R1 = row(e);
    const deck = a.feature === 'ramp' || a.feature === 'deck';
    for (let k = 0; k < 3; k++) m.quad(R0[k], R0[k + 1], R1[k + 1], R1[k], M.TRACK);
    // (ruts: two worn lines, a shade down, a hair above)
    if (!deck) for (const u of [-1.3, 1.1]) {
      const q = (ss: number, du: number) => { const p = c.point(ss, u + du + (hash(c.seed, Math.round(ss / 6), u) - 0.5) * 0.8); return [p.x, p.y + 0.05, p.z]; };
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
  // (on the ramp, a double chevron, orange, laid on the boards, pointing up it)
  if (ramp && c.at(s - 1).feature !== 'ramp') {
    const L = 14, mid = (f: number, u: number) => { const p = c.point(s + f * L, u); return [p.x, p.y + 0.06, p.z]; };
    const arm = 2.1, rise = 0.17, thick = 0.09;
    for (const f0 of [0.3, 0.56]) for (const side of [-1, 1]) {
      // (each chevron two bars meeting at its point, up the ramp)
      m.quad(mid(f0, side * arm), mid(f0 + thick, side * arm), mid(f0 + rise + thick, 0), mid(f0 + rise, 0), M.ORANGE, 0.3);
    }
  }
}

/** the flags' banners between stations s0 and s1, at time t: each an orange banner hung from the top of its pole out
 * over the shoulder, flying: waves running out along it, bigger toward its free end, which droops and trails back a
 * little; its facets catch the light and lose it as they turn, so it flickers between orange's bands as it moves */
export function buildFlags(c: Course, s0: number, s1: number, t: number) {
  const m = new Mesh(), W = 2.8, cols = 6, rows = 2;
  for (let i = Math.max(0, Math.floor(s0)); i < s1; i++) {
    const st = c.at(i); if (!st.flag) continue;
    const half = st.width / 2, b = c.point(i, -half - 0.9), base = [b.x, st.y, b.z];
    const fx = Math.sin(b.heading), fz = Math.cos(b.heading), rx = -Math.cos(b.heading), rz = Math.sin(b.heading);
    const ph = hash(c.seed, i, 31) * 6.28, gust = 1 + 0.35 * Math.sin(t * 0.9 + ph);
    // (streaming out over the shoulder and partly back along the road, so its waves show in its outline as well as
    // its facets: the free end swings, the top and bottom edges ripple)
    const sw = 0.55, ox = rx * Math.cos(sw) - fx * Math.sin(sw), oz = rz * Math.cos(sw) - fz * Math.sin(sw), nx = rx * Math.sin(sw) + fx * Math.cos(sw), nz = rz * Math.sin(sw) + fz * Math.cos(sw);
    const P = (a: number, v: number) => {
      const wave = Math.sin(a * 5.2 - t * 7.5 + ph + v * 0.6) * gust, ripple = Math.sin(a * 7 - t * 9 + ph * 1.7) * gust;
      const out = a * W * (1 - 0.06 * Math.abs(wave) * a), up = 5.9 - v * 2.3 - 0.35 * a * a * v - 0.15 * a * a + ripple * 0.2 * a;
      const across = (0.08 + 0.6 * a) * wave;
      return [base[0] + ox * out + nx * across, base[1] + up, base[2] + oz * out + nz * across];
    };
    for (let u = 0; u < cols; u++) for (let v = 0; v < rows; v++) {
      const a0 = u / cols, a1 = (u + 1) / cols, v0 = v / rows, v1 = (v + 1) / rows;
      m.tri(P(a0, v0), P(a1, v0), P(a1, v1), M.ORANGE, 0.5); m.tri(P(a0, v0), P(a1, v1), P(a0, v1), M.ORANGE, 0.5);
    }
  }
  return new Float32Array(m.v);
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
  // (a flag: a tall black pole on the wall side; its banner is drawn each frame, flying (buildFlags))
  if (st.flag) m.box(at(-half - 0.9), X, Y, Z, [0, 3, 0], [0.06, 3, 0.06], M.BLACK);
  // (pines down the drop, a few up the wall's top; rocks bedded in the snow)
  const r = hash(c.seed, i, 101);
  if (i % 2 === 0 && r < 0.26) {
    const du = 6 + hash(c.seed, i, 102) * 70, u = half + du, y = groundAt(sec, u);
    const p = c.point(i, u);
    m.pine(p.x, y - 0.3, p.z, 6 + hash(c.seed, i, 103) * 9 * (du > 30 ? 1.4 : 1), c.seed * 9973 + i);
  }
  if (i % 3 === 0 && r > 0.9) {
    const u = -half - 9 - hash(c.seed, i, 104) * 25, y = groundAt(sec, u), p = c.point(i, u);
    m.pine(p.x, y - 0.3, p.z, 5 + hash(c.seed, i, 105) * 6, c.seed * 7919 + i);
  }
  // (crags: rock towers down the drop where it's a shelf, and on the wall where it's only a bank)
  const chr = character(c, i);
  if (i % 4 === 0 && hash(c.seed, i, 120) < 0.14 * (1.4 - chr.drop)) {
    const u = half + 5 + hash(c.seed, i, 121) * 22, p = c.point(i, u);
    m.crag(p.x, groundAt(sec, u), p.z, 4 + hash(c.seed, i, 122) * 9, c.seed * 131 + i);
  }
  if (i % 4 === 2 && hash(c.seed, i, 123) < 0.16 * (1.3 - chr.wall)) {
    const u = -half - 3 - hash(c.seed, i, 124) * 14, p = c.point(i, u);
    m.crag(p.x, groundAt(sec, u), p.z, 4 + hash(c.seed, i, 125) * 8, c.seed * 137 + i);
  }
  // (boulders: big jagged ones bedded along both sides of the route, smaller ones down the drop)
  if (r > 0.55 && r < 0.66) {
    const side = hash(c.seed, i, 106) < 0.55 ? -1 : 1, u = side < 0 ? -half - 1.6 - hash(c.seed, i, 107) * 3 : half + 2.4 + hash(c.seed, i, 108) * 16, p = c.point(i, u);
    m.rock(p.x, groundAt(sec, u) - 0.2, p.z, 0.6 + hash(c.seed, i, 109) * (side < 0 ? 2.4 : 1.6), c.seed + i * 31);
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

/** the rider and the bike, at the rider's pose: built fresh each frame. A motocross bike in its real proportions (a
 * 1.48 m wheelbase, a 21-inch front wheel on a fork raked at 27°, a swingarm and shock behind), standing on the ground
 * under each wheel; its front (wheel, fork, fender, bars, number plate) turning about the raked head as it's steered,
 * opposite lock in a slide; its suspension working. The rider on it isn't fixed to it: the hips and torso ride on
 * springs (lagging the bike's lurches, swaying against its lean, standing up in the air), the head held nearer level than
 * the bike, and the legs and arms solved each frame from the hips and shoulders to the pegs and the grips, so the knees
 * and elbows take up whatever the body does. Bike frame: x right, y up, z forward, from the ground under its middle. */
export interface Pose {
  x: number; y: number; z: number; heading: number; pitch: number; lean: number; squash: number; crashT: number; air?: boolean;
  steer?: number; yFront?: number; yRear?: number; dist?: number;
  body?: { roll: number; shift: number; fore: number; rise: number };
}
export function buildRider(r: Pose, t: number) {
  const m = new Mesh();
  const ch = Math.cos(r.heading), sh = Math.sin(r.heading);
  const fw = [sh, 0, ch], rt = [-ch, 0, sh];
  const rot = (v: number[], ax: number[], a: number) => { const c = Math.cos(a), s = Math.sin(a), d = v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2]; const cr = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]]; return [0, 1, 2].map((i) => v[i] * c + cr[i] * s + ax[i] * d * (1 - c)); };
  const add = (a: number[], b: number[], k = 1) => a.map((v, i) => v + b[i] * k), sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
  const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]), nrm = (a: number[]) => { const l = len(a) || 1; return a.map((v) => v / l); };
  const crs = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const tumble = r.crashT > 0 ? t * 9 : 0;
  // (the frame: pitched (nose up +) about the right axis, then leaned about the forward one (+ right); standing on the
  // ground under each wheel when it's down)
  const pitch = r.pitch + tumble;
  let F = rot(fw, rt, pitch), U = rot([0, 1, 0], rt, pitch), R = rt;
  U = rot(U, F, r.lean); R = rot(R, F, r.lean);
  const K = 1.08, oy = !r.air && r.crashT <= 0 && r.yFront !== undefined && r.yRear !== undefined ? r.yRear + (r.yFront - r.yRear) * (0.78 / 1.6) : r.y;
  const o = [r.x, oy, r.z];
  const W = (p: number[]) => [0, 1, 2].map((d) => o[d] + (R[d] * p[0] + U[d] * p[1] + F[d] * p[2]) * K);
  const L = (a: number[], b: number[], f: number) => a.map((v, i) => v + (b[i] - v) * f);
  const ID = (p: number[]) => p;
  /** a box in local terms (centre, half-sizes, turned `pitch` about x), through a local transform */
  const box = (c: number[], h: number[], mat: number, pt = 0, T: (p: number[]) => number[] = ID) => {
    const cp = Math.cos(pt), sp = Math.sin(pt);
    const p = (i: number, j: number, k: number) => W(T([c[0] + i * h[0], c[1] + cp * j * h[1] - sp * k * h[2], c[2] + sp * j * h[1] + cp * k * h[2]]));
    const P = [p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1), p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)];
    for (const [a, b, cc, d] of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) m.quad(P[a], P[b], P[cc], P[d], mat);
  };
  /** a box in its own frame (axes X, Y, Z, local), centre c, half-sizes h */
  const boxF = (c: number[], X: number[], Y: number[], Z: number[], h: number[], mat: number) => {
    const p = (i: number, j: number, k: number) => W([0, 1, 2].map((d) => c[d] + X[d] * i * h[0] + Y[d] * j * h[1] + Z[d] * k * h[2]));
    const P = [p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1), p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)];
    for (const [a, b, cc, d] of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) m.quad(P[a], P[b], P[cc], P[d], mat);
  };
  /** a tapered limb or tube from a (radius ra) to b (rb), n-sided, its section stretched `sx` across (toward `side`) */
  const limb = (a: number[], b: number[], ra: number, rb: number, mat: number, n = 6, sx = 1, side = [1, 0, 0]) => {
    const z = nrm(sub(b, a)); let x = sub(side, z.map((v) => v * (side[0] * z[0] + side[1] * z[1] + side[2] * z[2])));
    if (len(x) < 1e-3) x = Math.abs(z[1]) < 0.9 ? nrm(crs([0, 1, 0], z)) : [1, 0, 0]; x = nrm(x);
    const y = crs(z, x);
    const ring = (c: number[], rr: number) => Array.from({ length: n }, (_, k) => { const an = (k / n) * Math.PI * 2 + Math.PI / n; return W(add(add(c, x, Math.cos(an) * rr * sx), y, Math.sin(an) * rr)); });
    const A = ring(a, ra), B = ring(b, rb), ca = W(a), cb = W(b);
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; m.quad(A[k], A[k1], B[k1], B[k], mat); m.tri(cb, B[k], B[k1], mat); m.tri(ca, A[k1], A[k], mat); }
  };
  /** two bones from a to c (lengths l1, l2), bending toward `pole`: the joint between */
  const ik = (a: number[], c: number[], l1: number, l2: number, pole: number[]) => {
    const d = sub(c, a), dl = Math.min(len(d), (l1 + l2) * 0.999), dir = nrm(d);
    const along = (l1 * l1 - l2 * l2 + dl * dl) / (2 * dl), h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const pd = pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2], perp = nrm(sub(pole, dir.map((v) => v * pd)));
    return add(add(a, dir, along), perp, h);
  };
  // (suspension: the frame sinks on its springs (rises in the air), the wheels stay where they stand)
  const sq = Math.max(-0.35, Math.min(1, r.squash)) * 0.18, fa = [0, 0.4, 0.76], ra = [0, 0.39, -0.72], spin = -(r.dist ?? t * 20) / 0.4;
  const rake = 0.47, head = [0, 1.22 - sq, 0.76 - (1.22 - 0.4) * Math.tan(rake) - 0.05];
  // (the front turns about the steering axis through the head, raked back)
  const axis = [0, Math.cos(rake), -Math.sin(rake)], delta = r.steer ?? 0;
  const S = (p: number[]) => add(head, rot(sub(p, head), axis, delta));
  /** a wheel: a knobbly tyre (a ring, its tread stepped), the rim inside, open between, the hub */
  const wheel = (c: number[], ro: number, ri: number, w: number, T: (p: number[]) => number[]) => {
    const n = 16, at = (k: number, rr: number, x: number) => { const a = spin + (k / n) * Math.PI * 2; return W(T([c[0] + x, c[1] + Math.sin(a) * rr, c[2] + Math.cos(a) * rr])); };
    for (let k = 0; k < n; k++) {
      const r0 = ro * (k % 2 ? 0.95 : 1);
      m.quad(at(k, r0, -w), at(k + 1, r0, -w), at(k + 1, r0, w), at(k, r0, w), M.BLACK);
      for (const x of [-w, w]) { m.quad(at(k, r0, x), at(k + 1, r0, x), at(k + 1, ri, x), at(k, ri, x), M.BLACK); m.quad(at(k, ri, x * 0.7), at(k + 1, ri, x * 0.7), at(k + 1, ri * 0.86, x * 0.7), at(k, ri * 0.86, x * 0.7), M.ROCK); }
    }
    for (let k = 0; k < 6; k++) { const a = spin * 0.5 + (k / 6) * Math.PI * 2; limb(T(c), T([c[0], c[1] + Math.sin(a) * ri * 0.86, c[2] + Math.cos(a) * ri * 0.86]), 0.006, 0.006, M.ROCK, 3); }
    limb(T([c[0] - w * 1.3, c[1], c[2]]), T([c[0] + w * 1.3, c[1], c[2]]), 0.045, 0.045, M.WHITE, 6);
  };
  // (the front: wheel, fork legs and stanchions to the clamps, the clamps, bars and grips, number plate, fender)
  wheel(fa, 0.4, 0.29, 0.05, S);
  for (const x of [-0.075, 0.075]) {
    const foot = [x, fa[1], fa[2]], top = [x, head[1], head[2]];
    limb(S(foot), S(L(foot, top, 0.5)), 0.032, 0.032, M.BLACK, 5);
    limb(S(L(foot, top, 0.45)), S(top), 0.024, 0.024, M.WHITE, 5);
  }
  box([0, head[1] + 0.02, head[2]], [0.11, 0.03, 0.05], M.ROCK, 0, S);
  const bar = (x: number) => S([x, head[1] + 0.15, head[2] - 0.05]);
  limb(bar(-0.4), bar(0.4), 0.016, 0.016, M.BLACK, 4);
  for (const x of [-0.34, 0.34]) limb(bar(x - 0.06), bar(x + 0.06), 0.024, 0.024, M.WHITE, 5);
  box([0, head[1] - 0.06, head[2] + 0.08], [0.13, 0.11, 0.015], M.WHITE, -0.45, S); // number plate
  box([0, fa[1] + 0.47 - sq * 0.3, fa[2] + 0.06], [0.065, 0.015, 0.24], M.ORANGE, 0.22, S); // front fender, close over the wheel, its beak forward
  // (the frame's mass: engine, tank and shrouds, seat, side plates, the rear fender kicked up; the swingarm and shock)
  const fr = (y: number) => y - sq;
  box([0, fr(0.6), 0.04], [0.12, 0.17, 0.2], M.ROCK);
  box([0, fr(0.8), 0.2], [0.07, 0.1, 0.07], M.ROCK, -0.3); // the cylinder
  box([0, fr(1.04), 0.14], [0.13, 0.08, 0.2], M.ORANGE, 0.15); // tank
  for (const x of [-0.17, 0.17]) { box([x, fr(0.96), 0.27], [0.025, 0.13, 0.15], M.ORANGE, 0.35); box([x * 1.05, fr(0.9), 0.32], [0.012, 0.05, 0.08], M.WHITE, 0.35); }
  box([0, fr(1.07), -0.3], [0.11, 0.035, 0.36], M.BLACK, -0.05); // seat
  for (const x of [-0.14, 0.14]) box([x, fr(0.95), -0.44], [0.018, 0.1, 0.17], M.WHITE, -0.1); // side plates
  box([0, fr(1.05), -0.82], [0.1, 0.018, 0.24], M.ORANGE, -0.32); // rear fender
  wheel(ra, 0.39, 0.27, 0.065, ID);
  const pivot = [0, fr(0.62), -0.14];
  for (const x of [-0.09, 0.09]) limb([x, pivot[1], pivot[2]], [x, ra[1], ra[2]], 0.035, 0.028, M.ROCK, 4);
  limb(L(pivot, ra, 0.35), [0, fr(0.98), -0.18], 0.04, 0.04, M.ORANGE, 6); // the shock
  limb([0.11, fr(0.78), 0.26], [0.17, fr(0.86), -0.62], 0.03, 0.03, M.ROCK, 5); // the pipe
  limb([0.17, fr(0.86), -0.52], [0.17, fr(0.96), -0.9], 0.055, 0.045, M.WHITE, 6); // the silencer
  // (the rider. The body rides on springs: the hips shifted and lifted by it, the torso swaying against the bike's lean
  // and pitched with the hips' fore and aft; the head held nearer level; the legs from the hips to the pegs, the arms from
  // the shoulders to the grips, each solved through its joint, so the knees and elbows take up the difference)
  const b = r.body ?? { roll: 0, shift: 0, fore: 0, rise: 0 }, crouch = Math.max(0, r.squash) * 0.12;
  const hipC = [b.shift, fr(1.3) - crouch + b.rise, -0.2 + b.fore];
  const zf = [0, 0, 1], tilt = 0.66 + b.fore * 1.6;
  const tdir = rot([0, Math.cos(tilt), Math.sin(tilt)], zf, b.roll), right = rot([1, 0, 0], zf, b.roll);
  const shC = add(hipC, tdir, 0.5);
  for (const side of [-1, 1]) {
    // (legs: the boot on its peg, the knee pushed forward and a little out, gripping the bike)
    const peg = [side * 0.2, fr(0.72), -0.06], ankle = [side * 0.2, fr(0.8), -0.08], hip = add(add(hipC, right, side * 0.12), tdir, -0.03);
    const knee = ik(hip, ankle, 0.46, 0.46, [side * 0.35, 0.15, 1]);
    limb([side * 0.2, fr(0.7), -0.18], [side * 0.2, fr(0.7), 0.08], 0.06, 0.05, M.WHITE, 5); // boot
    limb(ankle, L(ankle, knee, 0.45), 0.055, 0.06, M.WHITE, 5); // boot's leg
    limb(L(ankle, knee, 0.4), knee, 0.058, 0.07, M.BLACK, 6); // shin
    limb(L(knee, ankle, 0.35), add(knee, [0, 0.04, 0.03]), 0.05, 0.065, M.ORANGE, 5); // knee guard
    limb(knee, hip, 0.075, 0.095, M.BLACK, 6); // thigh
    // (arms: the shoulder to the grip, the elbow up and out)
    const shoulder = add(shC, right, side * 0.2), grip = bar(side * 0.33), elbow = ik(shoulder, grip, 0.3, 0.3, [side * 1, 0.55, -0.25]);
    limb(shoulder, elbow, 0.07, 0.055, M.ORANGE, 6); limb(elbow, L(elbow, grip, 0.8), 0.05, 0.045, M.ORANGE, 6);
    limb(L(elbow, grip, 0.75), grip, 0.045, 0.045, M.BLACK, 5); // glove
  }
  limb(hipC, shC, 0.13, 0.16, M.ORANGE, 6, 1.35, right); // jersey, the back broad
  limb(L(hipC, shC, -0.05), L(hipC, shC, 0.42), 0.135, 0.14, M.BLACK, 6, 1.4, right); // its black lower panels
  limb(L(hipC, shC, 0.75), L(hipC, shC, 1.06), 0.17, 0.12, M.BLACK, 6, 1.3, right); // shoulders, the neck brace
  // (the head: on the neck, forward of the shoulders, rolled back toward level against the bike's lean)
  const hRoll = b.roll - r.lean * 0.5, hx = rot([1, 0, 0], zf, hRoll), hy = rot([0, 1, 0], zf, hRoll), hz = zf;
  const hc = add(add(shC, tdir, 0.17), [0, 0.02, 0.12]);
  // (the helmet: a faceted ball, a little long front to back)
  {
    const lat = 4, lon = 8, P = (i: number, j: number) => { const th = (i / lat) * Math.PI, ph = (j / lon) * Math.PI * 2 + (i % 2) * 0.35; return W([0, 1, 2].map((d) => hc[d] + hx[d] * Math.sin(th) * Math.cos(ph) * 0.15 + hy[d] * Math.cos(th) * 0.15 + hz[d] * Math.sin(th) * Math.sin(ph) * 0.17)); };
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) { const p0 = P(i, j), p1 = P(i, j + 1), p2 = P(i + 1, j + 1), p3 = P(i + 1, j); if (i === 0) m.tri(p0, p2, p3, M.ORANGE); else if (i === lat - 1) m.tri(p0, p1, p3, M.ORANGE); else m.quad(p0, p1, p2, p3, M.ORANGE); }
  }
  boxF(add(add(hc, hy, -0.1), hz, 0.17), hx, rot(hy, hx, 0.5), rot(hz, hx, 0.5), [0.075, 0.055, 0.07], M.ORANGE); // chin bar
  boxF(add(add(hc, hy, 0.12), hz, 0.18), hx, rot(hy, hx, -0.25), rot(hz, hx, -0.25), [0.12, 0.012, 0.09], M.BLACK); // peak
  boxF(add(add(hc, hy, 0.01), hz, 0.16), hx, hy, hz, [0.125, 0.035, 0.012], M.BLACK); // goggle lens
  boxF(add(hc, hy, 0.01), hx, hy, hz, [0.152, 0.024, 0.15], M.WHITE); // goggle strap
  boxF(add(add(hc, hy, 0.09), hz, -0.02), hx, hy, hz, [0.025, 0.07, 0.13], M.BLACK); // helmet stripe
  return new Float32Array(m.v);
}
