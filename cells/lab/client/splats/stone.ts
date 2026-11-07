/**
 * One Stone: a drawing of a split boulder on warm paper, made of splats, where each feature of the stone draws itself.
 *
 * **The shape** (`Stone`) is a cut stone, not a lumpy sphere: a set of planes (a sloping top, bevels, broad front and
 * back slabs, a tall end and a tapering one: a wedge), the stone everything inside all of them. Its back-left side is
 * cut back below a line by an inner plane (the *recess*), so the face above overhangs it as a **ledge** with a flat
 * underside (the *soffit*); and a **seam** runs in a fracture plane, hooking over the crown from the near face and down
 * the far one. Everything about it is exact: its mesh is each plane's polygon cut by the others (`stoneShape`), a ray
 * meets the planes themselves (`polyRay`), a face is sampled as its own polygon (`faceSampler`), and a point's distance
 * to its face's edges is to the true arris where two planes meet (`arris`), not the mesh's zigzag. Each face is a
 * *region*, so the marks describe planes, not just a surface. The mesh, drawn into the depth buffer only, hides what's
 * behind it (render.ts).
 *
 * **The marks**, each a kind (`MARK`), in **strokes**: every mark belongs to a stroke (the seam, the branch, the ledge's
 * lip, a face's wash, a tuft of moss, the contact shadow) with one rank for the stroke (when it goes as the drawing
 * simplifies, 1 the last), and a place in it (how peripheral it is). A mark's rank is the stroke's less how peripheral it
 * is, so as the detail falls a stroke shortens from its ends and a wash withdraws toward its darkest pool, rather than
 * crumbling into scattered pieces:
 * - **fracture**: the seam, its far end going first, the hook last; a shorter branch off it.
 * - **lip**: the ledge's edge, shortening from both ends.
 * - **wash**: one tone for each face by how it's turned from the light (lit faces none; half-lit one; shadowed two;
 *   under the ledge three), laid on the face and kept inside its arrises. Dry: parallel hatching, its direction set by
 *   the face. Wash: broad soft discs shrunk near the face's edges (soft inside, held at the arris), a darker rim where
 *   the pigment pools along the face's lower edges, a little granulation in the darkest; the seam bleeding into the
 *   shadow side only.
 * - **stipple**: moss, tufts on the seam's damp side and at the foot; the outliers go first.
 * - **shadow**: the contact shadow, reaching away from the light, with a dark line where stone meets ground.
 * - **contour**: marks along every arris, each knowing both its faces' normals; the shader draws one only where one
 *   face is turned toward the eye and the other away (the arris is on the profile from here), eased in as a face turns,
 *   and broken into accents. Belongs to the view, not the rock.
 * - **chip**: small flecks by the seam (dry).
 */
import { alloc, type Splats } from './format';

export const MARK = { plain: 0, fracture: 1, wash: 2, stipple: 3, contour: 4, shadow: 5, lip: 6, chip: 7 } as const;
export type Look = 'dry' | 'wash';
type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** where the light comes from (upper left, toward the viewer): what's in shadow takes the wash, the damp side the moss */
export const LIGHT = norm([-0.55, 0.75, 0.35]);
const INK: V = [36, 31, 27], MOSS: V = [96, 110, 50];

/** the cut stone's planes: each a normal and its distance from the middle */
const PLANES: Array<{ n: V; h: number }> = [
  { n: norm([0.32, 1, 0.08]), h: 0.42 },     // the top, sloping down toward +x (the wedge)
  { n: norm([0.15, 0.75, 0.75]), h: 0.56 },  // the near bevel
  { n: norm([0.05, 0.8, -0.72]), h: 0.55 },  // the far bevel
  { n: norm([0.12, 0.12, 1]), h: 0.66 },     // the near slab
  { n: norm([-0.08, 0.08, -1]), h: 0.62 },   // the far slab
  { n: norm([-1, 0.12, 0.18]), h: 0.95 },    // the tall end
  { n: norm([1, 0.45, -0.05]), h: 0.82 },    // the tapering end
  { n: norm([0.8, 0.2, 0.62]), h: 0.9 },     // near right
  { n: norm([-0.7, 0.18, -0.7]), h: 0.82 },  // far left (the ledge's face)
  { n: [0, -1, 0], h: 0.45 },                // the foot, on the ground
];
const CENTRE: V = [0, 0.45, 0];
/** the ledge: below this height on the far-left side, the stone's cut back to an inner plane */
const LEDGE_Y = 0.36, LEDGE = { n: norm([-0.7, 0, -0.7]), h: 0.6 };
export const RECESS = PLANES.length;
/** the ledge's soffit: the flat underside of the overhang, at the ledge's height, between its face and the recess */
export const SOFFIT = PLANES.length + 1;
const DOWN: V = [0, -1, 0];
/** the plane a region lies on (as normal and distance from the middle) */
const planeOf = (reg: number) => (reg === RECESS ? LEDGE : reg === SOFFIT ? { n: DOWN, h: CENTRE[1] - LEDGE_Y } : PLANES[reg]);
/** whether a point (from the middle) is on the stone: inside every plane, above the ground, not in the recess */
const inside = (q: V, eps = 1e-4) => q[1] + CENTRE[1] > -eps && !PLANES.some((pl) => dot(q, pl.n) > pl.h + eps) && !(q[1] + CENTRE[1] < LEDGE_Y - eps && dot(q, LEDGE.n) > LEDGE.h + eps);

