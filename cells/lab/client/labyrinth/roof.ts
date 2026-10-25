/**
 * Roofs (drawn for mesh.ts, with its means: emit.ts): over a building, as buildings.ts has it, hipped, gabled, a shed,
 * or a dome on a drum; tiled, out over the walls at the eaves, a ridge along the top, the hips capped. How, by the
 * building's tradition (regions.ts):
 * - **the middle sea**: terracotta at a pitch a little under half the span, a short overhang;
 * - **the north**: slate, steep (as high as the span's nearly), tight at the eaves; its gable ends stepped in brick or
 *   timber-framed; dormers along its slopes, a window lit in each now and then; a chimney on the ridge;
 * - **the east**: grey tile, low, the eaves deep and turned up toward the corners; a skirt of tile round the building at
 *   each floor; the ridge's ends raised.
 */
import { hash } from '../kit/rng';
import { key } from './model';
import type { Building } from './buildings';
import { grammarOfId } from './regions';
import { KIND, MAT, TILE_U, X, Z, type Emit, type V3 } from './emit';

/**
 * A roof over a building (buildings.ts says which): hipped (a pyramid on a square plan, a ridge along a long one),
 * gabled (two slopes, the ends walled up in stone), a shed roof (one slope, falling away from the taller stone it
 * leans on), or a dome on a drum. Tiled in terracotta (the dome in lead), out over the walls at the eaves, its
 * underside showing; a ridge along the top.
 */
