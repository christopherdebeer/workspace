/**
 * The drawing's marks, each with a reason to be there (after Taohua's marks.ts and pathmarks.ts): not a pattern laid
 * over a surface by its height or its slope or where its depth jumps, but strokes the world's own features call for,
 * found from what the land and what's built say they are, and laid as geometry in the world, so each stays where it is
 * as the eye moves and as what's built changes elsewhere.
 *
 * Features, and their evidence:
 * - **escarpment** (where the land drops a level or more between cells: a storey's height of rock, the mesh steps it
 *   into ledges): its rim, a broken line along the top of the drop, firmer the higher it is; its face, interrupted,
 *   hachures down it between its beds, long and short by turns; its **bedding**, the strata along the face at its
 *   ledges, each a little higher or lower across a **fracture**; and a fracture now and then, a crack down the face;
 * - **retention** (where what's built is founded on the land): its contact, a broken line at its foot;
 * - **passage** (a flight, and the ways the hand laid, `World.passages`): a flight's worn **tread** nosings, now and
 *   then, most at its foot and head; its **string**s, its pitch along each side; a way's **edge**s where its sides are
 *   open, and its flags' **joint**s across it; all heavier where something happens (a way's end, a crossing, where it
 *   meets a flight), lighter between, so the eye travels along it;
 * - **water**: its **current**, strokes along the way it runs; its **bank**, a line along a steep one; its **fall**,
 *   streaks down the sheet where its bed steps, and the **impact**'s rings in the pool below.
 *
 * A feature is found by its cells (a run of a drop's edges, from the cell it starts at; a stream's cell; a founded
 * column's face), and every mark of it is seeded from those, so it's the same mark whenever it's made. Each carries its
 * family and weight; how much of it holds over the picture where the picture's whole (a rim does, a hachure doesn't:
 * the render says what a hachure would); and a pick, so where the drawing thins out, whole marks are left out, never
 * faded. The renderer draws them in the picture's own pass, inked onto what they lie on (render.ts `STROKE_FS`).
 */
import { hash } from '../kit/rng';
import { outline } from './form';
import { retaining } from './context';
import { CENTER, DIRS, unkey, type World } from './model';

/** why a mark is there */
export const FAM = { rim: 0, hachure: 1, bedding: 2, fracture: 3, contact: 4, current: 5, bank: 6, fall: 7, impact: 8, tread: 9, string: 10, edge: 11, joint: 12, foot: 13 } as const;
/**
 * A mark's vertex: its centre line's point (x, y, z); the way across it (x, y, z) and its half-width there at its
 * fullest, and how much of that its taper leaves here; which side of the centre (-1, 1); along it (0..1); its family +
 * weight (under 1); how much it holds over the whole picture (0..1); its pick (0..1). (The renderer widens it to a least
 * width on the screen by its family, so a mark that matters holds at any distance, its taper kept)
 */
export const STROKE_STRIDE = 13;
type V3 = [number, number, number];

