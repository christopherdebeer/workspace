/**
 * Switchback's world, as flat facets: every triangle carries one material and a tone, and the renderer gives each face
 * one flat colour from that material's four bands (lit, half, shade, deep), taken from the target. The look is three
 * values in big masses: warm pale where the light falls, charcoal where it doesn't (and in cast shadow), the blues
 * beyond; very little in between.
 *
 * - **near ground** (`buildNear`): world-aligned 64 m chunks of the carved mountain (the road's bench, the cut face above
 *   it, the embankment below), jittered so its faces break, rock where steep and snow where not; on it slender black
 *   pines, blocky crags, boulders by the road.
 * - **the route** (`buildTrack`, by 48 m of course): the road's pale surface with ragged edges and thin dark ruts, the
 *   fence along the drop (posts leaning their own ways, one orange tape sagging between), swallowtail pennants on tall
 *   poles, and the kickers: a pale ramp with its arrow and a deck, on a black X-braced truss down to the ground.
 * - **far ground** (`buildFar`): the same mountain in coarser rings out to the ranges, snow above the snow line where it
 *   isn't steep, blue rock where it is, dark forest low down; and the river, pale, on the valley floor.
 * - **the rider** (`buildRider`) and **debris** (`buildDebris`), fresh each frame.
 */
import { Course, hash, mountain, snowLine, riverZ, FLOOR } from './course';

export const M = { SNOW: 0, TRACK: 1, ROCK: 2, ORANGE: 3, BLACK: 4, WHITE: 5, MTN: 6, MTNSNOW: 7, UMBER: 8, SHADOW: 9, RUT: 10, NAVY: 11, RIVER: 12, KIT: 13 } as const;
/** each material's four bands, lit to deep (sampled from the target) */
export const PALETTE: string[][] = [
  ['#ddcfc3', '#c9b9ad', '#45434b', '#2a292f'], // snow
  ['#d6c6b9', '#c0b0a4', '#3d3b41', '#29282d'], // track
  ['#cbbbaf', '#a3958c', '#2e2d33', '#232226'], // rock
  ['#ff6a1a', '#e85a0d', '#b64b14', '#8c3a10'], // orange
  ['#2c2d32', '#1d1e23', '#16171b', '#101114'], // black
  ['#ffffff', '#e9e3de', '#8d8a95', '#4a4852'], // white
  ['#2a58ec', '#2a58ec', '#1b4bcd', '#1844c2'], // far rock, blue: lit and shaded, little between
  ['#ecebec', '#dad9da', '#7993e5', '#4a6be0'], // far snow
  ['#6b5348', '#4c3b34', '#3d2f2a', '#2c221e'], // umber
  ['#2a292f', '#2a292f', '#2a292f', '#2a292f'], // shadow
  ['#4d4952', '#3e3b44', '#2a292f', '#202024'], // ruts
  ['#2b3a78', '#252e4f', '#1d2744', '#1d2744'], // forest, far
  ['#e3e8f8', '#cdd6f5', '#a4b4ee', '#8b9de8'], // river
  ['#3a3a40', '#27262b', '#1c1c20', '#141417'], // rider's kit (black, a touch lighter so its facets read)
];
/** how much each material fades with distance (the far blues and the snow hardly at all) */
export const FOGW = [1, 1, 1, 0.8, 1, 1, 0.3, 0.12, 1, 1, 1, 0.45, 0.15, 1];

