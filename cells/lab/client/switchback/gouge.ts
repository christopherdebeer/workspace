/**
 * Switchback's ruts as carved marks (`ruts=cut`, a study): the road's surface told the way a linocut tells a form, in
 * gouge strokes.
 *
 * Each mark is a stroke with a life: it enters fine at the near end, swells, and is cut off square where the gouge lifts
 * out (or, now and then, tapers out again). Its floor is a band darker than the road; down the wall the sun can't reach
 * runs a line of the deep shade's violet (the road's ink), and over the far lip, where the sun catches it, a sliver of
 * white (seen where the road round it lies in shade). They say what the ground is, not where to ride:
 *
 * - **Smooth ground**: combs of cuts, three to five side by side, going with the road (a print's way of laying down a
 *   field), with long rests of clean road between; more of them, longer and leaning out, through a bend.
 * - **Broken ground**: where the surface steps (a rock edge), short choppy strokes clustered just below the edge, at odd
 *   angles; a long stroke never runs over an edge, it stops at it and starts again below.
 * - **Whoops**: strokes across the road on the face of each hump, like contour hatching, so the humps show as humps.
 * - **A landing**: a cluster of short heavy strokes where a jump's landing begins.
 *
 * They're anchored to the course, so they stay put as you ride over them; they thin to nothing in the last few metres
 * before the eye, so a near one never becomes a slab; further off they're cut broader, so they keep their weight in the
 * frame as a print's marks do; and past about 60 m there are none.
 */
import { Course, hash } from './course';
import { drift } from './ground';
import { M, Mesh } from './mesh';
import { lines, plain, trackY } from './ruts';

/** the sun across the ground (its direction in x, z), to know which wall of a groove it lights */
const SUN_XZ = [-Math.SQRT1_2, Math.SQRT1_2];

/** how much the surface bends at station i (a rock step's edge: its rise changing from one metre to the next) */
const edge = (c: Course, i: number) => Math.abs(c.at(i + 1).lift - 2 * c.at(i).lift + c.at(i - 1).lift);

/**
 * A gouge: cut into the road along a centreline from (s0, u0) to (s1, u1), bowed sideways by `bow` metres at its middle.
 * Fine where it enters (the s0 end), swelling to w, cut off square where it lifts out (or tapering again: `lens`), its
 * width scaled at each point by `weight(s)`. Its floor a band darker than the road; down its shadowed wall a line of ink;
 * over its lit lip a sliver of white.
 */
function gouge(m: Mesh, c: Course, s0: number, u0: number, s1: number, u1: number, w: number, bow: number, lens: boolean, weight: (s: number) => number, tone: number) {
  const ds = s1 - s0, du = u1 - u0, L = Math.hypot(ds, du);
  if (L < 0.2) return;
  const ns = -du / L, nu = ds / L, rows = Math.max(3, Math.ceil(L / 0.4));
  // (the ground's frame at the stroke's middle: how x, z move a metre along the road and a metre across it; each row is
  // found exactly on the course at its centre, its edges set off from there in this frame, and the whole row lies at the
  // track's height at its centre: a stroke is too narrow for the facets to differ across it by more than a centimetre)
  const mid = c.point(s0 + ds / 2, u0 + du / 2), fw = c.point(s0 + ds / 2 + 1, u0 + du / 2), rt = c.point(s0 + ds / 2, u0 + du / 2 + 1);
  const ox = ns * (fw.x - mid.x) + nu * (rt.x - mid.x), oz = ns * (fw.z - mid.z) + nu * (rt.z - mid.z);
  // (which wall the sun lights: the one on the side away from the sun, whose face turns toward it; the other's in shade)
  const lit = ox * SUN_XZ[0] + oz * SUN_XZ[1] < 0 ? 1 : -1;
  let cx = 0, cy = 0, cz = 0;
  const P = (off: number, up: number) => [cx + ox * off, cy + up, cz + oz * off];
  type Row = { a: number[]; b: number[]; d: number[]; e: number[] | null; hw: number };
  let prev: Row | null = null;
  for (let k = 0; k <= rows; k++) {
    const t = k / rows, bo = bow * 4 * t * (1 - t), cs = s0 + ds * t + ns * bo, cu = u0 + du * t + nu * bo;
    const prof = lens ? Math.pow(Math.sin(Math.PI * t), 0.7) : Math.pow(Math.min(1, t / 0.3), 0.75);
    const hw = (w / 2) * prof * weight(cs);
    const q = c.point(cs, cu); cx = q.x; cz = q.z; cy = trackY(c, cs, cu);
    // (a: the lit side's edge, b: the shaded side's; d: the ink line's inner edge, down the shaded wall)
    const a = P(lit * hw, 0.045), b = P(-lit * hw, 0.045);
    const ink = Math.min(hw, hw * 0.42 + 0.015), d = P(-lit * (hw - ink), 0.05);
    const lw = hw * 0.3 + 0.01, show = t > 0.15 && t < 0.9 && hw > 0.03;
    const e = show ? P(lit * (hw + lw), 0.05) : null;
    const cur = { a, b, d, e, hw };
    if (prev && prev.hw + hw > 1e-3) {
      m.quad(prev.a, prev.b, b, a, M.RUT, tone);
      m.quad(prev.b, b, d, prev.d, M.GOUGE, 0.5);
      if (prev.e && e) m.quad(prev.a, a, e, prev.e, M.WHITE, 0.95);
    }
    prev = cur;
  }
}

