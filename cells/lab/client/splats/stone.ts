/**
 * One Stone: a drawing of a split boulder on warm paper, made of splats, where each feature of the stone draws itself.
 *
 * **The shape** (`Stone`) is a cut stone of unequal geological planes: a crown that's two planes meeting off-centre
 * (high toward its tall end, falling away to the tapering one: a wedge), bevels and slabs of different sizes, one
 * broken corner, and on its back-left a substantial projecting slab: the face above a line overhangs a recess cut
 * deep under it, with a flat underside (the *soffit*) and a narrow crevice where soffit meets recess. A **seam** runs
 * in a fracture plane, hooking over the crown from the near face and down the far one. Everything is exact: the mesh is
 * each plane's polygon cut by the others (`stoneShape`), rays meet the planes (`polyRay`), faces are sampled as their
 * own polygons (`faceSampler`), edges are the true arrises (`arris`, `arrisLines`). The mesh, drawn into the depth
 * buffer only, hides what's behind it (render.ts).
 *
 * **The drawing is composed, not catalogued.** Every mark belongs to a stroke, every stroke to a *feature* (the seam,
 * the ledge, the foot, the crown, or a face), and each stroke has a rank and a heart: its marks' ranks fall off from
 * the heart, so a feature reduces within itself before it goes. Three states are composed deliberately:
 * - **sparse** (detail ¼): a core of eight or so groups, each kept small: the seam with its hook, a short wedge of shade
 *   in the fracture by the hook, the ledge's lip with a firm tone under it and the dark crevice, one turn of the crown,
 *   the broken corner's accent, one moss cluster on the seam, and two or three dark contact points at the foot.
 * - **intermediate** (detail ½): those grown, and the faces' tonal shapes near their anchors, the seam's branch, a
 *   second tuft, a cast shadow with a direction, profile accents (from this view).
 * - **resolved**: the tonal shapes in full, granulation, chips, loose stipple, every hatch.
 *
 * **Tonal shapes.** A face in shadow takes a shape of tone anchored on an edge (the arris it shares with a lighter
 * face, its terminator; under the ledge, the lip): firm at the anchor, softening away from it, its far boundary uneven
 * (a noise along the anchor sets how far the shape reaches at each point). In the *wash* look, discs: small and dense at
 * the anchor (never crossing it), broad and faint toward the boundary. In the *dry* look, hatching in directional
 * families (along the strike of a shelf face, down the dip of a steep one), in rows with deliberate gaps, the strokes
 * long and close at the anchor and shorter, sparser toward the boundary.
 *
 * **The brush** develops a feature: touching the seam brings out its branch, chips and moss; touching under the ledge
 * develops its underside; a face, its tonal shape (`featureAt`; render.ts reveals a feature by its own ranks).
 */

export const MARK = { plain: 0, fracture: 1, wash: 2, stipple: 3, contour: 4, shadow: 5, lip: 6, chip: 7 } as const;
/** the features a mark belongs to (a face's is FACE + its plane) */
export const FEATURE = { none: 0, seam: 1, ledge: 2, foot: 3, crown: 4, face: 5 } as const;
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

/** where the light comes from (upper left, toward the viewer): what's in shadow takes the tone, the damp side the moss */
export const LIGHT = norm([-0.55, 0.75, 0.35]);

