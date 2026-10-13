/**
 * Taohua: the marks on water. Not a texture laid over it, but marks each with a reason to be there,
 * drawn as the prints draw water: the paper, and ink only where something happens.
 *
 * Between the water (water.ts) and the drawing stands a pictorial reading of the flow: where a stream
 * bends (its current crowds against the outer bank, and draws out long along the inner), where a stone
 * stands in it (the current splits about it, and trails a wake behind), where it runs fast (short
 * broken strokes, crossing), where it falls (a lip, lines down the sheet, the impact spreading in its
 * pool), where it comes into a pool (rings spreading from the inlet), and where it's still (almost
 * nothing: a long line or two across, far apart). A bank gets a mark only where it's cut steep.
 *
 * Each mark is geometry: a ribbon laid on the water (or down a fall), tapered at both ends, its width
 * and weight its own, so it stays where it is on the hill as the view moves, and its edge is drawn
 * smooth however thin it is. Each carries what made it (its family), for the `?marks` view.
 */
import { hash, seeded, type Rand } from '../kit/rng';
import type { Stream, Water } from './water';
import type { V3 } from './ways';

/** why a mark is there */
export const FAM = { current: 0, obstacle: 1, bank: 2, fall: 3, impact: 4, still: 5 } as const;
/** a vertex: position, normal, colour, material */
export type Push = (v: number[]) => void;

const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);

/**
 * A ribbon through the points: so wide (m) at its fullest, tapering to a hair at both ends, swelling
 * a little past its middle as a brush presses and lifts; laid flat (its width across the ground), or,
 * given `side`, across that way (down a fall). Each vertex carries: across it (-1 to 1), along it (0
 * to 1), and its family and weight (family + weight, the weight under 1).
 */
export function ribbon(push: Push, pts: V3[], w: number, fam: number, weight: number, mat: number, side?: V3, normal: V3 = [0, 1, 0]) {
  if (pts.length < 2) return;
  const L: number[] = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const total = L[L.length - 1] || 1;
  const V = (i: number, s: number) => {
    const t = L[i] / total, a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let sx: number, sy: number, sz: number;
    if (side) { [sx, sy, sz] = side; } else { const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1; sx = -dz / l; sy = 0; sz = dx / l; }
    const taper = Math.pow(Math.sin(Math.PI * Math.pow(Math.min(1, Math.max(0, t)), 0.85)), 0.7);
    const hw = (w / 2) * Math.max(0.12, taper), p = pts[i];
    return [p[0] + sx * hw * s, p[1] + sy * hw * s, p[2] + sz * hw * s, normal[0], normal[1], normal[2], s, t, fam + Math.min(0.99, weight), mat];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = V(i, -1), b = V(i, 1), c = V(i + 1, 1), d = V(i + 1, -1);
    push(a); push(b); push(c); push(a); push(c); push(d);
  }
}

/** a stone standing in (or at) the water, for its marks */
export interface Obstacle { x: number; z: number; r: number }

/**
 * The marks of a stream, those that start between z0 and z1 (and that `own` says belong here): its
 * current, bank, fall, inlet and still-water marks; each decided a cell (a metre and a half down it)
 * at a time, from the stream and the cell alone, so a mark's the same whichever tile draws it.
 */