/** the carved marks near the rider at s: from just behind the eye to about 60 m on */
export function buildGouges(c: Course, s: number) {
  const m = new Mesh(), seed = c.seed;
  // (the eye rides some metres behind the rider: a mark thins to nothing as it comes within a few metres of it)
  // (and further off it's cut broader, up to about two and a half times as broad at 45 m, keeping its weight in the frame)
  const eye = s - 6.5, fade = (ss: number) => Math.max(0, Math.min(1, (ss - eye - 1) / 6)) * Math.min(2.5, 1 + Math.max(0, ss - s - 8) / 24);
  const lo = Math.floor(s - 8), hi = Math.ceil(s + 60);
  for (let i = lo; i <= hi; i++) {
    if (i < 3 || !plain(c, i)) continue;
    const st = c.at(i), far = i - s;
    // (fewer of everything further off)
    const keep = (salt: number) => far < 30 || hash(seed, i, salt, 40) < 1 - (far - 30) / 36;

    // whoops: hatching across the face of each hump (the face toward the eye, just before its crest)
    if (st.feature === 'whoop') {
      if (st.lift > 0.08 && c.at(i + 1).lift > st.lift && keep(1)) {
        const n = 1 + Math.floor(hash(seed, i, 2) * 2), half = st.width / 2 - 0.5;
        for (let j = 0; j < n; j++) {
          const sj = i + 0.25 + j * 0.45 + hash(seed, i, j, 3) * 0.2, a = -half * (0.4 + 0.5 * hash(seed, i, j, 4)), b = half * (0.4 + 0.5 * hash(seed, i, j, 5));
          const flip = hash(seed, i, j, 6) < 0.5;
          gouge(m, c, sj + (flip ? 0.25 : 0), flip ? b : a, sj + (flip ? 0 : 0.25), flip ? a : b, 0.36 + 0.24 * hash(seed, i, j, 7), 0.12 * (hash(seed, i, j, 8) - 0.3), false, fade, 0.05);
        }
      }
      continue;
    }

    // a landing: a cluster of short heavy strokes where the ground takes the bike back (a deck's start, or the first
    // ground past a gap)
    const prior = c.at(i - 1).feature;
    if ((st.feature === 'deck' && prior !== 'deck') || (prior === 'gap' && st.feature !== 'gap')) {
      const L = lines(c, i);
      for (let j = 0; j < 5; j++) {
        const u = L[j % 2].u + (hash(seed, i, j, 11) - 0.5) * 1.2, sj = i + 0.3 + hash(seed, i, j, 12) * 2.2, len = 0.7 + hash(seed, i, j, 13) * 0.9;
        gouge(m, c, sj, u, sj + len, u + (hash(seed, i, j, 14) - 0.5) * 0.5, 0.3 + 0.18 * hash(seed, i, j, 15), 0, hash(seed, i, j, 16) < 0.4, fade, 0);
      }
      continue;
    }

    // broken ground: where the surface steps, choppy strokes just below the edge
    const e = edge(c, i);
    // (not in a rest: a long stretch of clean road now and then, negative space, part of the drawing)
    if (e > 0.012 && keep(20) && drift(seed, i / 38, 21) >= 0.2) {
      const L = lines(c, i), n = 2 + Math.floor(hash(seed, i, 21) * 3);
      for (let j = 0; j < n; j++) {
        const base = L[Math.floor(hash(seed, i, j, 22) * 2)].u, u = base + (hash(seed, i, j, 23) - 0.5) * 0.9;
        const sj = i + 0.15 + hash(seed, i, j, 24) * 0.8, len = 0.6 + hash(seed, i, j, 25) * 1.3, ang = (hash(seed, i, j, 26) - 0.5) * 0.7;
        gouge(m, c, sj, u, sj + len, u + Math.tan(ang) * len, 0.22 + 0.18 * hash(seed, i, j, 27), (hash(seed, i, j, 28) - 0.5) * 0.15, hash(seed, i, j, 29) < 0.2, fade, 0.05);
      }
    }
  }

  // smooth ground: combs of cuts, three to five side by side, going with the road (the way a print lays a field down in
  // patches of parallel strokes), one on each side of the road in each 12 m now and then, never two in one place; more
  // of them through a bend, and longer, fanned a little toward its outside
  for (let blk = Math.floor(lo / 12); blk * 12 <= hi; blk++) {
    for (let side = 0; side < 2; side++) {
      const i0 = blk * 12 + side * 5 + Math.floor(hash(seed, blk, side, 30) * 5);
      if (i0 < 3 || i0 > hi || !plain(c, i0) || c.at(i0).feature !== 'none' || drift(seed, i0 / 38, 21) < 0.2) continue;
      const turn = c.at(i0 + 8).heading - c.at(Math.max(0, i0 - 8)).heading, bend = Math.abs(turn);
      if (hash(seed, blk, side, 31) > 0.62 + Math.min(0.3, bend * 1.2)) continue;
      let L = 1.8 + hash(seed, blk, side, 32) * 2.2 + Math.min(3, bend * 8);
      for (let d = 1; d < L + 1; d++) if (edge(c, i0 + d) > 0.012 || !plain(c, i0 + d) || c.at(i0 + d).feature !== 'none') { L = Math.min(L, d - 0.4); break; }
      if (L < 1) continue;
      const half = c.at(i0).width / 2 - 0.7, uc = (side ? 1 : -1) * half * (0.12 + 0.6 * hash(seed, blk, side, 33));
      const n = 3 + Math.floor(hash(seed, blk, side, 34) * 3), sp = 0.34 + hash(seed, blk, side, 35) * 0.16;
      // (the comb's lean: a little either way, and through a bend out toward its outside, the way the ground's thrown)
      const ang = (hash(seed, blk, side, 36) - 0.5) * 0.14 - Math.sign(turn) * Math.min(0.12, bend * 0.25);
      for (let j = 0; j < n; j++) {
        const off = (j - (n - 1) / 2) * sp, sl = L * (0.6 + 0.4 * hash(seed, blk, side, j, 37)), sa = i0 + hash(seed, blk, side, j, 38) * 0.7, sb = sa + sl;
        if (sb < lo - 2) continue;
        const ua = uc + off, ub = ua + Math.tan(ang) * sl;
        gouge(m, c, sa, ua, sb, ub, 0.2 + 0.12 * hash(seed, blk, side, j, 39), (hash(seed, blk, side, j, 40) - 0.5) * 0.15, false, fade, 0.05);
      }
    }
  }
  return new Float32Array(m.v);
}
