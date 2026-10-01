/**
 * The wood in the mist, from one seed: paths that wind and fork through it,
 * its own set of tree species, and where each tree and tuft of grass stands.
 * Nothing is stored — any part of the wood is placed the same again from
 * (seed, cell), in every direction.
 *
 * Paths are where two smooth noise fields cross their middle value: each
 * field's zero line winds by itself, and where the two families meet, paths
 * join and fork. The ground shader (render.ts) computes exactly the same — the
 * same hash, the same noise — so the trees keep off what is drawn.
 *
 * Species: each wood draws its own from the space of growth parameters around
 * the archetypes (tree.ts `sampleGenome`), and each species has a small pool
 * of grown trees, placed again and again at different sizes and turns.
 */
import { hash, lerp, seeded } from './rng';
import { grow, growPatch, sampleGenome, type Genome, type Species, type Structure } from './tree';

/** Metres per cell of the wood's grid (it goes on in every direction). */
export const CELL = 10;
/** How far the wood is drawn (metres); the fog has it all by then. */
export const VIEW = 75;

/** A species id ('t0', 'b1', …) or ground cover. */
export type Kind = string;

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

export interface SpeciesIn {
  id: Kind;
  genome: Genome;
  /** trees per cell, how far they keep off a path, how much they crowd its sides */
  per: number;
  clear: number;
  nearPath: number;
  pool: number;
}