export class Mesh {
  v: number[] = [];
  private n = 0;
  /** a face's own tone (0…1, in the material's fraction): it nudges which band the face falls in, a little */
  tri(a: number[], b: number[], c: number[], m: number, tone = -1) {
    const t = m + (tone >= 0 ? tone : hash(a[0] * 0.37 + this.n++, a[2] * 0.53, b[1])) * 0.9;
    this.v.push(a[0], a[1], a[2], t, b[0], b[1], b[2], t, c[0], c[1], c[2], t);
  }
  quad(a: number[], b: number[], c: number[], d: number[], m: number, tone = hash(a[0] * 0.37 + this.n++, a[2] * 0.53, c[1])) { this.tri(a, b, c, m, tone); this.tri(a, c, d, m, tone); }
  /** a triangle whose material is chosen by its slope: `steep` where steeper than k (|ny| < k), else `flat` */
  slope(a: number[], b: number[], c: number[], flat: number, steep: number = M.ROCK, k = 0.78) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    this.tri(a, b, c, Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1) < k ? steep : flat);
  }
  /** a box along axes X, Y, Z from o: centre c, half-sizes h */
  box(o: number[], X: number[], Y: number[], Z: number[], c: number[], h: number[], m: number) {
    const p = (i: number, j: number, k: number) => [0, 1, 2].map((d) => o[d] + X[d] * (c[0] + i * h[0]) + Y[d] * (c[1] + j * h[1]) + Z[d] * (c[2] + k * h[2]));
    const P = [p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1), p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)];
    for (const [a, b, cc, d] of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) this.quad(P[a], P[b], P[cc], P[d], m);
  }
  /** a beam from a to b, square in section (half-width w) */
  beam(a: number[], b: number[], w: number, m: number) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, z = d.map((x) => x / L);
    let x = Math.abs(z[1]) > 0.9 ? [1, 0, 0] : [z[2], 0, -z[0]]; const xl = Math.hypot(x[0], x[1], x[2]); x = x.map((q) => q / xl);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    this.box(a, x, y, z, [0, 0, L / 2], [w, w, L / 2], m);
  }
  /** a slender pine, as in the target: a trunk, then tier on tier of jagged flat-bottomed skirts, narrowing to a spike */
  pine(x: number, y: number, z: number, h: number, seed: number, m: number = M.BLACK) {
    const tiers = 4 + Math.floor(hash(seed, 1) * 3), a0 = hash(seed, 2) * 6, n = 7;
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers, base = y + h * (0.16 + f * 0.7), top = base + h * (0.26 - f * 0.08), r = h * 0.2 * (1 - f * 0.78);
      // (a star of points: the tier's ragged edge, its points drooping)
      const ring = Array.from({ length: n * 2 }, (_, i) => { const a = a0 + t * 0.7 + (i / (n * 2)) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r * (0.85 + 0.3 * hash(seed, t, i)); return [x + Math.cos(a) * rr, base - (i % 2 ? 0 : h * 0.03), z + Math.sin(a) * rr]; });
      const tip = [x, top, z];
      for (let i = 0; i < n * 2; i++) this.tri(ring[i], ring[(i + 1) % (n * 2)], tip, m);
    }
    this.tri([x, y + h * 1.0, z], [x - h * 0.02, y + h * 0.8, z], [x + h * 0.02, y + h * 0.8, z], m);
    this.box([x, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, h * 0.1, 0], [h * 0.025, h * 0.12, h * 0.025], m);
  }
  /** a crag: blocky rock columns, vertical-faced, their tops cut at a slant, standing together */
  crag(x: number, y: number, z: number, h: number, seed: number) {
    const n = 2 + Math.floor(hash(seed, 1) * 3), rot = hash(seed, 9) * 6;
    for (let t = 0; t < n; t++) {
      const a = rot + t * 2.1, d = t ? h * 0.3 * (0.6 + 0.4 * hash(seed, t, 3)) : 0, hh = h * (t ? 0.4 + 0.45 * hash(seed, t, 4) : 1), w = h * (0.2 + 0.12 * hash(seed, t, 5));
      const cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d, sides = 4 + Math.floor(hash(seed, t, 6) * 2);
      const tilt = [(hash(seed, t, 7) - 0.5) * 0.8, (hash(seed, t, 8) - 0.5) * 0.8];
      const base = Array.from({ length: sides }, (_, k) => { const b = rot + t + (k / sides) * 6.28 + hash(seed, t, k, 8) * 0.5, rr = w * (0.75 + 0.4 * hash(seed, t, k, 9)); return [cx + Math.cos(b) * rr, y - 2, cz + Math.sin(b) * rr]; });
      const top = base.map((p) => [p[0] * 0.92 + cx * 0.08, y + hh + (p[0] - cx) * tilt[0] + (p[2] - cz) * tilt[1], p[2] * 0.92 + cz * 0.08]);
      for (let k = 0; k < sides; k++) { const k1 = (k + 1) % sides; this.quad(base[k], base[k1], top[k1], top[k], M.ROCK); }
      for (let k = 1; k < sides - 1; k++) this.tri(top[0], top[k], top[k + 1], M.ROCK);
    }
  }
  /** a faceted boulder: a jittered octahedron */
  rock(x: number, y: number, z: number, r: number, seed: number, m: number = M.ROCK) {
    const j = (i: number) => 0.7 + 0.6 * hash(seed, i);
    const P = [[x + r * j(1), y + r * 0.2, z], [x, y + r * 0.2, z + r * j(2)], [x - r * j(3), y + r * 0.2, z], [x, y + r * 0.2, z - r * j(4)]];
    const top = [x + (hash(seed, 5) - 0.5) * r, y + r * (0.7 + 0.6 * hash(seed, 6)), z + (hash(seed, 7) - 0.5) * r], bot = [x, y - r * 0.4, z];
    for (let i = 0; i < 4; i++) { this.tri(P[i], P[(i + 1) % 4], top, m); this.tri(P[(i + 1) % 4], P[i], bot, m); }
  }
}

