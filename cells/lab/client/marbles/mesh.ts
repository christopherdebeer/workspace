/**
 * Marble Run: the meshes. Pure: vertex arrays (position, normal, and a material id) from the
 * track's parts: the channel swept along its frames as a trough with a lip and an outer shell,
 * a tray as a floor and walls with its pegs and bar, a bowl as a surface of revolution, a
 * sphere, the tower at the top, a ground far below.
 */
import { OPEN, add, cross, mul, norm, sub, type Bowl, type Frame, type Tray, type V3 } from './track';

/** a vertex: position, normal, material (0 the track's wood, 1 its rails, 2 metal, 3 ground, 4 tower) */
export const VSTRIDE = 7;
const WALL = 0.5;

function tri(out: number[], a: V3, b: V3, c: V3, mat: number, flip = false) {
  const n = norm(cross(sub(b, a), sub(c, a)));
  const nn = flip ? mul(n, -1) : n;
  for (const p of flip ? [a, c, b] : [a, b, c]) out.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], mat);
}
/** a quad a b c d (a ring's two rows), smooth normals given */
function quad(out: number[], a: V3, b: V3, c: V3, d: V3, na: V3, nb: V3, nc: V3, nd: V3, mat: number) {
  for (const [p, n] of [[a, na], [b, nb], [c, nc], [a, na], [c, nc], [d, nd]] as Array<[V3, V3]>) out.push(p[0], p[1], p[2], n[0], n[1], n[2], mat);
}

/** The channel: the trough's inside, its outer shell, the lips between, end caps. */
export function channelMesh(frames: Frame[], r: number, open: number, out: number[], r1?: number) {
  const S = Math.max(10, Math.round((open * 2) / 0.22));
  const rAt = (i: number) => (r1 === undefined ? r : r + (r1 - r) * (i / (frames.length - 1)));
  const inner = (f: Frame, k: number, i: number): [V3, V3] => {
    const a = -open + (2 * open * k) / S;
    // (from the bottom: -n turned toward b by a)
    const dir = add(mul(f.n, -Math.cos(a)), mul(f.b, Math.sin(a)));
    return [add(f.p, mul(dir, rAt(i))), mul(dir, -1)];
  };
  const outer = (f: Frame, k: number, i: number): [V3, V3] => {
    const a = -open + (2 * open * k) / S;
    const dir = add(mul(f.n, -Math.cos(a)), mul(f.b, Math.sin(a)));
    return [add(f.p, mul(dir, rAt(i) + WALL)), dir];
  };
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i], f1 = frames[i + 1];
    // (every other frame is enough for the shell: the mesh is long)
    for (let k = 0; k < S; k++) {
      const [a, na] = inner(f0, k, i), [b, nb] = inner(f0, k + 1, i), [c, nc] = inner(f1, k + 1, i + 1), [d, nd] = inner(f1, k, i + 1);
      quad(out, a, b, c, d, na, nb, nc, nd, 0);
      const [A, NA] = outer(f0, k, i), [B, NB] = outer(f0, k + 1, i), [C, NC] = outer(f1, k + 1, i + 1), [D, ND] = outer(f1, k, i + 1);
      quad(out, A, D, C, B, NA, ND, NC, NB, 1);
    }
    // the lips
    if (open < Math.PI - 0.01) {
      for (const k of [0, S]) {
        const [a] = inner(f0, k, i), [b] = inner(f1, k, i + 1), [A] = outer(f0, k, i), [B] = outer(f1, k, i + 1);
        const up = f0.n;
        if (k === 0) quad(out, a, A, B, b, up, up, up, up, 1);
        else quad(out, a, b, B, A, up, up, up, up, 1);
      }
    }
  }
  // end caps: rings closed
  for (const [f, flip, i] of [[frames[0], false, 0], [frames[frames.length - 1], true, frames.length - 1]] as Array<[Frame, boolean, number]>) {
    for (let k = 0; k < S; k++) {
      const [a] = inner(f, k, i), [b] = inner(f, k + 1, i), [A] = outer(f, k, i), [B] = outer(f, k + 1, i);
      tri(out, a, A, B, 1, !flip);
      tri(out, a, B, b, 1, !flip);
    }
  }
}