export function roof(E: Emit, b: Building, wing?: { i0: number; i1: number; j0: number; j1: number }) {
  const { w, selected, face, lathe, box } = E;
  // (a plan in wings: a roof over each, the same height at the eaves, meeting the others in valleys)
  if (b.wings && !wing) { for (const wg of b.wings) roof(E, b, wg); return; }
  const g = grammarOfId(w, b.id), steep = g.roof === 'steep', eave = g.roof === 'eave';
  const O = eave ? 0.3 : steep ? 0.06 : 0.12, y = b.h, ye = y + 0.02;
  // (over the plan, or the part of it left beside a terrace, or a wing of it)
  const P = wing ?? b.roofPlan ?? b, xa = X(P.i0), xb = X(P.i1 + 1), za = Z(P.j0), zb = Z(P.j1 + 1), along = xb - xa >= zb - za ? 0 : 1;
  // (the tiles' kind in the tone: terracotta, slate past 1.5, grey tile past 2.5: render.ts)
  E.cur = { born: Math.max(...b.cols.map(([i, j]) => w.born(b.h - 1, i, j))) + 0.2, pivot: y, how: 1, tone: steep ? 2 : eave ? 3 : 0.5, dress: 0, sel: b.cols.some(([i, j]) => selected.has(key(b.h - 1, i, j))) };
  const born = E.cur.born;
  // (each slope a slab of tiles with a thickness: its top, its underside a little below, and its edges (the eaves, the
  // verges over a gable, the hips) closed, so where it overhangs a wall it reads as a roof, not a cut)
  const RT = 0.07;
  const slope = (p: V3[]) => {
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((x) => x / l); if (n[1] < 0) n = n.map((x) => -x);
    const q = p.map((c) => [c[0] - n[0] * RT, c[1] - n[1] * RT, c[2] - n[2] * RT] as V3), mid = p.reduce((a, c) => [a[0] + c[0] / p.length, a[1] + c[1] / p.length, a[2] + c[2] / p.length], [0, 0, 0]) as V3;
    face(p, MAT.tile, 1, true); face(q, MAT.tile, 0.45, false);
    for (let e = 0; e < p.length; e++) { const a = p[e], b = p[(e + 1) % p.length]; face([a, b, q[(e + 1) % p.length], q[e]], MAT.tile, 0.8, true, [mid[0] - n[0] * RT / 2, mid[1] - n[1] * RT / 2, mid[2] - n[2] * RT / 2]); }
    // (along its eaves, the tiles' own ends: each cap tile's round end out over the edge, where the shader's tiles have
    // their crowns (render.ts: columns TILE_U across the slope, the caps on every other one), so the eave's line is
    // scalloped and throws its little shadows)
    const T: V3 = (() => { const t = [-n[2], 0, n[0]], l = Math.hypot(t[0], t[2]) || 1; return [t[0] / l, 0, t[2] / l]; })();
    const S: V3 = (() => { const c = [n[1] * T[2] - n[2] * T[1], n[2] * T[0] - n[0] * T[2], n[0] * T[1] - n[1] * T[0]]; const l = Math.hypot(c[0], c[1], c[2]) || 1; return (c[1] < 0 ? [-c[0] / l, -c[1] / l, -c[2] / l] : [c[0] / l, c[1] / l, c[2] / l]) as V3; })();
    for (let e = 0; e < p.length; e++) {
      const a = p[e], b2 = p[(e + 1) % p.length];
      if (steep || Math.abs(a[1] - ye) > 0.01 || Math.abs(b2[1] - ye) > 0.01) continue;
      const ua = (a[0] * T[0] + a[2] * T[2]) * TILE_U, ub = (b2[0] * T[0] + b2[2] * T[2]) * TILE_U, lo = Math.min(ua, ub), hi = Math.max(ua, ub);
      for (let u = Math.ceil((lo - 0.5) / 2) * 2 + 0.5; u < hi - 0.4; u += 2) {
        if (u < lo + 0.4) continue;
        const f = (u - ua) / (ub - ua), c: V3 = [a[0] + (b2[0] - a[0]) * f, a[1] + (b2[1] - a[1]) * f, a[2] + (b2[2] - a[2]) * f];
        halfRound(E, c, [-S[0], -S[1], -S[2]], T, n as V3, 0.042 * (0.92 + 0.16 * hash(Math.round(c[0] * 97), Math.round(c[2] * 97), 3) / 0xffffffff), 0.16, MAT.tile);
        // (and the pan beside it, its hollow end: a trough, lower, between the caps)
        const f2 = (u + 1 - ua) / (ub - ua);
        if (u + 1 < hi - 0.4) { const c2: V3 = [a[0] + (b2[0] - a[0]) * f2 + n[0] * 0.035, a[1] + (b2[1] - a[1]) * f2 + n[1] * 0.035, a[2] + (b2[2] - a[2]) * f2 + n[2] * 0.035]; halfRound(E, c2, [-S[0], -S[1], -S[2]], T, [-n[0], -n[1], -n[2]], 0.05, 0.12, MAT.tile); }
      }
    }
  };
  // (over a gable's ends, only a little past the wall: the verge)
  const OG = b.roof === 'gable' ? 0.05 : O;
  const X0 = xa - (along === 0 ? OG : O), X1 = xb + (along === 0 ? OG : O), Z0 = za - (along === 1 ? OG : O), Z1 = zb + (along === 1 ? OG : O), cx = (xa + xb) / 2, cz = (za + zb) / 2;
  if (b.roof === 'dome') {
    const r = Math.min(xb - xa, zb - za) * 0.42;
    lathe(cx, cz, [[r + 0.04, y], [r + 0.04, y + 0.06], [r, y + 0.06], [r, y + 0.2]], MAT.stone, 16);
    E.cur.dress = 0;
    lathe(cx, cz, Array.from({ length: 9 }, (_, q) => { const t = (q / 8) * (Math.PI / 2); return [r * Math.cos(t), y + 0.2 + r * 0.95 * Math.sin(t)] as [number, number]; }), MAT.lead, 16);
    lathe(cx, cz, [[0.03, y + 0.2 + r * 0.95], [0.02, y + 0.32 + r * 0.95], [0.045, y + 0.36 + r * 0.95], [0, y + 0.42 + r * 0.95]], MAT.lead, 6);
    return;
  }
  if (b.roof === 'shed') {
    // (high against what it leans on, falling to the eave the other side)
    const f = b.fall, H = steep ? 0.8 : eave ? 0.32 : 0.45, hy = (x: number, z: number) => { const t = f === 0 ? (x - X0) / (X1 - X0) : f === 2 ? (X1 - x) / (X1 - X0) : f === 1 ? (z - Z0) / (Z1 - Z0) : (Z1 - z) / (Z1 - Z0); return ye + H * (1 - t); };
    const c: V3[] = [[X0, 0, Z0], [X1, 0, Z0], [X1, 0, Z1], [X0, 0, Z1]].map(([x, , z]) => [x, hy(x, z), z] as V3);
    slope(c);
    // (its two sides walled up under the slope, in the planes of the walls across the fall)
    const mid: V3 = [cx, y, cz], sides: Array<[V3, V3]> = f % 2 === 0 ? [[[xa, 0, za], [xb, 0, za]], [[xa, 0, zb], [xb, 0, zb]]] : [[[xa, 0, za], [xa, 0, zb]], [[xb, 0, za], [xb, 0, zb]]];
    for (const [p, q] of sides) face([[p[0], y, p[2]], [q[0], y, q[2]], [q[0], hy(q[0], q[2]), q[2]], [p[0], hy(p[0], p[2]), p[2]]], MAT.stone, 0.9, true, mid);
    return;
  }
  // (in the east, a skirt of tile round it at each floor over the first)
  if (eave && !wing) skirts(E, b, xa, xb, za, zb);
  // (hipped, or gabled: a ridge along the long way, at a pitch a little under half the short span; in the north steep, a
  // spire on a tower; in the east low)
  const S = along === 0 ? Z1 - Z0 : X1 - X0, H = S * (steep ? (b.roof === 'hipped' ? 1.3 : 0.95) : eave ? 0.36 : 0.42);
  const r0: V3 = along === 0 ? [b.roof === 'hipped' ? X0 + S / 2 : X0, ye + H, cz] : [cx, ye + H, b.roof === 'hipped' ? Z0 + S / 2 : Z0];
  const r1: V3 = along === 0 ? [b.roof === 'hipped' ? X1 - S / 2 : X1, ye + H, cz] : [cx, ye + H, b.roof === 'hipped' ? Z1 - S / 2 : Z1];
  // (in the east the corners turned up)
  const UP = eave ? 0.17 : 0;
  const A: V3 = [X0, ye + UP, Z0], B: V3 = [X1, ye + UP, Z0], C: V3 = [X1, ye + UP, Z1], D: V3 = [X0, ye + UP, Z1];
  // (a slope from an eave to a ridge, its eave curving up toward its ends: in strips)
  const curved = (e0: V3, e1: V3, q0: V3, q1: V3) => {
    const N = 8, at = (p: V3, q: V3, t: number): V3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    const lift = (t: number) => UP * (Math.abs(2 * t - 1) ** 2.5 - 1);
    for (let n = 0; n < N; n++) {
      const t0 = n / N, t1 = (n + 1) / N, a0 = at(e0, e1, t0), a1 = at(e0, e1, t1);
      a0[1] += lift(t0); a1[1] += lift(t1);
      const b0 = at(q0, q1, t0), b1 = at(q0, q1, t1);
      if (Math.hypot(b1[0] - b0[0], b1[2] - b0[2]) < 1e-6) slope([a0, a1, b0]); else slope([a0, a1, b1, b0]);
    }
  };
  const sl = (p: V3[]) => (eave ? curved(p[0], p[1], p[p.length === 3 ? 2 : 3], p[2]) : slope(p));
  if (along === 0) { sl([A, B, r1, r0]); sl([D, C, r1, r0]); } else { sl([A, D, r1, r0]); sl([B, C, r1, r0]); }
  if (b.roof === 'hipped') {
    if (along === 0) { sl([A, D, r0]); sl([B, C, r1]); } else { sl([A, B, r0]); sl([D, C, r1]); }
  } else if (steep) {
    // (the north's gable ends: stepped in brick, a little proud of the slopes; or walled up and framed in timber)
    const hAt = (d: number) => ye + H * Math.min(1, d / (S / 2)), hg = hAt(O), stepped = hash(w.seed, b.id, 31) % 2 === 0;
    const lo = along === 0 ? za : xa, hi = along === 0 ? zb : xb, mid: V3 = [cx, y, cz];
    for (const e of [0, 1]) {
      const pt = (s2: number, yy: number, inset = 0): V3 => along === 0 ? [(e ? xb : xa) + (e ? -inset : inset), yy, s2] : [s2, yy, (e ? zb : za) + (e ? -inset : inset)];
      const keepHow = E.cur.how, keepDress = E.cur.dress;
      if (stepped) E.cur.dress = KIND; else E.cur.how = 6;
      face([pt(lo, y), pt(hi, y), pt(hi, hg), pt(lo, hg)], MAT.stone, 0.85, true, mid);
      face([pt(lo, hg), pt(hi, hg), pt((lo + hi) / 2, ye + H)], MAT.stone, 0.85, true, mid);
      if (stepped) {
        const N = 4, Wh = (hi - lo) / 2, T0 = -0.04, T1 = 0.1;
        for (let q = 0; q < N; q++) for (const sd of [-1, 1]) {
          const s0 = sd < 0 ? lo + (q * Wh) / N : hi - ((q + 1) * Wh) / N, s1 = s0 + Wh / N, top = ye + (H * (q + 1)) / N + 0.07;
          const p0 = pt(s0, y, T0), p1 = pt(s1, y, T1);
          box(Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), hAt((q * Wh) / N) - 0.05, top, Math.min(p0[2], p1[2]), Math.max(p0[2], p1[2]), MAT.stone, [0.8, 0.8, 1, 1]);
        }
        const c0 = pt((lo + hi) / 2 - 0.07, y, T0), c1 = pt((lo + hi) / 2 + 0.07, y, T1);
        box(Math.min(c0[0], c1[0]), Math.max(c0[0], c1[0]), ye + H - 0.1, ye + H + 0.16, Math.min(c0[2], c1[2]), Math.max(c0[2], c1[2]), MAT.stone, 1);
      }
      E.cur.how = keepHow; E.cur.dress = keepDress;
    }
    dormers(E, b, along, xa, xb, za, zb, cx, cz, ye, H, S, born);
    chimney(E, along === 0 ? [xa + 0.32, ye + H, cz] : [cx, ye + H, za + 0.32]);
  } else {
    // (the gable ends: walled up in stone, in the plane of the wall, a band at their foot along the eaves' line)
    // (the slope's height a distance d in from the eave; at the wall's own line, the eaves' overhang in)
    const hAt = (d: number) => ye + H * Math.min(1, d / (S / 2)), hg = hAt(O);
    const mid: V3 = [cx, y, cz];
    if (along === 0) for (const x of [xa, xb]) { face([[x, y, za], [x, y, zb], [x, hg, zb], [x, hg, za]], MAT.stone, 0.85, true, mid); face([[x, hg, za], [x, hg, zb], [x, ye + H, cz]], MAT.stone, 0.85, true, mid); const o = x === xa ? -0.03 : 0.03; box(Math.min(x, x + o), Math.max(x, x + o), y - 0.02, y + 0.04, za, zb, MAT.stone, 0.9); }
    else for (const z of [za, zb]) { face([[xa, y, z], [xb, y, z], [xb, hg, z], [xa, hg, z]], MAT.stone, 0.85, true, mid); face([[xa, hg, z], [xb, hg, z], [cx, ye + H, z]], MAT.stone, 0.85, true, mid); const o = z === za ? -0.03 : 0.03; box(xa, xb, y - 0.02, y + 0.04, Math.min(z, z + o), Math.max(z, z + o), MAT.stone, 0.9); }
  }
  // (the ridge, and the hips: capped in round tiles, each overlapping the next, set in a bed of mortar; in the east its
  // ends raised)
  capRun(E, r0, r1, 0.05);
  if (eave) for (const r of r0[0] === r1[0] && r0[2] === r1[2] ? [r0] : [r0, r1]) box(r[0] - 0.035, r[0] + 0.035, r[1] - 0.02, r[1] + 0.13, r[2] - 0.035, r[2] + 0.035, MAT.tile, 0.9);
  if (b.roof === 'hipped') {
    for (const [c, r] of (along === 0 ? [[A, r0], [D, r0], [B, r1], [C, r1]] : [[A, r0], [B, r0], [D, r1], [C, r1]]) as Array<[V3, V3]>) capRun(E, r, c, 0.045);
    // (where the hips meet the ridge, or each other: a round boss of mortar and tile over the joint)
    for (const r of r0[0] === r1[0] && r0[2] === r1[2] ? [r0] : [r0, r1]) lathe(r[0], r[2], [[0.075, r[1] - 0.02], [0.08, r[1] + 0.03], [0.06, r[1] + 0.07], [0, r[1] + 0.09]], MAT.tile, 8);
  }
}
/**
 * A half-round tile, its hollow downward: its axis from c along d (toward its own length), round over e2 (up off what
 * it lies on), across e1; r its radius, len how long. Its open end at c, a lip.
 */