export function streamMarks(push: Push, W: Water, st: Stream, z0: number, z1: number, own: (x: number, z: number) => boolean, cut: (x: number, z: number) => number, mat: number) {
  const CELL = 1.5;
  const wetAt = (x: number, z: number) => { const w = W.at(x, z); return w && w.s < -0.04 ? w : null; };
  /** the water's level at a place, a hair above it, or null if it's not on the water */
  const onWater = (x: number, z: number): V3 | null => { const w = wetAt(x, z); return w ? [x, w.L + 0.022, z] : null; };
  /** a stroke along the stream, at so far across it (n, -1 to 1 bank to bank), from z down it so far; cut where it leaves the water */
  const along = (z: number, n: number, len: number, wob: number, r: Rand): V3[] => {
    const pts: V3[] = [], ph = r() * 6.3, k = ramp(r, 1.2, 2.6);
    for (let d = 0; d <= len + 1e-6; d += 0.3) {
      const zz = z - d, f = d / Math.max(len, 0.01);
      const x = W.xAt(st, zz) + (n + wob * Math.sin(ph + f * k * Math.PI)) * W.halfAt(st, zz);
      const p = onWater(x, zz);
      if (!p) { if (pts.length > 1) break; pts.length = 0; continue; }
      pts.push(p);
    }
    return pts;
  };
  const curv = (z: number) => W.xAt(st, z + 1.5) - 2 * W.xAt(st, z) + W.xAt(st, z - 1.5);
  for (let c = Math.floor(Math.max(z0 - 8, st.z0 - 6) / CELL); c <= Math.floor(Math.min(z1 + 2, st.z1) / CELL); c++) {
    const r = seeded(hash(W.seed, st.k, c, 0x3a7c));
    const zc = (c + r()) * CELL, xc = W.xAt(st, zc), w0 = W.at(xc, zc);
    if (!w0 || w0.s > -0.05) continue;
    const start = (x: number, z: number) => z >= z0 && z < z1 && own(x, z);
    if (w0.kind === 'flow') {
      const k = curv(zc), bendy = Math.min(1, Math.abs(k) * 9), outer = -Math.sign(k) || 1;
      if (w0.run < 0.2) {
        // the current, where it runs gently: now and then one long low stroke along it; at a bend,
        // crowding against the outer bank, short and close, and drawn out long along the inner
        if (r() < 0.22 + 0.5 * bendy) {
          const onOuter = r() < 0.35 + 0.55 * bendy;
          const n = onOuter ? outer * ramp(r, 0.45, 0.82) : r() < bendy ? -outer * ramp(r, 0.35, 0.7) : ramp(r, -0.45, 0.45);
          const len = onOuter ? ramp(r, 1.1, 2.2) : ramp(r, 3, 6.5) * (1 + bendy * 0.5);
          if (start(xc + n * W.halfAt(st, zc), zc)) {
            ribbon(push, along(zc, n, len, 0.04, r), ramp(r, 0.035, 0.06), FAM.current, ramp(r, 0.6, 1), mat);
            if (onOuter && r() < 0.6) ribbon(push, along(zc - 0.3, n - outer * 0.16, len * 0.8, 0.04, r), ramp(r, 0.03, 0.05), FAM.current, ramp(r, 0.5, 0.85), mat);
          }
        }
      } else {
        // where it runs fast: short strokes, slanted, in twos and threes, crossing
        for (let q = 0, nq = r() < 0.55 ? 2 + Math.floor(r() * 2) : 0; q < nq; q++) {
          const n = ramp(r, -0.7, 0.7), z = zc + ramp(r, -0.6, 0.6), slant = ramp(r, -0.45, 0.45), len = ramp(r, 0.4, 0.9);
          const x = W.xAt(st, z) + n * W.halfAt(st, z);
          if (!start(x, z)) continue;
          const pts: V3[] = [];
          for (let d = 0; d <= len; d += 0.12) { const p = onWater(x + Math.sin(slant) * d + 0.05 * Math.sin(d * 9), z - Math.cos(slant) * d); if (p) pts.push(p); }
          ribbon(push, pts, ramp(r, 0.03, 0.05), FAM.current, ramp(r, 0.55, 0.95), mat);
        }
      }
      // its banks: a broken line along each, about half its length drawn; heavier and longer where the
      // bank's cut steep or on the outside of a bend (the current's against it), lighter and shorter on the inside
      for (const sd of [-1, 1]) {
        const hw = W.halfAt(st, zc), hard = Math.min(1, (cut(xc + sd * hw * 1.25, zc) > 0.22 ? 0.6 : 0) + (sd === outer ? bendy : -bendy * 0.5) + 0.4);
        if (r() > 0.3 + 0.35 * hard || !start(xc + sd * hw, zc)) continue;
        ribbon(push, along(zc, sd * 0.93, ramp(r, 0.6, 1.4) * (0.7 + hard * 0.6), 0.015, r), ramp(r, 0.035, 0.05) + 0.035 * hard, FAM.bank, 0.6 + 0.4 * hard, mat);
      }
    }
  }
  // its falls: a lip, broken, across the top; lines down the sheet, of different lengths; and at its
  // foot the impact, short strokes flung out downstream and rings spreading, fainter as they go
  for (const f of st.falls) for (const lip of f.lips) {
    if (lip < z0 - 6 || lip > z1 + 6) continue;
    const r = seeded(hash(W.seed, st.k, Math.round(lip * 10), 0xfa11));
    const xc = W.xAt(st, lip), hw = W.halfAt(st, lip) * 1.5;
    const top = W.levelAt(st, lip + 0.3).L, bot = W.levelAt(st, lip - 0.3).L, drop = top - bot;
    if (start0(xc, lip)) {
      for (let a = -0.9; a < 0.85;) {
        const b = Math.min(0.9, a + ramp(r, 0.35, 0.8));
        const pts: V3[] = [];
        for (let n = a; n <= b; n += 0.08) pts.push([xc + n * hw, top + 0.03, lip + 0.12 + 0.03 * Math.sin(n * 7)]);
        ribbon(push, pts, ramp(r, 0.04, 0.06), FAM.fall, 1, mat);
        a = b + ramp(r, 0.08, 0.25);
      }
      if (drop > 0.15) for (let q = 0, nq = 4 + Math.floor(r() * 4); q < nq; q++) {
        const n = ramp(r, -0.85, 0.85), x = xc + n * hw, until = ramp(r, 0.45, 1), pts: V3[] = [];
        // (the sheet stands between the grid's rows either side of the lip: down it, a little before it)
        const zt = Math.ceil(lip / 0.5) * 0.5, zb = Math.floor(lip / 0.5) * 0.5;
        for (let t = 0; t <= until + 1e-6; t += 0.1) pts.push([x + 0.02 * Math.sin(t * 11 + n * 5), top - drop * t, zt + (zb - zt) * t - 0.06]);
        ribbon(push, pts, ramp(r, 0.035, 0.06), FAM.fall, ramp(r, 0.6, 1), mat, [1, 0, 0], [0, 0, -1]);
      }
    }
    const fz = f.single ? lip - 0.6 : lip - 0.35;
    if (!start0(xc, fz) || drop < 0.15) continue;
    const big = f.single ? 1 : 0.55;
    for (let q = 0, nq = Math.round((5 + r() * 3) * big); q < nq; q++) {
      const a = -Math.PI / 2 + ramp(r, -1.1, 1.1), r0 = ramp(r, 0.35, 0.7) * big, r1 = r0 + ramp(r, 0.35, 0.8) * big, pts: V3[] = [];
      for (let t = 0; t <= 1.0001; t += 0.25) { const p = onWater(xc + Math.cos(a) * (r0 + (r1 - r0) * t), fz + Math.sin(a) * (r0 + (r1 - r0) * t)); if (p) pts.push(p); }
      ribbon(push, pts, ramp(r, 0.03, 0.05), FAM.impact, ramp(r, 0.6, 0.95), mat);
    }
    rings(push, onWater, xc, fz, [1, 1.7, 2.6].map((v) => v * big), -Math.PI / 2, 1.25, r, FAM.impact, mat);
  }
  // its pools: where the stream comes in, rings spreading from the inlet; out on still water, a long
  // line or two across, far apart, and otherwise nothing
  for (const p of st.pools) {
    if (p.kind === 'spring' || p.kind === 'plunge') continue;
    const r = seeded(hash(W.seed, st.k, Math.round(p.z * 10), 0x9001));
    const hz = p.z + p.rz * 0.92, hx = W.xAt(st, hz);
    if (start0(hx, hz)) rings(push, onWater, hx, hz, [0.6, 1.1, 1.8], -Math.PI / 2, 0.9, r, FAM.impact, mat);
    // (its far shore, up the hill, where the bank's cut: a dark line, broken, as the prints draw the
    // bank under which the water lies; its near shore left open)
    for (let a = ramp(r, 0, 0.4); a < Math.PI * 2;) {
      const span = ramp(r, 0.25, 0.6), up = Math.sin(a + span / 2);
      if (up > -0.25 && r() < 0.45 + 0.5 * up) {
        const pts: V3[] = [];
        for (let t = a; t <= a + span; t += 0.05) {
          const wob = 1 + 0.12 * Math.sin(t * 3 + p.z) + 0.07 * Math.sin(t * 5 + p.x), e = wob - 0.08 / Math.min(p.rx, p.rz);
          const q = onWater(p.x + Math.cos(t) * p.rx * e, p.z + Math.sin(t) * p.rz * e);
          if (q && start0(q[0], q[2])) pts.push(q); else if (pts.length) break;
        }
        ribbon(push, pts, ramp(r, 0.08, 0.13) * (0.6 + 0.6 * Math.max(0, up)), FAM.bank, 0.8 + 0.19 * Math.max(0, up), mat);
      }
      a += span + ramp(r, 0.12, 0.45);
    }
    const nLines = p.kind === 'marsh' ? 3 : p.kind === 'pond' ? 2 + Math.floor(r() * 2) : r() < 0.6 ? 1 : 0;
    for (let q = 0; q < nLines; q++) {
      const z = p.z + ramp(r, -0.55, 0.35) * p.rz, half = p.rx * Math.sqrt(Math.max(0, 1 - ((z - p.z) / p.rz) ** 2));
      const len = half * 2 * ramp(r, 0.25, 0.55) * (p.kind === 'marsh' ? 0.5 : 1), x = p.x + ramp(r, -0.4, 0.4) * half;
      if (!start0(x, z)) continue;
      const pts: V3[] = [];
      for (let d = -len / 2; d <= len / 2; d += 0.3) { const q2 = onWater(x + d, z + 0.03 * Math.sin(d * 1.3)); if (q2) pts.push(q2); }
      ribbon(push, pts, ramp(r, 0.04, 0.06), FAM.still, ramp(r, 0.55, 0.8), mat);
    }
  }
  function start0(x: number, z: number) { return z >= z0 && z < z1 && own(x, z); }
}

