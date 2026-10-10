/**
 * Marble Run: the meshes. Pure: vertex arrays (position, normal, a material id, and a texture
 * coordinate in the piece's own terms) from the track's boards: a floor with its cut edge, side
 * walls, the strips and pegs in it with their glue seams, spinner axles with their hubs, belts
 * and motors, the tape at the joins, the trestles that hold it all up; the spinner arms and the
 * gate, drawn live; the chequered line; a sphere; a ring and a disc; the workshop floor.
 *
 * Cardboard is built, not just coloured: a strip is two paper skins (material 1) about a
 * corrugated core, seen wherever it was cut (material 7): the top of every strip, the ends,
 * the edge of a board, the side of a peg. Texture coordinates follow how each piece was made:
 * along a strip and up it, along a board and across it.
 */
import { WALL_H, add, cross, frameAlong, mul, norm, sub, toWorld, type Board, type Frame, type V3 } from './track';

/**
 * a vertex: position, normal, material, (u, v).
 * materials: 0 the floor's top, 1 paper skin, 2 metal, 3 the workshop floor, 4 timber, 5 the
 * chequered line, 6 the marker, 7 a cut edge (the corrugated core), 8 tape, 9 a blob shadow,
 * 11 a glue seam, 12 black rubber; 10 a marble (its own shader)
 */
export const VSTRIDE = 9;
type UV = [number, number];
interface Mats { top: number; bottom: number; side: number; end: number }
const same = (m: number): Mats => ({ top: m, bottom: m, side: m, end: m });

function push(out: number[], p: V3, n: V3, mat: number, uv: UV) {
  out.push(p[0], p[1], p[2], n[0], n[1], n[2], mat, uv[0], uv[1]);
}
function tri(out: number[], a: V3, b: V3, c: V3, mat: number, ua: UV, ub: UV, uc: UV) {
  const n = norm(cross(sub(b, a), sub(c, a)));
  push(out, a, n, mat, ua); push(out, b, n, mat, ub); push(out, c, n, mat, uc);
}
function quad(out: number[], a: V3, b: V3, c: V3, d: V3, na: V3, nb: V3, nc: V3, nd: V3, mat: number, ua: UV, ub: UV, uc: UV, ud: UV) {
  for (const [p, n, uv] of [[a, na, ua], [b, nb, ub], [c, nc, uc], [a, na, ua], [c, nc, uc], [d, nd, ud]] as Array<[V3, V3, UV]>) push(out, p, n, mat, uv);
}
/** a flat quad, its normal from its corners */
function flat(out: number[], a: V3, b: V3, c: V3, d: V3, mat: number, ua: UV, ub: UV, uc: UV, ud: UV) {
  const n = norm(cross(sub(b, a), sub(c, a)));
  quad(out, a, b, c, d, n, n, n, n, mat, ua, ub, uc, ud);
}
/** where (along, up, across) is in the world: a board's own bending map, or a frame's straight one */
type Map3 = (a: number, u: number, c: number) => V3;
const linear = (f: Frame, origin: V3): Map3 => (a, u, c) => add(add(add(origin, mul(f.t, a)), mul(f.n, u)), mul(f.b, c));
const bent = (bd: Board): Map3 => (a, u, c) => toWorld(bd, a, u, c);
/**
 * A box from (along0, up0, across0) to (along1, up1, across1) through a map, in so many pieces
 * along (a bent board's box follows the bend); each face's normal from its corners; each face
 * its material (top, bottom, the two sides, the two ends) and its own (u, v): top and bottom
 * (along, across), sides (along, up), ends (across, up).
 */
