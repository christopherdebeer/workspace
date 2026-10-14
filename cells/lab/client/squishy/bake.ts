/**
 * Squishy: what the bake of a level's light needs (the bake itself is drawn, in main.ts). A level stands still
 * (but for the lids, the jellies' tops and the dumpling), so each vertex of what's drawn is asked, once, as
 * the level's laid: from all round it, how much of its view is shut off by the things near it (under a cake
 * stand's plate, a saucer's foot, between a crate's slats, a cloth on cookbooks: nearer counts more), and what
 * colour is what shuts it off, for the light that comes off that onto it (the wood's amber up into a porcelain
 * plate, a pudding's orange onto its saucer). The room itself (the counter, the table's top, the walls) is lit
 * by it, but shuts nothing off: else everything near the counter would be dark.
 */
import { MAT } from './level';

/** what each thing's made of, as a colour, roughly, for what it throws onto what's near it (by material, up to 63) */
export function albedos(): Float32Array {
  const a = new Float32Array(64 * 3).fill(0.6);
  const set: Array<[number, [number, number, number]]> = [
    [MAT.counter, [0.62, 0.45, 0.3]], [MAT.bamboo, [0.62, 0.48, 0.28]], [MAT.weave, [0.6, 0.46, 0.27]], [MAT.porcelain, [0.82, 0.82, 0.8]],
    [MAT.lacquer, [0.45, 0.08, 0.06]], [MAT.jelly, [0.95, 0.6, 0.12]], [MAT.tin, [0.4, 0.5, 0.45]], [MAT.jar, [0.5, 0.62, 0.52]],
    [MAT.board, [0.7, 0.55, 0.38]], [MAT.gold, [0.8, 0.6, 0.25]], [MAT.tiles, [0.85, 0.83, 0.78]], [MAT.butter, [0.95, 0.85, 0.45]],
    [MAT.honey, [0.85, 0.5, 0.1]], [MAT.pot, [0.75, 0.75, 0.72]], [MAT.pan, [0.2, 0.2, 0.2]], [MAT.hob, [0.35, 0.35, 0.36]],
    [MAT.towel, [0.85, 0.82, 0.76]], [MAT.gingham, [0.8, 0.45, 0.45]], [MAT.floral, [0.3, 0.6, 0.55]], [MAT.legs, [0.25, 0.18, 0.12]],
    [MAT.pannacotta, [0.92, 0.88, 0.8]], [MAT.konjac, [0.95, 0.45, 0.6]], [MAT.bread, [0.75, 0.5, 0.25]], [MAT.enamel, [0.88, 0.88, 0.85]],
    [MAT.steel, [0.6, 0.6, 0.62]], [MAT.sponge, [0.9, 0.8, 0.3]], [MAT.napkin, [0.92, 0.9, 0.88]], [MAT.book, [0.55, 0.6, 0.5]],
    [MAT.berry, [0.6, 0.06, 0.14]],
  ];
  for (const [m, c] of set) a.set(c, m * 3);
  return a;
}
/** what's the room's own, lit but shutting nothing off: the counter, the hob, the walls' tiles */
export const ROOM_MATS = [MAT.counter, MAT.hob, MAT.tiles];
/** the ways it looks out, evenly all round (none straight up or down) */
export function bakeDirs(n = 48): Float32Array {
  const d = new Float32Array(n * 3), g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2, r = Math.sqrt(1 - y * y), a = g * i;
    d[i * 3] = Math.cos(a) * r; d[i * 3 + 1] = y; d[i * 3 + 2] = Math.sin(a) * r;
  }
  return d;
}
/** how far off a thing shuts off the light the less (cm): a thing this far off counts half */
export const BAKE_RANGE = 18;
