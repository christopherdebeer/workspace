/**
 * Seeded randomness. Everything in the wood comes from one seed: the same
 * seed is the same walk, tree for tree, wherever you stop and start.
 */

export type Rand = () => number;

/** mulberry32: small, fast, good enough for trees. */
export function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hash of integers (FNV-ish, then mixed): a stable sub-seed for a chunk, a tree, a sprite. */
export function hash(...n: number[]): number {
  let h = 2166136261;
  for (const x of n) {
    h ^= x | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

const unit = (seed: number, i: number) => hash(seed, i) / 4294967296;

/** Smooth 1D value noise in 0..1 (for weather along the walk). */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return unit(seed, i) * (1 - u) + unit(seed, i + 1) * u;
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ─── a seed you can say ───────────────────────────────────────────────────────

const FIRST = [
  'hollow', 'grey', 'still', 'moss', 'birch', 'fern', 'low', 'pale', 'damp', 'quiet', 'white', 'deep', 'old', 'green', 'soft', 'far',
  'cold', 'bright', 'lichen', 'bracken', 'dew', 'slow', 'thin', 'wet', 'dim', 'amber', 'silver', 'sunk', 'wild', 'north', 'lost', 'dusk',
];
const SECOND = [
  'hollow', 'water', 'light', 'mere', 'ford', 'glade', 'rise', 'fold', 'brook', 'reach', 'pool', 'ride', 'combe', 'wold', 'dell', 'shaw',
  'burn', 'holt', 'marsh', 'bank', 'clearing', 'spring', 'path', 'hurst', 'ghyll', 'moor', 'copse', 'heath', 'tarn', 'wash', 'lea', 'grove',
];

/** Two words and a number for a seed ("moss-ford-7"), and back. */
export function seedName(seed: number): string {
  const s = seed >>> 0;
  return `${FIRST[s % 32]}-${SECOND[(s >>> 5) % 32]}-${(s >>> 10) % 97}`;
}
export function seedFrom(text: string | null): number | null {
  if (!text) return null;
  const m = /^([a-z]+)-([a-z]+)-(\d+)$/.exec(text.trim().toLowerCase());
  if (m) {
    const a = FIRST.indexOf(m[1]);
    const b = SECOND.indexOf(m[2]);
    const n = Number(m[3]);
    if (a >= 0 && b >= 0 && n < 97) return (a + (b << 5) + (n << 10)) >>> 0;
  }
  if (/^\d+$/.test(text)) return Number(text) % (97 << 10);
  return hash(...[...text].map((c) => c.charCodeAt(0))) % (97 << 10);
}
export const randomSeed = () => Math.floor(Math.random() * (97 << 10));