function boxM(out: number[], M: Map3, a0: number, u0: number, c0: number, a1: number, u1: number, c1: number, mats: Mats, pieces = 1) {
  const P = M;
  for (let i = 0; i < pieces; i++) {
    const p0 = a0 + ((a1 - a0) * i) / pieces, p1 = a0 + ((a1 - a0) * (i + 1)) / pieces;
    flat(out, P(p0, u1, c0), P(p1, u1, c0), P(p1, u1, c1), P(p0, u1, c1), mats.top, [p0, c0], [p1, c0], [p1, c1], [p0, c1]);
    flat(out, P(p0, u0, c1), P(p1, u0, c1), P(p1, u0, c0), P(p0, u0, c0), mats.bottom, [p0, c1], [p1, c1], [p1, c0], [p0, c0]);
    flat(out, P(p0, u0, c0), P(p1, u0, c0), P(p1, u1, c0), P(p0, u1, c0), mats.side, [p0, u0], [p1, u0], [p1, u1], [p0, u1]);
    flat(out, P(p0, u1, c1), P(p1, u1, c1), P(p1, u0, c1), P(p0, u0, c1), mats.side, [p0, u1], [p1, u1], [p1, u0], [p0, u0]);
    if (i === pieces - 1) flat(out, P(p1, u0, c0), P(p1, u0, c1), P(p1, u1, c1), P(p1, u1, c0), mats.end, [c0, u0], [c1, u0], [c1, u1], [c0, u1]);
    if (i === 0) flat(out, P(p0, u0, c1), P(p0, u0, c0), P(p0, u1, c0), P(p0, u1, c1), mats.end, [c1, u0], [c0, u0], [c0, u1], [c1, u1]);
  }
}
/** A box in a frame: from (along0, up0, across0) to (along1, up1, across1), one material. */
export function box(out: number[], f: Frame, origin: V3, a0: number, u0: number, c0: number, a1: number, u1: number, c1: number, mat: number) {
  boxM(out, linear(f, origin), a0, u0, c0, a1, u1, c1, same(mat));
}
/** A cylinder standing on a board at (along, across), radius, from u0 to u1: its side (u round it, v up) and its top. */
function cylinder(out: number[], M: Map3, F: Frame, along: number, across: number, radius: number, u0: number, u1: number, side: number, top: number, S = 16) {
  const ring = (u: number, k: number): [V3, V3] => {
    const a = (k / S) * Math.PI * 2;
    return [M(along + Math.cos(a) * radius, u, across + Math.sin(a) * radius), add(mul(F.t, Math.cos(a)), mul(F.b, Math.sin(a)))];
  };
  const topP = M(along, u1, across);
  for (let k = 0; k < S; k++) {
    const [a, na] = ring(u0, k), [b, nb] = ring(u0, k + 1), [c, nc] = ring(u1, k + 1), [d, nd] = ring(u1, k);
    const s0 = (k / S) * Math.PI * 2 * radius, s1 = ((k + 1) / S) * Math.PI * 2 * radius;
    quad(out, a, b, c, d, na, nb, nc, nd, side, [s0, u0], [s1, u0], [s1, u1], [s0, u1]);
    const t0 = (k / S) * Math.PI * 2, t1 = ((k + 1) / S) * Math.PI * 2;
    tri(out, topP, ring(u1, k)[0], ring(u1, k + 1)[0], top, [along, across], [along + Math.cos(t0) * radius, across + Math.sin(t0) * radius], [along + Math.cos(t1) * radius, across + Math.sin(t1) * radius]);
  }
}
/**
 * A strip stood on edge along a segment in the board's plane: paper skins for its faces, the
 * cut core for its top and its rounded ends (as the solver has it: a capsule), and a glue seam
 * about its foot; bending with the board, in pieces.
 */
function strip(out: number[], M: Map3, a: [number, number], b: [number, number], thick: number, height: number, bendy: boolean) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l;
  // (the strip's own (s, u, w): s along it, w across it, through the board's map)
  const W: Map3 = (s, u, w) => M(a[0] + ux * s - uy * w, u, a[1] + uy * s + ux * w);
  const pieces = bendy ? Math.max(1, Math.ceil(l / 3)) : 1;
  boxM(out, W, 0, 0, -thick, l, height, thick, { top: 7, bottom: 1, side: 1, end: 7 }, pieces);
  const F: Frame = { p: [0, 0, 0], t: [1, 0, 0], n: [0, 1, 0], b: [0, 0, 1] };
  for (const s of [0, l]) cylinder(out, W, F, s, 0, thick, 0, height, 7, 7, 10);
  // the seam: a dark fillet where it was glued down
  const g = 0.3;
  boxM(out, W, -g, 0, -thick - g, l + g, 0.22, thick + g, same(11), pieces);
}

/**
 * A board: its floor (its top the playing surface, its edges cut), its side walls, a back wall
 * (the gate's; below a step the drop's face is the back), its strips, pegs and spinner axles
 * with their hubs, belts and motors, and tape across the join where it meets the board before.
 */