/** the cut stone's planes: each a normal and its distance from the middle (unequal on purpose) */
const PLANES: Array<{ n: V; h: number; name: string }> = [
  { n: norm([-0.22, 1, 0.12]), h: 0.47, name: 'crown, high side' },
  { n: norm([0.62, 1, -0.08]), h: 0.37, name: 'crown, falling side' },
  { n: norm([0.08, 0.72, 0.78]), h: 0.57, name: 'near bevel' },
  { n: norm([-0.05, 0.78, -0.7]), h: 0.55, name: 'far bevel' },
  { n: norm([0.15, 0.08, 1]), h: 0.62, name: 'near slab' },
  { n: norm([-0.12, 0.04, -1]), h: 0.6, name: 'far slab' },
  { n: norm([-1, 0.06, 0.28]), h: 0.9, name: 'tall end' },
  { n: norm([1, 0.55, 0.12]), h: 0.74, name: 'tapering end' },
  { n: norm([0.78, 0.12, 0.62]), h: 0.82, name: 'near right' },
  { n: norm([-0.62, 0.3, -0.72]), h: 0.78, name: 'the ledge\'s face' },
  { n: norm([-0.55, 0.62, 0.56]), h: 0.66, name: 'broken corner' },
  { n: [0, -1, 0], h: 0.45, name: 'foot' },
];
export const LF = 9, BROKEN = 10, FOOT = 11, CROWN_A = 0, CROWN_B = 1;
export const PLANE_NORMALS = () => PLANES.map((p) => p.n);
const CENTRE: V = [0, 0.45, 0];
/** the ledge: below this height on the back-left, the stone's cut back deep to an inner plane */
const LEDGE_Y = 0.44, LEDGE = { n: norm([-0.66, 0, -0.75]), h: 0.46 };
export const RECESS = PLANES.length;
/** the ledge's soffit: the flat underside of the overhang, between its face and the recess */
export const SOFFIT = PLANES.length + 1;
const DOWN: V = [0, -1, 0];
export const planeOf = (reg: number) => (reg === RECESS ? LEDGE : reg === SOFFIT ? { n: DOWN, h: CENTRE[1] - LEDGE_Y } : PLANES[reg]);
/** whether a point (from the middle) is on the stone: inside every plane, above the ground, not in the recess */
const inside = (q: V, eps = 1e-4) => q[1] + CENTRE[1] > -eps && !PLANES.some((pl) => dot(q, pl.n) > pl.h + eps) && !(q[1] + CENTRE[1] < LEDGE_Y - eps && dot(q, LEDGE.n) > LEDGE.h + eps);

/** a ray on the cut stone, exactly: from inside (the middle), where it leaves; from outside (an eye), where it enters */
export function polyRay(o: V, d: V): { p: V; n: V; t: number; region: number } | null {
  const q = sub(o, CENTRE);
  if (inside(q)) {
    let t = Infinity, reg = -1;
    PLANES.forEach((pl, k) => { const c = dot(d, pl.n); if (c > 1e-6) { const tt = (pl.h - dot(q, pl.n)) / c; if (tt < t) { t = tt; reg = k; } } });
    const p = add(o, mul(d, t));
    if (p[1] < LEDGE_Y) {
      const c = dot(d, LEDGE.n);
      if (c > 1e-6) { const tr = (LEDGE.h - dot(q, LEDGE.n)) / c; if (tr < t) { const pr = add(o, mul(d, tr)); if (pr[1] < LEDGE_Y) return { p: pr, n: LEDGE.n, t: tr, region: RECESS }; const ts = (LEDGE_Y - o[1]) / d[1]; if (d[1] < 0 && ts > 0 && ts < t) return { p: add(o, mul(d, ts)), n: DOWN, t: ts, region: SOFFIT }; } }
    }
    return { p, n: reg >= 0 ? PLANES[reg].n : [0, 1, 0], t, region: reg };
  }
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
    if (d[1] > 0) { const ts = (LEDGE_Y - o[1]) / d[1], ps = add(o, mul(d, ts)); if (inside(sub(ps, CENTRE), 1e-3)) return { p: ps, n: DOWN, t: ts, region: SOFFIT }; }
    return null;
  }
  return { p, n: PLANES[reg].n, t: t0, region: reg };
}

