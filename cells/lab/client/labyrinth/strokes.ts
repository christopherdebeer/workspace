/**
 * The drawing's marks, each with a reason to be there (after Taohua's marks.ts and pathmarks.ts): not a pattern laid
 * over a surface by its height or its slope or where its depth jumps, but strokes the world's own features call for,
 * found from what the land and what's built say they are, and laid as geometry in the world, so each stays where it is
 * as the eye moves and as what's built changes elsewhere.
 *
 * Features, and their evidence:
 * - **cliff** (cliffs.ts: where the land steps from one terrace to the next, the rock the mesh builds from the same
 *   description): its **rim** along the top of the rock, in and out at its blocks and round its corners, firmer the
 *   higher it is; its **ledges** between its courses (bedding); its **foot**; the plane changes down it (a fracture's
 *   family), at a corner of the high ground and where a block stands forward of the next; all one pick for the run, so a
 *   cliff stays or goes whole where the drawing thins. Spent first: **hachures** down its faces turned from the sun, a
 *   few to a course, and a crack now and then;
 * - **retention** (where what's built is founded on the land): its contact, a broken line at its foot;
 * - **passage** (a flight, and the ways the hand laid, `World.passages`): a flight's worn **tread** nosings, now and
 *   then, most at its foot and head; its **string**s, its pitch along each side; a way's **edge**s where its sides are
 *   open, and its flags' **joint**s across it; all heavier where something happens (a way's end, a crossing, where it
 *   meets a flight), lighter between, so the eye travels along it;
 * - **water**: its **current**, strokes along the way it runs; its **bank**, a line along a steep one; its **fall**,
 *   streaks down the sheet where its bed steps, and the **impact**'s rings in the pool below.
 *
 * A feature is found by its cells (a cliff's run, by its first edge; a stream's cell; a founded
 * column's face), and every mark of it is seeded from those, so it's the same mark whenever it's made. Each carries its
 * family and weight; how much of it holds over the picture where the picture's whole (a rim does, a hachure doesn't:
 * the render says what a hachure would); and a pick, so where the drawing thins out, whole marks are left out, never
 * faded. The renderer draws them in the picture's own pass, inked onto what they lie on (render.ts `STROKE_FS`).
 */
import { hash } from '../kit/rng';
import { outline } from './form';
import { courses, type LandForm } from './cliffs';
import { CENTER, DIRS, unkey, type World } from './model';

/** why a mark is there */
export const FAM = { rim: 0, hachure: 1, bedding: 2, fracture: 3, contact: 4, current: 5, bank: 6, fall: 7, impact: 8, tread: 9, string: 10, edge: 11, joint: 12, foot: 13, branch: 14 } as const;
/** a tree's skeleton, for its branch lines: each line of it (trunk, stems, limbs) foot to tip, how thick at its foot,
 * and its chance of being left out where the drawing thins (the tree's own, so its lines go with it) */
export interface Skeleton { lines: V3[][]; girth: number; pick: number }
/**
 * A mark's vertex: its centre line's point (x, y, z); the way across it (x, y, z) and its half-width there at its
 * fullest, and how much of that its taper leaves here; which side of the centre (-1, 1); along it (0..1); its family +
 * weight (under 1); how much it holds over the whole picture (0..1); its pick (0..1). (The renderer widens it to a least
 * width on the screen by its family, so a mark that matters holds at any distance, its taper kept)
 */
export const STROKE_STRIDE = 13;
export type V3 = [number, number, number];

/** the land as drawn: its height at a point (grid units, as mesh.ts lays it), and the box of cells it's drawn over */
export interface StrokeLand {
  Y: (gx: number, gz: number) => number; B: { i0: number; i1: number; j0: number; j1: number };
  /** the land's forms over the box (cliffs.ts): the rock the mesh builds, whose edges the drawing draws */
  form: LandForm;
  /** whether a cell's drawn (past what's shown of the land, bleeding into the page, the land's still drawn) */
  on: (i: number, j: number) => boolean;
  /** how far past what's shown of the land a cell is (0 within it), and how far the drawing goes past it: out there the
   * marks thin out as the drawing does, so the ones it would leave out aren't made */
  out: (i: number, j: number) => number; margin: number;
}

/**
 * A ribbon through the points: so wide at its fullest, tapering to a hair at both ends, swelling a little past its
 * middle as a brush presses and lifts; across the ground (to the left of its way), or, given `side`, across that way
 */
