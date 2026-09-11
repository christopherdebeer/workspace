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
export function roofGeo(pts: Array<[number, number]>, shape: string, top: number,
  ridgeH?: number): THREE.BufferGeometry | null {
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
  const h = ridgeH ?? clamp(Math.min(du, dv) * 0.45, 1.6, 6);
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
  if (shape === 'gabled') {
    quad(roof, uvR, P(u0, v0, top), P(u1, v0, top), P(u1, vm, top + h), P(u0, vm, top + h));
    quad(roof, uvR, P(u0, vm, top + h), P(u1, vm, top + h), P(u1, v1, top), P(u0, v1, top));
    tri(wall, uvW, P(u0, v0, top), P(u0, v1, top), P(u0, vm, top + h));
    tri(wall, uvW, P(u1, v0, top), P(u1, v1, top), P(u1, vm, top + h));
  } else if (shape === 'hipped') {
    const ins = Math.min(dv / 2, du / 2 - 0.1);          // 45-degree hips
    const r0 = u0 + ins, r1 = u1 - ins;
    quad(roof, uvR, P(u0, v0, top), P(u1, v0, top), P(r1, vm, top + h), P(r0, vm, top + h));
    quad(roof, uvR, P(r0, vm, top + h), P(r1, vm, top + h), P(u1, v1, top), P(u0, v1, top));
    tri(roof, uvR, P(u0, v0, top), P(r0, vm, top + h), P(u0, v1, top));
    tri(roof, uvR, P(u1, v0, top), P(u1, v1, top), P(r1, vm, top + h));
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
