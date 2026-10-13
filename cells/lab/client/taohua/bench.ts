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

/** Make the hill the bench: its slope, no ways near it, its streams. Returns where to stand for the scene. */
export function bench(ways: Ways, scene: Scene): [number, number] {
  const w = ways as unknown as Record<string, unknown>;
  w.slope = slope;
  const first = ways.first();
  w.nearest = (x: number, z: number) => ({ d: 999, w: first, u: 0, p: [x, 0, z] });
  w.waysNear = () => [];
  w.junctionsNear = () => [];
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