/** the near ground: 64 m chunks, 4 m cells */
export const NEAR = 64, CELL = 4;
export function buildNear(c: Course, ci: number, cj: number) {
  const m = new Mesh(), n = NEAR / CELL, x0 = ci * NEAR, z0 = cj * NEAR;
  // (each vertex: the carved ground, jittered off the road so the faces break; a vertex shared by two chunks is
  // jittered the same in both)
  const V: number[][][] = [];
  for (let i = 0; i <= n; i++) {
    V.push([]);
    for (let j = 0; j <= n; j++) {
      const gx = x0 + i * CELL, gz = z0 + j * CELL, nr = c.nearest(gx, gz), st = nr.i >= 0 ? c.st[nr.i] : null;
      const band = st ? st.width / 2 + Course.SHOULDER : 0, off = st ? nr.d - st.width / 2 : Infinity, free = Math.max(0, Math.min(1, (off - Course.SHOULDER - 1.5) / 4));
      let x = gx + (hash(c.seed, gx, gz, 1) - 0.5) * 2.4 * free, z = gz + (hash(c.seed, gx, gz, 2) - 0.5) * 2.4 * free;
      // (a vertex near the bench's edge is moved onto it, so the edge runs along the road, not stepped along the grid)
      if (st && Math.abs(nr.d - band) < CELL * 0.55 && nr.d > 0.1) { const k = band / nr.d; x = st.x + (gx - st.x) * k; z = st.z + (gz - st.z) * k; }
      // (away from the road the ground breaks up: ledges and steps, more the further out)
      const far = Math.max(0, Math.min(1, (off - 12) / 20));
      V[i].push([x, c.ground(x, z) + (hash(c.seed, gx, gz, 3) - 0.5) * (1.2 + 3.2 * far) * free, z]);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = V[i][j], b = V[i + 1][j], cc = V[i + 1][j + 1], d = V[i][j + 1];
    if (hash(c.seed, x0 + i, z0 + j, 4) < 0.5) { m.slope(a, b, cc, M.SNOW); m.slope(a, cc, d, M.SNOW); } else { m.slope(a, b, d, M.SNOW); m.slope(b, cc, d, M.SNOW); }
  }
  // (on it: pines where it's gentle, crags where it's steep, boulders by the road; never on the road)
  for (let i = 0; i < n; i += 2) for (let j = 0; j < n; j += 2) {
    const gx = x0 + (i + hash(c.seed, i, j, ci, cj) * 2) * CELL, gz = z0 + (j + hash(c.seed, j, i, cj, ci) * 2) * CELL;
    const off = c.offRoad(gx, gz); if (off < Course.SHOULDER + 0.8) continue;
    const y = c.ground(gx, gz), sl = Math.abs(c.ground(gx + 2, gz) - c.ground(gx - 2, gz)) / 4 + Math.abs(c.ground(gx, gz + 2) - c.ground(gx, gz - 2)) / 4;
    const r = hash(c.seed, gx, gz, 7);
    if (sl < 1.1 && r < 0.11 && off > 4) m.pine(gx, y - 0.4, gz, 8 + hash(c.seed, gx, gz, 8) * 10, c.seed * 7 + gx * 31 + gz);
    else if (sl > 1.2 && r > 0.94) m.crag(gx, y, gz, 5 + hash(c.seed, gx, gz, 9) * 9, c.seed + gx * 17 + gz * 3);
    else if (off < 7 && r > 0.9) m.rock(gx, y - 0.2, gz, 0.5 + hash(c.seed, gx, gz, 10) * 1.6, c.seed + gx + gz * 7);
  }
  return new Float32Array(m.v);
}

/** the route, from station s0 to s0 + CHUNK */
export const CHUNK = 48;
export function buildTrack(c: Course, k: number) {
  const m = new Mesh(), s0 = k * CHUNK, s1 = s0 + CHUNK;
  c.ensure(s1 + 12);
  for (let s = s0; s < s1; s++) {
    const a = c.at(s);
    if (a.feature === 'gap') continue;
    const e = c.at(s + 1).feature === 'gap' ? s + 0.999 : s + 1;
    // (the surface: three facets across, its edges ragged)
    const cols = [-1, -0.35, 0.3, 1];
    const row = (ss: number) => { const r = Math.round(ss), half = c.point(ss, 0).width / 2; return cols.map((f, q) => { const p = c.point(ss, f * half + (q % 3 ? 0 : (hash(c.seed, r, q, 5) - 0.5) * 0.9)); return [p.x, p.y + 0.03 + (q % 3 ? (hash(c.seed, r, q) - 0.5) * 0.1 : 0), p.z]; }); };
    const R0 = row(s), R1 = row(e);
    for (let q = 0; q < 3; q++) m.quad(R0[q], R0[q + 1], R1[q + 1], R1[q], M.TRACK, 0.5);
    const deck = a.feature === 'ramp' || a.feature === 'deck';
    // (ruts: two pairs of thin dark lines, wandering a little)
    if (!deck) for (const u of [-1.4, -1.0, 0.9, 1.3]) {
      const q = (ss: number, du: number) => { const p = c.point(ss, u + du + (hash(c.seed, Math.round(ss / 7), u) - 0.5) * 0.6); return [p.x, p.y + 0.06, p.z]; };
      m.quad(q(s, -0.06), q(s, 0.06), q(e, 0.06), q(e, -0.06), M.RUT, 0.5);
    }
    if (deck) kickerPiece(c, m, s, e, a.feature === 'ramp');
    fence(c, m, s);
    if (a.flag) pennant(c, m, s, a.flag);
  }
  return new Float32Array(m.v);
}

/** the fence: a post here (on the drop side, leaning), and the tape from it to the next post, sagging between */
function fence(c: Course, m: Mesh, s: number) {
  const a = c.at(s); if (!a.post) return;
  let n = s + 1; while (n < s + 12 && !c.at(n).post) n++;
  const top = (i: number) => {
    const st = c.at(i), u = st.drop * (st.width / 2 + 1.6), p = c.point(i, u), y = c.ground(p.x, p.z), rx = -Math.cos(p.heading), rz = Math.sin(p.heading);
    // (leaning out over the drop, or back, by its own amount)
    return { foot: [p.x, y, p.z], head: [p.x + rx * st.drop * st.lean * 1.1, y + 1.05, p.z + rz * st.drop * st.lean * 1.1] };
  };
  const A = top(s);
  m.beam(A.foot, A.head, 0.05, M.ORANGE);
  if (n < s + 12 && c.at(n).post) {
    const B = top(n), mid = [(A.head[0] + B.head[0]) / 2, (A.head[1] + B.head[1]) / 2 - 0.22, (A.head[2] + B.head[2]) / 2];
    const dn = (p: number[], d: number) => [p[0], p[1] - d, p[2]];
    for (const [p, q] of [[A.head, mid], [mid, B.head]]) m.quad(dn(p, 0.06), dn(q, 0.06), dn(q, 0.18), dn(p, 0.18), M.ORANGE, 0.3);
  }
}

/** a pennant: a tall black pole by the road, a big orange swallowtail streaming out from its top */
function pennant(c: Course, m: Mesh, s: number, side: number) {
  const st = c.at(s), p = c.point(s, side * (st.width / 2 + 1.0)), y = c.ground(p.x, p.z);
  const rx = -Math.cos(p.heading) * side, rz = Math.sin(p.heading) * side, fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  m.beam([p.x, y, p.z], [p.x, y + 6.6, p.z], 0.06, M.BLACK);
  // (in the plane out from the road and up, so it's seen face on as you come; a slight fold back along the road)
  const P = (out: number, up: number, back = 0) => [p.x + rx * out - fx * back, y + up, p.z + rz * out - fz * back];
  const c0 = P(0, 5.4), pts = [P(0, 6.5), P(1.6, 6.15, 0.35), P(3.6, 5.85, 0.1), P(2.6, 5.3, 0.25), P(3.4, 4.65, 0.1), P(1.5, 4.55, 0.3), P(0, 4.3)];
  for (let i = 0; i < pts.length - 1; i++) m.tri(c0, pts[i], pts[i + 1], M.ORANGE, i < 3 ? 0.2 : 0.7);
}

/** a kicker's ramp or deck, from s to e: its dark sides, its truss (legs down to the ground, X-braced), its arrow */
function kickerPiece(c: Course, m: Mesh, s: number, e: number, ramp: boolean) {
  const half = c.at(s).width / 2, top = (ss: number, u: number) => { const p = c.point(ss, u); return [p.x, p.y, p.z]; };
  const dy = (p: number[], d: number) => [p[0], p[1] + d, p[2]];
  for (const u of [-half, half]) {
    m.quad(top(s, u), top(e, u), dy(top(e, u), -0.45), dy(top(s, u), -0.45), M.BLACK);
    m.quad(dy(top(s, u), 0.1), dy(top(e, u), 0.1), top(e, u), top(s, u), M.ORANGE);
  }
  // (the underside, dark)
  m.quad(dy(top(s, -half), -0.45), dy(top(e, -half), -0.45), dy(top(e, half), -0.45), dy(top(s, half), -0.45), M.BLACK);
  // (the truss: a pair of legs every 4 m down to whatever's under them, braced across and along in Xs)
  if (Math.round(s) % 4 === 0) {
    const legs = [-half + 0.25, half - 0.25].map((u) => { const t = dy(top(s, u), -0.45), g = c.ground(t[0], t[2]); return { t, f: [t[0], g, t[2]] }; });
    for (const L of legs) if (L.t[1] - L.f[1] > 0.3) m.beam(L.f, L.t, 0.09, M.BLACK);
    if (legs[0].t[1] - legs[0].f[1] > 1.2) { m.beam(legs[0].f, legs[1].t, 0.06, M.BLACK); m.beam(legs[1].f, legs[0].t, 0.06, M.BLACK); }
    const nx = c.at(s + 4);
    if (nx.feature === 'ramp' || nx.feature === 'deck') for (const u of [-half + 0.25, half - 0.25]) {
      const t1 = dy(top(s, u), -0.45), t2 = dy(top(s + 4, u), -0.45), g1 = c.ground(t1[0], t1[2]), g2 = c.ground(t2[0], t2[2]);
      if (t1[1] - g1 > 1.2) { m.beam([t1[0], g1, t1[2]], t2, 0.05, M.BLACK); m.beam([t2[0], g2, t2[2]], t1, 0.05, M.BLACK); }
    }
  }
  // (on the ramp, the arrow: one bold arrowhead, orange, laid on the boards)
  if (ramp && c.at(s - 1).feature !== 'ramp') {
    const L = 14, at = (f: number, u: number) => { const p = c.point(s + f * L, u); return [p.x, p.y + 0.07, p.z]; };
    m.tri(at(0.3, -2.3), at(0.9, 0), at(0.42, 0), M.ORANGE, 0.1);
    m.tri(at(0.42, 0), at(0.9, 0), at(0.3, 2.3), M.ORANGE, 0.1);
  }
}

/** the far ground: a world-aligned grid of `cell` metres, `extent` either side of (cx, cz), with a hole `hole` either side
 * (where a finer ring covers it); materials by height and slope: snow above the snow line where it isn't steep, blue rock
 * where it is, dark forest low down, pale blue elsewhere */
export function buildFar(seed: number, cx: number, cz: number, cell: number, extent: number, hole: number) {
  const m = new Mesh(), n = Math.round((extent * 2) / cell), x0 = cx - extent, z0 = cz - extent;
  const H: number[][] = [];
  for (let i = 0; i <= n; i++) { H.push([]); for (let j = 0; j <= n; j++) H[i].push(mountain(seed, x0 + i * cell, z0 + j * cell, cell)); }
  const P = (i: number, j: number) => [x0 + i * cell, H[i][j], z0 + j * cell];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const xa = x0 + i * cell, za = z0 + j * cell;
    if (xa >= cx - hole && xa + cell <= cx + hole && za >= cz - hole && za + cell <= cz + hole) continue;
    const quads = hash(seed, i + x0, j + z0) < 0.5 ? [[P(i, j), P(i + 1, j), P(i + 1, j + 1)], [P(i, j), P(i + 1, j + 1), P(i, j + 1)]] : [[P(i, j), P(i + 1, j), P(i, j + 1)], [P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]];
    for (const [a, b, c] of quads) {
      const yc = (a[1] + b[1] + c[1]) / 3, xm = (a[0] + b[0] + c[0]) / 3, zm = (a[2] + b[2] + c[2]) / 3;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, up = Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
      const snow = yc > snowLine(seed, xm, zm), forest = yc < snowLine(seed, xm, zm) - 500 && up > 0.6 && hash(seed, Math.floor(xm / 300), Math.floor(zm / 300), 8) < 0.6;
      const mat = snow ? (up > 0.62 ? M.MTNSNOW : M.MTN) : forest ? M.NAVY : yc < FLOOR + 60 ? M.MTN : up > 0.8 ? M.SNOW : M.MTN;
      m.tri(a, b, c, mat, 0.5);
    }
  }
  return new Float32Array(m.v);
}
/** the river on the valley floor: a pale ribbon */
export function buildRiver(seed: number) {
  const m = new Mesh(), pts: number[][] = [];
  for (let x = -24000; x <= 24000; x += 160) { const z = riverZ(seed, x); pts.push([x, mountain(seed, x, z) + 4, z]); }
  for (let k = 0; k < pts.length - 1; k++) {
    const p = pts[k], q = pts[k + 1], dx = q[0] - p[0], dz = q[2] - p[2], L = Math.hypot(dx, dz), w = 22 + 14 * hash(seed, k, 7);
    const nx = (-dz / L) * w, nz = (dx / L) * w;
    m.quad([p[0] - nx, p[1], p[2] - nz], [p[0] + nx, p[1], p[2] + nz], [q[0] + nx, q[1], q[2] + nz], [q[0] - nx, q[1], q[2] - nz], M.RIVER, 0.5);
  }
  return new Float32Array(m.v);
}