export function boardMesh(bd: Board, out: number[]) {
  const M = bent(bd);
  const bendy = !!bd.turn;
  const pieces = bendy ? Math.ceil(bd.length / 3) : 1;
  const half = bd.width / 2;
  const T = 0.6;
  boxM(out, M, 0, -T, -half - T, bd.length, 0, half + T, { top: 0, bottom: 1, side: 7, end: 7 }, pieces);
  const sideH = bd.sideH ?? WALL_H;
  const sideMats: Mats = { top: 7, bottom: 1, side: 1, end: 7 };
  boxM(out, M, 0, 0, half, bd.length, sideH, half + T, sideMats, pieces);
  boxM(out, M, 0, 0, -half - T, bd.length, sideH, -half, sideMats, pieces);
  if (bd.backWall && !bd.sideH) boxM(out, M, -T, 0, -half - T, 0, WALL_H, half + T, sideMats);
  if (bd.step > 0) boxM(out, M, bd.length - T, -bd.step - T, -half - T, bd.length, 0, half + T, { top: 0, bottom: 1, side: 1, end: 7 });
  // (the seams where the sides were glued to the floor)
  boxM(out, M, 0, 0, half - 0.3, bd.length, 0.22, half, same(11), pieces);
  boxM(out, M, 0, 0, -half, bd.length, 0.22, -half + 0.3, same(11), pieces);
  for (const w of bd.walls) strip(out, M, w.a, w.b, w.thick, WALL_H * 0.8, bendy);
  for (const [pa, pc, pr] of bd.pegs) {
    const F = frameAlong(bd, pa);
    cylinder(out, M, F, pa, pc, pr, 0, WALL_H * 0.75, 7, 1);
    cylinder(out, M, F, pa, pc, pr + 0.3, 0, 0.22, 11, 11, 12);
  }
  for (const sp of bd.spinners) {
    const F = frameAlong(bd, sp.at[0]);
    // the axle, a washer at its foot, a belt along the floor to a motor on the nearer side
    cylinder(out, M, F, sp.at[0], sp.at[1], 0.8, 0, 2.6, 2, 2);
    cylinder(out, M, F, sp.at[0], sp.at[1], 1.7, 0, 0.3, 2, 2, 20);
    const side = sp.at[1] >= 0 ? 1 : -1;
    const motorC = side * (half - 2.6);
    boxM(out, M, sp.at[0] - 0.25, 0.05, Math.min(sp.at[1], motorC), sp.at[0] + 0.25, 0.14, Math.max(sp.at[1], motorC), same(12));
    boxM(out, M, sp.at[0] - 2.2, 0, side * (half - 4.6), sp.at[0] + 2.2, 2.2, side * (half - 0.2), { top: 12, bottom: 12, side: 12, end: 2 });
    cylinder(out, M, F, sp.at[0], motorC, 1.2, 0, 2.5, 2, 2, 12);
  }
  // tape over the join with the board before (not at the gate)
  if (!bd.backWall) for (const c of [-half * 0.55, half * 0.55]) boxM(out, M, -4.5, 0.02, c - 1.1, 4.5, 0.07, c + 1.1, same(8));
}
/** The spinners' arms where they are now, to draw each frame. */
export function spinnerMesh(bd: Board, time: number, out: number[]) {
  for (const sp of bd.spinners) {
    const f = frameAlong(bd, sp.at[0]);
    const th0 = time * sp.rate * Math.PI * 2;
    const axle = toWorld(bd, sp.at[0], 1.2, sp.at[1]);
    for (let k = 0; k < sp.arms; k++) {
      const th = th0 + (k * Math.PI * 2) / sp.arms;
      const t: V3 = add(mul(f.t, Math.cos(th)), mul(f.b, Math.sin(th)));
      const bf: Frame = { p: f.p, t, n: f.n, b: norm(cross(t, f.n)) };
      boxM(out, linear(bf, axle), 0, -0.7, -0.7, sp.half, 0.7, 0.7, { top: 7, bottom: 7, side: 1, end: 7 });
    }
  }
}
/** The gate: a bar across the first board, lifting as the race begins. */
export function gateMesh(bd: Board, lift: number, out: number[]) {
  const f = bd.frame;
  const half = bd.width / 2;
  box(out, f, f.p, 6, 0.3 + lift, -half, 7, 2.4 + lift, half, 2);
  box(out, f, f.p, 5.6, 0, -half - 1.2, 7.4, 10, -half - 0.6, 2);
  box(out, f, f.p, 5.6, 0, half + 0.6, 7.4, 10, half + 1.2, 2);
}
/** The chequered line: a strip across the board's end. */
export function lineMesh(line: Frame, width: number, out: number[]) {
  const half = width / 2;
  box(out, line, line.p, -4, 0.02, -half, 0, 0.05, half, 5);
}

