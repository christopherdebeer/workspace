/**
 * Taohua: the water bench. A small hill of its own, far off across the hill from any way, with four
 * streams laid as given, each the subject of one scene: a still pond, a winding stream, a rocky rapid,
 * and a waterfall into its pool. The same geometry every time, so the drawing of the water can be
 * changed and compared against itself (`?bench=water&scene=pond|bend|rapid|fall`, best with `review`).
 */
import type { Ways } from './ways';

/** where the bench lies across the hill: far from the ways */
const X = 1000;
/** the bench hill's slope at z: gentle for the pond and the bend, steep for the rapid and the fall */
const slope = (z: number) => (z < 0 ? 0.12 : z < 90 ? 0.05 : z < 190 ? 0.07 : z < 270 ? 0.26 : z < 300 ? 0.06 : z < 345 ? 0.32 : 0.06);
export const SCENES = {
  pond: { focus: 27, back: 10, side: 1.5 },
  bend: { focus: 142, back: 7, side: 3 },
  rapid: { focus: 236, back: 7, side: 2.2 },
  fall: { focus: 328, back: 13, side: 2.5 },
} as const;
export type Scene = keyof typeof SCENES;

/** a hill of the bench's own: its slope as given, and no ways on it */
function isolate(ways: Ways, s: (z: number) => number) {
  const w = ways as unknown as Record<string, unknown>;
  w.slope = s;
  const first = ways.first();
  w.nearest = (x: number, z: number) => ({ d: 999, w: first, u: 0, p: [x, 0, z] });
  w.waysNear = () => [];
  w.junctionsNear = () => [];
}

/** Make the hill the bench: its slope, no ways near it, its streams. Returns where to stand for the scene. */
export function bench(ways: Ways, scene: Scene): [number, number] {
  isolate(ways, slope);
  ways.water.fix([
    { z0: 30, z1: 78, x0: X, A: [1.5, 0.6, 0.3], lam: [20, 7, 1.2], w0: 0.8, pools: [{ z: 27, rx: 11, rz: 6, kind: 'pond' }, { z: 78, rx: 1.6, rz: 1.4, kind: 'spring' }] },
    { z0: 101, z1: 185, x0: X, A: [8, 2, 0.5], lam: [12, 5, 1.2], w0: 1.0, pools: [{ z: 99, rx: 4, rz: 3, kind: 'pool' }, { z: 185, rx: 1.8, rz: 1.5, kind: 'spring' }] },
    { z0: 200, z1: 268, x0: X, A: [2.5, 1, 0.6], lam: [18, 6, 1.2], w0: 0.9, pools: [{ z: 198, rx: 4.5, rz: 3, kind: 'pool' }, { z: 268, rx: 1.6, rz: 1.4, kind: 'spring' }] },
    { z0: 285, z1: 395, x0: X, A: [1.5, 0.8, 0.4], lam: [16, 6, 1.2], w0: 0.9, pools: [{ z: 283, rx: 8, rz: 5, kind: 'pond' }, { z: 395, rx: 1.8, rz: 1.5, kind: 'spring' }], fall: { lip: 333, foot: 323 } },
  ]);
  const s = SCENES[scene], st = ways.water.streamsNear(s.focus, s.focus)[0];
  const z = s.focus - s.back;
  return [ways.water.xAt(st, s.focus) + s.side, z];
}

/**
 * The ways bench: places on one hill (seed 1) where a kind of way can be studied, each looking up it
 * from a little below (`?bench=ways&scene=flight|rock|timber|cut|bend|steep`, best with `review`;
 * trees left out, so the way's drawing stands alone). Found by searching the hill for: the
 * longest flight of each kind of stair, the deepest cut beside a trail, its sharpest bend, its
 * steepest stretch. (They're the hill's own places, so they move if the ways are laid differently.)
 */
export const WAY_SCENES = {
  flight: 'w26:0.5',
  rock: 'w9:21.3',
  timber: 'w0:8.4',
  cut: 'w0:44.0',
  bend: 'w17:40.0',
  steep: 'w1:12.0',
} as const;
export type WayScene = keyof typeof WAY_SCENES;

/**
 * The tree bench: a hill of its own (no ways, no water but one pond), with trees set out as given,
 * each grown from its own seed (`?bench=tree&scene=…&tree=N`, N choosing the seeds, best with `review`):
 * one tree alone; the same tree twice, as the orchard draws it and as it's drawn standing alone; a
 * grove, crowns among crowns; a tree with an outcrop behind it, as the prints set blossom against
 * black rock; a tree above a still pond; and a lineup of three, each its own.
 */
