/**
 * One Stone: a drawing of a split boulder on warm paper, made of splats, where each feature of the stone draws itself.
 *
 * The shape (`Stone`) is a coarse faceted boulder: an icosphere pushed out by a little noise, its foot flat on the
 * ground, one **ledge** (the lower part of its back-left side recessed, so the part above overhangs it) and one
 * **seam** (a curve hooking over the crown from the near face and running down the far one). The same faceted shape
 * places the marks and, drawn first into the depth buffer only, hides the marks on its far side (render.ts), so a
 * face left blank still stands in front of what's behind it.
 *
 * The marks, each a kind (`MARK`) and a rank (how long it survives as the drawing simplifies, 1 the last to go):
 * - **fracture**: the seam, as overlapping splats long along its tangent, spaced and weighted along it so it breaks
 *   and tapers; a shorter branch off it. Belongs to the rock: it turns with it and goes behind it.
 * - **lip**: the ledge's edge, a line along the facets where the overhang starts.
 * - **wash**: the faces in shadow, and above all the underside of the ledge: in the dry look short parallel hatching,
 *   in the wet look broad faint discs that pool where they overlap. The lit face left open. First to go.
 * - **stipple**: moss, in three tufts caught on the seam on its damp (shadowed) side and two at the stone's foot; each
 *   a dense core and loose outliers, the outliers going first so the tuft still reads.
 * - **shadow**: the contact shadow on the ground, hugging the foot, away from the light.
 * - **contour**: candidates all over the surface, flat discs lying on it. A disc lying flat on a surface seen edge on
 *   projects to a short line along the profile, so with the shader fading each by how far its face is from edge-on
 *   (render.ts), they draw accents along whatever is the profile from here, fading in and out over a range of angles
 *   rather than snapping. Belongs to the view, not the rock.
 * - **chip**: small dark flecks near the seam (the dry look's).
 *
 * Two looks of the same stone, camera and about the same number of marks: **dry** (dark broken seams, chips, hatching,
 * a lot of clean paper) and **wash** (the Gaussian's own softness: pooled wash, feathered seams, soft moss).
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
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** where the light comes from (upper left, toward the viewer): what's in shadow takes the wash, the damp side the moss */
export const LIGHT = norm([-0.55, 0.75, 0.35]);
const INK: V = [36, 31, 27], MOSS: V = [96, 110, 50];

export interface Stone {
  /** the faceted shape: vertices, and triangles (three indices each), wound outward */
  pos: Float32Array; tris: Uint32Array; normals: Float32Array; centre: V;
  /** the nearest hit of a ray on it: where, which face's normal, how far */
  ray(o: V, d: V): { p: V; n: V; t: number } | null;
  /** the seam and the ledge's lip, as polylines on the surface */
  seam: V[]; lip: Array<[V, V]>;
}