/**
 * A ray on the cut stone, exactly (its planes, not the mesh): from inside (the middle), where it leaves; from outside
 * (an eye), where it enters, or none. The surface, its normal and its region.
 */
export function polyRay(o: V, d: V): { p: V; n: V; t: number; region: number } | null {
  const q = sub(o, CENTRE), fromInside = inside(q);
  if (fromInside) {
    let t = Infinity, reg = -1;
    PLANES.forEach((pl, k) => { const c = dot(d, pl.n); if (c > 1e-6) { const tt = (pl.h - dot(q, pl.n)) / c; if (tt < t) { t = tt; reg = k; } } });
    let p = add(o, mul(d, t));
    // (below the ledge on its side, cut back: the recess plane, or the soffit over it)
    if (p[1] < LEDGE_Y) {
      const c = dot(d, LEDGE.n);
      if (c > 1e-6) { const tr = (LEDGE.h - dot(q, LEDGE.n)) / c; if (tr < t) { const pr = add(o, mul(d, tr)); if (pr[1] < LEDGE_Y) return { p: pr, n: LEDGE.n, t: tr, region: RECESS }; const ts = (LEDGE_Y - o[1]) / d[1]; if (d[1] < 0 && ts > 0 && ts < t) return { p: add(o, mul(d, ts)), n: [0, -1, 0], t: ts, region: SOFFIT }; } }
    }
    return { p, n: reg >= 0 ? PLANES[reg].n : [0, 1, 0], t, region: reg };
  }
  // (from outside: the convex stone's entry, then the recess if the entry's cut away)
  let t0 = 0, t1 = Infinity, reg = -1;
  for (let k = 0; k < PLANES.length; k++) {
    const pl = PLANES[k], c = dot(d, pl.n), s = pl.h - dot(q, pl.n);
    if (Math.abs(c) < 1e-9) { if (s < 0) return null; continue; }
    const tt = s / c;
    if (c < 0) { if (tt > t0) { t0 = tt; reg = k; } } else t1 = Math.min(t1, tt);
  }
  if (t0 > t1 || reg < 0) return null;
  const p = add(o, mul(d, t0));
  if (p[1] < LEDGE_Y && dot(sub(p, CENTRE), LEDGE.n) > LEDGE.h) {
    const c = dot(d, LEDGE.n);
    if (c < 0) { const tr = (LEDGE.h - dot(q, LEDGE.n)) / c, pr = add(o, mul(d, tr)); if (pr[1] < LEDGE_Y && inside(sub(pr, CENTRE), 1e-3)) return { p: pr, n: LEDGE.n, t: tr, region: RECESS }; }
    if (d[1] > 0) { const ts = (LEDGE_Y - o[1]) / d[1], ps = add(o, mul(d, ts)); if (inside(sub(ps, CENTRE), 1e-3)) return { p: ps, n: [0, -1, 0], t: ts, region: SOFFIT }; }
    return null;
  }
  return { p, n: PLANES[reg].n, t: t0, region: reg };
}

/** a region's face, exactly: points on it at random (its polygon on its plane), and its area */
export function faceSampler(reg: number, rnd: () => number): { at: () => V; area: number } {
  const pl = planeOf(reg), n = pl.n, e1 = norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), e2 = cross(n, e1), base = mul(n, pl.h), R = 1.4;
  const on = (q: V) => {
    if (reg === SOFFIT) return inside(add(q, [0, 0.002, 0]), 1e-3) && dot(q, LEDGE.n) > LEDGE.h && dot(q, PLANES[8].n) < PLANES[8].h;
    if (reg === RECESS) return q[1] + CENTRE[1] < LEDGE_Y && q[1] + CENTRE[1] > 0 && !PLANES.some((p2) => dot(q, p2.n) > p2.h + 1e-4);
    if (!inside(q, 1e-4)) return false;
    // (and this plane is the one the stone's surface is on here: not cut back under the ledge)
    return true;
  };
  let hit = 0; const N = 4000;
  for (let k = 0; k < N; k++) { const q = add(base, add(mul(e1, (rnd() * 2 - 1) * R), mul(e2, (rnd() * 2 - 1) * R))); if (on(q)) hit++; }
  const area = (hit / N) * (2 * R) ** 2;
  const at = () => { for (let k = 0; k < 4000; k++) { const q = add(base, add(mul(e1, (rnd() * 2 - 1) * R), mul(e2, (rnd() * 2 - 1) * R))); if (on(q)) return add(q, CENTRE); } return add(base, CENTRE); };
  return { at, area };
}

