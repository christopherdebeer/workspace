/**
 * The wood: a stream to walk beside, and the trees either side of it, all from
 * one seed. Nothing is stored — any stretch of the wood is regenerated the same
 * from (seed, chunk).
 *
 * Two poles, from the two pictures it started from:
 *   mist (0)  — bare, leaning trees in green-grey fog, dry russet grass;
 *   light (1) — a sunlit colonnade of birches, green grass, a puddled stream
 *               running to bright water, with mossy crags against the sky.
 * A seed sets where its wood sits between them; the weather drifts as you walk.
 */
import { clamp01, hash, lerp, noise1, seeded, smooth } from './rng';
import type { SpriteKey } from './sprites';

/** Metres per chunk along the stream. */
export const CHUNK = 8;
/** How far ahead the wood is drawn (metres). */
export const VIEW = 96;

export type Kind = 'birch' | 'bare' | 'beech' | 'tuft';

export interface Tree {
  x: number;
  z: number;
  /** World size (metres) of the sprite: width (negative: mirrored), height. */
  w: number;
  h: number;
  sprite: number;
  kind: Kind;
  /** Wind phase. */
  phase: number;
  /** 0..1 how much it sways (tall and thin sway most). */
  sway: number;
}

export interface Palette {
  fog: [number, number, number];
  zenith: [number, number, number];
  grass: [number, number, number];
  grassSun: [number, number, number];
  grassShade: [number, number, number];
  canopy: [number, number, number];
  /** fog per metre */
  density: number;
  /** 0..1 sunlight */
  sun: number;
}

const mix3 = (a: number[], b: number[], t: number) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)] as [number, number, number];