function halfRound(E: Emit, c: V3, d: V3, e1: V3, e2: V3, r: number, len: number, mat: number) {
  const N = 6, ring = (t: number, rr: number, y0: number) => Array.from({ length: N + 1 }, (_, q) => { const th = (q / N) * Math.PI, co = Math.cos(th), si = Math.sin(th); return { p: [c[0] + d[0] * t + (e1[0] * co + e2[0] * si) * rr + e2[0] * y0, c[1] + d[1] * t + (e1[1] * co + e2[1] * si) * rr + e2[1] * y0, c[2] + d[2] * t + (e1[2] * co + e2[2] * si) * rr + e2[2] * y0] as V3, n: [e1[0] * co + e2[0] * si, e1[1] * co + e2[1] * si, e1[2] * co + e2[2] * si] as V3 }; });
  const a = ring(-0.015, r * 1.06, 0), b = ring(-len, r, 0), inner = ring(-0.015, r * 0.7, 0);
  const { vert, quad } = E;
  const smooth = (p: { p: V3; n: V3 }, ao: number) => vert(p.p, p.n, ao, mat);
  for (let q = 0; q < N; q++) {
    // (its back, rounded, toward the eye from above)
    const P = [a[q], a[q + 1], b[q + 1], b[q]], u = P[1].p.map((x, k) => x - P[0].p[k]), v = P[2].p.map((x, k) => x - P[0].p[k]);
    // (wound so it faces the way its normals do: out from the tile)
    const flip = (u[1] * v[2] - u[2] * v[1]) * P[0].n[0] + (u[2] * v[0] - u[0] * v[2]) * P[0].n[1] + (u[0] * v[1] - u[1] * v[0]) * P[0].n[2] < 0;
    for (const k of flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) smooth(P[k], k < 2 ? 0.95 : 0.8);
    // (its lip: the open end, a ring of tile, dark inside)
    quad(a[q].p, a[q + 1].p, inner[q + 1].p, inner[q].p, d, [0.9, 0.9, 0.35, 0.35], mat);
  }
}
/** a run of round cap tiles from p0 to p1 (a ridge, a hip): each overlapping the next, a little wider at its foot */
function capRun(E: Emit, p0: V3, p1: V3, r: number) {
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  if (L < 0.05) return;
  const d: V3 = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L, (p1[2] - p0[2]) / L];
  // (across it, level; and up off it)
  let e1: V3 = [d[2], 0, -d[0]]; const l1 = Math.hypot(e1[0], e1[2]) || 1; e1 = [e1[0] / l1, 0, e1[2] / l1];
  const e2: V3 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]];
  const up: V3 = e2[1] < 0 ? [-e2[0], -e2[1], -e2[2]] : e2;
  // (laid from its lower end up, so each tile's foot lies over the one below)
  const lowFirst = p0[1] <= p1[1], a0 = lowFirst ? p0 : p1, dd: V3 = lowFirst ? d : [-d[0], -d[1], -d[2]];
  const n = Math.max(1, Math.round(L / 0.2)), step = L / n;
  for (let q = n - 1; q >= 0; q--) {
    // (each from its own foot, lying up the run over the foot of the one above it)
    const c: V3 = [a0[0] + dd[0] * step * q, a0[1] + dd[1] * step * q, a0[2] + dd[2] * step * q];
    halfRound(E, c, [-dd[0], -dd[1], -dd[2]], e1, up, r * (1 + 0.04 * (q % 2)), step + 0.03, MAT.tile);
  }
}