/** debris: each chunk a little faceted block (a jittered cube), turned by its spin, in its material */
export function buildDebris(list: { x: number; y: number; z: number; r: number; a: number; ax: number[]; mat: number; seed: number }[]) {
  const m = new Mesh();
  for (const d of list) {
    const k = d.ax, c = Math.cos(d.a), s = Math.sin(d.a);
    const rot = (v: number[]) => { const dt = v[0] * k[0] + v[1] * k[1] + v[2] * k[2], cr = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]; return [0, 1, 2].map((i) => v[i] * c + cr[i] * s + k[i] * dt * (1 - c)); };
    const X = rot([1, 0, 0]), Y = rot([0, 1, 0]), Z = rot([0, 0, 1]);
    const h = [d.r * (0.7 + 0.5 * hash(d.seed, 1)), d.r * (0.6 + 0.5 * hash(d.seed, 2)), d.r * (0.7 + 0.5 * hash(d.seed, 3))];
    m.box([d.x, d.y, d.z], X, Y, Z, [0, 0, 0], h, d.mat);
  }
  return new Float32Array(m.v);
}

/** the rider and the bike, at the rider's pose: built fresh each frame. A motocross bike in its real proportions (a
 * 1.48 m wheelbase, a 21-inch front wheel on a fork raked at 27°, the rear tyre big and knobbly), its suspension working,
 * and a rider sculpted in facets rather than boxes: tapered limbs, a broad back, a faceted helmet, crouched in the
 * attack position, boots on the pegs, elbows up, head over the bars. In the bike's frame: x right, y up, z forward. */
