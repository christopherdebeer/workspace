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

/**
 * ── A MIRROR IS NOT A ROTATION, AND EVERY BUILDING IN THE WORLD WAS INSIDE OUT ──
 *
 * `polygon` builds its extrusion as `ExtrudeGeometry` → `rotateX(90°)` →
 * `scale(1, -1, 1)`, and that last step is a MIRROR. `BufferGeometry.scale`
 * transforms the NORMAL attribute through the normal matrix, correctly — but
 * it does not touch the index, so the triangle WINDING is reversed and the two
 * stop agreeing. Measured on the shipped construction, a plain 12×8 box:
 *
 *     cap triangles: attr-up 2, attr-down 2
 *     winding vs attribute: agree 0, DISAGREE 4
 *     wall triangles: agree 0, DISAGREE 8
 *
 * Every triangle, caps and walls alike. The material is `DoubleSide`, and
 * three's `normal_fragment_begin` does `normal *= faceDirection` there — so
 * from OUTSIDE the building every face is back-facing, the shading normal is
 * flipped to point INWARD, and Lambert's `dot(N, L)` clamps to zero. The
 * buildings have been lit from the wrong side since the day the extrusion was
 * written.
 *
 * WHY THE WALLS SURVIVED IT AND THE ROOFS DID NOT. A wall has three other
 * sources of value — `bldSkylit`'s emissive lift, the façade shader's sky
 * reflection in the glass, and its own drawn detail — so an unlit wall reads
 * as a flat wall rather than as a hole. A flat roof has ONE: `bldRoofSkylit`'s
 * lift at HALF the wall's (`lift * 0.5`, about 0.026 of its own colour at
 * noon), and the hemisphere light then hands a downward-facing normal its
 * GROUND colour. MEASURED at Suresnes at noon under a clear sky, four sample
 * points each verified by raycast to be on the building's own mesh: **sRGB
 * [0,1,0], luminance 0.0001**, with the grass beside it at 0.0500 — two of the
 * four read exactly zero. That is the "dead black" reported from the seat, and
 * it is not that the roof was dark: it was receiving no sunlight at all.
 *
 * The fix is to put the winding back and nothing else — an index reversal
 * where there is an index, and a swap of the second and third vertex of every
 * triangle across every attribute where there is not (`ExtrudeGeometry` is
 * non-indexed, so buildings take the second path). `?bldface=0` is the exact
 * A/B and restores the inside-out world; after it, the same four samples read
 * 0.0330 against the same grass.
 *
 * A DRAPE IS NOT MIRRORED (`extrude === 0` never scales), so this is the
 * extrusions only — buildings and anything else that stands up a box.
 *
 * IT LIVES HERE, and not beside `polygon`, because the façade lab builds the
 * same box by the same four lines so it can judge the real shader on a real
 * wall — and a lab holding its own copy of the fix, or missing it, is a lab
 * reviewing a different game. roof.ts is the pure module both already import.
 */