/** the east's skirts: at each floor over the first, a band of tile out round the building, falling a little */
function skirts(E: Emit, b: Building, xa: number, xb: number, za: number, zb: number) {
  const { face } = E, base = Math.min(...b.base), OUT = 0.24, DROP = 0.1;
  for (let k = base + 1; k < b.h; k++) {
    const y = k + 0.04, sides: Array<[V3, V3, V3, V3]> = [
      [[xa - OUT, y - DROP, za - OUT], [xb + OUT, y - DROP, za - OUT], [xb, y, za], [xa, y, za]],
      [[xb + OUT, y - DROP, zb + OUT], [xa - OUT, y - DROP, zb + OUT], [xa, y, zb], [xb, y, zb]],
      [[xa - OUT, y - DROP, zb + OUT], [xa - OUT, y - DROP, za - OUT], [xa, y, za], [xa, y, zb]],
      [[xb + OUT, y - DROP, za - OUT], [xb + OUT, y - DROP, zb + OUT], [xb, y, zb], [xb, y, za]],
    ];
    for (const p of sides) {
      face(p, MAT.tile, 1, true); face(p.map((c) => [c[0], c[1] - 0.04, c[2]] as V3), MAT.tile, 0.45, false);
      face([p[0], p[1], [p[1][0], p[1][1] - 0.04, p[1][2]], [p[0][0], p[0][1] - 0.04, p[0][2]]], MAT.tile, 0.8, true, [(xa + xb) / 2, y, (za + zb) / 2]);
    }
  }
}

