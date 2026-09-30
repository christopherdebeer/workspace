/**
 * The wood in the mist: a faint path to walk, and the trees and ground cover
 * either side of it, all from one seed. Nothing is stored — any stretch of the
 * wood is placed the same again from (seed, chunk).
 *
 * The trees themselves come from a small pool per seed (tree.ts grows them;
 * each is unique within the wood), placed again and again at different sizes,
 * mirrored — so the wood can be dense without growing a thousand trees.
 */
import { hash, lerp, noise1, seeded } from './rng';
import { grow, growPatch, type Species, type Structure } from './tree';

/** Metres per chunk along the path. */
export const CHUNK = 8;
/** How far ahead the wood is drawn (metres); the fog has it all by then. */
export const VIEW = 80;

export type Kind = Species | 'patch';

export interface Placed {
  x: number;
  z: number;
  kind: Kind;
  /** which of the pool's structures */
  pool: number;
  scale: number;
  flip: boolean;
  phase: number;
}

const POOL: Record<Kind, number> = { leaner: 6, tall: 10, birch: 5, sapling: 6, shrub: 8, patch: 12 };

export class Wood {
  readonly seed: number;
  readonly path: [number, number, number, number, number, number];
  /** How thick this wood's fog is (per metre). */
  readonly density: number;
  private cache = new Map<number, Placed[]>();
  private pool = new Map<string, Structure>();

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const r = seeded(hash(seed, 1));
    this.path = [2 + 4 * r(), 1 / (40 + 40 * r()), r() * 6.28, 0.8 + 1.5 * r(), 1 / (12 + 12 * r()), r() * 6.28];
    this.density = 0.036 + 0.02 * r();
  }

  pathX(z: number): number {
    const [a1, k1, p1, a2, k2, p2] = this.path;
    return a1 * Math.sin(z * k1 + p1) + a2 * Math.sin(z * k2 + p2);
  }
  pathSlope(z: number): number {
    const [a1, k1, p1, a2, k2, p2] = this.path;
    return a1 * k1 * Math.cos(z * k1 + p1) + a2 * k2 * Math.cos(z * k2 + p2);
  }
  /** Fog density here: thicker and thinner stretches as you walk. */
  densityAt(z: number): number {
    return this.density * (0.75 + 0.6 * noise1(hash(this.seed, 5), z / 70));
  }

  /** A pooled structure, grown the first time it is wanted. */
  structure(kind: Kind, i: number): Structure {
    const key = `${kind}:${i}`;
    let s = this.pool.get(key);
    if (!s) {
      const sub = hash(this.seed, 31, i, kind.length * 7 + kind.charCodeAt(0));
      s = kind === 'patch' ? growPatch(sub, 2.5 + (i % 3) * 0.8) : grow(sub, kind);
      this.pool.set(key, s);
    }
    return s;
  }
  grown(kind: Kind, i: number) {
    return this.pool.has(`${kind}:${i}`);
  }

  /** What stands in one chunk, placed the same every time. */
  chunk(i: number): Placed[] {
    const hit = this.cache.get(i);
    if (hit) return hit;
    const r = seeded(hash(this.seed, 7, i));
    const z0 = i * CHUNK;
    const out: Placed[] = [];
    const place = (kind: Kind, count: number, near: number, far: number, curve = 1) => {
      const whole = Math.floor(count) + (r() < count % 1 ? 1 : 0);
      for (let k = 0; k < whole; k++) {
        const z = z0 + r() * CHUNK;
        const side = r() < 0.5 ? -1 : 1;
        const off = near + Math.pow(r(), curve) * (far - near);
        out.push({ x: this.pathX(z) + side * off, z, kind, pool: Math.floor(r() * POOL[kind]), scale: lerp(0.8, 1.2, r()), flip: r() < 0.5, phase: r() * 6.28 });
      }
    };
    // tall trunks fade into the fog all round; a small leaning tree now and then near the
    // path (the photograph's); a birch; beech saplings keeping their leaves; low scrub
    place('tall', 6, 3, 45, 0.9);
    place('tall', 2, 8, 22, 1);
    place('leaner', 0.9, 2, 14, 1.3);
    place('birch', 0.55, 3, 30, 1);
    place('sapling', 1.6, 1.8, 22, 1.2);
    place('shrub', 3, 1.2, 18, 1.3);
    // ground cover: dry grass, bramble, bracken — on the path too
    place('patch', 110, 0, 9, 1.3);
    this.cache.set(i, out);
    if (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value!);
    return out;
  }

  between(z0: number, z1: number): Placed[] {
    const out: Placed[] = [];
    for (let i = Math.floor(z0 / CHUNK); i <= Math.floor(z1 / CHUNK); i++) for (const p of this.chunk(i)) if (p.z >= z0 && p.z <= z1) out.push(p);
    return out;
  }
}
