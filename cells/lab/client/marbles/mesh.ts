/**
 * Marble Run: the meshes. Pure: vertex arrays (position, normal, and a material id) from the
 * track's boards: a floor, side walls, the walls and pegs and spinner axles in it; the spinner
 * arms and the gate, drawn live; the chequered line; a sphere; the tower; the ground.
 */
import { WALL_H, add, cross, mul, norm, sub, type Board, type Frame, type V3 } from './track';

/** a vertex: position, normal, material (0 the floor, 1 a wall's face, 2 metal, 3 ground, 4 tower, 5 the chequered line) */
export const VSTRIDE = 7;

function tri(out: number[], a: V3, b: V3, c: V3, mat: number, flip = false) {
  const n = norm(cross(sub(b, a), sub(c, a)));
  const nn = flip ? mul(n, -1) : n;
  for (const p of flip ? [a, c, b] : [a, b, c]) out.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], mat);
}
function quad(out: number[], a: V3, b: V3, c: V3, d: V3, na: V3, nb: V3, nc: V3, nd: V3, mat: number) {
  for (const [p, n] of [[a, na], [b, nb], [c, nc], [a, na], [c, nc], [d, nd]] as Array<[V3, V3]>) out.push(p[0], p[1], p[2], n[0], n[1], n[2], mat);
}
/** A box in a frame: from (along0, up0, across0) to (along1, up1, across1), outward normals. */
export function box(out: number[], f: Frame, origin: V3, a0: number, u0: number, c0: number, a1: number, u1: number, c1: number, mat: number) {
  const P = (a: number, u: number, c: number): V3 => add(add(add(origin, mul(f.t, a)), mul(f.n, u)), mul(f.b, c));
  const faces: Array<[V3, V3, V3, V3, V3]> = [
    [P(a0, u1, c0), P(a1, u1, c0), P(a1, u1, c1), P(a0, u1, c1), f.n],
    [P(a0, u0, c1), P(a1, u0, c1), P(a1, u0, c0), P(a0, u0, c0), mul(f.n, -1)],
    [P(a0, u0, c0), P(a1, u0, c0), P(a1, u1, c0), P(a0, u1, c0), mul(f.b, -1)],
    [P(a0, u1, c1), P(a1, u1, c1), P(a1, u0, c1), P(a0, u0, c1), f.b],
    [P(a1, u0, c0), P(a1, u0, c1), P(a1, u1, c1), P(a1, u1, c0), f.t],
    [P(a0, u0, c1), P(a0, u0, c0), P(a0, u1, c0), P(a0, u1, c1), mul(f.t, -1)],
  ];
  for (const [a, b, c, d, n] of faces) quad(out, a, b, c, d, n, n, n, n, mat);
}
/** A cylinder along a frame's up, at (along, across), radius, from u0 to u1. */
function cylinder(out: number[], f: Frame, origin: V3, along: number, across: number, radius: number, u0: number, u1: number, mat: number) {
  const S = 16;
  const base = add(add(origin, mul(f.t, along)), mul(f.b, across));
  const ring = (u: number, k: number): [V3, V3] => {
    const a = (k / S) * Math.PI * 2;
    const dir = add(mul(f.t, Math.cos(a)), mul(f.b, Math.sin(a)));
    return [add(add(base, mul(f.n, u)), mul(dir, radius)), dir];
  };
  for (let k = 0; k < S; k++) {
    const [a, na] = ring(u0, k), [b, nb] = ring(u0, k + 1), [c, nc] = ring(u1, k + 1), [d, nd] = ring(u1, k);
    quad(out, a, b, c, d, na, nb, nc, nd, mat);
    tri(out, add(base, mul(f.n, u1)), ring(u1, k)[0], ring(u1, k + 1)[0], mat);
  }
}
/** A wall as a box along a segment in the board's plane. */
function wallBox(out: number[], f: Frame, origin: V3, a: [number, number], b: [number, number], thick: number, height: number, mat: number) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const t: V3 = norm(add(mul(f.t, dx / l), mul(f.b, dy / l)));
  const bf: Frame = { p: f.p, t, n: f.n, b: norm(cross(t, f.n)) };
  const start = add(add(origin, mul(f.t, a[0])), mul(f.b, a[1]));
  box(out, bf, start, -thick, 0, -thick, l + thick, height, thick, mat);
}

/** A board: its floor (with a lip under), its side walls, a back wall, its walls, pegs and spinner axles. */
export function boardMesh(bd: Board, out: number[]) {
  const f = bd.frame;
  const half = bd.width / 2;
  const T = 0.6;
  box(out, f, f.p, 0, -T, -half - T, bd.length, 0, half + T, 0);
  box(out, f, f.p, 0, 0, half, bd.length, WALL_H, half + T, 1);
  box(out, f, f.p, 0, 0, -half - T, bd.length, WALL_H, -half, 1);
  if (bd.backWall) box(out, f, f.p, -T, 0, -half - T, 0, WALL_H, half + T, 1);
  for (const w of bd.walls) wallBox(out, f, f.p, w.a, w.b, w.thick, WALL_H * 0.8, 1);
  for (const [pa, pc, pr] of bd.pegs) cylinder(out, f, f.p, pa, pc, pr, 0, WALL_H * 0.75, 1);
  for (const sp of bd.spinners) cylinder(out, f, f.p, sp.at[0], sp.at[1], 0.8, 0, 2.6, 2);
}
/** The spinners' arms where they are now, to draw each frame. */
export function spinnerMesh(bd: Board, time: number, out: number[]) {
  const f = bd.frame;
  for (const sp of bd.spinners) {
    const th0 = time * sp.rate * Math.PI * 2;
    const axle = add(add(add(f.p, mul(f.t, sp.at[0])), mul(f.b, sp.at[1])), mul(f.n, 1.2));
    for (let k = 0; k < sp.arms; k++) {
      const th = th0 + (k * Math.PI * 2) / sp.arms;
      const t: V3 = add(mul(f.t, Math.cos(th)), mul(f.b, Math.sin(th)));
      const bf: Frame = { p: f.p, t, n: f.n, b: norm(cross(t, f.n)) };
      box(out, bf, axle, 0, -0.7, -0.7, sp.half, 0.7, 0.7, 1);
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
export function sphereMesh(out: number[], S = 24, Rr = 16) {
  const at = (i: number, j: number): V3 => {
    const th = (i / S) * Math.PI * 2, ph = (j / Rr) * Math.PI;
    return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
  };
  for (let j = 0; j < Rr; j++) for (let i = 0; i < S; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    quad(out, a, b, c, d, a, b, c, d, 2);
  }
}
/** The tower at the top: posts from the ground up to the first board. */
export function towerMesh(top: V3, groundY: number, out: number[]) {
  const f: Frame = { p: [0, 0, 0], t: [1, 0, 0], n: [0, 1, 0], b: [0, 0, 1] };
  for (const x of [-20, 20]) box(out, f, [top[0] + x, groundY, top[2] + 2], -1.5, 0, -1.5, 1.5, top[1] - groundY - 1, 1.5, 4);
}
/** The ground: a big square far below. */
export function groundMesh(centre: V3, y: number, size: number, out: number[]) {
  const n: V3 = [0, 1, 0];
  const P = (x: number, z: number): V3 => [centre[0] + x, y, centre[2] + z];
  quad(out, P(-size, -size), P(-size, size), P(size, size), P(size, -size), n, n, n, n, 3);
}
