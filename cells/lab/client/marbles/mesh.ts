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
/** a point, with its frame straight up: for things that stand or hang in the world */
const UP: Frame = { p: [0, 0, 0], t: [1, 0, 0], n: [0, 1, 0], b: [0, 0, 1] };
/** a cone (or a tapered cylinder) standing at a point: for shades and tips */
function cone(out: number[], at: V3, r0: number, r1: number, h: number, mat: number, S = 14) {
  for (let k = 0; k < S; k++) {
    const a0 = (k / S) * Math.PI * 2, a1 = ((k + 1) / S) * Math.PI * 2;
    const P = (a: number, r: number, y: number): V3 => [at[0] + Math.cos(a) * r, at[1] + y, at[2] + Math.sin(a) * r];
    const n0: V3 = norm([Math.cos(a0), (r0 - r1) / h, Math.sin(a0)]), n1: V3 = norm([Math.cos(a1), (r0 - r1) / h, Math.sin(a1)]);
    quad(out, P(a0, r0, 0), P(a1, r0, 0), P(a1, r1, h), P(a0, r1, h), n0, n1, n1, n0, mat, [a0 * r0, 0], [a1 * r0, 0], [a1 * r1, h], [a0 * r1, h]);
  }
}
/**
 * How a board is held up. Close to the floor it stands on cardboard boxes; higher, it hangs
 * from the rafters by cords at its corners (thin and dark: close by they read as a hung
 * installation, far off they vanish, as cords do).
 */
export function supportMesh(bd: Board, groundY: number, rafterY: number, r: () => number, out: number[], overhead: number[]) {
  const half = bd.width / 2;
  const ats = bd.length > 70 ? [6, bd.length / 2, bd.length - 6] : [6, bd.length - 6];
  for (const a of ats) {
    for (const s of [-1, 1]) {
      const top = toWorld(bd, a, -0.6, s * (half - 1));
      const h = top[1] - groundY;
      if (h < 70) {
        // a stack of boxes from the floor up to the board (stopping short enough below its
        // underside that no corner of a level box pokes up through the sloping floor)
        let y = groundY;
        const w = 16 + r() * 10;
        const ceiling = top[1] - 1.2 - w * 0.5 * Math.tan(Math.abs(bd.slope));
        while (y < ceiling - 1) {
          const bh = Math.min(ceiling - y, 9 + r() * 9);
          const cx = top[0] + (r() - 0.5) * 2, cz = top[2] + (r() - 0.5) * 2;
          const yaw = (r() - 0.5) * 0.3;
          const bf: Frame = { p: [0, 0, 0], t: [Math.cos(yaw), 0, Math.sin(yaw)], n: [0, 1, 0], b: [-Math.sin(yaw), 0, Math.cos(yaw)] };
          boxM(out, linear(bf, [cx, y, cz]), -w / 2, 0, -w / 2, w / 2, bh, w / 2, { top: 1, bottom: 1, side: 1, end: 7 });
          // (the tape across its top)
          boxM(out, linear(bf, [cx, y, cz]), -w / 2, bh, -1.1, w / 2, bh + 0.05, 1.1, same(8));
          y += bh;
        }
      } else {
        // a cord up to the rafters, through a small eye in the rail
        const at = toWorld(bd, a, WALL_H, s * (half + 0.3));
        box(overhead, UP, [at[0], at[1], at[2]], -0.07, 0, -0.07, 0.07, rafterY - at[1], 0.07, 1);
        cone(out, [at[0], at[1] - 0.2, at[2]], 0.5, 0.5, 0.4, 2, 8);
      }
    }
  }
}
/**
 * The rafters over the whole run: beams across it every so far, three along it, at one height
 * above the top.
 */