export interface Stone {
  /** the faceted shape: vertices, and triangles (three indices each), wound outward */
  pos: Float32Array; tris: Uint32Array; normals: Float32Array; centre: V;
  /** each triangle's region: the plane it lies on (an index into the planes, RECESS or SOFFIT) */
  region: Int16Array;
  /** the nearest hit of a ray on it: where, which face's normal, which region, how far */
  ray(o: V, d: V): { p: V; n: V; t: number; region: number } | null;
  /** the seam and the ledge's lip, as polylines on the surface */
  seam: V[]; lip: V[];
}

/** a convex polygon (points from the middle) clipped to one side of a plane: keep dot(q, n) <= h */
function clip(poly: V[], n: V, h: number): V[] {
  const out: V[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length], da = dot(a, n) - h, db = dot(b, n) - h;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) out.push(add(a, mul(sub(b, a), da / (da - db))));
  }
  return out;
}
/** the polygon of the stone on one plane (points from the middle): a big square on it, cut by the others */
function facePoly(n: V, h: number, cuts: Array<[V, number]>): V[] {
  const e1 = norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), e2 = cross(n, e1), c = mul(n, h), R = 3;
  let poly: V[] = [add(c, add(mul(e1, -R), mul(e2, -R))), add(c, add(mul(e1, R), mul(e2, -R))), add(c, add(mul(e1, R), mul(e2, R))), add(c, add(mul(e1, -R), mul(e2, R)))];
  for (const [m, hm] of cuts) { poly = clip(poly, m, hm); if (poly.length < 3) return []; }
  return poly;
}

/** the boulder's shape (the same for both looks): its exact faces, each its plane's polygon cut by the others */
export function stoneShape(): Stone {
  const P: V[] = [], T: number[] = [], N: number[] = [], RG: number[] = [];
  const addPoly = (poly: V[], n: V, reg: number) => {
    if (poly.length < 3) return;
    // (wound outward)
    const i0 = P.length; poly.forEach((q) => P.push(add(q, CENTRE)));
    const cw = dot(cross(sub(poly[1], poly[0]), sub(poly[2], poly[0])), n) < 0;
    for (let k = 1; k + 1 < poly.length; k++) { if (cw) T.push(i0, i0 + k + 1, i0 + k); else T.push(i0, i0 + k, i0 + k + 1); N.push(...n); RG.push(reg); }
  };
  const others = (skip: number) => PLANES.map((pl, k) => [pl.n, pl.h] as [V, number]).filter((_, k) => k !== skip);
  const ly = LEDGE_Y - CENTRE[1];
  PLANES.forEach((pl, k) => {
    const base = others(k);
    // (above the ledge's line, the plane as it is; below it, cut back by the recess)
    addPoly(facePoly(pl.n, pl.h, [...base, [[0, -1, 0], -ly]]), pl.n, k);
    addPoly(facePoly(pl.n, pl.h, [...base, [[0, 1, 0], ly], [LEDGE.n, LEDGE.h]]), pl.n, k);
  });
  // (the recess, under the ledge; and the soffit, the overhang's flat underside)
  addPoly(facePoly(LEDGE.n, LEDGE.h, [...others(-1), [[0, 1, 0], ly]]), LEDGE.n, RECESS);
  addPoly(facePoly([0, -1, 0], -ly, [...others(-1), [mul(LEDGE.n, -1), -LEDGE.h]]), [0, -1, 0], SOFFIT);
  const pos = new Float32Array(P.flat()), tris = new Uint32Array(T), normals = new Float32Array(N), region = new Int16Array(RG);
  const ray = polyRay;
  // (the seam: in a fracture plane a little off the middle, running from the near face over the crown and down the far
  // face, hooking round at its near end)
  const m = norm([0.86, 0.1, -0.5]), up: V = [0, 1, 0], a = norm(sub(up, mul(m, dot(up, m))));
  let b = cross(m, a); if (dot(b, [0.56, 0, 0.82]) < 0) b = mul(b, -1);
  const seamRaw: V[] = [];
  for (let k = 0; k <= 400; k++) {
    const tt = -1.25 + (k / 400) * 2.95, hook = 0.5 * smooth(-0.8, -1.25, tt);
    const d = norm(add(add(mul(a, Math.cos(tt)), mul(b, Math.sin(tt))), mul(m, 0.12 + hook + 0.015 * Math.sin(tt * 9))));
    const h = ray(CENTRE, d); if (h && h.p[1] > 0.03) seamRaw.push(h.p);
  }
  // (the ledge's lip: where the ledge's face meets the line it's cut back under, a straight edge, as far as the stone
  // goes either way, snapped onto the mesh)
  const n8 = PLANES[8].n, qy = LEDGE_Y - CENTRE[1], kk = (PLANES[8].h - n8[1] * qy) / (n8[0] * n8[0] + n8[2] * n8[2]);
  const q0: V = [n8[0] * kk, qy, n8[2] * kk], ldir = norm([-n8[2], 0, n8[0]]), lip: V[] = [];
  for (let k = -150; k <= 150; k++) {
    const q = add(q0, mul(ldir, k * 0.01));
    if (PLANES.some((pl, j) => j !== 8 && dot(q, pl.n) > pl.h + 0.002)) continue;
    const h = ray(CENTRE, norm(add(q, [0, 0.004, 0]))); if (h) lip.push(h.p);
  }
  return { pos, tris, normals, centre: CENTRE, region, ray, seam: resample(seamRaw, 0.006), lip };
}

