/**
 * Traditions: how the labyrinth is built, and where. A land is built in one tradition (chosen by the land's own seed),
 * so a settlement holds together; each tradition is a grammar of construction, not a costume: what its walls are made
 * of, how it covers its tops, how it opens its faces. What's drawn follows from those (buildings.ts, facade.ts,
 * roof.ts), never what's built or how a way goes.
 *
 * - **The middle sea**: dressed stone; pitched roofs of terracotta (hipped, gabled, a shed against what's taller);
 *   round arches; shutters folded back, an awning now and then.
 * - **The plateau** (after the Persian courtyard houses): stone; flat tops with a parapet, a dome now and then on a
 *   tower; pointed arches, four-centred over wider spans; tall windows in panes, in teal, oxblood or turquoise, about
 *   half lit within.
 * - **The north** (after the canal towns): a stone ground storey and timber frame over it; steep gables, their ends
 *   stepped in brick or framed, slate, dormers, chimneys; square-headed openings, small panes in white or green.
 * - **The east** (after the courtyard towns of China and Japan): whitewashed walls between dark posts and beams;
 *   hipped roofs of grey tile, deep eaves turned up at the corners, a skirt of tile at each floor; lattice windows,
 *   most lit like paper screens.
 *
 * `?region=` holds a land to one (mediterranean, persian, timber, eaves); `?region=mixed` lays districts of the first
 * two over it, as a sketch of lands with more than one (a way from one to the next: not yet).
 */
import { hash } from '../kit/rng';
import { unkey, type World } from './model';

export type GrammarId = 'mediterranean' | 'persian' | 'timber' | 'eaves';
export interface Grammar {
  id: GrammarId;
  /** what the walls are: dressed stone; timber frame over a stone ground storey; whitewash between posts */
  wall: 'ashlar' | 'frame' | 'plaster';
  /** how a top is covered: pitched tile; flat, walked, a parapet round it; steep slate gables; deep eaves of grey tile */
  roof: 'tile' | 'flat' | 'steep' | 'eave';
  /** arches over doors, windows, passages; and over a span by its width */
  arch: ArchFamily; span: (n: number) => ArchFamily;
  /** a window's head, and a door's: arched (by the arch family), or square */
  windows: Array<'arched' | 'square' | 'slit'>; doorHead: 'arched' | 'square';
  /** shutters and awnings (the middle sea's); else glass in panes behind bars in a paint of the tradition's, `fine` for
   * a lattice, lit within by this share */
  shutters: boolean; panes: { paints: number[]; fine: boolean; lit: number } | null;
  /** what the rules dress its stone in, now and then (character.ts): marble or brick; brick alone; neither (it's
   * whitewashed) */
  stone: 'mixed' | 'brick' | 'none';
  /** how its façades are composed (facades.ts): round a court (galleried, a portal, paired windows over it); to the
   * street (its upper storeys jettied out, shopfronts along its door's front); on verandas (a deck under the skirt, the
   * front screens); or (null) each face to itself, as buildings.ts lays its openings */
  facade: 'court' | 'street' | 'veranda' | null;
}

export type RegionMode = 'land' | 'mixed' | GrammarId;
// (held on the global object, so every copy of this module (each bundle the checks load) reads the same setting)
const G = globalThis as { labyrinthRegions?: RegionMode };
export const setRegions = (m: RegionMode) => { G.labyrinthRegions = m; };
export const regionMode = (): RegionMode => G.labyrinthRegions ?? 'land';

/** how broad a district is, in cells (`mixed`) */
const DISTRICT = 11;
const lattice = (s: number, x: number, z: number) => hash(s, x, z, 97) / 4294967296;
/** the district field at a place (0 … 1): value noise over a coarse lattice, smoothly between */
function field(w: World, i: number, j: number): number {
  const s = w.landSeed || w.seed, x = i / DISTRICT + 0.37, z = j / DISTRICT + 0.61, x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = lattice(s, x0, z0), b = lattice(s, x0 + 1, z0), c = lattice(s, x0, z0 + 1), d = lattice(s, x0 + 1, z0 + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}
export const ORDER: GrammarId[] = ['mediterranean', 'persian', 'timber', 'eaves'];
/** the tradition at a place: the land's (one to a land), or as `?region=` holds it */
export function grammarAt(w: World, i: number, j: number): Grammar {
  const mode = regionMode();
  if (mode === 'mixed') return GRAMMARS[field(w, i, j) > 0.5 ? 'persian' : 'mediterranean'];
  if (mode !== 'land') return GRAMMARS[mode];
  // (a land's own: by its seed; the bare slab, and a land not yet seeded, the middle sea)
  return GRAMMARS[w.landSeed ? ORDER[hash(w.landSeed, 211) % ORDER.length] : 'mediterranean'];
}
/** a building's tradition: read where its first column stands (its id) */
export const grammarOfId = (w: World, id: number): Grammar => { const [, i, j] = unkey(id); return grammarAt(w, i, j); };

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
export const GRAMMARS: Record<GrammarId, Grammar> = {
  mediterranean: { id: 'mediterranean', wall: 'ashlar', roof: 'tile', arch: ROUND, span: () => ROUND, windows: ['arched', 'square', 'slit'], doorHead: 'arched', shutters: true, panes: null, stone: 'mixed', facade: null },
  persian: { id: 'persian', wall: 'ashlar', roof: 'flat', arch: POINTED, span: (n) => (n >= 2 ? FOUR : POINTED), windows: ['square', 'arched', 'arched', 'arched'], doorHead: 'arched', shutters: false, panes: { paints: [0, 1, 2], fine: false, lit: 0.55 }, stone: 'mixed', facade: 'court' },
  timber: { id: 'timber', wall: 'frame', roof: 'steep', arch: ROUND, span: () => ROUND, windows: ['square'], doorHead: 'square', shutters: false, panes: { paints: [3, 4, 1], fine: false, lit: 0.45 }, stone: 'brick', facade: 'street' },
  eaves: { id: 'eaves', wall: 'plaster', roof: 'eave', arch: ROUND, span: () => ROUND, windows: ['square'], doorHead: 'square', shutters: false, panes: { paints: [5, 5, 6], fine: true, lit: 0.65 }, stone: 'none', facade: 'veranda' },
};
