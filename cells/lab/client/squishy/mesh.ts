/**
 * Squishy: the meshes. Pure: vertex arrays (position, normal, material, and a texture coordinate
 * in the piece's own terms) for the course's things: stacks of bamboo steamers, tins, jars, a
 * chopping board, plates, a pudding, a lazy Susan, chopsticks; a unit sphere and a flat disc.
 */
import { MAT, dustMat, type Level, type Shape, type Tower, type V3 } from './level';
import { bookFaces, slotOf } from './books';
import { potSide, type HoneyRim } from './honey';

/** a vertex: position, normal, material, (u, v) */
export const VSTRIDE = 9;
type UV = [number, number];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function push(out: number[], p: V3, n: V3, mat: number, uv: UV) { out.push(p[0], p[1], p[2], n[0], n[1], n[2], mat, uv[0], uv[1]); }
export function quad(out: number[], a: V3, b: V3, c: V3, d: V3, na: V3, nb: V3, nc: V3, nd: V3, mat: number, ua: UV, ub: UV, uc: UV, ud: UV) {
  push(out, a, na, mat, ua); push(out, b, nb, mat, ub); push(out, c, nc, mat, uc);
  push(out, a, na, mat, ua); push(out, c, nc, mat, uc); push(out, d, nd, mat, ud);
}
/** Rolled edges catch the window light; kept within the existing collision silhouette. */
function rolledRim(out: number[], x: number, y: number, z: number, radius: number, tube: number, mat: number) {
  const segments = 48, sides = 6;
  const vertex = (a: number, b: number): { p: V3; n: V3; uv: UV } => {
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    return { p: [x + ca * (radius + tube * cb), y + tube * sb, z + sa * (radius + tube * cb)],
      n: [ca * cb, sb, sa * cb], uv: [ca, sa] };
  };
  for (let i = 0; i < segments; i++) for (let j = 0; j < sides; j++) {
    const a = i * Math.PI * 2 / segments, b = j * Math.PI * 2 / sides;
    const a1 = (i + 1) * Math.PI * 2 / segments, b1 = (j + 1) * Math.PI * 2 / sides;
    const A = vertex(a, b), B = vertex(a, b1), C = vertex(a1, b1), D = vertex(a1, b);
    quad(out, A.p, B.p, C.p, D.p, A.n, B.n, C.n, D.n, mat, A.uv, B.uv, C.uv, D.uv);
  }
}
/**
 * An upright cylinder from y0 to y1: its side (u round it in cm, v up in cm), and its top as a
 * disc (u, v: across it, -1 to 1, so a pattern can know its rim).
 */
export function cylinder(out: number[], x: number, z: number, r: number, y0: number, y1: number, mat: number, topMat = mat, segs = 40, top = true, r1 = r) {
  for (let k = 0; k < segs; k++) {
    const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const slope = (r - r1) / (y1 - y0 || 1);
    const n0 = norm([c0, slope, s0]), n1 = norm([c1, slope, s1]);
    quad(out, [x + c0 * r, y0, z + s0 * r], [x + c0 * r1, y1, z + s0 * r1], [x + c1 * r1, y1, z + s1 * r1], [x + c1 * r, y0, z + s1 * r], n0, n0, n1, n1, mat,
      [a0 * r, y0], [a0 * r, y1], [a1 * r, y1], [a1 * r, y0]);
    if (top) {
      const up: V3 = [0, 1, 0];
      push(out, [x, y1, z], up, topMat, [0, 0]);
      push(out, [x + c1 * r1, y1, z + s1 * r1], up, topMat, [c1, s1]);
      push(out, [x + c0 * r1, y1, z + s0 * r1], up, topMat, [c0, s0]);
    }
  }
}
/**
 * A box, turned about the vertical: each face's (u, v) in cm along it. Its top in cells this size, if
 * given (a counter's, a table's: so what's baked into it, the dark round what stands on it, has vertices to be in).
 */