/** the boulder's shape (the same for both looks) */
export function stoneShape(): Stone {
  // (an icosphere, subdivided three times)
  const t = (1 + Math.sqrt(5)) / 2;
  let vs: V[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => norm(v as V));
  let fs: number[][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < 3; s++) {
    const mid = new Map<string, number>(), m = (a: number, b: number) => { const k = a < b ? `${a},${b}` : `${b},${a}`; let i = mid.get(k); if (i === undefined) { i = vs.length; vs.push(norm(mul(add(vs[a], vs[b]), 0.5))); mid.set(k, i); } return i; };
    const nf: number[][] = [];
    for (const [a, b, c] of fs) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    fs = nf;
  }
  // (each direction pushed out to the boulder: an ellipsoid, a little noise, the ledge's recess, the foot flat)
  const centre: V = [0, 0.42, 0], SC: V = [1.15, 0.72, 0.92], side = norm([-0.7, 0, -0.7]);
  const noise = (d: V) => 0.07 * Math.sin(d[0] * 3.1 + d[1] * 1.7) + 0.05 * Math.sin(d[2] * 4.3 - d[0] * 2.1) + 0.03 * Math.sin((d[0] + d[1] - d[2]) * 7.7);
  const recessed = vs.map((d) => dot(d, side) > 0.3 && d[1] < 0.08);
  const P = vs.map((d, i) => { const r = (1 + noise(d)) * (recessed[i] ? 0.8 : 1); const p = add(centre, [d[0] * SC[0] * r, d[1] * SC[1] * r, d[2] * SC[2] * r]); p[1] = Math.max(0, p[1]); return p; });
  const pos = new Float32Array(P.flat()), tris = new Uint32Array(fs.flat()), normals = new Float32Array(fs.length * 3);
  fs.forEach(([a, b, c], f) => { let n = norm(cross(sub(P[b], P[a]), sub(P[c], P[a]))); const g = mul(add(add(P[a], P[b]), P[c]), 1 / 3); if (dot(n, sub(g, centre)) < 0) { n = mul(n, -1); tris[f * 3 + 1] = c; tris[f * 3 + 2] = b; } normals.set(n, f * 3); });
  const ray = (o: V, d: V) => {
    let best: { p: V; n: V; t: number } | null = null;
    for (let f = 0; f < fs.length; f++) {
      const a = P[tris[f * 3]], b = P[tris[f * 3 + 1]], c = P[tris[f * 3 + 2]], e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h);
      if (Math.abs(det) < 1e-9) continue;
      const s = sub(o, a), u = dot(s, h) / det; if (u < 0 || u > 1) continue;
      const q = cross(s, e1), v = dot(d, q) / det; if (v < 0 || u + v > 1) continue;
      const tt = dot(e2, q) / det;
      if (tt > 1e-5 && (!best || tt < best.t)) best = { p: add(o, mul(d, tt)), n: [normals[f * 3], normals[f * 3 + 1], normals[f * 3 + 2]], t: tt };
    }
    return best;
  };
  // (the seam: a curve in a tilted plane off the middle, hooking at its near end, from the near face over the crown and
  // down the far face; found on the surface by casting from the middle)
  const m = norm([0.82, 0.18, -0.56]), up: V = [0, 1, 0], a = norm(sub(up, mul(m, dot(up, m))));
  let b = cross(m, a); if (dot(b, [0.56, 0, 0.82]) < 0) b = mul(b, -1);
  const seamRaw: V[] = [];
  for (let k = 0; k <= 320; k++) {
    const tt = -1.3 + (k / 320) * 3.0, hook = 0.55 * smooth(-0.85, -1.3, tt);
    const d = norm(add(add(mul(a, Math.cos(tt)), mul(b, Math.sin(tt))), mul(m, 0.16 + hook + 0.04 * Math.sin(tt * 5))));
    const h = ray(centre, d); if (h && h.p[1] > 0.03) seamRaw.push(h.p);
  }
  // (the ledge's lip: the facet edges between two vertices that stand out over a recessed neighbour)
  const nb = vs.map(() => new Set<number>());
  for (const [x, y, z] of fs) { nb[x].add(y).add(z); nb[y].add(x).add(z); nb[z].add(x).add(y); }
  const lipV = vs.map((_, i) => !recessed[i] && [...nb[i]].some((j) => recessed[j]) && P[i][1] > 0.05);
  const lip: Array<[V, V]> = [];
  vs.forEach((_, i) => { if (lipV[i]) for (const j of nb[i]) if (j > i && lipV[j]) lip.push([P[i], P[j]]); });
  return { pos, tris, normals, centre, ray, seam: resample(seamRaw, 0.006), lip };
}

/** a polyline at even spacing */
function resample(p: V[], step: number): V[] {
  const out: V[] = [p[0]];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const seg = sub(p[i], p[i - 1]), L = Math.hypot(...seg);
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
  if (Math.hypot(...t) < 1e-6) t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  t = norm(sub(t, mul(n, dot(t, n))));
  return [t, cross(n, t), n];
}