/** the north's dormers: along each slope of a gable, one to every two cells of it, each a little gabled box out of the
 * slope with a window in its face, lit now and then */
function dormers(E: Emit, b: Building, along: number, xa: number, xb: number, za: number, zb: number, cx: number, cz: number, ye: number, H: number, S: number, born: number) {
  const { w, face, quad } = E, L = along === 0 ? xb - xa : zb - za, count = Math.max(1, Math.floor(L / 2)), half = S / 2;
  if (H < 0.6) return;
  const hS = (d: number) => ye + H * (1 - Math.min(1, Math.abs(d) / half));
  for (const sg of [-1, 1]) for (let m = 0; m < count; m++) {
    const t = (along === 0 ? xa : za) + ((m + 0.5) * L) / count, dw = 0.13, dF = half - 0.36, yS = hS(dF), yT = yS + 0.3;
    const dB = Math.max(0.02, half * (1 - (yT + 0.12 - ye) / H));
    // (a point by its place along the ridge, its distance out from the ridge on this side, its height)
    const Q = (a: number, d: number, yy: number): V3 => (along === 0 ? [a, yy, cz + sg * d] : [cx + sg * d, yy, a]);
    const inside = Q(t, (dF + dB) / 2, yS + 0.1);
    face([Q(t - dw, dF, yS - 0.04), Q(t + dw, dF, yS - 0.04), Q(t + dw, dF, yT), Q(t - dw, dF, yT)], MAT.wood, 0.9, true, inside);
    for (const s2 of [-dw, dw]) face([Q(t + s2, dF, yS - 0.04), Q(t + s2, dF, yT), Q(t + s2, dB, yT), Q(t + s2, dB, hS(dB) - 0.04)], MAT.wood, 0.8, true, inside);
    // (its little roof: two slopes to a ridge running back into the main one)
    const yR = yT + 0.12, O2 = 0.04;
    for (const s2 of [-1, 1]) {
      const p: V3[] = [Q(t + s2 * (dw + O2), dF + O2, yT - 0.02), Q(t, dF + O2, yR), Q(t, dB, yR), Q(t + s2 * (dw + O2), dB, yT - 0.02)];
      face(p, MAT.tile, 1, true); face(p.map((c) => [c[0], c[1] - 0.03, c[2]] as V3), MAT.tile, 0.45, false);
    }
    face([Q(t - dw - O2, dF + O2, yT - 0.02), Q(t + dw + O2, dF + O2, yT - 0.02), Q(t, dF + O2, yR)], MAT.wood, 0.85, true, inside);
    // (its window: in white bars, lit within now and then)
    const keep = E.cur.tone, lit = hash(w.seed, b.id, m, sg + 2, 33) % 100 < 45;
    E.cur.tone = 2 + 3 + (lit ? 8 : 0); E.cur.born = born;
    const n: V3 = along === 0 ? [0, 0, sg] : [sg, 0, 0];
    quad(Q(t - 0.08, dF + 0.005, yS + 0.05), Q(t + 0.08, dF + 0.005, yS + 0.05), Q(t + 0.08, dF + 0.005, yT - 0.05), Q(t - 0.08, dF + 0.005, yT - 0.05), n, 0.8, MAT.glass);
    E.cur.tone = keep;
  }
}

/** a chimney stack of brick on the ridge, a cap over it */
function chimney(E: Emit, at: V3) {
  const { box } = E, keep = E.cur.dress, r = 0.08;
  E.cur.dress = KIND;
  box(at[0] - r, at[0] + r, at[1] - 0.3, at[1] + 0.32, at[2] - r, at[2] + r, MAT.stone, [0.8, 0.8, 1, 1]);
  box(at[0] - r - 0.025, at[0] + r + 0.025, at[1] + 0.32, at[1] + 0.37, at[2] - r - 0.025, at[2] + r + 0.025, MAT.stone, 1);
  E.cur.dress = keep;
}
