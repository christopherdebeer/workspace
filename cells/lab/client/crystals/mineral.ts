/**
 * Minerals, as crystals: a seed is a species (a habit, a refractive index and its dispersion, a
 * body colour) and a cluster of its crystals grown out of a matrix — every one a convex hull of
 * planes, which is what the renderer traces. Pure: the same seed is the same specimen.
 *
 * A habit is the shape a mineral's crystals take: quartz a six-sided prism with a pyramid for a
 * tip; beryl the prism with a flat end; tourmaline a rounded-triangular prism; fluorite cubes;
 * garnet rhombic dodecahedra; calcite rhombs; topaz a wedge-ended prism; zircon octahedra.
 */
import { seeded, type Rand } from '../kit/rng';

export type Habit = 'prism' | 'cube' | 'octa' | 'dodeca' | 'rhomb';
export interface Species {
  kind: string;
  /** the variety's name, as a label says it */
  name: string;
  habit: Habit;
  /** prism sides (4, 6; 6 with alternating radii for the trigonal look) */
  sides: number;
  /** the second radius of alternate prism faces, as a fraction (1: regular) */
  alt: number;
  /** the tip: the pyramid faces' tilt from the prism face, in radians (π/2: a flat end) */
  tip: number;
  /** a flat cap cuts the pyramid at this fraction of its height (1: a full point) */
  cap: number;
  ior: number;
  /** index spread between red and blue, as drawn (exaggerated a little from the mineral's) */
  disp: number;
  /** the body colour: what survives a unit path */
  tint: [number, number, number];
  /** how strongly the body absorbs (per unit length) */
  absorb: number;
  /** internal scattering: milkiness per unit length */
  milk: number;
  /** how slender the crystals are: length / radius */
  slender: [number, number];
  /** crystals in a cluster */
  count: [number, number];
  /** overall size */
  size: number;
}

const V = (kind: string, name: string, s: Partial<Species>): Species => ({
  kind, name, habit: 'prism', sides: 6, alt: 1, tip: 0.95, cap: 1, ior: 1.55, disp: 0.012, tint: [0.9, 0.9, 0.9], absorb: 0.4, milk: 0.0, slender: [3, 6], count: [6, 11], size: 1,
  ...s,
});

/** The varieties, by weight of appearance. */
export const SPECIES: Species[] = [
  V('quartz', 'Rock crystal', { tint: [0.97, 0.97, 0.97], absorb: 0.15, milk: 0.02 }),
  V('quartz', 'Amethyst', { tint: [0.62, 0.36, 0.86], absorb: 0.8, milk: 0.04 }),
  V('quartz', 'Smoky quartz', { tint: [0.55, 0.45, 0.36], absorb: 0.9, milk: 0.03 }),
  V('quartz', 'Citrine', { tint: [0.95, 0.72, 0.28], absorb: 0.7 }),
  V('quartz', 'Rose quartz', { tint: [0.95, 0.62, 0.7], absorb: 0.5, milk: 0.35, tip: 1.2, slender: [1.5, 3] }),
  V('beryl', 'Aquamarine', { tip: Math.PI / 2, ior: 1.58, disp: 0.01, tint: [0.55, 0.85, 0.9], absorb: 0.6, slender: [3, 5], count: [4, 8] }),
  V('beryl', 'Emerald', { tip: Math.PI / 2, ior: 1.58, disp: 0.01, tint: [0.2, 0.75, 0.42], absorb: 1.6, milk: 0.08, slender: [2.5, 4], count: [4, 7] }),
  V('beryl', 'Heliodor', { tip: Math.PI / 2, ior: 1.58, disp: 0.01, tint: [0.95, 0.85, 0.35], absorb: 0.7, slender: [3, 5], count: [4, 8] }),
  V('tourmaline', 'Rubellite', { alt: 0.72, tip: 1.1, cap: 0.35, ior: 1.64, disp: 0.014, tint: [0.9, 0.25, 0.45], absorb: 1.5, slender: [4, 8], count: [5, 10] }),
  V('tourmaline', 'Verdelite', { alt: 0.72, tip: 1.1, cap: 0.35, ior: 1.64, disp: 0.014, tint: [0.3, 0.7, 0.35], absorb: 1.6, slender: [4, 8], count: [5, 10] }),
  V('fluorite', 'Purple fluorite', { habit: 'cube', ior: 1.43, disp: 0.008, tint: [0.55, 0.3, 0.8], absorb: 0.55, milk: 0.04, count: [5, 9], size: 0.9 }),
  V('fluorite', 'Green fluorite', { habit: 'cube', ior: 1.43, disp: 0.008, tint: [0.4, 0.85, 0.55], absorb: 0.5, milk: 0.04, count: [5, 9], size: 0.9 }),
  V('fluorite', 'Blue John', { habit: 'cube', ior: 1.43, disp: 0.008, tint: [0.45, 0.45, 0.85], absorb: 0.65, milk: 0.06, count: [5, 9], size: 0.9 }),
  V('calcite', 'Iceland spar', { habit: 'rhomb', ior: 1.6, disp: 0.012, tint: [0.96, 0.96, 0.93], absorb: 0.2, milk: 0.03, count: [4, 8], size: 0.95 }),
  V('calcite', 'Honey calcite', { habit: 'rhomb', ior: 1.6, disp: 0.012, tint: [0.95, 0.7, 0.35], absorb: 0.7, milk: 0.06, count: [4, 8], size: 0.95 }),
  V('rhodochrosite', 'Rhodochrosite', { habit: 'rhomb', ior: 1.65, disp: 0.012, tint: [0.95, 0.4, 0.5], absorb: 1.2, milk: 0.2, count: [5, 9], size: 0.85 }),
  V('topaz', 'Blue topaz', { sides: 4, alt: 0.62, tip: 0.8, cap: 0.5, ior: 1.62, disp: 0.011, tint: [0.6, 0.8, 0.95], absorb: 0.5, slender: [2, 4], count: [3, 6], size: 1.05 }),
  V('topaz', 'Imperial topaz', { sides: 4, alt: 0.62, tip: 0.8, cap: 0.5, ior: 1.62, disp: 0.011, tint: [0.95, 0.6, 0.3], absorb: 0.8, slender: [2, 4], count: [3, 6], size: 1.05 }),
  V('garnet', 'Almandine', { habit: 'dodeca', ior: 1.8, disp: 0.02, tint: [0.75, 0.12, 0.15], absorb: 2.2, count: [4, 8], size: 0.85 }),
  V('garnet', 'Grossular', { habit: 'dodeca', ior: 1.74, disp: 0.018, tint: [0.85, 0.55, 0.25], absorb: 1.4, count: [4, 8], size: 0.85 }),
  V('zircon', 'Zircon', { habit: 'octa', ior: 1.95, disp: 0.04, tint: [0.95, 0.9, 0.8], absorb: 0.3, count: [4, 8], size: 0.8 }),
  V('zircon', 'Hyacinth', { habit: 'octa', ior: 1.95, disp: 0.04, tint: [0.9, 0.5, 0.3], absorb: 0.9, count: [4, 8], size: 0.8 }),
];