/** A box in a frame: from (along0, up0, across0) to (along1, up1, across1), outward normals. */
function box(out: number[], f: Frame, origin: V3, a0: number, u0: number, c0: number, a1: number, u1: number, c1: number, mat: number) {
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
function cylinder(out: number[], f: Frame, origin: V3, along: number, across: number, radius: number, u0: number, u1: number, mat: number, cap = true) {
  const S = 14;
  const base = add(add(origin, mul(f.t, along)), mul(f.b, across));
  const ring = (u: number, k: number): [V3, V3] => {
    const a = (k / S) * Math.PI * 2;
    const dir = add(mul(f.t, Math.cos(a)), mul(f.b, Math.sin(a)));
    return [add(add(base, mul(f.n, u)), mul(dir, radius)), dir];
  };
  for (let k = 0; k < S; k++) {
    const [a, na] = ring(u0, k), [b, nb] = ring(u0, k + 1), [c, nc] = ring(u1, k + 1), [d, nd] = ring(u1, k);
    quad(out, a, b, c, d, na, nb, nc, nd, mat);
    if (cap) tri(out, add(base, mul(f.n, u1)), ring(u1, k)[0], ring(u1, k + 1)[0], mat);
  }
}

/** A tray: its floor, its walls (narrowing at the far end), pegs, the bar's axle and (drawn live) the bar. */
export function trayMesh(tr: Tray, out: number[]) {
  const f = tr.frame;
  const origin = sub(f.p, mul(f.n, 2.6));
  const half = tr.width / 2;
  box(out, f, origin, 0, -WALL, -half - WALL, tr.length, 0, half + WALL, 0);
  const narrowFrom = tr.length - tr.funnelIn;
  for (const s of [1, -1]) {
    box(out, f, origin, 0, 0, s > 0 ? half : -half - WALL, narrowFrom, 10, s > 0 ? half + WALL : -half, 1);
    // (the back wall, up to the way in)
    box(out, f, origin, -WALL, 0, s > 0 ? 2.6 : -half - WALL, 0, 10, s > 0 ? half + WALL : -2.6, 1);
    // the narrowing wall: a slanted slab
    const inner0 = s * half, inner1 = s * (2.6 - 0.3);
    const P = (a: number, u: number, c: number): V3 => add(add(add(origin, mul(f.t, a)), mul(f.n, u)), mul(f.b, c));
    const nrm = norm(add(mul(f.b, -s), mul(f.t, -(half - 2.3) / tr.funnelIn)));
    const a = P(narrowFrom, 0, inner0), b = P(tr.length, 0, inner1), c = P(tr.length, 10, inner1), d = P(narrowFrom, 10, inner0);
    if (s > 0) quad(out, a, b, c, d, nrm, nrm, nrm, nrm, 1); else quad(out, a, d, c, b, nrm, nrm, nrm, nrm, 1);
    const A = P(narrowFrom, 0, inner0 + s * WALL), B = P(tr.length, 0, inner1 + s * WALL), C = P(tr.length, 10, inner1 + s * WALL), D = P(narrowFrom, 10, inner0 + s * WALL);
    const back = mul(nrm, -1);
    if (s > 0) quad(out, A, D, C, B, back, back, back, back, 1); else quad(out, A, B, C, D, back, back, back, back, 1);
    quad(out, d, c, C, D, f.n, f.n, f.n, f.n, 1);
  }
  for (const [pa, pc, pr] of tr.pegs) cylinder(out, f, origin, pa, pc, pr, 0, 4.5, 2);
  if (tr.spinner) cylinder(out, f, origin, tr.spinner.at, 0, 0.5, 0, 2.4, 2);
}
/** The spinner's bar, at its angle now: a box, to draw each frame. */
export function barMesh(tr: Tray, time: number, out: number[]) {
  const sp = tr.spinner!;
  const f = tr.frame;
  const origin = sub(f.p, mul(f.n, 2.6));
  const th = time * sp.rate * Math.PI * 2;
  const t: V3 = add(mul(f.t, Math.cos(th)), mul(f.b, Math.sin(th)));
  const bf: Frame = { p: f.p, t, n: f.n, b: norm(cross(t, f.n)) };
  const axle = add(add(origin, mul(f.t, sp.at)), mul(f.n, 1.2));
  box(out, bf, axle, -sp.half, -0.7, -0.7, sp.half, 0.7, 0.7, 2);
}

/** A bowl: the cone from its hole (or apex) to the rim, the rim's wall, a lip. */
export function bowlMesh(b: Bowl, out: number[]) {
  const S = 40, RINGS = 8;
  const k = b.radius / b.height;
  const at = (ring: number, s: number): [V3, V3] => {
    const y = (ring / RINGS) * b.height;
    const rho = Math.max(b.hole, y * k);
    const a = (s / S) * Math.PI * 2;
    const sq = Math.sqrt(1 + k * k);
    return [add(b.centre, [Math.cos(a) * rho, y, Math.sin(a) * rho]), [(-Math.cos(a)) / sq, k / sq, (-Math.sin(a)) / sq]];
  };
  for (let ring = 0; ring < RINGS; ring++) for (let s = 0; s < S; s++) {
    const [a, na] = at(ring, s), [bb, nb] = at(ring, s + 1), [c, nc] = at(ring + 1, s + 1), [d, nd] = at(ring + 1, s);
    quad(out, a, d, c, bb, na, nd, nc, nb, 0);
    // (underneath, its shell)
    const dn = (n: V3): V3 => mul(n, -1);
    const off = (p: V3, n: V3): V3 => sub(p, mul(n, WALL));
    quad(out, off(a, na), off(bb, nb), off(c, nc), off(d, nd), dn(na), dn(nb), dn(nc), dn(nd), 1);
  }
  // the rim wall
  for (let s = 0; s < S; s++) {
    const a0 = (s / S) * Math.PI * 2, a1 = ((s + 1) / S) * Math.PI * 2;
    const P = (a: number, y: number, r: number): V3 => add(b.centre, [Math.cos(a) * r, y, Math.sin(a) * r]);
    const n0: V3 = [-Math.cos(a0), 0, -Math.sin(a0)], n1: V3 = [-Math.cos(a1), 0, -Math.sin(a1)];
    // (a tall rim: a marble that comes in fast rides the wall round and spirals down)
    const H = b.hole > 0 ? 14 : 5;
    quad(out, P(a0, b.height, b.radius), P(a0, b.height + H, b.radius), P(a1, b.height + H, b.radius), P(a1, b.height, b.radius), n0, n0, n1, n1, 1);
    quad(out, P(a0, b.height, b.radius + WALL), P(a1, b.height, b.radius + WALL), P(a1, b.height + H, b.radius + WALL), P(a0, b.height + H, b.radius + WALL), mul(n0, -1), mul(n1, -1), mul(n1, -1), mul(n0, -1), 1);
    const up: V3 = [0, 1, 0];
    quad(out, P(a0, b.height + H, b.radius), P(a0, b.height + H, b.radius + WALL), P(a1, b.height + H, b.radius + WALL), P(a1, b.height + H, b.radius), up, up, up, up, 1);
  }
  if (b.hole === 0) {
    // (a cup: closed at the bottom)
    const S2 = 20;
    for (let s = 0; s < S2; s++) {
      const a0 = (s / S2) * Math.PI * 2, a1 = ((s + 1) / S2) * Math.PI * 2;
      tri(out, b.centre, add(b.centre, [Math.cos(a1) * 0.6, 0.12, Math.sin(a1) * 0.6]), add(b.centre, [Math.cos(a0) * 0.6, 0.12, Math.sin(a0) * 0.6]), 0);
    }
  }
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

/** The tower at the top: a post from the ground up to the start, a little platform. */
export function towerMesh(top: V3, groundY: number, out: number[]) {
  const f: Frame = { p: [0, 0, 0], t: [1, 0, 0], n: [0, 1, 0], b: [0, 0, 1] };
  const base: V3 = [top[0], groundY, top[2] - 6];
  box(out, f, base, -2.2, 0, -2.2, 2.2, top[1] - groundY - 4, 2.2, 4);
  box(out, f, [top[0], top[1] - 4.6, top[2]], -6, 0, -8, 6, 1, 4, 4);
}
/** The ground: a big square far below, and the sea beyond. */
export function groundMesh(centre: V3, y: number, size: number, out: number[]) {
  const n: V3 = [0, 1, 0];
  const P = (x: number, z: number): V3 => [centre[0] + x, y, centre[2] + z];
  quad(out, P(-size, -size), P(-size, size), P(size, size), P(size, -size), n, n, n, n, 3);
}
export { OPEN };
