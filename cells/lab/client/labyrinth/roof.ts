/**
 * Roofs (drawn for mesh.ts, with its means: emit.ts): over a building, as buildings.ts has it, hipped, gabled, a shed,
 * or a dome on a drum; tiled, out over the walls at the eaves, a ridge along the top, the hips capped.
 */
import { hash } from '../kit/rng';
import { key } from './model';
import type { Building } from './buildings';
import { MAT, TILE_U, X, Z, type Emit, type V3 } from './emit';

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
  const O = 0.12, y = b.h, ye = y + 0.02;
  // (over the plan, or the part of it left beside a terrace, or a wing of it)
  const P = wing ?? b.roofPlan ?? b, xa = X(P.i0), xb = X(P.i1 + 1), za = Z(P.j0), zb = Z(P.j1 + 1), along = xb - xa >= zb - za ? 0 : 1;
  E.cur = { born: Math.max(...b.cols.map(([i, j]) => w.born(b.h - 1, i, j))) + 0.2, pivot: y, how: 1, tone: 0.5, dress: 0, sel: b.cols.some(([i, j]) => selected.has(key(b.h - 1, i, j))) };
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
      if (Math.abs(a[1] - ye) > 0.01 || Math.abs(b2[1] - ye) > 0.01) continue;
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
    const f = b.fall, H = 0.45, hy = (x: number, z: number) => { const t = f === 0 ? (x - X0) / (X1 - X0) : f === 2 ? (X1 - x) / (X1 - X0) : f === 1 ? (z - Z0) / (Z1 - Z0) : (Z1 - z) / (Z1 - Z0); return ye + H * (1 - t); };
    const c: V3[] = [[X0, 0, Z0], [X1, 0, Z0], [X1, 0, Z1], [X0, 0, Z1]].map(([x, , z]) => [x, hy(x, z), z] as V3);
    slope(c);
    // (its two sides walled up under the slope, in the planes of the walls across the fall)
    const mid: V3 = [cx, y, cz], sides: Array<[V3, V3]> = f % 2 === 0 ? [[[xa, 0, za], [xb, 0, za]], [[xa, 0, zb], [xb, 0, zb]]] : [[[xa, 0, za], [xa, 0, zb]], [[xb, 0, za], [xb, 0, zb]]];
    for (const [p, q] of sides) face([[p[0], y, p[2]], [q[0], y, q[2]], [q[0], hy(q[0], q[2]), q[2]], [p[0], hy(p[0], p[2]), p[2]]], MAT.stone, 0.9, true, mid);
    return;
  }
  // (hipped, or gabled: a ridge along the long way, at a pitch a little under half the short span)
  const S = along === 0 ? Z1 - Z0 : X1 - X0, H = S * 0.42;
  const r0: V3 = along === 0 ? [b.roof === 'hipped' ? X0 + S / 2 : X0, ye + H, cz] : [cx, ye + H, b.roof === 'hipped' ? Z0 + S / 2 : Z0];
  const r1: V3 = along === 0 ? [b.roof === 'hipped' ? X1 - S / 2 : X1, ye + H, cz] : [cx, ye + H, b.roof === 'hipped' ? Z1 - S / 2 : Z1];
  const A: V3 = [X0, ye, Z0], B: V3 = [X1, ye, Z0], C: V3 = [X1, ye, Z1], D: V3 = [X0, ye, Z1];
  if (along === 0) { slope([A, B, r1, r0]); slope([D, C, r1, r0]); } else { slope([A, D, r1, r0]); slope([B, C, r1, r0]); }
  if (b.roof === 'hipped') {
    if (along === 0) { slope([A, D, r0]); slope([B, C, r1]); } else { slope([A, B, r0]); slope([D, C, r1]); }
  } else {
    // (the gable ends: walled up in stone, in the plane of the wall, a band at their foot along the eaves' line)
    // (the slope's height a distance d in from the eave; at the wall's own line, the eaves' overhang in)
    const hAt = (d: number) => ye + H * Math.min(1, d / (S / 2)), hg = hAt(O);
    const mid: V3 = [cx, y, cz];
    if (along === 0) for (const x of [xa, xb]) { face([[x, y, za], [x, y, zb], [x, hg, zb], [x, hg, za]], MAT.stone, 0.85, true, mid); face([[x, hg, za], [x, hg, zb], [x, ye + H, cz]], MAT.stone, 0.85, true, mid); const o = x === xa ? -0.03 : 0.03; box(Math.min(x, x + o), Math.max(x, x + o), y - 0.02, y + 0.04, za, zb, MAT.stone, 0.9); }
    else for (const z of [za, zb]) { face([[xa, y, z], [xb, y, z], [xb, hg, z], [xa, hg, z]], MAT.stone, 0.85, true, mid); face([[xa, hg, z], [xb, hg, z], [cx, ye + H, z]], MAT.stone, 0.85, true, mid); const o = z === za ? -0.03 : 0.03; box(xa, xb, y - 0.02, y + 0.04, Math.min(z, z + o), Math.max(z, z + o), MAT.stone, 0.9); }
  }
  // (the ridge, and the hips: capped in round tiles, each overlapping the next, set in a bed of mortar)
  capRun(E, r0, r1, 0.05);
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
