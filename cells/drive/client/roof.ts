import * as THREE from 'three';
import { clamp } from './num';

/**
 * ── THE ROOF, OUT OF MAIN.TS SO A LAB CAN PUT ONE ON A BUILDING ──
 *
 * roofGeo is pure — a ring, a shape name, a top height and a ridge in, a
 * BufferGeometry with two material groups out — and it was the one piece of
 * the building pipeline the façade lab could not reach without copying it.
 * The doc below and the function are verbatim from main.ts; the callers
 * there (building() and the campanile) import it and are unchanged.
 */
/**
 * A pitched roof over a footprint, built in world coordinates with its eave
 * at `top` (the extrusion's roof plane). Everything comes off the footprint's
 * oriented box — the longest edge sets the ridge line — because a pitched
 * roof IS a statement that the plan is a box; anything too far from one
 * (courtyard blocks, L-plans, long malls) keeps its flat cap instead, which
 * is also what those wear in life. Groups: materialIndex 0 for the roof
 * planes (roof paint), 1 for the vertical gable/skillion walls (wall paint),
 * matching the ExtrudeGeometry caps/sides convention flushBuildings splits on.
 */
/** The oriented box a roof is reasoned in — axed along the longest edge, with
 *  the rectangularity and size rules that refuse a plan no pitched roof can
 *  carry. One function, because the chimney has to stand on the same roof
 *  roofGeo built and refuse where it refused. Null is a refusal. */
export function roofBox(pts: Array<[number, number]>): { ux: number; uz: number; vx: number; vz: number;
  u0: number; u1: number; v0: number; v1: number; du: number; dv: number } | null {
  if (pts.length < 3 || pts.length > 8) return null;
  // The oriented box, axed along the longest edge.
  let bi = 0, bl = -1;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    const l = (x2 - x1) ** 2 + (z2 - z1) ** 2;
    if (l > bl) { bl = l; bi = i; }
  }
  const [ex1, ez1] = pts[bi], [ex2, ez2] = pts[(bi + 1) % pts.length];
  const el = Math.hypot(ex2 - ex1, ez2 - ez1);
  if (el < 1e-3) return null;
  const ux = (ex2 - ex1) / el, uz = (ez2 - ez1) / el;  // along the ridge
  const vx = -uz, vz = ux;                             // across it
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of pts) {
    const u = x * ux + z * uz, v = x * vx + z * vz;
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  // Rectangularity: ring area against box area. Below the bar, a box-cut
  // roof floats over the footprint's notches and reads as a wrong building.
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    area2 += x1 * z2 - x2 * z1;
  }
  const du = u1 - u0, dv = v1 - v0;
  if (Math.abs(area2) / 2 < du * dv * 0.72) return null;
  if (du < 2.2 || dv < 2.2 || du * dv > 1400) return null;   // houses, not malls
  return { ux, uz, vx, vz, u0, u1, v0, v1, du, dv };
}

/** The ridge's height over the eave: stated, or the plan's own. */
const ridgeOf = (ridgeH: number | undefined, du: number, dv: number): number =>
  ridgeH ?? clamp(Math.min(du, dv) * 0.45, 1.6, 6);

