/**
 * Switchback's world, as flat facets: every triangle carries one material, and the renderer gives each face one flat
 * colour from that material's few bands. Nothing is smooth; the mountain is a field of big planes.
 *
 * The world is made in chunks along the line (a chunk: 48 m of it): the cross-section at every station, from high up the
 * wall on the left to far down the drop on the right, jittered so its faces break; rock where it's steep and snow where
 * it isn't; the pale track laid over it; the fence along the drop, its posts and tape; flags on the wall
 * side; kickers on black trestles; black pines down the drop. Behind it all a ring of far ranges, blue, their tops snow,
 * that keeps its distance from the eye.
 */
import { Course, JUMPS, hash } from './course';
import { STEP, WALL, section, character, groundAt, notch } from './ground';

export const M = { SNOW: 0, TRACK: 1, ROCK: 2, ORANGE: 3, BLACK: 4, WHITE: 5, MTN: 6, MTNSNOW: 7, UMBER: 8, SHADOW: 9, RUT: 10, NAVY: 11, FAR: 12, FARSNOW: 13, RIDGE: 14, FOREST: 15, VALLEY: 16, CUT_ORANGE: 17, CUT_BLACK: 18, CREAM: 19, GOUGE: 20 } as const;
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
  ['#ccbcb2', '#ab9c9c', '#8f8394', '#6f6a86'], // ruts: the track's own colours a step down (worn grooves)
  ['#535e8a', '#2c3768', '#162140', '#101a36'], // navy
  // (the backdrop: one family of blues, lighter and flatter the further off; no charcoal in it)
  ['#5b80f2', '#4c74f0', '#3d66ec', '#3560e6'], // the farthest range
  ['#f2f3f8', '#e2e5f2', '#aab8f0', '#93a6ee'], // its snow
  ['#1b49d0', '#1742c2', '#1238a8', '#10329a'], // the foothill ridge
  ['#163291', '#142d84', '#12287a', '#11246e'], // forest along its foot
  ['#2f5be6', '#2f5be6', '#2a55e0', '#2a55e0'], // the valley floor
  // (the rider drawn as cut colour (style 'cut'): each mass one flat field, and one cut where it turns from the light)
  ['#ff6c12', '#ff6c12', '#ff6c12', '#1d1d22'], // orange, its cut charcoal: the shadow side merges into the dark mass
  ['#1d1d22', '#1d1d22', '#1d1d22', '#1d1d22'], // charcoal: the legs and the whole machine, one mass, no marks inside it
  ['#f6e7c6', '#f6e7c6', '#f6e7c6', '#c7ae86'], // cream accents (boots, fork, plates, helmet), a tan cut
  ['#857c92', '#7d7590', '#6f6a86', '#5d5a78'], // a gouge's shadowed wall (`ruts=cut`): the deep shade's violet, the road's ink
];

/** the ruts lighter than the road instead (`ruts=light`): the worn line polished, catching the light like a flash */
export const RUT_LIGHT = ['#f7f3ef', '#ebe4de', '#d6ccc6', '#b4aaac'];

