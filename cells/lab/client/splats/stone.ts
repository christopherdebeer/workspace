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
import { alloc, type Splats } from './format';

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
const INK: V = [36, 31, 27], MOSS: V = [96, 110, 50];

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
export function faceSampler(reg: number, rnd: () => number): { at: () => V; area: number; on: (p: V) => boolean } {
  const pl = planeOf(reg), n = pl.n, e1 = norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), e2 = cross(n, e1), base = add(mul(n, pl.h), CENTRE), R = 1.4;
  const pick = () => add(base, add(mul(e1, (rnd() * 2 - 1) * R), mul(e2, (rnd() * 2 - 1) * R)));
  let hit = 0; const N = 4000;
  for (let k = 0; k < N; k++) if (onFace(reg, pick())) hit++;
  const at = () => { for (let k = 0; k < 4000; k++) { const p = pick(); if (onFace(reg, p)) return p; } return base; };
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

export type Drawing = Splats & { mark: Uint8Array; rank: Float32Array; normal: Float32Array; stroke: Uint16Array; feature: Uint8Array };
/** the detail at which each composed state is drawn */
export const STATES = { sparse: 0.25, intermediate: 0.55, resolved: 1 } as const;

/** the drawing: the stone's marks in one look */
export function oneStone(look: Look = 'dry', S = stoneShape(), seed = 11): Drawing {
  let rs = seed; const r = () => { rs = (rs + 0x6d2b79f5) | 0; let x = Math.imul(rs ^ (rs >>> 15), 1 | rs); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const g = () => { let u = 0; for (let k = 0; k < 4; k++) u += r(); return (u - 2) / 0.58; };
  type Mk = { k: number; rank: number; st: number; f: number; p: V; ax: [V, V, V]; s: V; c: V; a: number; n1?: V };
  const out: Mk[] = [];
  let strokes = 0;
  /** a stroke of one feature: its rank (its heart's), and how much its periphery goes before its heart */
  const stroke = (feature: number, R: number, span: number) => { const id = strokes++; return (k: number, w: number, p: V, ax: [V, V, V], s: V, c: V, a: number, n1?: V) => out.push({ k, rank: Math.max(0, Math.min(1, R - span * Math.max(0, Math.min(1, w)))), st: id, f: feature, p, ax, s, c, a, n1 }); };
  const dry = look === 'dry', lift = (p: V, n: V, h = 0.003) => add(p, mul(n, h));
  const surf = (p: V) => S.ray(S.centre, norm(sub(p, S.centre)));
  const nearest = (pts: V[], p: V) => { let d = Infinity, k = 0; for (let i = 0; i < pts.length; i++) { const e = len(sub(pts[i], p)); if (e < d) { d = e; k = i; } } return { d, k }; };

  // ─── the seam: its hook kept longest; a wedge of shade in the fracture by the hook; its branch; chips ───
  const seam = S.seam, L = seam.length;
  const damp = (i: number, n: V) => { const tan = norm(sub(seam[Math.min(L - 1, i + 3)], seam[Math.max(0, i - 3)])); let d = norm(cross(n, tan)); if (dot(d, LIGHT) > 0) d = mul(d, -1); return d; };
  const seamS = stroke(FEATURE.seam, 0.99, 0.32), wedge = stroke(FEATURE.seam, 0.9, 0.5);
  const breaks = [0.4, 0.66].map((u) => [u, u + (dry ? 0.02 : 0.012)]);
  for (let i = 0; i < L; i += 2) {
    const u = i / (L - 1), tan = norm(sub(seam[Math.min(L - 1, i + 2)], seam[Math.max(0, i - 2)])), h = surf(seam[i]);
    if (!h || breaks.some(([a, b]) => u > a && u < b)) continue;
    const taper = smooth(0, 0.06, u) * smooth(1, 0.82, u), weight = taper * (0.65 + 0.35 * Math.sin(u * 23) ** 2), hookW = 1 + 0.8 * smooth(0.14, 0, u);
    if (weight < 0.08) continue;
    const ax = frame(h.n, tan);
    seamS(MARK.fracture, u ** 1.3, lift(h.p, h.n), ax, [dry ? 0.016 : 0.014, (dry ? 0.0045 : 0.004) * weight * hookW, 0.001], INK, 0.9);
    // (the wedge: the fracture's shadowed lip, a narrow tone on the damp side, widest by the hook and narrowing along;
    // firm at the seam, softening away)
    const W = 0.07 * (1 - smooth(0, 0.55, u)) + 0.008;
    if (W > 0.012) {
      const dd = damp(i, h.n), reps = dry ? 2 : 3;
      for (let q = 0; q < reps; q++) {
        const off = Math.abs(g()) * W * 0.5, f = Math.min(1, off / W), p = surf(add(h.p, mul(dd, off + 0.004)));
        if (!p) continue;
        if (dry) wedge(MARK.wash, Math.max(u * 1.2, f * 0.8), lift(p.p, p.n), frame(p.n, tan), [0.012 + 0.012 * (1 - f), 0.0018, 0.001], INK, 0.75 - 0.3 * f);
        else { const rad = Math.min(0.006 + 0.03 * f, off + 0.004); wedge(MARK.wash, Math.max(u * 1.2, f * 0.8), lift(p.p, p.n), frame(p.n, tan), [rad * 1.6, rad, 0.001], INK, 0.22 - 0.1 * f); }
      }
    }
  }
  const bi = Math.floor(L * 0.22), branch = stroke(FEATURE.seam, 0.7, 0.3);
  let bp = seam[bi], bdir = norm(add(mul(norm(sub(seam[Math.min(L - 1, bi + 6)], seam[bi])), 0.4), [0.2, -0.75, 0.45]));
  for (let k = 0; k < 56; k++) {
    const h = surf(add(bp, mul(bdir, 0.008))); if (!h) break;
    if (!(k > 24 && k < 29)) branch(MARK.fracture, k / 56, lift(h.p, h.n), frame(h.n, bdir), [0.012, (1 - k / 56) * (dry ? 0.003 : 0.0025), 0.001], INK, 0.8);
    bdir = norm(add(bdir, [Math.sin(k * 0.7) * 0.05, -0.02, 0.03])); bp = h.p;
  }
  const chips = stroke(FEATURE.seam, 0.42, 0.3);
  for (let k = 0; k < (dry ? 120 : 50); k++) {
    const i = Math.floor(r() * L * 0.7), off: V = [g() * 0.02, g() * 0.02, g() * 0.02], h = surf(add(seam[i], off)); if (!h) continue;
    const s = 0.002 + 0.0035 * r() ** 2;
    chips(MARK.chip, len(off) / 0.045, lift(h.p, h.n), frame(h.n, [r() - 0.5, r() - 0.5, r() - 0.5]), [s * 1.6, s, 0.001], INK, 0.85);
  }

  // ─── the ledge: the lip; a firm tone under it, softening in; the dark crevice ───
  const lipS = stroke(FEATURE.ledge, 0.98, 0.25), LP = S.lip;
  LP.forEach((p, i) => {
    const tan = norm(sub(LP[Math.min(LP.length - 1, i + 1)], LP[Math.max(0, i - 1)])), u = i / Math.max(1, LP.length - 1);
    lipS(MARK.lip, Math.abs(2 * u - 1) ** 1.6, add(p, [0, 0.002, 0]), frame(PLANES[LF].n, tan), [dry ? 0.013 : 0.012, dry ? 0.0035 : 0.003, 0.001], INK, 0.9);
  });
  const crev = stroke(FEATURE.ledge, 0.93, 0.35);
  S.crevice.forEach((p, i, arr) => {
    const tan = norm(sub(arr[Math.min(arr.length - 1, i + 1)], arr[Math.max(0, i - 1)])), u = i / Math.max(1, arr.length - 1);
    crev(MARK.shadow, Math.abs(2 * u - 1) ** 1.3, add(p, mul(LEDGE.n, 0.004)), frame(norm(add(LEDGE.n, DOWN)), tan), [0.012, 0.0035, 0.001], INK, 0.95);
  });

  // ─── tonal shapes: each shadowed face, anchored on its terminator (under the ledge, on the lip) ───
  const lines = arrisLines(0.01);
  const regs = [...Array(FOOT).keys(), RECESS, SOFFIT];
  for (const reg of regs) {
    const { n: n0, h: h0 } = planeOf(reg), tone = toneOf(n0, reg);
    if (tone === 0) continue;
    const face = faceSampler(reg, r);
    if (face.area < 0.004) continue;
    // (the anchor: under the ledge, the lip (on the soffit) or the crevice's top (on the recess); else the arris it
    // shares with its lightest neighbour)
    let anchor: V[] = [];
    if (reg === SOFFIT || reg === RECESS) anchor = reg === SOFFIT ? LP : S.crevice;
    else {
      let best = Infinity;
      for (const ln of lines) {
        if (ln.i !== reg && ln.j !== reg) continue;
        const other = ln.i === reg ? ln.j : ln.i, lt = dot(PLANES[other].n, LIGHT);
        if (toneOf(PLANES[other].n, other) < tone && -lt < best) { best = -lt; anchor = ln.pts; }
      }
      if (!anchor.length) for (const ln of lines) if ((ln.i === reg || ln.j === reg) && ln.pts.length > anchor.length) anchor = ln.pts;
    }
    if (anchor.length < 2) continue;
    // (how far the shape reaches from each point of its anchor: uneven, by a slow noise along it)
    const ph = r() * 6.28, ph2 = r() * 6.28, extent = reg === SOFFIT ? 0.7 : reg === RECESS ? 0.5 : [0, 0.32, 0.5, 0.55][tone];
    // (a broad shape, its far boundary uneven: how far it reaches from each point of the anchor)
    const reach = (k: number) => extent * (0.62 + 0.26 * Math.sin(ph + k * 0.07) + 0.12 * Math.sin(ph2 + k * 0.21));
    const under = reg === SOFFIT || reg === RECESS;
    // (the shape's heart: by the middle of its anchor, so a spare drawing keeps a short wedge of it there)
    const shapeOf = stroke(under ? FEATURE.ledge : FEATURE.face + reg, under ? 0.95 : tone === 2 ? 0.86 : 0.62, under ? 0.5 : tone === 2 ? 0.62 : 0.45);
    const heart = (f: number, k: number) => Math.max(f, Math.abs((2 * k) / Math.max(1, anchor.length - 1) - 1) * (under ? 0.6 : 0.95));
    const down = Math.abs(n0[1]) > 0.95 ? norm(cross(n0, [1, 0, 0])) : norm(sub(DOWN, mul(n0, dot(DOWN, n0))));
    const onPlane = (q: V) => add(q, mul(n0, h0 - dot(sub(q, CENTRE), n0)));
    if (dry) {
      // (hatching in a family: along the strike of a shelf face, down the dip of a steep one; in rows, with gaps)
      const shelf = n0[1] > 0.55, dir = under ? norm(cross(n0, LEDGE.n)) : shelf ? norm(cross([0, 1, 0], n0)) : norm(add(down, mul(cross(n0, down), 0.25)));
      const perp = norm(cross(n0, dir)), c = add(mul(n0, h0), CENTRE), rowStep = 0.017, gp = r() * 6.28;
      for (let o = -1.4; o < 1.4; o += rowStep) {
        // (a deliberate empty band now and then)
        if (Math.sin(gp + o * 9) < -0.55) continue;
        for (let t = -1.4; t < 1.4;) {
          const p = add(c, add(mul(perp, o), mul(dir, t)));
          if (!face.on(p)) { t += 0.02; continue; }
          const { d, k } = nearest(anchor, p), D = reach(k), f = d / D;
          if (f >= 1 || r() > Math.pow(1 - f, 0.8)) { t += 0.03; continue; }
          const Ls = 0.016 + 0.05 * (1 - f) * (0.7 + 0.3 * r());
          shapeOf(MARK.wash, heart(f, k), lift(add(p, mul(dir, Ls / 2)), n0, 0.002), frame(n0, dir), [Ls / 2, 0.0019, 0.001], INK, 0.55 + 0.25 * (1 - f) + 0.05 * tone);
          t += Ls + 0.01 + 0.04 * f * r();
        }
      }
    } else {
      // (wash: small and dense at the anchor (never over it), broad and faint toward the uneven boundary)
      // (the firm edge: a dense band laid along the anchor, just inside the face, long along it)
      const heavy = under ? 1.6 : 1;
      for (let k = 0; k < anchor.length; k++) {
        const a0 = anchor[k], tan = norm(sub(anchor[Math.min(anchor.length - 1, k + 1)], anchor[Math.max(0, k - 1)]));
        let inw = norm(cross(n0, tan)); if (!face.on(onPlane(add(a0, mul(inw, 0.02))))) inw = mul(inw, -1);
        if (!face.on(onPlane(add(a0, mul(inw, 0.02))))) continue;
        if (reach(k) < 0.04) continue;
        for (let q = 0; q < 3; q++) { const off = 0.006 + 0.022 * r() ** 1.5, p = onPlane(add(a0, mul(inw, off))); shapeOf(MARK.wash, heart(off / reach(k), k), lift(p, n0, 0.0025), frame(n0, tan), [0.024, 0.008 + 0.006 * r(), 0.001], INK, (0.11 + 0.03 * tone) * heavy * (1 - off * 18)); }
      }
      // (filled to a density, however much of the face the shape takes)
      const want = Math.round(face.area * [0, 260, 420, 600][tone] * (under ? 1.5 : 1) * 0.6);
      for (let q = 0, got = 0; got < want && q < want * 12; q++) {
        const p = onPlane(face.at()), { d, k } = nearest(anchor, p), D = reach(k), f = d / D;
        if (f >= 1) continue;
        got++;
        const rad = Math.min(0.014 + 0.08 * f * (0.6 + 0.4 * r()), Math.max(0.007, d * 0.9));
        shapeOf(MARK.wash, heart(f, k), lift(p, n0, 0.002), frame(n0, [g(), g(), g()]), [rad * 1.08, rad * 0.92, 0.002], INK, (0.17 - 0.1 * f) * (0.7 + 0.15 * tone) * heavy);
      }
      // (granulation where the tone is densest)
      for (let q = 0; q < face.area * 140; q++) { const p = face.at(), { d, k } = nearest(anchor, p), f = d / reach(k); if (f < 0.6) shapeOf(MARK.wash, heart(f, k), lift(p, n0, 0.0025), frame(n0, [1, 0, 0]), [0.0025, 0.002, 0.001], INK, 0.2); }
    }
  }

  // ─── the crown: one turn of it kept, by its high point; the broken corner's accent ───
  const CR = S.crown;
  if (CR.length > 2) {
    let top = 0; CR.forEach((p, i) => { if (p[1] > CR[top][1]) top = i; });
    const crownS = stroke(FEATURE.crown, 0.92, 0.55), half = Math.min(CR.length / 2, 26);
    CR.forEach((p, i) => {
      const w = Math.abs(i - top) / half; if (w > 1) return;
      const tan = norm(sub(CR[Math.min(CR.length - 1, i + 1)], CR[Math.max(0, i - 1)])), nm = norm(add(PLANES[CROWN_A].n, PLANES[CROWN_B].n));
      crownS(MARK.lip, w, add(p, mul(nm, 0.003)), frame(nm, tan), [0.013, 0.004 * (1 - 0.5 * w), 0.001], INK, 0.9);
    });
  }
  const brokenLines = lines.filter((l) => l.i === BROKEN || l.j === BROKEN).sort((a, b) => b.pts.length - a.pts.length);
  if (brokenLines.length) {
    const bl = brokenLines[0].pts, bS = stroke(FEATURE.face + BROKEN, 0.86, 0.6), nm = norm(add(PLANES[brokenLines[0].i].n, PLANES[brokenLines[0].j].n));
    bl.forEach((p, i) => { const u = i / (bl.length - 1), w = Math.abs(2 * u - 1); const tan = norm(sub(bl[Math.min(bl.length - 1, i + 1)], bl[Math.max(0, i - 1)])); bS(MARK.lip, w, add(p, mul(nm, 0.003)), frame(nm, tan), [0.012, 0.003, 0.001], INK, 0.85); });
  }

  // ─── moss: one cluster on the seam kept; others subordinate ───
  const tuft = (p: V, n: V, along: V, size: number, count: number, R: number, feature: number) => {
    const t = stroke(feature, R, 0.45);
    for (let k = 0; k < count; k++) {
      const ga = g(), gb = g(), w = Math.hypot(ga, gb * 2) / 3;
      const q = add(p, add(mul(along, ga * size * 1.5), mul(norm(cross(n, along)), gb * size * 0.7)));
      const h = q[1] < 0.004 ? { p: [q[0], 0.002, q[2]] as V, n: [0, 1, 0] as V } : surf(q); if (!h) continue;
      if (dry || r() < 0.45) { const s = 0.0035 + 0.004 * r(); t(MARK.stipple, w, lift(h.p, h.n), frame(h.n, [r() - 0.5, r() - 0.5, r() - 0.5]), [s * (1 + 0.5 * r()), s, 0.001], MOSS, 0.9); }
      else { const s = 0.01 + 0.013 * r(); t(MARK.stipple, w, lift(h.p, h.n), frame(h.n, [r() - 0.5, r() - 0.5, r() - 0.5]), [s * (1 + 0.5 * r()), s, 0.001], MOSS, 0.32); }
    }
  };
  [[0.18, 0.9], [0.32, 0.62], [0.72, 0.5]].forEach(([u, R]) => {
    const i = Math.floor(u * (L - 1)), tan = norm(sub(seam[Math.min(L - 1, i + 3)], seam[Math.max(0, i - 3)])), h = surf(seam[i]); if (!h) return;
    tuft(add(h.p, mul(damp(i, h.n), 0.018)), h.n, tan, 0.03, R > 0.8 ? 160 : dry ? 110 : 90, R, FEATURE.seam);
  });

  // ─── the foot: two or three dark contacts; the base broken and light; a cast shadow with a direction ───
  const away = norm([-LIGHT[0], 0, -LIGHT[2]]);
  const contacts = [norm([LEDGE.n[0], 0, LEDGE.n[2]]), norm([PLANES[6].n[0], 0, PLANES[6].n[2]]), norm([PLANES[8].n[0], 0, PLANES[8].n[2]])];
  for (const d of contacts) {
    const h = S.ray([0, 0.004, 0], d); if (!h) continue;
    const cS = stroke(FEATURE.foot, 0.96, 0.4), side = norm(cross([0, 1, 0], d));
    for (let k = 0; k < 26; k++) {
      const o = g() * 0.045, e = Math.abs(g()) * 0.012, p: V = [h.p[0] + side[0] * o + d[0] * (0.003 + e), 0.0015, h.p[2] + side[2] * o + d[2] * (0.003 + e)];
      cS(MARK.shadow, Math.abs(o) / 0.09, p, frame([0, 1, 0], side), [0.012, 0.003 + 0.002 * (1 - Math.abs(o) / 0.09), 0.001], INK, 0.85);
    }
  }
  // (the cast shadow: the stone's outline pushed along the light onto the ground, its tone firm at the foot on the far
  // side and fading out along the light; the base itself only lightly, and broken)
  const shadowS = stroke(FEATURE.foot, 0.72, 0.6), baseS = stroke(FEATURE.foot, 0.55, 0.4);
  const shift = mul(LIGHT, -1 / LIGHT[1]);
  const hullPts: Array<[number, number]> = [];
  for (let i = 0; i < S.pos.length; i += 3) { const y = S.pos[i + 1]; hullPts.push([S.pos[i] + shift[0] * y, S.pos[i + 2] + shift[2] * y], [S.pos[i], S.pos[i + 2]]); }
  const H = hull(hullPts);
  const inHull = (x: number, z: number) => { let c = false; for (let i = 0, j = H.length - 1; i < H.length; j = i++) { const [xi, zi] = H[i], [xj, zj] = H[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  for (let k = 0; k < (dry ? 1400 : 700); k++) {
    const a = r() * Math.PI * 2, d: V = [Math.cos(a), 0, Math.sin(a)], h = S.ray([0, 0.004, 0], d); if (!h) continue;
    const along = Math.max(0, dot(d, away)), e = Math.abs(g()) * (0.03 + 0.5 * along ** 1.4) * 0.6;
    const p: V = [h.p[0] + d[0] * e, 0.001, h.p[2] + d[2] * e];
    if (!inHull(p[0], p[2]) && e > 0.03) continue;
    const f = Math.min(1, e / (0.04 + 0.32 * along ** 1.4));
    // (the base where it's lit: light, broken; the cast shadow away from the light: its own stroke)
    if (along < 0.15) { if (Math.sin(a * 7 + 1.3) < 0.2) continue; baseS(MARK.shadow, f, p, frame([0, 1, 0], [-d[2], 0, d[0]]), [0.014, 0.0022, 0.001], INK, 0.4); continue; }
    if (dry) shadowS(MARK.shadow, f, p, frame([0, 1, 0], away), [0.026 * (1 - 0.5 * f), 0.0022, 0.001], INK, 0.7 * (1 - f) + 0.15);
    else { const s = 0.02 + 0.05 * f; shadowS(MARK.shadow, f, p, frame([0, 1, 0], away), [s * 1.5, s, 0.001], INK, 0.16 - 0.1 * f); }
  }
  // (foot moss, subordinate)
  { const d = norm([PLANES[5].n[0], 0, PLANES[5].n[2]]), h = S.ray([0, 0.03, 0], d); if (h) tuft(h.p, [0, 1, 0], norm(cross([0, 1, 0], d)), 0.05, dry ? 110 : 90, 0.45, FEATURE.foot); }

  // ─── contour: along the arrises, shown where the profile is from here (render.ts), as accents; subordinate ───
  for (const ln of lines) {
    if ((ln.i === CROWN_A && ln.j === CROWN_B) || ln.i === BROKEN || ln.j === BROKEN) continue;
    const n1 = PLANES[ln.i].n, n2 = PLANES[ln.j].n, nm = norm(add(n1, n2)), np = ln.pts.length;
    const cs = stroke(FEATURE.none, 0.62 + 0.14 * r(), 0.4), phase = r() * 6.28, freq = 0.6 + 0.5 * r(), e2 = octBytes(n2);
    for (let k = 0; k < np; k++) {
      if (Math.sin(phase + k * freq * 0.18) < -0.3) continue;
      const tan = norm(sub(ln.pts[Math.min(np - 1, k + 1)], ln.pts[Math.max(0, k - 1)]));
      cs(MARK.contour, Math.abs(2 * (k / (np - 1)) - 1) ** 2, add(ln.pts[k], mul(nm, 0.003)), frame(nm, tan), [0.014, dry ? 0.0028 : 0.003, 0.001], [e2[0], e2[1], 0], dry ? 0.8 : 0.6, n1);
    }
  }

  const s = Object.assign(alloc(out.length), { mark: new Uint8Array(out.length), rank: new Float32Array(out.length), normal: new Float32Array(out.length * 3), stroke: new Uint16Array(out.length), feature: new Uint8Array(out.length) });
  out.forEach((m, i) => {
    s.pos.set(m.p, i * 3); s.scale.set(m.s, i * 3); s.rot.set(quat(...m.ax), i * 4);
    s.rgba.set([m.c[0], m.c[1], m.c[2], Math.round(Math.min(1, Math.max(0, m.a)) * 255)], i * 4);
    s.mark[i] = m.k; s.rank[i] = m.rank; s.normal.set(m.n1 ?? m.ax[2], i * 3); s.stroke[i] = Math.min(65535, m.st); s.feature[i] = Math.min(15, m.f);
  });
  return s;
}

/** the convex hull of points in the plane (monotone chain) */
function hull(pts: Array<[number, number]>): Array<[number, number]> {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Array<[number, number]> = [], hi: Array<[number, number]> = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