/** Arcs about a centre: at each radius, a ring broken into two or three pieces, spanning so far either side of the angle `a`, fainter and sparser outward. */
function rings(push: Push, onWater: (x: number, z: number) => V3 | null, x: number, z: number, radii: number[], a: number, span: number, r: Rand, fam: number, mat: number) {
  radii.forEach((R, i) => {
    const sp = span * (1 - i * 0.12);
    for (let b = a - sp; b < a + sp;) {
      const e = Math.min(a + sp, b + ramp(r, 0.3, 0.8) * sp), pts: V3[] = [];
      for (let t = b; t <= e; t += 0.12 / R) { const p = onWater(x + Math.cos(t) * R, z + Math.sin(t) * R * 0.85); if (p) pts.push(p); }
      if (r() < 0.85 - i * 0.15) ribbon(push, pts, 0.035 * (1 - i * 0.15), fam, 0.85 - i * 0.18, mat);
      b = e + ramp(r, 0.15, 0.4) * sp;
    }
  });
}

/**
 * The marks about a stone standing in the water: where the water runs, the current split about it
 * upstream (two short arcs on its upstream side) and its wake behind it, two strokes trailing away
 * downstream, spreading a little (short and broken where it runs fast); in still water, nothing (its
 * rings are its own: see the ripples).
 */