export function rafterMesh(bounds: { min: V3; max: V3 }, y: number, out: number[]) {
  const [x0, z0] = [bounds.min[0] - 160, bounds.min[2] - 160], [x1, z1] = [bounds.max[0] + 160, bounds.max[2] + 160];
  const f = UP;
  for (let x = x0; x <= x1; x += 150) box(out, f, [x, y, z0], -4, 0, 0, 4, 9, z1 - z0, 4);
  for (const z of [z0, z1, (z0 + z1) / 2]) box(out, f, [x0, y + 9, z], 0, 0, -5, x1 - x0, 11, 5, 4);
}
/** A pendant lamp over a board: a cord from the rafters, an enamel shade, a bulb glowing in it. */
export function lampMesh(bd: Board, rafterY: number, out: number[]) {
  const at = toWorld(bd, bd.length / 2, 0, 0);
  const y = at[1] + 70;
  box(out, UP, [at[0], y, at[2]], -0.1, 0, -0.1, 0.1, rafterY - y, 0.1, 12);
  cone(out, [at[0], y - 1, at[2]], 1.2, 1.2, 1.5, 12, 10);
  cone(out, [at[0], y - 9, at[2]], 9, 1.6, 8.5, 15, 18);
  cone(out, [at[0], y - 10.5, at[2]], 2.2, 0.6, 3.5, 16, 10);
}
/** Bunting across a board: a pencil at each side, a string between, little flags along it. */
export function buntingMesh(bd: Board, at: number, r: () => number, out: number[]) {
  const half = bd.width / 2;
  const f = frameAlong(bd, at);
  const posts: V3[] = [];
  for (const s of [-1, 1]) {
    const foot = toWorld(bd, at, WALL_H, s * (half + 0.3));
    cone(out, foot, 0.4, 0.4, 16, 18, 8);
    cone(out, [foot[0], foot[1] + 16, foot[2]], 0.4, 0.05, 1.6, 12, 8);
    posts.push([foot[0], foot[1] + 15, foot[2]]);
  }
  const d = sub(posts[1], posts[0]);
  const L = Math.hypot(d[0], d[1], d[2]);
  const n = Math.floor(L / 5);
  const hue0 = r();
  for (let i = 0; i < n; i++) {
    const t0 = (i + 0.15) / n, t1 = (i + 0.85) / n, tm = (i + 0.5) / n;
    const sag = (tt: number) => 4 * Math.sin(tt * Math.PI);
    const A = add(add(posts[0], mul(d, t0)), [0, -sag(t0), 0]), B = add(add(posts[0], mul(d, t1)), [0, -sag(t1), 0]);
    const C = add(add(posts[0], mul(d, tm)), [0, -sag(tm) - 4.5, 0]);
    const hue = (hue0 + i * 0.23) % 1;
    const nn = f.t;
    quad(out, A, B, C, C, nn, nn, nn, nn, 14, [hue, 0], [hue, 0], [hue, 1], [hue, 1]);
    quad(out, B, A, C, C, mul(nn, -1), mul(nn, -1), mul(nn, -1), mul(nn, -1), 14, [hue, 0], [hue, 0], [hue, 1], [hue, 1]);
  }
  // the string, in pieces along the sag
  for (let i = 0; i < 8; i++) {
    const t0 = i / 8, t1 = (i + 1) / 8;
    const A = add(add(posts[0], mul(d, t0)), [0, -4 * Math.sin(t0 * Math.PI), 0]), B = add(add(posts[0], mul(d, t1)), [0, -4 * Math.sin(t1 * Math.PI), 0]);
    const dir = norm(sub(B, A));
    const sf: Frame = { p: A, t: dir, n: norm(cross(dir, [0, 1, 0])), b: [0, 0, 0] };
    sf.b = norm(cross(sf.t, sf.n));
    box(out, sf, A, 0, -0.06, -0.06, Math.hypot(...sub(B, A)), 0.06, 0.06, 12);
  }
}
/** A chequered flag on a pole at the line, and a start banner's poles at the gate. */
export function flagMesh(at: V3, out: number[]) {
  cone(out, at, 0.35, 0.35, 22, 12, 8);
  const top: V3 = [at[0], at[1] + 22, at[2]];
  const f: Frame = { p: top, t: [1, 0, 0], n: [0, 0, 1], b: [0, -1, 0] };
  boxM(out, linear(f, top), 0, 0, 0, 9, 0.08, 6, same(5));
}
/**
 * What lies about on the floor under the run: offcuts of cardboard, a few boxes, a roll of
 * tape, pencils, as a workshop's floor has after a build; only where the run is low enough for
 * the floor to matter.
 */
export function litterMesh(bounds: { min: V3; max: V3 }, groundY: number, r: () => number, out: number[]) {
  const n = 60;
  for (let i = 0; i < n; i++) {
    const x = bounds.min[0] - 80 + r() * (bounds.max[0] - bounds.min[0] + 160);
    const z = bounds.min[2] - 80 + r() * (bounds.max[2] - bounds.min[2] + 160);
    const yaw = r() * Math.PI * 2;
    const f: Frame = { p: [0, 0, 0], t: [Math.cos(yaw), 0, Math.sin(yaw)], n: [0, 1, 0], b: [-Math.sin(yaw), 0, Math.cos(yaw)] };
    const k = r();
    if (k < 0.55) boxM(out, linear(f, [x, groundY, z]), 0, 0, 0, 8 + r() * 30, 0.5, 4 + r() * 16, { top: 1, bottom: 1, side: 7, end: 7 });
    else if (k < 0.75) { const w = 14 + r() * 16, h = 8 + r() * 12; boxM(out, linear(f, [x, groundY, z]), 0, 0, 0, w, h, w * (0.7 + r() * 0.5), { top: 1, bottom: 1, side: 1, end: 7 }); }
    else if (k < 0.88) cone(out, [x, groundY, z], 3.2, 3.2, 2.2, 8, 16);
    else box(out, f, [x, groundY + 0.35, z], 0, -0.35, -0.35, 17, 0.35, 0.35, 18);
  }
}
const len3 = (v: V3) => Math.hypot(v[0], v[1], v[2]);
/** The workshop floor: a big square far below. */
export function groundMesh(centre: V3, y: number, size: number, out: number[]) {
  const n: V3 = [0, 1, 0];
  const P = (x: number, z: number): V3 => [centre[0] + x, y, centre[2] + z];
  quad(out, P(-size, -size), P(-size, size), P(size, size), P(size, -size), n, n, n, n, 3, [-size, -size], [-size, size], [size, size], [size, -size]);
}