export function box(out: number[], c: V3, h: V3, yaw: number, mat: number, cell = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const W = (x: number, y: number, z: number): V3 => [c[0] + cy * x + sy * z, c[1] + y, c[2] - sy * x + cy * z];
  const N = (x: number, y: number, z: number): V3 => [cy * x + sy * z, y, -sy * x + cy * z];
  const [hx, hy, hz] = h;
  if (cell > 0) {
    const nx = Math.max(1, Math.round((2 * hx) / cell)), nz = Math.max(1, Math.round((2 * hz) / cell)), up = N(0, 1, 0);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x0 = -hx + (2 * hx * i) / nx, x1 = -hx + (2 * hx * (i + 1)) / nx, z0 = -hz + (2 * hz * j) / nz, z1 = -hz + (2 * hz * (j + 1)) / nz;
      quad(out, W(x0, hy, z0), W(x0, hy, z1), W(x1, hy, z1), W(x1, hy, z0), up, up, up, up, mat, [x0, z0], [x0, z1], [x1, z1], [x1, z0]);
    }
  } else quad(out, W(-hx, hy, -hz), W(-hx, hy, hz), W(hx, hy, hz), W(hx, hy, -hz), N(0, 1, 0), N(0, 1, 0), N(0, 1, 0), N(0, 1, 0), mat, [-hx, -hz], [-hx, hz], [hx, hz], [hx, -hz]);
  quad(out, W(-hx, -hy, hz), W(-hx, -hy, -hz), W(hx, -hy, -hz), W(hx, -hy, hz), N(0, -1, 0), N(0, -1, 0), N(0, -1, 0), N(0, -1, 0), mat, [-hx, hz], [-hx, -hz], [hx, -hz], [hx, hz]);
  quad(out, W(-hx, -hy, -hz), W(-hx, hy, -hz), W(hx, hy, -hz), W(hx, -hy, -hz), N(0, 0, -1), N(0, 0, -1), N(0, 0, -1), N(0, 0, -1), mat, [-hx, -hy], [-hx, hy], [hx, hy], [hx, -hy]);
  quad(out, W(hx, -hy, hz), W(hx, hy, hz), W(-hx, hy, hz), W(-hx, -hy, hz), N(0, 0, 1), N(0, 0, 1), N(0, 0, 1), N(0, 0, 1), mat, [hx, -hy], [hx, hy], [-hx, hy], [-hx, -hy]);
  quad(out, W(hx, -hy, -hz), W(hx, hy, -hz), W(hx, hy, hz), W(hx, -hy, hz), N(1, 0, 0), N(1, 0, 0), N(1, 0, 0), N(1, 0, 0), mat, [-hz, -hy], [-hz, hy], [hz, hy], [hz, -hy]);
  quad(out, W(-hx, -hy, hz), W(-hx, hy, hz), W(-hx, hy, -hz), W(-hx, -hy, -hz), N(-1, 0, 0), N(-1, 0, 0), N(-1, 0, 0), N(-1, 0, 0), mat, [hz, -hy], [hz, hy], [-hz, hy], [-hz, -hy]);
}
/** Home's serviette: its top drawn with its own -1–1 across, so its printed border sits at its edge whatever its size; thin sides. */
function serviette(out: number[], s: Shape) {
  const [hx, hy, hz] = s.h, cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
  const W = (x: number, y: number, z: number): V3 => [s.c[0] + cy * x + sy * z, s.c[1] + y, s.c[2] - sy * x + cy * z];
  quad(out, W(-hx, hy, -hz), W(-hx, hy, hz), W(hx, hy, hz), W(hx, hy, -hz), [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0], MAT.napkin, [-1, -1], [-1, 1], [1, 1], [1, -1]);
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n: V3 = [cy * ax + sy * az, 0, -sy * ax + cy * az], ex = ax ? 0 : hx, ez = az ? 0 : hz, ox = ax * hx, oz = az * hz;
    quad(out, W(ox - ex, -hy, oz - ez), W(ox - ex, hy, oz - ez), W(ox + ex, hy, oz + ez), W(ox + ex, -hy, oz + ez), n, n, n, n, MAT.napkin, [2, 2], [2, 2], [2, 2], [2, 2]);
  }
}
/** A capsule from a to b: (u along it, 0–1; v round it). */
export function capsule(out: number[], a: V3, b: V3, r: number, mat: number, segs = 12, rings = 6) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  // (no length at all, a ball: a bubble; any axis will do)
  const t: V3 = L > 1e-6 ? norm(d as V3) : [0, 1, 0];
  const ref: V3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm([t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]]);
  const w: V3 = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
  // (a sphere cut at its equator and pulled apart: a's half from its pole to the equator, then
  // b's from the equator to its pole; the band between the two equators is the shaft)
  const at = (ring: number, k: number): [V3, V3, UV] => {
    const half = ring <= rings ? 0 : 1;
    const phi = (half ? (ring - rings - 1) / rings : ring / rings - 1) * Math.PI / 2;
    const th = (k / segs) * Math.PI * 2;
    const n: V3 = [t[0] * Math.sin(phi) + (u[0] * Math.cos(th) + w[0] * Math.sin(th)) * Math.cos(phi), t[1] * Math.sin(phi) + (u[1] * Math.cos(th) + w[1] * Math.sin(th)) * Math.cos(phi), t[2] * Math.sin(phi) + (u[2] * Math.cos(th) + w[2] * Math.sin(th)) * Math.cos(phi)];
    const o = half ? b : a;
    const p: V3 = [o[0] + n[0] * r, o[1] + n[1] * r, o[2] + n[2] * r];
    const along = L > 1e-6 ? ((p[0] - a[0]) * t[0] + (p[1] - a[1]) * t[1] + (p[2] - a[2]) * t[2]) / L : 0;
    return [p, n, [along, th]];
  };
  for (let ring = 0; ring < rings * 2 + 1; ring++) for (let k = 0; k < segs; k++) {
    const [p0, n0, u0] = at(ring, k), [p1, n1, u1] = at(ring, k + 1), [p2, n2, u2] = at(ring + 1, k + 1), [p3, n3, u3] = at(ring + 1, k);
    quad(out, p0, p3, p2, p1, n0, n3, n2, n1, mat, u0, u3, u2, u1);
  }
}
/** A unit sphere about the origin. */
export function sphere(out: number[], mat: number, segs = 14, rings = 9) {
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const P = (ii: number, jj: number): V3 => { const th = (ii / segs) * Math.PI * 2, ph = (jj / rings) * Math.PI; return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]; };
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    quad(out, a, b, c, d, a, b, c, d, mat, [0, 0], [0, 0], [0, 0], [0, 0]);
  }
}
/** A flat disc about the origin, a unit across, in x–z: its (u, v) its place on it. */
export function disc(out: number[], mat: number, segs = 28) {
  const up: V3 = [0, 1, 0];
  for (let k = 0; k < segs; k++) {
    const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
    push(out, [0, 0, 0], up, mat, [0, 0]);
    push(out, [Math.cos(a1), 0, Math.sin(a1)], up, mat, [Math.cos(a1), Math.sin(a1)]);
    push(out, [Math.cos(a0), 0, Math.sin(a0)], up, mat, [Math.cos(a0), Math.sin(a0)]);
  }
}