export function obstacleMarks(push: Push, W: Water, o: Obstacle, mat: number) {
  const w = W.at(o.x, o.z);
  if (!w || w.s > 0.15 || w.kind !== 'flow') return;
  const r = seeded(hash(W.seed, Math.round(o.x * 10), Math.round(o.z * 10), 0x0b57));
  const onWater = (x: number, z: number): V3 | null => { const q = W.at(x, z); return q && q.s < -0.03 ? [x, q.L + 0.022, z] : null; };
  const st = w.st, dx = W.xAt(st, o.z - 0.5) - W.xAt(st, o.z + 0.5), l = Math.hypot(dx, 1), down: [number, number] = [dx / l, -1 / l];
  const ang = Math.atan2(down[1], down[0]);
  // (split, upstream)
  for (const R of [o.r * 1.2, o.r * 1.55]) {
    const pts: V3[] = [];
    for (let t = -1.15; t <= 1.15; t += 0.15) { const b = ang + Math.PI + t, p = onWater(o.x + Math.cos(b) * R, o.z + Math.sin(b) * R); if (p) pts.push(p); else if (pts.length) break; }
    if (r() < 0.8) ribbon(push, pts, 0.035, FAM.obstacle, ramp(r, 0.7, 1), mat);
  }
  // (wake, downstream)
  const fast = w.run >= 0.2;
  for (const sd of [-1, 1]) {
    const len = o.r * (fast ? ramp(r, 2, 3.2) : ramp(r, 3.5, 6.5)), spread = ramp(r, 0.08, 0.18), pts: V3[] = [];
    const sx = o.x + down[1] * sd * o.r * 0.85 - down[0] * o.r * 0.2, sz = o.z - down[0] * sd * o.r * 0.85 - down[1] * o.r * 0.2;
    for (let d = 0; d <= len; d += 0.2) {
      const off = sd * spread * d + 0.03 * Math.sin(d * 4 + sd);
      const p = onWater(sx + down[0] * d + down[1] * off, sz + down[1] * d - down[0] * off);
      if (!p) break;
      pts.push(p);
    }
    ribbon(push, pts, ramp(r, 0.03, 0.05), FAM.obstacle, ramp(r, 0.6, 0.95), mat);
  }
}