/** A plane n·p ≤ d, in world space. */
export interface Plane { n: [number, number, number]; d: number }
export interface Crystal {
  /** base point, in the world (on the matrix) */
  at: [number, number, number];
  /** local → world rotation, column-major columns (the local +Y is the crystal's axis) */
  R: number[];
  /** full size: radius and length (polyhedra: the half-size) */
  r: number;
  len: number;
  /** growth timing: when it starts, how long it takes (seconds) */
  t0: number;
  dur: number;
  /** a roll of the faces about the axis */
  roll: number;
}
export interface Specimen {
  seed: number;
  species: Species;
  crystals: Crystal[];
  /** the matrix: an ellipsoid at the origin, these radii */
  matrix: [number, number, number];
}

const norm = (v: [number, number, number]): [number, number, number] => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: number[], b: number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** a rotation whose +Y is `axis`, rolled by `roll` about it (columns x, y, z) */
function frame(axis: [number, number, number], roll: number): number[] {
  const y = norm(axis);
  const ref: [number, number, number] = Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let x = norm(cross(ref, y));
  let z = norm(cross(y, x));
  const c = Math.cos(roll), s = Math.sin(roll);
  const x2: [number, number, number] = [x[0] * c + z[0] * s, x[1] * c + z[1] * s, x[2] * c + z[2] * s];
  z = norm(cross(y, x2)); x = x2;
  return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
}
export const rot = (R: number[], v: [number, number, number]): [number, number, number] => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];

export function pick(seed: number, kind?: string): Species {
  const r = seeded(seed * 7 + 3);
  const pool = kind ? SPECIES.filter((s) => s.kind === kind || s.name.toLowerCase() === kind.toLowerCase()) : SPECIES;
  const list = pool.length ? pool : SPECIES;
  return list[Math.floor(r() * list.length)];
}

/** The specimen for a seed: its species and the crystals of its cluster. */
export function specimen(seed: number, kind?: string): Specimen {
  const sp = pick(seed, kind);
  const r = seeded(seed);
  const matrix: [number, number, number] = [1.25 + r() * 0.4, 0.3 + r() * 0.14, 1.1 + r() * 0.4];
  const n = sp.count[0] + Math.floor(r() * (sp.count[1] - sp.count[0] + 1));
  const crystals: Crystal[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const big = i === 0 ? 1 : 0.45 + r() * 0.55;
    const rad = (i === 0 ? 0.1 : 0.25 + 0.95 * Math.sqrt(r())) * 1.05;
    const th = i * golden + r() * 0.6;
    const x = Math.cos(th) * rad * matrix[0] * 0.78, z = Math.sin(th) * rad * matrix[2] * 0.78;
    const ym = matrix[1] * Math.sqrt(Math.max(0, 1 - (x / matrix[0]) ** 2 - (z / matrix[2]) ** 2));
    const lean = (i === 0 ? 0.05 : 0.15 + r() * 0.65) * (sp.habit === 'prism' ? 1 : 1.2);
    const psi = Math.atan2(z, x) + (r() - 0.5) * 1.2;
    const axis = norm([Math.sin(lean) * Math.cos(psi), Math.cos(lean), Math.sin(lean) * Math.sin(psi)]);
    const slen = sp.slender[0] + r() * (sp.slender[1] - sp.slender[0]);
    const radius = (sp.habit === 'prism' ? 0.12 + 0.2 * big : 0.16 + 0.22 * big) * sp.size;
    const len = sp.habit === 'prism' ? radius * slen * sp.size : radius;
    crystals.push({ at: [x, ym - 0.22 * radius / 0.3, z], R: frame(axis, r() * Math.PI * 2), r: radius, len, t0: i === 0 ? 0 : 0.4 + r() * 3.2, dur: 2.2 + r() * 2.4 + len, roll: r() * Math.PI * 2 });
  }
  return { seed, species: sp, crystals, matrix };
}