/** What's drawn: the solid course; the glass, drawn after it and seen through; and each thing that moves, on its own, about its rest place. */
export interface LevelMesh { solid: number[]; glass: number[]; liquids: number[]; honeyRims: HoneyRim[]; honeyBodies: Array<{ verts: number[]; center: V3; radius: number; bottom: number; top: number }>; movers: Array<{ shape: Shape; verts: number[] }>; bubbles: Array<{ shape: Shape; verts: number[] }> }
/**
 * One tower, as it's made: a stack of steamers with their rims, a tin, jars and a board, a plate,
 * a pudding on a saucer, a lazy Susan; a butter dish, a honey jar (glass, the honey in it, the
 * honey down its side), a pot and its lid, a pan with its rim; and on the stove, its burner.
 */
function towerMesh(t: Tower, m: LevelMesh) {
  const out = m.solid;
  const [x, , z] = t.at;
  if (t.burner) cylinder(out, t.shapes[0].c[0], t.shapes[0].c[2], t.burner, 0, 0.5, MAT.burner, MAT.burner, 36);
  for (const s of t.shapes) {
    if (s.lift) { const v: number[] = []; drawShape(s, v); m.movers.push({ shape: s, verts: v }); continue; }
    // (a soap bubble: on its own, drawn clear after everything, gone when it pops)
    if (s.mat === MAT.bubble) { const v: number[] = []; drawShape(s, v); m.bubbles.push({ shape: s, verts: v }); continue; }
    if (s.mat === MAT.glass) {
      // (a jar: the honey in it, most of the way up, then the glass over everything)
      // (the honey in it drawn apart from the course, over what's behind it, as thick as the jar is where it's seen through)
      const fillR = s.r * .93, fillBottom = s.c[1] - s.hh, fillTop = s.c[1] + s.hh * .55, verts: number[] = [];
      cylinder(verts, s.c[0], s.c[2], fillR, fillBottom, fillTop, MAT.honey, MAT.honey, 48);
      m.honeyBodies.push({ verts, center: [s.c[0], s.c[1], s.c[2]], radius: fillR, bottom: fillBottom, top: fillTop });
      cylinder(m.glass, s.c[0], s.c[2], s.r, s.c[1] - s.hh, s.c[1] + s.hh, MAT.glass, MAT.glass, 40);
      // (honey run over its rim and down its side: real shapes, live, rebuilt as the level goes on (honey.ts))
      if (t.jar) {
        const r = s.r;
        m.honeyRims.push({ c: [s.c[0], s.c[1] - s.hh, s.c[2]], top: s.c[1] + s.hh, foot: s.c[1] - s.hh, side: () => r, front: Math.atan2(t.at[2] - s.c[2], t.at[0] - s.c[0]), seed: Math.round(s.c[0] * 10 + s.c[2]) });
      }
      continue;
    }
    // (a honey pot: bellied stoneware turned on a wheel, its lip rolled; honey in its neck, and run over its rim)
    if (s.mat === MAT.honeypot) {
      const y0 = s.c[1] - s.hh, y1 = s.c[1] + s.hh, side = potSide(s.r, y0, y1), N = 28;
      for (let i = 0; i < N; i++) {
        const ya = y0 + ((y1 - y0) * i) / N, yb = y0 + ((y1 - y0) * (i + 1)) / N;
        cylinder(out, s.c[0], s.c[2], side(ya), ya, yb, MAT.honeypot, MAT.honeypot, 48, false, side(yb));
      }
      rolledRim(out, s.c[0], y1, s.c[2], side(y1), 0.45, MAT.honeypot);
      // (the honey standing in its neck, under the cork)
      cylinder(m.liquids, s.c[0], s.c[2], side(y1) - 0.3, y1 - 1.2, y1 - 0.5, MAT.honeyDrip, MAT.honeyDrip, 40);
      if (t.jar) m.honeyRims.push({ c: [s.c[0], y0, s.c[2]], top: y1, foot: y0, side, lip: 0.5, front: Math.atan2(t.at[2] - s.c[2], t.at[0] - s.c[0]), seed: Math.round(s.c[0] * 10 + s.c[2]) });
      continue;
    }
    // (a pot's cork, askew: drawn from the same triangles it's met as)
    if (s.cork) {
      const { tris, norms } = s.cork;
      for (let i = 0; i < tris.length; i += 3) out.push(tris[i], tris[i + 1], tris[i + 2], norms[i], norms[i + 1], norms[i + 2], MAT.cork, tris[i] * 0.5, tris[i + 2] * 0.5);
      continue;
    }
    // (the honey pooled round a jar's foot: a ring on the stand, drawn as a liquid that spreads as the level goes on
    // (main.ts, MAT.honeyPool); u out from the glass in cm, v the angle from its front)
    if (s.mat === MAT.honey && t.jar) {
      const glass = t.shapes.find((g) => g.mat === MAT.glass || g.mat === MAT.honeypot);
      if (glass) {
        // (round a pot, from its narrower foot)
        const foot0 = glass.mat === MAT.honeypot ? potSide(glass.r, glass.c[1] - glass.hh, glass.c[1] + glass.hh)(glass.c[1] - glass.hh) : glass.r;
        const th0 = Math.atan2(t.at[2] - glass.c[2], t.at[0] - glass.c[0]), y = glass.c[1] - glass.hh + 0.08, NA = 64, NR = 6;
        const at = (i: number, j: number): [V3, V3, UV] => {
          const th = th0 + (i / NA * 2 - 1) * Math.PI, t = j / NR, out2 = -0.4 + t * 1.9, rr = foot0 + out2;
          // Shallow raised pool; expanding leading edge stays procedural.
          const swell = .025 + .17 * (1 - (2 * t - 1) ** 4);
          const slope = (-.17 * 8 * (2 * t - 1) ** 3) / 1.9;
          const c = Math.cos(th), sn = Math.sin(th);
          return [[glass.c[0] + c * rr, y + swell, glass.c[2] + sn * rr],
            norm([-c * slope, 1, -sn * slope]), [out2, (i / NA * 2 - 1) * Math.PI]];
        };
        for (let i = 0; i < NA; i++) for (let j = 0; j < NR; j++) {
          const A = at(i, j), B = at(i + 1, j), C = at(i + 1, j + 1), D = at(i, j + 1);
          quad(m.liquids, A[0], B[0], C[0], D[0], A[1], B[1], C[1], D[1], MAT.honeyPool, A[2], B[2], C[2], D[2]);
        }
        continue;
      }
    }
    drawShape(s, out);
  }
  void x; void z;
}
/** What's on a top (flour, crumbs, pepper, sprinkles): drawn as a skin just over it, in its own material. */
function dustOn(s: Shape, out: number[]) {
  if (!s.dust || s.mat === MAT.butter) return;
  const mat = dustMat(s.dust);
  if (s.kind === 'box') {
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const W = (x: number, z: number): V3 => [s.c[0] + cy * x + sy * z, s.c[1] + s.h[1] + 0.06, s.c[2] - sy * x + cy * z];
    const [hx, , hz] = s.h;
    quad(out, W(-hx, -hz), W(-hx, hz), W(hx, hz), W(hx, -hz), [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0], mat, [-hx, -hz], [-hx, hz], [hx, hz], [hx, -hz]);
  } else if (s.kind === 'cyl') {
    const y = s.c[1] + s.hh + 0.06, r = s.r * (s.mat === MAT.jelly ? 0.9 : 1);
    for (let k = 0; k < 40; k++) {
      const a0 = (k / 40) * Math.PI * 2, a1 = ((k + 1) / 40) * Math.PI * 2;
      push(out, [s.c[0], y, s.c[2]], [0, 1, 0], mat, [0, 0]);
      push(out, [s.c[0] + Math.cos(a1) * r, y, s.c[2] + Math.sin(a1) * r], [0, 1, 0], mat, [Math.cos(a1), Math.sin(a1)]);
      push(out, [s.c[0] + Math.cos(a0) * r, y, s.c[2] + Math.sin(a0) * r], [0, 1, 0], mat, [Math.cos(a0), Math.sin(a0)]);
    }
  }
}
/**
 * A cookbook lying flat (a box of book): its cover up, its spine out to one side or another, which
 * book it is by where it is.
 */