/** whether a point (world) lies on a region's face */
function onFace(reg: number, p: V): boolean {
  const q = sub(p, CENTRE);
  if (reg === SOFFIT) return inside(add(q, [0, 0.002, 0]), 1e-3) && dot(q, LEDGE.n) > LEDGE.h && dot(q, PLANES[LF].n) < PLANES[LF].h;
  if (reg === RECESS) return q[1] + CENTRE[1] < LEDGE_Y && q[1] + CENTRE[1] > 0 && !PLANES.some((p2) => dot(q, p2.n) > p2.h + 1e-4);
  return inside(q, 1e-4);
}
/** a region's face, exactly: points on it at random, its area, and its plane's frame */
export function faceSampler(reg: number, rnd: () => number): { at: (r?: () => number) => V; area: number; on: (p: V) => boolean } {
  const pl = planeOf(reg), n = pl.n, e1 = norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), e2 = cross(n, e1), base = add(mul(n, pl.h), CENTRE), R = 1.4;
  const pick = (r = rnd) => add(base, add(mul(e1, (r() * 2 - 1) * R), mul(e2, (r() * 2 - 1) * R)));
  let hit = 0; const N = 4000;
  for (let k = 0; k < N; k++) if (onFace(reg, pick())) hit++;
  // (a point of the face, from the caller's random stream if given)
  const at = (r = rnd) => { for (let k = 0; k < 4000; k++) { const p = pick(r); if (onFace(reg, p)) return p; } return base; };
  return { at, area: (hit / N) * (2 * R) ** 2, on: (p) => onFace(reg, p) };
}

export interface Stone {
  /** the exact faceted shape: vertices, and triangles (three indices each), wound outward */
  pos: Float32Array; tris: Uint32Array; normals: Float32Array; centre: V;
  /** each triangle's region: its plane, RECESS or SOFFIT */
  region: Int16Array;
  ray(o: V, d: V): { p: V; n: V; t: number; region: number } | null;
  /** the seam, the ledge's lip, the crevice under it, and the crown's ridge, as polylines on the surface */
  seam: V[]; lip: V[]; crevice: V[]; crown: V[];
  /** which feature a touch at a point (and its region) belongs to: the brush's */
  featureAt(p: V, region: number): number;
}

function clip(poly: V[], n: V, h: number): V[] {
  const out: V[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length], da = dot(a, n) - h, db = dot(b, n) - h;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) out.push(add(a, mul(sub(b, a), da / (da - db))));
  }
  return out;
}
function facePoly(n: V, h: number, cuts: Array<[V, number]>): V[] {
  const e1 = norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), e2 = cross(n, e1), c = mul(n, h), R = 3;
  let poly: V[] = [add(c, add(mul(e1, -R), mul(e2, -R))), add(c, add(mul(e1, R), mul(e2, -R))), add(c, add(mul(e1, R), mul(e2, R))), add(c, add(mul(e1, -R), mul(e2, R)))];
  for (const [m, hm] of cuts) { poly = clip(poly, m, hm); if (poly.length < 3) return []; }
  return poly;
}

/** a straight line on the stone between two constraints, sampled where it's on the surface */
function lineOn(q0: V, dir: V, ok: (q: V) => boolean, step = 0.01): V[] {
  const out: V[] = [];
  for (let k = -200; k <= 200; k++) { const q = add(q0, mul(dir, k * step)); if (ok(q)) out.push(add(q, CENTRE)); }
  return out;
}