/** The crystal's hull at growth g (0..1): planes in world space. */
export function planesOf(c: Crystal, sp: Species, g: number): Plane[] {
  const out: Plane[] = [];
  const add = (nl: [number, number, number], d: number) => {
    const nw = rot(c.R, norm(nl));
    out.push({ n: nw, d: d + nw[0] * c.at[0] + nw[1] * c.at[1] + nw[2] * c.at[2] });
  };
  const e = 0.001 + g;
  if (sp.habit === 'prism') {
    const r = c.r * (0.3 + 0.7 * g), L = c.len * e;
    const k = sp.sides;
    for (let j = 0; j < k; j++) {
      const a = c.roll + (j / k) * Math.PI * 2;
      add([Math.cos(a), 0, Math.sin(a)], r * (j % 2 ? sp.alt : 1));
    }
    add([0, -1, 0], 0.3 * r);
    // the tip: pyramid faces through the rim, and a cap if it is cut
    const b = sp.tip, cb = Math.cos(b), sb = Math.sin(b);
    const apex = cb > 1e-4 ? (r * cb) / sb : 0;
    if (b < Math.PI / 2 - 1e-3) for (let j = 0; j < k; j++) {
      const a = c.roll + (j / k) * Math.PI * 2;
      add([Math.cos(a) * cb, sb, Math.sin(a) * cb], r * (j % 2 ? sp.alt : 1) * cb + L * sb);
    }
    add([0, 1, 0], L + apex * sp.cap);
  } else {
    const s = c.r * e;
    const up = c.r * 0.45; // (polyhedra sit a little into the matrix)
    const lift = (nl: [number, number, number], k = 1) => s * k + norm(nl)[1] * up; // (the body centre is `up` along the axis)
    if (sp.habit === 'cube') for (const nl of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as [number, number, number][]) add(nl, lift(nl));
    else if (sp.habit === 'octa') for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) add([sx, sy, sz], lift([sx, sy, sz], 0.95));
    else if (sp.habit === 'dodeca') for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) for (const sa of [1, -1]) for (const sb of [1, -1]) { const nl: [number, number, number] = [0, 0, 0]; nl[a] = sa; nl[b] = sb; add(nl, lift(nl, 0.9)); }
    else if (sp.habit === 'rhomb') { const gm = 0.72; for (let j = 0; j < 3; j++) { const a = c.roll + (j / 3) * Math.PI * 2; const nl: [number, number, number] = [Math.cos(a) * Math.cos(gm), Math.sin(gm), Math.sin(a) * Math.cos(gm)]; add(nl, lift(nl)); add([-nl[0], -nl[1], -nl[2]], lift([-nl[0], -nl[1], -nl[2]])); } }
  }
  return out;
}

/** A bounding sphere for the crystal at growth g: centre and radius. */
export function bound(c: Crystal, sp: Species, g: number): [number, number, number, number] {
  if (sp.habit === 'prism') {
    const r = c.r, L = c.len * (0.001 + g) + r;
    const ax = rot(c.R, [0, 1, 0]);
    const h = L / 2;
    return [c.at[0] + ax[0] * h, c.at[1] + ax[1] * h, c.at[2] + ax[2] * h, Math.hypot(r * 1.1, h) + 0.02];
  }
  const ax = rot(c.R, [0, 1, 0]);
  const up = c.r * 0.45;
  return [c.at[0] + ax[0] * up, c.at[1] + ax[1] * up, c.at[2] + ax[2] * up, c.r * (0.001 + g) * 1.75 + 0.02];
}

/** growth at time t since the specimen began */
export const growth = (c: Crystal, t: number): number => { const x = Math.max(0, Math.min(1, (t - c.t0) / c.dur)); return x * x * (3 - 2 * x); };

/** Does the point lie inside the hull? (for the test) */
export const inside = (p: [number, number, number], planes: Plane[]) => planes.every((pl) => pl.n[0] * p[0] + pl.n[1] * p[1] + pl.n[2] * p[2] <= pl.d + 1e-9);