function bookBox(out: number[], s: Shape) {
  const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), X: V3 = [cy, 0, -sy], Z: V3 = [sy, 0, cy], [hx, hy, hz] = s.h;
  const slot = slotOf(s.c[0], s.c[1], s.c[2]), k = s.spine ?? slot % 4;
  const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
  // (its spine on side k; its head the way that puts its cover up)
  const [S, Hd, w, h] = k === 0 ? [X, Z, hx, hz] : k === 1 ? [neg(X), neg(Z), hx, hz] : k === 2 ? [Z, neg(X), hz, hx] : [neg(Z), X, hz, hx];
  book(out, slot, s.c, S, Hd, hy, w, h);
}
/** A cookbook (books.ts): which one, its middle, its spine's way out and its head's, half its thickness, width and height. */
export function book(out: number[], slot: number, c: V3, S: V3, Hd: V3, t: number, w: number, h: number) {
  // (drawn a hair thinner than it is, half a millimetre a side: so its covers aren't in the same plane as the book it
  // lies on, the table under it, or what's laid on it, which, where a stack's screened before the dumpling, would show
  // flickering one through the other)
  bookFaces((p, n, mat, uv) => push(out, p, n, mat, uv), MAT.book, slot, c, S, Hd, t - Math.min(0.05, t * 0.1), w, h);
}
/** Shapes as they draw themselves (the sets' free things: a bench, a pad, a board), into out. */
export function drawShapes(shapes: Shape[], out: number[]) { for (const s of shapes) drawShape(s, out); }
function drawShape(s: Shape, out: number[]) {
  // (a sheet is drawn by its prop, which made it; a jelly, each frame, as its top is)
  if (s.kind === 'sheet' || s.kind === 'jelly' || s.ghost) return;
  dustOn(s, out);
  {
    if (s.mat === MAT.napkin) { serviette(out, s); return; }
    if (s.mat === MAT.book && s.kind === 'box') { bookBox(out, s); return; }
    // (a counter's or a table's top, in cells: so the dark round what stands on it can be baked into it)
    if (s.kind === 'box') { box(out, s.c, s.h, s.yaw, s.mat, (s.mat === MAT.counter || s.mat === MAT.hob) && s.h[0] * s.h[2] > 400 ? 3 : 0); return; }
    if (s.kind === 'cap') { capsule(out, s.c, s.b, s.r, s.mat, 12, 4); return; }
    const y0 = s.c[1] - s.hh, y1 = s.c[1] + s.hh;
    const sx = s.c[0], sz = s.c[2];
    switch (s.mat) {
      case MAT.bamboo:
      case MAT.gold: {
        // steamers, one on another: each a basket 7 deep with a rim that stands proud; the lid woven
        const n = Math.max(1, Math.round((y1 - y0) / 7));
        const step = (y1 - y0) / n;
        for (let i = 0; i < n; i++) {
          const a = y0 + i * step, b = a + step;
          cylinder(out, sx, sz, s.r, a, b, MAT.bamboo, MAT.weave, 40, i === n - 1);
          // (the rim at its top: a band of split bamboo, a little proud; gold for home)
          cylinder(out, sx, sz, s.r + 0.35, b - 1.4, b, s.mat === MAT.gold && i === n - 1 ? MAT.gold : MAT.bamboo, MAT.bamboo, 40, false);
        }
        rolledRim(out, sx, y1 - .08, sz, s.r + .12, .20, s.mat === MAT.gold ? MAT.gold : MAT.bamboo);
        break;
      }
      case MAT.porcelain: {
        cylinder(out, sx, sz, s.r * 0.86, y0, y0 + s.hh * 0.6, MAT.porcelain, MAT.porcelain, 40, false, s.r);
        cylinder(out, sx, sz, s.r, y0 + s.hh * 0.6, y1, MAT.porcelain, MAT.porcelain, 48);
        rolledRim(out, sx, y1 - .08, sz, s.r - .14, .16, MAT.porcelain);
        break;
      }
      case MAT.jelly:
        // a pudding: a little narrower at the top, a caramel top
        cylinder(out, sx, sz, s.r, y0, y1, MAT.jelly, MAT.jelly, 40, true, s.r * 0.9);
        break;
      case MAT.tin: {
        // (each tin its own printing: which of the colourways, from where it stands, carried in its v as thousands)
        const from = out.length;
        cylinder(out, sx, sz, s.r, y0, y1, MAT.tin, MAT.tin, 36);
        const way = Math.abs(Math.round(sx * 7.31 + sz * 3.17 + s.r * 11.3)) % 4;
        for (let i = from; i < out.length; i += VSTRIDE) if (out[i + 6] === MAT.tin) out[i + 8] += way * 1000;
        // (a lid that stands proud at the top)
        cylinder(out, sx, sz, s.r + 0.25, y1 - 1.6, y1 + 0.05, MAT.gold, MAT.tin, 48);
        rolledRim(out, sx, y1 - .05, sz, s.r + .10, .14, MAT.gold);
        break;
      }
      case MAT.jar:
        cylinder(out, sx, sz, s.r, y0, y1 - 1.6, MAT.jar, MAT.jar, 32, false);
        cylinder(out, sx, sz, s.r * 0.82, y1 - 1.6, y1, MAT.board, MAT.board, 32);
        break;
      case MAT.pot:
        // enamel, a little narrower at the foot, a rolled rim
        if (s.hh > 2) {
          cylinder(out, sx, sz, s.r, y0, y1, MAT.pot, MAT.pot, 40, true, s.r * 0.96);
          cylinder(out, sx, sz, s.r + 0.3, y1 - 0.9, y1, MAT.pot, MAT.pot, 40, false);
        } else {
          // (a lid: a shallow dome, as a disc lifted a little toward its middle; its rim)
          cylinder(out, sx, sz, s.r, y0, y1 - 0.4, MAT.pot, MAT.pot, 40, false);
          cylinder(out, sx, sz, s.r, y1 - 0.4, y1 + 0.5, MAT.pot, MAT.pot, 40, true, s.r * 0.75);
        }
        break;
      case MAT.pan:
        cylinder(out, sx, sz, s.r, y0, y1, MAT.pan, MAT.pan, 44);
        break;
      default:
        cylinder(out, sx, sz, s.r, y0, y1, s.mat, s.mat, 44);
    }
  }
}
/** The whole course: every tower, and the chopsticks. */
export function levelMesh(lv: Level): LevelMesh {
  const m: LevelMesh = { solid: [], glass: [], liquids: [], honeyRims: [], honeyBodies: [], movers: [], bubbles: [] };
  // Keep butter films out of the opaque baked course; they transmit its surface.
  for (let i = 0; i < lv.decor.length; i += VSTRIDE) {
    const dest = Math.round(lv.decor[i + 6]) === MAT.smear ? m.liquids : m.solid;
    for (let k = 0; k < VSTRIDE; k++) dest.push(lv.decor[i + k]);
  }
  for (const t of lv.towers) towerMesh(t, m);
  for (const s of lv.sticks) stick(s, m.solid);
  return m;
}
/** A chopstick: a long capsule, thicker at its back end. */
function stick(s: Shape, out: number[]) { capsule(out, s.c, s.b, s.r, MAT.chopstick, 10, 3); }