export class Wood {
  readonly seed: number;
  /** Where the wood sits between mist (0) and light (1). */
  readonly base: number;
  /** How much the weather wanders as you walk. */
  readonly drift: number;
  /** The stream: two sines, amplitudes (m), wavenumbers (1/m), phases. */
  readonly path: [number, number, number, number, number, number];
  /** Two crags on the far water: azimuth (rad), half-width (rad), height (rad). */
  readonly crags: [number, number, number, number, number, number];
  /** Sprite variants per key (indices into the atlas) and each one's width/height, set from the atlas. */
  sprites: Record<SpriteKey, number[]> = { birch: [], birchBare: [], bare: [], beech: [], tuft: [], tuftGreen: [] };
  aspect: number[] = [];
  private cache = new Map<number, Tree[]>();

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const r = seeded(hash(seed, 1));
    // most woods lean one way or the other; a few sit in between
    const u = r();
    this.base = u < 0.5 ? 0.1 + 0.35 * r() : 0.55 + 0.4 * r();
    this.drift = 0.15 + 0.3 * r();
    this.path = [3 + 5 * r(), 1 / (38 + 40 * r()), r() * 6.28, 1 + 2 * r(), 1 / (11 + 12 * r()), r() * 6.28];
    const side = r() < 0.5 ? -1 : 1;
    this.crags = [side * (0.04 + 0.06 * r()), 0.045 + 0.025 * r(), 0.14 + 0.08 * r(), -side * (0.03 + 0.05 * r()), 0.025 + 0.02 * r(), 0.07 + 0.05 * r()];
  }

  pathX(z: number): number {
    const [a1, k1, p1, a2, k2, p2] = this.path;
    return a1 * Math.sin(z * k1 + p1) + a2 * Math.sin(z * k2 + p2);
  }
  pathSlope(z: number): number {
    const [a1, k1, p1, a2, k2, p2] = this.path;
    return a1 * k1 * Math.cos(z * k1 + p1) + a2 * k2 * Math.cos(z * k2 + p2);
  }

  /** The weather at a distance along the walk: 0 mist … 1 light. */
  moodAt(z: number): number {
    const n = noise1(hash(this.seed, 2), z / 260) - 0.5;
    const n2 = noise1(hash(this.seed, 3), z / 90) - 0.5;
    return clamp01(this.base + n * this.drift * 2 + n2 * 0.12);
  }

  /** Colours and fog for a mood (shared by the sky, the ground and the trees). */
  palette(m: number): Palette {
    const t = smooth(0.1, 0.9, m);
    return {
      fog: mix3([0.46, 0.57, 0.5], [0.8, 0.87, 0.79], t),
      zenith: mix3([0.38, 0.48, 0.42], [0.66, 0.79, 0.74], t),
      grass: mix3([0.34, 0.28, 0.18], [0.2, 0.38, 0.12], t),
      grassSun: mix3([0.46, 0.38, 0.24], [0.56, 0.72, 0.26], t),
      grassShade: mix3([0.17, 0.15, 0.11], [0.08, 0.18, 0.07], t),
      canopy: mix3([0.3, 0.38, 0.33], [0.1, 0.2, 0.1], t),
      density: lerp(0.034, 0.011, t),
      sun: t,
    };
  }

  /** The trees (and tufts) of one chunk, regenerated the same every time. */
  chunk(i: number): Tree[] {
    const hit = this.cache.get(i);
    if (hit) return hit;
    const r = seeded(hash(this.seed, 7, i));
    const z0 = i * CHUNK;
    const m = this.moodAt(z0 + CHUNK / 2);
    const out: Tree[] = [];
    const pick = (key: SpriteKey) => {
      const s = this.sprites[key];
      return s.length ? s[Math.floor(r() * s.length)] : 0;
    };
    // a tree's sprite and its world width (mirrored half the time)
    const size = (sprite: number, h: number) => h * (this.aspect[sprite] ?? 0.33) * (r() < 0.5 ? -1 : 1);
    const corridor = 3.2 + 1.5 * noise1(hash(this.seed, 9), z0 / 40);
    // trees: fewer and barer in the mist; birches in rows along the banks in the light
    const n = Math.round(lerp(9, 11, m) + r() * 3);
    for (let k = 0; k < n; k++) {
      const z = z0 + r() * CHUNK;
      const px = this.pathX(z);
      // a bank tree (close either side of the stream) or one in the wood beyond
      const bank = r() < lerp(0.2, 0.45, m);
      const side = r() < 0.5 ? -1 : 1;
      const off = bank ? corridor + 0.6 + r() * 3.5 : corridor + 1.5 + Math.pow(r(), lerp(1.3, 0.7, m)) * 40;
      const x = px + side * off;
      const u = r();
      const kind: Kind = u < lerp(0.3, 0.92, m) ? 'birch' : u < lerp(0.8, 0.97, m) ? 'bare' : 'beech';
      const h = kind === 'birch' ? 14 + r() * 12 : kind === 'bare' ? 8 + r() * 8 : 4 + r() * 4;
      // leafy birches in the light, bare ones in the mist
      const sprite = pick(kind === 'birch' ? (r() < smooth(0.3, 0.7, m) ? 'birch' : 'birchBare') : kind);
      out.push({ x, z, w: size(sprite, h), h, sprite, kind, phase: r() * 6.28, sway: kind === 'beech' ? 0.4 : kind === 'birch' ? 0.7 : 1 });
    }
    // tufts of grass and bramble near the stream (drawn only close by)
    const tufts = Math.round(lerp(52, 26, m));
    for (let k = 0; k < tufts; k++) {
      const z = z0 + r() * CHUNK;
      const side = r() < 0.5 ? -1 : 1;
      const off = corridor * 0.35 + Math.pow(r(), 1.4) * 16;
      const h = 0.35 + r() * 0.5;
      const sprite = pick(r() < smooth(0.35, 0.8, m) ? 'tuftGreen' : 'tuft');
      out.push({ x: this.pathX(z) + side * off, z, w: size(sprite, h), h, sprite, kind: 'tuft', phase: r() * 6.28, sway: 0.5 });
    }
    this.cache.set(i, out);
    // keep the cache small: the walk only goes forward, but a look back is cheap to regenerate
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    return out;
  }

  /** Everything from z0 to z1. */
  between(z0: number, z1: number): Tree[] {
    const out: Tree[] = [];
    for (let i = Math.floor(z0 / CHUNK); i <= Math.floor(z1 / CHUNK); i++) for (const t of this.chunk(i)) if (t.z >= z0 && t.z <= z1) out.push(t);
    return out;
  }
}
