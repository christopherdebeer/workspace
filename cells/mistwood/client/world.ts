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

/** Metres per cell of the wood's grid (it goes on in every direction). */
export const CELL = 10;
/** How far the wood is drawn (metres); the fog has it all by then. */
export const VIEW = 75;

export type Kind = Species | 'patch';

export interface Placed {
  x: number;
  z: number;
  kind: Kind;
  /** which of the pool's structures */
  pool: number;
  scale: number;
  /** its turn about the vertical (a 3D tree seen from a different side) */
  rot: number;
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

  /** What stands in one cell of the grid, placed the same every time. */
  cell(i: number, j: number): Placed[] {
    const key = i * 100003 + j;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const r = seeded(hash(this.seed, 7, i, j));
    const x0 = i * CELL;
    const z0 = j * CELL;
    const out: Placed[] = [];
    // the trodden path: trees keep off it (and crowd a little along its sides)
    const offPath = (x: number, z: number) => Math.abs(x - this.pathX(z));
    const place = (kind: Kind, per: number, clear: number, nearPath = 0) => {
      const count = per + (nearPath ? nearPath * Math.max(0, 1 - offPath(x0 + CELL / 2, z0 + CELL / 2) / 14) : 0);
      const whole = Math.floor(count) + (r() < count % 1 ? 1 : 0);
      for (let k = 0; k < whole; k++) {
        const x = x0 + r() * CELL;
        const z = z0 + r() * CELL;
        const pr = r();
        if (offPath(x, z) < clear) continue;
        out.push({ x, z, kind, pool: Math.floor(pr * POOL[kind]), scale: lerp(0.8, 1.2, r()), rot: r() * 6.283, flip: r() < 0.5, phase: r() * 6.28 });
      }
    };
    // tall trunks fading into the fog all round; the small leaning tree (the photograph's), often
    // by the path; a birch; beech saplings keeping their leaves; low scrub; and the ground cover
    place('tall', 1.3, 2.6);
    place('leaner', 0.12, 2, 0.35);
    place('birch', 0.1, 2.6);
    place('sapling', 0.3, 1.8, 0.3);
    place('shrub', 0.7, 1.2);
    place('patch', 48, 0);
    this.cache.set(key, out);
    if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value!);
    return out;
  }

  /** Everything within `radius` of (x, z). */
  around(x: number, z: number, radius: number): Placed[] {
    const out: Placed[] = [];
    for (let i = Math.floor((x - radius) / CELL); i <= Math.floor((x + radius) / CELL); i++)
      for (let j = Math.floor((z - radius) / CELL); j <= Math.floor((z + radius) / CELL); j++) for (const p of this.cell(i, j)) out.push(p);
    return out;
  }
}