export function roofGeo(pts: Array<[number, number]>, shape: string, top: number,
  ridgeH?: number): THREE.BufferGeometry | null {
  const box = roofBox(pts);
  if (!box) return null;
  const { ux, uz, vx, vz, du, dv } = box;
  let { u0, u1, v0, v1 } = box;
  const h = ridgeOf(ridgeH, du, dv);
  // A small eave overhang: hides the OBB-vs-ring mismatch and is what real
  // pitched roofs do anyway.
  u0 -= 0.45; u1 += 0.45; v0 -= 0.45; v1 += 0.45;
  const P = (u: number, v: number, y: number): [number, number, number] =>
    [u * ux + v * vx, y, u * uz + v * vz];
  const roof: number[] = [], wall: number[] = [];
  const uvR: number[] = [], uvW: number[] = [];
  const tri = (into: number[], uvInto: number[],
    a: [number, number, number], b: [number, number, number], c: [number, number, number]): void => {
    into.push(...a, ...b, ...c);
    // Roof uv in world metres off the ground plan (a slope compresses a
    // little; at these pitches nobody can tell) — walls get along-wall/height.
    if (into === roof) for (const q of [a, b, c]) uvInto.push(q[0], q[2]);
    else for (const q of [a, b, c]) uvInto.push(q[0] * ux + q[2] * uz + q[0] * vx + q[2] * vz, q[1]);
  };
  const quad = (into: number[], uvInto: number[],
    a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]): void => {
    tri(into, uvInto, a, b, c); tri(into, uvInto, a, c, d);
  };
  const vm = (v0 + v1) / 2, um = (u0 + u1) / 2;
  // ── THE RIDGE IS A COURSE OF ITS OWN ──
  // A ridge was two planes meeting on a line, and from the street that line
  // was whatever the two slopes' shading happened to do. Real ridges wear a
  // course of ridge tiles: a narrow flat top (lit square to a high sun, so
  // lighter than either slope) with skirts steeper than the roof either
  // side. Twelve triangles on a gable or a hip, none on a pyramid.
  const ridgeCap = (a: number, b: number): void => {
    const yT = top + h + 0.07, w = 0.16, s = 0.34;
    const yS = top + h * (1 - s / (dv / 2));            // the slope at the skirt's foot
    quad(roof, uvR, P(a, vm - w, yT), P(b, vm - w, yT), P(b, vm + w, yT), P(a, vm + w, yT));
    quad(roof, uvR, P(a, vm - s, yS), P(b, vm - s, yS), P(b, vm - w, yT), P(a, vm - w, yT));
    quad(roof, uvR, P(a, vm + w, yT), P(b, vm + w, yT), P(b, vm + s, yS), P(a, vm + s, yS));
  };
  if (shape === 'gabled') {
    quad(roof, uvR, P(u0, v0, top), P(u1, v0, top), P(u1, vm, top + h), P(u0, vm, top + h));
    quad(roof, uvR, P(u0, vm, top + h), P(u1, vm, top + h), P(u1, v1, top), P(u0, v1, top));
    tri(wall, uvW, P(u0, v0, top), P(u0, v1, top), P(u0, vm, top + h));
    tri(wall, uvW, P(u1, v0, top), P(u1, v1, top), P(u1, vm, top + h));
    ridgeCap(u0, u1);
  } else if (shape === 'hipped') {
    const ins = Math.min(dv / 2, du / 2 - 0.1);          // 45-degree hips
    const r0 = u0 + ins, r1 = u1 - ins;
    quad(roof, uvR, P(u0, v0, top), P(u1, v0, top), P(r1, vm, top + h), P(r0, vm, top + h));
    quad(roof, uvR, P(r0, vm, top + h), P(r1, vm, top + h), P(u1, v1, top), P(u0, v1, top));
    tri(roof, uvR, P(u0, v0, top), P(r0, vm, top + h), P(u0, v1, top));
    tri(roof, uvR, P(u1, v0, top), P(u1, v1, top), P(r1, vm, top + h));
    if (r1 - r0 > 0.5) ridgeCap(r0, r1);
  } else if (shape === 'pyramidal') {
    const apex = P(um, vm, top + h);
    tri(roof, uvR, P(u0, v0, top), P(u1, v0, top), apex);
    tri(roof, uvR, P(u1, v0, top), P(u1, v1, top), apex);
    tri(roof, uvR, P(u1, v1, top), P(u0, v1, top), apex);
    tri(roof, uvR, P(u0, v1, top), P(u0, v0, top), apex);
  } else if (shape === 'skillion') {
    quad(roof, uvR, P(u0, v0, top + h), P(u1, v0, top + h), P(u1, v1, top), P(u0, v1, top));
    tri(wall, uvW, P(u0, v0, top), P(u0, v1, top), P(u0, v0, top + h));
    tri(wall, uvW, P(u1, v0, top), P(u1, v1, top), P(u1, v0, top + h));
    quad(wall, uvW, P(u0, v0, top), P(u1, v0, top), P(u1, v0, top + h), P(u0, v0, top + h));
  } else return null;
  const pos = new Float32Array(roof.length + wall.length);
  pos.set(roof, 0); pos.set(wall, roof.length);
  const uv = new Float32Array(uvR.length + uvW.length);
  uv.set(uvR, 0); uv.set(uvW, uvR.length);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.addGroup(0, roof.length / 3, 0);
  if (wall.length) geo.addGroup(roof.length / 3, wall.length / 3, 1);
  geo.computeVertexNormals();
  return geo;
}