export class Mesh {
  v: number[] = [];
  /** a face's own tone (0…1, carried in the material's fraction): it nudges which band the face falls in, so planes lit
   * alike still break into different greys, as a painter would set them */
  private n = 0;
  /** `moving`: the mesh is built afresh each frame (the rider, the flags), so a face's own tone comes from its place in
   * the build, not from where it is, and holds steady as it moves rather than flickering between bands */
  constructor(readonly moving = false, readonly flat = false) {}
  /** (`flat`: no tone of its own at all; the face's light alone picks its band) */
  private tone(a: number[], b: number[], c: number[]) { return this.flat ? 0.5 : this.moving ? hash(this.n++, 7.3) : hash(a[0] * 0.37 + this.n++, a[2] * 0.53, c[1]); }
  tri(a: number[], b: number[], c: number[], m: number, tone = -1) {
    const t = m + (tone >= 0 ? tone : this.tone(a, b, b)) * 0.9;
    this.v.push(a[0], a[1], a[2], t, b[0], b[1], b[2], t, c[0], c[1], c[2], t);
  }
  quad(a: number[], b: number[], c: number[], d: number[], m: number, tone = this.tone(a, b, c)) { this.tri(a, b, c, m, tone); this.tri(a, c, d, m, tone); }
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

export const CHUNK = 48;

/** the track's row at station r: column k (0 the wall-side edge … 3 the drop-side edge) across it, where it stands (u) and
 * how far above the line (dy): the edges ragged in u, the two inner columns rough in height */
export function trackCol(seed: number, r: number, k: number, half: number): [number, number] {
  const f = [-1, -0.35, 0.3, 1][k];
  return [f * half + (k % 3 ? 0 : (hash(seed, r, k, 5) - 0.5) * 1.1), 0.02 + (k % 3 ? (hash(seed, r, k) - 0.5) * 0.12 : 0)];
}

/** build chunk n of the world (stations n·CHUNK … (n+1)·CHUNK) */
export function buildChunk(c: Course, n: number) {
  const m = new Mesh(), s0 = n * CHUNK, s1 = s0 + CHUNK;
  c.ensure(s1 + 8);
  const W = (s: number, u: number, y: number) => { const p = c.point(s, u); return [p.x, y, p.z]; };
  // (the ground: section beside section, each face its own plane; the rows under the track only where it's lifted off them)
  // (every gap is cut into the mountain now, built kickers' too: their trestles stand over a cleft, not a trench)
  const natGap = (i: number) => c.at(i).feature === 'gap';
  for (let s = s0; s < s1; s += STEP) {
    const A = section(c, s), B = section(c, s + STEP), a = c.at(s), b = c.at(s + STEP);
    const under = a.feature !== 'none' || b.feature !== 'none';
    let fine = false;
    for (let i = s; i <= s + STEP && !fine; i++) fine = natGap(i);
    if (fine) { cutBlock(c, m, s, A, B, W); continue; }
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
  // (the track: a metre a row, three facets across; a kicker's ramp and deck carried on trestles. Its ruts are drawn
  // near the eye only, frame by frame: ruts.ts)
  for (let s = s0; s < s1; s++) {
    const a = c.at(s);
    if (a.feature === 'gap') continue;
    const e = c.at(s + 1).feature === 'gap' ? s + 0.999 : s + 1;
    const row = (ss: number) => { const half = a.width / 2, r = Math.round(ss); return [0, 1, 2, 3].map((k) => { const [u, dy] = trackCol(c.seed, r, k, half), p = c.point(ss, u); return [p.x, p.y + dy, p.z]; }); };
    const R0 = row(s), R1 = row(e);
    const deck = a.feature === 'ramp' || a.feature === 'deck';
    for (let k = 0; k < 3; k++) m.quad(R0[k], R0[k + 1], R1[k + 1], R1[k], M.TRACK);
    if (deck) kickerPiece(c, m, s, e, a.feature === 'ramp');
  }
  return new Float32Array(m.v);
}

/** a block of ground (STEP stations) through which a natural gap cuts: drawn a metre at a time, each row between the block's
 * two sections as the coarse ground would lie, less the gap's notch, so the cleft or gorge has a crisp shape and still
 * meets the ground either side; at the gap's middle, a gorge's stream, white, along its floor and on down the drop (and
 * for a waterfall, down the wall's gully too) */
function cutBlock(c: Course, m: Mesh, s: number, A: { u: number; y: number; ds: number }[], B: { u: number; y: number; ds: number }[], W: (s: number, u: number, y: number) => number[]) {
  const rows: number[][][] = [];
  for (let i = 0; i <= STEP; i++) {
    const f = i / STEP;
    rows.push(A.map((p, k) => { const u = p.u + (B[k].u - p.u) * f, ds = p.ds + (B[k].ds - p.ds) * f; return W(s + i + ds, u, p.y + (B[k].y - p.y) * f - notch(c, s + i, u)); }));
  }
  for (let i = 0; i < STEP; i++) for (let k = 0; k < A.length - 1; k++) {
    const p00 = rows[i][k], p01 = rows[i][k + 1], p10 = rows[i + 1][k], p11 = rows[i + 1][k + 1];
    if (hash(c.seed, s + i, k, 77) < 0.5) { m.slope(p00, p10, p11, M.SNOW, M.ROCK, 0.84); m.slope(p00, p11, p01, M.SNOW, M.ROCK, 0.84); } else { m.slope(p00, p10, p01, M.SNOW, M.ROCK, 0.84); m.slope(p10, p11, p01, M.SNOW, M.ROCK, 0.84); }
  }
  for (let i = 0; i < STEP; i++) {
    const st = c.at(s + i), nx = c.at(s + i + 1);
    if (st.site !== 'gorge' || st.feature !== 'gap' || (st.gapT ?? 0) > 0.5 || (nx.feature === 'gap' && (nx.gapT ?? 1) <= 0.5)) continue;
    // (the stream: from the gully's top if it falls down the wall, else from the wall's foot; on down to the drop's end)
    // (where it falls, the stream runs down the gully to the lip and picks up again at the foot; the fall itself is thrown
    // clear of the rock, drawn each frame: buildFalls)
    const h = st.heading, fx = Math.sin(h) * 0.9, fz = Math.cos(h) * 0.9, row = rows[i], W0 = WALL.length;
    for (let k = st.fall ? 0 : W0 - 3; k < row.length - 1; k++) {
      if (st.fall && k >= W0 - 3 && k < W0) continue;
      // (held a little off the rock toward the open side, so it reads as falling water, not a stripe painted on)
      const p = row[k], q = row[k + 1], rx = -Math.cos(h), rz = Math.sin(h), out = k < A.length - 12 ? 1.2 : 0;
      const up = (v: number[], d: number) => [v[0] + fx * d + rx * out, v[1] + 0.8, v[2] + fz * d + rz * out];
      m.quad(up(p, -1.6), up(p, 1.6), up(q, 1.6), up(q, -1.6), M.WHITE, 0.5);
    }
  }
}

/** a point of the cut ground at station i, index k across the section: as the cut block draws it */
function cutPoint(c: Course, i: number, k: number, cut = true) {
  const s4 = Math.floor(i / STEP) * STEP, A = section(c, s4)[k], B = section(c, s4 + STEP)[k], f = (i - s4) / STEP;
  const u = A.u + (B.u - A.u) * f;
  return { s: i + A.ds + (B.ds - A.ds) * f, u, y: A.y + (B.y - A.y) * f - (cut ? notch(c, i, u) : 0) };
}

/** the waterfalls near the rider, built each frame so their water moves: where a gorge has one, at its middle, from a lip
 * partway up the wall's gully the water is thrown clear of the rock and falls in an arc to the gorge's floor, widening as
 * it goes, bands of it sliding down; spray tumbling at its foot */
export function buildFalls(c: Course, s0: number, s1: number, t: number) {
  const m = new Mesh(true, true);
  for (let i = Math.max(1, Math.floor(s0)); i < s1; i++) {
    const st = c.at(i), nx = c.at(i + 1);
    if (st.feature !== 'gap' || !st.fall || (st.gapT ?? 1) > 0.5 || (nx.feature === 'gap' && (nx.gapT ?? 1) <= 0.5)) continue;
    // (the lip at the gorge's rim on the wall side, where the stream comes off the mountain's face; below it the gorge has
    // been cut away, so the water falls clear)
    const lip = cutPoint(c, i, WALL.length - 3, false), foot = cutPoint(c, i, WALL.length), drop = Math.max(4, lip.y - foot.y);
    const T = Math.sqrt(drop / 4.9), N = 14, P = (tau: number, side: number) => {
      const a = (2.2 + tau * 1.1) * side, u = lip.u + 0.9 + 3.4 * tau, p = c.point(lip.s + a, u);
      return [p.x, lip.y + 0.4 - 4.9 * tau * tau, p.z];
    };
    for (let n = 0; n < N; n++) {
      const t0 = (n / N) * T, t1 = ((n + 1) / N) * T, ph = (((t0 + t1) / 2) * 2.4 - t * 1.7) % 1, band = (ph + 1) % 1 < 0.28;
      m.quad(P(t0, -1), P(t0, 1), P(t1, 1), P(t1, -1), band ? M.SNOW : M.WHITE);
    }
    // (spray: a few white shards tumbling where it lands)
    const fu = lip.u + 0.9 + 3.4 * T;
    for (let j = 0; j < 9; j++) {
      const a = t * (2 + hash(i, j) * 3) + j, r = 1.2 + 2.2 * hash(i, j, 2), q = c.point(lip.s + Math.cos(a + j) * r, fu + Math.sin(a * 0.7 + j) * r * 0.6);
      const y = foot.y + 0.6 + ((t * 1.3 + hash(i, j, 3)) % 1) * 3.5, sz = 0.5 + hash(i, j, 4) * 0.6;
      m.tri([q.x, y, q.z], [q.x + Math.cos(a) * sz, y + sz, q.z + Math.sin(a) * sz], [q.x - Math.sin(a) * sz, y + sz * 0.4, q.z + Math.cos(a) * sz], M.WHITE);
    }
  }
  return new Float32Array(m.v);
}

/** a kicker's ramp or deck, from s to s+2: its sides, its trestle, and on the ramp the painted arrow */
function kickerPiece(c: Course, m: Mesh, s: number, e: number, ramp: boolean) {
  const built = !c.at(s).site || c.at(s).site === 'built';
  if (built) builtPiece(c, m, s, e);
  chevrons(c, m, s, ramp);
}
/** a built kicker's boards and trestle, black, its edge rail orange */
function builtPiece(c: Course, m: Mesh, s: number, e: number) {
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
}
/** on the ramp, its chevrons, orange, laid on the boards (or painted on the rock, like trail marks), pointing up it: as
 * many as the jump's size, one for a hop to four for a booter, so how big it is reads from the run-in */
function chevrons(c: Course, m: Mesh, s: number, ramp: boolean) {
  if (ramp && c.at(s - 1).feature !== 'ramp') {
    const n = c.at(s).size ?? 2, L = JUMPS[n].ramp, at = (d: number, u: number) => { const p = c.point(s + d, u); return [p.x, p.y + 0.06, p.z]; };
    const arm = 2.1, rise = 2.4, thick = 1.26, pitch = 3.4, d0 = L * 0.5 - ((n - 1) * pitch + rise + thick) / 2;
    for (let j = 0; j < n; j++) for (const side of [-1, 1]) {
      // (each chevron two bars meeting at its point, up the ramp)
      const d = d0 + j * pitch;
      m.quad(at(d, side * arm), at(d + thick, side * arm), at(d + rise + thick, 0), at(d + rise, 0), M.ORANGE, 0.3);
    }
  }
}

/** the flags' banners between stations s0 and s1, at time t: each an orange banner hung from the top of its pole out
 * over the shoulder, flying: waves running out along it, bigger toward its free end, which droops and trails back a
 * little; its facets catch the light and lose it as they turn, so it flickers between orange's bands as it moves */
export function buildFlags(c: Course, s0: number, s1: number, t: number) {
  const m = new Mesh(true), W = 2.8, cols = 6, rows = 2;
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

/** the backdrop, drawn about the eye (far enough that it needn't move with you): skylines and a foothill ridge, built as
 * continuous ridge lines rather than repeated peaks. Each is a crest (peaks of their own heights and widths, broad
 * shoulders and sharp summits, some broken by a notch, overlapping so one hides the next), a fold row partway down (pushed
 * toward you under the summits, back in the saddles, so each face is one plane, lit or in shade), and a base below the
 * valley's floor. Snow comes down from the crest where it's above the snow line, further down the gullies than the
 * spurs, so it reads as fields and runnels, not caps. All one family of blues, lighter the further off. */
function skyline(m: Mesh, seed: number, k: number, spec: { R: number; floor: number; lo: number; hi: number; peaks: number; body: number; snow: number; snowline: number; from?: number; to?: number; fold: number }) {
  const { R, floor, lo, hi, body, snow, snowline } = spec, from = spec.from ?? 0, to = spec.to ?? Math.PI * 2, arc = spec.from !== undefined;
  const H = (i: number, salt: number) => hash(seed, k, i, salt);
  const peaks = Array.from({ length: spec.peaks }, (_, i) => ({
    a: from + (to - from) * (arc ? 0.12 + 0.76 * H(i, 1) : H(i, 1)), h: lo + (hi - lo) * Math.pow(H(i, 2), 1.3),
    wl: 0.1 + 0.32 * H(i, 3), wr: 0.1 + 0.32 * H(i, 4), p: 0.65 + 1.0 * H(i, 5), notch: H(i, 6) < 0.4,
  }));
  const wrap = (d: number) => (arc ? d : Math.atan2(Math.sin(d), Math.cos(d)));
  const crest = (a: number) => {
    // (the ridge between summits never sinks far: a range is continuous, its saddles a little below its lowest peaks)
    let h = lo * (arc ? 0.3 : 0.7) * (0.85 + 0.3 * Math.sin(a * 3 + k));
    for (const pk of peaks) {
      const d = wrap(a - pk.a), w = d < 0 ? pk.wl : pk.wr, f = Math.max(0, 1 - Math.abs(d) / w);
      let v = pk.h * Math.pow(f, pk.p);
      // (a broken summit: a notch cut just off the top)
      if (pk.notch && Math.abs(d - w * 0.12) < w * 0.06) v *= 0.93;
      h = Math.max(h, v);
    }
    // (an arc rises from the floor at one end and falls back to it at the other)
    if (arc) { const e = Math.min(a - from, to - a) / ((to - from) * 0.18); h *= Math.max(0, Math.min(1, e)); }
    return floor + h;
  };
  // (the crest's vertices: irregularly spaced, and at every summit and shoulder, so each face spans a feature)
  const at = new Set<number>();
  for (let a = from, i = 0; a < to; a += 0.035 + 0.075 * H(i, 7), i++) at.add(a);
  for (const pk of peaks) for (const f of [0, -0.5, 0.5]) { const a = pk.a + (f < 0 ? pk.wl : pk.wr) * f; if (a > from && a < to) at.add(a); }
  at.add(to);
  const as = [...at].sort((x, y) => x - y);
  const cs = as.map(crest);
  const pt = (a: number, r: number, y: number) => [Math.sin(a) * r, y, Math.cos(a) * r];
  const rows = as.map((a, i) => {
    // (spur or gully: higher than its neighbours' mean, the fold comes toward you; lower, it goes back)
    const nb = (cs[Math.max(0, i - 1)] + cs[Math.min(cs.length - 1, i + 1)]) / 2, spur = Math.max(-1, Math.min(1, (cs[i] - nb) / (hi * 0.08 + 1)));
    const c = cs[i], foldY = c - (c - floor) * (0.42 + 0.1 * H(i, 8)), base = floor - 40;
    const C = pt(a, R, c), Fd = pt(a, R * (1 - spec.fold * spur), foldY), B = pt(a, R * 0.97, base);
    let S = C;
    if (c > snowline) {
      const depth = (c - snowline) * (0.5 + 0.35 * H(i, 9)) * (spur < 0 ? 1.4 : 0.85), t = Math.min(0.92, depth / Math.max(1, c - foldY));
      S = C.map((v, d) => v + (Fd[d] - v) * t);
    }
    return { C, S, Fd, B, snowy: S !== C };
  });
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (a.snowy || b.snowy) { if (a.snowy) m.tri(a.C, b.C, a.S, snow, 0.5); if (b.snowy) m.tri(b.C, b.S, a.S, snow, 0.5); }
    m.quad(a.S, b.S, b.Fd, a.Fd, body, 0.5);
    m.quad(a.Fd, b.Fd, b.B, a.B, body, 0.5);
  }
  return { rows, crest, as };
}
/** the skylines: the farthest range, then a nearer one in front of it, both all round; snow on both */
export function buildRanges(seed: number) {
  const m = new Mesh(), F = -260;
  skyline(m, seed, 1, { R: 3400, floor: F - 20, lo: 420, hi: 1050, peaks: 15, body: M.FAR, snow: M.FARSNOW, snowline: F + 560, fold: 0.03 });
  skyline(m, seed, 2, { R: 2500, floor: F - 10, lo: 230, hi: 620, peaks: 12, body: M.MTN, snow: M.MTNSNOW, snowline: F + 430, fold: 0.04 });
  return new Float32Array(m.v);
}

/** the valley: its floor (flat, one blue), the river winding over it (pale), and a foothill ridge or two in the middle
 * distance: one dominant ridge each, its face coming down from the crest in a few big planes (one fold to show its
 * volume), and a band of forest along its foot, its top edge ragged as treetops */
export function buildValley(seed: number) {
  const m = new Mesh(), F = -260;
  // (the floor: a flat disc out past the skylines' feet)
  for (let i = 0; i < 24; i++) { const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2; m.tri([0, F, 0], [Math.sin(a0) * 3500, F, Math.cos(a0) * 3500], [Math.sin(a1) * 3500, F, Math.cos(a1) * 3500], M.VALLEY, 0.5); }
  // (the foothills: two arcs, each a long continuous ridge)
  for (let k = 0; k < 2; k++) {
    const mid = hash(seed, k, 50) * Math.PI * 2 + k * Math.PI, span = 1.0 + 0.6 * hash(seed, k, 51), R = 1150 + 300 * hash(seed, k, 52);
    const { rows } = skyline(m, seed, 10 + k, { R, floor: F, lo: 90, hi: 260 + 60 * hash(seed, k, 53), peaks: 3, body: M.RIDGE, snow: M.RIDGE, snowline: 1e9, from: mid - span / 2, to: mid + span / 2, fold: 0.07 });
    // (its forest: a band along the foot, in front of the face, its top edge ragged)
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1], h = (r: { C: number[] }) => Math.max(0, r.C[1] - F);
      const top = (r: { C: number[]; B: number[] }, j: number) => { const t = Math.min(0.32, 22 / Math.max(1, h(r))) * (0.7 + 0.6 * hash(seed, k, i + j, 60)); return r.B.map((v, d) => (d === 1 ? F + h(r) * t : v * 0.985)); };
      const lo0 = a.B.map((v, d) => (d === 1 ? F - 5 : v * 0.985)), lo1 = b.B.map((v, d) => (d === 1 ? F - 5 : v * 0.985));
      const t0 = top(a, 0), t1 = top(b, 1);
      if (h(a) < 4 && h(b) < 4) continue;
      m.quad(lo0, lo1, t1, t0, M.FOREST, 0.5);
      // (a few treetops standing above the band)
      const tm = t0.map((v, d) => (v + t1[d]) / 2); tm[1] += 6 + 10 * hash(seed, k, i, 61);
      m.tri(t0, t1, tm, M.FOREST, 0.5);
    }
  }
  // (the river: a ribbon winding across the floor, pale)
  const rv: number[][] = [];
  for (let k = 0; k <= 40; k++) { const z = -2200 + k * 110, x = -520 + Math.sin(k * 0.55 + seed) * 160 + Math.sin(k * 1.7) * 50; rv.push([x, F + 1, z]); }
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
  body?: { roll: number; shift: number; fore: number; rise: number; look?: number; nod?: number };
  /** a whip: the machine swung out beneath the rider (rad, + its nose to the right) and laid over with it; the rider's
   * body stays with the way it's going, its legs and arms re-solved to where the pegs and bars have gone */
  whip?: number;
  /** the body's tricks, each how far into it (0 on the bike, 1 all the way), blended as one goes into the next: hands
   * off the bars (arms out wide), feet off the pegs (legs kicked out behind and apart), superman (both legs stretched
   * straight back, the body flat over the bike, hands on the bars), can-can (the left leg swung over the seat to the
   * right) */
  trick?: { hands?: number; feet?: number; superman?: number; cancan?: number };
  /** 'cut': drawn as a few flat masses (orange, charcoal, cream), each with one dark cut, not facet by facet; 'sil': the
   * whole figure one solid charcoal (for judging its silhouette); 'facets' (or unset): every face its own band */
  style?: 'facets' | 'cut' | 'sil';
}
export function buildRider(r: Pose, t: number) {
  const sil = r.style === 'sil', cut = r.style === 'cut' || sil, m = new Mesh(true, cut);
  // (the materials. As facets: the kit's own. Cut: three masses, the jersey and bodywork orange, the legs and the whole
  // machine one charcoal, a few cream accents where it touches and steers (boots, fork) and its plates and helmet)
  const OR = sil ? M.CUT_BLACK : cut ? M.CUT_ORANGE : M.ORANGE, BK = cut ? M.CUT_BLACK : M.BLACK, WH = sil ? M.CUT_BLACK : cut ? M.CREAM : M.WHITE, RK = cut ? M.CUT_BLACK : M.ROCK;
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
  // (the whip: the machine yawed about a point between the pegs and laid over on its own axis, top toward its nose's side;
  // `onBike` while the machine is built, after which the rider's points are its own and only what it holds (pegs, bars)
  // goes through the whip)
  const wy = r.whip ?? 0, piv = [0, 0.8, -0.1];
  const Bd = (v: number[]) => (wy ? rot(rot(v, [0, 0, 1], -wy * 0.75), [0, 1, 0], wy) : v), B = (p: number[]) => (wy ? add(piv, Bd(sub(p, piv))) : p);
  let onBike = true;
  const W = (p0: number[]) => { const p = onBike ? B(p0) : p0; return [0, 1, 2].map((d) => o[d] + (R[d] * p[0] + U[d] * p[1] + F[d] * p[2]) * K); };
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
    const A = ring(a, ra), Bq = ring(b, rb), ca = W(a), cb = W(b);
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; m.quad(A[k], A[k1], Bq[k1], Bq[k], mat); m.tri(cb, Bq[k], Bq[k1], mat); m.tri(ca, A[k1], A[k], mat); }
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
  /** a wheel: a knobbly tyre (a ring, its tread stepped), the rim inside, open between, the hub. Cut: the tyre alone, a
   * thick interrupted ring, open through the middle */
  const wheel = (c: number[], ro: number, ri0: number, w: number, T: (p: number[]) => number[]) => {
    const n = 16, ri = cut ? ri0 * 0.86 : ri0, at = (k: number, rr: number, x: number) => { const a = spin + (k / n) * Math.PI * 2; return W(T([c[0] + x, c[1] + Math.sin(a) * rr, c[2] + Math.cos(a) * rr])); };
    for (let k = 0; k < n; k++) {
      const r0 = ro * (k % 2 ? 0.95 : 1);
      m.quad(at(k, r0, -w), at(k + 1, r0, -w), at(k + 1, r0, w), at(k, r0, w), BK);
      for (const x of [-w, w]) { m.quad(at(k, r0, x), at(k + 1, r0, x), at(k + 1, ri, x), at(k, ri, x), BK); if (!cut) m.quad(at(k, ri, x * 0.7), at(k + 1, ri, x * 0.7), at(k + 1, ri * 0.86, x * 0.7), at(k, ri * 0.86, x * 0.7), M.ROCK); }
    }
    if (cut) return;
    for (let k = 0; k < 6; k++) { const a = spin * 0.5 + (k / 6) * Math.PI * 2; limb(T(c), T([c[0], c[1] + Math.sin(a) * ri * 0.86, c[2] + Math.cos(a) * ri * 0.86]), 0.006, 0.006, M.ROCK, 3); }
    limb(T([c[0] - w * 1.3, c[1], c[2]]), T([c[0] + w * 1.3, c[1], c[2]]), 0.045, 0.045, M.WHITE, 6);
  };
  // (the front: wheel, fork legs and stanchions to the clamps, the clamps, bars and grips, number plate, fender. Cut: the
  // fork one cream slash)
  wheel(fa, 0.4, 0.29, 0.05, S);
  for (const x of [-0.075, 0.075]) {
    const foot = [x, fa[1], fa[2]], top = [x, head[1], head[2]];
    limb(S(foot), S(L(foot, top, 0.5)), 0.032, 0.032, cut ? WH : BK, 5);
    limb(S(L(foot, top, 0.45)), S(top), cut ? 0.03 : 0.024, cut ? 0.03 : 0.024, WH, 5);
  }
  box([0, head[1] + 0.02, head[2]], [0.11, 0.03, 0.05], RK, 0, S);
  const bar = (x: number) => S([x, head[1] + 0.15, head[2] - 0.05]);
  limb(bar(-0.4), bar(0.4), 0.016, 0.016, BK, 4);
  for (const x of [-0.34, 0.34]) limb(bar(x - 0.06), bar(x + 0.06), 0.024, 0.024, cut ? BK : WH, 5);
  box([0, head[1] - 0.06, head[2] + 0.08], [0.13, 0.11, 0.015], WH, -0.45, S); // number plate
  box([0, fa[1] + 0.47 - sq * 0.3, fa[2] + 0.06], [0.065, 0.015, 0.24], OR, 0.22, S); // front fender, close over the wheel, its beak forward
  // (the frame's mass: engine, tank and shrouds, seat, side plates, the rear fender kicked up; the swingarm and shock)
  const fr = (y: number) => y - sq;
  box([0, fr(0.6), 0.04], [0.12, 0.17, 0.2], RK);
  box([0, fr(0.8), 0.2], [0.07, 0.1, 0.07], RK, -0.3); // the cylinder
  box([0, fr(1.04), 0.14], [0.13, 0.08, 0.2], OR, 0.15); // tank
  for (const x of [-0.17, 0.17]) { box([x, fr(0.96), 0.27], [0.025, 0.13, 0.15], OR, 0.35); if (!cut) box([x * 1.05, fr(0.9), 0.32], [0.012, 0.05, 0.08], M.WHITE, 0.35); }
  box([0, fr(1.07), -0.3], [0.11, 0.035, 0.36], BK, -0.05); // seat
  for (const x of [-0.14, 0.14]) box([x, fr(0.95), -0.44], [0.018, 0.1, 0.17], cut ? BK : WH, -0.1); // side plates (cut: part of the dark mass)
  box([0, fr(1.05), -0.82], [0.1, 0.018, 0.24], OR, -0.32); // rear fender
  wheel(ra, 0.39, 0.27, 0.065, ID);
  const pivot = [0, fr(0.62), -0.14];
  for (const x of [-0.09, 0.09]) limb([x, pivot[1], pivot[2]], [x, ra[1], ra[2]], 0.035, 0.028, RK, 4);
  limb(L(pivot, ra, 0.35), [0, fr(0.98), -0.18], 0.04, 0.04, cut ? BK : OR, 6); // the shock
  limb([0.11, fr(0.78), 0.26], [0.17, fr(0.86), -0.62], 0.03, 0.03, RK, 5); // the pipe
  limb([0.17, fr(0.86), -0.52], [0.17, fr(0.96), -0.9], 0.055, 0.045, cut ? BK : WH, 6); // the silencer (cut: merged into the machine)
  // (the rider. The body rides on springs: the hips shifted and lifted by it, the torso swaying against the bike's lean
  // and pitched with the hips' fore and aft; the head held nearer level; the legs from the hips to the pegs, the arms from
  // the shoulders to the grips, each solved through its joint, so the knees and elbows take up the difference. In a whip
  // the pegs and bars have swung away with the machine, and the limbs reach for them)
  onBike = false;
  // (the rider, a body working the machine. The body rides on springs (the sim's): its sway against the bike's lean, its
  // shift, fore and aft, up and down; and the head, quicker, leading. Here it's put together as a chain of parts that
  // don't all turn alike: the pelvis over the seat, twisted toward a whipped bike; the chest bent forward off it and
  // turned less; the shoulders' line tipped under the effort of the bars; the head looking its own way. The legs reach
  // from the hips to the pegs and the arms from the shoulders to the grips, each solved through its joint, and the
  // joints are pushed differently on each side, so the openings under the elbows and between the knees and the machine
  // are made by what the body's doing: one opens as the other closes)
  const b = r.body ?? { roll: 0, shift: 0, fore: 0, rise: 0 }, sqz = Math.max(0, r.squash), steerA = r.steer ?? 0;
  const yaw = (v: number[], a: number) => rot(v, [0, 1, 0], a), zf = [0, 0, 1];
  // (the pelvis: standing on the pegs, off the seat; dropping toward it as a landing compresses (never into it))
  const tk = r.trick ?? {}, feetOff = tk.feet ?? 0, handsOff = tk.hands ?? 0, sm = tk.superman ?? 0, cc = tk.cancan ?? 0;
  // (superman: the hips lift and go back off the seat, the body laid flat along the bike)
  const hipC = [b.shift, Math.max(fr(1.14), fr(1.3) - sqz * 0.3 + b.rise) + sm * 0.14, -0.2 + b.fore + sqz * 0.04 - sm * 0.32];
  const tiltP = 0.5 + b.fore * 1.6 + sqz * 0.15 + sm * 0.75, tiltC = tiltP + 0.25 + sqz * 0.12 + sm * 0.2;
  const sT = Math.max(-0.3, Math.min(0.3, steerA * 0.5 + wy * 0.35));
  const upP = yaw(rot([0, Math.cos(tiltP), Math.sin(tiltP)], zf, b.roll), wy * 0.45), rgP = yaw(rot([1, 0, 0], zf, b.roll), wy * 0.45);
  const upC = yaw(rot([0, Math.cos(tiltC), Math.sin(tiltC)], zf, b.roll + sT * 0.5), wy * 0.15), rgC = yaw(rot([1, 0, 0], zf, b.roll + sT), wy * 0.15);
  const c1 = add(hipC, upP, 0.17), c2 = add(c1, upC, 0.17), c3 = add(c2, upC, 0.15), c4 = add(c3, upC, 0.05);
  // (asymmetry: which side opens. e: the arms (the bars turned, the whip); k: the knees)
  const e = Math.max(-1, Math.min(1, steerA * 1.5 + wy * 1.2 + b.roll * 1.5)), kk = Math.max(-1, Math.min(1, wy * 1.5 + r.lean * 1.2));
  for (const side of [-1, 1]) {
    // (legs: the boot on its peg, the knee forward and out, one gripping the machine as the other comes away; in a
    // no-footer, both kicked out behind and apart, the hands still on the bars; in a superman both stretched straight
    // back, together; in a can-can the left one swung over the seat to join the right)
    const cs = side < 0 ? cc : 0;
    const kick = [side * 0.22 * feetOff + side * 0.05 * sm + 0.74 * cs, 0.28 * feetOff + 0.52 * sm + 0.4 * cs, -0.62 * feetOff - 1.08 * sm + 0.1 * cs].map((v) => v);
    const ankle = add(B([side * 0.2, fr(0.8), -0.08]), Bd(kick)), hip = add(add(hipC, rgP, side * 0.12), upP, -0.03);
    const knee = ik(hip, ankle, 0.46, 0.46, Bd([side * (0.35 + 0.35 * kk * side) + 1.3 * cs, 0.15 - feetOff * 0.6 - sm * 0.7 + 0.5 * cs, 1 - feetOff * 1.6 - sm * 1.9 - 0.4 * cs]));
    limb(add(B([side * 0.2, fr(0.7), -0.18]), Bd(kick)), add(B([side * 0.2, fr(0.7), 0.08]), Bd(kick)), 0.06, 0.05, WH, 5); // boot
    limb(ankle, L(ankle, knee, 0.45), 0.055, 0.06, WH, 5); // boot's leg
    limb(L(ankle, knee, 0.4), knee, 0.058, 0.07, BK, 6); // shin
    limb(L(knee, ankle, 0.35), add(knee, [0, 0.04, 0.03]), 0.05, 0.065, cut ? BK : OR, 5); // knee guard
    limb(knee, hip, 0.075, 0.095, BK, 6); // thigh
    // (arms: the shoulder to the grip; on the side the effort's on, the elbow up and out (a broad opening), on the other
    // down and in (closing); the sleeve full at the shoulder, narrowing to the elbow, the forearm to the wrist)
    const shoulder = add(add(c3, rgC, side * 0.2), upC, -0.02), grip = L(B(bar(side * 0.33)), add(add(shoulder, rgC, side * 0.5), upC, 0.16), handsOff);
    // (compressed (a landing), the elbows go out and back, taking it, not up)
    const elbow = ik(shoulder, grip, 0.3, 0.3, [side * (1 + 0.6 * e * side) * (1 + sqz * 0.5), 0.55 + 0.6 * e * side - sqz * 0.7, -0.25 - sqz * 0.3]);
    limb(shoulder, elbow, cut ? 0.085 : 0.07, cut ? 0.048 : 0.055, OR, 6); limb(elbow, L(elbow, grip, 0.8), cut ? 0.058 : 0.05, cut ? 0.04 : 0.045, OR, 6);
    limb(L(elbow, grip, 0.75), grip, 0.045, 0.045, BK, 5); // glove
  }
  if (cut) {
    // (the jersey: one shape, lofted through the pelvis, the waist (narrowest), the chest, the shoulders (broadest,
    // rounded over the top); its two parts each with their own lean and twist, so it bends between chest and pelvis)
    const ring = (c: number[], up: number[], rg: number[], a: number, d: number) => {
      const rr = nrm(sub(rg, up.map((v) => v * (rg[0] * up[0] + rg[1] * up[1] + rg[2] * up[2])))), f = crs(rr, up), n = 10;
      return Array.from({ length: n }, (_, k) => { const th = (k / n) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th); return W(add(add(c, rr, Math.sign(cs) * Math.abs(cs) ** 0.8 * a), f, Math.sign(sn) * Math.abs(sn) ** 0.8 * d)); });
    };
    const rings = [ring(hipC, upP, rgP, 0.16, 0.11), ring(c1, upP, rgP, 0.145, 0.1), ring(c2, upC, rgC, 0.2, 0.12), ring(c3, upC, rgC, 0.235, 0.11), ring(c4, upC, rgC, 0.15, 0.07)];
    for (let q = 0; q < rings.length - 1; q++) for (let k = 0; k < 10; k++) { const k1 = (k + 1) % 10; m.quad(rings[q][k], rings[q][k1], rings[q + 1][k1], rings[q + 1][k], OR); }
    const bot = W(hipC), top = W(add(c4, upC, 0.03));
    for (let k = 0; k < 10; k++) { const k1 = (k + 1) % 10; m.tri(bot, rings[0][k1], rings[0][k], OR); m.tri(top, rings[4][k], rings[4][k1], OR); }
  } else {
    limb(hipC, c3, 0.13, 0.16, OR, 6, 1.35, rgC); // jersey, the back broad
    limb(L(hipC, c3, -0.05), L(hipC, c3, 0.42), 0.135, 0.14, M.BLACK, 6, 1.4, rgC); // its black lower panels
    limb(L(hipC, c3, 0.75), L(hipC, c3, 1.06), 0.17, 0.12, M.BLACK, 6, 1.3, rgC); // shoulders, the neck brace
  }
  // (the head: on the neck, forward of the shoulders, its own way: turned where it looks (and a little against a whip,
  // toward where it'll land), nodding down toward the ground as it comes, rolled back toward level against the lean)
  const look = (b.look ?? 0) - wy * 0.2, nod = b.nod ?? 0, hRoll = b.roll - r.lean * 0.5;
  let hx = yaw([1, 0, 0], look), hy = [0, 1, 0], hz = yaw(zf, look);
  hz = rot(hz, hx, nod); hy = rot(hy, hx, nod); hx = rot(hx, hz, hRoll); hy = rot(hy, hz, hRoll);
  const hc = add(add(c3, nrm(add(upC, [0, 0.6, 0])), 0.17), [0, 0.02, 0.12]);
  if (cut) limb(add(c3, upC, 0.02), add(hc, hy, -0.08), 0.06, 0.055, BK, 6); // the neck: one dark cut between helmet and jersey
  // (the helmet: a faceted ball, a little long front to back. Cut: cream, its one dark cut the goggles and strap as one
  // band, an orange stripe over the top)
  const HM = cut ? WH : M.ORANGE;
  {
    const lat = 4, lon = 8, P = (i: number, j: number) => { const th = (i / lat) * Math.PI, ph = (j / lon) * Math.PI * 2 + (i % 2) * 0.35; return W([0, 1, 2].map((d) => hc[d] + hx[d] * Math.sin(th) * Math.cos(ph) * 0.15 + hy[d] * Math.cos(th) * 0.15 + hz[d] * Math.sin(th) * Math.sin(ph) * 0.17)); };
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) { const p0 = P(i, j), p1 = P(i, j + 1), p2 = P(i + 1, j + 1), p3 = P(i + 1, j); if (i === 0) m.tri(p0, p2, p3, HM); else if (i === lat - 1) m.tri(p0, p1, p3, HM); else m.quad(p0, p1, p2, p3, HM); }
  }
  boxF(add(add(hc, hy, -0.1), hz, 0.17), hx, rot(hy, hx, 0.5), rot(hz, hx, 0.5), [0.075, 0.055, 0.07], HM); // chin bar
  boxF(add(add(hc, hy, 0.12), hz, 0.18), hx, rot(hy, hx, -0.25), rot(hz, hx, -0.25), [0.12, 0.012, 0.09], cut ? WH : M.BLACK); // peak
  boxF(add(add(hc, hy, 0.01), hz, 0.16), hx, hy, hz, [0.125, 0.035, 0.012], BK); // goggle lens
  boxF(add(hc, hy, 0.01), hx, hy, hz, [0.152, cut ? 0.032 : 0.024, 0.15], cut ? BK : M.WHITE); // goggle strap
  boxF(add(add(hc, hy, 0.09), hz, -0.02), hx, hy, hz, [0.025, 0.07, 0.13], cut ? OR : M.BLACK); // helmet stripe
  return new Float32Array(m.v);
}