export function buildRider(r: { x: number; y: number; z: number; heading: number; pitch: number; lean: number; squash: number; steerK: number; crashT: number; air?: boolean; slip?: number }, t: number) {
  const m = new Mesh();
  const ch = Math.cos(r.heading), sh = Math.sin(r.heading);
  const fw = [sh, 0, ch], rt = [-ch, 0, sh];
  const rot = (v: number[], ax: number[], a: number) => { const c = Math.cos(a), s = Math.sin(a), d = v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2]; const cr = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]]; return [0, 1, 2].map((i) => v[i] * c + cr[i] * s + ax[i] * d * (1 - c)); };
  const tumble = r.crashT > 0 ? t * 9 : 0;
  let F = rot(fw, rt, r.pitch + tumble), U = rot([0, 1, 0], rt, r.pitch + tumble), R = rt;
  U = rot(U, F, r.lean); R = rot(R, F, r.lean);
  const o = [r.x, r.y, r.z], K = 1.1;
  const W = (p: number[]) => [0, 1, 2].map((d) => o[d] + (R[d] * p[0] + U[d] * p[1] + F[d] * p[2]) * K);
  const L = (a: number[], b: number[], f: number) => a.map((v, i) => v + (b[i] - v) * f);
  /** a box in local terms, turned `pitch` about x */
  const box = (c: number[], h: number[], mat: number, pitch = 0) => {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const p = (i: number, j: number, k: number) => W([c[0] + i * h[0], c[1] + cp * j * h[1] - sp * k * h[2], c[2] + sp * j * h[1] + cp * k * h[2]]);
    const P = [p(-1, -1, -1), p(1, -1, -1), p(1, 1, -1), p(-1, 1, -1), p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1)];
    for (const [a, b, cc, d] of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) m.quad(P[a], P[b], P[cc], P[d], mat);
  };
  /** a tapered limb from a (radius ra, x-scale sx) to b (rb), n-sided: the faceted form everything's made of */
  const limb = (a: number[], b: number[], ra: number, rb: number, mat: number, n = 6, sx = 1, twist = 0) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(d[0], d[1], d[2]) || 1, z = d.map((v) => v / len);
    let x = Math.abs(z[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
    const dz = x[0] * z[0] + x[1] * z[1] + x[2] * z[2]; x = x.map((v, i) => v - z[i] * dz); const xl = Math.hypot(x[0], x[1], x[2]); x = x.map((v) => v / xl);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const ring = (c: number[], rr: number) => Array.from({ length: n }, (_, k) => { const an = twist + (k / n) * Math.PI * 2; return W([0, 1, 2].map((q) => c[q] + x[q] * Math.cos(an) * rr * sx + y[q] * Math.sin(an) * rr)); });
    const A = ring(a, ra), B = ring(b, rb), ca = W(a), cb = W(b);
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; m.quad(A[k], A[k1], B[k1], B[k], mat); m.tri(cb, B[k], B[k1], mat); m.tri(ca, A[k1], A[k], mat); }
  };
  /** a faceted ball (the helmet): a few rings of a few sides, squashed so */
  const ball = (c: number[], rx: number, ry: number, rz: number, mat: number) => {
    const lat = 4, lon = 7, P = (i: number, j: number) => { const th = (i / lat) * Math.PI, ph = (j / lon) * Math.PI * 2 + i * 0.4; return W([c[0] + Math.sin(th) * Math.cos(ph) * rx, c[1] + Math.cos(th) * ry, c[2] + Math.sin(th) * Math.sin(ph) * rz]); };
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
      const a = P(i, j), b = P(i, j + 1), cc = P(i + 1, j + 1), d = P(i + 1, j);
      if (i === 0) m.tri(a, cc, d, mat); else if (i === lat - 1) m.tri(a, b, d, mat); else m.quad(a, b, cc, d, mat);
    }
  };
  /** a wheel: a fat knobbly tyre (a ring, then knob blocks standing proud round its tread, staggered side to side), the
   * rim inside it, spokes, the hub */
  const wheel = (c: number[], ro: number, ri: number, w: number, spin: number, knobs: number) => {
    const n = 16, at = (k: number, rr: number, x: number) => { const a = spin + (k / n) * Math.PI * 2; return W([c[0] + x, c[1] + Math.sin(a) * rr, c[2] + Math.cos(a) * rr]); };
    for (let k = 0; k < n; k++) {
      m.quad(at(k, ro, -w), at(k + 1, ro, -w), at(k + 1, ro, w), at(k, ro, w), M.KIT);
      for (const x of [-w, w]) { m.quad(at(k, ro, x), at(k + 1, ro, x), at(k + 1, ri, x), at(k, ri, x), M.BLACK); m.quad(at(k, ri, x * 0.6), at(k + 1, ri, x * 0.6), at(k + 1, ri * 0.88, x * 0.6), at(k, ri * 0.88, x * 0.6), M.WHITE, 0.5); }
    }
    for (let k = 0; k < knobs; k++) {
      const a = spin + (k / knobs) * Math.PI * 2, side = k % 2 ? 1 : -1, ca = Math.cos(a), sa = Math.sin(a);
      // (each knob a block standing on the tread, turned with the wheel: its height along the radius)
      box([c[0] + side * w * 0.42, c[1] + sa * (ro + 0.03), c[2] + ca * (ro + 0.03)], [w * 0.45, 0.035, 0.045], M.KIT, Math.PI / 2 - a);
    }
    for (let k = 0; k < 8; k++) { const a = spin * 0.5 + (k / 8) * Math.PI * 2; limb([c[0], c[1], c[2]], [c[0], c[1] + Math.sin(a) * ri * 0.88, c[2] + Math.cos(a) * ri * 0.88], 0.007, 0.007, M.WHITE, 3); }
    limb([c[0] - w * 1.2, c[1], c[2]], [c[0] + w * 1.2, c[1], c[2]], 0.05, 0.05, M.WHITE, 6);
  };
  // (suspension: the frame sinks on its springs, the wheels stay on the ground)
  const sq = Math.min(1, r.squash) * 0.2, fa = [0, 0.41, 0.76], ra = [0, 0.4, -0.72], spin = -t * 22;
  const rake = 0.47, clamp = [0, 1.26 - sq, 0.76 - (1.26 - 0.41) * Math.tan(rake)];
  wheel(fa, 0.41, 0.31, 0.05, spin, 18); wheel(ra, 0.4, 0.28, 0.075, spin, 20);
  const st = r.steerK * 0.18;
  for (const x of [-0.075, 0.075]) {
    const foot = [fa[0] + x, fa[1], fa[2]], top = [clamp[0] + x, clamp[1], clamp[2]];
    limb(foot, L(foot, top, 0.5), 0.035, 0.035, M.BLACK, 5);
    limb(L(foot, top, 0.45), top, 0.026, 0.026, M.WHITE, 5);
  }
  box([0, clamp[1] + 0.02, clamp[2]], [0.11, 0.03, 0.05], M.ROCK);
  limb([-0.4, clamp[1] + 0.15, clamp[2] - 0.04 + st], [0.4, clamp[1] + 0.15, clamp[2] - 0.04 - st], 0.016, 0.016, M.BLACK, 4);
  box([0, clamp[1] - 0.06, clamp[2] + 0.08], [0.13, 0.11, 0.015], M.WHITE, -0.45); // number plate
  box([0, fa[1] + 0.47 - sq * 0.4, fa[2] + 0.12], [0.07, 0.018, 0.3], M.ORANGE, 0.18); // front fender
  const fr = (y: number) => y - sq;
  box([0, fr(0.6), 0.04], [0.12, 0.17, 0.2], M.KIT);
  box([0, fr(1.05), 0.14], [0.13, 0.08, 0.2], M.ORANGE, 0.15); // tank
  for (const x of [-0.17, 0.17]) { box([x, fr(0.96), 0.27], [0.03, 0.13, 0.15], M.ORANGE, 0.35); box([x * 1.08, fr(0.9), 0.32], [0.012, 0.05, 0.08], M.WHITE, 0.35); }
  box([0, fr(1.08), -0.3], [0.11, 0.035, 0.36], M.BLACK, -0.05); // seat
  for (const x of [-0.14, 0.14]) box([x, fr(0.95), -0.44], [0.02, 0.1, 0.17], M.WHITE, -0.1); // side plates
  box([0, fr(1.05), -0.82], [0.11, 0.02, 0.26], M.ORANGE, -0.32); // rear fender
  const pivot = [0, fr(0.62), -0.14];
  for (const x of [-0.1, 0.1]) limb([x, pivot[1], pivot[2]], [x, ra[1], ra[2]], 0.04, 0.03, M.KIT, 4);
  limb(L(pivot, ra, 0.35), [0, fr(0.98), -0.18], 0.045, 0.04, M.ORANGE, 6); // the shock
  limb([0.11, fr(0.78), 0.26], [0.18, fr(0.88), -0.6], 0.03, 0.035, M.KIT, 5); // the pipe
  limb([0.19, fr(0.86), -0.5], [0.19, fr(0.96), -0.9], 0.06, 0.05, M.WHITE, 6); // the silencer
  // (the rider: crouched, leaning into the turn with the bike and a little more, weight forward)
  const crouch = Math.min(1, r.squash) * 0.16 + (r.air ? -0.05 : 0), into = r.lean * 0.12;
  const hip = [into * 0.5, fr(1.36) - crouch, -0.2], shoulder = [into, fr(1.74) - crouch * 0.8, 0.12];
  for (const side of [-1, 1]) {
    const ankle = [side * 0.2, fr(0.76), -0.06], knee = [side * 0.23 + into * 0.3, fr(1.1) - crouch * 0.6, 0.17], h = [side * 0.13 + into * 0.5, hip[1], hip[2]];
    limb([side * 0.2, fr(0.7), -0.16], [side * 0.2, fr(0.7), 0.08], 0.075, 0.06, M.WHITE, 5); // boot
    limb(ankle, knee, 0.06, 0.075, M.KIT, 6); // shin
    limb([knee[0] * 1.05, knee[1] - 0.16, knee[2] + 0.05], [knee[0] * 1.05, knee[1] + 0.03, knee[2] + 0.06], 0.05, 0.07, M.ORANGE, 5); // knee guard
    limb(knee, h, 0.085, 0.1, M.KIT, 6); // thigh
    const sh2 = [shoulder[0] + side * 0.22, shoulder[1] - 0.03, shoulder[2] - 0.02], elbow = [shoulder[0] + side * 0.42, shoulder[1] - 0.12, shoulder[2] + 0.1], hand = [side * 0.36, clamp[1] + 0.16, clamp[2] - 0.04];
    limb(sh2, elbow, 0.085, 0.065, M.ORANGE, 6); limb(elbow, hand, 0.06, 0.05, M.ORANGE, 6);
    limb(L(elbow, hand, 0.75), hand, 0.055, 0.055, M.KIT, 5); // glove
  }
  limb([hip[0], hip[1] - 0.04, hip[2]], [shoulder[0], shoulder[1], shoulder[2]], 0.15, 0.2, M.ORANGE, 6, 1.35, Math.PI / 6); // jersey, the back broad
  limb([hip[0], hip[1] + 0.02, hip[2] - 0.02], L(hip, shoulder, 0.55), 0.155, 0.17, M.KIT, 6, 1.4, Math.PI / 6); // its black lower panels
  limb([hip[0], hip[1] - 0.08, hip[2] - 0.03], [hip[0], hip[1] + 0.06, hip[2] - 0.01], 0.17, 0.16, M.KIT, 6, 1.25, Math.PI / 6); // hips
  const head = [shoulder[0] * 1.2, shoulder[1] + 0.2, shoulder[2] + 0.13];
  limb([shoulder[0], shoulder[1] - 0.02, shoulder[2] + 0.02], [shoulder[0], shoulder[1] + 0.08, shoulder[2] + 0.06], 0.13, 0.1, M.KIT, 6); // neck brace
  ball(head, 0.15, 0.155, 0.17, M.ORANGE); // helmet
  limb([head[0], head[1] - 0.1, head[2] + 0.08], [head[0], head[1] - 0.12, head[2] + 0.25], 0.08, 0.05, M.ORANGE, 5); // chin bar
  box([head[0], head[1] + 0.11, head[2] + 0.2], [0.12, 0.012, 0.1], M.KIT, -0.25); // peak
  box([head[0], head[1] + 0.01, head[2] + 0.155], [0.12, 0.04, 0.02], M.KIT); // goggles
  box([head[0], head[1] + 0.01, head[2] - 0.02], [0.158, 0.026, 0.14], M.WHITE); // goggle strap
  return new Float32Array(m.v);
}