/** A unit sphere, smooth. */
export function sphereMesh(out: number[], S = 32, Rr = 20) {
  const at = (i: number, j: number): V3 => {
    const th = (i / S) * Math.PI * 2, ph = (j / Rr) * Math.PI;
    return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
  };
  for (let j = 0; j < Rr; j++) for (let i = 0; i < S; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    quad(out, a, b, c, d, a, b, c, d, 10, [0, 0], [0, 0], [0, 0], [0, 0]);
  }
}
/** A flat ring about the origin (the marker under a marble), a unit across, lying in x–z. */
export function ringMesh(out: number[], S = 32) {
  const n: V3 = [0, 1, 0];
  for (let i = 0; i < S; i++) {
    const a0 = (i / S) * Math.PI * 2, a1 = ((i + 1) / S) * Math.PI * 2;
    const P = (a: number, r: number): V3 => [Math.cos(a) * r, 0, Math.sin(a) * r];
    quad(out, P(a0, 0.72), P(a0, 1), P(a1, 1), P(a1, 0.72), n, n, n, n, 6, [0, 0], [0, 0], [0, 0], [0, 0]);
  }
}
/** A flat disc about the origin (a blob of shadow under a marble), a unit across, its (u, v) its place on it. */
export function discMesh(out: number[], S = 24) {
  const n: V3 = [0, 1, 0];
  for (let i = 0; i < S; i++) {
    const a0 = (i / S) * Math.PI * 2, a1 = ((i + 1) / S) * Math.PI * 2;
    const P = (a: number): V3 => [Math.cos(a), 0, Math.sin(a)];
    const p0 = P(a0), p1 = P(a1);
    push(out, [0, 0, 0], n, 9, [0, 0]); push(out, p0, n, 9, [p0[0], p0[2]]); push(out, p1, n, 9, [p1[0], p1[2]]);
  }
}
/**
 * Trestles under a board: an A-frame of timber at each end, its feet spread a little, a rail
 * between them near the ground and a brace up under the board; one more under the middle of a
 * long board.
 */
export function trestleMesh(bd: Board, groundY: number, out: number[]) {
  const half = bd.width / 2;
  const ats = bd.length > 70 ? [7, bd.length / 2, bd.length - 7] : [7, bd.length - 7];
  for (const a of ats) {
    const f = frameAlong(bd, a);
    const feet: V3[] = [];
    for (const s of [-1, 1]) {
      const top = toWorld(bd, a, -0.6, s * (half - 1.5));
      const h = top[1] - groundY;
      if (h < 2) continue;
      const foot: V3 = add([top[0], groundY, top[2]], mul(f.b, s * Math.min(14, h * 0.12)));
      feet.push(foot);
      const dir = norm(sub(top, foot));
      const lf: Frame = { p: foot, t: dir, n: norm(cross(dir, f.b)), b: f.b };
      box(out, lf, foot, 0, -1.1, -1.1, h + 0.1, 1.1, 1.1, 4);
    }
    if (feet.length === 2) {
      const rf: Frame = { p: feet[0], t: norm(sub(feet[1], feet[0])), n: [0, 1, 0], b: f.t };
      box(out, rf, add(feet[0], [0, 12, 0]), 0, -1, -0.9, len3(sub(feet[1], feet[0])), 1, 0.9, 4);
    }
  }
}
const len3 = (v: V3) => Math.hypot(v[0], v[1], v[2]);
/** The workshop floor: a big square far below. */
export function groundMesh(centre: V3, y: number, size: number, out: number[]) {
  const n: V3 = [0, 1, 0];
  const P = (x: number, z: number): V3 => [centre[0] + x, y, centre[2] + z];
  quad(out, P(-size, -size), P(-size, size), P(size, size), P(size, -size), n, n, n, n, 3, [-size, -size], [-size, size], [size, size], [size, -size]);
}