export function ribbon(out: number[], pts: V3[], w: number, fam: number, weight: number, persist: number, pick: number, side?: V3) {
  if (pts.length < 2) return;
  const L: number[] = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const total = L[L.length - 1] || 1;
  const V = (i: number, s: number) => {
    const t = L[i] / total, a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let sx: number, sy: number, sz: number;
    if (side) [sx, sy, sz] = side; else { const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1; sx = -dz / l; sy = 0; sz = dx / l; }
    const taper = Math.max(0.12, Math.pow(Math.sin(Math.PI * Math.pow(Math.min(1, Math.max(0, t)), 0.85)), 0.7)), p = pts[i];
    return [p[0], p[1], p[2], sx, sy, sz, w / 2, taper, s, t, fam + Math.min(0.99, weight), persist, pick];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = V(i, -1), b = V(i, 1), c = V(i + 1, 1), d = V(i + 1, -1);
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
}

/** a seeded stream of numbers for one feature's marks */
const rng = (...n: number[]) => { let s = hash(...n) >>> 0; return () => { s = hash(s, 0x51ed) >>> 0; return s / 4294967296; }; };
const ramp = (r: () => number, a: number, b: number) => a + r() * (b - a);
/** which way the sun comes from, across the ground (render.ts SUN): a face turned from it is in shade */
const SUN_XZ: [number, number] = [-0.9, -0.44];
/** a mark's lift off what it's drawn on, so it lies on it, not in it */
const LIFT = 0.02;

/**
 * A branch line: through a tree's skeleton, its side turned to the eye when it's drawn (its tangent carried where a
 * mark's side is, render.ts turns it), thinning from foot to tip
 */
function branch(out: number[], pts: V3[], w0: number, w1: number, pick: number) {
  if (pts.length < 2) return;
  const V = (i: number, s: number) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], t = i / (pts.length - 1), p = pts[i];
    const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2], tl = Math.hypot(tx, ty, tz) || 1;
    return [p[0], p[1], p[2], tx / tl, ty / tl, tz / tl, (w0 + (w1 - w0) * t) / 2, 1, s, t, FAM.branch + 0.8, 0.12, pick];
  };
  for (let i = 0; i < pts.length - 1; i++) { const a = V(i, -1), b = V(i, 1), c = V(i + 1, 1), d = V(i + 1, -1); out.push(...a, ...b, ...c, ...a, ...c, ...d); }
}