export function flipWinding(geo: THREE.BufferGeometry): void {
  const idx = geo.getIndex();
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    idx.needsUpdate = true;
    return;
  }
  // Non-indexed: swap the second and third VERTEX of every triangle, across
  // every attribute the geometry carries, or the uvs follow the old order and
  // the wall texture comes back mirrored.
  for (const attr of Object.values(geo.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const arr = a.array as Float32Array;
    const n = a.itemSize;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < n; k++) {
        const i = (t + 1) * n + k, j = (t + 2) * n + k;
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
    }
    a.needsUpdate = true;
  }
}
/**
 * ── THE WINDING, AND WHY EVERY ROOF IN THE WORLD WAS LIT FROM INSIDE ──
 *
 * `computeVertexNormals` derives a face's normal from its WINDING — three's
 * own expression is `(C − B) × (A − B)` — so a quad written in the wrong order
 * does not merely draw backwards, it carries a normal pointing into the
 * building, and the material being `DoubleSide` hides that from every test
 * that looks at the picture. Measured on a 12 × 8 plan with the shipped code:
 *
 *     roofGeo gabled    roof 0 outward, 10 INWARD   wall 1 outward, 1 INWARD
 *     roofGeo hipped    roof 0 outward, 12 INWARD
 *     roofGeo pyramidal roof 0 outward,  4 INWARD
 *     chimneyGeo        cap  0 outward,  2 INWARD   wall 2 outward, 6 INWARD
 *
 * The gable ends are the tell: the two triangles are written in the same
 * (u, v) order at opposite ends of the ridge, so one faces out and one faces
 * in — which no blanket reversal can fix and no author reliably gets right by
 * hand across four shapes, a ridge cap and a stack.
 *
 * So the rule is stated once and enforced, and it is stated in terms of what
 * these generators actually emit: every face here is either EXACTLY VERTICAL
 * (a gable end, a skillion's eave wall, a stack's side, a parapet's skin) or
 * some upward-facing surface (a roof plane, a hip, a cap, a ridge tile, a
 * coping). So a vertical face points AWAY from the piece's axis and everything
 * else points UP, and there is no third case to get wrong.
 *
 * THE FIRST CUT PUT THE CUT AT 0.55 — the façade shader's wall test — and the
 * ridge cap's skirts measured |ny| 0.537: steeper than the shader calls a
 * roof, and sitting ON the ridge, where "away from the plan's centre" means
 * nothing at all. One skirt of every gable and hip in the world came out
 * pointing down. A threshold that has to separate a 57° tile from a wall is
 * the wrong threshold; a wall is vertical, and 0.05 is float noise.
 *
 * What this is NOT is a fix for the extrusion under the roof: `polygon` builds
 * its box and then MIRRORS it with `scale(1, -1, 1)`, which transforms the
 * normal attribute and leaves the index alone, so there the two genuinely
 * disagree and the fix is an index reversal at the call site.
 */
