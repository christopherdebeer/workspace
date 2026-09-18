/**
 * ── ONE SMALL PRNG, SHARED ──
 *
 * mulberry32 was declared twice — in main.ts for every seeded canvas and
 * massing draw, and again in facade.ts for the mark atlas — and was about to
 * be a third time when the wall canvases left main.ts for the façade lab.
 * Three copies of a PRNG are three places a constant can drift, and a canvas
 * seeded from one that had drifted would be a different canvas in the lab and
 * in the game, which is exactly the fault the labs exist to make impossible.
 * The same seed through this function is the same texture, wherever it runs.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