// ─── the same noise as the shaders' (render.ts NOISE): pcg hash, value noise ──────────────────
function pcg(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
function h2(x: number, y: number, seed: number): number {
  return pcg((Math.imul(x >>> 0, 1973) ^ pcg(((y | 0) + seed) >>> 0)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy, seed);
  const b = h2(ix + 1, iy, seed);
  const c = h2(ix, iy + 1, seed);
  const d = h2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export class Wood {
  readonly seed: number;
  /** The two path fields' scales (1/m) and the path's half-width (m). */
  readonly path: [number, number, number];
  /** How thick this wood's fog is (per metre). */
  readonly density: number;
  readonly species: SpeciesIn[] = [];
  private cache = new Map<number, Placed[]>();
  private pool = new Map<string, Structure>();
  /** Debug (`?only=birch`): every tree of one archetype, to look at it. */
  only: Species | null = null;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const r = seeded(hash(seed, 1));
    this.path = [1 / (55 + 30 * r()), 1 / (85 + 40 * r()), 0.9 + 0.35 * r()];
    this.density = 0.03 + 0.016 * r();
    // this wood's species: around the archetypes, a couple of wild cards further out
    const add = (id: string, archetype: Species, per: number, clear: number, nearPath: number, pool: number, wild = 1) =>
      this.species.push({ id, genome: sampleGenome(seeded(hash(seed, 41, this.species.length)), archetype, wild), per, clear, nearPath, pool });
    const talls = 2 + Math.floor(r() * 2);
    for (let i = 0; i < talls; i++) add(`t${i}`, 'tall', 1.3 / talls, 2.4, 0, 6);
    const leaners = 1 + Math.floor(r() * 2);
    for (let i = 0; i < leaners; i++) add(`l${i}`, 'leaner', 0.1 / leaners, 1.8, 0.35 / leaners, 5);
    if (r() < 0.75) add('b0', 'birch', 0.1, 2.4, 0, 5);
    add('s0', 'sapling', 0.25, 1.6, 0.25, 5);
    add('h0', 'shrub', 0.4, 1.1, 0, 5);
    add('h1', 'shrub', 0.3, 1.1, 0.2, 5);
    const wilds = Math.floor(r() * 3);
    const arch: Species[] = ['tall', 'leaner', 'sapling', 'shrub', 'birch'];
    for (let i = 0; i < wilds; i++) add(`w${i}`, arch[Math.floor(r() * arch.length)], 0.12, 2, 0.1, 4, 1.8);
  }

  /** Roughly how far (m) from the nearest path. */
  pathDist(x: number, z: number): number {
    let best = 1e3;
    for (let i = 0; i < 2; i++) {
      const k = this.path[i];
      const off = i * 37.1;
      const f = (px: number, pz: number) => vnoise(px * k + off, pz * k + off, this.seed) * 0.7 + vnoise(px * k * 2.3 + off * 1.7, pz * k * 2.3 + off * 1.7, this.seed) * 0.3;
      const e = 0.25;
      const n = f(x, z) - 0.5;
      const gx = (f(x + e, z) - f(x - e, z)) / (2 * e);
      const gz = (f(x, z + e) - f(x, z - e)) / (2 * e);
      best = Math.min(best, Math.abs(n) / Math.max(Math.hypot(gx, gz), 1e-4));
    }
    return best;
  }

  /** The nearest point on a path to (x, z) along a line across, and the path's way there. */
  findPath(x: number, z: number): { x: number; z: number; heading: number } {
    let bx = x;
    let bz = z;
    let bd = Infinity;
    for (let r = 0; r <= 120; r += 1)
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
        const pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
        const d = this.pathDist(px, pz);
        if (d < bd) {
          bd = d;
          bx = px;
          bz = pz;
        }
        if (bd < 0.15) break;
      }
    // the path's way: the direction from here in which it stays nearest
    let heading = 0;
    let hd = Infinity;
    for (let a = 0; a < 32; a++) {
      const h = (a / 32) * Math.PI * 2;
      if (Math.cos(h) < -0.2) continue; // (onwards, not back)
      let d = 0;
      for (const step of [3, 6, 9, 12]) d += this.pathDist(bx + Math.sin(h) * step, bz + Math.cos(h) * step);
      if (d < hd) {
        hd = d;
        heading = h;
      }
    }
    return { x: bx, z: bz, heading };
  }

  /** Fog density here: hollows where it lies thick and rises where it thins — a property of the place, the same each time you come by. */
  densityAt(x: number, z: number): number {
    const n = vnoise(x / 70, z / 70, hash(this.seed, 5)) * 0.7 + vnoise(x / 23 + 11.3, z / 23 + 4.1, hash(this.seed, 6)) * 0.3;
    return this.density * (0.75 + 0.45 * n);
  }

  genomeOf(kind: Kind): Genome | null {
    return this.species.find((sp) => sp.id === kind)?.genome ?? null;
  }

  /** A pooled structure, grown the first time it is wanted. */
  structure(kind: Kind, i: number): Structure {
    const key = `${kind}:${i}`;
    let s = this.pool.get(key);
    if (!s) {
      const sub = hash(this.seed, 31, i, kind.charCodeAt(0) * 31 + (kind.charCodeAt(1) || 0));
      s = kind === 'patch' ? growPatch(sub, 2.5 + (i % 3) * 0.8) : grow(sub, this.genomeOf(kind)!);
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
    const centre = this.pathDist(x0 + CELL / 2, z0 + CELL / 2);
    const place = (kind: Kind, per: number, clear: number, nearPath: number, pool: number) => {
      const count = per + nearPath * Math.max(0, 1 - centre / 12);
      const whole = Math.floor(count) + (r() < count % 1 ? 1 : 0);
      for (let k = 0; k < whole; k++) {
        const x = x0 + r() * CELL;
        const z = z0 + r() * CELL;
        const pr = r();
        const scale = lerp(0.8, 1.2, r());
        const rot = r() * 6.283;
        const flip = r() < 0.5;
        const phase = r() * 6.28;
        // keep off the paths (the grass thins on them; trees stand back)
        const pd = clear > 0 || kind === 'patch' ? this.pathDist(x, z) : 99;
        if (pd < clear || (kind === 'patch' && pd < this.path[2] * 0.8 + r() * 0.7)) continue;
        out.push({ x, z, kind, pool: Math.floor(pr * pool), scale, rot, flip, phase });
      }
    };
    for (const sp of this.species) {
      if (this.only && sp.genome.archetype !== this.only) continue;
      place(sp.id, this.only ? sp.per * 3 : sp.per, sp.clear, sp.nearPath, sp.pool);
    }
    place('patch', 48, 0, 0, 12);
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