function faceOut(pos: number[], uv: number[], ox: number, oz: number, from = 0): void {
  for (let t = from; t < pos.length; t += 9) {
    const ux = pos[t + 3] - pos[t], uy = pos[t + 4] - pos[t + 1], uz = pos[t + 5] - pos[t + 2];
    const vx = pos[t + 6] - pos[t], vy = pos[t + 7] - pos[t + 1], vz = pos[t + 8] - pos[t + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    const mx = (pos[t] + pos[t + 3] + pos[t + 6]) / 3, mz = (pos[t + 2] + pos[t + 5] + pos[t + 8]) / 3;
    const out = Math.abs(ny / len) > 0.05 ? ny : nx * (mx - ox) + nz * (mz - oz);
    if (out >= 0) continue;
    for (let k = 0; k < 3; k++) {
      const i = t + 3 + k, j = t + 6 + k;
      const s = pos[i]; pos[i] = pos[j]; pos[j] = s;
    }
    const q = (t / 9) * 6;
    for (let k = 0; k < 2; k++) {
      const i = q + 2 + k, j = q + 4 + k;
      const s = uv[i]; uv[i] = uv[j]; uv[j] = s;
    }
  }
}

/** The plan's centre, for faceOut's reference. THE CLOSING VERTEX DOES NOT
 *  VOTE: an OSM way repeats its first node, so on a four-corner rectangle the
 *  repeat drags the centroid a metre off its own middle — enough, measured, to
 *  call a correct gable end inward. */
function ringCentre(pts: Array<[number, number]>): [number, number] {
  let x = 0, z = 0, n = 0;
  for (const [px, pz] of pts) {
    if (n && Math.hypot(px - pts[0][0], pz - pts[0][1]) <= 1e-6) continue;
    x += px; z += pz; n++;
  }
  return n ? [x / n, z / n] : [0, 0];
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
  const [ox, oz] = ringCentre(pts);
  faceOut(roof, uvR, ox, oz); faceOut(wall, uvW, ox, oz);
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
    // EACH STACK IS ORIENTED ABOUT ITS OWN AXIS, not the footprint's centroid:
    // a chimney stands a metre in from the gable end and is nowhere near the
    // middle of the plan, so the shared rule would call three of its four
    // sides outward and the fourth one in. The slice is this stack's own.
    const w0 = wall.length, c0 = cap.length;
    quad(wall, uvW, P(a, c, yB), P(b, c, yB), P(b, c, yT), P(a, c, yT));
    quad(wall, uvW, P(b, d, yB), P(a, d, yB), P(a, d, yT), P(b, d, yT));
    quad(wall, uvW, P(a, d, yB), P(a, c, yB), P(a, c, yT), P(a, d, yT));
    quad(wall, uvW, P(b, c, yB), P(b, d, yB), P(b, d, yT), P(b, c, yT));
    quad(cap, uvC, P(a, c, yT), P(b, c, yT), P(b, d, yT), P(a, d, yT));
    const sx = uc * ux + vm * vx, sz = uc * uz + vm * vz;
    faceOut(wall, uvW, sx, sz, w0); faceOut(cap, uvC, sx, sz, c0);
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

/**
 * ── A FLAT ROOF IS NOT A LID ──
 *
 * Reported from the seat: "flat roofs still render black. They should not be
 * dead black, they should be proper flat roofs, often with small protrusions
 * and miscellaneous structures on top. With an edge/small wall."
 *
 * Two separate faults, and the black one is not here — it is the extrusion's
 * mirrored winding (`flipWinding`, above). What is here is the other half:
 * there was NO flat-roof geometry at all. `roofGeo` returns null for 'flat',
 * so the roof of a third of the stock (439 of 1,204 intact at Suresnes,
 * measured) was the extrusion's own cap — one horizontal quad at `top`, flush
 * with the wall, with nothing on it and no edge to it. Even lit correctly that
 * reads as a lid, and from the chart a town of them reads as a sheet of paper.
 *
 * A real flat roof has three things a box does not:
 *
 * - **A PARAPET.** The wall does not stop at the roof; it runs on past it as a
 *   low upstand with a coping on top, which is what stops the covering peeling
 *   and what stops people falling off. From the street it is the building's
 *   top EDGE — a band of wall above the last row of windows with a lit line at
 *   its head — and it is the single thing that makes a flat-roofed building
 *   read as a building rather than as a cut-off box. It is a piece with
 *   `aGram` −1 (the façade shader's BLANK wall) for the chimney's reason: the
 *   bay grid falls across it however it falls, and a door on a parapet is the
 *   kind of thing that gets photographed. Blank still wears the cornice band
 *   at its own `aTop`, which on a parapet IS its coping.
 * - **PLANT.** A lift overrun, a tank housing, a stair head — one box a fair
 *   bit taller than the parapet — and then the miscellany: vents, ducts,
 *   condensers, half a metre high and scattered. That is what a flat roof
 *   looks like from anywhere above it, and it is the difference between a
 *   roofscape and a floor plan.
 * - **NOTHING WHERE THERE IS NO ROOM.** A 20 m² lean-to has a lid and that is
 *   honest; a parapet on it is a doll's house detail. The gates are the plan's
 *   own area and the building's height, and they are deliberately generous —
 *   a tall narrow block gets its parapet on height alone.
 *
 * DETERMINISTIC OFF THE OSM ID, by a constant nothing else uses, so the plant
 * is the same plant every boot and an A/B of the massing, the ruin roll, the
 * roof form or this is a comparison of that one thing. Groups: 0 the roof
 * paint (the unit caps), 1 the wall paint (the parapet, the unit sides) —
 * matching the caps/sides convention flushBuildings splits on.
 *
 * `userData.top` is the PARAPET'S top, not the tallest unit's: the coping is
 * what the street sees and what wants the cornice band. A unit standing above
 * it draws plain wall over the line, which is what a plant room is.
 */
/** The plan area a flat roof needs before it is worth detailing at all. */
const FLAT_MIN_M2 = 20;
/** …before it carries a parapet (or, failing that, the height that earns one). */
const FLAT_PARAPET_M2 = 40, FLAT_PARAPET_H = 6;
/** …and before there is room to stand anything on it. */
const FLAT_UNIT_M2 = 120;

/** Is this point inside the ring? The ray cast, local because roof.ts is pure
 *  and main.ts's copy is not reachable from a lab or a node test. */
function inRing(x: number, z: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** One mulberry32, the same generator `client/rng.ts` exports — inlined
 *  because roof.ts is imported by the node tests and the bake, and a second
 *  copy that DRIFTED is the fault rng.ts was extracted to prevent. Kept
 *  identical; if it ever needs changing, change rng.ts and copy it here. */
function flatRand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The footprint's own oriented box, axed along its longest edge: the frame a
 *  rooftop unit stands square to, and the short side that says whether there
 *  is room for anything at all. `roofBox` cannot stand in for it — that one
 *  REFUSES a plan no pitched roof can carry (rectangularity, span, 1400 m²),
 *  which is exactly the set of plans that wear a flat roof. */
export function flatBox(ring: Array<[number, number]>): { ux: number; uz: number; vx: number; vz: number;
  u0: number; u1: number; v0: number; v1: number; short: number } {
  const n = ring.length;
  let bi = 0, bl = -1;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
    const l = (x2 - x1) ** 2 + (z2 - z1) ** 2;
    if (l > bl) { bl = l; bi = i; }
  }
  const [ax0, az0] = ring[bi], [ax1, az1] = ring[(bi + 1) % n];
  const el = Math.hypot(ax1 - ax0, az1 - az0) || 1;
  const ux = (ax1 - ax0) / el, uz = (az1 - az0) / el;
  const vx = -uz, vz = ux;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of ring) {
    const u = x * ux + z * uz, v = x * vx + z * vz;
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  return { ux, uz, vx, vz, u0, u1, v0, v1, short: Math.min(u1 - u0, v1 - v0) };
}

export function flatRoofGeo(pts: Array<[number, number]>, top: number, height: number,
  id: number): THREE.BufferGeometry | null {
  // THE RING, CLOSED ONCE. An OSM way repeats its first node, and a repeated
  // vertex is a zero-length edge with no direction — the miter at that corner
  // is then a division by nothing and the parapet's corner flies off to
  // infinity. The same rule the morphology census had to learn.
  const ring: Array<[number, number]> = [];
  for (const [x, z] of pts) {
    const q = ring[ring.length - 1];
    if (!q || Math.hypot(x - q[0], z - q[1]) > 1e-4) ring.push([x, z]);
  }
  while (ring.length > 3
    && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) <= 1e-4) ring.pop();
  const n = ring.length;
  if (n < 3 || n > 64) return null;                    // a courtyard block, not a roof
  let a2 = 0;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
    a2 += x1 * z2 - x2 * z1;
  }
  const area = Math.abs(a2) / 2;
  if (area < FLAT_MIN_M2) return null;
  // ONE ORIENTATION, DECIDED ONCE. Every winding below is written for a ring
  // whose signed area is POSITIVE, where an edge's inward normal is (−uz, ux);
  // reversing the ring here is one line and saves carrying a sign through
  // nine quads, which is nine chances to carry it the wrong way.
  if (a2 < 0) ring.reverse();

  const rnd = flatRand((Math.imul(id, 0x27d4eb2d) ^ 0x165667b1) >>> 0);
  rnd();                                    // the first draw off a hashed seed is poor
  // A domestic parapet is a course or two of brick; a block's is waist high
  // because somebody has to be able to walk behind it. Both are what the
  // street sees as the building's top edge.
  const ph = Math.min(1.15, 0.26 + height * 0.035 + rnd() * 0.14);
  const pw = Math.min(0.34, 0.17 + ph * 0.14);
  // A PLAN NARROWER THAN TWO PARAPETS HAS NO ROOF BETWEEN THEM. The area gate
  // does not catch it — OSM tags walls, platforms and lean-tos as buildings,
  // and a 40 m by 0.5 m ring clears 20 m² comfortably — and the inset ring for
  // one would cross itself, turning every inner face inside out along its
  // length. The short side of the oriented box is the test.
  const plan = flatBox(ring);
  const parapet = (area >= FLAT_PARAPET_M2 || height >= FLAT_PARAPET_H) && plan.short > pw * 5;
  const units = area >= FLAT_UNIT_M2 && plan.short > 5;
  if (!parapet && !units) return null;

  const roof: number[] = [], wall: number[] = [], uvR: number[] = [], uvW: number[] = [];
  const { ux, uz, vx, vz, u0, u1, v0, v1 } = plan;
  const W = (u: number, v: number, y: number): [number, number, number] =>
    [u * ux + v * vx, y, u * uz + v * vz];
  const tri = (into: number[], uvInto: number[],
    a: [number, number, number], b: [number, number, number], c: [number, number, number]): void => {
    into.push(...a, ...b, ...c);
    // The same uv conventions roofGeo uses: world plan metres on the roof
    // paint, along-wall and height on the wall paint.
    if (into === roof) for (const q of [a, b, c]) uvInto.push(q[0], q[2]);
    else for (const q of [a, b, c]) uvInto.push(q[0] * ux + q[2] * uz + q[0] * vx + q[2] * vz, q[1]);
  };
  const quad = (into: number[], uvInto: number[],
    a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]): void => {
    tri(into, uvInto, a, b, c); tri(into, uvInto, a, c, d);
  };

  if (parapet) {
    // The inset ring, mitred on the angle bisector so the coping runs round a
    // corner as one band instead of two strips with a notch between them. The
    // miter is clamped at about three times the thickness: a sharp spike in an
    // OSM footprint would otherwise throw its inner corner across the roof.
    const inN: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
      const l = Math.hypot(x2 - x1, z2 - z1) || 1;
      inN.push([-(z2 - z1) / l, (x2 - x1) / l]);
    }
    const inner: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const [px, pz] = inN[(i + n - 1) % n], [qx, qz] = inN[i];
      let mx = px + qx, mz = pz + qz;
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-4) { mx = qx; mz = qz; } else { mx /= ml; mz /= ml; }
      const cosH = Math.max(0.35, mx * qx + mz * qz);
      inner.push([ring[i][0] + (mx * pw) / cosH, ring[i][1] + (mz * pw) / cosH]);
    }
    const yT = top + ph;
    const P = (p: [number, number], y: number): [number, number, number] => [p[0], y, p[1]];
    for (let i = 0; i < n; i++) {
      const A = ring[i], B = ring[(i + 1) % n], A2 = inner[i], B2 = inner[(i + 1) % n];
      // Outer face (away from the plan), coping (up), inner face (in). The
      // orders are worked out once for a positively-wound ring; `faceOut`
      // cannot check them, because the INNER face is meant to point inward and
      // the rule would turn it round.
      quad(wall, uvW, P(A, top), P(A, yT), P(B, yT), P(B, top));
      quad(wall, uvW, P(A, yT), P(A2, yT), P(B2, yT), P(B, yT));
      quad(wall, uvW, P(A2, yT), P(A2, top), P(B2, top), P(B2, yT));
    }
  }

  if (units) {
    // One plant room and then the miscellany, the count off the plan's area:
    // 120 m² carries one thing, 800 carries four. More than that is a roof
    // the chart cannot resolve them on anyway.
    const want = Math.min(4, 1 + Math.floor(area / 220));
    const clear = pw + 0.5;                 // keep the plant off the parapet
    const placed: Array<{ u: number; v: number; hw: number; hd: number }> = [];
    for (let tries = 0; tries < 48 && placed.length < want; tries++) {
      const big = placed.length === 0;
      const hw = big ? 1.0 + rnd() * 0.9 : 0.38 + rnd() * 0.5;
      const hd = big ? 0.85 + rnd() * 0.8 : 0.32 + rnd() * 0.45;
      const uh = big ? 1.3 + rnd() * 1.2 : 0.45 + rnd() * 0.7;
      const su = Math.max(0, u1 - u0 - 2 * (clear + hw)), sv = Math.max(0, v1 - v0 - 2 * (clear + hd));
      if (su <= 0 || sv <= 0) continue;
      // Access core and services share one side; keep a genuinely open deck.
      // Retries explore the whole plan when an irregular footprint refuses it.
      const edge = rnd() < 0.5 ? 0 : 1;
      const cu = u0 + clear + hw + rnd() * su;
      const cv = v0 + clear + hd + (tries < 16 ? (edge ? 0.88 : 0.12) : rnd()) * sv;
      // Wholly inside the ring with the parapet's clearance round it — a
      // corner test, because a rooftop unit hanging over the eave is the one
      // way this can look worse than the lid it replaced.
      let fits = true;
      for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as Array<[number, number]>) {
        const w = W(cu + du * (hw + clear), cv + dv * (hd + clear), 0);
        if (!inRing(w[0], w[2], ring)) { fits = false; break; }
      }
      if (fits) {
        const corners = [[cu-hw-clear, cv-hd-clear], [cu+hw+clear, cv-hd-clear],
          [cu+hw+clear, cv+hd+clear], [cu-hw-clear, cv+hd+clear]];
        for (let k = 0; k < 4 && fits; k++) {
          const a = corners[k], b = corners[(k + 1) % 4];
          const steps = Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1]) / 0.4);
          for (let j = 1; j < steps; j++) {
            const q = W(a[0] + (b[0]-a[0])*j/steps, a[1] + (b[1]-a[1])*j/steps, 0);
            if (!inRing(q[0], q[2], ring)) { fits = false; break; }
          }
        }
        for (const [x,z] of ring) {
          if (Math.abs(x*ux+z*uz-cu) < hw+clear && Math.abs(x*vx+z*vz-cv) < hd+clear) fits = false;
        }
      }
      if (!fits) continue;
      for (const q of placed) {
        if (Math.abs(q.u - cu) < q.hw + hw + 0.6 && Math.abs(q.v - cv) < q.hd + hd + 0.6) { fits = false; break; }
      }
      if (!fits) continue;
      placed.push({ u: cu, v: cv, hw, hd });
      const yB = top, yT = top + uh;
      const c0 = W(cu - hw, cv - hd, 0), c1 = W(cu + hw, cv - hd, 0),
        c2 = W(cu + hw, cv + hd, 0), c3 = W(cu - hw, cv + hd, 0);
      const box = [c0, c1, c2, c3];
      for (let k = 0; k < 4; k++) {
        const A = box[k], B = box[(k + 1) % 4];
        quad(wall, uvW, [A[0], yB, A[2]], [A[0], yT, A[2]], [B[0], yT, B[2]], [B[0], yB, B[2]]);
      }
      // The cap, in the roof paint and wound the other way round the plan, so
      // it faces up — a roof plane and a plan ring are opposite hands.
      quad(roof, uvR, [c0[0], yT, c0[2]], [c3[0], yT, c3[2]], [c2[0], yT, c2[2]], [c1[0], yT, c1[2]]);
    }
  }

  if (!roof.length && !wall.length) return null;
  const pos = new Float32Array(roof.length + wall.length);
  pos.set(roof, 0); pos.set(wall, roof.length);
  const uv = new Float32Array(uvR.length + uvW.length);
  uv.set(uvR, 0); uv.set(uvW, uvR.length);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (roof.length) geo.addGroup(0, roof.length / 3, 0);
  if (wall.length) geo.addGroup(roof.length / 3, wall.length / 3, 1);
  geo.computeVertexNormals();
  geo.userData.top = top + (parapet ? ph : 0);
  return geo;
}