/** the boulder's shape (the same for both looks) */
export function stoneShape(): Stone {
  const P: V[] = [], T: number[] = [], N: number[] = [], RG: number[] = [];
  const addPoly = (poly: V[], n: V, reg: number) => {
    if (poly.length < 3) return;
    const i0 = P.length; poly.forEach((q) => P.push(add(q, CENTRE)));
    const cw = dot(cross(sub(poly[1], poly[0]), sub(poly[2], poly[0])), n) < 0;
    for (let k = 1; k + 1 < poly.length; k++) { if (cw) T.push(i0, i0 + k + 1, i0 + k); else T.push(i0, i0 + k, i0 + k + 1); N.push(...n); RG.push(reg); }
  };
  const others = (skip: number) => PLANES.map((pl) => [pl.n, pl.h] as [V, number]).filter((_, k) => k !== skip);
  const ly = LEDGE_Y - CENTRE[1];
  PLANES.forEach((pl, k) => {
    const base = others(k);
    addPoly(facePoly(pl.n, pl.h, [...base, [[0, -1, 0], -ly]]), pl.n, k);
    addPoly(facePoly(pl.n, pl.h, [...base, [[0, 1, 0], ly], [LEDGE.n, LEDGE.h]]), pl.n, k);
  });
  addPoly(facePoly(LEDGE.n, LEDGE.h, [...others(-1), [[0, 1, 0], ly]]), LEDGE.n, RECESS);
  addPoly(facePoly(DOWN, -ly, [...others(-1), [mul(LEDGE.n, -1), -LEDGE.h]]), DOWN, SOFFIT);
  const ray = polyRay;
  // (the seam: in a fracture plane off the middle, from the near face over the crown and down the far face, hooking)
  const m = norm([0.86, 0.1, -0.5]), up: V = [0, 1, 0], a = norm(sub(up, mul(m, dot(up, m))));
  let b = cross(m, a); if (dot(b, [0.56, 0, 0.82]) < 0) b = mul(b, -1);
  const seamRaw: V[] = [];
  for (let k = 0; k <= 400; k++) {
    const tt = -1.25 + (k / 400) * 2.95, hook = 0.5 * smooth(-0.8, -1.25, tt);
    const d = norm(add(add(mul(a, Math.cos(tt)), mul(b, Math.sin(tt))), mul(m, 0.1 + hook + 0.015 * Math.sin(tt * 9))));
    const h = ray(CENTRE, d); if (h && h.p[1] > 0.03 && h.region !== RECESS && h.region !== SOFFIT) seamRaw.push(h.p);
  }
  // (the lip: where the ledge's face meets the soffit; the crevice: where the soffit meets the recess)
  const nf = PLANES[LF].n, qy = ly, kk = (PLANES[LF].h - nf[1] * qy) / (nf[0] * nf[0] + nf[2] * nf[2]);
  const lip = lineOn([nf[0] * kk, qy, nf[2] * kk], norm([-nf[2], 0, nf[0]]), (q) => !PLANES.some((pl, j) => j !== LF && dot(q, pl.n) > pl.h + 0.002));
  const kc = LEDGE.h / (LEDGE.n[0] ** 2 + LEDGE.n[2] ** 2);
  const crevice = lineOn([LEDGE.n[0] * kc, qy, LEDGE.n[2] * kc], norm([-LEDGE.n[2], 0, LEDGE.n[0]]), (q) => !PLANES.some((pl) => dot(q, pl.n) > pl.h + 0.002));
  const crownLine = arrisLines(0.01).find((l) => l.i === CROWN_A && l.j === CROWN_B)?.pts ?? [];
  const near = (pts: V[], p: V) => pts.reduce((mn, q) => Math.min(mn, len(sub(q, p))), Infinity);
  const featureAt = (p: V, region: number) => {
    if (near(seamRaw, p) < 0.08) return FEATURE.seam;
    if (region === RECESS || region === SOFFIT || near(lip, p) < 0.1) return FEATURE.ledge;
    if (p[1] < 0.07) return FEATURE.foot;
    if (near(crownLine, p) < 0.07) return FEATURE.crown;
    return region >= 0 && region < FOOT ? FEATURE.face + region : FEATURE.none;
  };
  return { pos: new Float32Array(P.flat()), tris: new Uint32Array(T), normals: new Float32Array(N), centre: CENTRE, region: new Int16Array(RG), ray, seam: resample(seamRaw, 0.006), lip, crevice, crown: crownLine, featureAt };
}