/**
 * The cut stone's arrises, exactly: for each pair of planes, the stretch of the line where they meet that's on the
 * stone (inside every other plane, above the ground, not cut away by the ledge's recess), as points along it. The foot's
 * own edges are left out (the contact shadow draws where the stone meets the ground).
 */
export function arrisLines(step = 0.012): Array<{ i: number; j: number; pts: V[] }> {
  const out: Array<{ i: number; j: number; pts: V[] }> = [];
  for (let i = 0; i < PLANES.length - 1; i++) for (let j = i + 1; j < PLANES.length - 1; j++) {
    const a = PLANES[i], b = PLANES[j], u = cross(a.n, b.n), uu = dot(u, u);
    if (uu < 1e-4) continue;
    // (a point on both planes: the combination of the two normals that satisfies both)
    const c = dot(a.n, b.n), det = 1 - c * c, ka = (a.h - b.h * c) / det, kb = (b.h - a.h * c) / det, q0 = add(mul(a.n, ka), mul(b.n, kb)), ud = norm(u);
    let run: V[] = [];
    for (let k = -200; k <= 200; k++) {
      const q = add(q0, mul(ud, k * step)), y = q[1] + CENTRE[1];
      const on = y > 0.004 && !PLANES.some((pl, m) => m !== i && m !== j && dot(q, pl.n) > pl.h + 1e-4) && !(y < LEDGE_Y && dot(q, LEDGE.n) > LEDGE.h);
      if (on) run.push(add(q, CENTRE)); else if (run.length) { if (run.length > 2) out.push({ i, j, pts: run }); run = []; }
    }
    if (run.length > 2) out.push({ i, j, pts: run });
  }
  return out;
}

/** a polyline at even spacing */
function resample(p: V[], step: number): V[] {
  const out: V[] = [p[0]];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const seg = sub(p[i], p[i - 1]), L = len(seg);
    if (L < 1e-9) continue;
    let u = step - carry;
    while (u <= L) { out.push(add(p[i - 1], mul(seg, u / L))); u += step; }
    carry = L - (u - step);
  }
  return out;
}

/** the rotation (w x y z) whose columns are the axes x, y, z (orthonormal) */
function quat(x: V, y: V, z: V): [number, number, number, number] {
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2], tr = m00 + m11 + m22;
  let w, a, b, c;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; a = (m21 - m12) / s; b = (m02 - m20) / s; c = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; a = s / 4; b = (m01 + m10) / s; c = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; a = (m01 + m10) / s; b = s / 4; c = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; a = (m02 + m20) / s; b = (m12 + m21) / s; c = s / 4; }
  const l = Math.hypot(w, a, b, c); return [w / l, a / l, b / l, c / l];
}
/** axes for a mark lying on a surface (normal n), its long axis along `along` (projected onto the surface) */
function frame(n: V, along: V): [V, V, V] {
  let t = sub(along, mul(n, dot(along, n)));
  if (len(t) < 1e-6) t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  t = norm(sub(t, mul(n, dot(t, n))));
  return [t, cross(n, t), n];
}