/** the drawing: the stone's marks in one look, ~`budget` of them */
export function oneStone(look: Look = 'dry', S = stoneShape(), seed = 11): Splats & { mark: Uint8Array; rank: Float32Array; normal: Float32Array } {
  let rs = seed; const r = () => { rs = (rs + 0x6d2b79f5) | 0; let x = Math.imul(rs ^ (rs >>> 15), 1 | rs); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const g = () => { let u = 0; for (let k = 0; k < 4; k++) u += r(); return (u - 2) / 0.58; };
  const out: Array<{ k: number; rank: number; p: V; ax: [V, V, V]; s: V; c: V; a: number }> = [];
  const put = (k: number, rank: number, p: V, ax: [V, V, V], s: V, c: V, a: number) => out.push({ k, rank: Math.max(0, Math.min(1, rank)), p, ax, s, c, a });
  const dry = look === 'dry', lift = (p: V, n: V, h = 0.003) => add(p, mul(n, h));
  const surf = (p: V) => S.ray(S.centre, norm(sub(p, S.centre)));

  // ─── fracture: the hooked seam, broken and tapering; a branch ───
  const seam = S.seam, L = seam.length;
  const breaks = [0.36, 0.62].map((u) => [u, u + (dry ? 0.025 : 0.012)]);
  for (let i = 0; i < L; i += dry ? 2 : 3) {
    const u = i / (L - 1), prev = seam[Math.max(0, i - 2)], next = seam[Math.min(L - 1, i + 2)], tan = norm(sub(next, prev)), h = surf(seam[i]);
    if (!h || breaks.some(([a, b]) => u > a && u < b)) continue;
    const taper = smooth(0, 0.08, u) * smooth(1, 0.82, u), weight = taper * (0.6 + 0.4 * Math.sin(u * 23) ** 2), hookW = 1 + 0.6 * smooth(0.12, 0.0, u);
    if (weight < 0.08) continue;
    const ax = frame(h.n, tan), w = (dry ? 0.0045 : 0.009) * weight * hookW;
    put(MARK.fracture, 0.9 + 0.1 * taper, lift(h.p, h.n), ax, [dry ? 0.016 : 0.022, w, 0.001], INK, dry ? 0.92 : 0.5);
    if (!dry && r() < 0.5) put(MARK.fracture, 0.85, lift(add(h.p, mul(ax[1], g() * 0.01)), h.n), ax, [0.03, w * 2.2, 0.001], INK, 0.14);
  }
  // (a branch off it, down the near face)
  const at = seam[Math.floor(L * 0.24)];
  let bp = at, bdir = norm(sub(seam[Math.floor(L * 0.24) + 6], at));
  bdir = norm(add(mul(bdir, 0.5), [0.15, -0.7, 0.45]));
  for (let k = 0; k < 70; k++) {
    const h = surf(add(bp, mul(bdir, 0.008))); if (!h) break;
    const w = (1 - k / 70) * (dry ? 0.003 : 0.006);
    if (k % (dry ? 1 : 2) === 0 && !(k > 30 && k < 36)) put(MARK.fracture, 0.62 + 0.18 * (1 - k / 70), lift(h.p, h.n), frame(h.n, bdir), [0.012, w, 0.001], INK, dry ? 0.85 : 0.45);
    bdir = norm(add(bdir, [Math.sin(k * 0.7) * 0.06, -0.02, 0.03])); bp = h.p;
  }
  // ─── chips: flecks beside the seam (dry) ───
  if (dry) for (let k = 0; k < 160; k++) {
    const i = Math.floor(r() * L), h = surf(add(seam[i], [g() * 0.025, g() * 0.025, g() * 0.025])); if (!h) continue;
    const s = 0.002 + 0.004 * r() ** 2;
    put(MARK.chip, 0.3 + 0.3 * r(), lift(h.p, h.n), frame(h.n, [r() - 0.5, r() - 0.5, r() - 0.5]), [s * 1.6, s, 0.001], INK, 0.85);
  }
  // ─── lip: the ledge's edge ───
  for (const [p0, p1] of S.lip) {
    const len = Math.hypot(...sub(p1, p0)), n = Math.ceil(len / (dry ? 0.012 : 0.018)), tan = norm(sub(p1, p0));
    for (let k = 0; k <= n; k++) {
      const p = add(p0, mul(sub(p1, p0), k / n)), h = surf(p); if (!h) continue;
      put(MARK.lip, 0.88 + 0.08 * r(), lift(h.p, h.n), frame(h.n, tan), [dry ? 0.014 : 0.02, dry ? 0.0035 : 0.007, 0.001], INK, dry ? 0.85 : 0.45);
    }
  }
  // ─── wash: faces in shadow, the ledge's underside most ───
  const F = S.tris.length / 3, area: number[] = [];
  for (let f = 0; f < F; f++) { const a: V = [S.pos[S.tris[f * 3] * 3], S.pos[S.tris[f * 3] * 3 + 1], S.pos[S.tris[f * 3] * 3 + 2]], b: V = [S.pos[S.tris[f * 3 + 1] * 3], S.pos[S.tris[f * 3 + 1] * 3 + 1], S.pos[S.tris[f * 3 + 1] * 3 + 2]], c: V = [S.pos[S.tris[f * 3 + 2] * 3], S.pos[S.tris[f * 3 + 2] * 3 + 1], S.pos[S.tris[f * 3 + 2] * 3 + 2]]; area.push(Math.hypot(...cross(sub(b, a), sub(c, a))) / 2); }
  const total = area.reduce((s, v) => s + v, 0), cum: number[] = []; area.reduce((s, v, k) => (cum[k] = s + v), 0);
  const onSurface = (): { p: V; n: V } => {
    const x = r() * total; let lo = 0, hi = F - 1; while (lo < hi) { const md = (lo + hi) >> 1; if (cum[md] < x) lo = md + 1; else hi = md; }
    const f = lo, v = (q: number): V => [S.pos[S.tris[f * 3 + q] * 3], S.pos[S.tris[f * 3 + q] * 3 + 1], S.pos[S.tris[f * 3 + q] * 3 + 2]];
    let u = r(), w = r(); if (u + w > 1) { u = 1 - u; w = 1 - w; }
    return { p: add(v(0), add(mul(sub(v(1), v(0)), u), mul(sub(v(2), v(0)), w))), n: [S.normals[f * 3], S.normals[f * 3 + 1], S.normals[f * 3 + 2]] };
  };
  const HATCH = norm([0.6, -1, 0.3]);
  for (let k = 0; k < (dry ? 9000 : 7000); k++) {
    const { p, n } = onSurface(), shade = smooth(0.0, -0.55, dot(n, LIGHT)), under = smooth(-0.1, -0.55, n[1]) * (p[1] > 0.05 ? 1 : 0);
    // (the lit side left open; the side away from the light lightly; under the ledge most)
    const want = Math.max(shade * (dry ? 0.22 : 0.16), under);
    if (r() > want || p[1] < 0.01) continue;
    const rank = under > 0.3 ? 0.28 + 0.15 * r() : 0.02 + 0.22 * r();
    if (dry) {
      // (hatching: short parallel strokes, closer under the ledge)
      if (r() > 0.55 + 0.45 * under) continue;
      put(MARK.wash, rank, lift(p, n, 0.002), frame(n, HATCH), [0.022, 0.0022, 0.001], INK, 0.55 + 0.3 * under);
    } else {
      const s = 0.05 + 0.08 * r();
      put(MARK.wash, rank, lift(p, n, 0.002), frame(n, [r() - 0.5, r() - 0.5, r() - 0.5]), [s, s * (0.6 + 0.4 * r()), 0.002], INK, 0.05 + 0.07 * under + 0.03 * shade);
    }
  }
  // ─── stipple: moss tufts on the seam's damp side, and at the foot ───
  const tuftAt = (p: V, n: V, along: V, size: number, count: number) => {
    for (let k = 0; k < count; k++) {
      const d = Math.abs(g()), core = d < 0.8;
      const q = add(p, add(mul(along, g() * size * 1.6), mul(norm(cross(n, along)), g() * size * 0.7)));
      const h = q[1] < 0.004 ? { p: [q[0], 0.002, q[2]] as V, n: [0, 1, 0] as V } : surf(q); if (!h) continue;
      const s = dry ? 0.0035 + 0.004 * r() : 0.008 + 0.014 * r();
      put(MARK.stipple, core ? 0.5 + 0.2 * r() : 0.15 + 0.25 * r(), lift(h.p, h.n), frame(h.n, [r() - 0.5, r() - 0.5, r() - 0.5]), [s * (1 + 0.5 * r()), s, 0.001], MOSS, dry ? 0.9 : 0.4);
    }
  };
  for (const u of [0.2, 0.31, 0.7]) {
    const i = Math.floor(u * (L - 1)), tan = norm(sub(seam[Math.min(L - 1, i + 3)], seam[Math.max(0, i - 3)])), h = surf(seam[i]); if (!h) continue;
    let damp = norm(cross(h.n, tan)); if (dot(damp, LIGHT) > 0) damp = mul(damp, -1);
    tuftAt(add(h.p, mul(damp, 0.02)), h.n, tan, 0.035, dry ? 140 : 70);
  }
  for (const ang of [2.5, 3.4]) {
    const d: V = [Math.cos(ang), 0, Math.sin(ang)], h = S.ray([0, 0.03, 0], d); if (!h) continue;
    tuftAt(h.p, [0, 1, 0], norm(cross([0, 1, 0], d)), 0.06, dry ? 160 : 80);
  }
  // ─── shadow: on the ground at the foot, away from the light ───
  const away = norm([-LIGHT[0], 0, -LIGHT[2]]);
  for (let k = 0; k < (dry ? 1800 : 700); k++) {
    const ang = r() * Math.PI * 2, d: V = [Math.cos(ang), 0, Math.sin(ang)], h = S.ray([0, 0.01, 0], d); if (!h) continue;
    const reach = 0.04 + 0.32 * Math.max(0, dot(d, away)) ** 1.5, e = Math.abs(g()) * reach * 0.5;
    const p: V = [h.p[0] + d[0] * e, 0.001, h.p[2] + d[2] * e], near = 1 - e / (reach + 0.001);
    if (dry) put(MARK.shadow, 0.55 + 0.35 * near, p, frame([0, 1, 0], [1, 0, 0.15]), [0.03, 0.0025, 0.001], INK, 0.75 * near + 0.15);
    else { const s = 0.04 + 0.05 * r(); put(MARK.shadow, 0.55 + 0.35 * near, p, frame([0, 1, 0], d), [s * 1.4, s, 0.001], INK, 0.12 + 0.18 * near); }
  }
  // ─── contour: candidates all over, lying flat; the shader shows those edge-on from here ───
  for (let k = 0; k < (dry ? 1100 : 800); k++) {
    const { p, n } = onSurface(); if (p[1] < 0.02) continue;
    const s = dry ? 0.022 + 0.012 * r() : 0.035 + 0.02 * r();
    put(MARK.contour, 0.66 + 0.2 * r(), lift(p, n, 0.001), frame(n, [r() - 0.5, r() - 0.5, r() - 0.5]), [s, s, 0.0012], INK, dry ? 0.75 : 0.4);
  }

  const s = Object.assign(alloc(out.length), { mark: new Uint8Array(out.length), rank: new Float32Array(out.length), normal: new Float32Array(out.length * 3) });
  out.forEach((m, i) => {
    s.pos.set(m.p, i * 3); s.scale.set(m.s, i * 3); s.rot.set(quat(...m.ax), i * 4);
    s.rgba.set([m.c[0], m.c[1], m.c[2], Math.round(m.a * 255)], i * 4);
    s.mark[i] = m.k; s.rank[i] = m.rank; s.normal.set(m.ax[2], i * 3);
  });
  return s;
}
