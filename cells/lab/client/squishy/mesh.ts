/**
 * Squishy: the meshes. Pure: vertex arrays (position, normal, material, and a texture coordinate
 * in the piece's own terms) for the course's things: stacks of bamboo steamers, tins, jars, a
 * chopping board, plates, a pudding, a lazy Susan, chopsticks; a unit sphere and a flat disc.
 */
import { MAT, type Level, type Shape, type Tower, type V3 } from './level';

/** a vertex: position, normal, material, (u, v) */
export const VSTRIDE = 9;
type UV = [number, number];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function push(out: number[], p: V3, n: V3, mat: number, uv: UV) { out.push(p[0], p[1], p[2], n[0], n[1], n[2], mat, uv[0], uv[1]); }
function quad(out: number[], a: V3, b: V3, c: V3, d: V3, na: V3, nb: V3, nc: V3, nd: V3, mat: number, ua: UV, ub: UV, uc: UV, ud: UV) {
  push(out, a, na, mat, ua); push(out, b, nb, mat, ub); push(out, c, nc, mat, uc);
  push(out, a, na, mat, ua); push(out, c, nc, mat, uc); push(out, d, nd, mat, ud);
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
/** A box, turned about the vertical: each face's (u, v) in cm along it. */
export function box(out: number[], c: V3, h: V3, yaw: number, mat: number) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const W = (x: number, y: number, z: number): V3 => [c[0] + cy * x + sy * z, c[1] + y, c[2] - sy * x + cy * z];
  const N = (x: number, y: number, z: number): V3 => [cy * x + sy * z, y, -sy * x + cy * z];
  const [hx, hy, hz] = h;
  quad(out, W(-hx, hy, -hz), W(-hx, hy, hz), W(hx, hy, hz), W(hx, hy, -hz), N(0, 1, 0), N(0, 1, 0), N(0, 1, 0), N(0, 1, 0), mat, [-hx, -hz], [-hx, hz], [hx, hz], [hx, -hz]);
  quad(out, W(-hx, -hy, hz), W(-hx, -hy, -hz), W(hx, -hy, -hz), W(hx, -hy, hz), N(0, -1, 0), N(0, -1, 0), N(0, -1, 0), N(0, -1, 0), mat, [-hx, hz], [-hx, -hz], [hx, -hz], [hx, hz]);
  quad(out, W(-hx, -hy, -hz), W(-hx, hy, -hz), W(hx, hy, -hz), W(hx, -hy, -hz), N(0, 0, -1), N(0, 0, -1), N(0, 0, -1), N(0, 0, -1), mat, [-hx, -hy], [-hx, hy], [hx, hy], [hx, -hy]);
  quad(out, W(hx, -hy, hz), W(hx, hy, hz), W(-hx, hy, hz), W(-hx, -hy, hz), N(0, 0, 1), N(0, 0, 1), N(0, 0, 1), N(0, 0, 1), mat, [hx, -hy], [hx, hy], [-hx, hy], [-hx, -hy]);
  quad(out, W(hx, -hy, -hz), W(hx, hy, -hz), W(hx, hy, hz), W(hx, -hy, hz), N(1, 0, 0), N(1, 0, 0), N(1, 0, 0), N(1, 0, 0), mat, [-hz, -hy], [-hz, hy], [hz, hy], [hz, -hy]);
  quad(out, W(-hx, -hy, hz), W(-hx, hy, hz), W(-hx, hy, -hz), W(-hx, -hy, -hz), N(-1, 0, 0), N(-1, 0, 0), N(-1, 0, 0), N(-1, 0, 0), mat, [hz, -hy], [hz, hy], [-hz, hy], [-hz, -hy]);
}
/** A capsule from a to b: (u along it, 0–1; v round it). */
export function capsule(out: number[], a: V3, b: V3, r: number, mat: number, segs = 12, rings = 6) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  const t = norm(d as V3);
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
    const along = ((p[0] - a[0]) * t[0] + (p[1] - a[1]) * t[1] + (p[2] - a[2]) * t[2]) / L;
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
export interface LevelMesh { solid: number[]; glass: number[]; movers: Array<{ shape: Shape; verts: number[] }> }
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
    if (s.mat === MAT.glass) {
      // (a jar: the honey in it, most of the way up, then the glass over everything)
      cylinder(out, s.c[0], s.c[2], s.r * 0.93, s.c[1] - s.hh, s.c[1] + s.hh * 0.55, MAT.honey, MAT.honey, 36);
      cylinder(m.glass, s.c[0], s.c[2], s.r, s.c[1] - s.hh, s.c[1] + s.hh, MAT.glass, MAT.glass, 40);
      continue;
    }
    drawShape(s, out);
  }
  void x; void z;
}
/** What's on a top (flour, crumbs, pepper, sprinkles): drawn as a skin just over it, in its own material. */
function dustOn(s: Shape, out: number[]) {
  if (!s.dust || s.mat === MAT.butter) return;
  const mat = 24 + s.dust;
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
function drawShape(s: Shape, out: number[]) {
  dustOn(s, out);
  {
    if (s.kind === 'box') { box(out, s.c, s.h, s.yaw, s.mat); return; }
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
        break;
      }
      case MAT.porcelain: {
        cylinder(out, sx, sz, s.r * 0.86, y0, y0 + s.hh * 0.6, MAT.porcelain, MAT.porcelain, 40, false, s.r);
        cylinder(out, sx, sz, s.r, y0 + s.hh * 0.6, y1, MAT.porcelain, MAT.porcelain, 48);
        break;
      }
      case MAT.jelly:
        // a pudding: a little narrower at the top, a caramel top
        cylinder(out, sx, sz, s.r, y0, y1, MAT.jelly, MAT.jelly, 40, true, s.r * 0.9);
        break;
      case MAT.tin:
        cylinder(out, sx, sz, s.r, y0, y1, MAT.tin, MAT.tin, 36);
        // (a lid that stands proud at the top)
        cylinder(out, sx, sz, s.r + 0.25, y1 - 1.6, y1 + 0.05, MAT.gold, MAT.tin, 36);
        break;
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
  const m: LevelMesh = { solid: [], glass: [], movers: [] };
  for (const t of lv.towers) towerMesh(t, m);
  for (const s of lv.sticks) stick(s, m.solid);
  return m;
}
/** A chopstick: a long capsule, thicker at its back end. */
function stick(s: Shape, out: number[]) { capsule(out, s.c, s.b, s.r, MAT.chopstick, 10, 3); }
