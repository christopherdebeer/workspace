/**
 * Regions: the labyrinth is built in more than one manner, and where it stands says which. Over the land lie districts
 * (a broad field seeded by the land, a dozen cells or so across each), and a building takes the manner of the district
 * its first-laid column stands in, the whole of it, so neighbours rhyme and a district differs from the next.
 *
 * - **The middle sea** (as it was): round arches, roofs of terracotta, shutters folded back, now and then an awning.
 * - **The plateau** (after the Persian courtyard houses): pointed arches over doors, windows and passages, four-centred
 *   over the wider spans of arcades and bridges; flat tops; tall windows in painted frames (teal, oxblood, turquoise),
 *   many of them lit warm from within; a dome now and then on a tower.
 *
 * The manner is a matter of what's drawn and how a building's top is finished: never of what's built or how a way goes.
 * `?region=persian` or `?region=mediterranean` holds the whole land to one.
 */
import { hash } from '../kit/rng';
import { unkey, type World } from './model';

export const MEDITERRANEAN = 0, PERSIAN = 1;
export type Region = typeof MEDITERRANEAN | typeof PERSIAN;
export type RegionMode = 'mixed' | 'persian' | 'mediterranean';
// (held on the global object, so every copy of this module (each bundle the checks load) reads the same setting)
const G = globalThis as { labyrinthRegions?: RegionMode };
export const setRegions = (m: RegionMode) => { G.labyrinthRegions = m; };
export const regionMode = (): RegionMode => G.labyrinthRegions ?? 'mixed';

/** how broad a district is, in cells */
const DISTRICT = 11;
const lattice = (s: number, x: number, z: number) => hash(s, x, z, 97) / 4294967296;
/** the district field at a place (0 … 1): value noise over a coarse lattice, smoothly between */
function field(w: World, i: number, j: number): number {
  const s = w.landSeed || w.seed, x = i / DISTRICT + 0.37, z = j / DISTRICT + 0.61, x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = lattice(s, x0, z0), b = lattice(s, x0 + 1, z0), c = lattice(s, x0, z0 + 1), d = lattice(s, x0 + 1, z0 + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}
/** the manner of the district at a place */
export function regionAt(w: World, i: number, j: number): Region {
  const mode = regionMode();
  if (mode !== 'mixed') return mode === 'persian' ? PERSIAN : MEDITERRANEAN;
  return field(w, i, j) > 0.5 ? PERSIAN : MEDITERRANEAN;
}
/** a building's manner: its district's, read where its first column stands (its id) */
export const regionOfId = (w: World, id: number): Region => { const [, i, j] = unkey(id); return regionAt(w, i, j); };

// ─── arches, by family ───
/** the arch families: round (a half circle), pointed (two-centred), four-centred (round shoulders, rising to a point) */
export const ROUND = 0, POINTED = 1, FOUR = 2;
export type ArchFamily = typeof ROUND | typeof POINTED | typeof FOUR;
// (pointed: each half an arc of radius R half-widths, centred on the springing line across from it)
const PR = 1.6;
// (four-centred: a shoulder of radius r, centred on the springing line, turning through θ; then an arc of radius R4,
// tangent to it, on to the crown, its centre below the springing and across the middle so the two halves meet in a point)
const r4 = 0.5, TH = Math.PI / 6, R4 = 2.2;
const C1 = 1 - r4, JX = C1 + r4 * Math.cos(TH), JY = r4 * Math.sin(TH), C2X = JX - R4 * Math.cos(TH), C2Y = JY - R4 * Math.sin(TH);
function raw(f: ArchFamily, s: number): number {
  s = Math.min(1, Math.abs(s));
  if (f === POINTED) return Math.sqrt(Math.max(0, PR * PR - (s + PR - 1) ** 2));
  if (f === FOUR) return s >= JX ? Math.sqrt(Math.max(0, r4 * r4 - (s - C1) ** 2)) : C2Y + Math.sqrt(Math.max(0, R4 * R4 - (s - C2X) ** 2));
  return Math.sqrt(Math.max(0, 1 - s * s));
}
/** how high an arch's crown stands over its springing, in half-widths */
export const CROWN: Record<ArchFamily, number> = { [ROUND]: 1, [POINTED]: raw(POINTED, 0), [FOUR]: raw(FOUR, 0) };
/** an arch's intrados over its springing, at `t` across from its middle (half-width `hw`), in the same units */
export const archY = (f: ArchFamily, t: number, hw: number) => hw * raw(f, t / hw);
/** the same, its crown at 1 (for an arch whose rise is set apart from its width: a span's) */
export const archUnit = (f: ArchFamily, s: number) => raw(f, s) / CROWN[f];
/** the intrados' normal at `t` (pointing down into the opening): across it and up */
export function archNormal(f: ArchFamily, t: number, hw: number): [number, number] {
  const e = 1e-4 * hw, slope = (archY(f, t + e, hw) - archY(f, t - e, hw)) / (2 * e), l = Math.hypot(slope, 1);
  return [slope / l, -1 / l];
}
/** points along an arch's intrados at even lengths along it (`n` pieces): the `t` of each */
export function archStations(f: ArchFamily, hw: number, n: number): number[] {
  const M = 96, ts: number[] = [], len: number[] = [0];
  for (let q = 0; q <= M; q++) ts.push(-hw + (2 * hw * q) / M);
  for (let q = 1; q <= M; q++) len.push(len[q - 1] + Math.hypot(ts[q] - ts[q - 1], archY(f, ts[q], hw) - archY(f, ts[q - 1], hw)));
  const out: number[] = [];
  for (let v = 0, q = 0; v <= n; v++) {
    const want = (len[M] * v) / n;
    while (q < M - 1 && len[q + 1] < want) q++;
    const a = (want - len[q]) / Math.max(1e-9, len[q + 1] - len[q]);
    out.push(ts[q] + (ts[q + 1] - ts[q]) * Math.min(1, Math.max(0, a)));
  }
  return out;
}
/** the family of an opening's head or a passage's arch in a manner; of a span's, by how many cells wide */
export const archOf = (r: Region): ArchFamily => (r === PERSIAN ? POINTED : ROUND);
export const spanArchOf = (r: Region, n: number): ArchFamily => (r === PERSIAN ? (n >= 2 ? FOUR : POINTED) : ROUND);