/** how dark a face's wash is, by how it's turned from the light: 0 lit, 1 half-lit, 2 in shadow, 3 under the ledge */
export function toneOf(n: V, region: number): number {
  if (region === RECESS || region === SOFFIT || n[1] < -0.2) return 3;
  const l = dot(n, LIGHT);
  return l > 0.5 ? 0 : l > 0.2 ? 1 : 2;
}

/**
 * How far a point on a face (region `reg`) is from that face's arrises, measured along the face: for each other plane,
 * how far inside it the point is, over the sine of the angle between the two (the true straight edge where they meet,
 * not the mesh's zigzag across it); and for the ledge's face and the recess under it, the ledge's line. With the nearest
 * edge's other plane (`j`, -1 the ledge line) and the edge's direction.
 */
export function arris(p: V, reg: number): { d: number; j: number; dir: V; nj: V } {
  const ni = planeOf(reg).n, q = sub(p, CENTRE);
  if (reg === SOFFIT) {
    // (the soffit: between the ledge's face and the recess)
    const s8 = (PLANES[8].h - dot(q, PLANES[8].n)) / Math.sqrt(1 - PLANES[8].n[1] ** 2), sr = dot(q, LEDGE.n) - LEDGE.h;
    return s8 < sr ? { d: Math.max(0, s8), j: 8, dir: norm(cross(ni, PLANES[8].n)), nj: PLANES[8].n } : { d: Math.max(0, sr), j: RECESS, dir: norm(cross(ni, LEDGE.n)), nj: LEDGE.n };
  }
  let best = { d: Infinity, j: -2, dir: [1, 0, 0] as V, nj: [0, 1, 0] as V };
  PLANES.forEach((pl, j) => {
    if (j === reg) return;
    const c = dot(ni, pl.n); if (c > 0.995) return;
    const d = (pl.h - dot(q, pl.n)) / Math.sqrt(1 - c * c);
    if (d >= -0.01 && d < best.d) best = { d: Math.max(0, d), j, dir: norm(cross(ni, pl.n)), nj: pl.n };
  });
  if (reg === 8 || reg === RECESS) {
    const s = reg === 8 ? p[1] - LEDGE_Y : LEDGE_Y - p[1], d = s / Math.sqrt(Math.max(0.05, 1 - ni[1] * ni[1]));
    if (d >= -0.01 && d < best.d) best = { d: Math.max(0, d), j: -1, dir: norm(cross(ni, [0, 1, 0])), nj: reg === 8 ? [0, -1, 0] : [0, 1, 0] };
  }
  return best;
}

/** a unit normal in two bytes (octahedral; render.ts decodes it) */
function octBytes(n: V): [number, number] {
  const l = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) || 1;
  let u = n[0] / l, v = n[1] / l;
  if (n[2] < 0) { const pu = u; u = (1 - Math.abs(v)) * (pu >= 0 ? 1 : -1); v = (1 - Math.abs(pu)) * (v >= 0 ? 1 : -1); }
  const b = (q: number) => Math.max(0, Math.min(255, Math.round((q + 1) * 127.5)));
  return [b(u), b(v)];
}

export type Drawing = Splats & { mark: Uint8Array; rank: Float32Array; normal: Float32Array; stroke: Uint16Array };