/** the land as drawn: its height at a point (grid units, as mesh.ts lays it), and the box of cells it's drawn over */
export interface StrokeLand {
  Y: (gx: number, gz: number) => number; B: { i0: number; i1: number; j0: number; j1: number };
  /** how thick the rock's beds are about a point, where a cliff's stepped into ledges */
  bed: (gx: number, gz: number) => number;
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
/** how far into each cell a drop's band reaches (land.ts: the flat middle is FLAT of the half-width) */
const BAND = 0.31;

export function strokes(w: World, land: StrokeLand): Float32Array {
  const out: number[] = [];
  if (!w.land) return new Float32Array(0);
  const { Y, B, bed } = land, held = retaining(w), wet = (i: number, j: number) => !!w.land?.water.has(j * 1000 + i);
  const at = (gx: number, gz: number, lift = LIFT): V3 => [gx - CENTER, Y(gx, gz) + lift, gz - CENTER];
  // (a drop between a cell and the one its way d: how many levels, if it's one the land shows as its own (not held by a
  // wall, not built against, not the stream's own bed))
  const drop = (i: number, j: number, d: number) => {
    const [a, b] = DIRS[d], x = i + a, z = j + b;
    if (!land.on(x, z) || wet(i, j)) return 0;
    const hi = w.ground(i, j), lo = w.ground(x, z), dd = hi - lo;
    if (dd < 1 || held.has(`${i}.${j}.${d}`)) return 0;
    if (w.occupied(hi, i, j) || w.occupied(lo, x, z) || w.stair(lo, x, z) >= 0) return 0;
    return dd;
  };
  const cls = (dd: number) => (dd >= 2 ? 2 : dd);

  // ─── escarpments and banks: a run of a drop's edges, the same way and the same kind, from the cell it starts at ───
  for (let j = B.j0; j <= B.j1; j++) for (let i = B.i0; i <= B.i1; i++) for (let d = 0; d < 4; d++) {
    const dd = drop(i, j, d);
    if (!dd) continue;
    const [ta, tb] = DIRS[(d + 1) % 4];
    if (cls(drop(i - ta, j - tb, d)) === cls(dd)) continue;
    let n = 1;
    while (n < 40 && cls(drop(i + ta * n, j + tb * n, d)) === cls(dd)) n++;
    edgeRun(i, j, d, n, cls(dd));
  }
  function edgeRun(i: number, j: number, d: number, n: number, kind: number) {
    const [a, b] = DIRS[d], [ta, tb] = DIRS[(d + 1) % 4], cliff = kind >= 1, tall = kind >= 2;
    // (the edge's line: from the run's first corner, along it; across, u from the top cell (−) to the low one (+))
    const e0x = i + 0.5 + a * 0.5 - ta * 0.5, e0z = j + 0.5 + b * 0.5 - tb * 0.5;
    const Q = (s: number, u: number): [number, number] => [e0x + ta * s + a * u, e0z + tb * s + b * u];
    const side: V3 = [ta, 0, tb];
    const r = rng(w.land!.seed, i, j, d, 0xe5c);
    // (a mark at so far along the run is made if the drawing still reaches it there)
    const kept = (s: number) => { const o = land.out(Math.floor(i + ta * s), Math.floor(j + tb * s)); return o <= 0 || r() < Math.pow(Math.max(0, 1 - o / land.margin), 1.3); };
    const hi = w.ground(i, j), lo = w.ground(i + a, j + b);
    // (the rim: along the top of the drop, broken, firmer on a cliff; held a little over the whole picture)
    for (let s = ramp(r, 0, 0.3); s < n;) {
      const len = Math.min(n - s, ramp(r, 1.4, 3.2)), pts: V3[] = [];
      for (let q = 0; q <= Math.max(2, Math.round(len / 0.2)); q++) { const ss = s + (len * q) / Math.max(2, Math.round(len / 0.2)); const [gx, gz] = Q(ss, -BAND + 0.035 + (r() - 0.5) * 0.015); pts.push(at(gx, gz)); }
      ribbon(out, pts, tall ? 0.05 : 0.042, FAM.rim, tall ? 0.9 : 0.75, tall ? 0.45 : 0.35, r());
      s += len + ramp(r, 0.04, 0.16);
    }
    // (down the face: hachures from the rim toward the foot, close-set and short down a cliff, broken at each bed so the
    // face reads interrupted; long and short by turns down a bank, further apart)
    const beds = (y: number, gx: number, gz: number) => { const b = bed(gx, gz); return Math.abs(y / b - Math.round(y / b)) * b; };
    // (a face turned from the sun is in shade: hatched close; one in the sun only where it's shut in, at a run's ends
    // where it turns (a recess), and sparsely between, shorter: the hatching says where the shade is, not where an edge is)
    const shaded = a * SUN_XZ[0] + b * SUN_XZ[1] < 0.1;
    const recess = (s: number) => 1 - Math.min(1, Math.min(s, n - s) / 0.7);
    let k = 0;
    for (let s = ramp(r, 0.03, 0.1); s < n; s += (tall ? 0.1 : 0.13) * ramp(r, 0.75, 1.3) * (shaded ? 1 : 2.8 - 1.8 * recess(s)), k++) {
      const reachU = (k % 2 ? 1 : ramp(r, 0.45, 0.7)) * (shaded ? 0.92 : 0.55 + 0.35 * recess(s)), wob = (r() - 0.5) * 0.04;
      if (!kept(s)) continue;
      let pts: V3[] = [];
      const N = cliff ? 10 : 5;
      for (let q = 0; q <= N; q++) {
        const u = -BAND + 0.1 + (2 * BAND - 0.15) * reachU * (q / N), [gx, gz] = Q(s + wob * (q / N), u), p = at(gx, gz, LIFT + 0.01);
        p[0] += a * 0.045; p[2] += b * 0.045;
        if (cliff && beds(p[1] - LIFT, gx, gz) < 0.035) { if (pts.length > 1) ribbon(out, pts, 0.032, FAM.hachure, 0.55, 0, r(), side); pts = []; continue; }
        pts.push(p);
      }
      ribbon(out, pts, 0.032, FAM.hachure, cliff ? 0.55 : 0.5, 0, r(), side);
    }
    // (its foot: where the face meets the ground below it, a lighter line, broken more)
    for (let s = ramp(r, 0, 0.4); s < n;) {
      const len = Math.min(n - s, ramp(r, 0.6, 1.8)), pts: V3[] = [];
      for (let q = 0; q <= Math.max(2, Math.round(len / 0.2)); q++) { const ss = s + (len * q) / Math.max(2, Math.round(len / 0.2)); const [gx, gz] = Q(ss, BAND - 0.05 + (r() - 0.5) * 0.02); pts.push(at(gx, gz)); }
      ribbon(out, pts, 0.034, FAM.foot, 0.6, 0.25, r());
      s += len + ramp(r, 0.15, 0.6);
    }
    if (!cliff) return;
    // (its bedding: along the face at each bed's height, found on the face where it stands, a little higher or lower
    // across each fracture, in long runs with gaps; and a crack down the face here and there)
    const uAt = (s: number, y: number) => {
      let u0 = -BAND, u1 = BAND;
      for (let q = 0; q < 14; q++) { const um = (u0 + u1) / 2, [gx, gz] = Q(s, um); if (Y(gx, gz) > y) u0 = um; else u1 = um; }
      return (u0 + u1) / 2;
    };
    // (each bed's joint where it shows on the face: the foot of its riser, the ledge the mesh steps it into; by the bed's
    // own thickness there, so it lies on the ledge it marks)
    const b0 = bed(...Q(n / 2, 0));
    for (let kb = Math.ceil((lo + 0.12) / b0); kb * b0 < hi - 0.12; kb++) {
      for (let s = ramp(r, 0, 0.4); s < n;) {
        const len = Math.min(n - s, ramp(r, 0.7, 2)), pts: V3[] = [], M = Math.max(2, Math.round(len / 0.15));
        if (!kept(s)) { s += len + ramp(r, 0.2, 0.6); continue; }
        for (let q = 0; q <= M; q++) {
          const ss = s + (len * q) / M, blk = Math.floor(ss * 1.3 + hash(w.land!.seed, kb, 5) / 4294967296);
          const [mx, mz] = Q(ss, 0), yy = kb * bed(mx, mz) + 0.025 + ((hash(w.land!.seed, i, j, d, blk, kb) / 4294967296) - 0.5) * 0.04;
          const [gx, gz] = Q(ss, uAt(ss, yy)), p: V3 = [gx - CENTER + a * 0.05, yy, gz - CENTER + b * 0.05];
          pts.push(p);
        }
        ribbon(out, pts, 0.03, FAM.bedding, 0.55, 0.2, r(), [0, 1, 0]);
        s += len + ramp(r, 0.2, 0.6);
      }
    }
    for (let s = ramp(r, 0.3, 1); s < n; s += ramp(r, 0.8, 1.8)) {
      if (r() < 0.4) continue;
      const pts: V3[] = [], y0 = hi - ramp(r, 0.05, 0.2), y1 = Math.max(lo + 0.1, y0 - ramp(r, 0.4, 1.2));
      for (let q = 0; q <= 5; q++) { const y = y0 + (y1 - y0) * (q / 5), ss = s + (r() - 0.5) * 0.06, [gx, gz] = Q(ss, uAt(ss, y)); pts.push([gx - CENTER + a * 0.03, y, gz - CENTER + b * 0.03]); }
      ribbon(out, pts, 0.04, FAM.fracture, 0.75, 0.3, r(), side);
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
      // (its bank: where it meets dry ground, a line along the water's edge, so the stream can be followed wherever the
      // drawing has it; firmer where the bank's cut steep)
      if (!wet(x, z)) {
        const steep = w.ground(x, z) > g, pts: V3[] = [], s0 = ramp(r, -0.55, -0.4), s1 = ramp(r, 0.4, 0.55);
        // (laid on the ground at the water's edge, where the land comes down to it, not under it)
        for (let q = 0; q <= 4; q++) { const s = s0 + (s1 - s0) * (q / 4); pts.push(at(i + 0.5 + a * 0.47 + ta * s, j + 0.5 + b * 0.47 + tb * s)); }
        ribbon(out, pts, 0.036, FAM.bank, steep ? 0.7 : 0.55, 0.1, r());
      }
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