const TX = -1000;
export interface Specimen { x: number; z: number; seed: number; iso: number; rocks?: boolean }
export const TREE_SCENES = {
  lone: { focus: 20, back: 7, side: 1.5 },
  pair: { focus: 60, back: 8, side: 0 },
  grove: { focus: 102, back: 11, side: 0 },
  rocks: { focus: 140, back: 7, side: 1.5 },
  water: { focus: 203, back: 10, side: 1 },
  lineup: { focus: 252, back: 10, side: 0 },
} as const;
export type TreeScene = keyof typeof TREE_SCENES;

/** Make the hill the tree bench; returns where to stand for the scene, and the trees to grow. */
export function treeBench(ways: Ways, scene: TreeScene, n: number): { at: [number, number]; trees: Specimen[] } {
  isolate(ways, (z) => (z < 0 ? 0.12 : 0.1));
  ways.water.fix([{ z0: 203, z1: 216, x0: TX + 7, A: [1, 0.4, 0.2], lam: [20, 7, 1.2], w0: 0.7, pools: [{ z: 200, rx: 9, rz: 4.5, kind: 'pond' }, { z: 216, rx: 1.4, rz: 1.2, kind: 'spring' }] }]);
  const s = (k: number) => n * 101 + k;
  const trees: Specimen[] = [
    { x: TX, z: 20, seed: s(0), iso: 1 },
    { x: TX - 3.4, z: 60, seed: s(0), iso: 0 },
    { x: TX + 3.4, z: 60, seed: s(0), iso: 1 },
    { x: TX, z: 140, seed: s(0), iso: 0.6, rocks: true },
    { x: TX - 1.5, z: 206.2, seed: s(0), iso: 0.6 },
  ];
  // (the grove: a grid, jittered, as the hill's own are)
  for (let gx = -2; gx <= 2; gx++) for (let gz = -1; gz <= 2; gz++) {
    const k = (gx + 2) * 4 + gz + 1, j = (a: number) => (((s(k) * 2654435761 + a * 40503) >>> 0) % 1000) / 1000 - 0.5;
    trees.push({ x: TX + gx * 3.9 + j(1) * 3.5, z: 100 + gz * 3.9 + j(2) * 3.5, seed: s(10 + k), iso: 0 });
  }
  for (let k = 0; k < 3; k++) trees.push({ x: TX - 5.5 + k * 5.5, z: 252 + (k % 2) * 1.5, seed: s(40 + k), iso: 0.5 });
  const sc = TREE_SCENES[scene];
  return { at: [TX + sc.side, sc.focus - sc.back], trees };
}

/**
 * The river bench: places at the foot of one hill (seed 1) to study the river from
 * (`?bench=river&scene=jetty|far|bank|arrive`, best with `review`): standing on the jetty by the boat,
 * as the journey starts; on the river's far bank, looking back across it to the hill; on its near bank
 * a way along, the river below; and the arrival, held part way, the boat coming in.
 */
export const RIVER_SCENES = {
  jetty: { at: '@-0.15,-8.4' },
  far: { at: '@2,-22.6' },
  bank: { at: '@-16,-2' },
  arrive: { intro: 9 }, open: { intro: 2 }, start: { splash: true },
} as const;
export type RiverScene = keyof typeof RIVER_SCENES;

/**
 * The benches, registered: each a fixed place (or hill of its own) to study one thing against itself,
 * its scenes, and what it's for. The side sheet's settings list them (surfaces.ts), so each is a tap away.
 */
export const BENCHES: Array<{ id: string; title: string; note: string; scenes: string[] }> = [
  { id: 'water', title: 'Water', note: 'Four streams on a hill of their own: a pond, a bend, a rapid, a fall', scenes: Object.keys(SCENES) },
  { id: 'ways', title: 'Ways', note: 'Kinds of way on one hill, trees left out: flights of each kind of stair, a cut, a bend, a steep stretch', scenes: Object.keys(WAY_SCENES) },
  { id: 'tree', title: 'Trees', note: 'Trees set out as given: alone, a pair, a grove, by rocks, by water, a lineup', scenes: Object.keys(TREE_SCENES) },
  { id: 'river', title: 'River', note: 'The foot of one hill: the jetty, the far bank, the near bank, the arrival, the start', scenes: Object.keys(RIVER_SCENES) },
];