/** the stone's arrises, exactly, for each pair of planes: the stretch of the line where they meet that's on the stone */
export function arrisLines(step = 0.012): Array<{ i: number; j: number; pts: V[] }> {
  const out: Array<{ i: number; j: number; pts: V[] }> = [];
  for (let i = 0; i < FOOT; i++) for (let j = i + 1; j < FOOT; j++) {
    const A = PLANES[i], B = PLANES[j], u = cross(A.n, B.n);
    if (dot(u, u) < 1e-4) continue;
    const c = dot(A.n, B.n), det = 1 - c * c, ka = (A.h - B.h * c) / det, kb = (B.h - A.h * c) / det, q0 = add(mul(A.n, ka), mul(B.n, kb)), ud = norm(u);
    let run: V[] = [];
    for (let k = -200; k <= 200; k++) {
      const q = add(q0, mul(ud, k * step)), y = q[1] + CENTRE[1];
      const on = y > 0.004 && !PLANES.some((pl, mm) => mm !== i && mm !== j && dot(q, pl.n) > pl.h + 1e-4) && !(y < LEDGE_Y && dot(q, LEDGE.n) > LEDGE.h);
      if (on) run.push(add(q, CENTRE)); else if (run.length) { if (run.length > 2) out.push({ i, j, pts: run }); run = []; }
    }
    if (run.length > 2) out.push({ i, j, pts: run });
  }
  return out;
}

function resample(p: V[], step: number): V[] {
  if (!p.length) return p;
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
function quat(x: V, y: V, z: V): [number, number, number, number] {
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2], tr = m00 + m11 + m22;
  let w, a, b, c;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; a = (m21 - m12) / s; b = (m02 - m20) / s; c = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; a = s / 4; b = (m01 + m10) / s; c = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; a = (m01 + m10) / s; b = s / 4; c = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; a = (m02 + m20) / s; b = (m12 + m21) / s; c = s / 4; }
  const l = Math.hypot(w, a, b, c); return [w / l, a / l, b / l, c / l];
}
function frame(n: V, along: V): [V, V, V] {
  let t = sub(along, mul(n, dot(along, n)));
  if (len(t) < 1e-6) t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  t = norm(sub(t, mul(n, dot(t, n))));
  return [t, cross(n, t), n];
}

/** how dark a face's tone is, by how it's turned from the light: 0 lit, 1 half-lit, 2 in shadow, 3 under the ledge */
export function toneOf(n: V, region: number): number {
  if (region === RECESS || region === SOFFIT || n[1] < -0.2) return 3;
  const l = dot(n, LIGHT);
  return l > 0.5 ? 0 : l > 0.2 ? 1 : 2;
}
/** how far a point on a face is from that face's nearest true arris (along the face) */
export function arris(p: V, reg: number): { d: number; j: number; dir: V; nj: V } {
  const ni = planeOf(reg).n, q = sub(p, CENTRE);
  let best = { d: Infinity, j: -2, dir: [1, 0, 0] as V, nj: [0, 1, 0] as V };
  PLANES.forEach((pl, j) => {
    if (j === reg) return;
    const c = dot(ni, pl.n); if (c > 0.995) return;
    const d = (pl.h - dot(q, pl.n)) / Math.sqrt(1 - c * c);
    if (d >= -0.01 && d < best.d) best = { d: Math.max(0, d), j, dir: norm(cross(ni, pl.n)), nj: pl.n };
  });
  return best;
}
export function octBytes(n: V): [number, number] {
  const l = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) || 1;
  let u = n[0] / l, v = n[1] / l;
  if (n[2] < 0) { const pu = u; u = (1 - Math.abs(v)) * (pu >= 0 ? 1 : -1); v = (1 - Math.abs(pu)) * (v >= 0 ? 1 : -1); }
  const b = (q: number) => Math.max(0, Math.min(255, Math.round((q + 1) * 127.5)));
  return [b(u), b(v)];
}

/** the detail at which each composed state is drawn */
export const STATES = { sparse: 0.25, intermediate: 0.55, resolved: 1 } as const;