/**
 * ── THE CHIMNEY ──
 *
 * The thing a roofline has that a box with a lid does not. One stack, or two
 * on a long ridge, standing on the ridge line a metre in from the gable end
 * (inside the hip on a hipped roof), 0.8 by 0.64 m in plan and 1.1 m above
 * the ridge, buried to half the ridge height so it meets the slope whatever
 * the pitch. Its own geometry rather than part of roofGeo's, because the
 * batch carries one aGram per piece and a stack must be a BLANK wall — the
 * façade shader draws a door on any wall whose ground row it can reach, and
 * a chimney with a door in it is the kind of thing that gets photographed.
 * The sides are the wall paint (group 1); the cap is the roof's (group 0),
 * and it wears the cornice band the shader gives any wall top, which reads
 * as a chimney cap. userData.top is the cap's height, for aTop.
 *
 * Which buildings get one is the tradition's `chimneys` share, drawn in
 * building(); a pyramid and a skillion never do.
 */
export function chimneyGeo(pts: Array<[number, number]>, shape: string, top: number,
  ridgeH: number | undefined, n: number): THREE.BufferGeometry | null {
  if (n < 1 || (shape !== 'gabled' && shape !== 'hipped')) return null;
  const box = roofBox(pts);
  if (!box) return null;
  const { ux, uz, vx, vz, u0, u1, v0, v1, du, dv } = box;
  const h = ridgeOf(ridgeH, du, dv);
  const ins = shape === 'hipped' ? Math.min(dv / 2, du / 2 - 0.1) + 0.5 : 1.0;
  if (u1 - u0 < 2 * ins + 1.6) return null;
  const vm = (v0 + v1) / 2, yB = top + h * 0.5, yT = top + h + 1.1;
  const P = (u: number, v: number, y: number): [number, number, number] =>
    [u * ux + v * vx, y, u * uz + v * vz];
  const wall: number[] = [], cap: number[] = [], uvW: number[] = [], uvC: number[] = [];
  const tri = (into: number[], uvInto: number[],
    a: [number, number, number], b: [number, number, number], c: [number, number, number]): void => {
    into.push(...a, ...b, ...c);
    if (into === cap) for (const q of [a, b, c]) uvInto.push(q[0], q[2]);
    else for (const q of [a, b, c]) uvInto.push(q[0] * ux + q[2] * uz + q[0] * vx + q[2] * vz, q[1]);
  };
  const quad = (into: number[], uvInto: number[],
    a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]): void => {
    tri(into, uvInto, a, b, c); tri(into, uvInto, a, c, d);
  };
  const at = n >= 2 && u1 - u0 > 12 ? [u0 + ins, u1 - ins] : [u0 + ins];
  for (const uc of at) {
    const a = uc - 0.4, b = uc + 0.4, c = vm - 0.32, d = vm + 0.32;
    quad(wall, uvW, P(a, c, yB), P(b, c, yB), P(b, c, yT), P(a, c, yT));
    quad(wall, uvW, P(b, d, yB), P(a, d, yB), P(a, d, yT), P(b, d, yT));
    quad(wall, uvW, P(a, d, yB), P(a, c, yB), P(a, c, yT), P(a, d, yT));
    quad(wall, uvW, P(b, c, yB), P(b, d, yB), P(b, d, yT), P(b, c, yT));
    quad(cap, uvC, P(a, c, yT), P(b, c, yT), P(b, d, yT), P(a, d, yT));
  }
  const pos = new Float32Array(cap.length + wall.length);
  pos.set(cap, 0); pos.set(wall, cap.length);
  const uv = new Float32Array(uvC.length + uvW.length);
  uv.set(uvC, 0); uv.set(uvW, uvC.length);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.addGroup(0, cap.length / 3, 0);
  geo.addGroup(cap.length / 3, wall.length / 3, 1);
  geo.computeVertexNormals();
  geo.userData.top = yT;
  return geo;
}