/** the drawing: the stone's marks in one look */
export function oneStone(look: Look = 'dry', S = stoneShape(), seed = 11): Drawing {
  let rs = seed; const r = () => { rs = (rs + 0x6d2b79f5) | 0; let x = Math.imul(rs ^ (rs >>> 15), 1 | rs); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const g = () => { let u = 0; for (let k = 0; k < 4; k++) u += r(); return (u - 2) / 0.58; };
  const out: Array<{ k: number; rank: number; st: number; p: V; ax: [V, V, V]; s: V; c: V; a: number; n1?: V }> = [];
  let strokes = 0;
  /** a new stroke: its rank (when it goes), and how much its most peripheral marks go before its heart */
  const stroke = (R: number, span: number) => { const id = strokes++; return (k: number, w: number, p: V, ax: [V, V, V], s: V, c: V, a: number, n1?: V) => out.push({ k, rank: Math.max(0, Math.min(1, R - span * Math.max(0, Math.min(1, w)))), st: id, p, ax, s, c, a, n1 }); };
  const dry = look === 'dry', lift = (p: V, n: V, h = 0.003) => add(p, mul(n, h));
  const surf = (p: V) => S.ray(S.centre, norm(sub(p, S.centre)));

  // ─── fracture: the seam, broken twice, tapering; its far end goes first, the hook last ───
  const seam = S.seam, L = seam.length;
  const breaks = [0.38, 0.64].map((u) => [u, u + (dry ? 0.022 : 0.01)]);
  // (its shadow side: which way off it is away from the light, for the wash's bleed and the moss)
  const damp = (i: number, n: V) => { const tan = norm(sub(seam[Math.min(L - 1, i + 3)], seam[Math.max(0, i - 3)])); let d = norm(cross(n, tan)); if (dot(d, LIGHT) > 0) d = mul(d, -1); return d; };
  const seamS = stroke(0.98, 0.3), bleedS = stroke(0.6, 0.3);
  for (let i = 0; i < L; i += dry ? 2 : 2) {
    const u = i / (L - 1), tan = norm(sub(seam[Math.min(L - 1, i + 2)], seam[Math.max(0, i - 2)])), h = surf(seam[i]);
    if (!h || breaks.some(([a, b]) => u > a && u < b)) continue;
    const taper = smooth(0, 0.07, u) * smooth(1, 0.8, u), weight = taper * (0.65 + 0.35 * Math.sin(u * 23) ** 2), hookW = 1 + 0.7 * smooth(0.12, 0, u);
    if (weight < 0.08) continue;
    const ax = frame(h.n, tan), w = (dry ? 0.0045 : 0.0035) * weight * hookW, far = u ** 1.4;
    seamS(MARK.fracture, far, lift(h.p, h.n), ax, [dry ? 0.016 : 0.014, w, 0.001], INK, dry ? 0.92 : 0.85);
    if (!dry) {
      // (wet: the line bleeds a little, into the shadow side only, softly)
      const dd = damp(i, h.n), tone = toneOf(h.n, h.region);
      for (let k = 0; k < 2; k++) { const off = 0.006 + 0.012 * r(); bleedS(MARK.fracture, far, lift(add(h.p, mul(dd, off)), h.n, 0.0025), ax, [0.02, 0.006 + 0.008 * r(), 0.001], INK, (0.05 + 0.03 * tone) * weight); }
    }
  }
  // (a branch off it, down the near face; shortening from its tip)
  const bi = Math.floor(L * 0.24), branch = stroke(0.8, 0.2);
  let bp = seam[bi], bdir = norm(add(mul(norm(sub(seam[bi + 6], seam[bi])), 0.4), [0.2, -0.75, 0.45]));
  for (let k = 0; k < 60; k++) {
    const h = surf(add(bp, mul(bdir, 0.008))); if (!h) break;
    const w = (1 - k / 60) * (dry ? 0.003 : 0.0025);
    if (!(k > 26 && k < 31)) branch(MARK.fracture, k / 60, lift(h.p, h.n), frame(h.n, bdir), [0.012, w, 0.001], INK, dry ? 0.85 : 0.7);
    bdir = norm(add(bdir, [Math.sin(k * 0.7) * 0.05, -0.02, 0.03])); bp = h.p;
  }
  // ─── chips: flecks beside the seam (dry), nearest the seam last ───
  if (dry) { const chips = stroke(0.55, 0.3); for (let k = 0; k < 140; k++) {
    const i = Math.floor(r() * L), off: V = [g() * 0.022, g() * 0.022, g() * 0.022], h = surf(add(seam[i], off)); if (!h) continue;
    const s = 0.002 + 0.004 * r() ** 2;
    chips(MARK.chip, len(off) / 0.05, lift(h.p, h.n), frame(h.n, [r() - 0.5, r() - 0.5, r() - 0.5]), [s * 1.6, s, 0.001], INK, 0.85);
  } }
  // ─── lip: the ledge's edge, one line, shortening from both ends ───
  const lipS = stroke(0.94, 0.2), LP = S.lip;
  for (let i = 0; i < LP.length; i++) {
    const h = surf(LP[i]); if (!h) continue;
    const tan = norm(sub(LP[Math.min(LP.length - 1, i + 1)], LP[Math.max(0, i - 1)])), u = i / Math.max(1, LP.length - 1);
    lipS(MARK.lip, Math.abs(2 * u - 1) ** 1.5, lift(h.p, h.n), frame(h.n, tan), [dry ? 0.014 : 0.012, dry ? 0.0035 : 0.003, 0.001], INK, dry ? 0.85 : 0.75);
  }

  // ─── wash: a tone for each face (its exact polygon on its plane) ───
  for (const reg of [...PLANES.keys()].filter((k) => k !== 9).concat([RECESS, SOFFIT])) {
    const { n: n0, h: h0 } = planeOf(reg), tone = toneOf(n0, reg);
    if (tone === 0) continue;
    const face = faceSampler(reg, r), total = face.area, at = face.at;
    if (total < 0.004) continue;
    const toEdge = (p: V) => arris(p, reg).d, onPlane = (q: V) => add(q, mul(n0, h0 - dot(sub(q, CENTRE), n0)));
    // (where the face's pigment pools: its lowest part; under the ledge, nearest the overhang)
    let pool: V = at(), ext = 0;
    for (let k = 0; k < 60; k++) { const q = at(); if (reg === SOFFIT ? dot(sub(q, CENTRE), LEDGE.n) < dot(sub(pool, CENTRE), LEDGE.n) : tone === 3 ? q[1] > pool[1] : q[1] < pool[1]) pool = q; }
    for (let k = 0; k < 40; k++) ext = Math.max(ext, len(sub(at(), pool)));
    // (the wash under the ledge kept long: it's the ledge's weight, and the spare drawing keeps the ledge)
    const washS = tone === 3 ? stroke(reg === SOFFIT ? 0.84 : 0.78, 0.34) : stroke(tone === 2 ? 0.26 : 0.13, 0.16);
    const downhill = Math.abs(n0[1]) > 0.95 ? norm(cross(n0, [1, 0, 0])) : norm(sub(DOWN, mul(n0, dot(DOWN, n0))));
    const w = (p: V) => len(sub(p, pool)) / (ext || 1);
    if (dry) {
      // (hatching: parallel strokes, the face's own direction, closer the darker; none within a hair of the arris)
      const dir = norm(add(cross(n0, [0.3, 1, 0.2]), mul(downhill, 0.6))), count = Math.round(total * [0, 220, 520, 1100][tone]);
      for (let k = 0; k < count; k++) { const p = at(); if (toEdge(p) < 0.015) continue; washS(MARK.wash, w(p), lift(p, n0, 0.002), frame(n0, dir), [0.024, 0.0022, 0.001], INK, 0.5 + 0.12 * tone); }
      continue;
    }
    // (wash: broad soft discs, smaller near the arris so the edge holds; pigment layered by tone)
    const count = Math.round(total * [0, 150, 280, 460][tone]);
    for (let k = 0; k < count; k++) {
      const p = onPlane(at()), e = toEdge(p), rad = Math.min(0.06 + 0.06 * r(), Math.max(0.012, e / 1.6));
      washS(MARK.wash, w(p), lift(p, n0, 0.002), frame(n0, add(downhill, [g() * 0.3, g() * 0.3, g() * 0.3])), [rad * 1.15, rad * 0.85, 0.002], INK, 0.05 + 0.025 * tone);
    }
    // (the pooled rim: pigment gathered just inside the face's lower edges, where a wash's water runs to and dries
    // darker, along the true arris; under the ledge, along its top)
    for (let k = 0; k < Math.round(total * 2600); k++) {
      const p = at(), A = arris(p, reg);
      if (A.d < 0.005 || A.d > 0.017) continue;
      if (!(tone === 3 ? A.j === -1 || reg === SOFFIT : A.nj[1] < n0[1] - 0.05)) continue;
      washS(MARK.wash, w(p) * 0.6, lift(p, n0, 0.0025), frame(n0, A.dir), [0.02, 0.0045, 0.001], INK, 0.06 + 0.03 * tone);
    }
    // (granulation: a few specks settled in the darkest washes)
    if (tone >= 2) for (let k = 0; k < total * 220; k++) { const p = at(); washS(MARK.wash, w(p), lift(p, n0, 0.0025), frame(n0, [1, 0, 0]), [0.0025, 0.002, 0.001], INK, 0.22); }
  }

  // ─── stipple: moss tufts on the seam's damp side, and at the foot; the outliers go first ───
  const tuft = (p: V, n: V, along: V, size: number, count: number, R: number) => {
    const t = stroke(R, 0.4);
    for (let k = 0; k < count; k++) {
      const ga = g(), gb = g(), w = Math.hypot(ga, gb * 2) / 3;
      const q = add(p, add(mul(along, ga * size * 1.6), mul(norm(cross(n, along)), gb * size * 0.7)));
      const h = q[1] < 0.004 ? { p: [q[0], 0.002, q[2]] as V, n: [0, 1, 0] as V } : surf(q); if (!h) continue;
      if (dry || r() < 0.4) { const s = 0.0035 + 0.004 * r(); t(MARK.stipple, w, lift(h.p, h.n), frame(h.n, [r() - 0.5, r() - 0.5, r() - 0.5]), [s * (1 + 0.5 * r()), s, 0.001], MOSS, 0.9); }
      else { const s = 0.01 + 0.014 * r(); t(MARK.stipple, w, lift(h.p, h.n), frame(h.n, [r() - 0.5, r() - 0.5, r() - 0.5]), [s * (1 + 0.5 * r()), s, 0.001], MOSS, 0.3); }
    }
  };
  [0.2, 0.31, 0.7].forEach((u, q) => {
    const i = Math.floor(u * (L - 1)), tan = norm(sub(seam[Math.min(L - 1, i + 3)], seam[Math.max(0, i - 3)])), h = surf(seam[i]); if (!h) return;
    tuft(add(h.p, mul(damp(i, h.n), 0.02)), h.n, tan, 0.032, dry ? 140 : 110, 0.66 - q * 0.04);
  });
  for (const [q, a] of [2.5, 3.4].entries()) {
    const d: V = [Math.cos(a), 0, Math.sin(a)], h = S.ray([0, 0.03, 0], d); if (!h) continue;
    tuft(h.p, [0, 1, 0], norm(cross([0, 1, 0], d)), 0.055, dry ? 160 : 120, 0.54 - q * 0.04);
  }
  // ─── shadow: on the ground at the foot, away from the light; its far reach goes first ───
  const away = norm([-LIGHT[0], 0, -LIGHT[2]]), shadow = stroke(0.92, 0.4), foot = stroke(0.95, 0.15);
  for (let k = 0; k < (dry ? 1800 : 520); k++) {
    const a = r() * Math.PI * 2, d: V = [Math.cos(a), 0, Math.sin(a)], h = S.ray([0, 0.01, 0], d); if (!h) continue;
    const reach = 0.04 + 0.34 * Math.max(0, dot(d, away)) ** 1.5, e = Math.abs(g()) * reach * 0.5;
    const p: V = [h.p[0] + d[0] * e, 0.001, h.p[2] + d[2] * e], near = 1 - e / (reach + 0.001);
    if (dry) shadow(MARK.shadow, 1 - near, p, frame([0, 1, 0], [1, 0, 0.15]), [0.03, 0.0025, 0.001], INK, 0.75 * near + 0.15);
    else { const s = 0.04 + 0.05 * r(); shadow(MARK.shadow, 1 - near, p, frame([0, 1, 0], d), [s * 1.4, s, 0.001], INK, 0.06 + 0.12 * near); }
  }
  // (the found edge: a dark line where the stone meets the ground, on its shadowed side)
  for (let k = 0; k < 240; k++) {
    const a = (k / 240) * Math.PI * 2, d: V = [Math.cos(a), 0, Math.sin(a)], sh = dot(d, away); if (sh < -0.1) continue;
    const h = S.ray([0, 0.004, 0], d); if (!h) continue;
    foot(MARK.shadow, 1 - Math.min(1, sh + 0.1), [h.p[0] + d[0] * 0.004, 0.0015, h.p[2] + d[2] * 0.004], frame([0, 1, 0], [-d[2], 0, d[0]]), [0.016, dry ? 0.003 : 0.0035, 0.001], INK, 0.85);
  }
  // ─── contour: along the arrises, each mark knowing both faces' normals; the shader draws it where one face is turned
  // toward the eye and the other away (the edge is on the profile from here), as short accents, not a whole outline ───
  const lines = arrisLines(dry ? 0.01 : 0.012);
  for (const ln of lines) {
    const n1 = PLANES[ln.i].n, n2 = PLANES[ln.j].n, nm = norm(add(n1, n2)), np = ln.pts.length;
    const cs = stroke(0.72 + 0.14 * r(), 0.35), phase = r() * 6.28, freq = 0.6 + 0.5 * r();
    for (let k = 0; k < np; k++) {
      const u = k / (np - 1);
      // (broken into accents: a slow on and off along it)
      if (Math.sin(phase + k * freq * 0.18) < -0.35) continue;
      const tan = norm(sub(ln.pts[Math.min(np - 1, k + 1)], ln.pts[Math.max(0, k - 1)]));
      const e2 = octBytes(n2);
      cs(MARK.contour, Math.abs(2 * u - 1) ** 2, add(ln.pts[k], mul(nm, 0.003)), frame(nm, tan), [dry ? 0.014 : 0.016, dry ? 0.0028 : 0.0035, 0.001], [e2[0], e2[1], 0], dry ? 0.85 : 0.6, n1);
    }
  }
  const s = Object.assign(alloc(out.length), { mark: new Uint8Array(out.length), rank: new Float32Array(out.length), normal: new Float32Array(out.length * 3), stroke: new Uint16Array(out.length) });
  out.forEach((m, i) => {
    s.pos.set(m.p, i * 3); s.scale.set(m.s, i * 3); s.rot.set(quat(...m.ax), i * 4);
    s.rgba.set([m.c[0], m.c[1], m.c[2], Math.round(Math.min(1, m.a) * 255)], i * 4);
    s.mark[i] = m.k; s.rank[i] = m.rank; s.normal.set(m.n1 ?? m.ax[2], i * 3); s.stroke[i] = Math.min(65535, m.st);
  });
  return s;
}