export function strokes(w: World, land: StrokeLand, trees: Skeleton[] = []): Float32Array {
  const out: number[] = [];
  // ─── trees: their trunks and limbs, the drawing's branch lines (its crown's outline is the post pass's, lightly) ───
  for (const t of trees) for (const l of t.lines) {
    // (a smooth line through the skeleton's points, a few between each)
    const pts: V3[] = [];
    for (let q = 0; q + 1 < l.length; q++) for (let u = 0; u < 3; u++) { const f = u / 3, a = l[q], b = l[q + 1]; pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]); }
    pts.push(l[l.length - 1]);
    branch(out, pts, t.girth * 1.6, t.girth * 0.5, t.pick);
  }
  if (!w.land) return new Float32Array(0);
  const { Y, B } = land, wet = (i: number, j: number) => !!w.land?.water.has(j * 1000 + i);
  const at = (gx: number, gz: number, lift = LIFT): V3 => [gx - CENTER, Y(gx, gz) + lift, gz - CENTER];

  // ─── cliffs (cliffs.ts): the rock's own edges, the ones the mesh builds it with, so the drawn cliff is the cliff ───
  // (its rim, along the top of the rock, in and out at its blocks; its ledge where it's in two courses; its foot; the
  // plane changes down it, where one block meets the next and where it turns sharply: a run's structure kept whole, one
  // pick for the run, so where the drawing thins a cliff goes or stays as one thing. The stream's bank: a line at the
  // water's edge. Then, spent first: hachures down its faces turned from the sun, a crack now and then)
  for (const run of land.form.runs) {
    const pick = rng(run.id, 0x9c1)(), r = rng(run.id, 0xe5c), nP = run.pts.length;
    const W = (q: number, e: 0 | 1, rr: number, y: number, out = 0.012): V3 => { const p = run.pts[q + e], n = run.nrm[q + e]; return [p[0] + n[0] * (rr + out) - CENTER, y, p[1] + n[1] * (rr + out) - CENTER]; };
    const [c0i, c0j] = run.pts[Math.floor(nP / 2)], o = land.out(Math.floor(c0i), Math.floor(c0j));
    const kept = () => o <= 0 || r() < Math.pow(Math.max(0, 1 - o / land.margin), 1.3);
    const C = run.pts.slice(0, -1).map((_, q) => (run.face[q] ? courses(run, q) : null));
    // (a line along the run, stretch by stretch, broken where the rock isn't built)
    const along = (pt: (q: number, e: 0 | 1, c: NonNullable<(typeof C)[number]>) => V3 | null, w0: number, fam: number, weight: number, persist: number) => {
      let pts: V3[] = [];
      const flush = () => { if (pts.length > 1) ribbon(out, pts, w0, fam, weight, persist, pick); pts = []; };
      for (let q = 0; q < nP - 1; q++) {
        const c = C[q];
        if (!c) { flush(); continue; }
        const a = pt(q, 0, c), b = pt(q, 1, c);
        if (!a || !b) { flush(); continue; }
        if (pts.length && Math.hypot(pts[pts.length - 1][0] - a[0], pts[pts.length - 1][1] - a[1], pts[pts.length - 1][2] - a[2]) > 0.02) pts.push(a);
        else if (!pts.length) pts.push(a);
        pts.push(b);
      }
      flush();
    };
    const smallRun = run.bot.every((b) => run.t - b < 0.6), tall = run.bot.some((b) => run.t - b >= 1.6);
    // (the rim)
    along((q, e, c) => W(q, e, c.tiers[0].r0 - c.bev, c.tiers[0].top + LIFT), smallRun ? 0.034 : tall ? 0.052 : 0.046, FAM.rim, smallRun ? 0.55 : tall ? 0.92 : 0.8, smallRun ? 0.2 : 0.45);
    // (the stream's bank: at the water's edge)
    along((q, e, c) => (run.bank[q] ? W(q, e, c.tiers[c.tiers.length - 1].r1 * 0.5 + 0.02, run.bot[q] + 0.13 + 0.006) : null), 0.036, FAM.bank, 0.7, 0.1);
    if (smallRun) continue;
    // (its ledge, where it's in two courses; its foot on the ground below)
    along((q, e, c) => (c.tiers.length > 1 ? W(q, e, c.tiers[1].r0 - c.bev, c.tiers[1].top + LIFT * 0.5) : null), 0.034, FAM.bedding, 0.6, 0.3);
    along((q, e, c) => (run.bank[q] || run.t - run.bot[q] < 0.6 ? null : W(q, e, c.tiers[c.tiers.length - 1].r1 - 0.1 * (c.tiers[c.tiers.length - 1].r1 - c.tiers[c.tiers.length - 1].r0), run.bot[q] + 0.01, 0.005)), 0.036, FAM.foot, 0.62, 0.28);
    // (the plane changes down it: where a block meets the next, and where it turns sharply)
    for (let q = 1; q < nP - 1; q++) {
      const A = C[q - 1], Bc = C[q];
      if (!A || !Bc) continue;
      const turn = run.nrm[q - 1][0] * run.nrm[q + 1][0] + run.nrm[q - 1][1] * run.nrm[q + 1][1] < 0.5;
      if (A.b === Bc.b && !turn) continue;
      const c = A.tiers[0].r0 >= Bc.tiers[0].r0 ? A : Bc, pts: V3[] = [];
      for (const t of c.tiers) { pts.push(W(q, 0, t.r0, t.top - 0.02, 0.014)); pts.push(W(q, 0, t.r1, Math.max(t.bot, run.bot[q] + 0.01), 0.014)); }
      const tl = [run.pts[q + 1][0] - run.pts[q - 1][0], run.pts[q + 1][1] - run.pts[q - 1][1]], ll = Math.hypot(tl[0], tl[1]) || 1;
      ribbon(out, pts, turn ? 0.042 : 0.036, FAM.fracture, turn ? 0.75 : 0.6, 0.3, pick, [tl[0] / ll, 0, tl[1] / ll]);
    }
    // (hachures down a face turned from the sun, a few to a stretch; a crack now and then)
    for (let q = 0; q < nP - 1; q++) {
      const c = C[q];
      if (!c || run.t - run.bot[q] < 0.6) continue;
      const n = run.nrm[q], shaded = n[0] * SUN_XZ[0] + n[1] * SUN_XZ[1] < 0.1, len = run.s[q + 1] - run.s[q];
      const tl = [run.pts[q + 1][0] - run.pts[q][0], run.pts[q + 1][1] - run.pts[q][1]], ll = Math.hypot(tl[0], tl[1]) || 1, side: V3 = [tl[0] / ll, 0, tl[1] / ll];
      const P = (u: number, rr: number, y: number): V3 => { const a = W(q, 0, rr, y, 0.016), b = W(q, 1, rr, y, 0.016); return [a[0] + (b[0] - a[0]) * u, y, a[2] + (b[2] - a[2]) * u]; };
      if (shaded) for (let u = ramp(r, 0.05, 0.4); u < 1; u += ramp(r, 0.6, 1.1) / Math.max(0.1, len) * 0.2) {
        if (!kept()) continue;
        for (const t of c.tiers) {
          const reach = ramp(r, 0.35, 0.9) * (t.top - t.bot - 0.12), pts: V3[] = [];
          for (let k = 0; k <= 4; k++) { const y = t.top - 0.03 - (reach * k) / 4, f = (t.top - y) / Math.max(1e-3, t.top - t.bot); pts.push(P(u, t.r0 + (t.r1 - t.r0) * f, y)); }
          ribbon(out, pts, 0.03, FAM.hachure, 0.5, 0, r(), side);
        }
      }
      if (r() < 0.12 && kept()) {
        const t = c.tiers[0], u = ramp(r, 0.2, 0.8), y0 = t.top - ramp(r, 0, 0.08), y1 = Math.max(t.bot + 0.1, y0 - ramp(r, 0.3, 1.2)), pts: V3[] = [];
        for (let k = 0; k <= 5; k++) { const y = y0 + (y1 - y0) * (k / 5), f = (t.top - y) / Math.max(1e-3, t.top - t.bot); pts.push(P(Math.min(1, Math.max(0, u + (r() - 0.5) * 0.08)), t.r0 + (t.r1 - t.r0) * f, y)); }
        ribbon(out, pts, 0.034, FAM.fracture, 0.62, 0.15, r(), side);
      }
    }
  }

  // ─── retention: what's founded on the land, its contact at its foot ───
  for (let j = B.j0; j <= B.j1; j++) for (let i = B.i0; i <= B.i1; i++) {
    const k = w.ground(i, j);
    if (!w.block(k, i, j)) continue;
    const r = rng(w.land.seed, i, j, 0xc0a), cx = i + 0.5, cz = j + 0.5;
    for (const e of outline(w, k, i, j).edges) {
      if (!e.open) continue;
      const dx = e.b[0] - e.a[0], dz = e.b[1] - e.a[1], l = Math.hypot(dx, dz);
      if (l < 0.05) continue;
      const nx = dz / l, nz = -dx / l;
      // (only where it meets the land beside it at its own level: not where the ground falls away, nor against more)
      const fx = cx + (e.a[0] + e.b[0]) / 2 + nx * 0.2, fz = cz + (e.a[1] + e.b[1]) / 2 + nz * 0.2;
      if (Math.abs(Y(fx, fz) - k) > 0.15 || w.occupied(k, Math.floor(fx), Math.floor(fz))) continue;
      for (let s = ramp(r, 0, 0.15) * l; s < l;) {
        const len = Math.min(l - s, ramp(r, 0.3, 0.8)), pts: V3[] = [];
        for (let q = 0; q <= 3; q++) { const t = (s + (len * q) / 3) / l, px = cx + e.a[0] + dx * t + nx * 0.05, pz = cz + e.a[1] + dz * t + nz * 0.05; pts.push([px - CENTER, k + 0.062 + LIFT, pz - CENTER]); }
        ribbon(out, pts, 0.036, FAM.contact, 0.6, 0.3, r());
        s += len + ramp(r, 0.05, 0.3);
      }
    }
  }

  // ─── passage: flights and the ways the hand laid ───
  const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const STEPS = 6;
  for (const f of w.flights) {
    const [a, b] = DIRS[f.d], N = f.cells.length * STEPS, [k0, i0, j0] = f.cells[0], r = rng(w.land.seed, k0, i0, j0, f.d, 0x57a);
    // (a point on the flight: so far up it (u, in cells from its foot's near edge), so far across (wv, 0..1))
    const pt = (q: number, u: number, wv: number, y: number): V3 => { const [, i, j] = f.cells[q], cx = i + 0.5, cz = j + 0.5; return a ? [cx + a * (u - 0.5) - CENTER, y, cz + (wv - 0.5) - CENTER] : [cx + (wv - 0.5) - CENTER, y, cz + b * (u - 0.5) - CENTER]; };
    f.cells.forEach(([k], q) => {
      for (let s = 0; s < STEPS; s++) {
        const g = q * STEPS + s, busy = 1 - smooth(1, 5, Math.min(g, N - 1 - g)), h = k + (s + 1) / STEPS + 0.008, u = s / STEPS - 0.028;
        if (r() > 0.18 + 0.72 * busy) continue;
        // (a tread's worn nosing: whole, or worn through where the feet go, its two ends left)
        const worn = r() < 0.5, pieces = worn ? [[0.07, ramp(r, 0.3, 0.42)], [ramp(r, 0.58, 0.7), 0.93]] : [[ramp(r, 0.05, 0.15), ramp(r, 0.85, 0.95)]];
        for (const [w0, w1] of pieces) ribbon(out, [pt(q, u, w0, h), pt(q, u, (w0 + w1) / 2, h), pt(q, u, w1, h)], 0.03, FAM.tread, 0.5 + 0.3 * busy, 0.1, r());
      }
    });
    // (its strings: its pitch along each side that's open, from its foot's nosing to its head's; not between it and a
    // flight laid beside it, step for step: those two are one broad flight)
    for (const wv of [0.025, 0.975]) {
      const sg = wv < 0.5 ? -1 : 1, ox = a ? 0 : sg, oz = a ? sg : 0;
      if (w.stair(k0, i0 + ox, j0 + oz) === f.d) continue;
      const pts: V3[] = [];
      f.cells.forEach(([k], q) => { for (let s = 0; s < STEPS; s += 2) pts.push(pt(q, s / STEPS - 0.028, wv, k + (s + 1) / STEPS + 0.01)); });
      const [kl] = f.cells[f.cells.length - 1]; pts.push(pt(f.cells.length - 1, 1, wv, kl + 1 + 0.01));
      ribbon(out, pts, 0.034, FAM.string, 0.6, 0.12, r());
    }
  }
  const walk = (k: number, i: number, j: number) => w.passage(k, i, j) >= 0;
  for (const [v, dir] of w.passages) {
    const [k, i, j] = unkey(v);
    const r = rng(w.land.seed, k, i, j, 0x9a5), y = (k === w.ground(i, j) ? Y(i + 0.5, j + 0.5) + 0.012 : k) + 0.012;
    const [a, b] = DIRS[dir], [ta, tb] = DIRS[dir + 1];
    // (how much happens here: a way's end, a crossing, where it meets a flight)
    const along = [walk(k, i + a, j + b), walk(k, i - a, j - b)].filter(Boolean).length, side = [walk(k, i + ta, j + tb), walk(k, i - ta, j - tb)].filter(Boolean).length;
    const nearFlight = DIRS.some(([da, db]) => w.stair(k, i + da, j + db) >= 0 || w.stair(k - 1, i + da, j + db) >= 0);
    const busy = along < 2 || side > 0 || nearFlight ? 1 : 0.3;
    // (its edges: along each side that's open, broken, set in a little from the cell's edge)
    for (const sg of [-1, 1]) {
      if (walk(k, i + ta * sg, j + tb * sg)) continue;
      for (let s = ramp(r, 0, 0.15); s < 1;) {
        const len = Math.min(1 - s, ramp(r, 0.3, 0.75)), pts: V3[] = [];
        for (let q = 0; q <= 3; q++) { const t = s + (len * q) / 3 - 0.5; pts.push([i + 0.5 + a * t + ta * sg * 0.4 - CENTER, y, j + 0.5 + b * t + tb * sg * 0.4 - CENTER]); }
        ribbon(out, pts, 0.03, FAM.edge, 0.45 + 0.3 * busy, 0.2, r());
        s += len + ramp(r, 0.04, 0.25 - 0.15 * busy);
      }
    }
    // (its flags' joints across it, a few, more where it's busy)
    for (const t of [-0.25, 0.25]) {
      if (r() > 0.25 + 0.5 * busy) continue;
      const w0 = ramp(r, -0.38, -0.2), w1 = ramp(r, 0.2, 0.38);
      ribbon(out, [0, 0.5, 1].map((q) => [i + 0.5 + a * t + ta * (w0 + (w1 - w0) * q) - CENTER, y, j + 0.5 + b * t + tb * (w0 + (w1 - w0) * q) - CENTER] as V3), 0.024, FAM.joint, 0.4, 0, r());
    }
  }

  // ─── water: its current along it, a steep bank's line, its falls and where they land ───
  const order = new Map(w.land.stream.map(([i, j], q) => [j * 1000 + i, q]));
  for (const [i, j] of w.land.stream) {
    if (!land.on(i, j)) continue;
    const q0 = order.get(j * 1000 + i)!, next = w.land.stream[q0 + 1], prev = w.land.stream[q0 - 1];
    const to = next ?? [i + (i - (prev?.[0] ?? i)), j + (j - (prev?.[1] ?? j))];
    const fa = to[0] - i, fb = to[1] - j, g = w.ground(i, j), y = g - 0.17 + 0.006, r = rng(w.land.seed, i, j, 0x3a7);
    const bend = prev && next && (next[0] - i !== i - prev[0] || next[1] - j !== j - prev[1]);
    // (the current: strokes along the way it runs, more of them, and crowding the outer side, where it bends)
    for (let c = 0, nC = bend ? 4 : 3; c < nC; c++) {
      let off = ramp(r, -0.3, 0.3);
      if (bend && prev) { const oa = (next![0] - i) - (i - prev[0]), ob = (next![1] - j) - (j - prev[1]); off = Math.abs(off) * Math.sign(-fb * oa + fa * ob || 1); }
      const s0 = ramp(r, -0.4, 0.1), len = ramp(r, 0.35, 0.8), pts: V3[] = [];
      for (let q = 0; q <= 4; q++) { const s = s0 + (len * q) / 4, wv = Math.sin((s + c) * 5) * 0.025; pts.push([i + 0.5 + fa * s - fb * (off + wv) - CENTER, y, j + 0.5 + fb * s + fa * (off + wv) - CENTER]); }
      ribbon(out, pts, 0.032, FAM.current, 0.45, 0.12, r());
    }
    for (let d = 0; d < 4; d++) {
      const [a, b] = DIRS[d], [ta, tb] = DIRS[(d + 1) % 4], x = i + a, z = j + b;
      // (a fall: where its bed steps down to the next, streaks down the sheet, and rings where it lands)
      if (wet(x, z) && w.ground(x, z) < g) {
        const y1 = w.ground(x, z) - 0.17, ex = i + 0.5 + a * 0.5, ez = j + 0.5 + b * 0.5;
        for (let s = -0.36; s <= 0.36; s += ramp(r, 0.07, 0.14)) {
          const pts: V3[] = [], t0 = ramp(r, 0, 0.25), t1 = ramp(r, 0.6, 1);
          for (let q = 0; q <= 4; q++) { const t = t0 + (t1 - t0) * (q / 4); pts.push([ex + ta * s + a * (0.012 + t * 0.03) - CENTER, y + (y1 - y) * t, ez + tb * s + b * (0.012 + t * 0.03) - CENTER]); }
          ribbon(out, pts, 0.028, FAM.fall, 0.6, 0.25, r(), [ta, 0, tb]);
        }
        for (const rad of [0.12, 0.22, 0.32]) {
          const pts: V3[] = [], a0 = ramp(r, -0.6, -0.2), a1 = ramp(r, 0.2, 0.6);
          for (let q = 0; q <= 8; q++) { const th = a0 + (a1 - a0) * (q / 8); pts.push([ex + a * (0.05 + rad * Math.cos(th)) + ta * rad * Math.sin(th) * 1.2 - CENTER, y1 + 0.007, ez + b * (0.05 + rad * Math.cos(th)) + tb * rad * Math.sin(th) * 1.2 - CENTER]); }
          ribbon(out, pts, 0.028, FAM.impact, 0.5, 0.15, r());
        }
      }
    }
  }
  return new Float32Array(out);
}
